import type { StaticConfig } from '../types.js';
import { loadEnv, type AppEnv } from './env.js';
import { loadStaticConfig } from './file-config.js';

export interface AppConfig {
  env: AppEnv;
  static: StaticConfig;
}

export function loadConfig(): AppConfig {
  return {
    env: loadEnv(),
    static: loadStaticConfig(process.cwd())
  };
}
