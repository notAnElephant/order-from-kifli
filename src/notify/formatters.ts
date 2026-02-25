import type { ProposalRecord } from '../types.js';

function fmtMoney(value: number): string {
  return `${Math.round(value)} Ft`;
}

export function formatProposalMessage(proposal: ProposalRecord): string {
  const candidate = proposal.candidate;
  const cart = candidate.cartProposal;
  const recipeLines = candidate.recipes
    .map(
      (r, i) =>
        `${i + 1}. ${r.recipe.name} (${r.recipe.totalMinutes} min, score ${r.breakdown.total.toFixed(2)})`
    )
    .join('\n');

  const slot = cart?.selectedSlot
    ? `${cart.selectedSlot.label}${cart.selectedSlot.fee != null ? ` (fee: ${fmtMoney(cart.selectedSlot.fee)})` : ''}`
    : 'No slot available';

  const warnings = [
    ...(cart?.unmatchedIngredients.length ? [`Unmatched: ${cart.unmatchedIngredients.join(', ')}`] : []),
    ...(cart?.substitutions.length ? [`Substitutions: ${cart.substitutions.slice(0, 5).join('; ')}`] : []),
    ...(cart?.grocerNotes ?? [])
  ];

  return [
    `🛒 Weekly Kifli proposal (${proposal.periodStart} → ${proposal.periodEnd})`,
    '',
    'Recipes:',
    recipeLines,
    '',
    cart
      ? `Cart total: ${fmtMoney(cart.discountedTotal)} (savings ~${fmtMoney(cart.estimatedSavings)})`
      : 'Cart: not built',
    `Delivery slot: ${slot}`,
    '',
    'Actions: Approve / Reject / Rebuild / Next slot',
    ...(warnings.length ? ['', 'Warnings:', ...warnings.map((w) => `- ${w}`)] : [])
  ].join('\n');
}
