import type { MealCombinationCandidate, ScoredRecipe } from '../types.js';
import { normalizeText } from '../utils/normalize.js';

export interface CombinationSearchOptions {
  defaultRecipeCount: number;
  weeklyTargetTotalMinutes: number;
  maxRecipeCount?: number;
  topNRecipesForCombos?: number;
  maxCandidates?: number;
}

function chooseTargetRecipeCount(recipes: ScoredRecipe[], options: CombinationSearchOptions): number {
  const preferred = Math.max(2, Math.min(options.maxRecipeCount ?? 3, options.defaultRecipeCount));
  if (preferred <= 2) return 2;
  const top3 = recipes.slice(0, 3);
  if (top3.length < 3) return Math.min(2, recipes.length);
  const averageMinutes = top3.reduce((sum, r) => sum + r.recipe.totalMinutes, 0) / 3;
  const targetAverage = options.weeklyTargetTotalMinutes / 3;
  return averageMinutes <= targetAverage * 1.1 ? 3 : 2;
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const current: T[] = [];
  function walk(start: number) {
    if (current.length === k) {
      out.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i += 1) {
      current.push(arr[i]!);
      walk(i + 1);
      current.pop();
    }
  }
  walk(0);
  return out;
}

function ingredientOverlapBonus(combo: ScoredRecipe[]): number {
  const seen = new Map<string, number>();
  for (const scored of combo) {
    for (const ing of scored.recipe.ingredients.slice(0, 6)) {
      const key = normalizeText(ing.normalizedName);
      if (!key) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  let bonus = 0;
  for (const count of seen.values()) {
    if (count > 1) bonus += 0.04 * (count - 1);
  }
  return Math.min(0.2, bonus);
}

function diversityBonus(combo: ScoredRecipe[]): number {
  const categories = new Set(combo.map((r) => normalizeText(r.recipe.category ?? '')));
  const nonEmpty = [...categories].filter(Boolean).length;
  if (nonEmpty === 0) return 0;
  if (nonEmpty === combo.length) return 0.08;
  return 0.03;
}

export function findMealCombinationCandidates(
  scoredRecipes: ScoredRecipe[],
  options: CombinationSearchOptions
): MealCombinationCandidate[] {
  if (scoredRecipes.length < 2) return [];
  const targetCount = chooseTargetRecipeCount(scoredRecipes, options);
  const pool = scoredRecipes.slice(0, options.topNRecipesForCombos ?? 10);
  const combos = combinations(pool, Math.min(targetCount, pool.length));

  const candidates = combos.map((combo) => {
    const combinedMinutes = combo.reduce((sum, item) => sum + item.recipe.totalMinutes, 0);
    const baseScore = combo.reduce((sum, item) => sum + item.breakdown.total, 0);
    const overlapBonus = ingredientOverlapBonus(combo);
    const diversity = diversityBonus(combo);
    const minutesOver = Math.max(0, combinedMinutes - options.weeklyTargetTotalMinutes);
    const costPenalty = minutesOver / Math.max(options.weeklyTargetTotalMinutes, 1) * 0.2;
    const finalScore = baseScore + overlapBonus + diversity - costPenalty;

    return {
      recipeCount: combo.length,
      recipes: combo,
      recipeIds: combo.map((item) => item.recipe.id),
      combinedMinutes,
      baseScore,
      overlapBonus,
      diversityBonus: diversity,
      costPenalty,
      finalScore,
      rationale: [
        `base=${baseScore.toFixed(2)}`,
        `overlap=${overlapBonus.toFixed(2)}`,
        `diversity=${diversity.toFixed(2)}`,
        `minutes=${combinedMinutes}`
      ]
    } satisfies MealCombinationCandidate;
  });

  return candidates
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, options.maxCandidates ?? 10);
}

export function rerankCandidatesWithCartSignals(candidates: MealCombinationCandidate[]): MealCombinationCandidate[] {
  for (const candidate of candidates) {
    if (!candidate.cartProposal) continue;
    const cart = candidate.cartProposal;
    const availabilityPenalty = cart.unmatchedIngredients.length * 0.08;
    const savingsBonus = cart.estimatedTotal > 0 ? (cart.estimatedSavings / cart.estimatedTotal) * 0.3 : 0;
    const pricePenalty = cart.discountedTotal > 0 ? cart.discountedTotal / 100000 : 0;
    candidate.finalScore = candidate.finalScore + savingsBonus - availabilityPenalty - pricePenalty;
    candidate.rationale.push(
      `savingsBonus=${savingsBonus.toFixed(2)}`,
      `availabilityPenalty=${availabilityPenalty.toFixed(2)}`
    );
  }
  return [...candidates].sort((a, b) => b.finalScore - a.finalScore);
}
