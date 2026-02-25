import { describe, expect, it } from 'vitest';
import { ApprovalHandler } from '../src/orchestrator/approval-handler.js';
import type { GrocerClient, HistoryStore, Notifier, ProposalRecord } from '../src/types.js';

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
  async markOrdered(proposalId: string, orderResult: unknown) {
    if (this.proposal && this.proposal.id === proposalId) {
      this.proposal.status = 'ordered';
      this.proposal.orderResult = orderResult;
    }
  }
}

class FakeGrocer implements GrocerClient {
  placed = 0;
  async getCapabilities() {
    return {
      toolNames: [],
      productSearch: true,
      discounts: true,
      cartRead: true,
      cartMutate: true,
      deliverySlots: true,
      placeOrder: true,
      ordersHistory: false
    };
  }
  async searchProducts() { throw new Error('not used'); }
  async getDiscounts() { return []; }
  async getCart() { return {}; }
  async setCart() { return {}; }
  async getDeliverySlots() { return []; }
  async placeOrder() { this.placed += 1; return { id: 'order_1' }; }
}

class NullNotifier implements Notifier {
  async sendProposal() { return {}; }
  async sendStatus() {}
}

describe('approval handler', () => {
  it('prevents duplicate ordering', async () => {
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
      notifier: new NullNotifier(),
      enableOrderPlacement: true
    });

    await handler.approve('proposal_1');
    const second = await handler.approve('proposal_1');

    expect(grocer.placed).toBe(1);
    expect(second).toContain('already ordered');
  });
});
