import { expect, test } from 'vitest';
import { CATALOG, CURRENCY_OF, itemByCode, slotsOfTier, tierOfSlot, TIERS, TREE_SLOTS } from './catalog';
import { balances, wallet } from './coins';

test('каталог: 59 товаров, коды не повторяются, по 6 игрушек на ярус', () => {
  expect(CATALOG).toHaveLength(30 + 3 + 13 + 13);
  expect(new Set(CATALOG.map((i) => i.code)).size).toBe(CATALOG.length);
  for (const t of TIERS) expect(CATALOG.filter((i) => i.tier === t)).toHaveLength(6);
  expect(CATALOG.filter((i) => i.tier === 5).map((i) => i.price)).toEqual([10, 12, 14, 10, 12, 14]);
});

test('коды яруса идут подряд', () => {
  expect(CATALOG.filter((i) => i.tier === 2).map((i) => i.code)).toEqual([7, 8, 9, 10, 11, 12]);
});

test('у каждой вещи домика есть место, у чердака и подвала по пять', () => {
  const places = (shop: string) => [...new Set(CATALOG.filter((i) => i.shop === shop).map((i) => i.place))];
  expect(places('attic')).toEqual(['door', 'window', 'eave', 'roof', 'porch']);
  expect(places('cellar')).toEqual(['left', 'right', 'path', 'big', 'live']);
});

test('цена полного чердака 74–91, полного подвала 85–101', () => {
  const sum = (shop: string, pick: (p: number[]) => number) => {
    const byPlace = new Map<string, number[]>();
    for (const i of CATALOG) if (i.shop === shop) byPlace.set(i.place!, [...(byPlace.get(i.place!) ?? []), i.price]);
    return [...byPlace.values()].reduce((s, p) => s + pick(p), 0);
  };
  const min = (p: number[]) => Math.min(...p);
  const max = (p: number[]) => Math.max(...p);
  expect([sum('attic', min), sum('attic', max), sum('cellar', min), sum('cellar', max)]).toEqual([74, 91, 85, 101]);
});

test('места ярусов', () => {
  expect(TREE_SLOTS).toBe(66);
  expect([1, 20, 21, 36, 37, 49, 50, 59, 60, 66].map(tierOfSlot)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  expect(slotsOfTier(5)).toEqual([60, 61, 62, 63, 64, 65, 66]);
});

test('валюта магазина', () => {
  expect(CURRENCY_OF).toEqual({ tree: 'coins', gift: 'coins', attic: 'flakes', cellar: 'keys' });
  expect(itemByCode(309)).toMatchObject({ shop: 'cellar', price: 28, place: 'big' });
  expect(itemByCode(999)).toBeUndefined();
});

test('честность: равный процент — равные монеты', () => {
  const small = wallet({ paid: 8, gameCents: 1600, quality: 0, qualityNorm: 1, long: 0, longNorm: 1 });
  const big = wallet({ paid: 25, gameCents: 5000, quality: 0, qualityNorm: 1, long: 0, longNorm: 1 });
  expect([small.coins, big.coins]).toEqual([50, 50]);
});

test('ноль плана и нормы', () => {
  expect(wallet({ paid: 3, gameCents: 0, quality: 4, qualityNorm: 0, long: 2, longNorm: 0 })).toEqual({ percent: 0, coins: 0, flakes: 0, keys: 0 });
});

test('дробный процент хранится, монеты вниз', () => {
  const w = wallet({ paid: 13, gameCents: 2730, quality: 320, qualityNorm: 513, long: 138, longNorm: 194 });
  expect(w.percent).toBeCloseTo(47.619, 3);
  expect([w.coins, w.flakes, w.keys]).toEqual([47, 62, 71]);
});

test('точный процент не теряет монету на дробях', () => {
  expect(wallet({ paid: 29, gameCents: 10000, quality: 29, qualityNorm: 100, long: 7, longNorm: 0.7 })).toMatchObject({ coins: 29, flakes: 29, keys: 1000 });
});

test('баланс может уйти в минус', () => {
  expect(balances({ percent: 10, coins: 10, flakes: 0, keys: 0 }, { coins: 14, flakes: 0, keys: 0 }, { coins: 0, flakes: 5, keys: 0 })).toEqual({ coins: -4, flakes: 5, keys: 0 });
});
