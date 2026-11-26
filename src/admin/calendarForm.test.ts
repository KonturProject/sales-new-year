import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import { defaultConfig } from '@/engine/config';
import type { Employee } from '@/engine/staff';
import type { DateStr } from '@/engine/types';
import { calendarChanges, calendarPreview, calendarWeeks, toggleDay } from './calendarForm';

const emp = (id: string, name: string): Employee => ({
  id, name, shortName: name, group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const pay = (date: DateStr, n: number) => ({ date, group: 'СР1' as const, author: 'Тест Альфов', invoice: `P-${date}-${n}` });

/**
 * Вымышленный мир: сегодня 04.12, воронка загружена по 03.12 — это встроенный выходной. Альфов (СР1, опытный: нормы по
 * умолчанию 5 качественных, 3 длинных) выполнил норму 01 и 02.12, а за выходное 03.12 в воронке стоят нули (отчёт
 * выгружен и за него).
 */
const world = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-12-04T10:00:00+03:00', funnelThrough: '2026-12-03', paymentsImportedThrough: '2026-12-03',
  config: {}, configChanges: [],
  staff: [emp('a1', 'Тест Альфов')],
  absences: [], provisional: [], purchases: [], grants: [], lastPaymentAt: null, grinch: { auto: true, quietMin: 120, commands: [] }, finale: null, commands: [],
  payments: [1, 2, 3].map((n) => pay('2026-12-01', n)).concat([1, 2, 3].map((n) => pay('2026-12-02', n))),
  funnel: [fun('a1', '2026-12-01', 5, 3), fun('a1', '2026-12-02', 5, 3), fun('a1', '2026-12-03', 0, 0)],
  ...over,
});
const without = (list: DateStr[], day: DateStr) => list.filter((d) => d !== day);

describe('calendarWeeks: дни игры сеткой по неделям', () => {
  const weeks = calendarWeeks(defaultConfig);

  test('01.12.2026 — вторник: первая строка из шести дней, последняя — 28–30.12', () => {
    expect(weeks).toHaveLength(5);
    expect(weeks.map((w) => w.length)).toEqual([6, 7, 7, 7, 3]);
    expect(weeks[0][0].date).toBe('2026-12-01');
    expect(weeks[1][0].date).toBe('2026-12-07');
    expect(weeks[4][0].date).toBe('2026-12-28');
    expect(weeks[4][2].date).toBe('2026-12-30');
    expect(new Date('2026-12-01T00:00:00Z').getUTCDay()).toBe(2);
  });

  test('встроенные выходные отмечены, остальные дни рабочие', () => {
    const off = weeks.flat().filter((d) => d.off).map((d) => d.date);
    expect(off).toEqual(defaultConfig.nonWorking);
    expect(off).toEqual(['2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13', '2026-12-19', '2026-12-20', '2026-12-26', '2026-12-27']);
    expect(weeks[0].map((d) => d.off)).toEqual([false, false, false, false, true, true]);
  });

  test('календарь берётся из настроек: заданный список и пустой список («выходных нет»)', () => {
    const custom = configOf({ nonWorking: ['2026-12-04', '2026-12-05'] });
    expect(calendarWeeks(custom).flat().filter((d) => d.off).map((d) => d.date)).toEqual(['2026-12-04', '2026-12-05']);
    expect(calendarWeeks(configOf({ nonWorking: [] })).flat().some((d) => d.off)).toBe(false);
  });
});

describe('toggleDay и calendarChanges', () => {
  test('переключение добавляет и убирает день, список остаётся отсортированным, исходный не меняется', () => {
    const list = ['2026-12-03', '2026-12-07'];
    expect(toggleDay(list, '2026-12-04')).toEqual(['2026-12-03', '2026-12-04', '2026-12-07']);
    expect(toggleDay(list, '2026-12-03')).toEqual(['2026-12-07']);
    expect(list).toEqual(['2026-12-03', '2026-12-07']);
  });

  test('calendarChanges: какие дни станут выходными и какие рабочими; одинаковые списки — пусто', () => {
    expect(calendarChanges(['2026-12-03', '2026-12-06'], ['2026-12-04', '2026-12-06'])).toEqual({ added: ['2026-12-04'], removed: ['2026-12-03'] });
    expect(calendarChanges(['2026-12-03'], ['2026-12-03'])).toEqual({ added: [], removed: [] });
  });
});

describe('calendarPreview: что изменится, если выходные станут такими', () => {


  test('день, ещё не оценённый (воронки за него нет), в «итогах дней» не появляется; сегодняшний день тоже можно сделать выходным', () => {
    const s = world();
    const preview = calendarPreview(s, [...defaultConfig.nonWorking, '2026-12-04', '2026-12-08'].sort());
    expect(preview.stale).toEqual([]);
  });

  test('список не изменился — пустые списки', () => {
    expect(calendarPreview(world(), defaultConfig.nonWorking)).toEqual({ now: [], stale: [] });
  });

  test('снимок не меняется, а чтения по нему остаются прежними', () => {
    const s = world();
    const copy = structuredClone(s);
    const first = calendarPreview(s, without(defaultConfig.nonWorking, '2026-12-03'));
    expect(s).toEqual(copy);
    expect(calendarPreview(s, without(defaultConfig.nonWorking, '2026-12-03'))).toEqual(first);
    expect(calendarPreview(s, defaultConfig.nonWorking)).toEqual({ now: [], stale: [] }); // кэш снимка не испорчен предыдущим расчётом
  });
});
