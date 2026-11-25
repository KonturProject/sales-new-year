import { describe, expect, test } from 'vitest';
import { grinchState, type GrinchCommand, type GrinchInput } from './grinch';

const at = (time: string, day = '2026-12-10') => `${day}T${time}:00+03:00`;
const toy = (purchaseId: number, when = at('12:00', '2026-12-02')) => ({ purchaseId, at: when });
const run = (over: Partial<GrinchInput> & { time?: string } = {}) =>
  grinchState({
    now: at(over.time ?? '12:00'), workingDay: true, lastPaymentAt: at('10:00'), settings: { auto: true, quietMin: 120 },
    commands: [], hung: [toy(1), toy(2), toy(3)], litTiers: [1], ...over,
  });
const cmd = (id: number, kind: GrinchCommand['kind'], time: string): GrinchCommand => ({ id, kind, at: at(time) });

describe('сам по себе', () => {
  test.each([['11:59', 0], ['12:00', 1], ['13:59', 1], ['14:00', 2], ['17:59', 2]])('в %s — пакостей %i', (time, n) => {
    expect(run({ time }).pranks).toBe(n);
  });

  test('первая пакость — игрушка, вторая — гирлянда верхнего горящего яруса', () => {
    const one = run({ time: '12:00' });
    expect([one.stolen.length, one.garlandOff]).toEqual([1, null]);
    const two = run({ time: '14:00', litTiers: [1, 2] });
    expect([two.stolen.length, two.garlandOff]).toEqual([1, 2]);
  });

  test('гирлянды нет — вторая игрушка, другая', () => {
    const s = run({ time: '14:00', litTiers: [] });
    expect([new Set(s.stolen).size, s.garlandOff]).toEqual([2, null]);
  });

  test('платёжка обнуляет отсчёт', () => {
    expect(run({ time: '13:00', lastPaymentAt: at('12:30') }).pranks).toBe(0);
    expect(run({ time: '14:30', lastPaymentAt: at('12:30') }).pranks).toBe(1);
  });

  test('платёжка вчера в 22:00: отсчёт всё равно с 10:00', () => {
    expect(run({ time: '11:59', lastPaymentAt: at('22:00', '2026-12-09') }).pranks).toBe(0);
    expect(run({ time: '12:00', lastPaymentAt: at('22:00', '2026-12-09') }).pranks).toBe(1);
  });

  test('платёжек не было никогда', () => {
    expect(run({ time: '12:00', lastPaymentAt: null }).pranks).toBe(1);
  });

  test('платёжка в 9 утра не начинает отсчёт раньше 10:00', () => {
    expect(run({ time: '11:30', lastPaymentAt: at('09:00') }).pranks).toBe(0);
  });

  test('до 10:00, с 18:00 и в выходной спит', () => {
    for (const s of [run({ time: '09:59', lastPaymentAt: null }), run({ time: '18:00' }), run({ time: '14:00', workingDay: false })]) {
      expect(s).toMatchObject({ pranks: 0, stolen: [], garlandOff: null, asleep: true });
    }
  });

  test('выключен — ничего не делает', () => {
    expect(run({ time: '17:00', settings: { auto: false, quietMin: 120 } })).toMatchObject({ pranks: 0, stolen: [] });
  });

  test('тишина настраивается', () => {
    expect(run({ time: '11:30', settings: { auto: true, quietMin: 90 } }).pranks).toBe(1);
  });

  test('пустая ёлка: пакость есть, красть нечего', () => {
    expect(run({ time: '12:00', hung: [] })).toMatchObject({ pranks: 1, stolen: [] });
  });
});

describe('какую игрушку', () => {
  test('одинаковый вход — одинаковая игрушка', () => {
    expect(run({ time: '12:00' }).stolen).toEqual(run({ time: '13:30' }).stolen);
  });

  test('покупка во время пакости не меняет украденное', () => {
    const before = run({ time: '12:10' }).stolen;
    const more = [toy(1), toy(2), toy(3), toy(4, at('12:05')), toy(5, at('12:06'))];
    expect(run({ time: '12:10', hung: more }).stolen).toEqual(before);
  });

  test('все игрушки куплены после начала тишины: берёт самую первую', () => {
    expect(run({ time: '12:10', hung: [toy(8, at('11:00')), toy(7, at('10:30'))] }).stolen).toEqual([7]);
  });

  test('покупка позже пакости украденной не становится', () => {
    expect(run({ time: '12:10', hung: [toy(7, at('12:05'))] }).stolen).toEqual([]);
  });

  test('разные дни — выбор не всегда один и тот же', () => {
    const many = Array.from({ length: 30 }, (_, i) => toy(i + 1));
    const picks = new Set(Array.from({ length: 10 }, (_, i) => {
      const day = `2026-12-${String(i + 7).padStart(2, '0')}`;
      return run({ now: at('12:30', day), lastPaymentAt: null, hung: many }).stolen[0];
    }));
    expect(picks.size).toBeGreaterThan(3);
  });
});

describe('команды админа', () => {
  test('украсть сразу, даже без автоматики', () => {
    const s = run({ time: '10:30', settings: { auto: false, quietMin: 120 }, commands: [cmd(1, 'steal', '10:20')] });
    expect([s.stolen.length, s.asleep]).toEqual([1, false]);
  });

  test('погасить гирлянду', () => {
    expect(run({ time: '10:30', commands: [cmd(1, 'garland', '10:20')], litTiers: [1, 2, 3] }).garlandOff).toBe(3);
  });

  test('вернуть всё: и ручное, и автоматику; отсчёт заново', () => {
    const commands = [cmd(1, 'steal', '10:20'), cmd(2, 'return', '13:00')];
    expect(run({ time: '13:05', commands })).toMatchObject({ pranks: 0, stolen: [] });
    expect(run({ time: '15:00', commands }).pranks).toBe(1);
  });

  test('платёжка после команды возвращает', () => {
    expect(run({ time: '10:40', lastPaymentAt: at('10:30'), commands: [cmd(1, 'steal', '10:20')] }).stolen).toEqual([]);
  });

  test('команда до 18:00 к вечеру снимается, вечерняя действует до полуночи', () => {
    expect(run({ time: '18:30', commands: [cmd(1, 'steal', '17:00')] }).stolen).toEqual([]);
    expect(run({ time: '18:40', commands: [cmd(1, 'steal', '18:30')] }).stolen).toHaveLength(1);
    expect(run({ now: at('09:00', '2026-12-11'), commands: [cmd(1, 'steal', '18:30')] }).stolen).toEqual([]);
  });

  test('в выходной ручная команда работает', () => {
    expect(run({ time: '14:00', workingDay: false, commands: [cmd(1, 'steal', '13:00')] }).stolen).toHaveLength(1);
  });
});
