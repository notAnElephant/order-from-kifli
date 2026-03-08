import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_RECEPTEK_DATABASE_ID: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),
  KIFLI_EMAIL: z.string().min(1),
  KIFLI_PASSWORD: z.string().min(1),
  ROHLIK_BASE_URL: z.string().optional().default('https://www.kifli.hu'),
  ROHLIK_DEBUG: z.string().optional().default('false'),
  TIMEZONE: z.string().default('Europe/Budapest'),
  WEEKLY_RUN_CRON: z.string().default('0 10 * * 4'),
  WEEKLY_TARGET_TOTAL_MINUTES: z.coerce.number().default(180),
  DEFAULT_RECIPE_COUNT: z.coerce.number().default(3),
  DB_PATH: z.string().default('.data/order-from-kifli.sqlite')
});

export type AppEnv = {
  notionToken: string;
  notionReceptekDatabaseId: string;
  telegramBotToken: string;
  telegramChatId: string;
  kifliEmail: string;
  kifliPassword: string;
  rohlikBaseUrl: string;
  rohlikDebug: boolean;
  timezone: string;
  weeklyRunCron: string;
  weeklyTargetTotalMinutes: number;
  defaultRecipeCount: number;
  dbPath: string;
};

export function loadEnv(): AppEnv {
  const parsed = EnvSchema.parse(process.env);
  return {
    notionToken: parsed.NOTION_TOKEN,
    notionReceptekDatabaseId: parsed.NOTION_RECEPTEK_DATABASE_ID,
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    telegramChatId: parsed.TELEGRAM_CHAT_ID,
    kifliEmail: parsed.KIFLI_EMAIL,
    kifliPassword: parsed.KIFLI_PASSWORD,
    rohlikBaseUrl: parsed.ROHLIK_BASE_URL,
    rohlikDebug: ['1', 'true', 'yes'].includes(parsed.ROHLIK_DEBUG.toLowerCase()),
    timezone: parsed.TIMEZONE,
    weeklyRunCron: parsed.WEEKLY_RUN_CRON,
    weeklyTargetTotalMinutes: parsed.WEEKLY_TARGET_TOTAL_MINUTES,
    defaultRecipeCount: parsed.DEFAULT_RECIPE_COUNT,
    dbPath: parsed.DB_PATH
  };
}
