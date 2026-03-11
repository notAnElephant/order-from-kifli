import { describe, expect, it } from 'vitest';
import { ApprovalHandler } from '../src/orchestrator/approval-handler.js';
import type { HistoryStore, ProposalRecord } from '../src/types.js';

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
          grocerNotes: []
        }
      }
    };

    const store = new MemoryStore(proposal);
    const handler = new ApprovalHandler({
      historyStore: store
    });

    await handler.approve('proposal_1');
    const second = await handler.approve('proposal_1');

    expect(second).toContain('already approved');
  });
});
