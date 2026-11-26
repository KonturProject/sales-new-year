/** Часы сервера на странице: последний `serverNow` плюс прошедшее по монотонным часам. Часы компьютера не нужны. */
export interface ServerClock {
  sync(serverNow: string): void;
  /** ISO +03:00 или null, пока сервер ни разу не ответил */
  nowIso(): string | null;
}

const MOSCOW_MS = 3 * 3_600_000;

export function createClock(monotonic: () => number = () => performance.now()): ServerClock {
  let base: { at: number; mono: number } | null = null;
  return {
    sync(serverNow) {
      const at = Date.parse(serverNow);
      if (!Number.isNaN(at)) base = { at, mono: monotonic() };
    },
    nowIso() {
      if (!base) return null;
      const moscow = new Date(base.at + (monotonic() - base.mono) + MOSCOW_MS);
      return `${moscow.toISOString().slice(0, 19)}+03:00`;
    },
  };
}
