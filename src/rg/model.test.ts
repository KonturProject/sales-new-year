import { describe, expect, test } from 'vitest';
import { ApiError } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { emptySnapshot } from '@/data/testkit';
import { itemByCode } from '@/engine/catalog';
import { buy, person } from '@/engine/testkit';
import { askAccepted, buyError, confirmText, employeesOf, houseCards, paymentState, treeCards } from './model';

// СР1: двое с планом 11 → 1 оплата ≈ 4,5 монеты
const staff = [person({ id: 'a', name: 'Иванов Иван', shortName: 'Иванов И.', paymentPlan: 11 }), person({ id: 'b', name: 'Петров Пётр', shortName: 'Петров П.', paymentPlan: 11 })];
const snap = (over = {}) => emptySnapshot(1, { staff, ...over });
const facts = (s = snap()) => buildFacts(s, s.serverNow.slice(0, 10));

describe('лавка', () => {
  test('открыт первый ярус: шесть игрушек с ценами, серые — с нехваткой', () => {
    const s = snap({ provisional: [{ date: '2026-12-10', group: 'СР1', count: 1 }] }); // 4 монеты
    const t = treeCards(s, facts(s), 'СР1');
    expect([t.tier, t.free.length]).toEqual([1, 20]);
    expect(t.options.map((o) => [o.item.code, o.state, o.lack])).toEqual([
      [1, 'buy', 0], [2, 'poor', 1], [3, 'poor', 2], [4, 'buy', 0], [5, 'poor', 1], [6, 'poor', 2],
    ]);
  });

  test('баланс ниже нуля показан нулём, всё серое', () => {
    const s = snap({ purchases: [buy(1, 'СР1', 3, 1)] });
    const t = treeCards(s, facts(s), 'СР1');
    expect(t.balance).toBe(0);
    expect(t.options.every((o) => o.state === 'poor')).toBe(true);
  });

  test('после финала всё закрыто', () => {
    const s = snap({ provisional: [{ date: '2026-12-10', group: 'СР1', count: 9 }], finale: { cutoff: '2026-12-09', at: 'x' } });
    expect(treeCards(s, facts(s), 'СР1').options.every((o) => o.state === 'closed')).toBe(true);
  });

  test('ёлка полна — игрушек нет, только подарки', () => {
    const all = Array.from({ length: 66 }, (_, i) => buy(i + 1, 'СР2', Math.floor(i / 14) * 6 + 1, i + 1));
    const s = snap({ purchases: all });
    expect(treeCards(s, facts(s), 'СР1')).toMatchObject({ tier: null, options: [] });
  });
});

describe('домик', () => {
  test('по местам; стоящая вещь отмечена, остальные — с ценой', () => {
    const s = snap({
      funnelThrough: '2026-12-09',
      funnel: [{ employeeId: 'a', date: '2026-12-09', quality: 40, long: 0 }], // 40 из 176 → 22 снежинки, венок за 10 → осталось 12
      purchases: [buy(1, 'СР1', 201, null, { shop: 'attic' })],
    });
    const cards = houseCards(s, facts(s), 'СР1', 'attic');
    expect(cards.map((c) => c.place)).toEqual(['door', 'window', 'eave', 'roof', 'porch']);
    expect(cards[0]!.owned?.code).toBe(201);
    expect(cards[0]!.options.map((o) => o.state)).toEqual(['owned', 'buy', 'poor']);
  });
});

describe('платёжки', () => {
  test('счётчик за сегодня и границы', () => {
    expect(paymentState(snap(), 'СР1')).toEqual({ today: 0, canAdd: true, canRemove: false, reason: null });
    expect(paymentState(snap({ provisional: [{ date: '2026-12-10', group: 'СР1', count: 15 }] }), 'СР1')).toMatchObject({ canAdd: false, canRemove: true });
  });

  test('день уже загружен из файла', () => {
    expect(paymentState(snap({ paymentsImportedThrough: '2026-12-10' }), 'СР1')).toMatchObject({ canAdd: false, canRemove: false, reason: 'Этот день уже загружен из файла' });
  });

  test('после финала закрыто', () => {
    expect(paymentState(snap({ finale: { cutoff: '2026-12-09', at: 'x' } }), 'СР1').reason).toBe('Игра окончена, лавка закрыта');
  });
});

describe('сотрудники для именной игрушки', () => {
  test('только свои, на месте и не скрытые', () => {
    const more = [...staff, person({ id: 'c', name: 'Сидоров С', group: 'СР2' }), person({ id: 'd', name: 'Ушедший У', fireDate: '2026-12-05' }), person({ id: 'e', name: 'Скрытый С', hiddenFromRating: true })];
    const s = snap({ staff: more, absences: [{ employeeId: 'b', kind: 'vacation', from: '2026-12-08', to: '2026-12-12' }] });
    expect(employeesOf(s, 'СР1').map((e) => e.id)).toEqual(['a']);
  });
});

describe('тексты', () => {
  test('вопрос перед покупкой', () => {
    expect(confirmText(itemByCode(26)!, { tier: 5 })).toBe('Повесить «Щелкунчик» за 12 монет на 5-й ярус?');
    expect(confirmText(itemByCode(26)!, { tier: 5, employee: 'Иванов И.' })).toBe('Повесить «Щелкунчик» за 12 монет на 5-й ярус? Посвящение: Иванов И.');
    expect(confirmText(itemByCode(203)!, { replaces: itemByCode(201) })).toBe('Достать с чердака «Большой бант» за 14 снежинок? Встанет вместо «Еловый венок».');
    expect(confirmText(itemByCode(309)!, {})).toBe('Достать из подвала «Ледяной фонтан» за 28 ключиков?');
    expect(confirmText(itemByCode(101)!, {})).toBe('Положить под ёлку «Маленький подарок» за 5 монет?');
  });

  test('ошибки', () => {
    expect(buyError(new ApiError('finished', 'x'))).toBe('Игра окончена, лавка закрыта');
    expect(buyError(new ApiError('network', 'x'))).toBe('Нет связи. Нажмите ещё раз: повтор не спишет дважды');
    expect(buyError(new ApiError('bad_request', 'x'))).toBe('Данные устарели, страница обновлена. Проверьте и повторите');
    expect(buyError(new ApiError('invalid_pin', 'x'))).toBe('PIN сменился. Войдите заново');
  });

  test('ответ на вопрос раньше 500 мс — второй щелчок двойного нажатия, не ответ', () => {
    expect([askAccepted(1000, 1499), askAccepted(1000, 1500)]).toEqual([false, true]);
  });
});

test('замена во дворе: нейтральный текст без рода', () => {
  expect(confirmText(itemByCode(302)!, { replaces: itemByCode(301) })).toBe('Достать из подвала «Деревянный олень» за 16 ключиков? Встанет вместо «Снеговик».');
});
