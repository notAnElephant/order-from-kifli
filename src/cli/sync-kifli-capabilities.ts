import dotenv from 'dotenv';
import { z } from 'zod';
import { KifliMcpClient } from '../grocer/kifli-mcp-client.js';

dotenv.config();

const EnvSchema = z.object({
  KIFLI_EMAIL: z.string().min(1),
  KIFLI_PASSWORD: z.string().min(1),
  ROHLIK_BASE_URL: z.string().optional().default('https://www.kifli.hu'),
  ROHLIK_DEBUG: z.string().optional().default('false')
});

async function main() {
  const env = EnvSchema.parse(process.env);
  const grocerClient = new KifliMcpClient({
    email: env.KIFLI_EMAIL,
    password: env.KIFLI_PASSWORD,
    baseUrl: env.ROHLIK_BASE_URL,
    debug: ['1', 'true', 'yes'].includes(env.ROHLIK_DEBUG.toLowerCase())
  });
  const capabilities = await grocerClient.getCapabilities();
  console.log(JSON.stringify(capabilities, null, 2));
  await grocerClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
