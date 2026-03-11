import { loadConfig } from './config/index.js';
import { KifliMcpClient } from './grocer/kifli-mcp-client.js';
import { TelegramNotifier, startTelegramBot } from './notify/telegram-bot.js';
import { ApprovalHandler } from './orchestrator/approval-handler.js';
import { WeeklyRunOrchestrator } from './orchestrator/weekly-run.js';
import { NotionRecipeSource } from './recipe-source/notion.js';
import { SqliteHistoryStore } from './state/sqlite/history-store.js';
import { createLogger } from './utils/logger.js';
import { createId } from './utils/ids.js';

type ManualPlanOptions = {
  statusMessageId?: number;
  chatId?: string | number;
  reportProgress?: (message: string) => Promise<void>;
};

type PendingCartAction = {
  id: string;
  mode: 'plan' | 'rebuild';
  cartMode: 'replace' | 'append';
  chatId?: string | number;
  createdAt: number;
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['items', 'products', 'entries', 'results', 'data']) {
      const maybe = (value as Record<string, unknown>)[key];
      if (Array.isArray(maybe)) return maybe;
    }
  }
  return [];
}

function parseCartItemCountFromText(cart: string): number | null {
  const match = cart.match(/total items:\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeCartPreviewLine(line: string): string {
  // TODO: Remove this currency label workaround once the upstream rohlik-mcp cart summary reports kifli.hu totals in HUF.
  return line.replace(/\bCZK\b/g, 'HUF');
}

function extractCartSummary(cart: unknown): { itemCount: number; preview: string[] } {
  const items = asArray(cart);
  if (items.length > 0) {
    const preview = items
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const rawName = obj.productName ?? obj.name ?? obj.title;
        return typeof rawName === 'string' ? rawName.trim() : null;
      })
      .filter((name): name is string => Boolean(name))
      .slice(0, 3);
    return { itemCount: items.length, preview };
  }

  if (typeof cart === 'string') {
    const itemCountFromText = parseCartItemCountFromText(cart);
    const lines = cart
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('• '))
      .map((line) => line.replace(/^•\s*/, ''))
      .map(normalizeCartPreviewLine);

    return {
      itemCount: itemCountFromText ?? lines.length,
      preview: lines.slice(0, 3)
    };
  }

  return { itemCount: 0, preview: [] };
}

function formatCartGuardMessage(summary: { itemCount: number; preview: string[] }): string {
  const previewLines = summary.preview.length ? ['', 'Current cart:', ...summary.preview.map((name) => `- ${name}`)] : [];
  return [
    `Your Kifli cart is not empty (${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'}).`,
    'You can replace it, append new items, or cancel.',
    'What should I do?',
    ...previewLines
  ].join('\n');
}

