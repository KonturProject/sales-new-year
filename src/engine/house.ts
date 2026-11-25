import { CURRENCY_OF, type Currency, type HousePlace } from './catalog';
import { byId, itemOf, type Purchase } from './purchase';
import type { GroupCode } from './types';

/** Что стоит у домика группы: на месте последняя неотменённая вещь. */
export type HouseState = Partial<Record<HousePlace, { purchaseId: number; item: number }>>;

export function houseState(group: GroupCode, purchases: readonly Purchase[]): HouseState {
  const state: HouseState = {};
  for (const p of [...purchases].sort(byId)) {
    if (p.group !== group || p.cancelledAt !== null) continue;
    const place = itemOf(p)?.place;
    if (place) state[place] = { purchaseId: p.id, item: p.item };
  }
  return state;
}

/** Потрачено группой по валютам (по текущим ценам каталога); отменённое и незнакомое не считается. */
export function spentOf(group: GroupCode, purchases: readonly Purchase[]): Record<Currency, number> {
  const spent: Record<Currency, number> = { coins: 0, flakes: 0, keys: 0 };
  for (const p of purchases) {
    const item = p.group === group && p.cancelledAt === null ? itemOf(p) : undefined;
    if (item) spent[CURRENCY_OF[item.shop]] += item.price;
  }
  return spent;
}
