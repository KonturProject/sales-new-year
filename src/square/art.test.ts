import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CATALOG } from '@/engine/catalog';
import { GROUPS } from '@/engine/types';
import { ART, artPaths, iconPath } from './art';

test('все картинки манифеста лежат в public', () => {
  for (const p of artPaths()) expect(existsSync(`public/${p}`), p).toBe(true);
});

test('у каждого товара каталога есть иконка', () => {
  for (const i of CATALOG) expect(existsSync(`public/${iconPath(i.art)}`), `${i.code} ${i.name}`).toBe(true);
});

test('у каждой группы свой лист маскота', () => {
  expect(new Set(GROUPS.map((g) => ART.mascots[g])).size).toBe(6);
});
