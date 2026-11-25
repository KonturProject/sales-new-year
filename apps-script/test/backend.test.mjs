import { describe, test, expect } from 'vitest';
import { loadBackend, TEST_ADMIN_PIN as PIN } from './gas-harness.mjs';

// «Сегодня» во всех тестах — четверг 2026-12-12 (рабочий день), 10:00 по Москве; все ФИО вымышленные.
const GROUP_CODES = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const MIN = 60_000;

const admin = (b, action, extra = {}) => b.post({ action, pin: PIN, ...extra });
const pay = (date, group, author, invoice) => ({ date, group, author, invoice });
const STAFF = [
  { name: 'Иванов Иван', group: 'СР1' },
  { name: 'Петров Пётр', group: 'СР1' },
  { name: 'Сидорова Анна', group: 'СР5' },
];

function withStaff() {
  const b = loadBackend();
  expect(admin(b, 'setStaff', { staff: STAFF }).ok).toBe(true);
  const id = Object.fromEntries(b.get().staff.map((e) => [e.name, e.id]));
  return { b, id };
}

describe('PIN', () => {
  test('5 неверных PIN блокируют вход на 10 минут, затем блок снимается', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'login', pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login', pin: '000000' }).ok).toBe(false);
    const locked = b.post({ action: 'login', pin: PIN });
    expect(locked).toMatchObject({ ok: false, error: 'locked' });
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(locked.retryAfterSec).toBeLessThanOrEqual(600);
    b.advance(9 * MIN);
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('locked');
    b.advance(MIN + 1000);
    expect(b.post({ action: 'login', pin: PIN })).toMatchObject({ ok: true });
  });

  test('ошибки старше 10 минут не копятся', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) b.post({ action: 'login', pin: '000000' });
    b.advance(11 * MIN);
    expect(b.post({ action: 'login', pin: '000000' }).error).toBe('invalid_pin');
    expect(b.post({ action: 'login', pin: PIN })).toMatchObject({ ok: true });
  });

  test('верный PIN сбрасывает счётчик ошибок', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) b.post({ action: 'login', pin: '000000' });
    expect(b.post({ action: 'login', pin: PIN })).toMatchObject({ ok: true });
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'login', pin: '000000' }).error).toBe('invalid_pin');
  });

  test('setGroupPins выдаёт шесть разных PIN по 6–12 цифр, отличных от админского; старые перестают работать', () => {
    const b = loadBackend();
    const first = admin(b, 'setGroupPins');
    expect(first.ok).toBe(true);
    const pins = GROUP_CODES.map((g) => first.groupPins[g]);
    expect(Object.keys(first.groupPins)).toEqual(GROUP_CODES);
    for (const p of pins) expect(p).toMatch(/^\d{6,12}$/);
    expect(new Set(pins).size).toBe(6);
    expect(pins).not.toContain(PIN);
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: first.groupPins['СР5'] })).toMatchObject({ ok: true, group: 'СР5' });
    const second = admin(b, 'setGroupPins');
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: first.groupPins['СР5'] }).error).toBe('invalid_pin');
    expect(b.post({ action: 'groupLogin', group: 'СР5', groupPin: second.groupPins['СР5'] })).toMatchObject({ ok: true, group: 'СР5' });
  });

  test('PIN группы проверяется только против заявленной группы: чужой верный PIN — invalid_pin', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР2'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toMatchObject({ ok: true, group: 'СР1' });
  });

  test('groupLogin без группы или с неизвестной группой — bad_request, счётчик ошибок не растёт', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const bad = [{}, { group: 'СР4' }, { group: 5 }, { group: null }];
    for (let i = 0; i < 3; i++) {
      for (const extra of bad) {
        expect(b.post({ action: 'groupLogin', groupPin: '000000', ...extra }), JSON.stringify(extra)).toEqual({ ok: false, error: 'bad_request' });
      }
    }
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toMatchObject({ ok: true, group: 'СР1' });
  });

  test('у каждой группы свой счётчик ошибок: пять промахов по СР1 блокируют только СР1', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    for (let i = 0; i < 4; i++) expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error).toBe('invalid_pin');
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error).toBe('locked');
    const locked = b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] });
    expect(locked).toMatchObject({ ok: false, error: 'locked' });
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] })).toMatchObject({ ok: true, group: 'СР2' });
    b.advance(11 * MIN);
    expect(b.post({ action: 'groupLogin', group: 'СР1', groupPin: groupPins['СР1'] })).toMatchObject({ ok: true, group: 'СР1' });
  });

  test('вход «своей» группы не сбрасывает ошибки по чужой: перебор с собственным PIN блокируется', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const results = [];
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) results.push(b.post({ action: 'groupLogin', group: 'СР1', groupPin: '000000' }).error);
      expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] }).ok).toBe(true);
    }
    expect(results).toContain('locked');
    expect(results.filter((e) => e === 'invalid_pin')).toHaveLength(4);
  });

  test('PIN группы не открывает админ-действия, админский PIN не открывает groupLogin', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const gp = groupPins['СР1'];
    const attempts = [
      b.post({ action: 'setStaff', pin: gp, staff: STAFF }),
      b.post({ action: 'setStaff', groupPin: gp, staff: STAFF }),
      b.post({ action: 'setProvisional', groupPin: gp, date: '2026-12-11', group: 'СР1', count: 1 }),
      b.post({ action: 'setGroupPins', pin: gp }),
      b.post({ action: 'groupLogin', group: 'СР1', groupPin: PIN }),
      b.post({ action: 'groupLogin', group: 'СР1', pin: gp }),
    ];
    for (const r of attempts) expect(r).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.get().staff).toEqual([]);
  });

  test('блокировка админского PIN не блокирует вход групп, и наоборот', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    for (let i = 0; i < 5; i++) b.post({ action: 'login', pin: '000000' });
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('locked');
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] })).toMatchObject({ ok: true, group: 'СР2' });
    b.advance(11 * MIN);
    for (let i = 0; i < 5; i++) b.post({ action: 'groupLogin', group: 'СР2', groupPin: '000000' });
    expect(b.post({ action: 'groupLogin', group: 'СР2', groupPin: groupPins['СР2'] }).error).toBe('locked');
    expect(b.post({ action: 'login', pin: PIN })).toMatchObject({ ok: true });
  });

  test('changePin: старый PIN перестаёт работать, слабый и совпадающий с PIN группы отвергаются', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    expect(admin(b, 'changePin', { newPin: '12' }).error).toBe('bad_request');
    expect(admin(b, 'changePin', { newPin: 'abcd' }).error).toBe('bad_request');
    expect(admin(b, 'changePin', { newPin: groupPins['СР1'] }).error).toBe('bad_request');
    expect(b.post({ action: 'changePin', pin: '000000', newPin: '7777' }).error).toBe('invalid_pin');
    expect(admin(b, 'changePin', { newPin: '7777' })).toEqual({ ok: true });
    expect(b.post({ action: 'login', pin: PIN }).error).toBe('invalid_pin');
    expect(b.post({ action: 'login', pin: '7777' })).toMatchObject({ ok: true });
  });

  test('initAdminPin берёт PIN из свойства INITIAL_PIN, стирает его и не перезаписывает существующий', () => {
    const b = loadBackend({ adminPin: null });
    expect(b.post({ action: 'login', pin: '5555' }).ok).toBe(false);
    b.props.set('INITIAL_PIN', '5555');
    b.run('initAdminPin');
    expect(b.props.has('INITIAL_PIN')).toBe(false);
    expect(b.post({ action: 'login', pin: '5555' })).toMatchObject({ ok: true });
    b.props.set('INITIAL_PIN', '9999');
    expect(() => b.run('initAdminPin')).toThrow();
    expect(b.post({ action: 'login', pin: '5555' })).toMatchObject({ ok: true });
  });
});

