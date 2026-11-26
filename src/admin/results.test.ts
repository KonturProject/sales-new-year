import { describe, expect, test } from 'vitest';
import type { Snapshot, SnapshotCorrection } from '@/data/api';
import { buildFacts, effectiveFacts } from '@/data/facts';
import { timelineOf } from '@/data/config';
import { evaluateDay, groupPlan, paymentPlanCents } from '@/engine/evaluate';
import type { Employee } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import { groupFunnel } from '@/data/metrics';
import {
  correctionItems, correctionViews, dayResults, defaultResultsDay, resultsDays,
  type EmployeeLine, type GroupLine,
} from './results';

const emp = (id: string, name: string, group: GroupCode = 'СР1', extra: Partial<Employee> = {}): Employee => ({
  id, name, shortName: name, group, hireDate: null, fireDate: null, baseLevel: 'experienced',
  hiddenFromRating: false, transfers: [], ...extra,
});
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  version: 1, serverNow: '2026-12-11T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], purchases: [], grants: [], lastPaymentAt: null, grinch: { auto: true, quietMin: 120, commands: [] }, finale: null, commands: [], ...over,
  config: { nonWorking: ['2026-12-03', '2026-12-06', '2026-12-07', '2026-12-13', '2026-12-14', '2026-12-20', '2026-12-21', '2026-12-27', '2026-12-28'], ...(over.config ?? {}) },
});
const pay = (date: DateStr, group: GroupCode, author: string, invoice: string) => ({ date, group, author, invoice });
const fun = (employeeId: string, date: DateStr, quality: number, long: number) => ({ employeeId, date, quality, long });
const corr = (id: number, date: DateStr, employeeId: string, kind: SnapshotCorrection['kind'], delta: number, base = 0): SnapshotCorrection => ({
  id, date, employeeId, kind, delta, base,
});
const lineOf = (lines: GroupLine[], group: GroupCode) => lines.find((l) => l.group === group)!;
const personOf = (lines: GroupLine[], group: GroupCode, id: string) => lineOf(lines, group).employees.find((e) => e.id === id)!;

/**
 * Вымышленный мир. Нормы опытного: качественных 4, длинных 1,5, оплат 1 в день; у новичка 1-й недели 1 / 0 / 0.
 * 01.12 пн, 02.12 вт — рабочие, 03.12 — выходной, 04.12 ср — рабочий. Воронка загружена по 02.12.
 * СР1: Альфов, Бетов (отпуск 03–04.12), Гаммов (новичок с 01.12); СР2: Вегов.
 */
const world = (over: Partial<Snapshot> = {}): Snapshot =>
  snap({
    config: { norms: { experienced: { quality: 4, long: 1.5, payments: 1 } } },
    staff: [
      emp('a1', 'Тест Альфов'),
      emp('a2', 'Тест Бетов'),
      emp('a3', 'Тест Гаммов', 'СР1', { baseLevel: 'rookie1', hireDate: '2026-12-01' }),
      emp('b1', 'Тест Вегов', 'СР2'),
    ],
    absences: [{ employeeId: 'a2', kind: 'vacation', from: '2026-12-02', to: '2026-12-04' }],
    funnelThrough: '2026-12-02',
    paymentsImportedThrough: '2026-12-03',
    funnel: [
      fun('a1', '2026-12-01', 4, 2), fun('a2', '2026-12-01', 3, 1), fun('a3', '2026-12-01', 1, 0), fun('b1', '2026-12-01', 4, 2),
      fun('a1', '2026-12-02', 4, 1), fun('a2', '2026-12-02', 9, 9), fun('a3', '2026-12-02', 1, 0), fun('b1', '2026-12-02', 4, 2),
    ],
    payments: [
      pay('2026-12-01', 'СР1', 'Тест Альфов', 'F-1'),
      pay('2026-12-02', 'СР1', 'Тест Альфов', 'F-2'),
      pay('2026-12-02', 'СР1', 'Тест Альфов', 'F-3'),
      pay('2026-12-02', 'СР1', 'Тест Бетов', 'F-4'),
      pay('2026-12-02', 'СР1', 'Тест Посторонний', 'F-5'),
      pay('2026-12-03', 'СР1', 'Тест Альфов', 'F-6'),
      pay('2026-12-02', 'СР2', 'Тест Вегов', 'G-1'),
      pay('2026-12-06', 'СР2', 'Тест Вегов', 'W-1'),
    ],
    ...over,
  });

