import { describe, expect, test } from 'vitest';
import { buildFacts, grinchOf } from '@/data/facts';
import { GROUPS } from '@/engine/types';
import { DEMOS, demoSnapshot } from './demo';

describe('демо-снимки', () => {
  test('у каждого демо свой день и «сейчас»', () => {
    expect(DEMOS.map((d) => demoSnapshot(d).serverNow.slice(0, 16))).toEqual([
      '2026-12-01T09:30', '2026-12-03T15:00', '2026-12-10T16:40', '2026-12-24T17:30', '2026-12-29T19:00',
      '2026-12-12T13:00', '2026-12-10T13:00', '2026-12-30T13:00', '2026-12-10T10:00',
    ]);
  });

  test('одинаковый вызов — одинаковые данные', () => {
    expect(JSON.stringify(demoSnapshot('middle'))).toBe(JSON.stringify(demoSnapshot('middle')));
  });

  test('ФИО выдуманные: «Тест СРn-k»', () => {
    expect(demoSnapshot('middle').staff.every((e) => /^Тест СР\d-\d+$/.test(e.name))).toBe(true);
  });

  test('начало: ничего нет; середина: ёлка наполовину, домики начаты; полная — 66 игрушек и все гирлянды', () => {
    const at = (d: (typeof DEMOS)[number]) => { const s = demoSnapshot(d); return buildFacts(s, s.serverNow.slice(0, 10)); };
    expect(at('start').tree.hung).toHaveLength(0);
    const mid = at('middle');
    expect(mid.tree.hung.length).toBeGreaterThan(15);
    expect(mid.tree.hung.length).toBeLessThan(45);
    expect(GROUPS.filter((g) => Object.keys(mid.groups[g].house).length > 0).length).toBeGreaterThan(3);
    const full = at('full');
    expect([full.tree.full, full.litTiers.length]).toEqual([true, 4]);
  });

  test('покупки по карману: ни у кого не уходит в минус', () => {
    for (const d of DEMOS) {
      const s = demoSnapshot(d);
      const f = buildFacts(s, s.serverNow.slice(0, 10));
      for (const g of GROUPS) for (const v of Object.values(f.groups[g].balance)) expect(v, `${d} ${g}`).toBeGreaterThanOrEqual(0);
    }
  });

  test('Гринч: в демо «grinch» он уже украл игрушку', () => {
    const s = demoSnapshot('grinch');
    expect(grinchOf(s, buildFacts(s, '2026-12-10'), s.serverNow).stolen.length).toBeGreaterThan(0);
  });

  test('финал проведён по 29.12', () => {
    expect(demoSnapshot('finale').finale?.cutoff).toBe('2026-12-29');
  });

  test('пустое демо — без штата', () => {
    expect(demoSnapshot('empty').staff).toEqual([]);
  });
});
