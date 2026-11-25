import { expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { finale, type FinaleInput } from './finale';
import { person } from './testkit';
import { GROUPS, type GroupCode } from './types';

const each = <T,>(f: (g: GroupCode, i: number) => T) => Object.fromEntries(GROUPS.map((g, i) => [g, f(g, i)])) as Record<GroupCode, T>;
const base = (): FinaleInput => ({
  cutoff: '2026-12-29',
  percents: { СР1: 60, СР2: 95, СР3: 130, СР5: 80, СР6: 97, СР9: 120 },
  paid: 180, gameCents: 20000, toys: each(() => 5), things: each(() => 3), treeFull: true,
  qualityPercents: each(() => 90), longPercents: each(() => 100), weekBest: each(() => 20),
  rank: { staff: [], absences: [], payments: [], funnel: [], cfg },
});
const titleOf = (r: ReturnType<typeof finale>, g: GroupCode) => r.nominations.filter((n) => n.groups.includes(g)).map((n) => n.id);

test('звезду надевает лучший по дробному проценту', () => {
  const r = finale({ ...base(), percents: { ...base().percents, СР3: 97.6, СР6: 97.61, СР9: 90 } });
  expect(r.winners).toEqual(['СР6']);
});

test('точная ничья — надевают вместе', () => {
  expect(finale({ ...base(), percents: { ...base().percents, СР3: 130, СР9: 130 } }).winners).toEqual(['СР3', 'СР9']);
});

test('все нули — победителя нет', () => {
  expect(finale({ ...base(), percents: each(() => 0) }).winners).toEqual([]);
});

test('итог филиала', () => {
  expect(finale(base()).branch).toEqual({ paid: 180, percent: 90, toys: 30, treeFull: true });
});

test('шесть разных групп — у каждой ровно одна номинация', () => {
  const r = finale({
    ...base(),
    toys: { СР1: 5, СР2: 9, СР3: 20, СР5: 7, СР6: 8, СР9: 18 },
    things: { СР1: 10, СР2: 4, СР3: 3, СР5: 5, СР6: 6, СР9: 2 },
    longPercents: { СР1: 101, СР2: 106, СР3: 134, СР5: 141, СР6: 117, СР9: 140 },
    qualityPercents: { СР1: 89, СР2: 99, СР3: 97, СР5: 106, СР6: 111, СР9: 91 },
    weekBest: { СР1: 12, СР2: 30, СР3: 28, СР5: 20, СР6: 25, СР9: 27 },
  });
  for (const g of GROUPS) expect(titleOf(r, g)).toHaveLength(1);
  expect(titleOf(r, 'СР3')).toEqual(['plan']);
  expect(titleOf(r, 'СР9')).toEqual(['toys']);
  expect(titleOf(r, 'СР1')).toEqual(['house']);
  expect(titleOf(r, 'СР5')).toEqual(['long']);
  expect(titleOf(r, 'СР6')).toEqual(['quality']);
  expect(titleOf(r, 'СР2')).toEqual(['week']);
});

test('равенство — номинацию получают обе, последняя группа — «Дружная команда»', () => {
  const r = finale({
    ...base(),
    toys: { СР1: 1, СР2: 18, СР3: 20, СР5: 2, СР6: 3, СР9: 18 },
    things: { СР1: 4, СР2: 0, СР3: 0, СР5: 9, СР6: 5, СР9: 0 },
    longPercents: { СР1: 90, СР2: 0, СР3: 0, СР5: 0, СР6: 120, СР9: 0 },
    qualityPercents: { СР1: 95, СР2: 0, СР3: 0, СР5: 0, СР6: 0, СР9: 0 },
  });
  expect(r.nominations.find((n) => n.id === 'toys')!.groups).toEqual(['СР2', 'СР9']);
  expect(GROUPS.map((g) => titleOf(r, g).length)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(r.nominations.every((n) => n.groups.length > 0)).toBe(true);
});

test('номинацию за ноль не дают', () => {
  const r = finale({ ...base(), things: each(() => 0), toys: each((g) => (g === 'СР9' ? 5 : 0)) });
  expect(r.nominations.some((n) => n.id === 'house')).toBe(false);
  for (const g of GROUPS) expect(titleOf(r, g)).toHaveLength(1);
});

test('лучший сотрудник группы: больше оплат, ничья — оба, после отсечки не считаем', () => {
  const staff = [person({ id: 'a' }), person({ id: 'b' }), person({ id: 'c' }), person({ id: 'd', group: 'СР2' })];
  const pay = (employeeId: string, invoice: string, date = '2026-12-10') => ({ employeeId, invoice, date });
  const r = finale({
    ...base(),
    rank: { staff, absences: [], funnel: [], cfg, payments: [pay('a', '1'), pay('a', '2'), pay('b', '3'), pay('b', '4'), pay('c', '5'), pay('c', '6', '2026-12-30'), pay('c', '7', '2026-12-30')] },
  });
  expect(r.best['СР1']).toEqual({ employeeIds: ['a', 'b'], value: 2 });
  expect(r.best['СР2']).toEqual({ employeeIds: [], value: 0 });
});
