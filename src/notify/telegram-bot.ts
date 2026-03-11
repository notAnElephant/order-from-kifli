import { Bot, InlineKeyboard } from 'grammy';
import type { Notifier, ProposalRecord } from '../types.js';

const PRIVATE_COMMANDS = [
  { command: 'start', description: 'Show onboarding and capabilities' },
  { command: 'help', description: 'Show help and command list' },
  { command: 'plan', description: 'Generate a new weekly proposal' }
] as const;

const GROUP_COMMANDS = [
  { command: 'help', description: 'Show help and command list' },
  { command: 'plan', description: 'Generate a new weekly proposal' }
] as const;

const HELP_TEXT = [
  'Recipe-to-Kifli assistant',
  '',
  'Available commands:',
  '/start - show onboarding and current capabilities',
  '/help - show this help message',
  '/plan - generate a new weekly proposal',
  '',
  'What the bot does:',
  '- reads recipes from Notion',
  '- selects a weekly meal plan',
  '- builds a Kifli cart',
  '- sends a proposal for approval',
  '',
  'What it does not do:',
  '- it does not place the order',
  '- it does not select a delivery slot',
  '',
  'After approval, finish checkout here:',
  'https://www.kifli.hu/rendeles/kosaram-tartalma'
].join('\n');

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
      .text('Rebuild', `rebuild:${proposal.id}`);

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
      .text('Rebuild', `rebuild:${proposal.id}`);

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
}

async function registerBotCommands(bot: Bot) {
  await bot.api.setMyCommands([...PRIVATE_COMMANDS], {
    scope: {
      type: 'all_private_chats'
    }
  });

  await bot.api.setMyCommands([...GROUP_COMMANDS], {
    scope: {
      type: 'all_group_chats'
    }
  });
}

export async function startTelegramBot(bot: Bot, handlers: TelegramBotHandlers): Promise<void> {
  await registerBotCommands(bot);

  bot.command('start', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT);
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

  await bot.start();
}
