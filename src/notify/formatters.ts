import type { ProposalRecord } from '../types.js';

function fmtMoney(value: number): string {
  return `${Math.round(value)} Ft`;
}

function collectPantryLines(proposal: ProposalRecord): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const scored of proposal.candidate.recipes) {
    for (const ingredient of scored.recipe.pantryIngredients) {
      const key = ingredient.normalizedName || ingredient.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(ingredient.originalLine.trim());
    }
  }

  return lines;
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
  const pantryLines = collectPantryLines(proposal);

  return [
    `🛒 Weekly Kifli proposal (${proposal.periodStart} → ${proposal.periodEnd})`,
    '',
    'Recipes:',
    recipeLines,
    ...(pantryLines.length ? ['', '🏠 Make sure you have these at home:', ...pantryLines.map((w) => `- ${w}`)] : []),
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
