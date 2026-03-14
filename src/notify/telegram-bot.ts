import { Bot, InlineKeyboard } from 'grammy';
import type { Notifier, ProposalRecord, Recipe, RecipeSwapOption } from '../types.js';
import { createId } from '../utils/ids.js';

const PRIVATE_COMMANDS = [
  { command: 'start', description: 'Show onboarding and capabilities' },
  { command: 'help', description: 'Show help and command list' },
  { command: 'plan', description: 'Generate a new weekly proposal' },
  { command: 'recipes', description: 'List recipes in batches of 10' }
] as const;

const GROUP_COMMANDS = [
  { command: 'help', description: 'Show help and command list' },
  { command: 'plan', description: 'Generate a new weekly proposal' },
  { command: 'recipes', description: 'List recipes in batches of 10' }
] as const;

const HELP_TEXT = [
  'Recipe-to-Kifli assistant',
  '',
  'Available commands:',
  '/start - show onboarding and current capabilities',
  '/help - show this help message',
  '/plan - generate a new weekly proposal',
  '/recipes - list recipes in batches of 10',
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

const STALE_COMMAND_WINDOW_SECONDS = 120;
const RECIPE_PAGE_SIZE = 10;
const RECIPE_SESSION_TTL_MS = 10 * 60_000;

type RecipePageSession = {
  recipes: Recipe[];
  createdAt: number;
};

function createProposalKeyboard(proposalId: string) {
  return new InlineKeyboard()
    .text('Approve', `approve:${proposalId}`)
    .text('Reject', `reject:${proposalId}`)
    .row()
    .text('Rebuild', `rebuild:${proposalId}`)
    .text('Swap recipe', `swapslots:${proposalId}`);
}

function createCartGuardKeyboard(pendingId: string) {
  return new InlineKeyboard()
    .text('Replace cart', `cartreplace:${pendingId}`)
    .text('Append to cart', `cartappend:${pendingId}`)
    .row()
    .text('Cancel', `cartcancel:${pendingId}`);
}

function formatSwapSlotPrompt(recipeNames: string[]): string {
  return ['Choose which recipe to swap:', ...recipeNames.map((name, index) => `${index + 1}. ${name}`)].join('\n');
}

function createSwapSlotKeyboard(proposalId: string, recipeNames: string[]) {
  const keyboard = new InlineKeyboard();
  recipeNames.forEach((name, index) => {
    keyboard.text(`${index + 1}. ${name.slice(0, 24)}`, `swaplist:${proposalId}:${index}:0`).row();
  });
  return keyboard;
}

function formatSwapOptionsPrompt(currentRecipeName: string, options: RecipeSwapOption[], offset: number): string {
  return [
    `Swap options for: ${currentRecipeName}`,
    '',
    ...(options.length
      ? options.map(
          (option, index) =>
            `${offset + index + 1}. ${option.recipeName} (${option.totalMinutes} min, score ${option.score.toFixed(2)})`
        )
      : ['No alternatives available for this recipe.'])
  ].join('\n');
}

function createSwapOptionsKeyboard(
  proposalId: string,
  slotIndex: number,
  offset: number,
  options: RecipeSwapOption[],
  hasPrevPage: boolean,
  hasNextPage: boolean
) {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    keyboard.text(`Use ${offset + index + 1}`, `swapdo:${proposalId}:${slotIndex}:${option.index}`).row();
  });
  if (hasPrevPage) {
    keyboard.text('Prev', `swaplist:${proposalId}:${slotIndex}:${Math.max(0, offset - 3)}`);
  }
  if (hasNextPage) {
    keyboard.text('More', `swaplist:${proposalId}:${slotIndex}:${offset + 3}`);
  }
  return keyboard;
}

function isStaleCommand(unixSeconds: number | undefined): boolean {
  if (!unixSeconds) return false;
  return Math.floor(Date.now() / 1000) - unixSeconds > STALE_COMMAND_WINDOW_SECONDS;
}

function formatRecipeRating(rating: number): string {
  if (!rating || rating <= 0) return 'no rating';
  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return '⭐'.repeat(rounded);
}

function formatRecipePage(recipes: Recipe[], offset: number): string {
  if (recipes.length === 0) return 'No recipes found.';
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, recipes.length - 1)));
  const visible = recipes.slice(safeOffset, safeOffset + RECIPE_PAGE_SIZE);
  const end = Math.min(safeOffset + visible.length, recipes.length);

  return [
    `Recipes ${safeOffset + 1}-${end} of ${recipes.length}:`,
    '',
    ...visible.map((recipe, index) => {
      const parts = [
        `${safeOffset + index + 1}. ${recipe.name}`,
        `${formatRecipeRating(recipe.rating)}`,
        `${recipe.totalMinutes || '-'} min`
      ];
      if (recipe.category) parts.push(recipe.category);
      return parts.join(' • ');
    })
  ].join('\n');
}

