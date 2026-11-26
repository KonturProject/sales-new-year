import { parseDate } from '@/engine/calendar';
import { defaultConfig, type Config } from '@/engine/config';
import type { DateStr, Level } from '@/engine/types';
import type { ConfigChange, Snapshot, SnapshotConfig } from './api';

// Те же границы, что у setConfig и setNonWorking в apps-script/Code.gs: ячейку листа могли испортить руками
const NORM_MAX = 50;
const NON_WORKING_MAX = 29;
const LEVELS = Object.keys(defaultConfig.norms) as Level[];
const FIELDS = ['quality', 'long', 'payments'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Личная норма: 0…50, не больше двух знаков после запятой. */
const isNorm = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= NORM_MAX && Math.round(v * 100) / 100 === v;

const cloneConfig = (c: Config): Config => ({
  ...c,
  norms: Object.fromEntries(LEVELS.map((l) => [l, { ...c.norms[l] }])) as Config['norms'],
});

/** Переносит годные нормы из `raw` в `out` (негодное поле остаётся прежним); `true`, если что-то перенесено. */
function applyNorms(out: Config, raw: Record<string, unknown>): boolean {
  let changed = false;
  if (!isObject(raw.norms)) return false;
  for (const level of LEVELS) {
    const norm = raw.norms[level];
    if (!isObject(norm)) continue;
    for (const f of FIELDS) {
      if (isNorm(norm[f])) { out.norms[level][f] = norm[f]; changed = true; }
    }
  }
  return changed;
}

/** Выходные целиком: настоящие даты периода игры без повторов; негодный список — `null` (действует встроенный календарь). */
function validNonWorking(v: unknown): DateStr[] | null {
  if (!Array.isArray(v) || v.length > NON_WORKING_MAX) return null;
  const days = new Set<string>();
  for (const d of v) {
    if (typeof d !== 'string' || parseDate(d, '') !== d || d < defaultConfig.startDate || d > defaultConfig.endDate || days.has(d)) return null;
    days.add(d);
  }
  return [...days].sort();
}

const cache = new WeakMap<object, Config>();

/** Настройки игры из снимка поверх `defaultConfig`: только нормы и выходные. Даты, запас плана и отсечка — в коде. */
export function configOf(raw: SnapshotConfig): Config {
  if (!isObject(raw)) return defaultConfig;
  const hit = cache.get(raw);
  if (hit) return hit;
  const out = cloneConfig(defaultConfig);
  let changed = applyNorms(out, raw as Record<string, unknown>);
  const nonWorking = validNonWorking(raw.nonWorking);
  if (nonWorking) { out.nonWorking = nonWorking; changed = true; }
  const cfg = changed ? out : defaultConfig;
  cache.set(raw, cfg);
  return cfg;
}

export interface Timeline {
  at(date: DateStr): Config;
}

const timelines = new WeakMap<object, Timeline>();
const isDateStr = (v: unknown): v is DateStr => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Нормы по датам: база, поверх неё по порядку правки с `from ≤ D`. Календарь задаёт только база. */
export function timelineOf(s: Pick<Snapshot, 'config' | 'configChanges'>): Timeline {
  const hit = timelines.get(s);
  if (hit) return hit;
  const base = configOf(s.config);
  const entries = (Array.isArray(s.configChanges) ? s.configChanges : [])
    .filter((e): e is ConfigChange => isObject(e) && isDateStr(e.from) && isObject(e.config))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  let cfg = base;
  const steps = entries.map((e) => {
    const next = cloneConfig(cfg);
    applyNorms(next, e.config as Record<string, unknown>);
    cfg = next;
    return { from: e.from, cfg };
  });
  const timeline: Timeline = {
    at: (date) => {
      let found: Config = base;
      for (const step of steps) {
        if (step.from > date) break;
        found = step.cfg;
      }
      return found;
    },
  };
  timelines.set(s, timeline);
  return timeline;
}
