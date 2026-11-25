/** Настройки из админки: сам по себе и сколько минут тишины по филиалу он терпит. */
export interface GrinchSettings {
  auto: boolean;
  quietMin: number;
}

export interface GrinchCommand {
  id: number;
  kind: 'steal' | 'garland' | 'return';
  /** ISO +03:00 */
  at: string;
}

export interface GrinchInput {
  /** время сервера, ISO +03:00 */
  now: string;
  workingDay: boolean;
  /** последняя новая платёжка филиала (рост числа оплат выше прежнего максимума дня) */
  lastPaymentAt: string | null;
  settings: GrinchSettings;
  commands: readonly GrinchCommand[];
  hung: readonly { purchaseId: number; at: string }[];
  /** ярусы с зажжённой гирляндой */
  litTiers: readonly number[];
}

export interface GrinchState {
  /** начало нынешней тишины */
  since: string;
  /** пакостей сам по себе: 0, 1 или 2 */
  pranks: 0 | 1 | 2;
  /** покупки, чьи игрушки сейчас спрятаны */
  stolen: number[];
  /** ярус погашенной гирлянды */
  garlandOff: number | null;
  asleep: boolean;
}

export const DEFAULT_GRINCH: GrinchSettings = { auto: true, quietMin: 120 };
const WORK_FROM = '10:00';
const WORK_TO = '18:00';

const later = (...moments: (string | null | undefined)[]): string => moments.reduce<string>((a, b) => (b && b > a ? b : a), '');
const minutes = (from: string, to: string) => Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
const plusMinutes = (at: string, min: number): string => {
  const d = new Date(Date.parse(at) + min * 60_000 + 3 * 3_600_000);
  return `${d.toISOString().slice(0, 19)}+03:00`;
};

/** FNV-1a: один и тот же отсчёт у всех экранов даёт одну и ту же игрушку. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Что Гринч натворил к моменту `now`. Считается из времени последней платёжки и команд админа, поэтому одинаково на
 * всех экранах и переживает перезагрузку. Цифры игры не меняет: украденное только спрятано.
 */
export function grinchState(i: GrinchInput): GrinchState {
  const day = i.now.slice(0, 10);
  const moment = (hhmm: string) => `${day}T${hhmm}:00+03:00`;
  const from = moment(WORK_FROM);
  const to = moment(WORK_TO);
  const awake = i.workingDay && i.now >= from && i.now < to;

  const commands = i.commands.filter((c) => c.at <= i.now).sort((a, b) => a.id - b.id);
  const lastReturn = commands.filter((c) => c.kind === 'return').at(-1)?.at ?? null;
  const since = later(from, i.lastPaymentAt, lastReturn);
  const pranks = awake && i.settings.auto ? (Math.min(2, Math.max(0, Math.floor(minutes(since, i.now) / i.settings.quietMin))) as 0 | 1 | 2) : 0;

  // ручные пакости живут до платёжки, возврата, 18:00 или полуночи
  const reset = later(moment('00:00'), i.lastPaymentAt, lastReturn, i.now >= to ? to : null);
  const manual = commands.filter((c) => c.kind !== 'return' && c.at > reset);

  const stolen: number[] = [];
  let garlandOff: number | null = null;
  const steal = (key: string, prankAt: string, boughtBy: string) => {
    const left = i.hung.filter((h) => !stolen.includes(h.purchaseId)).sort((a, b) => a.purchaseId - b.purchaseId);
    const old = left.filter((h) => h.at <= boughtBy);
    const pick = old.length ? old[hash(key) % old.length] : left.find((h) => h.at <= prankAt);
    if (pick) stolen.push(pick.purchaseId);
  };
  const darken = () => {
    if (!i.litTiers.length || garlandOff !== null) return false;
    garlandOff = Math.max(...i.litTiers);
    return true;
  };

  for (let n = 1; n <= pranks; n++) {
    if (n === 2 && darken()) continue;
    steal(`${since}#${n}`, plusMinutes(since, n * i.settings.quietMin), since);
  }
  for (const c of manual) {
    if (c.kind === 'garland') darken();
    else steal(`${c.at}#${c.id}`, c.at, c.at);
  }
  return { since, pranks, stolen, garlandOff, asleep: !awake && manual.length === 0 };
}
