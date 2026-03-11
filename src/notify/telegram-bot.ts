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

  private resolveChatId(chatId?: string | number): string | number {
    return chatId ?? this.chatId;
  }

  async sendProposal(
    proposal: ProposalRecord,
    options?: { replaceMessageId?: number; chatId?: string | number }
  ): Promise<{ messageId?: number }> {
    const targetChatId = this.resolveChatId(options?.chatId);
    const keyboard = new InlineKeyboard()
      .text('Approve', `approve:${proposal.id}`)
      .text('Reject', `reject:${proposal.id}`)
      .row()
      .text('Rebuild', `rebuild:${proposal.id}`);

    if (options?.replaceMessageId) {
      try {
        await this.bot.api.editMessageText(targetChatId, options.replaceMessageId, proposal.messageText, {
          reply_markup: keyboard
        });
        return { messageId: options.replaceMessageId };
      } catch (error) {
        if (!isEditTargetMissingError(error)) throw error;
      }
    }

    const message = await this.bot.api.sendMessage(targetChatId, proposal.messageText, { reply_markup: keyboard });

    return { messageId: message.message_id };
  }

  async sendStatus(message: string, options?: { chatId?: string | number }): Promise<void> {
    await this.bot.api.sendMessage(this.resolveChatId(options?.chatId), message);
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
  onManualPlan: (
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<void>;
  onApprove: (proposalId: string) => Promise<string>;
  onReject: (proposalId: string) => Promise<string>;
  onRebuild: (
    proposalId: string,
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<string>;
}

function isMessageNotModifiedError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('message is not modified');
}

function isEditTargetMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('message to edit not found') ||
    message.includes('message can\'t be edited') ||
    message.includes('message identifier is not specified')
  );
}

function createStatusUpdater(bot: Bot, chatId: number | string, messageId: number) {
  let activeMessageId = messageId;
  let lastMessage = '';

  return async (message: string) => {
    if (message === lastMessage) return;
    try {
      await bot.api.editMessageText(chatId, activeMessageId, message);
      lastMessage = message;
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        lastMessage = message;
        return;
      }
      if (!isEditTargetMissingError(error)) throw error;

      const sent = await bot.api.sendMessage(chatId, message);
      activeMessageId = sent.message_id;
      lastMessage = message;
    }
  };
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
    const status = await ctx.reply('Generating weekly plan...');
    if (ctx.chatId == null) return;
    const updateStatus = createStatusUpdater(bot, ctx.chatId, status.message_id);
    await handlers.onManualPlan({
      statusMessageId: status.message_id,
      chatId: ctx.chatId,
      reportProgress: updateStatus
    });
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
    await ctx.answerCallbackQuery({ text: 'Rebuilding' });
    const status = await ctx.reply('Rebuilding weekly plan...');
    if (ctx.chatId == null) return;
    const updateStatus = createStatusUpdater(bot, ctx.chatId, status.message_id);
    const msg = await handlers.onRebuild(proposalId, {
      statusMessageId: status.message_id,
      chatId: ctx.chatId,
      reportProgress: updateStatus
    });
    await ctx.reply(msg);
  });

  await bot.start();
}
