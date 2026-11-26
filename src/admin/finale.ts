import type { Snapshot } from '@/data/api';
import { configOf } from '@/data/config';
import { isWorkingDay, parseDate, prevWorkingDay } from '@/engine/calendar';
import { TREE_SLOTS } from '@/engine/catalog';
import type { FinaleResult } from '@/engine/finale';
import { GROUPS, type DateStr } from '@/engine/types';

const short = (d: DateStr) => `${d.slice(8)}.${d.slice(5, 7)}`;
/** Проценты с одним знаком после запятой: 18,1 %. */
const pct = (p: number) => `${String(Math.floor(p * 10) / 10).replace('.', ',')} %`;
const both = (list: string[]) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} и ${list.at(-1)}`);

/** «Считать по»: дата отсечки из настроек (29.12), но не позже загруженных оплат; без загрузки — `null`. */
export function cutoffDefault(s: Snapshot): DateStr | null {
  const through = s.paymentsImportedThrough;
  if (!through) return null;
  const { finaleCutoff } = configOf(s.config);
  return through < finaleCutoff ? through : finaleCutoff;
}

/** Как `setFinale` в `Code.gs`: дата в пределах игры и не позже последнего официального импорта оплат. */
export function cutoffError(s: Snapshot, raw: string): string | null {
  const d = raw.trim();
  if (parseDate(d, '') !== d) return 'Дата вида 2026-12-29';
  const cfg = configOf(s.config);
  if (d < cfg.startDate || d > cfg.endDate) return `Дата в пределах игры: ${short(cfg.startDate)}–${short(cfg.endDate)}`;
  const through = s.paymentsImportedThrough;
  if (!through) return 'Оплаты из файла ещё не загружены';
  if (d > through) return `Не позже последней загрузки оплат: ${short(through)}`;
  return null;
}

/** Предпросмотр финала: кто надевает звезду, проценты, филиал, лучшие люди, номинации и чего не хватает. */
export function finaleLines(s: Snapshot, r: FinaleResult): string[] {
  const names = new Map(s.staff.map((e) => [e.id, e.shortName]));
  const lines: string[] = [];
  if (!r.winners.length) lines.push('Звезду не надевает никто: оплат нет');
  else if (r.winners.length === 1) lines.push(`Звезду надевает ${r.winners[0]}`);
  else lines.push(`Звезду надевают вместе: ${both(r.winners)}`);
  lines.push(`Процент плана: ${GROUPS.map((g) => `${g} ${pct(r.percents[g])}`).join(' · ')}`);
  lines.push(`Филиал: оплат ${r.branch.paid}, план ${pct(r.branch.percent)}, игрушек на ёлке ${r.branch.toys} из ${TREE_SLOTS}`);
  const best = GROUPS.filter((g) => r.best[g].employeeIds.length)
    .map((g) => `${g} — ${both(r.best[g].employeeIds.map((id) => names.get(id) ?? id))} (${r.best[g].value})`);
  lines.push(`Лучшие сотрудники: ${best.length ? best.join(' · ') : 'пока нет оплат'}`);
  for (const n of r.nominations) lines.push(`${n.title} — ${both(n.groups)}`);
  if (!r.branch.treeFull) lines.push(`Не хватает: ёлка не заполнена (${r.branch.toys} из ${TREE_SLOTS}) — финал пройдёт и так`);
  const cfg = configOf(s.config);
  const lastDay = isWorkingDay(r.cutoff, cfg) ? r.cutoff : prevWorkingDay(r.cutoff, cfg);
  if (lastDay && (!s.funnelThrough || s.funnelThrough < lastDay)) {
    lines.push(`Не хватает: ${s.funnelThrough ? `воронка загружена по ${short(s.funnelThrough)}` : 'воронки нет'} — счета 6+ и 20+ без последних дней`);
  }
  return lines;
}
