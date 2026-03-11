import type { HistoryStore } from '../types.js';

function shortProposalId(proposalId: string): string {
  return proposalId.startsWith('proposal_') ? proposalId.slice(9, 15) : proposalId.slice(0, 6);
}

export class ApprovalHandler {
  private static readonly checkoutUrl = 'https://www.kifli.hu/rendeles/kosaram-tartalma';

  constructor(
    private deps: {
      historyStore: HistoryStore;
    }
  ) {}

  async approve(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${shortProposalId(proposalId)} not found.`;
    if (proposal.status === 'approved') return `Proposal ${shortProposalId(proposalId)} was already approved.`;

    await this.deps.historyStore.markApproved(proposalId);

    return `Proposal ${shortProposalId(proposalId)} approved. Cart is prepared on Kifli. Complete checkout here: ${ApprovalHandler.checkoutUrl}`;
  }

  async reject(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${shortProposalId(proposalId)} not found.`;
    if (proposal.status === 'approved') return `Proposal ${shortProposalId(proposalId)} is already approved and cannot be rejected.`;
    await this.deps.historyStore.markRejected(proposalId);
    return `Proposal ${shortProposalId(proposalId)} rejected.`;
  }
}
