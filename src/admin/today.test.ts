import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import type { Employee } from '@/engine/staff';
import { defaultConfig } from '@/engine/config';
import { fillAll } from '@/engine/testkit';
import { treeState } from '@/engine/tree';
import { forecast, todayLine, todayTasks } from './today';

const snap = (o: Partial<Snapshot>): Snapshot => ({
  version: 1, serverNow: '2026-12-02T10:00:00+03:00', funnelThrough: null, paymentsImportedThrough: null,
  config: {}, configChanges: [], staff: [], absences: [], payments: [], provisional: [], funnel: [], purchases: [], grants: [], lastPaymentAt: null, grinch: { auto: true, quietMin: 120, commands: [] }, finale: null, commands: [], ...o,
});

describe('todayLine: блок «Сегодня» над вкладками админки', () => {
  test('день игры: что загружено и сколько групп внесли предварительные числа сегодня', () => {
    const s = snap({
      funnelThrough: '2026-12-01',
      paymentsImportedThrough: '2026-12-01',
      provisional: [
        { date: '2026-12-02', group: 'СР1', count: 2 },
        { date: '2026-12-02', group: 'СР2', count: 0 },
        { date: '2026-12-01', group: 'СР3', count: 5 },
      ],
    });
    expect(todayLine(s)).toBe('Сегодня 02.12 · день 2 из 22 · воронка по 01.12 · оплаты из файла по 01.12 · предварительные сегодня: 2 из 6 групп · ёлка 0 из 66');
  });

  test('до старта, пустая таблица', () => {
    expect(todayLine(snap({ serverNow: '2026-11-30T18:00:00+03:00' })))
      .toBe('Сегодня 30.11 · старт 01.12 · воронки ещё нет · оплат из файла ещё нет · предварительные сегодня: 0 из 6 групп');
  });

  test('после конца игры', () => {
    expect(todayLine(snap({ serverNow: '2026-12-31T09:00:00+03:00' }))).toContain('Сегодня 31.12 · игра окончена');
  });
});

const person = (id: string, o: Partial<Employee> = {}): Employee => ({
  id, name: id, shortName: id, group: 'СР1', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...o,
});

describe('todayTasks: что сделать сегодня', () => {
  test('первый день, штата нет: загрузить воронку — из неё добавится штат; файлов за «вчера» ещё не ждём', () => {
    expect(todayTasks(snap({ serverNow: '2026-12-01T09:00:00+03:00' }))).toEqual([
      { done: false, text: 'Штата нет: Импорт → воронка, из неё добавятся сотрудники' },
    ]);
  });

  test('02.12 утром: штат есть, воронки и оплат за 01.12 нет', () => {
    expect(todayTasks(snap({ staff: [person('a'), person('b')] }))).toEqual([
      { done: true, text: 'Штат: 2' },
      { done: false, text: 'Загрузите воронку за 01.12 (Импорт)' },
      { done: false, text: 'Загрузите оплаты за 01.12 (Импорт)' },
    ]);
  });

  test('всё загружено; новички без даты приёма — напоминание', () => {
    const s = snap({
      serverNow: '2026-12-07T09:00:00+03:00', // понедельник: «вчера» игры — пятница 04.12
      funnelThrough: '2026-12-04',
      paymentsImportedThrough: '2026-12-06',
      staff: [person('a'), person('b', { baseLevel: 'rookie1' }), person('c', { baseLevel: 'rookie2', hireDate: '2026-11-26' })],
    });
    expect(todayTasks(s)).toEqual([
      { done: true, text: 'Штат: 3' },
      { done: false, text: 'Новички без даты приёма: 1 — без даты уровень не сменится сам до конца игры (Сотрудники)' },
      { done: true, text: 'Воронка по 04.12' },
      { done: true, text: 'Оплаты из файла по 06.12' },
    ]);
  });

  test('уволенные не считаются ни в штате, ни в новичках без даты', () => {
    const s = snap({ staff: [person('a'), person('b', { baseLevel: 'rookie1', fireDate: '2026-11-29' })] });
    expect(todayTasks(s)[0]).toEqual({ done: true, text: 'Штат: 1' });
    expect(todayTasks(s).some((t) => t.text.startsWith('Новички'))).toBe(false);
  });
});

describe('forecast: заполнение ёлки при нынешнем темпе', () => {
  // декабрь: 22 рабочих дня; по 10.12 включительно прошло 8, после него осталось 14
  const tree = (n: number) => ({ tree: treeState(fillAll(n)) });
  const D = '2026-12-10';

  test('16 игрушек за 8 дней — по 2 в день: к финалу 44, полной не будет', () => {
    expect(forecast(tree(16), D, defaultConfig)).toEqual({ toys: 44, fullOn: null });
  });

  test('24 за 8 дней — по 3: ровно 66 в последний день игры', () => {
    expect(forecast(tree(24), D, defaultConfig)).toEqual({ toys: 66, fullOn: '2026-12-30' });
  });

  test('40 за 8 дней — по 5: полна через 6 рабочих дней, выходные пропускаются', () => {
    expect(forecast(tree(40), D, defaultConfig)).toEqual({ toys: 66, fullOn: '2026-12-18' });
  });

  test('ёлка уже полна — сегодня; пустая — ноль и без даты', () => {
    expect(forecast(tree(66), D, defaultConfig)).toEqual({ toys: 66, fullOn: D });
    expect(forecast(tree(0), D, defaultConfig)).toEqual({ toys: 0, fullOn: null });
  });

  test('до старта темпа нет: сколько есть', () => {
    expect(forecast(tree(0), '2026-11-30', defaultConfig)).toEqual({ toys: 0, fullOn: null });
  });

  test('строка «Сегодня»: прогноз к финалу и дата заполнения', () => {
    const at = { serverNow: '2026-12-10T10:00:00+03:00' };
    expect(todayLine(snap({ ...at, purchases: fillAll(16) }))).toContain('· ёлка 16 из 66, к финалу ≈ 44');
    expect(todayLine(snap({ ...at, purchases: fillAll(40) }))).toContain('· ёлка 40 из 66, полна ≈ 18.12');
    expect(todayLine(snap({ ...at, purchases: fillAll(66) }))).toContain('· ёлка полна');
  });
});