describe('resultsDays и defaultResultsDay', () => {
  test('дни игры с 01.12 по вчера сервера, выходные помечены', () => {
    const days = resultsDays(snap({ serverNow: '2026-12-05T09:00:00+03:00' }));
    expect(days).toEqual([
      { date: '2026-12-01', working: true }, { date: '2026-12-02', working: true },
      { date: '2026-12-03', working: false }, { date: '2026-12-04', working: true },
    ]);
  });

  test('до старта игры дней нет, после конца — только дни игры', () => {
    expect(resultsDays(snap({ serverNow: '2026-12-01T09:00:00+03:00' }))).toEqual([]);
    const late = resultsDays(snap({ serverNow: '2026-12-31T09:00:00+03:00' }));
    expect(late[0].date).toBe('2026-12-01');
    expect(late.at(-1)).toEqual({ date: '2026-12-30', working: true });
  });

  test('пустой список выходных: все дни рабочие', () => {
    const days = resultsDays(snap({ serverNow: '2026-12-09T09:00:00+03:00', config: { nonWorking: [] } }));
    expect(days).toHaveLength(8);
    expect(days.every((d) => d.working)).toBe(true);
  });

  test('по умолчанию — последний рабочий день не позже funnelThrough и не позже вчерашнего', () => {
    expect(defaultResultsDay(snap({ funnelThrough: '2026-12-05' }))).toBe('2026-12-05');
    // воронка по воскресенье 07.12: последний рабочий — пятница 05.12
    expect(defaultResultsDay(snap({ funnelThrough: '2026-12-07' }))).toBe('2026-12-05');
    // воронка дальше вчерашнего (вчера 10.12) — берём вчерашний рабочий
    expect(defaultResultsDay(snap({ funnelThrough: '2026-12-19' }))).toBe('2026-12-10');
  });

  test('без воронки — вчерашний день игры, даже выходной', () => {
    expect(defaultResultsDay(snap())).toBe('2026-12-10');
    expect(defaultResultsDay(snap({ serverNow: '2026-12-08T10:00:00+03:00' }))).toBe('2026-12-07');
  });

  test('игра ещё не началась (вчера раньше 01.12): дней нет, значения по умолчанию тоже', () => {
    expect(defaultResultsDay(snap({ serverNow: '2026-11-28T10:00:00+03:00' }))).toBeNull();
    expect(defaultResultsDay(snap({ serverNow: '2026-12-01T10:00:00+03:00', funnelThrough: '2026-12-01' }))).toBeNull();
    expect(defaultResultsDay(snap({ serverNow: '2026-12-02T10:00:00+03:00' }))).toBe('2026-12-01');
  });

  test('воронка раньше первого рабочего дня — тоже вчерашний день игры', () => {
    expect(defaultResultsDay(snap({ funnelThrough: '2026-11-30' }))).toBe('2026-12-10');
  });
});

describe('dayResults: строка группы за рабочий день', () => {
  const s = world();
  const lines = dayResults(s, '2026-12-02');
  const sr1 = lineOf(lines, 'СР1');

  test('шесть групп в порядке игры, имя героя из темы комнаты', () => {
    expect(lines.map((l) => l.group)).toEqual(GROUPS);
    expect(sr1.hero).toBe('Лев');
  });

  test('план и факт за день совпадают с evaluateDay, paymentPlanCents и paymentsByDay', () => {
    const cfg = timelineOf(s).at('2026-12-02');
    const r = evaluateDay('СР1', '2026-12-02', s.staff, s.absences, effectiveFacts(s).funnel, cfg);
    expect(sr1.day.quality).toMatchObject({ fact: r.factQuality, plan: r.normQuality });
    expect(sr1.day.long).toMatchObject({ fact: r.factLong, plan: r.normLong });
    expect(sr1.day.payments.plan).toBe(paymentPlanCents('СР1', '2026-12-02', s.staff, s.absences, cfg) / 100);
    expect(sr1.day.payments.fact).toBe(effectiveFacts(s).paymentsByDay.СР1['2026-12-02']);
    // числа руками: на работе Альфов (4 / 1,5 / 1) и новичок Гаммов (1 / 0 / 0); Бетов в отпуске
    expect(sr1.day.quality).toMatchObject({ fact: 5, plan: 5 });
    expect(sr1.day.long).toMatchObject({ fact: 1, plan: 1.5 });
    expect(sr1.day.payments).toMatchObject({ fact: 4, plan: 1, weekend: 0, corrected: 0, stale: false });
  });



  test('выходной не оценивается; плана нет ни у одного показателя, оплаты — этого календарного дня', () => {
    const sat = lineOf(dayResults(s, '2026-12-06'), 'СР2');
    expect(sat.outcome).toEqual({ evaluated: false, reason: 'weekend' });
    expect(sat.day.quality.plan).toBeNull();
    expect(sat.day.long.plan).toBeNull();
    expect(sat.day.payments).toMatchObject({ fact: 1, plan: null });
    expect(sat.employees[0].day.payments.plan).toBeNull();
  });

  test('рабочий день после funnelThrough: «воронки нет», плана воронки нет, оплаты — корзина с выходным', () => {
    const wed = lineOf(dayResults(s, '2026-12-04'), 'СР1');
    expect(wed.outcome).toEqual({ evaluated: false, reason: 'no-funnel' });
    expect(wed.day.quality).toMatchObject({ fact: 0, plan: null });
    expect(wed.day.long).toMatchObject({ fact: 0, plan: null });
    // корзина 04.12: 03.12 (выходной, F-6) и 04.12; Бетов в отпуске, Альфов и Гаммов на работе
    expect(wed.day.payments).toMatchObject({ fact: 1, weekend: 1, plan: 1 });
    expect(personOf(dayResults(s, '2026-12-04'), 'СР1', 'a1').day.payments).toMatchObject({ fact: 1, weekend: 1, plan: 1 });
  });

  test('выходные пн: оплата субботы идёт в корзину понедельника, из них в выходные 1', () => {
    const mon = lineOf(dayResults(s, '2026-12-08'), 'СР2');
    expect(mon.outcome).toEqual({ evaluated: false, reason: 'no-funnel' });
    expect(mon.day.payments).toMatchObject({ fact: 1, weekend: 1 });
    expect(personOf(dayResults(s, '2026-12-08'), 'СР2', 'b1').day.payments).toMatchObject({ fact: 1, weekend: 1 });
    // пятница 05.12 — в корзине только свой день
    expect(lineOf(dayResults(s, '2026-12-05'), 'СР2').day.payments).toMatchObject({ fact: 0, weekend: 0 });
  });


});

