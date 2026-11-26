import type { FunnelDay } from '@/engine/evaluate';
import type { GrinchCommand, GrinchSettings } from '@/engine/grinch';
import type { Purchase } from '@/engine/purchase';
import type { Currency } from '@/engine/catalog';
import type { Absence, Employee } from '@/engine/staff';
import type { DateStr, GroupCode, Level } from '@/engine/types';
import type { ImportedPayment } from '@/import/payments';

/** Ручная правка факта сотрудника за день: к строке воронки или к оплатам. `base` — значение «из файла», которое админ видел. */
export interface SnapshotCorrection {
  id: number;
  date: DateStr;
  employeeId: string;
  kind: 'quality' | 'long' | 'payments';
  /** целая прибавка (может быть < 0) */
  delta: number;
  base: number;
}

/**
 * Настройки, которые админ меняет через `setConfig`; чего нет — берётся из `defaultConfig`. Даты игры не правятся,
 * выходные (`nonWorking`) хранит сервер на всю игру и меняет только `setNonWorking`: `setConfig` их не принимает.
 */
export interface SnapshotConfig {
  norms?: Partial<Record<Level, { quality?: number; long?: number; payments?: number }>>;
  /** выходные дни игры; в записях «с даты» не бывает */
  nonWorking?: DateStr[];
}

/** Правка норм, действующая с даты `from`; уникальна по `from`. */
export interface ConfigChange {
  from: DateStr;
  config: SnapshotConfig;
}

/** Снимок фактов по ключу экрана (без сумм, хешей, PIN и причин). */
export interface Snapshot {
  version: number;
  serverNow: string;
  funnelThrough: DateStr | null;
  paymentsImportedThrough: DateStr | null;
  config: SnapshotConfig;
  /** Правки по датам поверх `config`; у бэкенда без этой возможности поля нет (читать через `timelineOf`). */
  configChanges: ConfigChange[];
  staff: Employee[];
  absences: Absence[];
  payments: ImportedPayment[];
  provisional: { date: DateStr; group: GroupCode; count: number }[];
  funnel: FunnelDay[];
  corrections?: SnapshotCorrection[];
  purchases: Purchase[];
  /** выдачи валюты админом (без причины) */
  grants: { id: number; date: DateStr; group: GroupCode; kind: Currency; delta: number }[];
  /** последняя новая платёжка филиала: по ней просыпается Гринч */
  lastPaymentAt: string | null;
  grinch: GrinchSettings & { commands: GrinchCommand[] };
  finale: { cutoff: DateStr; at: string } | null;
  /** команды экрану за последние 10 минут */
  commands: ScreenCommand[];
}

export interface ScreenCommand {
  id: number;
  at: string;
  kind: 'replay' | 'salute' | 'opening' | 'snowball' | 'finale';
  group: GroupCode | null;
}

/** Ответ на `get(since)` при той же версии: данных нет, но есть «сейчас» сервера (у старого бэкенда его может не быть). */
export interface Unchanged {
  unchanged: true;
  version: number;
  serverNow?: string;
}

/** «Сегодня» по Москве глазами сервера (R23): от него считают границы импорта, а не от часов компьютера. */
export function serverToday(s: Snapshot): DateStr {
  return s.serverNow.slice(0, 10);
}

export type ApiErrorCode = 'invalid_pin' | 'locked' | 'bad_request' | 'finished' | 'key' | 'server_error' | 'network';

