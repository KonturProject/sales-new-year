import { serverToday, type Snapshot, type Unchanged } from './api';

export interface Store {
  subscribe(cb: (s: Snapshot) => void): () => void;
  start(): void;
  stop(): void;
  current(): Snapshot | null;
  /** Прочитать снимок сейчас, не дожидаясь опроса (после записи): идущий запрос мог выйти раньше записи, поэтому читает заново. */
  refresh(): Promise<void>;
  /** связь: ok, нет связи (после двух неудач подряд) или неверный ключ экрана */
  onStatus(cb: (s: LinkStatus) => void): () => void;
}

export type LinkStatus = 'ok' | 'offline' | 'key';

const POLL_MS = 15_000;

/**
 * Хранит последний снимок и опрашивает бэкенд. Первая загрузка идёт при старте всегда,
 * дальнейшие опросы — только пока вкладка видна. Ошибки сети молча пропускаются: остаётся последний снимок.
 */
export function createStore(opts: {
  fetchSnapshot: (since?: number) => Promise<Snapshot | Unchanged>;
  pollMs?: number;
  visible?: () => boolean;
  /** «сейчас» сервера из каждого ответа, включая «без изменений»: по нему идут часы площади */
  onServerNow?: (serverNow: string) => void;
}): Store {
  const pollMs = opts.pollMs ?? POLL_MS;
  const visible = opts.visible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const subscribers = new Set<(s: Snapshot) => void>();
  let snapshot: Snapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inflight: Promise<void> | null = null;
  const statusSubs = new Set<(s: LinkStatus) => void>();
  let status: LinkStatus | null = null;
  let failures = 0;
  const setStatus = (s: LinkStatus) => {
    if (s === status) return;
    status = s;
    for (const cb of statusSubs) cb(s);
  };

  async function fetchOnce(): Promise<void> {
    try {
      const reply = await opts.fetchSnapshot(snapshot?.version);
      failures = 0;
      setStatus('ok');
      if (reply.serverNow) opts.onServerNow?.(reply.serverNow);
      let next: Snapshot | null = null;
      if (!('unchanged' in reply)) {
        if (reply.version !== snapshot?.version) next = reply;
      } else if (snapshot && reply.serverNow && serverToday({ ...snapshot, serverNow: reply.serverNow }) !== serverToday(snapshot)) {
        // данные те же, но на сервере наступил другой день: «сегодня» страниц с долгой вкладкой должно сдвинуться
        next = { ...snapshot, serverNow: reply.serverNow };
      }
      if (next) {
        snapshot = next;
        for (const cb of subscribers) {
          try {
            cb(next);
          } catch (e) {
            console.error(e);
          }
        }
      }
    } catch (e) {
      // нет связи: остаётся последний снимок, следующий тик повторит запрос; неверный ключ — сразу
      if ((e as { code?: string })?.code === 'key') setStatus('key');
      else if (++failures >= 2) setStatus('offline');
    }
  }

  function load(): Promise<void> {
    inflight ??= fetchOnce().finally(() => { inflight = null; });
    return inflight;
  }

  return {
    subscribe(cb) {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    start() {
      if (timer !== null) return;
      void load();
      timer = setInterval(() => { if (visible()) void load(); }, pollMs);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    current: () => snapshot,
    onStatus(cb) {
      statusSubs.add(cb);
      return () => { statusSubs.delete(cb); };
    },
    async refresh() {
      if (inflight) await inflight;
      await load();
    },
  };
}
