import { slotsOfTier, tierOfSlot, TIERS, TIER_SIZES, type Tier } from './catalog';
import { byId, itemOf, type Purchase } from './purchase';
import type { GroupCode } from './types';

export interface Hung {
  purchaseId: number;
  slot: number;
  item: number;
  group: GroupCode;
  employeeId: string | null;
}

export interface TreeState {
  hung: Hung[];
  gifts: { purchaseId: number; item: number; group: GroupCode }[];
  /** верхний открытый ярус; назад не идёт */
  opened: Tier;
  /** игрушек на ярусах снизу вверх */
  filled: number[];
  /** свободные места открытых ярусов */
  free: number[];
  full: boolean;
}

/**
 * Раскладка ёлки по журналу. Покупки идут по номерам; место занимает первый, второй встаёт рядом (спека 4.4).
 * Отменённая покупка держит место до момента отмены: поэтому чужие игрушки от отмены не переезжают.
 */
export function treeState(purchases: readonly Purchase[]): TreeState {
  const taken = new Map<number, Purchase>();
  const holders: { slot: number; p: Purchase }[] = [];
  const gifts: TreeState['gifts'] = [];
  let opened: Tier = 1;

  const release = (until: string) => {
    for (const h of holders) if (h.p.cancelledAt !== null && h.p.cancelledAt <= until && taken.get(h.slot) === h.p) taken.delete(h.slot);
  };
  const freeOf = (t: Tier) => slotsOfTier(t).filter((s) => !taken.has(s));
  const openFree = () => TIERS.filter((t) => t <= opened).flatMap(freeOf);

  for (const p of [...purchases].sort(byId)) {
    const item = itemOf(p);
    if (!item) continue;
    if (p.shop === 'gift') {
      if (p.cancelledAt === null) gifts.push({ purchaseId: p.id, item: p.item, group: p.group });
      continue;
    }
    if (p.shop !== 'tree') continue;
    release(p.at);
    const slot = place(p.slot, item.tier!, opened, taken, freeOf, openFree);
    if (slot === null) {
      if (p.cancelledAt === null) gifts.push({ purchaseId: p.id, item: p.item, group: p.group });
      continue;
    }
    taken.set(slot, p);
    holders.push({ slot, p });
    while (opened < 5 && freeOf(opened).length === 0) opened = (opened + 1) as Tier;
  }

  const hung = holders
    .filter((h) => h.p.cancelledAt === null)
    .sort((a, b) => a.p.id - b.p.id)
    .map(({ slot, p }) => ({ purchaseId: p.id, slot, item: p.item, group: p.group, employeeId: p.employeeId }));
  const occupied = new Set(hung.map((h) => h.slot));
  const free = TIERS.filter((t) => t <= opened).flatMap((t) => slotsOfTier(t).filter((s) => !occupied.has(s)));
  return {
    hung, gifts, opened, free,
    filled: TIERS.map((t) => hung.filter((h) => tierOfSlot(h.slot) === t).length),
    full: opened === 5 && free.length === 0 && hung.length === TIER_SIZES.reduce((s, n) => s + n, 0),
  };
}

/** Место игрушки: выбранное → ближайшее на её ярусе → самое нижнее свободное → нет места (станет подарком). */
function place(
  wanted: number | null, tier: Tier, opened: Tier, taken: ReadonlyMap<number, unknown>,
  freeOf: (t: Tier) => number[], openFree: () => number[],
): number | null {
  if (tier <= opened) {
    if (wanted !== null && tierOfSlot(wanted) === tier && !taken.has(wanted)) return wanted;
    const free = freeOf(tier);
    const from = wanted ?? free[0] ?? 0;
    if (free.length) return free.reduce((best, s) => (Math.abs(s - from) < Math.abs(best - from) ? s : best));
  }
  return openFree()[0] ?? null;
}
