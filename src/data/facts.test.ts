import { describe, expect, test } from 'vitest';
import type { Employee } from '@/engine/staff';
import { buy, person } from '@/engine/testkit';
import { buildFacts, grinchOf } from './facts';
import { emptySnapshot } from './testkit';

// СР1: двое опытных с планом 11 оплат на месяц → план группы 22 (2200 сотых), 1 оплата = 4,54 %
const staff: Employee[] = [
  person({ id: 'a', name: 'Иванов Иван', paymentPlan: 11 }),
  person({ id: 'b', name: 'Петров Пётр', paymentPlan: 11 }),
  person({ id: 'c', name: 'Сидорова Анна', group: 'СР5', paymentPlan: 5.5 }),
];
const pay = (date: string, author: string, invoice: string, group = 'СР1') => ({ date, group, author, invoice }) as never;
const base = (over = {}) => emptySnapshot(1, { staff, ...over });

describe('монеты', () => {
  test('из файла и предварительных за дни после файла', () => {
    const s = base({
      payments: [pay('2026-12-01', 'Иванов Иван', '1'), pay('2026-12-02', 'Петров Пётр', '2')],
      paymentsImportedThrough: '2026-12-02',
      provisional: [{ date: '2026-12-03', group: 'СР1', count: 2 }, { date: '2026-12-02', group: 'СР1', count: 9 }],
    });
    const g = buildFacts(s, '2026-12-03').groups['СР1'];
    expect(g.wallet.percent).toBeCloseTo((4 / 22) * 100);
    expect(g.wallet.coins).toBe(18);
  });

  test('оплаты ноября не считаются', () => {
    const s = base({ payments: [pay('2026-11-30', 'Иванов Иван', '1')], paymentsImportedThrough: '2026-11-30' });
    expect(buildFacts(s, '2026-12-01').groups['СР1'].wallet.coins).toBe(0);
  });

  test('равный процент — равные монеты у маленькой и большой группы', () => {
    const s = base({
      provisional: [{ date: '2026-12-02', group: 'СР1', count: 4 }, { date: '2026-12-02', group: 'СР5', count: 1 }],
    });
    const f = buildFacts(s, '2026-12-02');
    expect(f.groups['СР1'].wallet.coins).toBe(f.groups['СР5'].wallet.coins);
  });

  test('предварительные 3, игрушка за 4, файл принёс 1: игрушка висит, баланс ниже нуля', () => {
    const toy = buy(1, 'СР1', 1, 1, { at: '2026-12-03T15:00:00+03:00', date: '2026-12-03' });
    const before = buildFacts(base({ provisional: [{ date: '2026-12-03', group: 'СР1', count: 3 }], purchases: [toy] }), '2026-12-03');
    expect(before.groups['СР1'].balance.coins).toBe(13 - 4);
    const after = buildFacts(base({ payments: [pay('2026-12-03', 'Иванов Иван', '1')], paymentsImportedThrough: '2026-12-03', purchases: [toy] }), '2026-12-04');
    expect(after.groups['СР1'].balance.coins).toBe(4 - 4);
    const less = buildFacts(base({ purchases: [toy, buy(2, 'СР1', 3, 2)], paymentsImportedThrough: '2026-12-03' }), '2026-12-04');
    expect(less.groups['СР1'].balance.coins).toBeLessThan(0);
    expect(less.tree.hung.map((h) => h.purchaseId)).toEqual([1, 2]);
  });

  test('выдача прибавляет баланс, но не процент; траты процент не трогают', () => {
    const s = base({
      provisional: [{ date: '2026-12-02', group: 'СР1', count: 2 }],
      grants: [{ id: 1, date: '2026-12-02', group: 'СР1', kind: 'coins', delta: 5 }, { id: 2, date: '2026-12-02', group: 'СР1', kind: 'keys', delta: -2 }],
      purchases: [buy(1, 'СР1', 1, 1)],
    });
    const g = buildFacts(s, '2026-12-02').groups['СР1'];
    expect([g.wallet.coins, g.balance.coins, g.balance.keys]).toEqual([9, 9 + 5 - 4, -2]);
    expect(g.wallet.percent).toBeCloseTo((2 / 22) * 100);
  });

  test('уволенный: игрушка с его именем остаётся', () => {
    const fired = staff.map((e) => (e.id === 'a' ? { ...e, fireDate: '2026-12-05' } : e));
    const f = buildFacts(base({ staff: fired, purchases: [buy(1, 'СР1', 1, 3, { employeeId: 'a' })] }), '2026-12-10');
    expect(f.tree.hung).toEqual([{ purchaseId: 1, slot: 3, item: 1, group: 'СР1', employeeId: 'a' }]);
  });
});

describe('снежинки и ключики', () => {
  test('от нормы всего месяца; воронка после «по какой день» не считается', () => {
    const s = base({
      funnelThrough: '2026-12-01',
      funnel: [{ employeeId: 'a', date: '2026-12-01', quality: 11, long: 3 }, { employeeId: 'a', date: '2026-12-02', quality: 50, long: 50 }],
    });
    const g = buildFacts(s, '2026-12-02').groups['СР1'];
    // норма СР1 на месяц: 2 × 22 × 4 = 176 счетов 6+, 2 × 22 × 1,5 = 66 счетов 20+
    expect([g.wallet.flakes, g.wallet.keys]).toEqual([6, 4]);
  });
});

describe('домик, ёлка, недели', () => {
  test('вещи домика по группам', () => {
    const s = base({ purchases: [buy(1, 'СР1', 201, null, { shop: 'attic' }), buy(2, 'СР5', 309, null, { shop: 'cellar' })] });
    const f = buildFacts(s, '2026-12-02');
    expect([f.groups['СР1'].house.door?.item, f.groups['СР5'].house.big?.item]).toEqual([201, 309]);
  });

  test('гирлянда первой недели зажигается, когда загружена её пятница', () => {
    const p = [pay('2026-12-01', 'Иванов Иван', '1')];
    expect(buildFacts(base({ payments: p, paymentsImportedThrough: '2026-12-03' }), '2026-12-04').litTiers).toEqual([]);
    const f = buildFacts(base({ payments: p, paymentsImportedThrough: '2026-12-04' }), '2026-12-07');
    expect([f.litTiers, f.weeks[0]!.winners]).toEqual([[1], ['СР1']]);
  });

  test('итог филиала', () => {
    const f = buildFacts(base({ provisional: [{ date: '2026-12-02', group: 'СР1', count: 2 }, { date: '2026-12-02', group: 'СР5', count: 1 }] }), '2026-12-02');
    expect(f.branch).toEqual({ paid: 3, gameCents: 2750 });
  });

  test('один снимок и дата — один и тот же объект', () => {
    const s = base();
    expect(buildFacts(s, '2026-12-02')).toBe(buildFacts(s, '2026-12-02'));
  });
});

describe('Гринч', () => {
  test('в 12:00 крадёт игрушку, купленную до тишины', () => {
    const s = base({ lastPaymentAt: '2026-12-10T10:00:00+03:00', purchases: [buy(1, 'СР1', 1, 1, { at: '2026-12-09T12:00:00+03:00' })] });
    const f = buildFacts(s, '2026-12-10');
    expect(grinchOf(s, f, '2026-12-10T11:59:00+03:00').pranks).toBe(0);
    expect(grinchOf(s, f, '2026-12-10T12:00:00+03:00').stolen).toEqual([1]);
  });

  test('в выходной спит', () => {
    const s = base();
    expect(grinchOf(s, buildFacts(s, '2026-12-12'), '2026-12-12T14:00:00+03:00').asleep).toBe(true);
  });
});
