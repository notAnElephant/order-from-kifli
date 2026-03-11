import type { ParsedIngredient } from '../types.js';
import { normalizeText } from '../utils/normalize.js';

const UNIT_ALIASES: Record<string, string> = {
  g: 'g',
  gram: 'g',
  gramm: 'g',
  kg: 'kg',
  dkg: 'dkg',
  ml: 'ml',
  cl: 'cl',
  dl: 'dl',
  l: 'l',
  evokanal: 'ek',
  ek: 'ek',
  teaskanal: 'tk',
  tk: 'tk',
  db: 'db',
  gerezd: 'gerezd',
  csipet: 'csipet',
  csomag: 'csomag'
};

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '¼': 0.25,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3
};

function parseQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (VULGAR_FRACTIONS[trimmed] !== undefined) return VULGAR_FRACTIONS[trimmed];
  if (/^\d+[.,]\d+$/.test(trimmed)) return Number(trimmed.replace(',', '.'));
  if (/^\d+\/\d+$/.test(trimmed)) {
    const [a, b] = trimmed.split('/').map(Number);
    return b ? (a ?? 1) / b : null;
  }
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return null;
}

function splitLine(line: string): { quantity: number | null; unit: string | null; name: string; warnings: string[] } {
  const warnings: string[] = [];
  const original = line.trim().replace(/\s+/g, ' ');
  const normalized = normalizeText(line);
  if (!normalized) {
    return { quantity: null, unit: null, name: '', warnings: ['empty-line'] };
  }

  const parts = normalized.split(' ');
  const originalParts = original.split(' ');
  let cursor = 0;
  let quantity: number | null = null;
  let unit: string | null = null;

  const maybeQuantity = parts[cursor];
  if (maybeQuantity) {
    const parsedQuantity = parseQuantity(maybeQuantity);
    if (parsedQuantity !== null) {
      quantity = parsedQuantity;
      cursor += 1;
    }
  }

  const maybeUnit = parts[cursor];
  if (maybeUnit) {
    const mappedUnit = UNIT_ALIASES[maybeUnit];
    if (mappedUnit) {
      unit = mappedUnit;
      cursor += 1;
    }
  }

  const name = originalParts.slice(cursor).join(' ').trim();
  if (!name) {
    warnings.push('missing-ingredient-name');
  }

  return { quantity, unit, name, warnings };
}

export interface IngredientParserOptions {
  synonyms?: Record<string, string>;
}

export function parseIngredientLine(line: string, options: IngredientParserOptions = {}): ParsedIngredient {
  const { quantity, unit, name, warnings } = splitLine(line);
  const normalizedName = normalizeText(name || line);
  const synonymTarget = options.synonyms?.[normalizedName];
  return {
    originalLine: line,
    quantity,
    unit,
    name: name || line.trim(),
    normalizedName: synonymTarget ? normalizeText(synonymTarget) : normalizedName,
    parseWarnings: warnings
  };
}

export function parseIngredientText(text: string, options: IngredientParserOptions = {}): ParsedIngredient[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseIngredientLine(line, options));
}
