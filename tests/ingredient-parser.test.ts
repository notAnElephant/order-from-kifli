import { describe, expect, it } from 'vitest';
import { parseIngredientLine, parseIngredientText } from '../src/parsing/ingredient-parser.js';

describe('ingredient parser', () => {
  it('parses quantity, unit and normalized Hungarian name', () => {
    const parsed = parseIngredientLine('500 g csirkemellfilé', {
      synonyms: { csirkemellfile: 'csirkemell' }
    });

    expect(parsed.quantity).toBe(500);
    expect(parsed.unit).toBe('g');
    expect(parsed.normalizedName).toBe('csirkemell');
  });

  it('parses multiple lines and keeps unknown units as ingredient text', () => {
    const parsed = parseIngredientText('1 csomag rizs\n2 marék spenót');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.unit).toBe('csomag');
    expect(parsed[1]?.name).toContain('marek');
  });
});
