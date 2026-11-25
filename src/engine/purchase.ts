import { itemByCode, type CatalogItem, type Shop } from './catalog';
import type { DateStr, GroupCode } from './types';

/** Запись журнала покупок. Засчитана навсегда, убирает её только отмена админа (`cancelledAt`). */
export interface Purchase {
  id: number;
  /** момент записи на сервере, ISO +03:00 */
  at: string;
  date: DateStr;
  group: GroupCode;
  shop: Shop;
  item: number;
  /** место на ёлке 1..66; у подарков и вещей домика — null */
  slot: number | null;
  /** кому посвящена игрушка */
  employeeId: string | null;
  cancelledAt: string | null;
}

/** Товар покупки; `undefined` — код незнаком или из другого магазина (такая запись не засчитывается). */
export function itemOf(p: Purchase): CatalogItem | undefined {
  const item = itemByCode(p.item);
  return item?.shop === p.shop ? item : undefined;
}

export const byId = (a: Purchase, b: Purchase) => a.id - b.id;