function createRecipePageKeyboard(recipes: Recipe[], sessionId: string, offset: number) {
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, recipes.length - 1)));
  const keyboard = new InlineKeyboard();
  if (safeOffset > 0) {
    keyboard.text('Prev 10', `recipespage:${sessionId}:${Math.max(0, safeOffset - RECIPE_PAGE_SIZE)}`);
  }
  if (safeOffset + RECIPE_PAGE_SIZE < recipes.length) {
    keyboard.text('Next 10', `recipespage:${sessionId}:${safeOffset + RECIPE_PAGE_SIZE}`);
  }
  return keyboard;
}

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
  ): Promise<{ messageId?: number; chatId?: string | number }> {
    const targetChatId = this.resolveChatId(options?.chatId);
    const keyboard = createProposalKeyboard(proposal.id);

    if (options?.replaceMessageId) {
      try {
        await this.bot.api.editMessageText(targetChatId, options.replaceMessageId, proposal.messageText, {
          reply_markup: keyboard
        });
        return { messageId: options.replaceMessageId, chatId: targetChatId };
      } catch (error) {
        if (!isEditTargetMissingError(error)) throw error;
      }
    }

    const message = await this.bot.api.sendMessage(targetChatId, proposal.messageText, { reply_markup: keyboard });

    return { messageId: message.message_id, chatId: targetChatId };
  }

  async sendStatus(message: string, options?: { chatId?: string | number }): Promise<void> {
    await this.bot.api.sendMessage(this.resolveChatId(options?.chatId), message);
  }

  async updateProposalMessage(proposal: ProposalRecord): Promise<void> {
    if (!proposal.telegramMessageId) return;
    const keyboard = createProposalKeyboard(proposal.id);
    const targetChatId = proposal.telegramChatId ?? this.chatId;

    await this.bot.api.editMessageText(targetChatId, proposal.telegramMessageId, proposal.messageText, {
      reply_markup: keyboard
    });
  }
}

export interface TelegramBotHandlers {
  onManualPlan: (
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<
    | void
    | {
        pendingId: string;
        message: string;
      }
  >;
  onApprove: (proposalId: string) => Promise<string>;
  onReject: (proposalId: string) => Promise<string>;
  onRebuild: (
    proposalId: string,
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<
    | string
    | {
        pendingId: string;
        message: string;
      }
  >;
  onConfirmCartReplace: (
    pendingId: string,
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<string>;
  onConfirmCartAppend: (
    pendingId: string,
    options?: { statusMessageId?: number; chatId?: string | number; reportProgress?: (message: string) => Promise<void> }
  ) => Promise<string>;
  onCancelCartReplace: (pendingId: string) => Promise<string>;
  onShowSwapSlots: (proposalId: string) => Promise<{ recipeNames: string[] }>;
  onShowSwapOptions: (
    proposalId: string,
    slotIndex: number,
    offset: number
  ) => Promise<{ currentRecipeName: string; options: RecipeSwapOption[]; hasPrevPage: boolean; hasNextPage: boolean }>;
  onSwapRecipe: (
    proposalId: string,
    slotIndex: number,
    replacementIndex: number,
    options?: { reportProgress?: (message: string) => Promise<void> }
  ) => Promise<string>;
  onListRecipes: () => Promise<Recipe[]>;
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
  const recipeSessions = new Map<string, RecipePageSession>();

  const createRecipeSession = (recipes: Recipe[]): string => {
    const sessionId = createId('recipes');
    recipeSessions.set(sessionId, { recipes, createdAt: Date.now() });
    return sessionId;
  };

  const getRecipeSession = (sessionId: string): RecipePageSession | null => {
    const session = recipeSessions.get(sessionId);
    if (!session) return null;
    if (Date.now() - session.createdAt <= RECIPE_SESSION_TTL_MS) return session;
    recipeSessions.delete(sessionId);
    return null;
  };

  await registerBotCommands(bot);

  bot.command('start', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT);
  });

  bot.command('plan', async (ctx) => {
    if (isStaleCommand(ctx.msg?.date)) {
      await ctx.reply('Ignoring stale /plan from while the bot was offline.');
      return;
    }
    const status = await ctx.reply('Generating weekly plan...');
    if (ctx.chatId == null) return;
    const updateStatus = createStatusUpdater(bot, ctx.chatId, status.message_id);
    const result = await handlers.onManualPlan({
      statusMessageId: status.message_id,
      chatId: ctx.chatId,
      reportProgress: updateStatus
    });
    if (result?.pendingId) {
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, result.message, {
        reply_markup: createCartGuardKeyboard(result.pendingId)
      });
    }
  });

