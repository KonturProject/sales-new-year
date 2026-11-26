import { finale, type FinaleResult } from '@/engine/finale';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';
import type { Snapshot } from './api';
import { buildFacts } from './facts';

/**
 * Финал по снимку: оплаты по `cutoff` включительно, план у всех полный (за всю игру), игрушки и вещи — как стоят сейчас.
 * Общий для предпросмотра в админке и церемонии на экране.
 */
export function finaleOf(s: Snapshot, cutoff: DateStr): FinaleResult {
  const f = buildFacts(s, cutoff);
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
