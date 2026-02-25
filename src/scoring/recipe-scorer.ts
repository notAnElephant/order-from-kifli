import { DateTime } from 'luxon';
import type {
  IngredientMarketSignal,
  MealHistoryEntry,
  Recipe,
  RecipeScoreBreakdown,
  RecipeScoreContext,
  ScoredRecipe
} from '../types.js';
import { normalizeText } from '../utils/normalize.js';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function monthKey(dt: DateTime): string {
  const keys = [
    'januar',
    'februar',
    'marcius',
    'aprilis',
    'majus',
    'junius',
    'julius',
    'augusztus',
    'szeptember',
    'oktober',
    'november',
    'december'
  ];
  return keys[dt.month - 1] ?? 'januar';
}

function dominantIngredients(recipe: Recipe): string[] {
  return recipe.ingredients
    .map((i) => i.normalizedName)
    .filter(Boolean)
    .slice(0, 5);
}

function countRecentRecipeRepeats(recipe: Recipe, recent: MealHistoryEntry[]): number {
  return recent.filter((m) => m.recipeId === recipe.id || normalizeText(m.recipeName) === normalizeText(recipe.name)).length;
}

function countIngredientRepeats(recipe: Recipe, recent: MealHistoryEntry[]): number {
  const recipeIngredients = new Set(dominantIngredients(recipe));
  let overlaps = 0;
  for (const meal of recent) {
    for (const ing of meal.dominantIngredients) {
      if (recipeIngredients.has(normalizeText(ing))) {
        overlaps += 1;
      }
    }
  }
  return overlaps;
}

function computeSeasonality(recipe: Recipe, currentMonthIngredients: string[]): number {
  const seasonalSet = new Set(currentMonthIngredients.map(normalizeText));
  const ingredients = recipe.ingredients.map((i) => i.normalizedName).filter(Boolean);
  if (ingredients.length === 0) return 0.4;

  const ingredientMatches = ingredients.filter((ing) => seasonalSet.has(ing)).length;
  const ingredientScore = ingredientMatches / ingredients.length;

  const tagScore = recipe.seasonTags?.length
    ? recipe.seasonTags.some((tag) => seasonalSet.has(normalizeText(tag)))
      ? 1
      : 0.3
    : 0.5;

  return clamp01(ingredientScore * 0.7 + tagScore * 0.3);
}

function computeRating(recipe: Recipe): number {
  return clamp01(recipe.rating / 5);
}

function computeTime(recipe: Recipe, weeklyTargetTotalMinutes: number): number {
  const idealPerRecipe = Math.max(30, weeklyTargetTotalMinutes / 3);
  if (recipe.totalMinutes <= idealPerRecipe) return 1;
  const penalty = (recipe.totalMinutes - idealPerRecipe) / Math.max(idealPerRecipe, 1);
  return clamp01(1 - penalty);
}

function computeMarketScores(recipe: Recipe, signals?: Record<string, IngredientMarketSignal>) {
  if (!signals) {
    return { availabilityScore: 0.5, discountScore: 0.5, notes: ['market-signals-unavailable'] };
  }

  const relevant = recipe.ingredients
    .map((ing) => signals[ing.normalizedName])
    .filter((signal): signal is IngredientMarketSignal => Boolean(signal));

  if (relevant.length === 0) {
    return { availabilityScore: 0.5, discountScore: 0.4, notes: ['no-market-signal-match'] };
  }

  const availabilityScore = relevant.filter((r) => r.available).length / relevant.length;
  const discountRatios = relevant.map((r) => r.discountRatio ?? 0);
  const discountScore = clamp01(discountRatios.reduce((a, b) => a + b, 0) / Math.max(discountRatios.length, 1));
  return { availabilityScore, discountScore, notes: [] as string[] };
}

export function scoreRecipe(recipe: Recipe, context: RecipeScoreContext): ScoredRecipe {
  const dt = context.nowIso
    ? DateTime.fromISO(context.nowIso, { zone: context.timezone })
    : DateTime.now().setZone(context.timezone);
  const currentMonthIngredients = context.seasonalityByMonth[monthKey(dt)] ?? [];

  const seasonalityScore = computeSeasonality(recipe, currentMonthIngredients);
  const ratingScore = computeRating(recipe);
  const timeScore = computeTime(recipe, context.weeklyTargetTotalMinutes);
  const recipeRepeats = countRecentRecipeRepeats(recipe, context.recentMeals);
  const ingredientRepeats = countIngredientRepeats(recipe, context.recentMeals);
  const repetitionPenalty = Math.min(0.7, recipeRepeats * 0.35);
  const ingredientRepetitionPenalty = Math.min(0.5, ingredientRepeats * 0.05);
  const market = computeMarketScores(recipe, context.ingredientSignals);

  const total =
    seasonalityScore * 0.25 +
    ratingScore * 0.25 +
    timeScore * 0.2 +
    market.availabilityScore * 0.15 +
    market.discountScore * 0.15 -
    repetitionPenalty -
    ingredientRepetitionPenalty;

  const breakdown: RecipeScoreBreakdown = {
    total,
    seasonalityScore,
    ratingScore,
    timeScore,
    availabilityScore: market.availabilityScore,
    discountScore: market.discountScore,
    repetitionPenalty,
    ingredientRepetitionPenalty,
    notes: [...market.notes]
  };

  return { recipe, breakdown };
}

export function rankRecipes(recipes: Recipe[], context: RecipeScoreContext): ScoredRecipe[] {
  return recipes
    .filter((r) => r.enabled)
    .map((recipe) => scoreRecipe(recipe, context))
    .sort((a, b) => b.breakdown.total - a.breakdown.total);
}
