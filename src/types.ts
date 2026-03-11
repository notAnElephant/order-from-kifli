export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

export interface ParsedIngredient {
  originalLine: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  normalizedName: string;
  parseWarnings: string[];
}

export interface Recipe {
  id: string;
  name: string;
  ingredientsText: string;
  ingredients: ParsedIngredient[];
  rating: number;
  totalMinutes: number;
  enabled: boolean;
  seasonTags?: string[];
  category?: string;
  servings?: number;
  instructionsUrl?: string;
  lastCooked?: string;
  source?: 'notion' | 'manual';
}

export interface MealHistoryEntry {
  proposalId: string;
  plannedDate: string;
  recipeId: string;
  recipeName: string;
  dominantIngredients: string[];
  status: 'approved';
}

export interface RecipeScoreBreakdown {
  total: number;
  seasonalityScore: number;
  ratingScore: number;
  timeScore: number;
  availabilityScore: number;
  discountScore: number;
  repetitionPenalty: number;
  ingredientRepetitionPenalty: number;
  notes: string[];
}

export interface ScoredRecipe {
  recipe: Recipe;
  breakdown: RecipeScoreBreakdown;
}

export interface RecipeScoreContext {
  nowIso?: string;
  timezone: string;
  recentMeals: MealHistoryEntry[];
  weeklyTargetTotalMinutes: number;
  seasonalityByMonth: Record<string, string[]>;
  ingredientSignals?: Record<string, IngredientMarketSignal>;
}

export interface IngredientMarketSignal {
  ingredientName: string;
  available: boolean;
  discountRatio?: number;
  bestPrice?: number;
  matchedProductName?: string;
}

export interface MealCombinationCandidate {
  recipeCount: number;
  recipes: ScoredRecipe[];
  recipeIds: string[];
  combinedMinutes: number;
  baseScore: number;
  overlapBonus: number;
  diversityBonus: number;
  costPenalty: number;
  finalScore: number;
  rationale: string[];
  cartProposal?: CartProposal;
}

export interface DiscountInfo {
  productId: string;
  productName: string;
  discountPercent?: number;
  discountedPrice?: number;
  basePrice?: number;
  validUntil?: string;
}

export interface PurchaseHistorySignal {
  productId: string;
  productName?: string;
  purchaseCount: number;
  lastPurchasedAt?: string;
}

export interface GrocerProduct {
  id: string;
  name: string;
  price?: number;
  discountedPrice?: number;
  unit?: string;
  packageSize?: number;
  currency?: string;
  tags?: string[];
  isDiscounted?: boolean;
  raw?: unknown;
}

export interface ProductSearchResult {
  query: string;
  products: GrocerProduct[];
}

export interface MatchedCartLine {
  ingredientName: string;
  normalizedIngredientName: string;
  requestedQuantity?: number | null;
  requestedUnit?: string | null;
  matched: boolean;
  productId?: string;
  productName?: string;
  quantityToAdd?: number;
  unit?: string;
  estimatedPrice?: number;
  discountedPrice?: number;
  matchConfidence?: number;
  notes?: string[];
  sourceRecipeIds: string[];
}

export interface CartLine {
  productId?: string;
  productName?: string;
  ingredientName: string;
  quantity?: number;
  unit?: string;
  estimatedPrice?: number;
  discountedPrice?: number;
  matched: boolean;
  notes?: string[];
}

export interface CartProposal {
  cartLines: CartLine[];
  matchedLines: MatchedCartLine[];
  estimatedTotal: number;
  discountedTotal: number;
  estimatedSavings: number;
  unmatchedIngredients: string[];
  substitutions: string[];
  grocerNotes: string[];
}

export interface ProposalRecord {
  id: string;
  createdAt: string;
  status: 'proposed' | 'approved' | 'rejected' | 'failed';
  periodStart: string;
  periodEnd: string;
  candidate: MealCombinationCandidate;
  messageText: string;
  telegramMessageId?: number;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface ApprovalActionResult {
  proposalId: string;
  status: ProposalRecord['status'];
  message: string;
}

export interface RecipeSource {
  listRecipes(): Promise<Recipe[]>;
}

export interface GrocerClientCapabilities {
  toolNames: string[];
  productSearch: boolean;
  discounts: boolean;
  cartRead: boolean;
  cartMutate: boolean;
  ordersHistory: boolean;
}

export interface GrocerClient {
  getCapabilities(): Promise<GrocerClientCapabilities>;
  searchProducts(query: string): Promise<ProductSearchResult>;
  getDiscounts(): Promise<DiscountInfo[]>;
  getPurchaseHistory(): Promise<Record<string, PurchaseHistorySignal>>;
  getCart(): Promise<unknown>;
  setCart(lines: MatchedCartLine[]): Promise<unknown>;
}

export interface Notifier {
  sendProposal(proposal: ProposalRecord): Promise<{ messageId?: number }>;
  sendStatus(message: string): Promise<void>;
  updateProposalMessage?(proposal: ProposalRecord): Promise<void>;
}

export interface HistoryStore {
  initialize(): Promise<void>;
  getRecentMeals(days?: number): Promise<MealHistoryEntry[]>;
  saveProposal(proposal: ProposalRecord): Promise<void>;
  getProposal(proposalId: string): Promise<ProposalRecord | null>;
  setProposalTelegramMessageId(proposalId: string, messageId: number): Promise<void>;
  markApproved(proposalId: string): Promise<void>;
  markRejected(proposalId: string): Promise<void>;
}

export interface NotionFieldMap {
  title: string;
  ingredients_text?: string;
  rating: string;
  total_minutes: string;
  enabled?: string;
  season_tags?: string;
  category?: string;
  servings?: string;
  instructions_url?: string;
  last_cooked?: string;
}

export interface StaticConfig {
  notionFieldMap: NotionFieldMap;
  ingredientSynonyms: Record<string, string>;
  seasonalityByMonth: Record<string, string[]>;
  productOverrides: Record<
    string,
    {
      preferredQuery?: string;
      preferredProductIds?: string[];
    }
  >;
}
