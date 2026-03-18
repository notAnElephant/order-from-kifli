import { describe, expect, it } from 'vitest';
import { formatProposalMessage } from '../src/notify/formatters.js';
import type { ProposalRecord } from '../src/types.js';

describe('formatProposalMessage', () => {
  it('renders unmatched ingredients and substitutions on separate lines', () => {
    const proposal: ProposalRecord = {
      id: 'proposal_1',
      createdAt: '2026-03-11T21:00:00Z',
      status: 'proposed',
      periodStart: '2026-03-10',
      periodEnd: '2026-03-16',
      messageText: '',
      candidate: {
        recipeCount: 2,
        recipes: [
          {
            recipe: {
              id: 'r1',
              name: 'Paprikas Csirke',
              ingredientsText: '',
              ingredients: [],
              pantryIngredients: [
                {
                  originalLine: 'só',
                  quantity: null,
                  unit: null,
                  name: 'só',
                  normalizedName: 'so',
                  parseWarnings: []
                }
              ],
              rating: 5,
              totalMinutes: 45,
              enabled: true
            },
            breakdown: {
              total: 1.2,
              seasonalityScore: 0,
              ratingScore: 0,
              timeScore: 0,
              availabilityScore: 0,
              discountScore: 0,
              repetitionPenalty: 0,
              ingredientRepetitionPenalty: 0,
              notes: []
            }
          },
          {
            recipe: {
              id: 'r2',
              name: 'Tofus Teszta',
              ingredientsText: '',
              ingredients: [],
              pantryIngredients: [
                {
                  originalLine: 'bors',
                  quantity: null,
                  unit: null,
                  name: 'bors',
                  normalizedName: 'bors',
                  parseWarnings: []
                },
                {
                  originalLine: 'só',
                  quantity: null,
                  unit: null,
                  name: 'só',
                  normalizedName: 'so',
                  parseWarnings: []
                }
              ],
              rating: 4,
              totalMinutes: 25,
              enabled: true
            },
            breakdown: {
              total: 1,
              seasonalityScore: 0,
              ratingScore: 0,
              timeScore: 0,
              availabilityScore: 0,
              discountScore: 0,
              repetitionPenalty: 0,
              ingredientRepetitionPenalty: 0,
              notes: []
            }
          }
        ],
        recipeIds: ['r1', 'r2'],
        combinedMinutes: 70,
        baseScore: 2.2,
        overlapBonus: 0,
        diversityBonus: 0,
        costPenalty: 0,
        finalScore: 2.2,
        rationale: [],
        cartProposal: {
          cartLines: [],
          matchedLines: [],
          estimatedTotal: 6000,
          discountedTotal: 5200,
          estimatedSavings: 800,
          unmatchedIngredients: ['500g csirkemellfilé', 'nagy Mozzarella'],
          substitutions: ['tofu -> Pappudia Tofu'],
          grocerNotes: ['Low-confidence match for tejszín']
        }
      }
    };

    const message = formatProposalMessage(proposal);

    expect(message).toContain('🏠 Make sure you have these at home:\n- só\n- bors');
    expect(message).toContain('⚠️ Unmatched ingredients:\n- 500g csirkemellfilé\n- nagy Mozzarella');
    expect(message).toContain('⚠️ Matching notes:\n- Low-confidence match for tejszín');
    expect(message).toContain('🔁 Suggested substitutions:\n- tofu -> Pappudia Tofu');
  });
});
