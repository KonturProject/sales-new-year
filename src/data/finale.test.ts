import { describe, expect, test } from 'vitest';
import type { Employee } from '@/engine/staff';
import { buy, thing } from '@/engine/testkit';
import type { GroupCode } from '@/engine/types';
import { finaleOf } from './finale';
import { emptySnapshot } from './testkit';

const emp = (id: string, group: GroupCode): Employee => ({
  id, name: `Тест ${id}`, shortName: id, group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const pay = (group: GroupCode, author: string, n: number, date = '2026-12-07') =>
  Array.from({ length: n }, (_, i) => ({ date, group, author, invoice: `${group}-${author}-${date}-${i}` }));

/** По одному опытному в каждой группе; оплаты за 07.12 у СР2 (4) и СР5 (2), позже отсечки — у СР5 ещё 9. */
const world = () => emptySnapshot(1, {
  serverNow: '2026-12-30T11:50:00+03:00',
  paymentsImportedThrough: '2026-12-29',
  staff: (['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'] as const).map((g, i) => emp(`e${i}`, g)),
  payments: [...pay('СР2', 'Тест e1', 4), ...pay('СР5', 'Тест e3', 2), ...pay('СР5', 'Тест e3', 9, '2026-12-30')],
  purchases: [buy(1, 'СР3', 1, 1), buy(2, 'СР3', 1, 2), thing(3, 'СР6', 201)],
});

describe('finaleOf: финал по снимку и отсечке', () => {
  test('звезда — лучшему проценту плана по отсечку; оплаты позже отсечки не считаются', () => {
    const r = finaleOf(world(), '2026-12-29');
    expect(r.cutoff).toBe('2026-12-29');
    expect(r.winners).toEqual(['СР2']);
    expect(r.percents['СР2']).toBeGreaterThan(r.percents['СР5']);
    expect(r.branch.paid).toBe(6);
  });

  test('отсечка 30.12 — СР5 обгоняет', () => {
    expect(finaleOf(world(), '2026-12-30').winners).toEqual(['СР5']);
  });

  test('номинации: план, нарядная ёлка, уютный домик; лучший сотрудник группы — по оплатам', () => {
    const r = finaleOf(world(), '2026-12-29');
    expect(r.nominations.slice(0, 3).map((n) => [n.id, n.groups])).toEqual([['plan', ['СР2']], ['toys', ['СР3']], ['house', ['СР6']]]);
    expect(r.branch.toys).toBe(2);
    expect(r.best['СР2']).toEqual({ employeeIds: ['e1'], value: 4 });
  });

  test('платёжки 30.12 (после отсечки 29.12) не трогают ни звезду, ни номинации, ни «Неделю года»', () => {
    const base = world();
    const late = { ...base, provisional: [{ date: '2026-12-30', group: 'СР9' as const, count: 40 }] };
    const a = finaleOf(base, '2026-12-29');
    const b = finaleOf(late, '2026-12-29');
    expect(b.winners).toEqual(a.winners);
    expect(b.nominations).toEqual(a.nominations);
    expect(b.branch).toEqual(a.branch);
  });

  test('отсечка раньше загрузки (24.12 при оплатах по 29.12): оплаты 28–29.12 не попадают в «Неделю года»', () => {
    const base = world();
    const late = { ...base, payments: [...base.payments, ...pay('СР9', 'Тест e5', 30, '2026-12-28')] };
    expect(finaleOf(late, '2026-12-24').nominations).toEqual(finaleOf(base, '2026-12-24').nominations);
  });
});
