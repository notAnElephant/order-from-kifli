# order-from-kifli

Local-first assistant that reads recipes from Notion, plans 2-3 weekly meals, builds a Kifli cart (via MCP), and sends an approval request on Telegram before optionally placing the order.

## Quick start

1. Copy `.env.example` to `.env` and fill credentials.
2. Update `config/notion-field-map.json` to match your `Receptek` database property names.
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

This project launches `@tomaspavlin/rohlik-mcp` directly through `npx` and targets Kifli with `ROHLIK_BASE_URL=https://www.kifli.hu`. Credentials stay in `KIFLI_EMAIL` and `KIFLI_PASSWORD`; the app maps them to the server's `ROHLIK_USERNAME` and `ROHLIK_PASSWORD` env vars when starting the MCP process.

## Safety

Order placement is disabled by default (`ENABLE_ORDER_PLACEMENT=false`) and always requires Telegram approval.
