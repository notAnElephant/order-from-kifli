import { formatProposalMessage } from '../notify/formatters.js';
import type { GrocerClient, HistoryStore, Notifier, ProposalRecord } from '../types.js';

export class ApprovalHandler {
  constructor(
    private deps: {
      historyStore: HistoryStore;
      grocerClient: GrocerClient;
      notifier: Notifier;
      enableOrderPlacement: boolean;
    }
  ) {}

  async approve(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${proposalId} not found.`;
    if (proposal.status === 'ordered') return `Proposal ${proposalId} was already ordered.`;

    await this.deps.historyStore.markApproved(proposalId);

    const caps = await this.deps.grocerClient.getCapabilities();
    const selectedSlot = proposal.candidate.cartProposal?.selectedSlot;
    if (!selectedSlot) {
      return `Proposal ${proposalId} approved. Cart is prepared, but no delivery slot is currently available.`;
    }

    if (!this.deps.enableOrderPlacement || !caps.placeOrder) {
      return `Proposal ${proposalId} approved. Cart is prepared on Kifli. Open Kifli to confirm checkout manually.`;
    }

    const result = await this.deps.grocerClient.placeOrder(selectedSlot.id, proposal.id);
    await this.deps.historyStore.markOrdered(proposalId, result);
    await this.deps.notifier.sendStatus(`Order placed for proposal ${proposalId} (${selectedSlot.label}).`);
    return `Order placed for proposal ${proposalId}.`;
  }

  async reject(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${proposalId} not found.`;
    if (proposal.status === 'ordered') return `Proposal ${proposalId} is already ordered and cannot be rejected.`;
    await this.deps.historyStore.markRejected(proposalId);
    return `Proposal ${proposalId} rejected.`;
  }

  async nextSlot(proposalId: string): Promise<string> {
    const proposal = await this.deps.historyStore.getProposal(proposalId);
    if (!proposal) return `Proposal ${proposalId} not found.`;
    const cart = proposal.candidate.cartProposal;
    if (!cart) return `Proposal ${proposalId} has no cart.`;

    const currentId = cart.selectedSlot?.id;
    const alternatives = [cart.selectedSlot, ...(cart.alternativeSlots ?? [])].filter(
      (slot): slot is NonNullable<typeof cart.selectedSlot> => Boolean(slot)
    );
    if (alternatives.length < 2) return `No additional delivery slots available for ${proposalId}.`;

    const index = alternatives.findIndex((s) => s.id === currentId);
    const next = alternatives[(index + 1) % alternatives.length];
    if (!next) return `No additional delivery slots available for ${proposalId}.`;
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
