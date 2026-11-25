import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';

// Настройки площади — только личные нормы: на всю игру и «с даты». «Сегодня» — 2026-12-12; ФИО вымышленные.
const bad = { ok: false, error: 'bad_request' };
const admin = (b, action, extra = {}) => b.post({ action, pin: PIN, ...extra });
const all = (b, norms) => admin(b, 'setConfig', { config: { norms } });
const at = (b, from, norms) => admin(b, 'setConfig', { config: { norms }, from });
const q = (quality) => ({ experienced: { quality } });
const cell = (b, key) => b.sheet('Settings').rows.find((r) => r[0] === key);

describe('нормы на всю игру', () => {
  test('до первой правки пусто; частичные правки сливаются, соседние поля не стираются, версия растёт', () => {
    const b = loadBackend();
    expect(b.get().config).toEqual({});
    const v = b.get().version;
    expect(all(b, { rookie1: { quality: 2 } })).toEqual({ ok: true, version: v + 1, config: { norms: { rookie1: { quality: 2 } } }, configChanges: [] });
    expect(all(b, { rookie1: { long: 1 }, experienced: { quality: 6, long: 7, payments: 0.4 } }).config).toEqual({
      norms: { rookie1: { quality: 2, long: 1 }, experienced: { quality: 6, long: 7, payments: 0.4 } },
    });
    expect(b.get().version).toBe(v + 2);
  });

  test('границы: ноль, 50, сотые', () => {
    const b = loadBackend();
    expect(all(b, { experienced: { quality: 0, long: 50, payments: 0.01 } }).ok).toBe(true);
  });

  test.each([
    [{}], [5], [null], [[]], [{ norms: {} }], [{ norms: { experienced: {} } }], [{ norms: { boss: { quality: 1 } } }], [{ norms: { experienced: { piles: 1 } } }],
    [{ norms: { experienced: { quality: -1 } } }], [{ norms: { experienced: { quality: 51 } } }], [{ norms: { experienced: { payments: 0.123 } } }],
    [{ norms: { experienced: { quality: '4' } } }], [{ norms: { experienced: { quality: null } } }], [{ norms: { experienced: { quality: true } } }],
    [{ unknown: 1 }], [{ norms: q(3), unknown: 1 }], [{ maxPiles: 3 }], [{ stageThresholds: [25, 50, 75, 100] }], [{ nonWorking: [] }], [{ startDate: '2026-12-02' }],
  ])('мусор %j — отказ, ничего не записано', (config) => {
    const b = loadBackend();
    all(b, q(4));
    const v = b.get().version;
    expect(admin(b, 'setConfig', { config })).toEqual(bad);
    expect([b.get().config, b.get().version]).toEqual([{ norms: q(4) }, v]);
  });

  test('без админ-PIN и с PIN группы нельзя', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'setConfig', config: { norms: q(5) } }).error).toBe('invalid_pin');
    expect(b.post({ action: 'setConfig', group: 'СР1', groupPin: groupPins['СР1'], config: { norms: q(5) } }).error).toBe('invalid_pin');
  });

  test('испорченная ячейка читается как пустая, следующая правка чинит', () => {
    const b = loadBackend();
    all(b, q(5));
    cell(b, 'config')[1] = '{сломано';
    expect(b.get().config).toEqual({});
    expect(all(b, q(3)).config).toEqual({ norms: q(3) });
  });

  test('правка не стирает соседние настройки и выходные', () => {
    const b = loadBackend();
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-10', rows: [] });
    admin(b, 'setNonWorking', { nonWorking: ['2026-12-05', '2026-12-11'] });
    all(b, q(6));
    expect(b.get()).toMatchObject({ paymentsImportedThrough: '2026-12-10', config: { norms: q(6), nonWorking: ['2026-12-05', '2026-12-11'] } });
  });
});

describe('нормы с даты', () => {
  test('правка с датой не трогает общую, повтор даты сливает', () => {
    const b = loadBackend();
    all(b, q(4));
    at(b, '2026-12-09', q(2));
    expect(at(b, '2026-12-09', { experienced: { long: 1 } }).configChanges).toEqual([{ from: '2026-12-09', config: { norms: { experienced: { quality: 2, long: 1 } } } }]);
    expect(b.get().config).toEqual({ norms: q(4) });
  });

  test('записи по возрастанию даты', () => {
    const b = loadBackend();
    at(b, '2026-12-12', q(3));
    at(b, '2026-12-09', q(2));
    expect(b.get().configChanges.map((c) => c.from)).toEqual(['2026-12-09', '2026-12-12']);
  });

  test('from: null — на всю игру', () => {
    const b = loadBackend();
    expect(admin(b, 'setConfig', { config: { norms: q(3) }, from: null })).toMatchObject({ config: { norms: q(3) }, configChanges: [] });
  });

  test.each([['x'], [''], [5], ['2026-13-01'], ['09.12.2026'], [true]])('негодная дата %j', (from) => {
    expect(at(loadBackend(), from, q(3))).toEqual(bad);
  });

  test('записей не больше 30', () => {
    const b = loadBackend();
    const day = (i) => `2026-12-${String(i).padStart(2, '0')}`;
    for (let i = 1; i <= 30; i++) expect(at(b, day(i), q(i % 5)).ok).toBe(true);
    expect(at(b, '2026-12-31', q(3))).toEqual(bad);
    expect(at(b, day(5), { rookie1: { long: 2 } }).ok).toBe(true);
  });

  test('правка на всю игру вычёркивает свои поля из записей по датам; опустевшие исчезают', () => {
    const b = loadBackend();
    at(b, '2026-12-09', { experienced: { quality: 1, long: 2 } });
    at(b, '2026-12-12', { rookie1: { quality: 3 } });
    expect(all(b, q(6)).configChanges).toEqual([{ from: '2026-12-09', config: { norms: { experienced: { long: 2 } } } }, { from: '2026-12-12', config: { norms: { rookie1: { quality: 3 } } } }]);
    expect(all(b, { experienced: { long: 1 } }).configChanges).toEqual([{ from: '2026-12-12', config: { norms: { rookie1: { quality: 3 } } } }]);
    expect(all(b, { rookie1: { quality: 1 } }).configChanges).toEqual([]);
  });

  test('удаление записи; чужой или негодной даты — отказ', () => {
    const b = loadBackend();
    at(b, '2026-12-09', q(2));
    at(b, '2026-12-12', q(3));
    const v = b.get().version;
    expect(admin(b, 'removeConfigChange', { from: '2026-12-09' })).toEqual({ ok: true, version: v + 1, configChanges: [{ from: '2026-12-12', config: { norms: q(3) } }] });
    for (const from of ['2026-12-09', 'x', null]) expect(admin(b, 'removeConfigChange', { from })).toEqual(bad);
  });

  test('испорченная ячейка и мусорные записи отбрасываются', () => {
    const b = loadBackend();
    at(b, '2026-12-09', q(2));
    cell(b, 'configChanges')[1] = JSON.stringify([{ from: '2026-12-09', config: { norms: q(2) } }, { from: 'x', config: {} }, 5, null]);
    expect(b.get().configChanges).toEqual([{ from: '2026-12-09', config: { norms: q(2) } }]);
    cell(b, 'configChanges')[1] = 'сломано';
    expect(b.get().configChanges).toEqual([]);
    expect(at(b, '2026-12-10', q(4)).configChanges).toEqual([{ from: '2026-12-10', config: { norms: q(4) } }]);
  });
});
