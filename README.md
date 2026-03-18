# order-from-kifli

Local-first assistant that reads recipes from Notion, plans 2-3 weekly meals, builds a Kifli cart (via MCP), and sends an approval request on Telegram before you complete checkout manually in Kifli.

## Quick start

1. Copy `.env.example` to `.env` and fill credentials.
2. Update `config/notion-field-map.json` to match your `Receptek` database property names.
   - Ingredients stay in the same multiline field; optional pantry staples go under a `Kamra:` line and are excluded from shopping.
3. Install dependencies:
   - `pnpm install`
4. Run diagnostics:
   - `pnpm run sync-kifli-capabilities`
5. Start the bot (long polling):
   - `pnpm run bot`
6. Start scheduler worker (or run manually):
   - `pnpm run worker`
   - `pnpm run plan-now`

## Kifli MCP

This project launches the installed `@tomaspavlin/rohlik-mcp` package through `pnpm exec` and targets Kifli with `ROHLIK_BASE_URL=https://www.kifli.hu`. Credentials stay in `KIFLI_EMAIL` and `KIFLI_PASSWORD`; the app maps them to the server's `ROHLIK_USERNAME` and `ROHLIK_PASSWORD` env vars when starting the MCP process.

## Scoring

Recipe scoring is deterministic and implemented in [src/scoring/recipe-scorer.ts](/Users/oraisz/code/order-from-kifli/src/scoring/recipe-scorer.ts) with combination reranking in [src/planning/meal-combination-search.ts](/Users/oraisz/code/order-from-kifli/src/planning/meal-combination-search.ts).

Per recipe, the base score is:

```ts
total =
  seasonalityScore * 0.25 +
  ratingScore * 0.25 +
  timeScore * 0.2 +
  availabilityScore * 0.15 +
  discountScore * 0.15 -
  repetitionPenalty -
  ingredientRepetitionPenalty
```

Where:
- `seasonalityScore`: ingredient overlap with the current month's seasonal list, plus a small season-tag effect
- `ratingScore`: normalized rating (`rating / 5`)
- `timeScore`: favors recipes under the weekly time budget
- `availabilityScore`: ingredient market availability signal when available, otherwise neutral
- `discountScore`: ingredient discount signal when available, otherwise neutral
- `repetitionPenalty`: direct recent recipe repeats in the last 14 days
- `ingredientRepetitionPenalty`: overlap with recently used dominant ingredients

Combination scoring then:
- sums recipe scores
- adds an ingredient overlap bonus
- adds a small category diversity bonus
- subtracts a prep-time penalty if the weekly total is too high

After cart evaluation, candidates are reranked again using:
- actual cart savings
- unmatched ingredient penalties
- a small total-price penalty

## Product Matching

## Recipe Ingredient Format

The ingredient field in Notion is still a single multiline text block.

Use plain lines for items that should be added to the Kifli cart:

```text
500 g csirkemell
2 db paprika
1 csomag rizs
```

If a recipe also needs pantry staples that should not be bought, add them after a `Kamra:` marker:

```text
500 g csirkemell
2 db paprika
1 csomag rizs

Kamra:
só
bors
liszt
olívaolaj
```

Everything before `Kamra:` is treated as a shopping ingredient. Everything after it is treated as a pantry ingredient and will only show up as a reminder in the bot message.

Ingredient-to-product matching is deterministic and implemented in [src/grocer/product-matcher.ts](/Users/oraisz/code/order-from-kifli/src/grocer/product-matcher.ts).

Each candidate product gets its own score. The current model prefers:
- strong text match between ingredient name and product name
- token overlap when there is no exact phrase match
- manual product overrides from `config/product-overrides.json`
- previously purchased items from Kifli order history
- package size close to the requested ingredient quantity/unit
- discounted products as a small bonus

In practice, the product score works like this:
- exact or near-exact name match is the primary signal
- previous purchases act as a preference among otherwise similar products
- package-size fit and discounts help break ties
- if two products still score similarly, the cheaper one wins

This means items like `tej` should gradually converge toward products you already buy, while still rejecting clearly wrong matches.

## Checkout

This app does not place orders or select delivery slots. Approval in Telegram means the cart is prepared; final checkout is always manual in Kifli at `https://www.kifli.hu/rendeles/kosaram-tartalma`.
