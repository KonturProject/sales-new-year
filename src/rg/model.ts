import { ApiError, serverToday, type Snapshot } from '@/data/api';
import type { Facts } from '@/data/facts';
import { CATALOG, CURRENCY_OF, slotsOfTier, type CatalogItem, type Currency, type HousePlace, type Tier } from '@/engine/catalog';
import { isPresent, groupOn, type Employee } from '@/engine/staff';
import type { GroupCode } from '@/engine/types';

export type CardState = 'buy' | 'poor' | 'closed' | 'owned';
export interface Card { item: CatalogItem; state: CardState; lack: number }

const MAX_PAYMENTS = 15;
const ASK_GUARD_MS = 500;

const closed = (s: Snapshot) => s.finale != null;
const shown = (n: number) => Math.max(0, n);

function card(item: CatalogItem, balance: number, s: Snapshot, owned = false): Card {
  if (closed(s)) return { item, state: 'closed', lack: 0 };
  if (owned) return { item, state: 'owned', lack: 0 };
  const lack = Math.max(0, item.price - balance);
  return { item, state: lack ? 'poor' : 'buy', lack };
}

/** Лавка: открытый ярус с наименьшим свободным местом, его свободные места и шесть игрушек яруса. */
export function treeCards(s: Snapshot, f: Facts, g: GroupCode): { tier: Tier | null; free: number[]; options: Card[]; balance: number } {
  const balance = shown(f.groups[g].balance.coins);
  const tier = ([1, 2, 3, 4, 5] as Tier[]).find((t) => t <= f.tree.opened && slotsOfTier(t).some((sl) => f.tree.free.includes(sl))) ?? null;
  if (tier === null) return { tier, free: [], options: [], balance };
  return {
    tier, balance,
    free: slotsOfTier(tier).filter((sl) => f.tree.free.includes(sl)),
    options: CATALOG.filter((i) => i.tier === tier).map((i) => card(i, balance, s)),
  };
}

export function giftCards(s: Snapshot, f: Facts, g: GroupCode): Card[] {
  const balance = shown(f.groups[g].balance.coins);
  return CATALOG.filter((i) => i.shop === 'gift').map((i) => card(i, balance, s));
}

export const PLACE_TITLE: Record<HousePlace, string> = {
  door: 'Дверь', window: 'Окна', eave: 'Карниз', roof: 'Крыша', porch: 'Крыльцо',
  left: 'Двор слева', right: 'Двор справа', path: 'Дорожка', big: 'Главное во дворе', live: 'Уютный уголок',
};

/** Чердак или подвал: по местам, что стоит сейчас и что можно достать. */
export function houseCards(s: Snapshot, f: Facts, g: GroupCode, shop: 'attic' | 'cellar') {
  const view = f.groups[g];
  const balance = shown(view.balance[CURRENCY_OF[shop]]);
  const places = [...new Set(CATALOG.filter((i) => i.shop === shop).map((i) => i.place!))];
  return places.map((place) => {
    const ownedCode = view.house[place]?.item;
    const owned = ownedCode === undefined ? null : CATALOG.find((i) => i.code === ownedCode) ?? null;
    return {
      place, title: PLACE_TITLE[place], owned,
      options: CATALOG.filter((i) => i.shop === shop && i.place === place).map((i) => card(i, balance, s, i.code === ownedCode)),
    };
  });
}

export function paymentState(s: Snapshot, g: GroupCode): { today: number; canAdd: boolean; canRemove: boolean; reason: string | null } {
  const today = serverToday(s);
  const count = s.provisional.filter((p) => p.date === today && p.group === g).reduce((a, p) => a + p.count, 0);
  const reason = closed(s) ? 'Игра окончена, лавка закрыта'
    : s.paymentsImportedThrough && s.paymentsImportedThrough >= today ? 'Этот день уже загружен из файла' : null;
  return { today: count, canAdd: !reason && count < MAX_PAYMENTS, canRemove: !reason && count > 0, reason };
}

/** Кому можно посвятить игрушку: свои, на месте сегодня, не скрытые из рейтинга. */
export function employeesOf(s: Snapshot, g: GroupCode): Employee[] {
  const today = serverToday(s);
  return s.staff
    .filter((e) => groupOn(e, today) === g && isPresent(e, today, s.absences) && !e.hiddenFromRating)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const WORD: Record<Currency, [string, string, string]> = {
  coins: ['монету', 'монеты', 'монет'], flakes: ['снежинку', 'снежинки', 'снежинок'], keys: ['ключик', 'ключика', 'ключиков'],
};
/** 1 монету, 2 монеты, 5 монет. */
export function amount(n: number, c: Currency): string {
  const [one, few, many] = WORD[c];
  const m10 = n % 10, m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many}`;
}

export function confirmText(item: CatalogItem, o: { tier?: number; employee?: string; replaces?: CatalogItem | null }): string {
  const price = amount(item.price, CURRENCY_OF[item.shop]);
  const tail = o.replaces ? ` Встанет вместо «${o.replaces.name}».` : '';
  switch (item.shop) {
    case 'tree': return `Повесить «${item.name}» за ${price} на ${o.tier}-й ярус?${o.employee ? ` Посвящение: ${o.employee}` : ''}`;
    case 'gift': return `Положить под ёлку «${item.name}» за ${price}?`;
    case 'attic': return `Достать с чердака «${item.name}» за ${price}?${tail}`;
    case 'cellar': return `Достать из подвала «${item.name}» за ${price}?${tail}`;
  }
}

export function buyError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера, повторите позже';
  switch (e.code) {
    case 'finished': return 'Игра окончена, лавка закрыта';
    case 'network': return 'Нет связи. Нажмите ещё раз: повтор не спишет дважды';
    case 'bad_request': return 'Данные устарели, страница обновлена. Проверьте и повторите';
    case 'invalid_pin': return 'PIN сменился. Войдите заново';
    case 'locked': return 'Вход заблокирован после неверных попыток, подождите 10 минут';
    default: return 'Ошибка сервера, повторите позже';
  }
}

/** Ответ на вопрос засчитывается не раньше чем через 500 мс: иначе это второй щелчок двойного нажатия по карточке. */
export const askAccepted = (shownAt: number, clickedAt: number) => clickedAt - shownAt >= ASK_GUARD_MS;
