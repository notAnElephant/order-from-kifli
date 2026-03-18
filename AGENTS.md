# order-from-kifli agent guide

## Project overview
- TypeScript Node.js app that reads recipes from Notion, plans weekly meals, builds a Kifli cart through MCP, and sends Telegram approval prompts.
- Entry points live in `src/cli/` and the shared orchestration starts from `src/app.ts`.
- Core deterministic logic lives under `src/scoring/`, `src/planning/`, `src/grocer/`, and `src/parsing/`.
- Persistence is SQLite-based in `src/state/sqlite/` with SQL migrations in `migrations/`.
- Config data is stored in `config/*.json`; keep user-specific secrets in `.env`, never in tracked files.

## Working style
- Keep changes focused and minimal; prefer fixing root causes over broad refactors.
- Preserve deterministic behavior in scoring, product matching, and approval handling unless the task explicitly changes decision logic.
- Reuse existing utilities and config loaders before introducing new abstractions.
- Avoid adding new runtime dependencies unless clearly necessary.
- Maintain ESM TypeScript style consistent with the existing codebase.

## Commands
- Install dependencies: `pnpm install`
- Run bot: `pnpm run bot`
- Run scheduler worker: `pnpm run worker`
- Trigger a planning run manually: `pnpm run plan-now`
- Sync Kifli MCP capabilities: `pnpm run sync-kifli-capabilities`
- Run tests: `pnpm test`
- Run typecheck: `pnpm run typecheck`
- Build: `pnpm run build`

## Code map
- `src/recipe-source/notion.ts`: Notion recipe ingestion.
- `src/planning/meal-combination-search.ts`: weekly meal combination search and reranking.
- `src/scoring/recipe-scorer.ts`: recipe scoring model.
- `src/grocer/product-matcher.ts`: ingredient-to-product matching.
- `src/grocer/cart-builder.ts`: cart construction workflow.
- `src/orchestrator/approval-handler.ts`: Telegram approval flow.
- `src/state/sqlite/history-store.ts`: local planning and history persistence.
- `tests/`: Vitest coverage for scoring, planning, parsing, formatters, and approval handling.

## Validation expectations
- For logic changes, run the most relevant `vitest` tests first, then broader checks if needed.
- Run `pnpm run typecheck` when touching shared types, config parsing, or cross-module contracts.
- Do not edit generated data or local state artifacts; keep `.gitignore` entries intact.

## Notes for future agents
- The app is local-first and cannot complete checkout; approval only prepares the cart.
- Kifli access is mediated via the installed `@tomaspavlin/rohlik-mcp` package and environment variables.
- When updating config shapes, keep `README.md`, `config/`, and environment expectations aligned.
