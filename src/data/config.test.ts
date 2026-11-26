import { describe, expect, test } from 'vitest';
import { defaultConfig } from '@/engine/config';
import { configOf, timelineOf } from './config';

describe('configOf', () => {
  test('пустой config — умолчания движка (тот же объект)', () => {
    expect(configOf({})).toBe(defaultConfig);
  });

  test('нормы сливаются по уровням и полям, нетронутое — умолчание', () => {
    const c = configOf({ norms: { experienced: { quality: 3.5 }, rookie2: { payments: 0.12 } } });
    expect(c.norms.experienced).toEqual({ quality: 3.5, long: 1.5, payments: 0.27 });
    expect(c.norms.rookie2).toEqual({ quality: 2, long: 1, payments: 0.12 });
    expect(c.norms.rookie1).toEqual(defaultConfig.norms.rookie1);
  });

  test.each([[-1], [51], [0.123], ['4'], [null], [true]])('негодная норма %j — умолчание, соседнее годное остаётся', (bad) => {
    const c = configOf({ norms: { experienced: { quality: bad as number, long: 2 } } });
    expect(c.norms.experienced).toEqual({ quality: 4, long: 2, payments: 0.27 });
  });

  test('даты игры, запас плана и отсечку из config не берём', () => {
    const c = configOf({ startDate: '2026-11-01', personalPlanPercent: 105, finaleCutoff: '2026-12-30' } as never);
    expect(c).toBe(defaultConfig);
  });

  test('выходные: сортируются; пустой список — «выходных нет»', () => {
    expect(configOf({ nonWorking: ['2026-12-12', '2026-12-05'] }).nonWorking).toEqual(['2026-12-05', '2026-12-12']);
    expect(configOf({ nonWorking: [] }).nonWorking).toEqual([]);
  });

  test.each([[['2026-11-30']], [['2026-12-31']], [['2026-12-05', '2026-12-05']], [['x']], ['2026-12-05']])('негодные выходные %j — встроенный календарь', (bad) => {
    expect(configOf({ nonWorking: bad as never }).nonWorking).toEqual(defaultConfig.nonWorking);
  });

  test.each([[null], [5], ['x'], [[]]])('не объект %j — умолчания', (raw) => {
    expect(configOf(raw as never)).toBe(defaultConfig);
  });

  test('один и тот же объект — один и тот же результат', () => {
    const raw = { norms: { experienced: { quality: 3 } } };
    expect(configOf(raw)).toBe(configOf(raw));
  });

  test('разбор не меняет умолчания', () => {
    configOf({ norms: { experienced: { quality: 1 } } });
    expect(defaultConfig.norms.experienced.quality).toBe(4);
  });
});

describe('timelineOf', () => {
  test('без записей — база на любую дату; старый бэкенд без поля — как пустой список', () => {
    const t = timelineOf({ config: {}, configChanges: undefined as never });
    expect(t.at('2026-12-10')).toBe(defaultConfig);
  });

  test('запись меняет нормы со своей даты и наследует прежние', () => {
    const t = timelineOf({
      config: { norms: { experienced: { quality: 5 } } },
      configChanges: [{ from: '2026-12-14', config: { norms: { experienced: { long: 2 } } } }, { from: '2026-12-07', config: { norms: { rookie1: { quality: 2 } } } }],
    });
    expect(t.at('2026-12-04').norms.experienced).toEqual({ quality: 5, long: 1.5, payments: 0.27 });
    expect(t.at('2026-12-07').norms.rookie1.quality).toBe(2);
    expect(t.at('2026-12-14').norms.experienced).toEqual({ quality: 5, long: 2, payments: 0.27 });
    expect(t.at('2026-12-14').norms.rookie1.quality).toBe(2);
  });

  test('запись «с даты» календарь не меняет', () => {
    const t = timelineOf({ config: { nonWorking: ['2026-12-05'] }, configChanges: [{ from: '2026-12-07', config: { nonWorking: [] } as never }] });
    expect(t.at('2026-12-10').nonWorking).toEqual(['2026-12-05']);
  });

  test('мусорные записи пропускаются', () => {
    const t = timelineOf({ config: {}, configChanges: [5, null, { from: 'x', config: {} }, { from: '2026-12-07', config: { norms: { rookie1: { quality: 3 } } } }] as never });
    expect(t.at('2026-12-08').norms.rookie1.quality).toBe(3);
  });
});
