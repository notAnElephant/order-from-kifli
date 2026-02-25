import { Bot, InlineKeyboard } from 'grammy';
import type { Notifier, ProposalRecord } from '../types.js';
import { formatProposalMessage } from './formatters.js';

export class TelegramNotifier implements Notifier {
  private bot: Bot;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.bot = new Bot(botToken);
    this.chatId = chatId;
  }

  getBot(): Bot {
    return this.bot;
  }

  async sendProposal(proposal: ProposalRecord): Promise<{ messageId?: number }> {
    const keyboard = new InlineKeyboard()
      .text('Approve', `approve:${proposal.id}`)
      .text('Reject', `reject:${proposal.id}`)
      .row()
      .text('Rebuild', `rebuild:${proposal.id}`)
      .text('Next slot', `nextslot:${proposal.id}`);

    const message = await this.bot.api.sendMessage(this.chatId, proposal.messageText, {
      reply_markup: keyboard
    });

    return { messageId: message.message_id };
  }

  async sendStatus(message: string): Promise<void> {
    await this.bot.api.sendMessage(this.chatId, message);
  }

  async updateProposalMessage(proposal: ProposalRecord): Promise<void> {
    if (!proposal.telegramMessageId) return;
    const keyboard = new InlineKeyboard()
      .text('Approve', `approve:${proposal.id}`)
      .text('Reject', `reject:${proposal.id}`)
      .row()
      .text('Rebuild', `rebuild:${proposal.id}`)
      .text('Next slot', `nextslot:${proposal.id}`);

    await this.bot.api.editMessageText(this.chatId, proposal.telegramMessageId, proposal.messageText, {
      reply_markup: keyboard
    });
  }
}

export interface TelegramBotHandlers {
  onManualPlan: () => Promise<void>;
  onApprove: (proposalId: string) => Promise<string>;
  onReject: (proposalId: string) => Promise<string>;
  onRebuild: (proposalId: string) => Promise<string>;
  onNextSlot: (proposalId: string) => Promise<string>;
}

export async function startTelegramBot(bot: Bot, handlers: TelegramBotHandlers): Promise<void> {
  bot.command('start', async (ctx) => {
    await ctx.reply('Recipe-to-Kifli assistant is running. Use /plan to generate a proposal.');
  });

  bot.command('plan', async (ctx) => {
    await ctx.reply('Generating a new weekly plan...');
    await handlers.onManualPlan();
  });

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const msg = await handlers.onApprove(proposalId);
    await ctx.answerCallbackQuery({ text: 'Approved' });
    await ctx.reply(msg);
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const msg = await handlers.onReject(proposalId);
    await ctx.answerCallbackQuery({ text: 'Rejected' });
    await ctx.reply(msg);
  });

  bot.callbackQuery(/^rebuild:(.+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const msg = await handlers.onRebuild(proposalId);
    await ctx.answerCallbackQuery({ text: 'Rebuilding' });
    await ctx.reply(msg);
  });

  bot.callbackQuery(/^nextslot:(.+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const msg = await handlers.onNextSlot(proposalId);
    await ctx.answerCallbackQuery({ text: 'Slot updated' });
    await ctx.reply(msg);
  });

  await bot.start();
}

export { formatProposalMessage };
