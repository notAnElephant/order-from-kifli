import { describe, expect, it } from 'vitest';
import { findMealCombinationCandidates, rerankCandidatesWithCartSignals } from '../src/planning/meal-combination-search.js';
import type { MealCombinationCandidate, ScoredRecipe } from '../src/types.js';

function scored(id: string, name: string, minutes: number, total: number, category: string, ingredients: string[]): ScoredRecipe {
  return {
    recipe: {
      id,
      name,
      ingredientsText: '',
      ingredients: ingredients.map((normalizedName) => ({
        originalLine: normalizedName,
        quantity: 1,
        unit: 'db',
        name: normalizedName,
        normalizedName,
        parseWarnings: []
      })),
      rating: 4,
      totalMinutes: minutes,
      enabled: true,
      category
    },
    breakdown: {
      total,
      seasonalityScore: 0.5,
      ratingScore: 0.8,
      timeScore: 0.7,
      availabilityScore: 0.5,
      discountScore: 0.3,
      repetitionPenalty: 0,
      ingredientRepetitionPenalty: 0,
      notes: []
    }
  };
}

describe('meal combination search', () => {
  it('falls back to 2 recipes when the top 3 are too time-consuming', () => {
    const results = findMealCombinationCandidates(
      [
        scored('a', 'A', 120, 1, 'main', ['csirke']),
        scored('b', 'B', 110, 0.95, 'main', ['rizs']),
        scored('c', 'C', 100, 0.9, 'soup', ['zoldseg']),
        scored('d', 'D', 35, 0.8, 'salad', ['salata'])
      ],
      { defaultRecipeCount: 3, weeklyTargetTotalMinutes: 180 }
    );

    expect(results[0]?.recipeCount).toBe(2);
  });

  it('reranks candidates using cart savings and availability', () => {
    const c1: MealCombinationCandidate = {
      recipeCount: 2,
      recipes: [],
      recipeIds: ['a', 'b'],
      combinedMinutes: 90,
      baseScore: 1.8,
      overlapBonus: 0,
      diversityBonus: 0,
      costPenalty: 0,
      finalScore: 1.8,
      rationale: [],
      cartProposal: {
        cartLines: [],
        matchedLines: [],
        estimatedTotal: 10000,
        discountedTotal: 7000,
        estimatedSavings: 3000,
        unmatchedIngredients: [],
        substitutions: [],
        grocerNotes: []
      }
    };
    const c2: MealCombinationCandidate = {
      ...c1,
      recipeIds: ['c', 'd'],
      finalScore: 1.85,
      cartProposal: {
        ...c1.cartProposal!,
        estimatedSavings: 0,
        discountedTotal: 8000,
        unmatchedIngredients: ['paprika', 'rizs']
      }
    };

    const ranked = rerankCandidatesWithCartSignals([c2, c1]);
    expect(ranked[0]?.recipeIds).toEqual(['a', 'b']);
  });
});
