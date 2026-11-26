import type { Snapshot } from './api';

/** Пустой снимок площади на 10.12.2026, 10:00 — основа для тестов. */
export const emptySnapshot = (version = 1, over: Partial<Snapshot> = {}): Snapshot => ({
  version, serverNow: '2026-12-10T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], corrections: [],
  purchases: [], grants: [], lastPaymentAt: null, grinch: { auto: true, quietMin: 120, commands: [] }, finale: null, commands: [],
  ...over,
});
