import { DateTime } from 'luxon';

export function nowIso(timezone: string): string {
  return DateTime.now().setZone(timezone).toISO() ?? new Date().toISOString();
}

export function currentPeriod(timezone: string): { start: string; end: string } {
  const now = DateTime.now().setZone(timezone);
  const start = now.startOf('day');
  const end = start.plus({ days: 7 }).endOf('day');
  return {
    start: start.toISODate() ?? now.toISODate() ?? '',
    end: end.toISODate() ?? now.plus({ days: 7 }).toISODate() ?? ''
  };
}

export function isoDaysAgo(days: number, timezone: string): string {
  return DateTime.now().setZone(timezone).minus({ days }).toISO() ?? new Date().toISOString();
}
