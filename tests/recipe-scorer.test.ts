import { describe, expect, it } from 'vitest';
import { scoreRecipe } from '../src/scoring/recipe-scorer.js';
import type { Recipe } from '../src/types.js';

const recipe: Recipe = {
  id: 'r1',
  name: 'Paprikás csirke',
  ingredientsText: '500 g csirkemell\n2 db paprika',
  ingredients: [
    {
      originalLine: '500 g csirkemell',
      quantity: 500,
      unit: 'g',
      name: 'csirkemell',
      normalizedName: 'csirkemell',
      parseWarnings: []
    },
    {
      originalLine: '2 db paprika',
      quantity: 2,
      unit: 'db',
      name: 'paprika',
      normalizedName: 'paprika',
      parseWarnings: []
    }
  ],
  rating: 4.5,
  totalMinutes: 45,
  enabled: true,
  category: 'main'
};

describe('recipe scorer', () => {
  it('applies repetition penalties from recent meals', () => {
    const base = scoreRecipe(recipe, {
      timezone: 'Europe/Budapest',
      recentMeals: [],
      weeklyTargetTotalMinutes: 180,
      seasonalityByMonth: { julius: ['paprika'] },
      nowIso: '2026-07-15T10:00:00+02:00'
    });

    const repeated = scoreRecipe(recipe, {
      timezone: 'Europe/Budapest',
      recentMeals: [
        {
          proposalId: 'p1',
          plannedDate: '2026-07-10',
          recipeId: 'r1',
          recipeName: 'Paprikás csirke',
          dominantIngredients: ['paprika', 'csirkemell'],
          status: 'approved'
        }
      ],
      weeklyTargetTotalMinutes: 180,
      seasonalityByMonth: { julius: ['paprika'] },
      nowIso: '2026-07-15T10:00:00+02:00'
    });

    expect(repeated.breakdown.repetitionPenalty).toBeGreaterThan(0);
    expect(repeated.breakdown.total).toBeLessThan(base.breakdown.total);
  });
});
