import { serverToday, type Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import { buildFacts, type Facts } from '@/data/facts';
import { prevWorkingDay, workingDaysBetween } from '@/engine/calendar';
import { TREE_SLOTS } from '@/engine/catalog';
import type { Config } from '@/engine/config';
import type { DateStr } from '@/engine/types';
import { GROUPS } from '@/engine/types';
import { dayLine } from '@/data/metrics';

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

export interface TodayTask {
  done: boolean;
  text: string;
}

/**
 * Что сделать сегодня, по снимку: штат, новички без даты приёма, воронка и оплаты из файлов за последний рабочий день
 * игры до сегодняшнего (в первый день файлов за «вчера» ещё не ждём).
 */
export function todayTasks(s: Snapshot): TodayTask[] {
  const today = serverToday(s);
  const active = s.staff.filter((e) => !e.fireDate || today < e.fireDate);
  if (!active.length) return [{ done: false, text: 'Штата нет: Импорт → воронка, из неё добавятся сотрудники' }];
  const tasks: TodayTask[] = [{ done: true, text: `Штат: ${active.length}` }];
  const undated = active.filter((e) => e.baseLevel !== 'experienced' && !e.hireDate).length;
  if (undated) tasks.push({ done: false, text: `Новички без даты приёма: ${undated} — без даты уровень не сменится сам до конца игры (Сотрудники)` });
  const due = prevWorkingDay(today, configOf(s.config));
  if (due === null) return tasks;
  tasks.push(s.funnelThrough && s.funnelThrough >= due
    ? { done: true, text: `Воронка по ${short(s.funnelThrough)}` }
    : { done: false, text: `Загрузите воронку за ${short(due)} (Импорт)` });
  tasks.push(s.paymentsImportedThrough && s.paymentsImportedThrough >= due
    ? { done: true, text: `Оплаты из файла по ${short(s.paymentsImportedThrough)}` }
    : { done: false, text: `Загрузите оплаты за ${short(due)} (Импорт)` });
  return tasks;
}

/**
 * Прогноз ёлки при нынешнем темпе: игрушек за рабочий день игры (сегодняшний считается) × оставшиеся рабочие дни.
 * `toys` — сколько будет к концу игры (не больше мест), `fullOn` — рабочий день, когда места кончатся, или `null`.
 */
export function forecast(f: Pick<Facts, 'tree'>, today: DateStr, cfg: Config): { toys: number; fullOn: DateStr | null } {
  const hung = f.tree.hung.length;
  if (hung >= TREE_SLOTS) return { toys: TREE_SLOTS, fullOn: today };
  const elapsed = today < cfg.startDate ? 0 : workingDaysBetween(cfg.startDate, today, cfg).length;
  if (!elapsed || !hung) return { toys: hung, fullOn: null };
  const pace = hung / elapsed;
  const ahead = today < cfg.endDate ? workingDaysBetween(today, cfg.endDate, cfg).filter((d) => d > today) : [];
  const need = Math.ceil((TREE_SLOTS - hung) / pace - 1e-9);
  return {
    toys: Math.min(TREE_SLOTS, Math.round(hung + pace * ahead.length)),
    fullOn: need <= ahead.length ? ahead[need - 1]! : null,
  };
}

/** «ёлка 16 из 66, к финалу ≈ 44», «… полна ≈ 18.12» или «ёлка полна»; вне дней игры — пусто. */
function treeLine(s: Snapshot, today: DateStr, cfg: Config): string | null {
  if (today < cfg.startDate || today > cfg.endDate) return null;
  const f = buildFacts(s, today);
  if (f.tree.full) return 'ёлка полна';
  const now = `ёлка ${f.tree.hung.length} из ${TREE_SLOTS}`;
  const p = forecast(f, today, cfg);
  if (p.fullOn) return `${now}, полна ≈ ${short(p.fullOn)}`;
  return p.toys > f.tree.hung.length ? `${now}, к финалу ≈ ${p.toys}` : now;
}

/** Блок «Сегодня» над вкладками: день игры, что загружено из файлов, сколько групп внесли предварительные числа и прогноз ёлки. */
export function todayLine(s: Snapshot): string {
  const today = serverToday(s);
  const entered = new Set(s.provisional.filter((p) => p.date === today).map((p) => p.group)).size;
  const cfg = configOf(s.config);
  return [
    `Сегодня ${short(today)}`,
    dayLine(today, cfg),
    s.funnelThrough ? `воронка по ${short(s.funnelThrough)}` : 'воронки ещё нет',
    s.paymentsImportedThrough ? `оплаты из файла по ${short(s.paymentsImportedThrough)}` : 'оплат из файла ещё нет',
    `предварительные сегодня: ${entered} из ${GROUPS.length} групп`,
    treeLine(s, today, cfg),
  ].filter((x) => x !== null).join(' · ');
}