export async function createApp() {
  const config = loadConfig();
  const logger = createLogger('order-from-kifli');

  const historyStore = new SqliteHistoryStore({
    dbPath: config.env.dbPath,
    timezone: config.env.timezone
  });
  await historyStore.initialize();

  const recipeSource = new NotionRecipeSource({
    notionToken: config.env.notionToken,
    databaseId: config.env.notionReceptekDatabaseId,
    staticConfig: config.static
  });

  const grocerClient = new KifliMcpClient({
    email: config.env.kifliEmail,
    password: config.env.kifliPassword,
    baseUrl: config.env.rohlikBaseUrl,
    debug: config.env.rohlikDebug,
    trace: config.env.rohlikTrace
  });

  const notifier = new TelegramNotifier(config.env.telegramBotToken, config.env.telegramChatId);

  const weeklyRun = new WeeklyRunOrchestrator({
    recipeSource,
    grocerClient,
    historyStore,
    notifier,
    timezone: config.env.timezone,
    weeklyTargetTotalMinutes: config.env.weeklyTargetTotalMinutes,
    defaultRecipeCount: config.env.defaultRecipeCount,
    staticConfig: config.static
  });

  const approvalHandler = new ApprovalHandler({
    historyStore
  });

  let manualRunActive = false;
  let lastManualRunAt = 0;
  const pendingCartActions = new Map<string, PendingCartAction>();

  async function createCartGuardIfNeeded(
    mode: 'plan' | 'rebuild',
    options?: ManualPlanOptions
  ): Promise<{ pendingId: string; message: string } | null> {
    try {
      const cart = await grocerClient.getCart();
      const summary = extractCartSummary(cart);
      if (summary.itemCount === 0) return null;
      const pendingId = createId('pending_cart');
      pendingCartActions.set(pendingId, {
        id: pendingId,
        mode,
        cartMode: 'replace',
        chatId: options?.chatId,
        createdAt: Date.now()
      });
      return {
        pendingId,
        message: formatCartGuardMessage(summary)
      };
    } catch (error) {
      logger.warn({ err: error, mode }, 'cart preflight check failed, continuing without confirmation');
      return null;
    }
  }

  async function executeManualPlan(
    mode: 'plan' | 'rebuild',
    options?: ManualPlanOptions,
    skipCartGuard = false,
    cartMode: 'replace' | 'append' = 'replace'
  ) {
    const now = Date.now();
    if (manualRunActive) {
      const message = 'A plan is already running. Wait for it to finish before starting another one.';
      if (options?.reportProgress) {
        await options.reportProgress(message);
      } else {
        await notifier.sendStatus(message, { chatId: options?.chatId });
      }
      return false;
    }
    if (now - lastManualRunAt < 30_000) {
      const message = 'A plan was generated very recently. Wait a bit or use the latest proposal.';
      if (options?.reportProgress) {
        await options.reportProgress(message);
      } else {
        await notifier.sendStatus(message, { chatId: options?.chatId });
      }
      return false;
    }

    if (!skipCartGuard) {
      const confirmation = await createCartGuardIfNeeded(mode, options);
      if (confirmation) return confirmation;
    }

    manualRunActive = true;
    try {
      await weeklyRun.run('manual', options?.reportProgress, options?.statusMessageId, options?.chatId, cartMode);
      lastManualRunAt = Date.now();
      return true;
    } catch (error) {
      logger.error({ err: error, mode }, `${mode} plan failed`);
      const message = `${mode === 'rebuild' ? 'Rebuild' : 'Manual plan'} failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      if (options?.reportProgress) {
        await options.reportProgress(message);
      } else {
        await notifier.sendStatus(message, { chatId: options?.chatId });
      }
      return false;
    } finally {
      manualRunActive = false;
    }
  }

  async function startBot() {
    const bot = notifier.getBot();
    await startTelegramBot(bot, {
      onManualPlan: async (options) => {
        const result = await executeManualPlan('plan', options);
        return typeof result === 'object' ? result : undefined;
      },
      onApprove: (proposalId) => approvalHandler.approve(proposalId),
      onReject: (proposalId) => approvalHandler.reject(proposalId),
      onRebuild: async (_proposalId, options) => {
        const ran = await executeManualPlan('rebuild', options);
        if (typeof ran === 'object') return ran;
        return ran ? 'Rebuilt proposal.' : 'Rebuild did not start.';
      },
      onConfirmCartReplace: async (pendingId, options) => {
        const pending = pendingCartActions.get(pendingId);
        if (!pending) return 'This cart confirmation has expired.';
        pendingCartActions.delete(pendingId);
        const ran = await executeManualPlan(
          pending.mode,
          { ...options, chatId: options?.chatId ?? pending.chatId },
          true,
          'replace'
        );
        if (typeof ran === 'object') return 'Cart confirmation is still required.';
        if (!ran) return pending.mode === 'rebuild' ? 'Rebuild did not start.' : 'Plan did not start.';
        return pending.mode === 'rebuild' ? 'Rebuilt proposal.' : 'Started with cart replacement.';
      },
      onConfirmCartAppend: async (pendingId, options) => {
        const pending = pendingCartActions.get(pendingId);
        if (!pending) return 'This cart confirmation has expired.';
        pendingCartActions.delete(pendingId);
        const ran = await executeManualPlan(
          pending.mode,
          { ...options, chatId: options?.chatId ?? pending.chatId },
          true,
          'append'
        );
        if (typeof ran === 'object') return 'Cart confirmation is still required.';
        if (!ran) return pending.mode === 'rebuild' ? 'Rebuild did not start.' : 'Plan did not start.';
        return pending.mode === 'rebuild' ? 'Rebuilt proposal by appending to cart.' : 'Started by appending to cart.';
      },
      onCancelCartReplace: async (pendingId) => {
        pendingCartActions.delete(pendingId);
        return 'Cancelled. Existing cart was left unchanged.';
      },
      onShowSwapSlots: async (proposalId) => {
        const proposal = await historyStore.getProposal(proposalId);
        if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
        return {
          recipeNames: proposal.candidate.recipes.map((recipe) => recipe.recipe.name)
        };
      },
      onShowSwapOptions: async (proposalId, slotIndex, offset) => {
        const proposal = await historyStore.getProposal(proposalId);
        if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
        return weeklyRun.getSwapOptions(proposal, slotIndex, offset);
      },
      onSwapRecipe: async (proposalId, slotIndex, replacementIndex, options) => {
        if (manualRunActive) {
          return 'A plan is already running. Wait for it to finish before swapping recipes.';
        }
        manualRunActive = true;
        try {
          const proposal = await weeklyRun.swapRecipe(
            proposalId,
            slotIndex,
            replacementIndex,
            options?.reportProgress,
            'replace'
          );
          lastManualRunAt = Date.now();
          return `Swapped recipe ${slotIndex + 1}. Updated proposal: ${proposal.candidate.recipes[slotIndex]?.recipe.name}`;
        } catch (error) {
          logger.error({ err: error, proposalId, slotIndex, replacementIndex }, 'swap recipe failed');
          return `Swap failed: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          manualRunActive = false;
        }
      },
      onListRecipes: async () => {
        const recipes = await recipeSource.listRecipes();
        return [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
      }
    });
  }

  return {
    config,
    logger,
    historyStore,
    recipeSource,
    grocerClient,
    notifier,
    weeklyRun,
    approvalHandler,
    startBot
  };
}
