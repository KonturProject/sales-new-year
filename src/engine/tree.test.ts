import { expect, test } from 'vitest';
import { houseState, spentOf } from './house';
import { buy, fillAll, fillTier, thing } from './testkit';
import { treeState } from './tree';

test('пустая ёлка: открыт первый ярус, 20 мест', () => {
  const t = treeState([]);
  expect([t.opened, t.free.length, t.full, t.filled]).toEqual([1, 20, false, [0, 0, 0, 0, 0]]);
});

test('игрушка висит там, куда её повесили, с именем', () => {
  const t = treeState([buy(1, 'СР6', 2, 7, { employeeId: 'e9' })]);
  expect(t.hung).toEqual([{ purchaseId: 1, slot: 7, item: 2, group: 'СР6', employeeId: 'e9' }]);
});

test('два РГ на одно место: второй рядом, при равенстве — меньший номер', () => {
  const t = treeState([buy(1, 'СР1', 1, 5), buy(2, 'СР2', 2, 5)]);
  expect(t.hung.map((h) => h.slot)).toEqual([5, 4]);
});

test('порядок решает номер записи, а не порядок в списке', () => {
  const t = treeState([buy(2, 'СР2', 2, 5), buy(1, 'СР1', 1, 5)]);
  expect(t.hung.map((h) => [h.group, h.slot])).toEqual([['СР1', 5], ['СР2', 4]]);
});

test('последнее место яруса: второй уходит на следующий ярус, ярус открыт', () => {
  const t = treeState([...fillTier(1, 19), buy(20, 'СР1', 1, 20), buy(21, 'СР2', 2, 20)]);
  expect(t.hung.at(-1)).toMatchObject({ purchaseId: 21, slot: 21 });
  expect([t.opened, t.filled]).toEqual([2, [20, 1, 0, 0, 0]]);
});

test('ярус открывается ровно на двадцатой игрушке', () => {
  expect(treeState(fillTier(1, 19)).opened).toBe(1);
  expect(treeState(fillTier(1, 20)).opened).toBe(2);
});

test('игрушка закрытого яруса не прыгает вверх', () => {
  expect(treeState([buy(1, 'СР1', 25, 60)]).hung[0]!.slot).toBe(1);
});

test('место не того яруса: игрушка идёт на свой ярус', () => {
  const t = treeState([...fillTier(1, 20), buy(21, 'СР1', 1, 25)]);
  expect(t.hung.at(-1)!.slot).toBe(21); // свой ярус полон → самое нижнее свободное
});

test('67-я игрушка — подарок, ёлка полна', () => {
  const t = treeState(fillAll(67));
  expect([t.full, t.gifts.length, t.free]).toEqual([true, 1, []]);
});

test('подарок не занимает место', () => {
  const t = treeState([buy(1, 'СР1', 102, null, { shop: 'gift' })]);
  expect([t.gifts, t.hung]).toEqual([[{ purchaseId: 1, item: 102, group: 'СР1' }], []]);
});

test('отмена освобождает место и не двигает чужие', () => {
  const a = buy(1, 'СР1', 1, 5, { cancelledAt: '2026-12-03T09:00:00+03:00' });
  const t = treeState([a, buy(2, 'СР2', 2, 5)]);
  expect(t.hung).toMatchObject([{ purchaseId: 2, slot: 4 }]);
  expect(t.free).toContain(5);
});

test('после отмены место можно занять снова', () => {
  const a = buy(1, 'СР1', 1, 5, { cancelledAt: '2026-12-02T10:00:01+03:00' });
  const t = treeState([a, buy(2, 'СР2', 2, 5)]);
  expect(t.hung).toMatchObject([{ purchaseId: 2, slot: 5 }]);
});

test('отмена не закрывает открытый ярус', () => {
  const all = fillTier(1, 20);
  all[3] = { ...all[3]!, cancelledAt: '2026-12-05T09:00:00+03:00' };
  const t = treeState(all);
  expect([t.opened, t.free.length, t.filled[0]]).toEqual([2, 17, 19]);
});

test('незнакомый код товара пропускается', () => {
  expect(treeState([buy(1, 'СР1', 999, 1)]).hung).toEqual([]);
});

test('домик: последняя вещь места, отмена возвращает прежнюю', () => {
  const p = [thing(1, 'СР5', 201), thing(2, 'СР5', 203)];
  expect(houseState('СР5', p).door).toEqual({ purchaseId: 2, item: 203 });
  expect(houseState('СР5', [p[0]!, { ...p[1]!, cancelledAt: 'x' }]).door).toEqual({ purchaseId: 1, item: 201 });
});

test('домик: чужие вещи и другой магазин не попадают', () => {
  expect(houseState('СР1', [thing(1, 'СР5', 201), buy(2, 'СР1', 1, 1)])).toEqual({});
});

test('траты по валютам, отменённое не считается', () => {
  const p = [buy(1, 'СР1', 3, 1), thing(2, 'СР1', 309), thing(3, 'СР1', 201), buy(4, 'СР1', 1, 2, { cancelledAt: 'x' }), buy(5, 'СР1', 103, null, { shop: 'gift' }), buy(6, 'СР2', 1, 3)];
  expect(spentOf('СР1', p)).toEqual({ coins: 26, flakes: 10, keys: 28 });
});

test('код не своего магазина не засчитывается и не тратит', () => {
  const wrong = buy(1, 'СР1', 201, 1); // вещь чердака в лавке
  expect([treeState([wrong]).hung, spentOf('СР1', [wrong])]).toEqual([[], { coins: 0, flakes: 0, keys: 0 }]);
});
