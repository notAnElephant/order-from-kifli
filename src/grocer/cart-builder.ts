import type { CartLine, CartProposal, MatchedCartLine } from '../types.js';

function toCartLine(line: MatchedCartLine): CartLine {
  return {
    productId: line.productId,
    productName: line.productName,
    ingredientName: line.ingredientName,
    quantity: line.quantityToAdd,
    unit: line.unit,
    estimatedPrice: line.estimatedPrice,
    discountedPrice: line.discountedPrice,
    matched: line.matched,
    notes: line.notes
  };
}

export function aggregateMatchedLines(lines: MatchedCartLine[]): MatchedCartLine[] {
  const byKey = new Map<string, MatchedCartLine>();

  for (const line of lines) {
    const key = line.productId ? `product:${line.productId}` : `ingredient:${line.normalizedIngredientName}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...line, sourceRecipeIds: [...line.sourceRecipeIds] });
      continue;
    }

    existing.quantityToAdd = (existing.quantityToAdd ?? 0) + (line.quantityToAdd ?? 0);
    existing.sourceRecipeIds = [...new Set([...existing.sourceRecipeIds, ...line.sourceRecipeIds])];
    existing.notes = [...new Set([...(existing.notes ?? []), ...(line.notes ?? [])])];
  }

  return [...byKey.values()];
}

export function buildCartProposal(input: {
  matchedLines: MatchedCartLine[];
  notes?: string[];
}): CartProposal {
  const aggregated = aggregateMatchedLines(input.matchedLines);
  const cartLines = aggregated.map(toCartLine);

  const estimatedTotal = cartLines.reduce((sum, line) => sum + (line.estimatedPrice ?? line.discountedPrice ?? 0), 0);
  const discountedTotal = cartLines.reduce(
    (sum, line) => sum + (line.discountedPrice ?? line.estimatedPrice ?? 0),
    0
  );
  const estimatedSavings = Math.max(0, estimatedTotal - discountedTotal);
  const unmatchedIngredients = aggregated.filter((l) => !l.matched).map((l) => l.ingredientName);
  const substitutions = aggregated
    .filter((l) => l.matched && l.productName && l.productName.toLowerCase() !== l.ingredientName.toLowerCase())
    .map((l) => `${l.ingredientName} -> ${l.productName}`);

  return {
    cartLines,
    matchedLines: aggregated,
    estimatedTotal,
    discountedTotal,
    estimatedSavings,
    unmatchedIngredients,
    substitutions,
    grocerNotes: input.notes ?? []
  };
}