describe('dayResults: с начала игры по день', () => {
  const s = world();

  test('воронка: факт — то же, что табло ТВ (groupFunnel), план — нормы оценённых рабочих дней', () => {
    const sr1 = lineOf(dayResults(s, '2026-12-02'), 'СР1');
    const tv = groupFunnel(buildFacts(s, '2026-12-11').rank, '2026-12-02');
    expect(sr1.total.quality.fact).toBe(tv.СР1.quality);
    expect(sr1.total.long.fact).toBe(tv.СР1.long);
    // руками: строки Альфова 4+4, Бетова 3+9 (в отпуске, но строка в факте), Гаммова 1+1
    expect(sr1.total.quality).toMatchObject({ fact: 22, plan: 14 });
    expect(sr1.total.long).toMatchObject({ fact: 13, plan: 4.5 });
  });

  test('день после funnelThrough: факт и план воронки только по оценённым дням', () => {
    const sr1 = lineOf(dayResults(s, '2026-12-04'), 'СР1');
    expect(sr1.total.quality).toMatchObject({ fact: 22, plan: 14 });
    expect(sr1.total.long).toMatchObject({ fact: 13, plan: 4.5 });
  });

  test('строка выходного входит в факт воронки, но не в план', () => {
    const w = world({ funnelThrough: '2026-12-04', funnel: [...world().funnel, fun('a1', '2026-12-03', 2, 0)] });
    const sr1 = lineOf(dayResults(w, '2026-12-04'), 'СР1');
    // факт: 22 + 2 в выходной; план: 01.12 (9) + 02.12 (5) + 04.12 (Альфов 4 + Гаммов 1 = 5)
    expect(sr1.total.quality).toMatchObject({ fact: 24, plan: 19 });
  });

  test('оплаты: все даты не позже D (выходные тоже), план — рабочие дни; даты после D не входят', () => {
    const sr1 = lineOf(dayResults(s, '2026-12-02'), 'СР1');
    // 01.12: F-1; 02.12: F-2..F-5. F-6 (03.12) после D
    expect(sr1.total.payments).toMatchObject({ fact: 5, plan: 3 });
    const later = lineOf(dayResults(s, '2026-12-04'), 'СР1');
    expect(later.total.payments.fact).toBe(6);
    const sr2 = lineOf(dayResults(s, '2026-12-08'), 'СР2');
    expect(sr2.total.payments.fact).toBe(2); // G-1 и W-1 (суббота)
  });

  test('процент плана оплат на всю игру: оплаты до D к плану на все рабочие дни игры', () => {
    const sr1 = lineOf(dayResults(s, '2026-12-02'), 'СР1');
    const cfg = timelineOf(s).at('2026-12-02');
    const { gameCents } = groupPlan('СР1', '2026-12-02', s.staff, s.absences, timelineOf(s).at, cfg);
    expect(gameCents).toBeGreaterThan(0);
    expect(sr1.gamePlanPercent).toBe(Math.floor((5 * 10000) / gameCents));
  });

  test('плана оплат нет совсем: процент null', () => {
    const none = world({ config: { norms: { experienced: { payments: 0 }, rookie1: { payments: 0 }, rookie2: { payments: 0 } } } });
    expect(lineOf(dayResults(none, '2026-12-02'), 'СР1').gamePlanPercent).toBeNull();
  });
});

