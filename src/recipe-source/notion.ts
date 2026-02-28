import { Client as NotionClient } from '@notionhq/client';
import type { NotionFieldMap, Recipe, RecipeSource, StaticConfig } from '../types.js';
import { parseIngredientText } from '../parsing/ingredient-parser.js';
import { normalizeText, safeNumber } from '../utils/normalize.js';

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

function richTextToPlainText(items: any[] | undefined): string {
  return (items ?? []).map((p: any) => p?.plain_text ?? '').join('');
}

function blockText(block: any): string {
  if (!block || !block.type) return '';
  const payload = block[block.type];
  if (!payload) return '';
  return richTextToPlainText(payload.rich_text).trim();
}

function isHeadingBlock(block: any): boolean {
  return ['heading_1', 'heading_2', 'heading_3'].includes(block?.type);
}

function parseRatingValue(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const stars = (trimmed.match(/★/g) ?? []).length;
  if (stars > 0) return stars;
  return safeNumber(trimmed, 0);
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

  private async listChildBlocks(blockId: string): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | undefined;

    do {
      const response: any = await this.notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      });
      all.push(...(response.results ?? []));
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return all;
  }

  private async extractIngredientsFromPageBody(pageId: string): Promise<string> {
    const topLevelBlocks = await this.listChildBlocks(pageId);
    const lines: string[] = [];
    let inIngredientsSection = false;

    for (const block of topLevelBlocks) {
      const text = blockText(block);
      const normalized = normalizeText(text);

      if (isHeadingBlock(block)) {
        if (normalized === 'hozzavalok' || normalized === 'ingredients') {
          inIngredientsSection = true;
          continue;
        }
        if (inIngredientsSection) {
          break;
        }
      }

      if (!inIngredientsSection) continue;

      if (['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do'].includes(block.type) && text) {
        lines.push(text);
      }

      if (block.has_children) {
        const children = await this.listChildBlocks(block.id);
        for (const child of children) {
          const childText = blockText(child);
          if (childText) lines.push(childText);
        }
      }
    }

    return lines.join('\n').trim();
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
        if (!name) continue;

        let ingredientsText = this.fields.ingredients_text
          ? propertyValueToText(props[this.fields.ingredients_text])
          : '';
        if (!ingredientsText) {
          ingredientsText = await this.extractIngredientsFromPageBody(row.id);
        }
        if (!ingredientsText) continue;

        const recipe: Recipe = {
          id: row.id,
          name,
          ingredientsText,
          ingredients: parseIngredientText(ingredientsText, {
            synonyms: this.staticConfig.ingredientSynonyms
          }),
          rating: parseRatingValue(propertyValueToText(props[this.fields.rating])),
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
