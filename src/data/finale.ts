import { finale, type FinaleResult } from '@/engine/finale';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot } from './api';
import { buildFacts } from './facts';

const clippedCache = new WeakMap<Snapshot, Map<DateStr, Snapshot>>();

/**
 * Снимок без фактов позже отсечки: оплаты, предварительные числа, воронка и правки — по `cutoff` включительно.
 * Иначе недельные проценты («Неделя года») увидели бы дни после отсечки. Копия на пару «снимок, дата» одна.
 */
function clip(s: Snapshot, cutoff: DateStr): Snapshot {
  let byDate = clippedCache.get(s);
  if (!byDate) clippedCache.set(s, (byDate = new Map()));
  let c = byDate.get(cutoff);
  if (!c) {
    const upTo = <T extends { date: DateStr }>(list: T[]) => list.filter((x) => x.date <= cutoff);
    c = {
      ...s,
      payments: upTo(s.payments),
      provisional: upTo(s.provisional),
      funnel: upTo(s.funnel),
      corrections: s.corrections && upTo(s.corrections),
      paymentsImportedThrough: s.paymentsImportedThrough && s.paymentsImportedThrough > cutoff ? cutoff : s.paymentsImportedThrough,
      funnelThrough: s.funnelThrough && s.funnelThrough > cutoff ? cutoff : s.funnelThrough,
    };
    byDate.set(cutoff, c);
  }
  return c;
}

/**
 * Финал по снимку: факты по `cutoff` включительно, план у всех полный (за всю игру), игрушки и вещи — как стоят сейчас.
 * Общий для предпросмотра в админке и церемонии на экране.
 */
export function finaleOf(s: Snapshot, cutoff: DateStr): FinaleResult {
  const f = buildFacts(clip(s, cutoff), cutoff);
  const by = <T>(fn: (g: GroupCode) => T) => Object.fromEntries(GROUPS.map((g) => [g, fn(g)])) as Record<GroupCode, T>;
  return finale({
    cutoff,
    percents: by((g) => f.groups[g].wallet.percent),
    paid: f.branch.paid,
    gameCents: f.branch.gameCents,
    toys: by((g) => f.tree.hung.filter((h) => h.group === g).length),
    things: by((g) => Object.keys(f.groups[g].house).length),
    // снежинки и ключики — это и есть процент месячной нормы 6+ и 20+
    qualityPercents: by((g) => f.groups[g].wallet.flakes),
    longPercents: by((g) => f.groups[g].wallet.keys),
    weekBest: by((g) => Math.max(0, ...f.weeks.map((w) => w.percents[g] ?? 0))),
    treeFull: f.tree.full,
    rank: f.rank,
  });
}
