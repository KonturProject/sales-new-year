import { expect, test } from 'vitest';
import { defaultConfig as cfg } from './config';
import { GROUPS, type DateStr, type GroupCode } from './types';
import { weekResults, weeksOf } from './weeks';

const none = () => Object.fromEntries(GROUPS.map((g) => [g, {}])) as Record<GroupCode, Record<DateStr, number>>;
/** План группы на день в сотых: у СР6 маленький, у СР3 большой. */
const planCentsOn = (g: GroupCode) => (g === 'СР6' ? 80 : g === 'СР3' ? 400 : g === 'СР9' ? 0 : 200);
const run = (pay: Partial<Record<GroupCode, Record<DateStr, number>>>, importedThrough: DateStr | null, finaleDone = false) =>
  weekResults({ paymentsByDay: { ...none(), ...pay }, planCentsOn, importedThrough, finaleDone, cfg });

test('пять недель: границы, пятая до отсечки', () => {
  expect(weeksOf(cfg).map((w) => [w.from.slice(8), w.to.slice(8)])).toEqual([['01', '04'], ['07', '11'], ['14', '18'], ['21', '25'], ['28', '29']]);
});

test('неделя не решена, пока не загружена её пятница', () => {
  expect(run({ СР1: { '2026-12-02': 3 } }, '2026-12-03')[0]).toMatchObject({ n: 1, decided: false, winners: [] });
  expect(run({ СР1: { '2026-12-02': 3 } }, '2026-12-04')[0]).toMatchObject({ decided: true, winners: ['СР1'] });
  expect(run({}, null).every((w) => !w.decided)).toBe(true);
});

test('побеждает процент, а не сумма', () => {
  // СР6: 2 из 3,2 (62,5 %); СР3: 5 из 16 (31,25 %)
  const w = run({ СР6: { '2026-12-01': 2 }, СР3: { '2026-12-01': 5 } }, '2026-12-04')[0]!;
  expect(w.winners).toEqual(['СР6']);
  expect(w.percents['СР6']).toBeCloseTo(62.5);
  expect(w.percents['СР3']).toBeCloseTo(31.25);
});

test('ничья — оба', () => {
  expect(run({ СР1: { '2026-12-01': 4 }, СР2: { '2026-12-04': 4 } }, '2026-12-04')[0]!.winners).toEqual(['СР1', 'СР2']);
});

test('группа без плана не побеждает и без процента', () => {
  const w = run({ СР9: { '2026-12-01': 9 }, СР1: { '2026-12-01': 1 } }, '2026-12-04')[0]!;
  expect([w.percents['СР9'], w.winners]).toEqual([null, ['СР1']]);
});

test('оплата в субботу идёт в следующую неделю: решённая неделя не меняется', () => {
  const weeks = run({ СР1: { '2026-12-05': 8 }, СР2: { '2026-12-04': 1 } }, '2026-12-11');
  expect([weeks[0]!.winners, weeks[1]!.winners]).toEqual([['СР2'], ['СР1']]);
});

test('оплаты пятой недели после отсечки не считаются', () => {
  const w = run({ СР1: { '2026-12-30': 9 }, СР2: { '2026-12-29': 1 } }, '2026-12-30', true)[4]!;
  expect(w.winners).toEqual(['СР2']);
});

test('пятая неделя решается только финалом', () => {
  expect(run({ СР2: { '2026-12-28': 1 } }, '2026-12-29')[4]!.decided).toBe(false);
  expect(run({ СР2: { '2026-12-28': 1 } }, '2026-12-29', true)[4]!).toMatchObject({ decided: true, winners: ['СР2'] });
});

test('все нули — победителей нет', () => {
  expect(run({}, '2026-12-04')[0]).toMatchObject({ decided: true, winners: [] });
});

test('выходной посреди недели из админки: границы недели сдвигаются на рабочие дни', () => {
  const holiday = { ...cfg, nonWorking: [...cfg.nonWorking, '2026-12-11'] };
  expect(weeksOf(holiday)[1]).toMatchObject({ from: '2026-12-07', to: '2026-12-10' });
});
