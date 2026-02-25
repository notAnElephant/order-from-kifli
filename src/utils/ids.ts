import { randomUUID } from 'node:crypto';

export function createId(prefix?: string): string {
  return prefix ? `${prefix}_${randomUUID()}` : randomUUID();
}
