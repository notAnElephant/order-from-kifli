import { createId } from '../utils/ids.js';
import { currentPeriod, nowIso } from '../utils/time.js';
import { formatProposalMessage } from '../notify/formatters.js';
import { buildCartProposal } from '../grocer/cart-builder.js';
import { buildDiscountIndex, matchIngredientToProduct } from '../grocer/product-matcher.js';
import { findMealCombinationCandidates, rerankCandidatesWithCartSignals } from '../planning/meal-combination-search.js';
import { rankRecipes } from '../scoring/recipe-scorer.js';
import { normalizeText } from '../utils/normalize.js';
import type {
  GrocerClient,
  HistoryStore,
  MealCombinationCandidate,
  Notifier,
  ProposalRecord,
  RecipeSource,
  StaticConfig
} from '../types.js';
import { KifliMcpClient } from '../grocer/kifli-mcp-client.js';

export interface WeeklyRunDependencies {
  recipeSource: RecipeSource;
  grocerClient: GrocerClient;
  historyStore: HistoryStore;
  notifier: Notifier;
  timezone: string;
  weeklyTargetTotalMinutes: number;
  defaultRecipeCount: number;
  staticConfig: StaticConfig;
}

type RunGrocerCache = {
  searchByQuery: Map<string, ReturnType<GrocerClient['searchProducts']>>;
  deliverySlots?: ReturnType<GrocerClient['getDeliverySlots']>;
};

export class WeeklyRunOrchestrator {
  constructor(private deps: WeeklyRunDependencies) {}

  private pushGrocerNote(notes: string[], message: string) {
    if (!notes.includes(message)) notes.push(message);
  }

  private async evaluateCandidateCart(candidate: MealCombinationCandidate, cache: RunGrocerCache): Promise<MealCombinationCandidate> {
    const caps = await this.deps.grocerClient.getCapabilities();
    const discounts = caps.discounts ? await this.deps.grocerClient.getDiscounts() : [];
    const discountIndex = buildDiscountIndex(discounts);

    const matchedLines = [] as import('../types.js').MatchedCartLine[];
    const grocerNotes: string[] = [];

    for (const scored of candidate.recipes) {
      for (const ingredient of scored.recipe.ingredients) {
        const override = this.deps.staticConfig.productOverrides[ingredient.normalizedName];
        const query = override?.preferredQuery ?? ingredient.name;
        const cacheKey = normalizeText(query);
        let search;
        try {
          let searchPromise = cache.searchByQuery.get(cacheKey);
          if (!searchPromise) {
            searchPromise = this.deps.grocerClient.searchProducts(query);
            cache.searchByQuery.set(cacheKey, searchPromise);
          }
          search = await searchPromise;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[grocer] product search failed for "${query}": ${message}`);
          this.pushGrocerNote(grocerNotes, `Product search failed for ${ingredient.name}: ${message}`);
          matchedLines.push({
            ingredientName: ingredient.name,
            normalizedIngredientName: ingredient.normalizedName,
            requestedQuantity: ingredient.quantity,
            requestedUnit: ingredient.unit,
            matched: false,
            notes: [message],
            sourceRecipeIds: [scored.recipe.id]
          });
          continue;
        }
        if (search.products.length === 0) {
          this.pushGrocerNote(grocerNotes, `No products for ${ingredient.name}`);
        }
        const products = search.products.map((p) => {
          const discount = discountIndex[p.id];
          return {
            ...p,
            discountedPrice: p.discountedPrice ?? discount?.discountedPrice,
            price: p.price ?? discount?.basePrice,
            isDiscounted: p.isDiscounted || Boolean(discount),
            tags: [...new Set([...(p.tags ?? []), ...(discount ? ['discounted'] : [])])]
          };
        });

        matchedLines.push(
          matchIngredientToProduct(ingredient, products, scored.recipe.id, {
            productOverrides: this.deps.staticConfig.productOverrides,
            discountsByProductId: discountIndex
          })
        );
      }
    }

    let slots: import('../types.js').DeliverySlot[] = [];
    if (caps.deliverySlots) {
      try {
        cache.deliverySlots ??= this.deps.grocerClient.getDeliverySlots();
        slots = await cache.deliverySlots;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[grocer] delivery slot lookup failed: ${message}`);
        this.pushGrocerNote(grocerNotes, `Delivery slot lookup failed: ${message}`);
      }
    }
    candidate.cartProposal = buildCartProposal({ matchedLines, slots, notes: grocerNotes });
    return candidate;
  }

