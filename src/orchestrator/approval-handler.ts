import { formatProposalMessage } from '../notify/formatters.js';
import type { GrocerClient, HistoryStore, Notifier, ProposalRecord } from '../types.js';

function shortProposalId(proposalId: string): string {
  return proposalId.startsWith('proposal_') ? proposalId.slice(9, 15) : proposalId.slice(0, 6);
}

export class ApprovalHandler {
  constructor(
    private deps: {
      historyStore: HistoryStore;
      grocerClient: GrocerClient;
      notifier: Notifier;
    }
  ) {}

  async approve(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${shortProposalId(proposalId)} not found.`;
    if (proposal.status === 'approved') return `Proposal ${shortProposalId(proposalId)} was already approved.`;

    await this.deps.historyStore.markApproved(proposalId);

    const selectedSlot = proposal.candidate.cartProposal?.selectedSlot;
    if (!selectedSlot) {
      return `Proposal ${shortProposalId(proposalId)} approved. Cart is prepared, but no delivery slot is currently available.`;
    }

    return `Proposal ${shortProposalId(proposalId)} approved. Cart is prepared on Kifli. Preferred delivery slot: ${selectedSlot.label}. Complete checkout manually in Kifli.`;
  }

  async reject(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${shortProposalId(proposalId)} not found.`;
    if (proposal.status === 'approved') return `Proposal ${shortProposalId(proposalId)} is already approved and cannot be rejected.`;
    await this.deps.historyStore.markRejected(proposalId);
    return `Proposal ${shortProposalId(proposalId)} rejected.`;
  }

  async nextSlot(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${shortProposalId(proposalId)} not found.`;
    const cart = proposal.candidate.cartProposal;
    if (!cart) return `Proposal ${shortProposalId(proposalId)} has no cart.`;

    const currentId = cart.selectedSlot?.id;
    const alternatives = [cart.selectedSlot, ...(cart.alternativeSlots ?? [])].filter(
      (slot): slot is NonNullable<typeof cart.selectedSlot> => Boolean(slot)
    );
    if (alternatives.length < 2) return `No additional delivery slots available for proposal ${shortProposalId(proposalId)}.`;

    const index = alternatives.findIndex((s) => s.id === currentId);
    const next = alternatives[(index + 1) % alternatives.length];
    if (!next) return `No additional delivery slots available for proposal ${shortProposalId(proposalId)}.`;
    cart.selectedSlot = next;
    cart.alternativeSlots = alternatives.filter((s) => s.id !== next.id);
    proposal.messageText = formatProposalMessage(proposal);
    await this.deps.historyStore.saveProposal(proposal);
    if (this.deps.notifier.updateProposalMessage) {
      await this.deps.notifier.updateProposalMessage(proposal);
    }
    return `Updated proposed slot to: ${next.label}`;
  }
}