const SERVER_CODES: readonly string[] = ['invalid_pin', 'locked', 'bad_request', 'finished', 'key', 'server_error'];
/** Холодный старт Apps Script бывает долгим: чтение ждёт 30 с, а через 6 с без ответа уходит второй такой же запрос. */
const TIMEOUT_MS = 30_000;
const HEDGE_MS = 6_000;
/** Запись ждёт дольше чтения: холодный старт Apps Script и ожидание блокировки листа — до 10 с каждое (R43). */
const WRITE_TIMEOUT_MS = 30_000;
const NO_CONNECTION = 'Нет связи с сервером';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryAfterSec?: number;

  constructor(code: ApiErrorCode, message: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Адрес бэкенда. `?backend=<url>` подменяет вшитый адрес только в разработке или на локальный хост (R11):
 * иначе ссылка с чужим адресом увела бы PIN администратора на чужой сервер.
 */
export function resolveBackend(search: string, o: { dev: boolean; baked: string }): string {
  const raw = new URLSearchParams(search).get('backend');
  if (!raw) return o.baked;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return o.baked;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return o.baked;
  return o.dev || LOCAL_HOSTS.has(url.hostname) ? raw : o.baked;
}

/**
 * Период опроса из `?pollMs=` (R24): только для проверок, поэтому действует там же, где `?backend=` (разработка или локальный хост).
 * Целое от 500 до 15000; всё остальное — `undefined`, то есть обычные 15 с.
 */
export function resolvePollMs(search: string, o: { dev: boolean; hostname: string }): number | undefined {
  const raw = new URLSearchParams(search).get('pollMs');
  if (raw === null || !/^\d+$/.test(raw) || !(o.dev || LOCAL_HOSTS.has(o.hostname))) return undefined;
  const ms = Number(raw);
  return ms >= 500 && ms <= 15_000 ? ms : undefined;
}

export function backendUrl(): string {
  return resolveBackend(location.search, { dev: import.meta.env.DEV, baked: String(import.meta.env.VITE_BACKEND_URL ?? '') });
}

export function createApi(o: {
  url: () => string;
  /** ключ экрана для GET; без него сервер снимок не отдаёт */
  key?: () => string | null;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  writeTimeoutMs?: number;
}) {
  const doFetch = o.fetchFn ?? ((url: string, init: RequestInit) => fetch(url, init));
  const readMs = o.timeoutMs ?? TIMEOUT_MS;
  const writeMs = o.writeTimeoutMs ?? WRITE_TIMEOUT_MS;

  /** Один запрос без cookie, с таймаутом; любой сбой доставки — `ApiError('network')`, `ok:false` — ошибка сервера. */
  async function request(makeUrl: (base: string) => string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
    const base = o.url();
    if (!base) throw new ApiError('network', NO_CONNECTION);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let body: unknown;
    try {
      const res = await doFetch(makeUrl(base), { ...init, credentials: 'omit', signal: ctl.signal });
      body = res.ok ? await res.json() : undefined;
    } catch {
      body = undefined;
    } finally {
      clearTimeout(timer);
    }
    if (typeof body !== 'object' || body === null) throw new ApiError('network', NO_CONNECTION);
    const reply = body as { ok?: unknown; error?: unknown; retryAfterSec?: unknown };
    if (reply.ok !== true) {
      const code = SERVER_CODES.includes(String(reply.error)) ? (reply.error as ApiErrorCode) : 'server_error';
      const retry = typeof reply.retryAfterSec === 'number' ? reply.retryAfterSec : undefined;
      throw new ApiError(code, code, retry);
    }
    return body as Record<string, unknown>;
  }

  return {
    /** Снимок фактов; `since` — версия, уже имеющаяся у клиента: если она не изменилась, вернётся `{unchanged: true, …}`. */
    async get(since?: number): Promise<Snapshot | Unchanged> {
      const query = new URLSearchParams();
      const key = o.key?.();
      if (key) query.set('k', key);
      if (since !== undefined) query.set('since', String(since));
      const make = (base: string) => (query.size ? `${base}?${query}` : base);
      const once = () => request(make, { method: 'GET' }, readMs);
      // подстраховка: если первый запрос молчит 6 с, уходит второй такой же; берём первый ответ, ошибка — когда упали все
      const body = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let running = 0;
        let over = false;
        const launch = () => {
          running++;
          once().then(
            (r) => { if (!over) { over = true; clearTimeout(timer); resolve(r); } },
            (e) => { if (--running === 0 && !over) { over = true; clearTimeout(timer); reject(e); } },
          );
        };
        const timer = setTimeout(launch, HEDGE_MS);
        launch();
      });
      if (body.unchanged !== true) return body as unknown as Snapshot;
      return { unchanged: true, version: Number(body.version), serverNow: typeof body.serverNow === 'string' ? body.serverNow : undefined };
    },
    /** Действие бэкенда; тело — JSON как `text/plain`, чтобы запрос обошёлся без предзапроса CORS. */
    async post<T>(action: string, body: object): Promise<T> {
      const reply = await request((base) => base, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, action }),
      }, writeMs);
      return reply as T;
    },
  };
}

interface KeyPlace {
  href: string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  replace: (url: string) => void;
}

const KEY_STORAGE = 'squareKey';

/** Ключ экрана из `#k=…` (запоминается в браузере, из адреса убирается) или запомненный раньше. */
export function rememberKey(p: KeyPlace): string | null {
  const url = new URL(p.href);
  const fromHash = new URLSearchParams(url.hash.slice(1)).get('k');
  if (fromHash) {
    try { p.storage.setItem(KEY_STORAGE, fromHash); } catch { /* приватное окно: ключ живёт до перезагрузки */ }
    url.hash = '';
    p.replace(url.toString().replace(/#$/, ''));
    return fromHash;
  }
  try { return p.storage.getItem(KEY_STORAGE); } catch { return null; }
}

let screenKeyValue: string | null | undefined;
/** Ключ экрана этой страницы; страницы РГ и админки кладут сюда ключ, полученный при входе. */
export const screenKey = {
  get(): string | null {
    if (screenKeyValue === undefined) {
      screenKeyValue = typeof location === 'undefined' ? null
        : rememberKey({ href: location.href, storage: localStorage, replace: (u) => history.replaceState(null, '', u) });
    }
    return screenKeyValue;
  },
  set(key: string) {
    screenKeyValue = key;
    try { localStorage.setItem(KEY_STORAGE, key); } catch { /* ничего */ }
  },
};

export const api = createApi({ url: backendUrl, key: () => screenKey.get() });
