import type { DiscountInfo, GrocerProduct, MatchedCartLine, ParsedIngredient } from '../types.js';
import { normalizeText } from '../utils/normalize.js';

export interface ProductMatcherOptions {
  productOverrides?: Record<string, { preferredQuery?: string; preferredProductIds?: string[] }>;
  discountsByProductId?: Record<string, DiscountInfo>;
}

function scoreProductMatch(ingredient: ParsedIngredient, product: GrocerProduct, options: ProductMatcherOptions): number {
  const ingredientName = normalizeText(ingredient.normalizedName);
  const productName = normalizeText(product.name);
  let score = 0;

  if (productName.includes(ingredientName)) score += 0.6;
  if (ingredientName.split(' ').some((token) => token && productName.includes(token))) score += 0.2;

  const override = options.productOverrides?.[ingredientName];
  if (override?.preferredProductIds?.includes(product.id)) score += 0.35;

  if (product.isDiscounted || product.discountedPrice != null) score += 0.1;
  if (product.tags?.some((t) => normalizeText(t).includes('bio'))) score += 0.02;

  return Math.min(1, score);
}

export function matchIngredientToProduct(
  ingredient: ParsedIngredient,
  products: GrocerProduct[],
  recipeId: string,
  options: ProductMatcherOptions = {}
): MatchedCartLine {
  const scored = products
    .map((product) => ({ product, score: scoreProductMatch(ingredient, product, options) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.45) {
    return {
      ingredientName: ingredient.name,
      normalizedIngredientName: ingredient.normalizedName,
      requestedQuantity: ingredient.quantity,
      requestedUnit: ingredient.unit,
      matched: false,
      notes: ['No confident product match found'],
      sourceRecipeIds: [recipeId]
    };
  }

  return {
    ingredientName: ingredient.name,
    normalizedIngredientName: ingredient.normalizedName,
    requestedQuantity: ingredient.quantity,
    requestedUnit: ingredient.unit,
    matched: true,
    productId: best.product.id,
    productName: best.product.name,
    quantityToAdd: 1,
    unit: best.product.unit,
    estimatedPrice: best.product.price,
    discountedPrice: best.product.discountedPrice,
    matchConfidence: best.score,
    notes: best.product.isDiscounted ? ['discounted'] : undefined,
    sourceRecipeIds: [recipeId]
  };
}

export function buildDiscountIndex(discounts: DiscountInfo[]): Record<string, DiscountInfo> {
  return Object.fromEntries(discounts.map((d) => [d.productId, d]));
}
