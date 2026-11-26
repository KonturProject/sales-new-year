import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApi, rememberKey, type Snapshot } from './api';
import { createClock } from './clock';
import { createStore } from './store';
import { emptySnapshot } from './testkit';

const json = (body: unknown) => new Response(JSON.stringify(body));
const BASE = 'https://script.example/exec';
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ключ экрана', () => {
  test('уходит в GET параметром k вместе с since', async () => {
    const fetchFn = vi.fn((_u: string, _i: RequestInit) => Promise.resolve(json({ ok: true, version: 3 })));
    const api = createApi({ url: () => BASE, key: () => 'abc 1', fetchFn });
    await api.get();
    await api.get(3);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([`${BASE}?k=abc+1`, `${BASE}?k=abc+1&since=3`]);
  });

  test('чужой ключ — ошибка key', async () => {
    const api = createApi({ url: () => BASE, key: () => 'x', fetchFn: vi.fn().mockResolvedValue(json({ ok: false, error: 'key' })) });
    await expect(api.get()).rejects.toMatchObject({ code: 'key' });
  });

  test('#k= запоминается и уходит из адреса, остальное в адресе остаётся', () => {
    const store = new Map<string, string>();
    const replaced: string[] = [];
    const k = rememberKey({
      href: 'https://site.example/sales-new-year/?demo=1#k=s3cr3t', storage: { getItem: (n) => store.get(n) ?? null, setItem: (n, v) => void store.set(n, v) },
      replace: (u) => replaced.push(u),
    });
    expect([k, store.get('squareKey'), replaced]).toEqual(['s3cr3t', 's3cr3t', ['https://site.example/sales-new-year/?demo=1']]);
    expect(rememberKey({ href: 'https://site.example/', storage: { getItem: (n) => store.get(n) ?? null, setItem: () => {} }, replace: () => {} })).toBe('s3cr3t');
  });

  test('без хранилища (приватное окно) ключ из адреса всё равно работает', () => {
    const k = rememberKey({ href: 'https://s.example/#k=abc', storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }, replace: () => {} });
    expect(k).toBe('abc');
  });
});

describe('подстраховка чтения', () => {
  test('нет ответа 6 с — второй такой же запрос, берётся первый ответ', async () => {
    let n = 0;
    const fetchFn = vi.fn((url: string, init: RequestInit) => (++n === 1 ? hang(url, init) : Promise.resolve(json({ ok: true, version: 7 }))));
    const got = createApi({ url: () => BASE, fetchFn }).get();
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await got).toMatchObject({ version: 7 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('каждый запрос ждёт 30 секунд; «нет связи», когда замолчали оба', async () => {
    let settled = false;
    const pending = createApi({ url: () => BASE, fetchFn: vi.fn(hang) }).get().catch((e) => { settled = true; return e; });
    await vi.advanceTimersByTimeAsync(35_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ code: 'network' });
  });

  test('первый упал сразу — ошибка без подстраховки', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    await expect(createApi({ url: () => BASE, fetchFn }).get()).rejects.toMatchObject({ code: 'network' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('статус связи', () => {
  test('offline только после двух неудач подряд, ok после успеха; key сразу', async () => {
    const fetchSnapshot = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('n'), { code: 'network' }))
      .mockRejectedValueOnce(Object.assign(new Error('n'), { code: 'network' }))
      .mockResolvedValueOnce(emptySnapshot(1))
      .mockRejectedValueOnce(Object.assign(new Error('k'), { code: 'key' }));
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true });
    const seen: string[] = [];
    store.onStatus((s) => seen.push(s));
    store.start();
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(i ? 1000 : 0);
    expect(seen).toEqual(['offline', 'ok', 'key']);
    store.stop();
  });
});

describe('часы сервера', () => {
  test('идут от последнего ответа и подтягиваются ответом «без изменений»', async () => {
    let mono = 0;
    const clock = createClock(() => mono);
    expect(clock.nowIso()).toBeNull();
    clock.sync('2026-12-10T11:59:30+03:00');
    mono = 45_000;
    expect(clock.nowIso()).toBe('2026-12-10T12:00:15+03:00');
    clock.sync('2026-12-10T12:05:00+03:00');
    expect(clock.nowIso()).toBe('2026-12-10T12:05:00+03:00');
    mono = 45_000 + 24 * 3600_000;
    expect(clock.nowIso()).toBe('2026-12-11T12:05:00+03:00');
  });

  test('хранилище отдаёт часам serverNow и снимков, и «без изменений»', async () => {
    const synced: string[] = [];
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(emptySnapshot(1))
      .mockResolvedValue({ unchanged: true, version: 1, serverNow: '2026-12-10T10:00:15+03:00' });
    const store = createStore({ fetchSnapshot, pollMs: 1000, visible: () => true, onServerNow: (t) => synced.push(t) });
    store.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(synced).toEqual(['2026-12-10T10:00:00+03:00', '2026-12-10T10:00:15+03:00']);
    store.stop();
  });
});

test('снимок площади: новые поля, без overrides', () => {
  const s: Snapshot = emptySnapshot(1);
  expect(Object.keys(s)).toEqual(expect.arrayContaining(['purchases', 'grants', 'lastPaymentAt', 'grinch', 'finale', 'commands']));
  expect(s).not.toHaveProperty('overrides');
});