describe('dayResults: сотрудники', () => {
  const s = world();
  const lines = dayResults(s, '2026-12-02');

  test('в списке все из группы на день, в том числе отсутствующие; порядок по ФИО', () => {
    expect(lineOf(lines, 'СР1').employees.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
    expect(lineOf(lines, 'СР2').employees.map((e) => e.id)).toEqual(['b1']);
  });

  test('сотрудник и его показатели: уровень, факт и план за день и с начала игры', () => {
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1).toMatchObject({ name: 'Тест Альфов', level: 'experienced', absence: null, inGroupTotal: true, hidden: false });
    expect(a1.day.quality).toMatchObject({ fact: 4, plan: 4 });
    expect(a1.day.long).toMatchObject({ fact: 1, plan: 1.5 });
    expect(a1.day.payments).toMatchObject({ fact: 2, plan: 1, weekend: 0 });
    expect(a1.total.quality).toMatchObject({ fact: 8, plan: 8 });
    expect(a1.total.long).toMatchObject({ fact: 3, plan: 3 });
    expect(a1.total.payments).toMatchObject({ fact: 3, plan: 2 });
    expect(personOf(lines, 'СР1', 'a3').level).toBe('rookie1');
  });

  test('в отпуске: отметка, не входит в итог группы, план 0, но факт показан', () => {
    const a2 = personOf(lines, 'СР1', 'a2');
    expect(a2).toMatchObject({ level: 'experienced', absence: 'vacation', inGroupTotal: false });
    expect(a2.day.quality).toMatchObject({ fact: 9, plan: 0 });
    expect(a2.day.long).toMatchObject({ fact: 9, plan: 0 });
    expect(a2.day.payments).toMatchObject({ fact: 1, plan: 0 });
    // накопление: план только за 01.12, когда он был на работе
    expect(a2.total.quality).toMatchObject({ fact: 12, plan: 4 });
    expect(a2.total.long).toMatchObject({ fact: 10, plan: 1.5 });
    expect(a2.total.payments).toMatchObject({ fact: 1, plan: 1 });
  });

  test('личный план на месяц: план дня и накопленный — из него (без запаса, 21 рабочий день календаря теста), а не из нормы уровня', () => {
    const s2 = world({ staff: [emp('a1', 'Тест Альфов', 'СР1', { paymentPlan: 6 })] });
    const a1 = personOf(dayResults(s2, '2026-12-04'), 'СР1', 'a1');
    expect(a1.day.payments.plan).toBe(0.29); // 6 / 21 = 0,2857
    expect(a1.total.payments.plan).toBe(0.86); // 01, 02, 04.12 (03.12 — выходной теста)
    expect(lineOf(dayResults(s2, '2026-12-04'), 'СР1').total.payments.plan).toBe(0.86);
  });


  test('уволенный до D и принятый после D в списке нет; скрытый из рейтинга есть с пометкой', () => {
    const w = world({
      staff: [
        ...world().staff,
        emp('f1', 'Тест Уволенов', 'СР1', { fireDate: '2026-12-02' }),
        emp('h1', 'Тест Поздников', 'СР1', { hireDate: '2026-12-04' }),
        emp('x1', 'Тест Скрытов', 'СР1', { hiddenFromRating: true }),
      ],
    });
    const list = lineOf(dayResults(w, '2026-12-02'), 'СР1').employees;
    expect(list.map((e) => e.id)).toEqual(['a1', 'a2', 'a3', 'x1']);
    expect(list.find((e) => e.id === 'x1')!.hidden).toBe(true);
    expect(list.find((e) => e.id === 'a1')!.hidden).toBe(false);
  });

  test('перевод: сотрудник числится в группе на выбранный день, а не нынешней', () => {
    const moved = world({ staff: [...world().staff, emp('m1', 'Тест Переводов', 'СР1', { transfers: [{ date: '2026-12-04', group: 'СР2' }] })] });
    expect(lineOf(dayResults(moved, '2026-12-02'), 'СР1').employees.map((e) => e.id)).toContain('m1');
    expect(lineOf(dayResults(moved, '2026-12-04'), 'СР2').employees.map((e) => e.id)).toContain('m1');
    expect(lineOf(dayResults(moved, '2026-12-04'), 'СР1').employees.map((e) => e.id)).not.toContain('m1');
  });

  test('не разнесено по сотрудникам: факт группы минус сумма сотрудников; авторы не из штата отдельно', () => {
    // F-5 написал автор не из штата: группе засчитано 4, сотрудникам 2 + 1 + 0
    expect(lineOf(lines, 'СР1').unassigned).toEqual({ payments: 1, unmatched: 1 });
    expect(lineOf(lines, 'СР2').unassigned).toEqual({ payments: 0, unmatched: 0 });
  });

  test('предварительные числа дня тоже не разнесены; сумма сотрудников больше группы — минус не отсекается', () => {
    const prov = world({ provisional: [{ date: '2026-12-05', group: 'СР1', count: 3 }] });
    expect(lineOf(dayResults(prov, '2026-12-05'), 'СР1').unassigned).toEqual({ payments: 3, unmatched: 0 });
    // Альфов в штате числится в СР1, а счёт в файле записан группе СР2: у группы он есть, у сотрудников СР1 — нет
    const mismatch = world({ payments: [pay('2026-12-02', 'СР2', 'Тест Альфов', 'M-1')] });
    expect(lineOf(dayResults(mismatch, '2026-12-02'), 'СР1').unassigned.payments).toBe(-1);
  });

  test('file и current — значения выбранного календарного дня, а не корзины', () => {
    const wed = personOf(dayResults(s, '2026-12-04'), 'СР1', 'a1');
    expect(wed.day.payments.fact).toBe(1); // корзина: F-6 в выходной
    expect(wed.file.payments).toBe(0);
    expect(wed.current.payments).toBe(0);
    const tue = personOf(dayResults(s, '2026-12-02'), 'СР1', 'a1');
    expect(tue.file).toEqual({ quality: 4, long: 1, payments: 2 });
    expect(tue.current).toEqual({ quality: 4, long: 1, payments: 2 });
  });
});