describe('GET', () => {
  test('пустой снимок: версия, московское время сервера, пустые списки', () => {
    const b = loadBackend();
    expect(b.get()).toEqual({
      ok: true,
      version: expect.any(Number),
      serverNow: '2026-12-12T10:00:00+03:00',
      funnelThrough: null,
      paymentsImportedThrough: null,
      config: {},
      configChanges: [],
      staff: [],
      absences: [],
      payments: [],
      provisional: [],
      funnel: [],
      purchases: [],
      grants: [],
      lastPaymentAt: null,
      grinch: { auto: true, quietMin: 120, commands: [] },
      finale: null,
      commands: [],
      corrections: [],
    });
  });

  test('в снимке нет хешей, солей, PIN и сумм', () => {
    const { b } = withStaff();
    const { groupPins } = admin(b, 'setGroupPins');
    admin(b, 'changePin', { newPin: '7777' });
    b.post({ action: 'importPayments', pin: '7777', from: '2026-12-09', to: '2026-12-10', rows: [pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1')] });
    const raw = JSON.stringify(b.get());
    expect(raw).not.toMatch(/hash|salt|pin|amount/i);
    expect(b.props.size).toBeGreaterThan(0);
    for (const [key, value] of b.props) {
      if (key === 'SPREADSHEET_ID') continue;
      expect(raw, key).not.toContain(value);
    }
    for (const p of Object.values(groupPins)) expect(raw).not.toContain(p);
  });

  test('?since=<версия> при неизменных данных не отдаёт снимок; после записи отдаёт', () => {
    const { b } = withStaff();
    const v = b.get().version;
    const same = b.get({ since: String(v) });
    expect(same).toEqual({ ok: true, unchanged: true, version: v, serverNow: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+03:00$/) });
    expect(same.serverNow).toBe(b.get().serverNow);
    expect(b.get({ since: String(v - 1) }).staff).toHaveLength(3);
    expect(b.get({ since: 'мусор' }).staff).toHaveLength(3);
    const written = admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР1', count: 1 });
    expect(written.version).toBe(v + 1);
    expect(b.get({ since: String(v) }).version).toBe(v + 1);
    expect(b.get({ since: String(v + 1) }).unchanged).toBe(true);
  });

  test('версию двигают только успешные записи с данными', () => {
    const { b } = withStaff();
    const v = b.get().version;
    b.post({ action: 'login', pin: PIN });
    admin(b, 'setGroupPins');
    admin(b, 'changePin', { newPin: PIN });
    admin(b, 'setProvisional', { date: 'мусор', group: 'СР1', count: 1 });
    b.post({ action: 'setProvisional', pin: '000000', date: '2026-12-11', group: 'СР1', count: 1 });
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-10', rows: [], dryRun: true });
    expect(b.get().version).toBe(v);
  });

  test('запрос открывает таблицу один раз, следующий запрос — заново', () => {
    const { b } = withStaff();
    const before = b.opened();
    b.get();
    expect(b.opened()).toBe(before + 1);
    b.get({ since: '0' });
    expect(b.opened()).toBe(before + 2);
    admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР1', count: 1 });
    expect(b.opened()).toBe(before + 3);
  });
});

describe('importPayments', () => {
  const rows = () => [
    pay('2026-12-10', 'СР5', 'Сидорова Анна', 'B-1'),
    pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-2'),
    pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'),
  ];

  test('за период заменяет оба слоя и идемпотентен', () => {
    const b = loadBackend();
    admin(b, 'setProvisional', { date: '2026-12-09', group: 'СР2', count: 3 });
    admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР2', count: 2 });
    expect(admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-10', rows: rows() })).toMatchObject({ ok: true });
    const first = b.get();
    expect(first.payments).toEqual([
      pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'),
      pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-2'),
      pay('2026-12-10', 'СР5', 'Сидорова Анна', 'B-1'),
    ]);
    expect(first.provisional).toEqual([{ date: '2026-12-11', group: 'СР2', count: 2 }]);
    expect(first.paymentsImportedThrough).toBe('2026-12-10');

    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-10', rows: rows() });
    const second = b.get();
    expect(second.payments).toEqual(first.payments);
    expect(second.provisional).toEqual(first.provisional);
    expect(second.paymentsImportedThrough).toBe('2026-12-10');
  });

  test('повторная загрузка убирает строки, которых в новом файле нет, и не трогает дни вне периода', () => {
    const b = loadBackend();
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-11', rows: [...rows(), pay('2026-12-11', 'СР1', 'Петров Пётр', 'C-1')] });
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-09', rows: [pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1')] });
    const snap = b.get();
    expect(snap.payments.map((p) => p.invoice)).toEqual(['A-1', 'B-1', 'C-1']);
    expect(snap.paymentsImportedThrough).toBe('2026-12-11');
  });

  test('номера счетов остаются текстом: ведущие нули и длинные номера не превращаются в числа', () => {
    const b = loadBackend();
    const invoices = ['000123', '2026110900001234567890'];
    admin(b, 'importPayments', {
      from: '2026-12-09',
      to: '2026-12-09',
      rows: invoices.map((n) => pay('2026-12-09', 'СР1', '123', n)),
    });
    const snap = b.get();
    expect(snap.payments.map((p) => p.invoice).sort()).toEqual([...invoices].sort());
    expect(snap.payments.map((p) => p.author)).toEqual(['123', '123']);
    expect(snap.payments.every((p) => typeof p.date === 'string' && p.date === '2026-12-09')).toBe(true);
  });

  test('пишет таблицу одним вызовом setValues, а не построчно', () => {
    const b = loadBackend();
    const many = Array.from({ length: 300 }, (_, i) => pay('2026-12-09', 'СР1', 'Иванов Иван', `N-${i}`));
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-09', rows: [] });
    const sheet = b.sheet('Payments');
    const before = sheet.setValuesCalls;
    expect(admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-09', rows: many }).ok).toBe(true);
    expect(sheet.setValuesCalls - before).toBeLessThanOrEqual(1);
    expect(b.get().payments).toHaveLength(300);
  });

  test('dryRun ничего не пишет и сообщает, сколько добавится и что будет заменено', () => {
    const b = loadBackend();
    admin(b, 'setProvisional', { date: '2026-12-09', group: 'СР2', count: 3 });
    admin(b, 'setProvisional', { date: '2026-12-10', group: 'СР3', count: 4 });
    admin(b, 'importPayments', { from: '2026-12-05', to: '2026-12-06', rows: [pay('2026-12-05', 'СР1', 'Иванов Иван', 'OLD-1')] });
    const before = b.get();
    const preview = admin(b, 'importPayments', { from: '2026-12-05', to: '2026-12-10', rows: rows(), dryRun: true });
    expect(preview).toEqual({ ok: true, dryRun: true, added: 3, ignored: 0, removed: 1, removedProvisional: 7 });
    expect(b.get()).toEqual(before);
  });

  test('строки вне периода (выгрузка «хвостом» за сегодня или с прошлого месяца) игнорируются и считаются в ignored', () => {
    const b = loadBackend();
    const file = [
      pay('2026-12-08', 'СР1', 'Иванов Иван', 'OLD-1'),
      pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'),
      pay('2026-12-10', 'СР2', 'Петров Пётр', 'B-1'),
      pay('2026-12-12', 'СР1', 'Иванов Иван', 'TODAY-1'),
    ];
    const args = { from: '2026-12-09', to: '2026-12-10', rows: file };
    expect(admin(b, 'importPayments', { ...args, dryRun: true })).toMatchObject({ ok: true, added: 2, ignored: 2 });
    expect(b.get().payments).toEqual([]);
    expect(admin(b, 'importPayments', args)).toMatchObject({ ok: true, added: 2, ignored: 2 });
    expect(b.get().payments.map((p) => p.invoice)).toEqual(['A-1', 'B-1']);
    expect(b.get().paymentsImportedThrough).toBe('2026-12-10');
  });

  test('строка с мусором внутри файла по-прежнему отклоняет весь файл, даже если она вне периода', () => {
    const b = loadBackend();
    const before = b.get();
    const args = { from: '2026-12-09', to: '2026-12-10' };
    const bad = [
      [pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-02-30', 'СР1', 'Иванов Иван', 'X-1')],
      [pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-12-12', 'СР4', 'Иванов Иван', 'X-1')],
      [pay('2026-12-09', 'СР1', 'Иванов Иван', 'A-1'), pay('2026-12-12', 'СР1', 'Иванов Иван', '')],
    ];
    for (const rows of bad) expect(admin(b, 'importPayments', { ...args, rows })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('отвергает неверный период и строки (bad_request), ничего не записывая', () => {
    const b = loadBackend();
    const before = b.get();
    const bad = [
      { from: '2026-12-09', to: '2026-12-12', rows: [] }, // to = сегодня
      { from: '2026-12-09', to: '2026-12-13', rows: [] }, // to в будущем
      { from: '2026-12-10', to: '2026-12-09', rows: [] }, // from > to
      { from: '2026-09-01', to: '2026-12-10', rows: [] }, // больше 62 дней
      { from: '2026-13-45', to: '2026-12-10', rows: [] },
      { from: 'abc', to: '2026-12-10', rows: [] },
      { from: 20261109, to: '2026-12-10', rows: [] },
      { from: '2026-12-09', to: '2026-12-10' },
      { from: '2026-12-09', to: '2026-12-10', rows: 'x' },
      { from: '2026-12-09', to: '2026-12-10', rows: [null] },
      { from: '2026-12-09', to: '2026-12-10', rows: [pay('2026-12-09', 'СР4', 'Иванов Иван', 'A-1')] }, // чужая группа
      { from: '2026-12-09', to: '2026-12-10', rows: [pay('2026-12-09', 'СР1', 'Иванов Иван', '')] },
      { from: '2026-12-09', to: '2026-12-10', rows: [pay('2026-02-30', 'СР1', 'Иванов Иван', 'A-1')] },
      { from: '2026-12-09', to: '2026-12-10', rows: [{ date: '2026-12-09', group: 'СР1', author: 5, invoice: 'A-1' }] },
    ];
    for (const body of bad) expect(admin(b, 'importPayments', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-11', rows: [] }).ok).toBe(true);
    expect({ ...b.get(), version: 0, paymentsImportedThrough: null }).toEqual({ ...before, version: 0 });
  });
});

describe('setProvisional', () => {
  test('день до импорта принимается; повтор для той же группы и дня заменяет число', () => {
    const b = loadBackend();
    expect(admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР2', count: 3 }).ok).toBe(true);
    expect(admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР2', count: 5 }).ok).toBe(true);
    admin(b, 'setProvisional', { date: '2026-12-12', group: 'СР2', count: 1 });
    expect(b.get().provisional).toEqual([
      { date: '2026-12-11', group: 'СР2', count: 5 },
      { date: '2026-12-12', group: 'СР2', count: 1 },
    ]);
  });

  test('день, уже закрытый импортом файла, отвергается, следующий принимается', () => {
    const b = loadBackend();
    admin(b, 'importPayments', { from: '2026-12-09', to: '2026-12-10', rows: [] });
    expect(admin(b, 'setProvisional', { date: '2026-12-09', group: 'СР1', count: 1 })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setProvisional', { date: '2026-12-10', group: 'СР1', count: 1 })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setProvisional', { date: '2026-12-11', group: 'СР1', count: 1 }).ok).toBe(true);
    expect(b.get().provisional).toEqual([{ date: '2026-12-11', group: 'СР1', count: 1 }]);
  });

  test('будущий день, мусор и неверное число — bad_request', () => {
    const b = loadBackend();
    const bad = [
      { date: '2026-12-13', group: 'СР1', count: 1 },
      { date: '2026-02-30', group: 'СР1', count: 1 },
      { date: 'мусор', group: 'СР1', count: 1 },
      { date: '2026-12-11', group: 'СР4', count: 1 },
      { date: '2026-12-11', group: 'СР1', count: -1 },
      { date: '2026-12-11', group: 'СР1', count: 1.5 },
      { date: '2026-12-11', group: 'СР1', count: '3' },
      { date: '2026-12-11', group: 'СР1' },
    ];
    for (const body of bad) expect(admin(b, 'setProvisional', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get().provisional).toEqual([]);
  });
});

describe('importFunnel', () => {
  const day = (name, date, quality, long) => ({ name, date, quality, long });

  test('ё и е — одна буква: «Петров Петр» из файла находит «Петров Пётр» штата, setStaff не плодит двойника', () => {
    const { b, id } = withStaff();
    expect(admin(b, 'importFunnel', { through: '2026-12-10', rows: [day('Петров Петр', '2026-12-09', 1, 1)] })).toMatchObject({ ok: true, added: 1 });
    expect(b.get().funnel).toEqual([{ employeeId: id['Петров Пётр'], date: '2026-12-09', quality: 1, long: 1 }]);
    expect(admin(b, 'setStaff', { staff: [{ name: 'ПЕТРОВ ПЕТР', group: 'СР1', shortName: 'Петя' }] })).toMatchObject({ ok: true, added: 0, updated: 1 });
    expect(b.get().staff).toHaveLength(3);
  });

  test('пишет факты по сотрудникам, двигает funnelThrough, повтор даёт тот же результат', () => {
    const { b, id } = withStaff();
    const rows = [
      day('Иванов Иван', '2026-12-10', 2, 3),
      day('  петров   ПЁТР ', '2026-12-09', 0, 1),
      day('Иванов Иван', '2026-12-09', 4, 5),
    ];
    expect(admin(b, 'importFunnel', { through: '2026-12-10', rows })).toMatchObject({ ok: true });
    const first = b.get();
    expect(first.funnelThrough).toBe('2026-12-10');
    expect(first.funnel).toEqual([
      { employeeId: id['Иванов Иван'], date: '2026-12-09', quality: 4, long: 5 },
      { employeeId: id['Петров Пётр'], date: '2026-12-09', quality: 0, long: 1 },
      { employeeId: id['Иванов Иван'], date: '2026-12-10', quality: 2, long: 3 },
    ]);
    admin(b, 'importFunnel', { through: '2026-12-10', rows });
    const second = b.get();
    expect(second.funnel).toEqual(first.funnel);
    expect(second.funnelThrough).toBe('2026-12-10');
  });

  test('исправленный файл перекрывает значения, а сотрудники вне файла сохраняют прежние строки', () => {
    const { b, id } = withStaff();
    admin(b, 'importFunnel', { through: '2026-12-10', rows: [day('Иванов Иван', '2026-12-09', 1, 1), day('Петров Пётр', '2026-12-09', 2, 2)] });
    admin(b, 'importFunnel', { through: '2026-12-11', rows: [day('Иванов Иван', '2026-12-09', 7, 7), day('Иванов Иван', '2026-12-11', 3, 3)] });
    const snap = b.get();
    expect(snap.funnelThrough).toBe('2026-12-11');
    expect(snap.funnel).toEqual([
      { employeeId: id['Иванов Иван'], date: '2026-12-09', quality: 7, long: 7 },
      { employeeId: id['Петров Пётр'], date: '2026-12-09', quality: 2, long: 2 },
      { employeeId: id['Иванов Иван'], date: '2026-12-11', quality: 3, long: 3 },
    ]);
  });

  test('будущие дни файла (после through, нули колонок без данных) игнорируются и считаются в ignored', () => {
    const { b, id } = withStaff();
    const rows = [
      day('Иванов Иван', '2026-12-09', 4, 5),
      day('Иванов Иван', '2026-12-11', 0, 0),
      day('Петров Пётр', '2026-12-11', 0, 0),
      day('Иванов Иван', '2026-12-30', 0, 0),
    ];
    expect(admin(b, 'importFunnel', { through: '2026-12-10', rows })).toMatchObject({ ok: true, added: 1, ignored: 3 });
    expect(b.get().funnel).toEqual([{ employeeId: id['Иванов Иван'], date: '2026-12-09', quality: 4, long: 5 }]);
    expect(b.get().funnelThrough).toBe('2026-12-10');
  });

  test('неизвестное ФИО, сегодняшний through и мусор — bad_request, ничего не пишется', () => {
    const { b } = withStaff();
    const before = b.get();
    const ok = day('Иванов Иван', '2026-12-09', 1, 1);
    const bad = [
      { through: '2026-12-10', rows: [ok, day('Неизвестный Человек', '2026-12-09', 1, 1)] },
      { through: '2026-12-10', rows: [ok, day('Неизвестный Человек', '2026-12-30', 0, 0)] },
      { through: '2026-12-12', rows: [ok] },
      { through: 'мусор', rows: [ok] },
      { through: '2026-12-10' },
      { through: '2026-12-10', rows: [null] },
      { through: '2026-12-10', rows: [day('Иванов Иван', '2026-12-09', -1, 1)] },
      { through: '2026-12-10', rows: [day('Иванов Иван', '2026-12-09', 1, 1.5)] },
      { through: '2026-12-10', rows: [day('Иванов Иван', '2026-02-30', 1, 1)] },
    ];
    for (const body of bad) expect(admin(b, 'importFunnel', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });
});

describe('setStaff', () => {
  test('новый сотрудник получает значения по умолчанию', () => {
    const { b } = withStaff();
    expect(b.get().staff[0]).toEqual({
      id: expect.stringMatching(/^e\d+$/),
      name: 'Иванов Иван',
      shortName: 'Иванов И.',
      group: 'СР1',
      hireDate: null,
      fireDate: null,
      baseLevel: 'experienced',
      hiddenFromRating: false,
      transfers: [],
      paymentPlan: null,
    });
  });

  test('upsert по нормализованному ФИО сохраняет id и не трогает поля, которых нет в запросе', () => {
    const { b, id } = withStaff();
    admin(b, 'setStaff', {
      staff: [{ name: 'Иванов Иван', group: 'СР1', hireDate: '2026-11-01', baseLevel: 'rookie1', hiddenFromRating: true, hiddenReason: 'декрет', transfers: [{ date: '2026-12-10', group: 'СР2' }] }],
    });
    admin(b, 'setStaff', { staff: [{ name: '  иванов   иван ', group: 'СР1' }, { name: 'Новикова Ольга', group: 'СР9' }] });
    const staff = b.get().staff;
    expect(staff).toHaveLength(4);
    const ivanov = staff.find((e) => e.name === 'Иванов Иван');
    expect(ivanov).toMatchObject({
      id: id['Иванов Иван'],
      hireDate: '2026-11-01',
      baseLevel: 'rookie1',
      hiddenFromRating: true,
      transfers: [{ date: '2026-12-10', group: 'СР2' }],
    });
    expect(new Set(staff.map((e) => e.id)).size).toBe(4);
  });

  test('null очищает дату, явное значение перезаписывает', () => {
    const { b } = withStaff();
    admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР1', fireDate: '2026-12-20' }] });
    expect(b.get().staff.find((e) => e.name === 'Иванов Иван').fireDate).toBe('2026-12-20');
    admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР3', fireDate: null }] });
    expect(b.get().staff.find((e) => e.name === 'Иванов Иван')).toMatchObject({ fireDate: null, group: 'СР3' });
  });

  test('два сотрудника с одинаковым нормализованным ФИО в одном запросе и неверные поля — bad_request', () => {
    const { b } = withStaff();
    const before = b.get();
    const bad = [
      [{ name: 'Орлов Олег', group: 'СР1' }, { name: ' орлов  ОЛЕГ', group: 'СР2' }],
      [{ name: 'Орлов Олег', group: 'СР4' }],
      [{ name: 'Орлов Олег', group: 'СР1', baseLevel: 'senior' }],
      [{ name: 'Орлов Олег', group: 'СР1', hireDate: '2026-02-30' }],
      [{ name: 'Орлов Олег', group: 'СР1', transfers: [{ date: 'x', group: 'СР2' }] }],
      [{ name: 'Орлов Олег', group: 'СР1', transfers: 'x' }],
      [{ name: '   ', group: 'СР1' }],
      [{ group: 'СР1' }],
      [1],
      [null],
    ];
    for (const staff of bad) expect(admin(b, 'setStaff', { staff }), JSON.stringify(staff)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setStaff', {})).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });
});

describe('личный план оплат на месяц (paymentPlan)', () => {
  const ivanov = (b) => b.get().staff.find((e) => e.name === 'Иванов Иван');
  const setPlan = (b, paymentPlan) => admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР1', paymentPlan }] });

  test('число до сотых сохраняется, 0 — это план 0, null снимает, без поля — прежний', () => {
    const { b } = withStaff();
    expect(setPlan(b, 6.3).ok).toBe(true);
    expect(ivanov(b).paymentPlan).toBe(6.3);
    admin(b, 'setStaff', { staff: [{ name: 'Иванов Иван', group: 'СР1', hireDate: '2026-11-14' }] });
    expect(ivanov(b)).toMatchObject({ paymentPlan: 6.3, hireDate: '2026-11-14' });
    setPlan(b, 0);
    expect(ivanov(b).paymentPlan).toBe(0);
    setPlan(b, null);
    expect(ivanov(b).paymentPlan).toBe(null);
  });

  test('вне 0…50, больше двух знаков, строка, логическое — bad_request, лист на месте', () => {
    const { b } = withStaff();
    setPlan(b, 6);
    const before = b.get();
    for (const v of [51, -1, 1.234, '6', true, {}]) expect(setPlan(b, v), JSON.stringify(v)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('старый лист без столбца: план читается как null, при записи дописывается заголовок', () => {
    const { b } = withStaff();
    const sheet = b.sheet('Staff');
    sheet.rows = sheet.rows.map((r) => r.slice(0, 10));
    expect(ivanov(b).paymentPlan).toBe(null);
    setPlan(b, 2);
    expect(sheet.rows[0][10]).toBe('paymentPlan');
    expect(ivanov(b).paymentPlan).toBe(2);
  });

  test('у старого листа всего 10 столбцов: GET работает, запись добавляет столбец', () => {
    const { b } = withStaff();
    const sheet = b.sheet('Staff');
    sheet.rows = sheet.rows.map((r) => r.slice(0, 10));
    sheet.maxColumns = 10;
    expect(ivanov(b).paymentPlan).toBe(null);
    expect(setPlan(b, 3).ok).toBe(true);
    expect(sheet.maxColumns).toBe(11);
    expect(sheet.rows[0][10]).toBe('paymentPlan');
    expect(ivanov(b).paymentPlan).toBe(3);
  });

  test('ячейку испортили руками: мусор и отрицательное — null; число, которое Таблица распознала сама, читается', () => {
    const { b } = withStaff();
    const sheet = b.sheet('Staff');
    const row = sheet.rows.findIndex((r) => r[1] === 'Иванов Иван');
    for (const junk of ['abc', '-1', '51', '1,5']) {
      sheet.rows[row][10] = junk;
      expect(ivanov(b).paymentPlan, junk).toBe(null);
    }
    sheet.rows[row][10] = 6;
    expect(ivanov(b).paymentPlan).toBe(6);
  });
});

describe('причина исключения из рейтинга', () => {
  const IVANOV = 'Иванов Иван';
  const hide = (b, extra = {}) => admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: true, ...extra }] });
  const unhide = (b) => admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: false }] });

  test('скрыть без причины нельзя: пустая, из пробелов, не строка и длиннее 200 — bad_request, ничего не пишется', () => {
    const { b } = withStaff();
    const before = b.get();
    for (const extra of [{}, { hiddenReason: '' }, { hiddenReason: '   ' }, { hiddenReason: 5 }, { hiddenReason: null }, { hiddenReason: 'а'.repeat(201) }]) {
      expect(hide(b, extra), JSON.stringify(extra)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(b.get()).toEqual(before);
    expect(hide(b, { hiddenReason: 'а'.repeat(200) }).ok).toBe(true);
    expect(b.get().staff.find((e) => e.name === IVANOV).hiddenFromRating).toBe(true);
  });

  test('GET причину не содержит, getPrivate отдаёт её по админ-PIN (обрезанную по краям)', () => {
    const { b, id } = withStaff();
    expect(hide(b, { hiddenReason: '  декрет  ' }).ok).toBe(true);
    const snapshot = b.get();
    expect(JSON.stringify(snapshot)).not.toContain('декрет');
    expect(snapshot.staff.find((e) => e.name === IVANOV)).not.toHaveProperty('hiddenReason');
    expect(admin(b, 'getPrivate')).toMatchObject({ ok: true, hiddenReasons: { [id[IVANOV]]: 'декрет' } });
  });

  test('getPrivate: PIN группы и неверный PIN — invalid_pin', () => {
    const { b } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    const { groupPins } = admin(b, 'setGroupPins');
    expect(b.post({ action: 'getPrivate', group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'getPrivate', pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'getPrivate' })).toEqual({ ok: false, error: 'invalid_pin' });
  });

  test('повторное сохранение скрытого без причины оставляет прежнюю; новая причина заменяет', () => {
    const { b, id } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    expect(hide(b).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({ [id[IVANOV]]: 'декрет' });
    expect(hide(b, { hiddenReason: 'стажёр' }).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({ [id[IVANOV]]: 'стажёр' });
  });

  test('снятие флага стирает причину, повторное скрытие требует новую', () => {
    const { b } = withStaff();
    hide(b, { hiddenReason: 'декрет' });
    expect(unhide(b).ok).toBe(true);
    expect(b.get().staff.find((e) => e.name === IVANOV).hiddenFromRating).toBe(false);
    expect(admin(b, 'getPrivate')).toMatchObject({ ok: true, hiddenReasons: {} });
    expect(hide(b)).toEqual({ ok: false, error: 'bad_request' });
  });

  test('причина при снятом флаге не сохраняется', () => {
    const { b } = withStaff();
    expect(admin(b, 'setStaff', { staff: [{ name: IVANOV, group: 'СР1', hiddenFromRating: false, hiddenReason: 'зря' }] }).ok).toBe(true);
    expect(admin(b, 'getPrivate').hiddenReasons).toEqual({});
  });
});



describe('Дробные нормы', () => {
  const setConfig = (b, config, extra = {}) => admin(b, 'setConfig', { config, ...extra });
  const FIELDS = ['quality', 'long', 'payments'];

  test('quality и long принимают до двух знаков после запятой, как payments; в GET значение как сохранено', () => {
    const b = loadBackend();
    const r = setConfig(b, { norms: { experienced: { long: 1.5, quality: 2.25 } } });
    expect(r.ok).toBe(true);
    expect(b.get().config.norms.experienced.long).toBe(1.5);
    expect(b.get().config.norms.experienced.quality).toBe(2.25);
    for (const field of FIELDS) {
      for (const v of [0, 0.01, 0.29, 1.15, 49.99, 50]) {
        expect(setConfig(b, { norms: { rookie1: { [field]: v } } }).config.norms.rookie1[field], `${field} ${v}`).toBe(v);
      }
    }
  });

  test('три знака после запятой, больше 50, меньше 0, не число — bad_request у всех трёх полей, ничего не пишется', () => {
    const b = loadBackend();
    setConfig(b, { norms: { experienced: { long: 1.5 } } });
    const before = b.get();
    for (const field of FIELDS) {
      for (const v of [1.555, 0.001, 50.01, 51, -0.01, -1, '1.5', null, true, [], {}]) {
        expect(setConfig(b, { norms: { experienced: { [field]: v } } }), `${field} ${JSON.stringify(v)}`).toEqual({ ok: false, error: 'bad_request' });
      }
    }
    expect(setConfig(b, { norms: { experienced: { long: 1.5, quality: 1.555 } } })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('правка «с даты» тоже принимает дробные quality и long', () => {
    const b = loadBackend();
    const r = setConfig(b, { norms: { rookie2: { quality: 0.5, long: 2.75 } } }, { from: '2026-12-16' });
    expect(r.configChanges).toEqual([{ from: '2026-12-16', config: { norms: { rookie2: { quality: 0.5, long: 2.75 } } } }]);
    expect(setConfig(b, { norms: { rookie2: { long: 2.755 } } }, { from: '2026-12-16' })).toEqual({ ok: false, error: 'bad_request' });
  });
});

describe('Выходные', () => {
  const setNonWorking = (b, nonWorking, extra = {}) => admin(b, 'setNonWorking', { nonWorking, ...extra });
  const allDays = Array.from({ length: 29 }, (_, i) => `2026-12-${String(i + 2).padStart(2, '0')}`);

  test('список сортируется по дате и лежит в config.nonWorking; ответ {ok, version, nonWorking}', () => {
    const b = loadBackend();
    const v0 = b.get().version;
    expect(setNonWorking(b, ['2026-12-07', '2026-12-04'])).toEqual({ ok: true, version: v0 + 1, nonWorking: ['2026-12-04', '2026-12-07'] });
    expect(b.get().config.nonWorking).toEqual(['2026-12-04', '2026-12-07']);
    expect(b.get().version).toBe(v0 + 1);
  });

  test('новый список заменяет прежний целиком; пустой список, первый и последний день игры допустимы', () => {
    const b = loadBackend();
    setNonWorking(b, ['2026-12-04', '2026-12-07']);
    expect(setNonWorking(b, ['2026-12-30', '2026-12-02']).nonWorking).toEqual(['2026-12-02', '2026-12-30']);
    expect(b.get().config.nonWorking).toEqual(['2026-12-02', '2026-12-30']);
    expect(setNonWorking(b, allDays).nonWorking).toEqual(allDays);
    expect(setNonWorking(b, []).nonWorking).toEqual([]);
    expect(b.get().config.nonWorking).toEqual([]);
  });

  test('дата вне периода, повтор, не массив, больше 29 дат, мусор — bad_request, список на месте', () => {
    const b = loadBackend();
    setNonWorking(b, ['2026-12-07']);
    const before = b.get();
    const bad = [
      ['2027-01-01'], ['2026-11-30'], ['2026-12-31'], ['2026-12-07', '2027-01-01'],
      ['2026-12-07', '2026-12-07'], ['2026-12-04', '2026-12-07', '2026-12-04'],
      '2026-12-07', { 0: '2026-12-07' }, null, undefined, 5,
      [...allDays, '2027-01-01'], [...allDays, '2026-12-02'],
      ['мусор'], ['2026-02-30'], ['2026-12-7'], [5], [null], [['2026-12-07']], [{}],
    ];
    for (const list of bad) expect(setNonWorking(b, list), JSON.stringify(list)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.post({ action: 'setNonWorking', pin: PIN })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('setConfig не стирает список (ни на всю игру, ни «с даты»); поле nonWorking в setConfig — bad_request', () => {
    const b = loadBackend();
    setNonWorking(b, ['2026-12-07', '2026-12-04']);
    expect(admin(b, 'setConfig', { config: { norms: { rookie2: { quality: 3 } } } }).config).toEqual({ norms: { rookie2: { quality: 3 } }, nonWorking: ['2026-12-04', '2026-12-07'] });
    admin(b, 'setConfig', { config: { norms: { experienced: { long: 1.5 } } } });
    admin(b, 'setConfig', { config: { norms: { rookie2: { quality: 2 } } }, from: '2026-12-16' });
    expect(b.get().config).toEqual({ norms: { rookie2: { quality: 3 }, experienced: { long: 1.5 } }, nonWorking: ['2026-12-04', '2026-12-07'] });
    const before = b.get();
    expect(admin(b, 'setConfig', { config: { nonWorking: ['2026-12-09'] } })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setConfig', { config: { nonWorking: [] }, from: '2026-12-16' })).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'setConfig', { config: { norms: { rookie2: { quality: 5 } }, nonWorking: [] } })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('setNonWorking не трогает остальные настройки и правки «с даты»', () => {
    const b = loadBackend();
    admin(b, 'setConfig', { config: { norms: { rookie1: { payments: 0.4 } } } });
    admin(b, 'setConfig', { config: { norms: { rookie1: { long: 4 } } }, from: '2026-12-16' });
    const before = b.get();
    setNonWorking(b, ['2026-12-04']);
    const after = b.get();
    expect(after.config).toEqual({ ...before.config, nonWorking: ['2026-12-04'] });
    expect(after.configChanges).toEqual(before.configChanges);
  });

  test('только админ: без PIN, с неверным и с PIN группы — invalid_pin, ничего не пишется', () => {
    const b = loadBackend();
    const { groupPins } = admin(b, 'setGroupPins');
    const before = b.get();
    const body = { action: 'setNonWorking', nonWorking: ['2026-12-04'] };
    expect(b.post(body)).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, pin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ ...body, group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.get()).toEqual(before);
  });
});


describe('отсутствия', () => {
  test('задним числом сохраняется и виден в GET; тот же сотрудник и начало обновляют запись', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    expect(admin(b, 'setAbsence', { employeeId: e, kind: 'sick', from: '2026-12-03', to: null }).ok).toBe(true);
    expect(b.get().absences).toEqual([{ employeeId: e, kind: 'sick', from: '2026-12-03', to: null }]);
    admin(b, 'setAbsence', { employeeId: e, kind: 'sick', from: '2026-12-03', to: '2026-12-06' });
    admin(b, 'setAbsence', { employeeId: e, kind: 'vacation', from: '2026-12-16', to: '2026-12-20' });
    expect(b.get().absences).toEqual([
      { employeeId: e, kind: 'sick', from: '2026-12-03', to: '2026-12-06' },
      { employeeId: e, kind: 'vacation', from: '2026-12-16', to: '2026-12-20' },
    ]);
  });

  test('removeAbsence удаляет запись и безопасен при повторе', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    admin(b, 'setAbsence', { employeeId: e, kind: 'other', from: '2026-12-03', to: '2026-12-03' });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: '2026-12-03' })).toMatchObject({ ok: true, removed: 1 });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: '2026-12-03' })).toMatchObject({ ok: true, removed: 0 });
    expect(b.get().absences).toEqual([]);
  });

  test('неизвестный сотрудник, вид, дата или to раньше from — bad_request', () => {
    const { b, id } = withStaff();
    const e = id['Иванов Иван'];
    const bad = [
      { employeeId: 'e999', kind: 'sick', from: '2026-12-03', to: null },
      { employeeId: e, kind: 'holiday', from: '2026-12-03', to: null },
      { employeeId: e, kind: 'sick', from: '2026-12-32', to: null },
      { employeeId: e, kind: 'sick', from: '2026-12-03', to: 'x' },
      { employeeId: e, kind: 'sick', from: '2026-12-05', to: '2026-12-03' },
      { kind: 'sick', from: '2026-12-03', to: null },
    ];
    for (const body of bad) expect(admin(b, 'setAbsence', body), JSON.stringify(body)).toEqual({ ok: false, error: 'bad_request' });
    expect(admin(b, 'removeAbsence', { employeeId: e, from: 'x' })).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get().absences).toEqual([]);
  });
});

describe('Правки фактов', () => {
  const CORRECTIONS_HEADER = ['id', 'date', 'employeeId', 'kind', 'delta', 'base', 'ref'];
  const add = (b, items, ref = 'ref-1', extra = {}) => admin(b, 'addCorrections', { items, ref, ...extra });
  const remove = (b, id) => admin(b, 'removeCorrection', { id });
  function withIds() {
    const { b, id } = withStaff();
    const ivan = id['Иванов Иван'];
    const item = (extra = {}) => ({ date: '2026-12-10', employeeId: ivan, kind: 'quality', delta: 1, base: 3, ...extra });
    return { b, id, ivan, item };
  }

  test('три записи одним запросом: три id по порядку, версия +1, в GET с base и без ref, лист с ref', () => {
    const { b, id, ivan, item } = withIds();
    const petr = id['Петров Пётр'];
    expect(b.get().corrections).toEqual([]);
    const v0 = b.get().version;
    const r = add(b, [item(), item({ employeeId: petr, kind: 'long', delta: -2, base: 0 }), item({ date: '2026-12-11', kind: 'payments', delta: 4, base: 7 })], 'secret-ref-77');
    expect(r).toEqual({ ok: true, version: v0 + 1, ids: [1, 2, 3] });
    const snapshot = b.get();
    expect(snapshot.version).toBe(v0 + 1);
    expect(snapshot.corrections).toEqual([
      { id: 1, date: '2026-12-10', employeeId: ivan, kind: 'quality', delta: 1, base: 3 },
      { id: 2, date: '2026-12-10', employeeId: petr, kind: 'long', delta: -2, base: 0 },
      { id: 3, date: '2026-12-11', employeeId: ivan, kind: 'payments', delta: 4, base: 7 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret-ref-77');
    expect(b.sheet('Corrections').rows[0]).toEqual(CORRECTIONS_HEADER);
    expect(b.sheet('Corrections').rows[1]).toEqual(['1', '2026-12-10', ivan, 'quality', '1', '3', 'secret-ref-77']);
    expect(add(b, [item({ delta: 2 })], 'ref-2')).toEqual({ ok: true, version: v0 + 2, ids: [4] });
    expect(b.get().corrections.map((c) => c.id)).toEqual([1, 2, 3, 4]);
  });

  test('границы: сегодня минус день, первый день игры, delta ±50, base 0 и 10000 принимаются', () => {
    const { b, item } = withIds();
    expect(add(b, [item({ date: '2026-12-11' }), item({ date: '2026-12-02', delta: 50, base: 10000 }), item({ delta: -50, base: 0 })]).ids).toEqual([1, 2, 3]);
  });

  test('повтор того же ref: duplicate, прежние id, версия и число записей не растут; другой ref — новые записи', () => {
    const { b, item } = withIds();
    const first = add(b, [item(), item({ kind: 'long' })], 'same-ref');
    const v1 = b.get().version;
    expect(add(b, [item(), item({ kind: 'long' })], 'same-ref')).toEqual({ ok: true, version: v1, ids: first.ids, duplicate: true });
    expect(b.get().version).toBe(v1);
    expect(b.get().corrections).toHaveLength(2);
    expect(add(b, [item()], 'other-ref')).toEqual({ ok: true, version: v1 + 1, ids: [3] });
    expect(add(b, [item()], 'other-ref').duplicate).toBe(true);
    expect(b.get().corrections).toHaveLength(3);
  });

  test('одна плохая запись из трёх — bad_request, ничего не записано (ни записей, ни версии)', () => {
    const { b, ivan, item } = withIds();
    add(b, [item()], 'seed');
    const before = b.get();
    const rowsBefore = JSON.stringify(b.sheet('Corrections').rows);
    const bad = [
      { delta: 0 }, { delta: 51 }, { delta: -51 }, { delta: 1.5 }, { delta: '1' }, { delta: null }, { delta: undefined },
      { kind: 'toys' }, { kind: 'piles' }, { kind: undefined },
      { employeeId: 'e999' }, { employeeId: undefined }, { employeeId: 5 }, { employeeId: null },
      { date: '2026-12-12' }, { date: '2026-12-13' }, { date: '2026-11-30' }, { date: '2026-12-23' },
      { date: 'x' }, { date: '2026-02-30' }, { date: undefined }, { date: 20261110 },
      { base: -1 }, { base: 10001 }, { base: 1.5 }, { base: '3' }, { base: null }, { base: undefined },
    ];
    for (const extra of bad) {
      for (const at of [0, 1, 2]) {
        const items = [item(), item({ kind: 'long' }), item({ employeeId: ivan, kind: 'payments' })];
        items[at] = { ...items[at], ...extra };
        expect(add(b, items, `ref-${at}`), `${at} ${JSON.stringify(extra)}`).toEqual({ ok: false, error: 'bad_request' });
      }
    }
    for (const broken of [null, 5, 'x', [], undefined]) {
      expect(add(b, [item(), broken, item()], 'ref-x'), JSON.stringify(broken)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(b.get()).toEqual(before);
    expect(JSON.stringify(b.sheet('Corrections').rows)).toBe(rowsBefore);
  });

  test('дата строго раньше сегодня и в пределах игры: после конца игры 30.12 верхней границей служит конец игры', () => {
    const { b, item } = withIds();
    b.advance(22 * 24 * 60 * MIN);
    expect(b.get().serverNow).toBe('2027-01-03T10:00:00+03:00');
    expect(add(b, [item({ date: '2026-12-30' })], 'a').ok).toBe(true);
    for (const date of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']) expect(add(b, [item({ date })], `r-${date}`), date).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get().corrections).toHaveLength(1);
  });

  test('запрос целиком негоден: пустой items, 4 записи, не массив, ref пустой / длиннее 64 / не строка — bad_request', () => {
    const { b, item } = withIds();
    const before = b.get();
    for (const items of [[], [item(), item(), item(), item()], null, undefined, 'x', { 0: item() }]) {
      expect(add(b, items), JSON.stringify(items)).toEqual({ ok: false, error: 'bad_request' });
    }
    for (const ref of ['', 'x'.repeat(65), undefined, null, 5, {}]) {
      expect(admin(b, 'addCorrections', { items: [item()], ref }), JSON.stringify(ref)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(b.get()).toEqual(before);
    expect(add(b, [item()], 'x'.repeat(64)).ok).toBe(true);
  });

  test('записей не больше 2000: 2001-я — bad_request, повтор уже записанного ref остаётся duplicate, после удаления место есть', () => {
    const { b, item } = withIds();
    for (let i = 0; i < 666; i++) expect(add(b, [item(), item(), item()], `r${i}`).ok, `r${i}`).toBe(true);
    const last = add(b, [item(), item()], 'last');
    expect(last.ids).toEqual([1999, 2000]);
    const before = b.get();
    expect(add(b, [item()], 'over')).toEqual({ ok: false, error: 'bad_request' });
    expect(add(b, [item(), item(), item()], 'over3')).toEqual({ ok: false, error: 'bad_request' });
    expect(add(b, [item(), item()], 'last')).toEqual({ ok: true, version: before.version, ids: [1999, 2000], duplicate: true });
    expect(b.get()).toEqual(before);
    expect(remove(b, 5).removed).toBe(1);
    expect(add(b, [item()], 'again')).toMatchObject({ ok: true, ids: [2001] });
    expect(add(b, [item()], 'again2')).toEqual({ ok: false, error: 'bad_request' });
  }, 30000); // 2000 записей в песочнице: на раннере GitHub ≈ 7 с

  test('removeCorrection удаляет запись (версия +1, остальные на месте); id следующей записи — следующий неиспользованный', () => {
    const { b, item } = withIds();
    add(b, [item(), item({ kind: 'long' }), item({ kind: 'payments' })]);
    const v1 = b.get().version;
    expect(remove(b, 2)).toEqual({ ok: true, version: v1 + 1, removed: 1 });
    expect(b.get().corrections.map((c) => [c.id, c.kind])).toEqual([[1, 'quality'], [3, 'payments']]);
    expect(add(b, [item()], 'ref-2').ids).toEqual([4]);
    expect(remove(b, 4).removed).toBe(1);
    expect(remove(b, 3).removed).toBe(1);
    expect(remove(b, 1).removed).toBe(1);
    expect(b.get().corrections).toEqual([]);
    expect(add(b, [item()], 'ref-3').ids).toEqual([5]);
  });

  test('номер удалённой правки не выдаётся снова: запоздалое removeCorrection по нему новую запись не трогает', () => {
    const { b, item } = withIds();
    add(b, [item(), item({ kind: 'long' })], 'ref-1');
    expect(remove(b, 2).removed).toBe(1);
    const fresh = add(b, [item({ kind: 'payments', delta: 4 })], 'ref-2');
    expect(fresh.ids).toEqual([3]);
    const v = b.get().version;
    expect(remove(b, 2)).toEqual({ ok: true, version: v, removed: 0 });
    expect(b.get().corrections.map((c) => [c.id, c.kind])).toEqual([[1, 'quality'], [3, 'payments']]);
    // счётчик хранится отдельно от листа: пустой лист номера тоже не обнуляет
    expect(remove(b, 3).removed).toBe(1);
    expect(remove(b, 1).removed).toBe(1);
    expect(add(b, [item(), item()], 'ref-3').ids).toEqual([4, 5]);
    // испорченный или потерянный счётчик не опускает номер ниже максимума в листе
    b.sheet('Settings').rows.find((r) => r[0] === 'correctionsLastId')[1] = 'мусор';
    expect(add(b, [item()], 'ref-4').ids).toEqual([6]);
  });

  test('removeCorrection повторно или по неизвестному id: ok, removed 0, версия та же', () => {
    const { b, item } = withIds();
    add(b, [item()]);
    expect(remove(b, 1).removed).toBe(1);
    const v = b.get().version;
    expect(remove(b, 1)).toEqual({ ok: true, version: v, removed: 0 });
    expect(remove(b, 99)).toEqual({ ok: true, version: v, removed: 0 });
    expect(b.get().version).toBe(v);
  });

  test('removeCorrection: id не целое положительное число — bad_request', () => {
    const { b, item } = withIds();
    add(b, [item()]);
    const before = b.get();
    for (const id of ['x', '1', 1.5, 0, -1, null, undefined, [], {}]) expect(remove(b, id), JSON.stringify(id)).toEqual({ ok: false, error: 'bad_request' });
    expect(b.get()).toEqual(before);
  });

  test('только админ: без PIN, с неверным и с PIN группы — invalid_pin, ничего не пишется и не удаляется', () => {
    const { b, item } = withIds();
    const { groupPins } = admin(b, 'setGroupPins');
    add(b, [item()]);
    const before = b.get();
    const bodies = [{ action: 'addCorrections', items: [item()], ref: 'z' }, { action: 'removeCorrection', id: 1 }];
    for (const body of bodies) {
      expect(b.post(body)).toEqual({ ok: false, error: 'invalid_pin' });
      expect(b.post({ ...body, pin: '000000' })).toEqual({ ok: false, error: 'invalid_pin' });
      expect(b.post({ ...body, pin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
      expect(b.post({ ...body, group: 'СР1', groupPin: groupPins['СР1'] })).toEqual({ ok: false, error: 'invalid_pin' });
    }
    expect(b.get()).toEqual(before);
  });

  test('правки хранятся отдельно от файлов: повторный импорт воронки их не трогает', () => {
    const { b, ivan, item } = withIds();
    add(b, [item()]);
    admin(b, 'importFunnel', { through: '2026-12-10', rows: [{ name: 'Иванов Иван', date: '2026-12-10', quality: 3, long: 1 }] });
    admin(b, 'importFunnel', { through: '2026-12-10', rows: [{ name: 'Иванов Иван', date: '2026-12-10', quality: 5, long: 1 }] });
    expect(b.get().corrections).toEqual([{ id: 1, date: '2026-12-10', employeeId: ivan, kind: 'quality', delta: 1, base: 3 }]);
  });
});

describe('мусорные запросы', () => {
  test('битое, пустое и не-объектное тело, неизвестное и служебное действие — bad_request', () => {
    const b = loadBackend();
    const expected = { ok: false, error: 'bad_request' };
    expect(b.postRaw('не json')).toEqual(expected);
    expect(b.postRaw('')).toEqual(expected);
    expect(b.postRaw('[]')).toEqual(expected);
    expect(b.postRaw('null')).toEqual(expected);
    expect(b.postRaw('"login"')).toEqual(expected);
    expect(b.postEmpty()).toEqual(expected);
    expect(b.post({})).toEqual(expected);
    expect(b.post({ action: 'нет такого', pin: PIN })).toEqual(expected);
    expect(b.post({ action: 'constructor', pin: PIN })).toEqual(expected);
    expect(b.post({ action: '__proto__', pin: PIN })).toEqual(expected);
    expect(b.post({ action: 'hasOwnProperty', pin: PIN })).toEqual(expected);
  });

  test('неверный PIN проверяется раньше содержимого, а PIN не попадает в ответ', () => {
    const b = loadBackend();
    expect(b.post({ action: 'importPayments', pin: '000000', from: 'мусор' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login' })).toEqual({ ok: false, error: 'invalid_pin' });
    expect(b.post({ action: 'login', pin: 123456 })).toEqual({ ok: false, error: 'invalid_pin' });
    const text = JSON.stringify([b.post({ action: 'login', pin: PIN }), admin(b, 'setGroupPins').ok, b.postRaw('{"pin":"' + PIN + '"')]);
    expect(text).not.toContain(PIN);
  });
});

