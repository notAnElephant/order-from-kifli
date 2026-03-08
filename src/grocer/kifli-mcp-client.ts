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

function boolFromNameMatch(name: string, includesAny: string[]): boolean {
  const norm = normalizeText(name);
  return includesAny.some((token) => norm.includes(token));
}

export class KifliMcpClient implements GrocerClient {
  private email: string;
  private password: string;
  private baseUrl: string;
  private debug: boolean;
  private client: McpClientLike | null = null;
  private toolNames: string[] = [];
  private connected = false;

  constructor(options: { email: string; password: string; baseUrl?: string; debug?: boolean }) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = options.baseUrl ?? process.env.ROHLIK_BASE_URL ?? 'https://www.kifli.hu';
    this.debug = options.debug ?? ['1', 'true', 'yes'].includes((process.env.ROHLIK_DEBUG ?? 'false').toLowerCase());
  }

  private async ensureConnected() {
    if (this.connected && this.client) return;
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js') as Promise<{ Client: new (args: any) => McpClientLike }>,
      import('@modelcontextprotocol/sdk/client/stdio.js') as Promise<{ StdioClientTransport: StdioTransportCtor }>
    ]);

    const client = new Client({ name: 'order-from-kifli', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        '@tomaspavlin/rohlik-mcp'
      ],
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
      placeOrder: has('place_order') || has('checkout') || has('create_order'),
      ordersHistory: has('get_order_history') || has('order', 'history') || has('orders')
    };
  }

  async getCapabilities(): Promise<GrocerClientCapabilities> {
    await this.refreshCapabilities();
    return this.getCapabilitySnapshot();
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
    const raw = await this.callTool(['search_products', 'product_search', 'search products'], { query });
    const products = asArray<any>(raw).map((p): GrocerProduct => ({
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
    }));
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
      const added: unknown[] = [];
      for (const item of payload) {
        added.push(await this.callTool(['add_to_cart', 'cart_add'], item));
      }
      return { addedCount: added.length, results: added };
    }
  }

  async getDeliverySlots(): Promise<DeliverySlot[]> {
    try {
      const raw = await this.callTool(['get_delivery_slots', 'delivery_slots', 'delivery slots'], {});
      return asArray<any>(raw).map((slot) => ({
        id: String(slot.id ?? slot.slotId ?? slot.slot_id ?? slot.label ?? Math.random()),
        label: String(slot.label ?? slot.name ?? slot.window ?? 'Delivery slot'),
        startsAt: slot.startsAt ?? slot.start,
        endsAt: slot.endsAt ?? slot.end,
        fee: typeof slot.fee === 'number' ? slot.fee : undefined,
        available: slot.available !== false,
        raw: slot
      }));
    } catch {
      return [];
    }
  }

  async placeOrder(slotId: string, idempotencyKey: string): Promise<unknown> {
    return this.callTool(['place_order', 'checkout', 'create_order'], {
      slotId,
      idempotencyKey
    });
  }
}