describe('dayResults: ручные правки в ячейках', () => {

  test('устаревшая правка (в файле теперь иное значение) помечает ячейки, но не чужие показатели', () => {
    const s = world({ corrections: [corr(1, '2026-12-02', 'a1', 'long', 1, 0)] });
    const lines = dayResults(s, '2026-12-02');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.long.stale).toBe(true);
    expect(a1.total.long.stale).toBe(true);
    expect(lineOf(lines, 'СР1').day.long.stale).toBe(true);
    expect(lineOf(lines, 'СР1').total.long.stale).toBe(true);
    expect(a1.day.quality.stale).toBe(false);
    expect(a1.day.payments.stale).toBe(false);
    expect(lineOf(lines, 'СР2').day.long.stale).toBe(false);
  });

  test('правка оплат в корзине: идёт группе и сотруднику, помечена в ячейке и в накоплении', () => {
    const s = world({ corrections: [corr(1, '2026-12-03', 'a1', 'payments', 2, 1)] });
    const wed = dayResults(s, '2026-12-04');
    const a1 = personOf(wed, 'СР1', 'a1');
    expect(a1.day.payments).toMatchObject({ fact: 3, weekend: 3, corrected: 2, stale: false });
    expect(lineOf(wed, 'СР1').day.payments).toMatchObject({ fact: 3, weekend: 3, corrected: 2 });
    expect(lineOf(wed, 'СР1').total.payments).toMatchObject({ fact: 8, corrected: 2 });
    // правка отдельного дня 03.12 не меняет current за 04.12
    expect(a1.current.payments).toBe(0);
    // до 03.12 включительно правки ещё нет в накоплении
    expect(lineOf(dayResults(s, '2026-12-02'), 'СР1').total.payments.corrected).toBe(0);
  });

  test('минус больше оплат в файле: значение дня 0, а не отрицательное', () => {
    const s = world({ corrections: [corr(1, '2026-12-02', 'a1', 'payments', -5, 2)] });
    const lines = dayResults(s, '2026-12-02');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.current.payments).toBe(0);
    expect(a1.day.payments).toMatchObject({ fact: 0, corrected: -5 });
    expect(a1.total.payments.fact).toBe(0); // F-1 за 01.12 и 2 − 5 за 02.12: сумма за период ниже нуля — 0
    expect(lineOf(lines, 'СР1').day.payments.fact).toBe(0); // 4 − 5 → 0
  });

  test('правка воронки в выходной: выходной не оценивается, оценка следующего рабочего дня та же, что без правки', () => {
    const funnel = [...world().funnel, fun('a1', '2026-12-04', 4, 2), fun('a3', '2026-12-04', 1, 0)];
    const plain = world({ funnelThrough: '2026-12-04', funnel });
    const fixed = world({ funnelThrough: '2026-12-04', funnel, corrections: [corr(1, '2026-12-03', 'a1', 'long', 3, 0)] });
    const sat = lineOf(dayResults(fixed, '2026-12-03'), 'СР1');
    expect(sat.outcome).toEqual({ evaluated: false, reason: 'weekend' });
    expect(personOf(dayResults(fixed, '2026-12-03'), 'СР1', 'a1').current.long).toBe(3);
    expect(lineOf(dayResults(fixed, '2026-12-04'), 'СР1').outcome).toEqual(lineOf(dayResults(plain, '2026-12-04'), 'СР1').outcome);
    expect(lineOf(dayResults(fixed, '2026-12-04'), 'СР1').outcome.evaluated).toBe(true);
  });

  test('минус воронки больше файла: факт сотрудника и группы за день 0, а не отрицательный', () => {
    const s = world({ corrections: [corr(1, '2026-12-02', 'a1', 'long', -5, 1)] });
    const lines = dayResults(s, '2026-12-02');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.long).toMatchObject({ fact: 0, corrected: -5 });
    expect(a1.current.long).toBe(0);
    expect(a1.corrections.long).toBe(-5);
    expect(lineOf(lines, 'СР1').day.long.fact).toBe(0); // Гаммов 0, Альфов 1 − 5 → 0
  });

  test('накопление оплат сотрудника: минус вычитается из суммы за период, а не отсекается по дням', () => {
    const s = snap({
      staff: [emp('a1', 'Тест Альфов')],
      payments: [
        ...[1, 2, 3].map((i) => pay('2026-12-01', 'СР1', 'Тест Альфов', `T-${i}`)),
        pay('2026-12-02', 'СР1', 'Тест Альфов', 'T-4'),
      ],
      corrections: [corr(1, '2026-12-02', 'a1', 'payments', -2, 1)],
    });
    const lines = dayResults(s, '2026-12-02');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(a1.day.payments.fact).toBe(0); // 1 − 2 за день отсекается
    expect(a1.total.payments.fact).toBe(2); // 3 + 1 − 2 за период
    // у группы суммы по дням, как в движке: день отсекается сам по себе
    expect(lineOf(lines, 'СР1').total.payments.fact).toBe(3);
  });

  test('правка воронки отсутствующего не входит в факт группы за день, но видна у него', () => {
    const s = world({ corrections: [corr(1, '2026-12-02', 'a2', 'quality', 2, 9)] });
    const lines = dayResults(s, '2026-12-02');
    expect(lineOf(lines, 'СР1').day.quality).toMatchObject({ fact: 5, corrected: 0 });
    expect(personOf(lines, 'СР1', 'a2').day.quality).toMatchObject({ fact: 11, corrected: 2 });
  });

  test('правка дня после funnelThrough: у сотрудника видна, в накоплении воронки (как на ТВ) её нет', () => {
    const s = world({ corrections: [corr(1, '2026-12-04', 'a1', 'quality', 3, 0)] });
    const lines = dayResults(s, '2026-12-04');
    const a1 = personOf(lines, 'СР1', 'a1');
    expect(lineOf(lines, 'СР1').outcome).toEqual({ evaluated: false, reason: 'no-funnel' });
    expect(a1.day.quality).toMatchObject({ fact: 3, plan: null, corrected: 3, stale: false });
    expect(a1.current.quality).toBe(3);
    expect(a1.total.quality).toMatchObject({ fact: 8, corrected: 0 });
    expect(lineOf(lines, 'СР1').total.quality.fact).toBe(22);
  });
});

