import { isWorkingDay, workingDaysBetween } from '@/engine/calendar';
import type { Config } from '@/engine/config';
import type { RankData } from '@/engine/ranking';
import { groupOn } from '@/engine/staff';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;

export interface FunnelTotal {
  quality: number;
  long: number;
}

/** Счета 6+ и 20+ группы с начала игры по `asOf` (сотрудник считается за группу, в которой был в тот день). */
export function groupFunnel(rank: RankData, asOf: DateStr): Record<GroupCode, FunnelTotal> {
  const totals = Object.fromEntries(GROUPS.map((g) => [g, { quality: 0, long: 0 }])) as Record<GroupCode, FunnelTotal>;
  const byId = new Map(rank.staff.map((e) => [e.id, e]));
  for (const row of rank.funnel) {
    const e = byId.get(row.employeeId);
    if (!e || row.date > asOf || row.date < rank.cfg.startDate) continue;
    const t = totals[groupOn(e, row.date)];
    if (!t) continue;
    t.quality += row.quality;
    t.long += row.long;
  }
  return totals;
}

/** «день 7 из 22», «выходной · день 7 из 22», до старта и после конца — свои слова. */
export function dayLine(asOf: DateStr, cfg: Config): string {
  if (asOf < cfg.startDate) return `старт ${short(cfg.startDate)}`;
  if (asOf > cfg.endDate) return 'игра окончена';
  const total = workingDaysBetween(cfg.startDate, cfg.endDate, cfg).length;
  const day = `день ${workingDaysBetween(cfg.startDate, asOf, cfg).length} из ${total}`;
  return isWorkingDay(asOf, cfg) ? day : `выходной · ${day}`;
}

const MOSCOW_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });

/** Свежесть данных: когда экран последний раз получил ответ сервера и по какой день загружены файлы. */
export function freshLine(o: { at: Date; funnelThrough: DateStr | null; paymentsThrough: DateStr | null }): string {
  return [
    `обновлено ${MOSCOW_TIME.format(o.at)}`,
    o.funnelThrough ? `воронка по ${short(o.funnelThrough)}` : 'воронки ещё нет',
    o.paymentsThrough ? `оплаты по ${short(o.paymentsThrough)}` : 'оплат из файла ещё нет',
  ].join(' · ');
}
