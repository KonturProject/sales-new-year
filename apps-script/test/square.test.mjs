import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN, TEST_SCREEN_KEY as KEY } from './gas-harness.mjs';

// «Сегодня» — 2026-12-10, 10:00 по Москве; все ФИО вымышленные.
const DAY = '2026-12-10';
const MIN = 60_000;
const admin = (b, action, extra = {}) => b.post({ action, pin: PIN, ...extra });
const bad = { ok: false, error: 'bad_request' };
let n = 0;
const ref = () => `r${++n}`;

function setup() {
  const b = loadBackend({ startAt: Date.parse(`${DAY}T10:00:00+03:00`) });
  admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР1' }, { name: 'Сидорова Анна', group: 'СР5' }] });
  const { groupPins } = admin(b, 'setGroupPins');
  const id = Object.fromEntries(b.get().staff.map((e) => [e.name, e.id]));
  const rg = (group, action, extra = {}) => b.post({ action, group, groupPin: groupPins[group], ...extra });
  return { b, id, rg, groupPins };
}
const toy = (extra = {}) => ({ shop: 'tree', item: 1, slot: 5, employeeId: null, ref: ref(), ...extra });

describe('ключ экрана', () => {
  test('без ключа и с чужим ключом снимка нет', () => {
    const { b } = setup();
    expect(b.get({ k: '' })).toEqual({ ok: false, error: 'key' });
    expect(b.get({ k: 'чужой' })).toEqual({ ok: false, error: 'key' });
    expect(b.get({ k: 'чужой', since: '1' })).toEqual({ ok: false, error: 'key' });
    expect(b.get({ k: KEY }).ok).toBe(true);
  });

  test('ключа ещё нет: снимок закрыт, вход админа создаёт ключ', () => {
    const b = loadBackend({ screenKey: null });
    expect(b.get({ k: '' })).toEqual({ ok: false, error: 'key' });
    const { screenKey } = b.post({ action: 'login', pin: PIN });
    expect(screenKey).toMatch(/^[0-9a-z]{16}$/);
    expect(b.get({ k: screenKey }).ok).toBe(true);
    expect(b.post({ action: 'login', pin: PIN }).screenKey).toBe(screenKey);
  });

  test('РГ получает ключ после верного PIN, при неверном — нет', () => {
    const { b, rg } = setup();
    expect(rg('СР1', 'groupLogin')).toEqual({ ok: true, group: 'СР1', screenKey: KEY });
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
  });

  test('новый ключ: старый перестаёт работать', () => {
    const { b } = setup();
    const { screenKey } = admin(b, 'setScreenKey');
    expect(b.get({ k: KEY }).error).toBe('key');
    expect(b.get({ k: screenKey }).ok).toBe(true);
  });

  test('ключа нет в снимке', () => {
    const { b } = setup();
    expect(JSON.stringify(b.get())).not.toContain(KEY);
  });
});

