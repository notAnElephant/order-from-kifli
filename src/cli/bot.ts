import { createApp } from '../app.js';

async function main() {
  const app = await createApp();
  app.logger.info('starting telegram bot');
  await app.startBot();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
