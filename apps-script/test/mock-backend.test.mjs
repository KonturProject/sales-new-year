import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MOCK_ADMIN_PIN, MOCK_SCREEN_KEY, startMockBackend } from '../../tools/mock-backend.mjs';

let mock;
beforeAll(async () => {
  mock = await startMockBackend({ port: 0, demo: 'middle', realClock: false });
}, 60_000);
afterAll(() => mock?.close());

const get = (q = '') => fetch(`${mock.url}?k=${MOCK_SCREEN_KEY}${q}`).then((r) => r.json());
const post = (body) => fetch(mock.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then((r) => r.json());

describe('мок площади', () => {
  test('отдаёт демо «середина»: 10.12, штат, оплаты по вчера, сегодня — платёжки, покупки со своим временем', async () => {
    const s = await get();
    expect(s.ok).toBe(true);
    expect(s.serverNow).toBe('2026-12-10T16:40:00+03:00');
    expect([s.funnelThrough, s.paymentsImportedThrough]).toEqual(['2026-12-09', '2026-12-09']);
    expect(s.staff).toHaveLength(53);
    expect(s.payments.every((p) => p.date <= '2026-12-09')).toBe(true);
    expect(s.provisional.every((p) => p.date === '2026-12-10')).toBe(true);
    expect(s.purchases.length).toBeGreaterThan(20);
    expect(new Set(s.purchases.map((p) => p.date)).size).toBeGreaterThan(3);
  });

  test('без ключа снимка нет', async () => {
    expect(await fetch(mock.url).then((r) => r.json())).toEqual({ ok: false, error: 'key' });
  });

  test('РГ покупает по PIN из мока; админ входит по PIN мока', async () => {
    expect(await post({ action: 'login', pin: MOCK_ADMIN_PIN })).toMatchObject({ ok: true, screenKey: MOCK_SCREEN_KEY });
    const r = await post({ action: 'buy', group: 'СР3', groupPin: mock.groupPins['СР3'], shop: 'gift', item: 101, slot: null, ref: 'm1' });
    expect(r).toMatchObject({ ok: true });
    expect((await get()).purchases.at(-1)).toMatchObject({ group: 'СР3', item: 101 });
  });
});