describe('платёжки РГ', () => {
  const count = (b, g = 'СР1') => b.get().provisional.filter((p) => p.group === g).map((p) => p.count);

  test('+1 и −1 меняют число за сегодня', () => {
    const { b, rg } = setup();
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toMatchObject({ ok: true, count: 1 });
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toMatchObject({ ok: true, count: 2 });
    expect(rg('СР1', 'addPayment', { delta: -1, ref: ref() })).toMatchObject({ ok: true, count: 1 });
    expect(b.get().provisional).toEqual([{ date: DAY, group: 'СР1', count: 1 }]);
  });

  test('повтор ref ничего не добавляет и версию не двигает', () => {
    const { b, rg } = setup();
    const r = ref();
    rg('СР1', 'addPayment', { delta: 1, ref: r });
    const v = b.get().version;
    expect(rg('СР1', 'addPayment', { delta: 1, ref: r })).toMatchObject({ ok: true, duplicate: true, count: 1, version: v });
    expect([count(b), b.get().version]).toEqual([[1], v]);
  });

  test('ниже нуля и выше 15 нельзя', () => {
    const { b, rg } = setup();
    expect(rg('СР1', 'addPayment', { delta: -1, ref: ref() })).toEqual(bad);
    for (let i = 0; i < 15; i++) rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toEqual(bad);
    expect(count(b)).toEqual([15]);
  });

  test('не больше 40 внесений группы в день', () => {
    const { rg } = setup();
    for (let i = 0; i < 20; i++) {
      rg('СР1', 'addPayment', { delta: 1, ref: ref() });
      rg('СР1', 'addPayment', { delta: -1, ref: ref() });
    }
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toEqual(bad);
    expect(rg('СР5', 'addPayment', { delta: 1, ref: ref() }).ok).toBe(true);
  });

  test.each([[{ delta: 2 }], [{ delta: 0 }], [{ delta: '1' }], [{ delta: true }], [{ delta: 1, ref: '' }], [{ delta: 1, ref: 5 }], [{ delta: 1, ref: 'x'.repeat(65) }]])('мусор %j', (extra) => {
    const { rg } = setup();
    expect(rg('СР1', 'addPayment', { ref: ref(), ...extra })).toEqual(bad);
  });

  test('чужую группу не внести', () => {
    const { b, groupPins } = setup();
    expect(b.post({ action: 'addPayment', group: 'СР2', groupPin: groupPins['СР1'], delta: 1, ref: ref() }).error).toBe('invalid_pin');
  });

  test('админ правит то же число, разница — в журнал; журнал виден только админу', () => {
    const { b, rg } = setup();
    for (let i = 0; i < 5; i++) rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    admin(b, 'setProvisional', { date: DAY, group: 'СР1', count: 3 });
    expect(count(b)).toEqual([3]);
    const log = admin(b, 'getPrivate').paymentLog;
    expect(log).toHaveLength(6);
    expect(log.at(-1)).toMatchObject({ date: DAY, group: 'СР1', delta: -2, source: 'admin', at: `${DAY}T10:00:00+03:00` });
    expect(log[0]).toMatchObject({ source: 'rg', delta: 1 });
    expect(JSON.stringify(b.get())).not.toContain('paymentLog');
  });

  test('админ записал то же число — в журнал ничего', () => {
    const { b } = setup();
    admin(b, 'setProvisional', { date: DAY, group: 'СР1', count: 2 });
    admin(b, 'setProvisional', { date: DAY, group: 'СР1', count: 2 });
    expect(admin(b, 'getPrivate').paymentLog).toHaveLength(1);
  });

  test('после импорта за сегодняшний день внести нельзя', () => {
    const { b, rg } = setup();
    b.advance(24 * 60 * MIN);
    admin(b, 'importPayments', { from: DAY, to: DAY, rows: [] });
    admin(b, 'setProvisional', { date: DAY, group: 'СР1', count: 2 });
    b.advance(-24 * 60 * MIN); // часы экрана не важны: сервер сверяет со своей датой
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toEqual(bad);
  });
});

describe('последняя платёжка (для Гринча)', () => {
  test('растёт только при новом максимуме дня: +1, −1, +1 — один раз', () => {
    const { b, rg } = setup();
    expect(b.get().lastPaymentAt).toBeNull();
    rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    expect(b.get().lastPaymentAt).toBe(`${DAY}T10:00:00+03:00`);
    b.advance(30 * MIN);
    rg('СР1', 'addPayment', { delta: -1, ref: ref() });
    rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    expect(b.get().lastPaymentAt).toBe(`${DAY}T10:00:00+03:00`);
    rg('СР5', 'addPayment', { delta: 1, ref: ref() });
    expect(b.get().lastPaymentAt).toBe(`${DAY}T10:30:00+03:00`);
  });

  test('внесение админа тоже считается, правка прошлого дня — нет', () => {
    const { b } = setup();
    admin(b, 'setProvisional', { date: '2026-12-09', group: 'СР1', count: 4 });
    expect(b.get().lastPaymentAt).toBeNull();
    admin(b, 'setProvisional', { date: DAY, group: 'СР1', count: 1 });
    expect(b.get().lastPaymentAt).toBe(`${DAY}T10:00:00+03:00`);
  });

  test('утренний импорт не трогает; новый день начинает максимум заново', () => {
    const { b, rg } = setup();
    for (let i = 0; i < 3; i++) rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    const before = b.get().lastPaymentAt;
    b.advance(24 * 60 * MIN);
    admin(b, 'importPayments', { from: DAY, to: DAY, rows: [{ date: DAY, group: 'СР1', author: 'Иванов Иван', invoice: 'A-1' }] });
    expect([b.get().lastPaymentAt, b.get().provisional]).toEqual([before, []]);
    rg('СР1', 'addPayment', { delta: 1, ref: ref() });
    expect(b.get().lastPaymentAt).toBe('2026-12-11T10:00:00+03:00');
  });
});

