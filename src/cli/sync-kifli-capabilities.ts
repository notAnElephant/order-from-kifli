import { createApp } from '../app.js';

async function main() {
  const app = await createApp();
  const capabilities = await app.grocerClient.getCapabilities();
  console.log(JSON.stringify(capabilities, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