  bot.command('recipes', async (ctx) => {
    const status = await ctx.reply('Loading recipes...');
    const recipes = await handlers.onListRecipes();
    const sessionId = createRecipeSession(recipes);
    if (ctx.chatId == null) return;
    await ctx.api.editMessageText(ctx.chatId, status.message_id, formatRecipePage(recipes, 0), {
      reply_markup: createRecipePageKeyboard(recipes, sessionId, 0)
    });
  });

  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const msg = await handlers.onApprove(proposalId);
    await ctx.answerCallbackQuery({ text: 'Approved' });
    if (typeof msg === 'string') {
      await ctx.reply(msg);
    }
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
    if (typeof msg === 'object' && msg?.pendingId) {
      await ctx.api.editMessageText(ctx.chatId, status.message_id, msg.message, {
        reply_markup: createCartGuardKeyboard(msg.pendingId)
      });
      return;
    }
    if (typeof msg === 'string') {
      await ctx.reply(msg);
    }
  });

  bot.callbackQuery(/^cartreplace:([^:]+)$/, async (ctx) => {
    const pendingId = String(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: 'Replacing cart' });
    if (ctx.chatId == null || !ctx.callbackQuery.message) return;
    const updateStatus = createStatusUpdater(bot, ctx.chatId, ctx.callbackQuery.message.message_id);
    const msg = await handlers.onConfirmCartReplace(pendingId, {
      statusMessageId: ctx.callbackQuery.message.message_id,
      chatId: ctx.chatId,
      reportProgress: updateStatus
    });
    await ctx.reply(msg);
  });

  bot.callbackQuery(/^cartappend:([^:]+)$/, async (ctx) => {
    const pendingId = String(ctx.match[1]);
    await ctx.answerCallbackQuery({ text: 'Appending to cart' });
    if (ctx.chatId == null || !ctx.callbackQuery.message) return;
    const updateStatus = createStatusUpdater(bot, ctx.chatId, ctx.callbackQuery.message.message_id);
    const msg = await handlers.onConfirmCartAppend(pendingId, {
      statusMessageId: ctx.callbackQuery.message.message_id,
      chatId: ctx.chatId,
      reportProgress: updateStatus
    });
    await ctx.reply(msg);
  });

  bot.callbackQuery(/^cartcancel:([^:]+)$/, async (ctx) => {
    const pendingId = String(ctx.match[1]);
    const msg = await handlers.onCancelCartReplace(pendingId);
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    await ctx.editMessageText(msg);
  });

  bot.callbackQuery(/^swapslots:([^:]+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const { recipeNames } = await handlers.onShowSwapSlots(proposalId);
    await ctx.answerCallbackQuery({ text: 'Choose a recipe to swap' });
    await ctx.reply(formatSwapSlotPrompt(recipeNames), {
      reply_markup: createSwapSlotKeyboard(proposalId, recipeNames)
    });
  });

  bot.callbackQuery(/^swaplist:([^:]+):(\d+):(\d+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const slotIndex = Number(ctx.match[2]);
    const offset = Number(ctx.match[3]);
    const result = await handlers.onShowSwapOptions(proposalId, slotIndex, offset);
    await ctx.answerCallbackQuery({ text: 'Showing alternatives' });
    await ctx.editMessageText(formatSwapOptionsPrompt(result.currentRecipeName, result.options, offset), {
      reply_markup: createSwapOptionsKeyboard(
        proposalId,
        slotIndex,
        offset,
        result.options,
        result.hasPrevPage,
        result.hasNextPage
      )
    });
  });

  bot.callbackQuery(/^swapdo:([^:]+):(\d+):(\d+)$/, async (ctx) => {
    const proposalId = String(ctx.match[1]);
    const slotIndex = Number(ctx.match[2]);
    const replacementIndex = Number(ctx.match[3]);
    await ctx.answerCallbackQuery({ text: 'Swapping recipe' });
    const msg = await handlers.onSwapRecipe(proposalId, slotIndex, replacementIndex, {
      reportProgress: async (message) => {
        await ctx.editMessageText(message);
      }
    });
    await ctx.editMessageText(msg);
  });

  bot.callbackQuery(/^recipespage:([^:]+):(\d+)$/, async (ctx) => {
    const sessionId = String(ctx.match[1]);
    const offset = Number(ctx.match[2]);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Loading recipes...');
    let session = getRecipeSession(sessionId);
    let activeSessionId = sessionId;
    if (!session) {
      const recipes = await handlers.onListRecipes();
      activeSessionId = createRecipeSession(recipes);
      session = getRecipeSession(activeSessionId);
    }
    if (!session) {
      await ctx.editMessageText('Unable to load recipes right now.');
      return;
    }
    await ctx.editMessageText(formatRecipePage(session.recipes, offset), {
      reply_markup: createRecipePageKeyboard(session.recipes, activeSessionId, offset)
    });
  });

  await bot.start();
}
