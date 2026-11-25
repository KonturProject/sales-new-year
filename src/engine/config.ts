import type { DateStr, Level } from './types';

export interface Config {
  startDate: DateStr;
  endDate: DateStr;
  nonWorking: DateStr[];
  /** личные нормы по уровню: воронка за день и оплат в день (дробное, до 0.01) — норма группы = сумма по присутствующим */
  norms: Record<Level, { quality: number; long: number; payments: number }>;
  /** процент личного плана оплат, который идёт в план группы: запаса нет (решение владельца 24.11) */
  personalPlanPercent: number;
  /** последний день, оплаты которого идут в звезду: финал 30.12 в 13:00 */
  finaleCutoff: DateStr;
}

export const defaultConfig: Config = {
  startDate: '2026-12-01',
  endDate: '2026-12-30',
  nonWorking: ['2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13', '2026-12-19', '2026-12-20', '2026-12-26', '2026-12-27'],
  norms: {
    // оплат в день — для сотрудников без личного плана: опытный 6 в месяц, новичок 2 — 2 в месяц (22 рабочих дня)
    experienced: { quality: 4, long: 1.5, payments: 0.27 },
    rookie1: { quality: 1, long: 0, payments: 0 },
    rookie2: { quality: 2, long: 1, payments: 0.09 },
  },
  personalPlanPercent: 100,
  finaleCutoff: '2026-12-29',
};
