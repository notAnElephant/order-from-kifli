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

This project expects a remote MCP server accessible through `mcp-remote` and credentials provided by env vars (`KIFLI_EMAIL`, `KIFLI_PASSWORD`). Tool names are discovered dynamically and mapped to capabilities at runtime.

## Safety

Order placement is disabled by default (`ENABLE_ORDER_PLACEMENT=false`) and always requires Telegram approval.