describe('покупки', () => {
  test('игрушка с местом и именем', () => {
    const { b, id, rg } = setup();
    const r = rg('СР1', 'buy', toy({ employeeId: id['Иванов Иван'] }));
    expect(r).toMatchObject({ ok: true, id: 1 });
    expect(b.get().purchases).toEqual([
      { id: 1, at: `${DAY}T10:00:00+03:00`, date: DAY, group: 'СР1', shop: 'tree', item: 1, slot: 5, employeeId: id['Иванов Иван'], cancelledAt: null },
    ]);
  });

  test.each([
    ['gift', 102], ['attic', 201], ['attic', 213], ['cellar', 301], ['cellar', 313],
  ])('%s %i без места', (shop, item) => {
    const { b, rg } = setup();
    expect(rg('СР5', 'buy', toy({ shop, item, slot: null })).ok).toBe(true);
    expect(b.get().purchases[0]).toMatchObject({ shop, item, slot: null, employeeId: null });
  });

  test.each([
    [{ item: 0 }], [{ item: 31 }], [{ item: 1.5 }], [{ item: '1' }], [{ item: 101 }], [{ slot: 0 }], [{ slot: 67 }], [{ slot: null }], [{ slot: 1.5 }],
    [{ shop: 'gift', item: 101, slot: 5 }], [{ shop: 'gift', item: 104, slot: null }], [{ shop: 'attic', item: 214, slot: null }],
    [{ shop: 'attic', item: 301, slot: null }], [{ shop: 'cellar', item: 314, slot: null }], [{ shop: 'лавка' }], [{ shop: 'constructor' }],
    [{ employeeId: 'нет такого' }], [{ employeeId: 5 }], [{ ref: '' }], [{ ref: undefined }],
  ])('мусор %j', (extra) => {
    const { b, rg } = setup();
    expect(rg('СР1', 'buy', toy(extra))).toEqual(bad);
    expect(b.get().purchases).toEqual([]);
  });

  test('повтор ref той же группы — та же покупка', () => {
    const { b, rg } = setup();
    const t = toy();
    rg('СР1', 'buy', t);
    const v = b.get().version;
    expect(rg('СР1', 'buy', t)).toMatchObject({ ok: true, id: 1, duplicate: true, version: v });
    expect(b.get().purchases).toHaveLength(1);
  });

  test('тот же ref другой группы — другая покупка', () => {
    const { b, rg } = setup();
    const t = toy();
    rg('СР1', 'buy', t);
    expect(rg('СР5', 'buy', t)).toMatchObject({ ok: true, id: 2 });
    expect(b.get().purchases.map((p) => p.group)).toEqual(['СР1', 'СР5']);
  });

  test('чужой PIN не покупает', () => {
    const { b, groupPins } = setup();
    expect(b.post({ action: 'buy', group: 'СР2', groupPin: groupPins['СР1'], ...toy() }).error).toBe('invalid_pin');
  });

  test('не больше 40 покупок группы в день', () => {
    const { rg } = setup();
    for (let i = 0; i < 40; i++) expect(rg('СР1', 'buy', toy()).ok).toBe(true);
    expect(rg('СР1', 'buy', toy())).toEqual(bad);
    expect(rg('СР5', 'buy', toy()).ok).toBe(true);
  });

  test('отмена: вещь помечена, номер не переиспользуется, причина только у админа', () => {
    const { b, rg } = setup();
    rg('СР1', 'buy', toy());
    b.advance(5 * MIN);
    expect(admin(b, 'cancelPurchase', { id: 1, reason: 'ошиблись местом' })).toMatchObject({ ok: true });
    expect(b.get().purchases[0].cancelledAt).toBe(`${DAY}T10:05:00+03:00`);
    expect(JSON.stringify(b.get())).not.toContain('ошиблись');
    expect(admin(b, 'getPrivate').cancelReasons).toEqual({ 1: 'ошиблись местом' });
    expect(rg('СР1', 'buy', toy()).id).toBe(2);
  });

  test.each([[{ id: 1, reason: '' }], [{ id: 1, reason: '  ' }], [{ id: 1, reason: 'x'.repeat(201) }], [{ id: 1, reason: '=1+1' }], [{ id: 9, reason: 'нет такой' }], [{ id: '1', reason: 'да' }]])('отмена: мусор %j', (extra) => {
    const { b, rg } = setup();
    rg('СР1', 'buy', toy());
    expect(admin(b, 'cancelPurchase', extra)).toEqual(bad);
    expect(b.get().purchases[0].cancelledAt).toBeNull();
  });

  test('дважды не отменить', () => {
    const { b, rg } = setup();
    rg('СР1', 'buy', toy());
    admin(b, 'cancelPurchase', { id: 1, reason: 'раз' });
    expect(admin(b, 'cancelPurchase', { id: 1, reason: 'два' })).toEqual(bad);
  });
});

