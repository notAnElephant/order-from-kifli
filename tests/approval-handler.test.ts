import { describe, expect, it } from 'vitest';
import { ApprovalHandler } from '../src/orchestrator/approval-handler.js';
import type {
  DeliverySlot,
  DiscountInfo,
  GrocerClient,
  GrocerClientCapabilities,
  HistoryStore,
  Notifier,
  ProductSearchResult,
  ProposalRecord
} from '../src/types.js';

class MemoryStore implements HistoryStore {
  constructor(public proposal: ProposalRecord | null) {}
  async initialize() {}
  async getRecentMeals() { return []; }
  async saveProposal(p: ProposalRecord) { this.proposal = p; }
  async getProposal() { return this.proposal; }
  async setProposalTelegramMessageId() {}
  async markApproved(proposalId: string) {
    if (this.proposal && this.proposal.id === proposalId) this.proposal.status = 'approved';
  }
  async markRejected(proposalId: string) {
    if (this.proposal && this.proposal.id === proposalId) this.proposal.status = 'rejected';
  }
}

class FakeGrocer implements GrocerClient {
  async getCapabilities(): Promise<GrocerClientCapabilities> {
    return {
      toolNames: [],
      productSearch: true,
      discounts: true,
      cartRead: true,
      cartMutate: true,
      deliverySlots: true,
      ordersHistory: false
    };
  }
  async searchProducts(): Promise<ProductSearchResult> {
    throw new Error('not used');
  }
  async getDiscounts(): Promise<DiscountInfo[]> { return []; }
  async getCart(): Promise<unknown> { return {}; }
  async setCart(): Promise<unknown> { return {}; }
  async getDeliverySlots(): Promise<DeliverySlot[]> { return []; }
}

class NullNotifier implements Notifier {
  async sendProposal() { return {}; }
  async sendStatus() {}
}

describe('approval handler', () => {
  it('prevents duplicate approval', async () => {
    const proposal: ProposalRecord = {
      id: 'proposal_1',
      createdAt: '2026-02-25T10:00:00Z',
      status: 'proposed',
      periodStart: '2026-02-25',
      periodEnd: '2026-03-03',
      messageText: 'msg',
      candidate: {
        recipeCount: 2,
        recipes: [],
        recipeIds: [],
        combinedMinutes: 60,
        baseScore: 1,
        overlapBonus: 0,
        diversityBonus: 0,
        costPenalty: 0,
        finalScore: 1,
        rationale: [],
        cartProposal: {
          cartLines: [],
          matchedLines: [],
          estimatedTotal: 1000,
          discountedTotal: 900,
          estimatedSavings: 100,
          unmatchedIngredients: [],
          substitutions: [],
          grocerNotes: [],
          selectedSlot: { id: 'slot_1', label: 'Tomorrow 10-12', available: true }
        }
      }
    };

    const store = new MemoryStore(proposal);
    const grocer = new FakeGrocer();
    const handler = new ApprovalHandler({
      historyStore: store,
      grocerClient: grocer,
      notifier: new NullNotifier()
    });

    await handler.approve('proposal_1');
    const second = await handler.approve('proposal_1');

    expect(second).toContain('already approved');
  });
});
