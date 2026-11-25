import { expect, test } from 'vitest';
import { workingDaysBetween } from './calendar';
import { defaultConfig } from './config';
import { groupNorms, groupPlan } from './evaluate';
import type { Absence } from './staff';
import { person } from './testkit';

const on = () => defaultConfig;

test('22 рабочих дня декабря, выходные — субботы и воскресенья', () => {
  const days = workingDaysBetween('2026-12-01', '2026-12-30', defaultConfig);
  expect(days).toHaveLength(22);
  expect(days).not.toContain('2026-12-05');
  expect(days.at(-1)).toBe('2026-12-30');
});

test('план 6 оплат на месяц без запаса', () => {
  expect(groupPlan('СР1', '2026-12-30', [person({ paymentPlan: 6 })], [], on, defaultConfig).gameCents).toBe(600);
});

test('без личного плана: опытный 0,27 в день, новички 0 и 0,09', () => {
  const plan = (baseLevel: 'experienced' | 'rookie1' | 'rookie2') => groupPlan('СР1', '2026-12-30', [person({ baseLevel })], [], on, defaultConfig).gameCents;
  expect([plan('experienced'), plan('rookie1'), plan('rookie2')]).toEqual([594, 0, 198]);
});

test('норма месяца опытного', () => {
  expect(groupNorms('СР1', [person()], [], on, defaultConfig)).toEqual({ quality: 88, long: 33 });
});

test('норма месяца другой группы — ноль', () => {
  expect(groupNorms('СР2', [person()], [], on, defaultConfig)).toEqual({ quality: 0, long: 0 });
});

test('отпуск 5 рабочих дней уменьшает норму и план', () => {
  const abs: Absence[] = [{ employeeId: 'e1', kind: 'vacation', from: '2026-12-07', to: '2026-12-11' }];
  expect(groupNorms('СР1', [person()], abs, on, defaultConfig).quality).toBe(68);
  expect(groupPlan('СР1', '2026-12-30', [person({ paymentPlan: 22 })], abs, on, defaultConfig).gameCents).toBe(1700);
});

test('отсечка звезды внутри игры', () => {
  expect(defaultConfig.finaleCutoff).toBe('2026-12-29');
});