  async run(trigger: 'scheduled' | 'manual' = 'scheduled'): Promise<ProposalRecord> {
    const recentMeals = await this.deps.historyStore.getRecentMeals(14);
    const recipes = await this.deps.recipeSource.listRecipes();
    const cache: RunGrocerCache = {
      searchByQuery: new Map()
    };
    if (recipes.length < 2) {
      throw new Error('Need at least 2 enabled recipes in Notion to build a weekly plan.');
    }

    const scoredRecipes = rankRecipes(recipes, {
      timezone: this.deps.timezone,
      recentMeals,
      weeklyTargetTotalMinutes: this.deps.weeklyTargetTotalMinutes,
      seasonalityByMonth: this.deps.staticConfig.seasonalityByMonth,
      nowIso: nowIso(this.deps.timezone)
    });

    let candidates = findMealCombinationCandidates(scoredRecipes, {
      defaultRecipeCount: this.deps.defaultRecipeCount,
      weeklyTargetTotalMinutes: this.deps.weeklyTargetTotalMinutes,
      topNRecipesForCombos: 10,
      maxCandidates: 6
    });

    if (candidates.length === 0) {
      throw new Error('No meal combinations could be generated from available recipes.');
    }

    const cartEvalLimit = Math.min(4, candidates.length);
    for (let i = 0; i < cartEvalLimit; i += 1) {
      candidates[i] = await this.evaluateCandidateCart(candidates[i]!, cache);
    }
    candidates = rerankCandidatesWithCartSignals(candidates);

    let selected = candidates.find((candidate) => candidate.cartProposal) ?? candidates[0]!;
    if (!selected.cartProposal) {
      selected = await this.evaluateCandidateCart(selected, cache);
    }
    if (selected.cartProposal) {
      try {
        await this.deps.grocerClient.setCart(selected.cartProposal.matchedLines);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[grocer] cart update failed: ${message}`);
        selected.cartProposal.grocerNotes.push(`Cart update failed: ${message}`);
      }
    }

    const period = currentPeriod(this.deps.timezone);
    const proposal: ProposalRecord = {
      id: createId('proposal'),
      createdAt: nowIso(this.deps.timezone),
      status: 'proposed',
      periodStart: period.start,
      periodEnd: period.end,
      candidate: selected,
      messageText: ''
    };

    proposal.messageText = formatProposalMessage(proposal);
    proposal.candidate.rationale.push(`trigger=${trigger}`);

    if (this.deps.grocerClient instanceof KifliMcpClient) {
      const stats = this.deps.grocerClient.getRequestStats();
      console.error('[weekly-run] grocer stats', JSON.stringify(stats, null, 2));
      if (stats.rateLimitErrors > 0 && selected.cartProposal) {
        selected.cartProposal.grocerNotes.push(
          `Kifli MCP rate-limited this run (${stats.rateLimitErrors}/${stats.totalCalls} failed with 429).`
        );
        proposal.messageText = formatProposalMessage(proposal);
      }
    }

    await this.deps.historyStore.saveProposal(proposal);
    const sendResult = await this.deps.notifier.sendProposal(proposal);
    if (sendResult.messageId) {
      proposal.telegramMessageId = sendResult.messageId;
      await this.deps.historyStore.setProposalTelegramMessageId(proposal.id, sendResult.messageId);
    }

    return proposal;
  }
}
