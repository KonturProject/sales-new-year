import { expect, test } from 'vitest';
import { TIER_SIZES, tierOfSlot } from '@/engine/catalog';
import { treeSlots, type AlphaMask } from './slots';

/** Треугольная «ёлка» 1000×1500: вершина вверху, ствол — нижние 15 %. */
const triangle: AlphaMask = {
  width: 1000, height: 1500,
  solid: (x, y) => {
    if (y > 1500 * 0.85) return Math.abs(x - 500) < 60;
    const half = (y / (1500 * 0.85)) * 480;
    return Math.abs(x - 500) <= half && y >= 20;
  },
};

test('66 мест, по ярусам 20 / 16 / 13 / 10 / 7', () => {
  const slots = treeSlots(triangle);
  expect(slots).toHaveLength(66);
  const counts = [1, 2, 3, 4, 5].map((t) => slots.filter((_, i) => tierOfSlot(i + 1) === t).length);
  expect(counts).toEqual([...TIER_SIZES]);
});

test('все места внутри ёлки, ярусы идут снизу вверх', () => {
  const slots = treeSlots(triangle);
  for (const s of slots) expect(triangle.solid(Math.round(s.x), Math.round(s.y)), JSON.stringify(s)).toBe(true);
  const meanY = (t: number) => { const ys = slots.filter((_, i) => tierOfSlot(i + 1) === t).map((s) => s.y); return ys.reduce((a, b) => a + b, 0) / ys.length; };
  expect([1, 2, 3, 4].every((t) => meanY(t) > meanY(t + 1))).toBe(true);
});

test('места не слипаются', () => {
  const slots = treeSlots(triangle);
  let min = Infinity;
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) min = Math.min(min, Math.hypot(slots[i]!.x - slots[j]!.x, slots[i]!.y - slots[j]!.y));
  expect(min).toBeGreaterThan(45);
});

test('одна и та же ёлка — одни и те же места', () => {
  expect(treeSlots(triangle)).toEqual(treeSlots(triangle));
});
