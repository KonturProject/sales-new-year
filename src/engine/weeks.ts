import { addDays, workingDaysBetween } from './calendar';
import type { Config } from './config';
import { GROUPS, type DateStr, type GroupCode } from './types';

export interface Week {
  /** номер недели игры = ярус гирлянды */
  n: number;
  /** первый и последний рабочий день недели */
  from: DateStr;
  to: DateStr;
  days: DateStr[];
}

export interface WeekResult extends Week {
  /** загружены официальные оплаты за последний день недели (пятая ждёт ещё и финала) */
  decided: boolean;
  /** лучшие по проценту недельного плана; ничья — все равные, у нулей победителей нет */
  winners: GroupCode[];
  /** процент недельного плана; `null` — плана нет */
  percents: Record<GroupCode, number | null>;
}

/** Понедельник недели, в которую попадает день. */
function monday(d: DateStr): DateStr {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
}

/** Недели игры по рабочим дням, до отсечки звезды включительно. */
export function weeksOf(cfg: Config): Week[] {
  const byMonday = new Map<DateStr, DateStr[]>();
  for (const d of workingDaysBetween(cfg.startDate, cfg.finaleCutoff, cfg)) {
    const key = monday(d);
    byMonday.set(key, [...(byMonday.get(key) ?? []), d]);
  }
  return [...byMonday.values()].map((days, i) => ({ n: i + 1, from: days[0]!, to: days.at(-1)!, days }));
}

/**
 * Итоги недель: оплаты недели к плану группы на её дни. Оплата в выходной идёт в следующую неделю, как и в дневном
 * счёте: иначе суббота меняла бы уже решённую пятницу. Пятая неделя решается только вместе с финалом.
 */
export function weekResults(i: {
  paymentsByDay: Record<GroupCode, Record<DateStr, number>>;
  planCentsOn: (g: GroupCode, d: DateStr) => number;
  importedThrough: DateStr | null;
  finaleDone: boolean;
  cfg: Config;
}): WeekResult[] {
  const weeks = weeksOf(i.cfg);
  return weeks.map((week, index) => {
    const last = index === weeks.length - 1;
    const after = index === 0 ? null : weeks[index - 1]!.to;
    const percents = {} as Record<GroupCode, number | null>;
    for (const g of GROUPS) {
      let paid = 0;
      for (const [date, n] of Object.entries(i.paymentsByDay[g])) if (date <= week.to && (after === null ? date >= i.cfg.startDate : date > after)) paid += n;
      const plan = week.days.reduce((s, d) => s + i.planCentsOn(g, d), 0);
      percents[g] = plan > 0 ? (paid * 10_000) / plan : null;
    }
    const decided = i.importedThrough !== null && i.importedThrough >= week.to && (!last || i.finaleDone);
    const best = Math.max(...GROUPS.map((g) => percents[g] ?? 0));
    const winners = decided && best > 0 ? GROUPS.filter((g) => percents[g] === best) : [];
    return { ...week, decided, winners, percents };
  });
}
