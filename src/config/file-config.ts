import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { StaticConfig } from '../types.js';

const NotionFieldMapSchema = z.object({
  title: z.string(),
  ingredients_text: z.string(),
  rating: z.string(),
  total_minutes: z.string(),
  enabled: z.string().optional(),
  season_tags: z.string().optional(),
  category: z.string().optional(),
  servings: z.string().optional(),
  instructions_url: z.string().optional(),
  last_cooked: z.string().optional()
});

const ProductOverridesSchema = z.record(
  z.object({
    preferredQuery: z.string().optional(),
    preferredProductIds: z.array(z.string()).optional()
  })
);

export function loadStaticConfig(baseDir = process.cwd()): StaticConfig {
  const configDir = join(baseDir, 'config');
  const notionFieldMap = NotionFieldMapSchema.parse(
    JSON.parse(readFileSync(join(configDir, 'notion-field-map.json'), 'utf8'))
  );
  const ingredientSynonyms = z.record(z.string()).parse(
    JSON.parse(readFileSync(join(configDir, 'ingredient-synonyms.hu.json'), 'utf8'))
  );
  const seasonalityByMonth = z.record(z.array(z.string())).parse(
    JSON.parse(readFileSync(join(configDir, 'seasonality.hu.json'), 'utf8'))
  );
  const productOverrides = ProductOverridesSchema.parse(
    JSON.parse(readFileSync(join(configDir, 'product-overrides.json'), 'utf8'))
  );

  return { notionFieldMap, ingredientSynonyms, seasonalityByMonth, productOverrides };
}
