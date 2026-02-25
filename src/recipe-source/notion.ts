import { Client as NotionClient } from '@notionhq/client';
import type { NotionFieldMap, Recipe, RecipeSource, StaticConfig } from '../types.js';
import { parseIngredientText } from '../parsing/ingredient-parser.js';
import { safeNumber } from '../utils/normalize.js';

function propertyValueToText(prop: any): string {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title ?? []).map((p: any) => p.plain_text).join('');
    case 'rich_text':
      return (prop.rich_text ?? []).map((p: any) => p.plain_text).join('');
    case 'number':
      return prop.number == null ? '' : String(prop.number);
    case 'checkbox':
      return prop.checkbox ? 'true' : 'false';
    case 'select':
      return prop.select?.name ?? '';
    case 'multi_select':
      return (prop.multi_select ?? []).map((p: any) => p.name).join(',');
    case 'url':
      return prop.url ?? '';
    case 'date':
      return prop.date?.start ?? '';
    default:
      return '';
  }
}

function propertyValueToStringArray(prop: any): string[] {
  if (!prop) return [];
  if (prop.type === 'multi_select') return (prop.multi_select ?? []).map((p: any) => p.name).filter(Boolean);
  const text = propertyValueToText(prop);
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function propertyValueToBoolean(prop: any, defaultValue = true): boolean {
  if (!prop) return defaultValue;
  if (prop.type === 'checkbox') return Boolean(prop.checkbox);
  const text = propertyValueToText(prop).toLowerCase().trim();
  if (!text) return defaultValue;
  return ['true', 'yes', '1', 'enabled', 'active'].includes(text);
}

export class NotionRecipeSource implements RecipeSource {
  private notion: NotionClient;
  private databaseId: string;
  private fields: NotionFieldMap;
  private staticConfig: StaticConfig;

  constructor(options: { notionToken: string; databaseId: string; staticConfig: StaticConfig }) {
    this.notion = new NotionClient({ auth: options.notionToken });
    this.databaseId = options.databaseId;
    this.fields = options.staticConfig.notionFieldMap;
    this.staticConfig = options.staticConfig;
  }

  async listRecipes(): Promise<Recipe[]> {
    const recipes: Recipe[] = [];
    let cursor: string | undefined;

    do {
      const response: any = await this.notion.databases.query({
        database_id: this.databaseId,
        start_cursor: cursor,
        page_size: 100
      });

      for (const row of response.results ?? []) {
        if (row.object !== 'page') continue;
        const props = row.properties ?? {};
        const name = propertyValueToText(props[this.fields.title]);
        const ingredientsText = propertyValueToText(props[this.fields.ingredients_text]);
        if (!name || !ingredientsText) continue;

        const recipe: Recipe = {
          id: row.id,
          name,
          ingredientsText,
          ingredients: parseIngredientText(ingredientsText, {
            synonyms: this.staticConfig.ingredientSynonyms
          }),
          rating: safeNumber(propertyValueToText(props[this.fields.rating]), 0),
          totalMinutes: safeNumber(propertyValueToText(props[this.fields.total_minutes]), 0),
          enabled: propertyValueToBoolean(this.fields.enabled ? props[this.fields.enabled] : undefined, true),
          seasonTags: this.fields.season_tags ? propertyValueToStringArray(props[this.fields.season_tags]) : undefined,
          category: this.fields.category ? propertyValueToText(props[this.fields.category]) || undefined : undefined,
          servings: this.fields.servings ? safeNumber(propertyValueToText(props[this.fields.servings]), 0) || undefined : undefined,
          instructionsUrl: this.fields.instructions_url
            ? propertyValueToText(props[this.fields.instructions_url]) || undefined
            : undefined,
          lastCooked: this.fields.last_cooked ? propertyValueToText(props[this.fields.last_cooked]) || undefined : undefined,
          source: 'notion'
        };

        recipes.push(recipe);
      }

      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return recipes;
  }
}
