import type {
  DiscountInfo,
  GrocerProduct,
  MatchedCartLine,
  ParsedIngredient,
  PurchaseHistorySignal
} from '../types.js';
import { normalizeText } from '../utils/normalize.js';

export interface ProductMatcherOptions {
  productOverrides?: Record<string, { preferredQuery?: string; preferredProductIds?: string[] }>;
  discountsByProductId?: Record<string, DiscountInfo>;
  purchaseHistoryByProductId?: Record<string, PurchaseHistorySignal>;
}

type ProductMatchScore = {
  total: number;
  reasons: string[];
};

type ParsedPackage = {
  amount: number;
  unit: string;
};

function parsePackage(unitText?: string): ParsedPackage | null {
  if (!unitText) return null;
  const normalized = normalizeText(unitText);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|db|csomag|dl|cl|dkg)\b/);
  if (!match) return null;
  const rawAmount = match[1];
  const unit = match[2];
  if (!rawAmount || !unit) return null;
  const amount = Number(rawAmount.replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return { amount, unit };
}

function normalizeUnit(unit: string): { amountMultiplier: number; unit: string } {
  switch (unit) {
    case 'kg':
      return { amountMultiplier: 1000, unit: 'g' };
    case 'dkg':
      return { amountMultiplier: 10, unit: 'g' };
    case 'l':
      return { amountMultiplier: 1000, unit: 'ml' };
    case 'dl':
      return { amountMultiplier: 100, unit: 'ml' };
    case 'cl':
      return { amountMultiplier: 10, unit: 'ml' };
    default:
      return { amountMultiplier: 1, unit };
  }
}

function compareRequestedToPackage(ingredient: ParsedIngredient, product: GrocerProduct): number {
  if (!ingredient.quantity || !ingredient.unit) return 0;
  const parsed = parsePackage(product.unit);
  if (!parsed) return 0;

  const requested = normalizeUnit(ingredient.unit);
  const packaged = normalizeUnit(parsed.unit);
  if (requested.unit !== packaged.unit) return 0;

  const requestedAmount = ingredient.quantity * requested.amountMultiplier;
  const packagedAmount = parsed.amount * packaged.amountMultiplier;
  if (!requestedAmount || !packagedAmount) return 0;

  const ratio = packagedAmount / requestedAmount;
  if (ratio >= 0.85 && ratio <= 1.4) return 0.14;
  if (ratio >= 0.5 && ratio <= 2.5) return 0.08;
  return 0.03;
}

function scoreProductMatch(ingredient: ParsedIngredient, product: GrocerProduct, options: ProductMatcherOptions): ProductMatchScore {
  const ingredientName = normalizeText(ingredient.normalizedName);
  const productName = normalizeText(product.name);
  const ingredientTokens = ingredientName.split(' ').filter(Boolean);
  const reasons: string[] = [];
  let score = 0;

  if (productName.includes(ingredientName)) {
    score += 0.45;
    reasons.push('full-name');
  }
  const matchedTokens = ingredientTokens.filter((token) => productName.includes(token));
  if (matchedTokens.length > 0) {
    score += Math.min(0.28, (matchedTokens.length / Math.max(ingredientTokens.length, 1)) * 0.28);
    reasons.push(`tokens:${matchedTokens.length}/${ingredientTokens.length}`);
  }

  const override = options.productOverrides?.[ingredientName];
  if (override?.preferredProductIds?.includes(product.id)) {
    score += 0.35;
    reasons.push('override');
  }

  const purchaseSignal = options.purchaseHistoryByProductId?.[product.id];
  if (purchaseSignal) {
    score += Math.min(0.2, 0.06 * purchaseSignal.purchaseCount);
    reasons.push(`history:${purchaseSignal.purchaseCount}`);
  }

  const sizeFit = compareRequestedToPackage(ingredient, product);
  if (sizeFit > 0) {
    score += sizeFit;
    reasons.push('size-fit');
  }

  if (product.isDiscounted || product.discountedPrice != null) {
    score += 0.08;
    reasons.push('discount');
  }

  return { total: Math.min(1, score), reasons };
}

function effectivePrice(product: GrocerProduct): number {
  return product.discountedPrice ?? product.price ?? Number.POSITIVE_INFINITY;
}

export function matchIngredientToProduct(
  ingredient: ParsedIngredient,
  products: GrocerProduct[],
  recipeId: string,
  options: ProductMatcherOptions = {}
): MatchedCartLine {
  const scored = products
    .map((product) => ({ product, score: scoreProductMatch(ingredient, product, options) }))
    .sort((a, b) => {
      const byScore = b.score.total - a.score.total;
      if (byScore !== 0) return byScore;
      return effectivePrice(a.product) - effectivePrice(b.product);
    });

  const best = scored[0];
  if (!best || best.score.total < 0.45) {
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
    matchConfidence: best.score.total,
    notes: best.score.reasons,
    sourceRecipeIds: [recipeId]
  };
}

export function buildDiscountIndex(discounts: DiscountInfo[]): Record<string, DiscountInfo> {
  return Object.fromEntries(discounts.map((d) => [d.productId, d]));
}