describe('выдача валюты', () => {
  test('запись видна без причины', () => {
    const { b } = setup();
    expect(admin(b, 'grant', { group: 'СР2', kind: 'flakes', delta: -5, reason: 'ошибка выгрузки', ref: ref() })).toMatchObject({ ok: true, id: 1 });
    expect(b.get().grants).toEqual([{ id: 1, date: DAY, group: 'СР2', kind: 'flakes', delta: -5 }]);
    expect(admin(b, 'getPrivate').grantReasons).toEqual({ 1: 'ошибка выгрузки' });
  });

  test('повтор ref не выдаёт второй раз', () => {
    const { b } = setup();
    const g = { group: 'СР2', kind: 'coins', delta: 3, reason: 'ручная', ref: ref() };
    admin(b, 'grant', g);
    expect(admin(b, 'grant', g)).toMatchObject({ ok: true, duplicate: true });
    expect(b.get().grants).toHaveLength(1);
  });

  test.each([[{ delta: 0 }], [{ delta: 501 }], [{ delta: -501 }], [{ delta: 1.5 }], [{ kind: 'рубли' }], [{ group: 'СР4' }], [{ reason: '' }], [{ reason: '=A1' }], [{ ref: '' }]])('мусор %j', (extra) => {
    const { b } = setup();
    expect(admin(b, 'grant', { group: 'СР2', kind: 'coins', delta: 3, reason: 'ручная', ref: ref(), ...extra })).toEqual(bad);
  });
});

describe('Гринч', () => {
  test('по умолчанию сам по себе, 120 минут, команд нет', () => {
    expect(setup().b.get().grinch).toEqual({ auto: true, quietMin: 120, commands: [] });
  });

  test('настройки и команды', () => {
    const { b } = setup();
    expect(admin(b, 'setGrinch', { auto: false, quietMin: 90 }).ok).toBe(true);
    admin(b, 'grinchCommand', { kind: 'steal' });
    b.advance(MIN);
    admin(b, 'grinchCommand', { kind: 'return' });
    expect(b.get().grinch).toEqual({
      auto: false, quietMin: 90,
      commands: [{ id: 1, kind: 'steal', at: `${DAY}T10:00:00+03:00` }, { id: 2, kind: 'return', at: `${DAY}T10:01:00+03:00` }],
    });
  });

  test('хранит 20 последних команд, номера растут', () => {
    const { b } = setup();
    for (let i = 0; i < 25; i++) admin(b, 'grinchCommand', { kind: 'garland' });
    const ids = b.get().grinch.commands.map((c) => c.id);
    expect([ids.length, ids[0], ids.at(-1)]).toEqual([20, 6, 25]);
  });

  test.each([['setGrinch', { auto: 1, quietMin: 120 }], ['setGrinch', { auto: true, quietMin: 29 }], ['setGrinch', { auto: true, quietMin: 481 }], ['setGrinch', { auto: true }], ['grinchCommand', { kind: 'взорвать' }]])('%s: мусор %j', (action, extra) => {
    expect(admin(setup().b, action, extra)).toEqual(bad);
  });

  test('РГ Гринчем не управляет', () => {
    const { b, groupPins } = setup();
    expect(b.post({ action: 'grinchCommand', pin: groupPins['СР3'], kind: 'steal' }).ok).toBe(false);
  });
});

