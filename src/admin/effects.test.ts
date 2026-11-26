import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { emptySnapshot } from '@/data/testkit';
import type { Employee } from '@/engine/staff';
import { effectsOf } from './effects';
import { withFunnelImport, type FunnelPlan } from './importPlan';

const emp = (id: string, name: string, group: Employee['group']): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
/** 10.12: СР1 и СР2 по одному опытному, воронка по 08.12 у СР1 — по 4 счёта 6+ и 1 счёту 20+ в день. */
const before = (over: Partial<Snapshot> = {}): Snapshot => emptySnapshot(1, {
  serverNow: '2026-12-10T10:00:00+03:00',
  funnelThrough: '2026-12-08',
  staff: [emp('a1', 'Тест Альфов', 'СР1'), emp('b1', 'Тест Бетов', 'СР2')],
  funnel: ['2026-12-07', '2026-12-08'].map((date) => ({ employeeId: 'a1', date, quality: 4, long: 1 })),
  ...over,
});
const plan = (rows: FunnelPlan['rows']): FunnelPlan => ({ through: '2026-12-09', rows, newStaff: [], outside: 0, dropped: 0, zeroThrough: false });

describe('effectsOf: что изменит загрузка', () => {
  test('воронка за день прибавляет СР1 снежинки и ключики, СР2 не трогает', () => {
    const s = before();
    const { now, stale } = effectsOf(s, withFunnelImport(s, plan([{ name: 'Тест Альфов', date: '2026-12-09', quality: 6, long: 3 }])));
    expect(now.map((c) => c.group)).toEqual(['СР1']);
    const [c] = now;
    expect(c!.after.flakes).toBeGreaterThan(c!.before.flakes);
    expect(c!.after.keys).toBeGreaterThan(c!.before.keys);
    expect([c!.after.percent, c!.after.coins]).toEqual([c!.before.percent, c!.before.coins]);
    expect(stale).toEqual([]);
  });

  test('те же числа ещё раз — ничего не меняется', () => {
    const s = before();
    expect(effectsOf(s, withFunnelImport(s, plan([{ name: 'Тест Альфов', date: '2026-12-08', quality: 4, long: 1 }]))).now).toEqual([]);
  });
});
