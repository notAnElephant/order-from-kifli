import type {
  DeliverySlot,
  DiscountInfo,
  GrocerClient,
  GrocerClientCapabilities,
  GrocerProduct,
  MatchedCartLine,
  ProductSearchResult
} from '../types.js';
import { normalizeText } from '../utils/normalize.js';

type McpClientLike = {
  connect: (transport: unknown) => Promise<void>;
  close?: () => Promise<void>;
  listTools?: () => Promise<{ tools?: Array<{ name: string; description?: string }> }>;
  callTool?: (args: { name: string; arguments?: Record<string, unknown> }) => Promise<any>;
};

type StdioTransportCtor = new (args: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}) => unknown;

function flattenContent(result: any): unknown {
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  if (Array.isArray(result.content)) {
    const textParts = result.content
      .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
      .map((item: any) => item.text);
    if (textParts.length === 1) {
      try {
        return JSON.parse(textParts[0]);
      } catch {
        return textParts[0];
      }
    }
    return textParts;
  }
  return result;
}

function extractTextContent(result: any): string | null {
  if (!result) return null;
  if (Array.isArray(result.content)) {
    const text = result.content
      .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
      .map((item: any) => item.text)
      .join('\n')
      .trim();
    return text || null;
  }
  if (typeof result === 'string') return result;
  return null;
}

function extractToolError(result: any): string | null {
  if (!result) return null;
  const text = extractTextContent(result);
  if (result.isError) {
    return text ?? 'Unknown MCP tool error';
  }
  if (text && /^HTTP\s+\d+/i.test(text)) {
    return text;
  }
  return null;
}

function asArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const key of ['items', 'results', 'products', 'data', 'slots', 'offers']) {
      const maybe = (value as any)[key];
      if (Array.isArray(maybe)) return maybe as T[];
    }
  }
  return [];
}

function parsePriceNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseSearchProductsText(text: string): GrocerProduct[] {
  const chunks = text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('• '));

  return chunks.map((chunk) => {
    const lines = chunk.split('\n').map((line) => line.trim());
    const header = lines[0]?.replace(/^•\s*/, '') ?? 'Unknown product';
    const headerMatch = header.match(/^(.*?)(?:\s+\((.*?)\))?$/);
    const name = headerMatch?.[1]?.trim() || header;
    const brand = headerMatch?.[2]?.trim();
    const price = parsePriceNumber(lines.find((line) => line.startsWith('Price:'))?.replace(/^Price:\s*/, ''));
    const amount = lines.find((line) => line.startsWith('Amount:'))?.replace(/^Amount:\s*/, '');
    const id = lines.find((line) => line.startsWith('ID:'))?.replace(/^ID:\s*/, '').trim();

    return {
      id: id || name,
      name,
      price,
      unit: amount,
      tags: brand ? [brand] : undefined,
      raw: { text: chunk }
    } satisfies GrocerProduct;
  });
}

function parseDeliverySlotsText(text: string): DeliverySlot[] {
  const chunks = text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => /^\d+\.\s/.test(chunk));

  return chunks.map((chunk, index) => {
    const lines = chunk.split('\n').map((line) => line.trim());
    const firstLine = lines[0] ?? '';
    const slotMatch = firstLine.match(/^\d+\.\s+(.*?)\s+([0-9]{1,2}[:.][0-9]{2}.*|Unknown time)$/i);
    const datePart = slotMatch?.[1]?.trim() ?? firstLine.replace(/^\d+\.\s+/, '').trim();
    const timePart = slotMatch?.[2]?.trim();
    const price = parsePriceNumber(lines.find((line) => /^Price:/i.test(line))?.replace(/^Price:\s*/i, ''));
    const availableLine = lines.find((line) => /^Available:/i.test(line))?.replace(/^Available:\s*/i, '').trim();
    const available = availableLine ? /^(yes|true|ano)$/i.test(availableLine) : true;

    return {
      id: `${datePart}-${timePart ?? index}`,
      label: [datePart, timePart].filter(Boolean).join(' ').trim() || firstLine.replace(/^\d+\.\s+/, ''),
      fee: price,
      available,
      raw: { text: chunk }
    } satisfies DeliverySlot;
  });
}

