import type { ProposalRecord } from '../types.js';

function fmtMoney(value: number): string {
  return `${Math.round(value)} Ft`;
}

export function formatProposalMessage(proposal: ProposalRecord): string {
  const candidate = proposal.candidate;
  const cart = candidate.cartProposal;
  const checkoutUrl = 'https://www.kifli.hu/rendeles/kosaram-tartalma';
  const recipeLines = candidate.recipes
    .map(
      (r, i) =>
        `${i + 1}. ${r.recipe.name} (${r.recipe.totalMinutes} min, score ${r.breakdown.total.toFixed(2)})`
    )
    .join('\n');

  const unmatchedLines = cart?.unmatchedIngredients ?? [];
  const substitutionLines = cart?.substitutions ?? [];
  const warningLines = cart?.grocerNotes ?? [];

  return [
    `🛒 Weekly Kifli proposal (${proposal.periodStart} → ${proposal.periodEnd})`,
    '',
    'Recipes:',
    recipeLines,
    '',
    cart
      ? `Cart total: ${fmtMoney(cart.discountedTotal)} (savings ~${fmtMoney(cart.estimatedSavings)})`
      : 'Cart: not built',
    `Checkout: ${checkoutUrl}`,
    '',
    'Actions: Approve / Reject / Rebuild / Swap recipe',
    ...(unmatchedLines.length ? ['', '⚠️ Unmatched ingredients:', ...unmatchedLines.map((w) => `- ${w}`)] : []),
    ...(warningLines.length ? ['', '⚠️ Matching notes:', ...warningLines.map((w) => `- ${w}`)] : []),
    ...(substitutionLines.length ? ['', '🔁 Suggested substitutions:', ...substitutionLines.map((w) => `- ${w}`)] : [])
  ].join('\n');
}