describe('команды экрану', () => {
  test('очередь из 10 последних, свежее 10 минут', () => {
    const { b } = setup();
    for (let i = 0; i < 12; i++) admin(b, 'screenCommand', { kind: 'salute' });
    expect(b.get().commands.map((c) => c.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    b.advance(11 * MIN);
    expect(b.get().commands).toEqual([]);
    admin(b, 'screenCommand', { kind: 'snowball', group: 'СР3' });
    expect(b.get().commands).toEqual([{ id: 13, at: `${DAY}T10:11:00+03:00`, kind: 'snowball', group: 'СР3' }]);
  });

  test('команда двигает версию: экран узнаёт на ближайшем опросе', () => {
    const { b } = setup();
    const v = b.get().version;
    expect(admin(b, 'screenCommand', { kind: 'replay' }).version).toBe(v + 1);
  });

  test.each([[{ kind: 'взрыв' }], [{ kind: 'snowball' }], [{ kind: 'snowball', group: 'СР4' }]])('мусор %j', (extra) => {
    expect(admin(setup().b, 'screenCommand', extra)).toEqual(bad);
  });
});

describe('финал', () => {
  const imported = () => {
    const s = setup();
    admin(s.b, 'importPayments', { from: '2026-12-01', to: '2026-12-09', rows: [] });
    return s;
  };

  test('дата не позже последнего официального импорта', () => {
    const { b } = imported();
    expect(admin(b, 'setFinale', { cutoff: '2026-12-10' })).toEqual(bad);
    expect(admin(b, 'setFinale', { cutoff: '2026-11-30' })).toEqual(bad);
    expect(admin(b, 'setFinale', { cutoff: '2026-12-09' }).ok).toBe(true);
    expect(b.get().finale).toEqual({ cutoff: '2026-12-09', at: `${DAY}T10:00:00+03:00` });
  });

  test('без импорта финала нет', () => {
    expect(admin(setup().b, 'setFinale', { cutoff: '2026-12-09' })).toEqual(bad);
  });

  test('после финала лавка закрыта, отмена финала открывает', () => {
    const { b, rg } = imported();
    admin(b, 'setFinale', { cutoff: '2026-12-09' });
    expect(rg('СР1', 'buy', toy())).toEqual({ ok: false, error: 'finished' });
    expect(rg('СР1', 'addPayment', { delta: 1, ref: ref() })).toEqual({ ok: false, error: 'finished' });
    expect(admin(b, 'clearFinale').ok).toBe(true);
    expect([b.get().finale, rg('СР1', 'buy', toy()).ok]).toEqual([null, true]);
  });

  test('повтор покупки, прошедшей до финала, отвечает успехом', () => {
    const { b, rg } = imported();
    const t = toy();
    rg('СР1', 'buy', t);
    admin(b, 'setFinale', { cutoff: '2026-12-09' });
    expect(rg('СР1', 'buy', t)).toMatchObject({ ok: true, id: 1, duplicate: true });
  });

  test('отменять нечего', () => {
    expect(admin(setup().b, 'clearFinale')).toEqual(bad);
  });
});

test('старых действий питомцев нет', () => {
  const { b, rg } = setup();
  for (const a of ['useItem', 'vacation', 'setOverride']) expect(rg('СР1', a, { ref: ref() }).error).toBe('bad_request');
  expect(b.get()).not.toHaveProperty('overrides');
});
