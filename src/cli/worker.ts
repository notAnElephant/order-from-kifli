import cron from 'node-cron';
import { createApp } from '../app.js';

async function main() {
  const app = await createApp();

  cron.schedule(
    app.config.env.weeklyRunCron,
    async () => {
      app.logger.info('starting scheduled weekly run');
      try {
        const proposal = await app.weeklyRun.run('scheduled');
        app.logger.info({ proposalId: proposal.id }, 'scheduled proposal created');
      } catch (error) {
        app.logger.error({ err: error }, 'scheduled weekly run failed');
        await app.notifier.sendStatus(
          `Scheduled planning failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    { timezone: app.config.env.timezone }
  );

  app.logger.info({ cron: app.config.env.weeklyRunCron }, 'worker started');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