describe('dayResults: группа сейчас', () => {
  /** Пять оплат 01.12 — вылупились. */
  const hatched = (more: ReturnType<typeof pay>[], serverNow: string) =>
    snap({
      serverNow,
      staff: [emp('a1', 'Тест Альфов')],
      payments: [
        ...[1, 2, 3, 4, 5].map((i) => pay('2026-12-01', 'СР1', 'Тест Альфов', `H-${i}`)),
        ...more,
      ],
    });





  test('сейчас: процент плана и кошелёк группы', () => {
    const now = lineOf(dayResults(hatched([], '2026-12-02T10:00:00+03:00'), '2026-12-01'), 'СР1').now;
    expect(now.percent).toBeGreaterThan(0);
    expect(now.coins).toBe(now.percent);
    expect([now.flakes, now.keys]).toEqual([0, 0]);
  });
});

describe('correctionViews', () => {
  const s = snap({
    staff: [
      emp('a1', 'Тест Альфов'),
      emp('t1', 'Тест Переводов', 'СР1', { transfers: [{ date: '2026-12-04', group: 'СР2' }] }),
    ],
    funnelThrough: '2026-12-04',
    paymentsImportedThrough: '2026-12-02',
    funnel: [fun('a1', '2026-12-02', 2, 3), fun('a1', '2026-12-04', 0, 1)],
    payments: [pay('2026-12-02', 'СР1', 'Тест Альфов', 'P-1')],
    corrections: [
      corr(1, '2026-12-02', 'a1', 'long', 1, 2), // в файле теперь 3
      corr(2, '2026-12-04', 'a1', 'long', 1, 2), // в файле теперь 1
      corr(3, '2026-12-05', 'a1', 'quality', 2, 0), // воронка за день не загружена
      corr(4, '2026-12-02', 'a1', 'payments', 1, 1), // в файле 1, как и было
      corr(5, '2026-12-04', 'a1', 'payments', 1, 0), // оплаты за день не загружены
      corr(6, '2026-12-02', 'gone', 'long', 1, 0), // сотрудника нет в штате
      corr(7, '2026-12-02', 'a1', 'quality', 1, 2), // в файле 2, как и было
      corr(8, '2026-12-02', 't1', 'payments', 1, 0), // до перевода — СР1
      corr(9, '2026-12-05', 't1', 'payments', 1, 0), // после перевода — СР2
    ],
  });
  const views = correctionViews(s);
  const byId = (id: number) => views.find((v) => v.c.id === id)!;

  test('новые сверху', () => {
    expect(views.map((v) => v.c.id)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  test('файл вырос или уменьшился против base: правка устарела', () => {
    expect(byId(1)).toMatchObject({ fileNow: 3, stale: true, group: 'СР1', name: 'Тест Альфов' });
    expect(byId(2)).toMatchObject({ fileNow: 1, stale: true });
  });

  test('значение из файла совпало с base: не устарела', () => {
    expect(byId(4)).toMatchObject({ fileNow: 1, stale: false });
    expect(byId(7)).toMatchObject({ fileNow: 2, stale: false });
  });

  test('день не загружен: значения из файла нет, правка не устаревшая', () => {
    expect(byId(3)).toMatchObject({ fileNow: null, stale: false });
    expect(byId(5)).toMatchObject({ fileNow: null, stale: false });
  });

  test('строки нет — в файле 0', () => {
    expect(byId(9).fileNow).toBeNull();
    expect(byId(8)).toMatchObject({ fileNow: 0, stale: false });
  });

  test('сотрудник ушёл из штата: правка в списке, группы нет, имя-заглушка', () => {
    expect(byId(6)).toMatchObject({ group: null, name: 'нет в штате', fileNow: 0, stale: false });
  });

  test('группа — на дату правки', () => {
    expect(byId(8).group).toBe('СР1');
    expect(byId(9).group).toBe('СР2');
  });

  test('правок нет: пустой список', () => {
    expect(correctionViews(snap())).toEqual([]);
  });
});

describe('correctionItems', () => {
  const D = '2026-12-02';
  const lineFor = (s: Snapshot, group: GroupCode, id: string, date: DateStr = D): EmployeeLine => personOf(dayResults(s, date), group, id);
  const same = (l: EmployeeLine) => ({ ...l.current });

  test('хочу 3 при текущем 2 и файле 2: одна правка +1 с base 2', () => {
    const s = world({ funnel: world().funnel.map((f) => (f.employeeId === 'a1' && f.date === D ? { ...f, long: 2 } : f)) });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1.current.long).toBe(2);
    expect(correctionItems(a1, { ...same(a1), long: 3 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'long', delta: 1, base: 2 }]);
  });

  test('ничего не изменилось: пустой список', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, same(a1), D)).toEqual([]);
  });

  test('несколько показателей: по правке на каждый, в порядке качественные, длинные, оплаты', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, { quality: 3, long: 2, payments: 0 }, D)).toEqual([
      { date: D, employeeId: 'a1', kind: 'quality', delta: -1, base: 4 },
      { date: D, employeeId: 'a1', kind: 'long', delta: 1, base: 1 },
      { date: D, employeeId: 'a1', kind: 'payments', delta: -2, base: 2 },
    ]);
  });

  test('разница считается от нынешнего значения (файл + правки), base — от файла', () => {
    const s = world({ corrections: [corr(1, D, 'a1', 'long', 1, 1)] });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1.current.long).toBe(2);
    expect(correctionItems(a1, { ...same(a1), long: 1 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'long', delta: -1, base: 1 }]);
  });

  test('оплаты: после устаревшей минусовой правки «хочу 1» доводит до 1 (файл 1, правка −2, показано 0)', () => {
    const s = snap({
      staff: [emp('a1', 'Тест Альфов')],
      payments: [pay(D, 'СР1', 'Тест Альфов', 'S-1')],
      paymentsImportedThrough: D,
      corrections: [corr(1, D, 'a1', 'payments', -2, 2)], // файл с тех пор уменьшился: правка устарела
    });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1).toMatchObject({ file: { payments: 1 }, current: { payments: 0 }, corrections: { payments: -2 } });
    expect(correctionViews(s)[0].stale).toBe(true);
    expect(correctionItems(a1, { ...same(a1), payments: 1 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'payments', delta: 2, base: 1 }]);
    // «хочу 0»: уже 0, править нечего
    expect(correctionItems(a1, same(a1), D)).toEqual([]);
  });

  test('длинные: после устаревшей минусовой правки «хочу 1» доводит до 1 (файл 1, правка −3, показано 0)', () => {
    const s = snap({
      staff: [emp('a1', 'Тест Альфов')],
      funnelThrough: D,
      funnel: [fun('a1', D, 0, 1)],
      corrections: [corr(1, D, 'a1', 'long', -3, 3)],
    });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1).toMatchObject({ file: { long: 1 }, current: { long: 0 }, corrections: { long: -3 } });
    expect(correctionItems(a1, { ...same(a1), long: 1 }, D)).toEqual([{ date: D, employeeId: 'a1', kind: 'long', delta: 3, base: 1 }]); // 1 − (1 − 3)
  });

  test('предел 50 считается от сырого значения (файл + правки), а не от показанного', () => {
    const s = snap({
      staff: [emp('a1', 'Тест Альфов')],
      funnelThrough: D,
      corrections: [corr(1, D, 'a1', 'quality', -50, 0)],
    });
    const a1 = lineFor(s, 'СР1', 'a1');
    expect(a1.current.quality).toBe(0);
    expect(correctionItems(a1, { ...same(a1), quality: 1 }, D)).toEqual({ error: expect.any(String) }); // +51
  });

  test('правка субботы не попадает в «правки» понедельника для редактора, хотя входит в его корзину', () => {
    const s = world({ corrections: [corr(1, '2026-12-06', 'b1', 'payments', 2, 1)] });
    const mon = lineFor(s, 'СР2', 'b1', '2026-12-08');
    expect(mon.day.payments).toMatchObject({ fact: 3, weekend: 3, corrected: 2 });
    expect(mon.corrections.payments).toBe(0);
    expect(mon.current.payments).toBe(0);
    expect(lineFor(s, 'СР2', 'b1', '2026-12-06').corrections.payments).toBe(2);
  });

  test('оплаты: разница от значения дня, а не от корзины с выходными', () => {
    const wed = lineFor(world(), 'СР1', 'a1', '2026-12-04');
    expect(wed.day.payments.fact).toBe(1); // корзина с F-6 за выходной
    expect(correctionItems(wed, { ...same(wed), payments: 1 }, '2026-12-04')).toEqual([
      { date: '2026-12-04', employeeId: 'a1', kind: 'payments', delta: 1, base: 0 },
    ]);
  });

  test('отрицательное, дробное и нечисло — ошибка', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = correctionItems(a1, { ...same(a1), long: bad }, D);
      expect(r).toEqual({ error: expect.stringMatching(/\S/) });
    }
  });

  test('правка больше 50 за раз — ошибка (сервер не примет)', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems(a1, { ...same(a1), payments: 2 + 51 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a1, { ...same(a1), payments: 2 + 50 }, D)).toHaveLength(1);
  });

  test('воронка у отсутствующего — ошибка, оплаты у него можно', () => {
    const a2 = lineFor(world(), 'СР1', 'a2');
    expect(a2.inGroupTotal).toBe(false);
    expect(correctionItems(a2, { ...same(a2), long: a2.current.long + 1 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a2, { ...same(a2), quality: a2.current.quality - 1 }, D)).toEqual({ error: expect.any(String) });
    expect(correctionItems(a2, { ...same(a2), payments: 3 }, D)).toEqual([
      { date: D, employeeId: 'a2', kind: 'payments', delta: 2, base: 1 },
    ]);
    // ничего не меняли в воронке — ошибки нет
    expect(correctionItems(a2, same(a2), D)).toEqual([]);
  });

  test('новый сотрудник из разбора (id new:n) не правится', () => {
    const a1 = lineFor(world(), 'СР1', 'a1');
    expect(correctionItems({ ...a1, id: 'new:1' }, { ...same(a1), long: 3 }, D)).toEqual({ error: expect.any(String) });
  });
});