export class KifliMcpClient implements GrocerClient {
  private email: string;
  private password: string;
  private baseUrl: string;
  private debug: boolean;
  private command: string;
  private commandArgs: string[];
  private client: McpClientLike | null = null;
  private toolNames: string[] = [];
  private connected = false;

  constructor(options: {
    email: string;
    password: string;
    baseUrl?: string;
    debug?: boolean;
    command?: string;
    commandArgs?: string[];
  }) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = options.baseUrl ?? process.env.ROHLIK_BASE_URL ?? 'https://www.kifli.hu';
    this.debug = options.debug ?? ['1', 'true', 'yes'].includes((process.env.ROHLIK_DEBUG ?? 'false').toLowerCase());
    this.command = options.command ?? 'pnpm';
    this.commandArgs = options.commandArgs ?? ['exec', 'rohlik-mcp'];
  }

  private async ensureConnected() {
    if (this.connected && this.client) return;
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js') as Promise<{ Client: new (args: any) => McpClientLike }>,
      import('@modelcontextprotocol/sdk/client/stdio.js') as Promise<{ StdioClientTransport: StdioTransportCtor }>
    ]);

    const client = new Client({ name: 'order-from-kifli', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: this.command,
      args: this.commandArgs,
      env: {
        ...process.env,
        ROHLIK_USERNAME: this.email,
        ROHLIK_PASSWORD: this.password,
        ROHLIK_BASE_URL: this.baseUrl,
        ROHLIK_DEBUG: this.debug ? 'true' : 'false'
      }
    });

    await client.connect(transport);
    this.client = client;
    this.connected = true;
    await this.refreshCapabilities();
  }

  async close(): Promise<void> {
    if (this.client?.close) await this.client.close();
    this.connected = false;
  }

  private async refreshCapabilities() {
    await this.ensureConnected();
    const response = this.client?.listTools ? await this.client.listTools() : { tools: [] };
    this.toolNames = (response.tools ?? []).map((t) => t.name);
  }

  private getCapabilitySnapshot(): GrocerClientCapabilities {
    const toolNames = this.toolNames;
    const has = (...tokens: string[]) =>
      toolNames.some((name) => tokens.every((token) => normalizeText(name).includes(normalizeText(token))));

    return {
      toolNames,
      productSearch: has('search_products') || has('search', 'products'),
      discounts: has('get_discounts') || has('discount') || has('offer'),
      cartRead: has('get_cart_content') || has('cart', 'content') || has('cart'),
      cartMutate:
        has('add_to_cart') || has('remove_from_cart') || has('update_cart') || has('modify_cart') || has('cart'),
      deliverySlots: has('get_delivery_slots') || has('delivery', 'slots') || has('slot'),
      ordersHistory: has('get_order_history') || has('order', 'history') || has('orders')
    };
  }

  async getCapabilities(): Promise<GrocerClientCapabilities> {
    await this.refreshCapabilities();
    return this.getCapabilitySnapshot();
  }

  async debugCallTool(candidates: string[], args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const toolName = this.findToolName(candidates);
    if (!toolName) {
      throw new Error(`No MCP tool found for patterns: ${candidates.join(', ')}`);
    }
    if (!this.client?.callTool) {
      throw new Error('MCP client does not expose callTool');
    }
    return this.client.callTool({ name: toolName, arguments: args });
  }

  private findToolName(candidates: string[]): string | null {
    const normalizedTools = this.toolNames.map((name) => ({ name, norm: normalizeText(name) }));
    for (const pattern of candidates) {
      const normPattern = normalizeText(pattern);
      const direct = normalizedTools.find((t) => t.norm === normPattern);
      if (direct) return direct.name;
      const fuzzy = normalizedTools.find((t) => t.norm.includes(normPattern) || normPattern.includes(t.norm));
      if (fuzzy) return fuzzy.name;
    }
    return null;
  }

  private async callTool(candidates: string[], args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const toolName = this.findToolName(candidates);
    if (!toolName) {
      throw new Error(`No MCP tool found for patterns: ${candidates.join(', ')}`);
    }
    if (!this.client?.callTool) {
      throw new Error('MCP client does not expose callTool');
    }
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return flattenContent(result);
  }

  async searchProducts(query: string): Promise<ProductSearchResult> {
    await this.ensureConnected();
    const toolName = this.findToolName(['search_products', 'product_search', 'search products']);
    if (!toolName) throw new Error('No MCP search tool found');
    const result = await this.client?.callTool?.({
      name: toolName,
      arguments: { product_name: query, limit: 10, favourite_only: false }
    });
    const toolError = extractToolError(result);
    if (toolError) {
      throw new Error(`search_products failed for "${query}": ${toolError}`);
    }
    const raw = flattenContent(result);
    const text = extractTextContent(result);
    const products = asArray<any>(raw).length
      ? asArray<any>(raw).map((p): GrocerProduct => ({
          id: String(p.id ?? p.productId ?? p.product_id ?? p.sku ?? p.code ?? p.name),
          name: String(p.name ?? p.productName ?? p.title ?? 'Unknown product'),
          price: typeof p.price === 'number' ? p.price : typeof p.basePrice === 'number' ? p.basePrice : undefined,
          discountedPrice:
            typeof p.discountedPrice === 'number'
              ? p.discountedPrice
              : typeof p.salePrice === 'number'
                ? p.salePrice
                : undefined,
          unit: p.unit ?? p.unitName ?? p.measureUnit,
          packageSize: typeof p.packageSize === 'number' ? p.packageSize : undefined,
          currency: p.currency,
          tags: Array.isArray(p.tags) ? p.tags.map(String) : undefined,
          isDiscounted: Boolean(p.isDiscounted ?? (p.discountedPrice != null) ?? (p.salePrice != null)),
          raw: p
        }))
      : text
        ? parseSearchProductsText(text)
        : [];
    return { query, products };
  }

  async getDiscounts(): Promise<DiscountInfo[]> {
    try {
      const raw = await this.callTool(['get_discounts', 'discounts', 'promotions'], {});
      return asArray<any>(raw).map((d) => ({
        productId: String(d.productId ?? d.product_id ?? d.id ?? d.sku),
        productName: String(d.productName ?? d.name ?? 'Unknown'),
        discountPercent:
          typeof d.discountPercent === 'number'
            ? d.discountPercent
            : typeof d.discount_percentage === 'number'
              ? d.discount_percentage
              : undefined,
        discountedPrice: typeof d.discountedPrice === 'number' ? d.discountedPrice : d.salePrice,
        basePrice: typeof d.basePrice === 'number' ? d.basePrice : d.price,
        validUntil: d.validUntil ?? d.expiresAt
      }));
    } catch {
      return [];
    }
  }

  async getCart(): Promise<unknown> {
    return this.callTool(['get_cart_content', 'cart_get', 'cart'], {});
  }

  async setCart(lines: MatchedCartLine[]): Promise<unknown> {
    const matched = lines.filter((l) => l.matched && l.productId);
    const payload = matched.map((l) => ({ product_id: l.productId, quantity: l.quantityToAdd ?? 1 }));

    try {
      return await this.callTool(['set_cart', 'cart_set'], { items: payload });
    } catch {
      return this.callTool(['add_to_cart', 'cart_add'], { products: payload });
    }
  }

  async getDeliverySlots(): Promise<DeliverySlot[]> {
    try {
      await this.ensureConnected();
      const toolName = this.findToolName(['get_delivery_slots', 'delivery_slots', 'delivery slots']);
      if (!toolName) throw new Error('No MCP delivery slot tool found');
      const result = await this.client?.callTool?.({ name: toolName, arguments: {} });
      const toolError = extractToolError(result);
      if (toolError) {
        throw new Error(`get_delivery_slots failed: ${toolError}`);
      }
      const raw = flattenContent(result);
      const text = extractTextContent(result);
      return asArray<any>(raw).length
        ? asArray<any>(raw).map((slot) => ({
            id: String(slot.id ?? slot.slotId ?? slot.slot_id ?? slot.label ?? Math.random()),
            label: String(slot.label ?? slot.name ?? slot.window ?? 'Delivery slot'),
            startsAt: slot.startsAt ?? slot.start,
            endsAt: slot.endsAt ?? slot.end,
            fee: typeof slot.fee === 'number' ? slot.fee : undefined,
            available: slot.available !== false,
            raw: slot
          }))
        : text
          ? parseDeliverySlotsText(text)
          : [];
    } catch {
      return [];
    }
  }
}
