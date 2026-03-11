import { loadConfig } from './config/index.js';
import { KifliMcpClient } from './grocer/kifli-mcp-client.js';
import { TelegramNotifier, startTelegramBot } from './notify/telegram-bot.js';
import { ApprovalHandler } from './orchestrator/approval-handler.js';
import { WeeklyRunOrchestrator } from './orchestrator/weekly-run.js';
import { NotionRecipeSource } from './recipe-source/notion.js';
import { SqliteHistoryStore } from './state/sqlite/history-store.js';
import { createLogger } from './utils/logger.js';

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
    historyStore,
    grocerClient,
    notifier
  });

  async function startBot() {
    const bot = notifier.getBot();
    await startTelegramBot(bot, {
      onManualPlan: async () => {
        try {
          await weeklyRun.run('manual');
        } catch (error) {
          logger.error({ err: error }, 'manual plan failed');
          await notifier.sendStatus(`Manual plan failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onApprove: (proposalId) => approvalHandler.approve(proposalId),
      onReject: (proposalId) => approvalHandler.reject(proposalId),
      onRebuild: async () => {
        await weeklyRun.run('manual');
        return 'Rebuilt proposal and sent a new message.';
      },
      onNextSlot: (proposalId) => approvalHandler.nextSlot(proposalId)
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
