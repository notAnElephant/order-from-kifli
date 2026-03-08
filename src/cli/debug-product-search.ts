import dotenv from 'dotenv';
import { KifliMcpClient } from '../grocer/kifli-mcp-client.js';
import { normalizeText } from '../utils/normalize.js';

dotenv.config();

const DEFAULT_QUERIES = [
  'bacon kockazott',
  'bacon kockazott',
  'tejszin',
  'tejszín zsíros',
  'liszt',
  'spagetti',
  'csirkemell',
  'lilahagyma',
  'fusilli',
  'fussili',
  'tojas',
  'tojás',
  'tej'
];

function getQueries(): string[] {
  const args = process.argv.slice(2).map((arg) => arg.trim()).filter((arg) => arg && arg !== '--');
  return args.length > 0 ? args : DEFAULT_QUERIES;
}

function formatPrice(value?: number): string {
  return value == null ? '-' : `${value} Ft`;
}

async function main() {
  if (!process.env.KIFLI_EMAIL || !process.env.KIFLI_PASSWORD) {
    throw new Error('KIFLI_EMAIL and KIFLI_PASSWORD must be set in the environment.');
  }

  const queries = getQueries();
  const client = new KifliMcpClient({
    email: process.env.KIFLI_EMAIL,
    password: process.env.KIFLI_PASSWORD,
    baseUrl: process.env.ROHLIK_BASE_URL,
    debug: ['1', 'true', 'yes'].includes((process.env.ROHLIK_DEBUG ?? 'false').toLowerCase())
  });

  try {
    for (const query of queries) {
      const raw = await client.debugCallTool(['search_products', 'product_search', 'search products'], {
        product_name: query,
        limit: 10,
        favourite_only: false
      });
      const result = await client.searchProducts(query);
      console.log(`\n=== QUERY: ${query} (normalized: ${normalizeText(query)}) ===`);
      console.log('RAW MCP RESPONSE:', JSON.stringify(raw, null, 2));
      if (result.products.length === 0) {
        console.log('No products found.');
        continue;
      }

      for (const [index, product] of result.products.slice(0, 5).entries()) {
        console.log(
          `${index + 1}. ${product.name} | id=${product.id} | price=${formatPrice(product.discountedPrice ?? product.price)} | unit=${product.unit ?? '-'}`
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
