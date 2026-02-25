import { createApp } from '../app.js';

async function main() {
  const app = await createApp();
  const proposal = await app.weeklyRun.run('manual');
  app.logger.info({ proposalId: proposal.id }, 'proposal created');
  console.log(`Created proposal ${proposal.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
