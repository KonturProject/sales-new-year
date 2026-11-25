/** Магазины: лавка игрушек, подарки под ёлку, чердак (счета 6+), подвал (счета 20+). */
export type Shop = 'tree' | 'gift' | 'attic' | 'cellar';
export type Currency = 'coins' | 'flakes' | 'keys';
export type Tier = 1 | 2 | 3 | 4 | 5;
/** Места домика: пять фасадных (чердак) и пять дворовых (подвал). На месте одна вещь. */
export type HousePlace = 'door' | 'window' | 'eave' | 'roof' | 'porch' | 'left' | 'right' | 'path' | 'big' | 'live';

export interface CatalogItem {
  /** постоянный код: хранится в журнале покупок, не меняется и не переиспользуется */
  code: number;
  shop: Shop;
  name: string;
  price: number;
  /** имя картинки в манифесте `src/square/art.ts` */
  art: string;
  /** ярус ёлки, только у игрушек */
  tier?: Tier;
  /** место домика, только у чердака и подвала */
  place?: HousePlace;
}

export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];
/** Мест на ярусах снизу вверх. */
export const TIER_SIZES: readonly number[] = [20, 16, 13, 10, 7];
export const TREE_SLOTS = TIER_SIZES.reduce((s, n) => s + n, 0);

const toy = (tier: Tier, i: number, name: string, price: number): CatalogItem => {
  const code = (tier - 1) * 6 + i;
  return { code, shop: 'tree', name, price, art: `toy-${String(code).padStart(2, '0')}`, tier };
};
const thing = (code: number, shop: 'attic' | 'cellar', place: HousePlace, name: string, price: number): CatalogItem => ({
  code, shop, name, price, art: `decor-${code}`, place,
});

/** Каталог спеки 4.4 и 4.7. Цены после старта не меняются: засчитанные покупки пересчитываются по текущим. */
export const CATALOG: readonly CatalogItem[] = [
  toy(1, 1, 'Красный шар', 4), toy(1, 2, 'Синий шар со снежинкой', 5), toy(1, 3, 'Золотой шар', 6),
  toy(1, 4, 'Еловая ветка с лентой', 4), toy(1, 5, 'Леденец', 5), toy(1, 6, 'Бубенцы', 6),
  toy(2, 1, 'Ледяная сосулька', 5), toy(2, 2, 'Пряничный человечек', 6), toy(2, 3, 'Карамельная трость', 7),
  toy(2, 4, 'Мандарин', 5), toy(2, 5, 'Свечка', 6), toy(2, 6, 'Соломенная звезда', 7),
  toy(3, 1, 'Варежка', 6), toy(3, 2, 'Колокольчик', 7), toy(3, 3, 'Лошадка-качалка', 9),
  toy(3, 4, 'Шишка в снегу', 6), toy(3, 5, 'Барабан', 7), toy(3, 6, 'Паровозик', 9),
  toy(4, 1, 'Звёздный шар', 8), toy(4, 2, 'Снеговик', 9), toy(4, 3, 'Домик-фонарик', 11),
  toy(4, 4, 'Месяц со звёздами', 8), toy(4, 5, 'Ангел', 9), toy(4, 6, 'Карусель', 11),
  toy(5, 1, 'Золотая шишка', 10), toy(5, 2, 'Щелкунчик', 12), toy(5, 3, 'Хрустальная снежинка', 14),
  toy(5, 4, 'Серебряная снежинка', 10), toy(5, 5, 'Часы-куранты', 12), toy(5, 6, 'Золотая карета', 14),

  { code: 101, shop: 'gift', name: 'Маленький подарок', price: 5, art: 'gift-s' },
  { code: 102, shop: 'gift', name: 'Подарок', price: 10, art: 'gift-m' },
  { code: 103, shop: 'gift', name: 'Большой подарок', price: 20, art: 'gift-l' },

  thing(201, 'attic', 'door', 'Еловый венок', 10),
  thing(202, 'attic', 'door', 'Венок с колокольчиками', 12),
  thing(203, 'attic', 'door', 'Большой бант', 14),
  thing(204, 'attic', 'window', 'Ящики с ветками', 12),
  thing(205, 'attic', 'window', 'Свечи в окнах', 13),
  thing(206, 'attic', 'window', 'Носки с подарками', 15),
  thing(207, 'attic', 'eave', 'Тёплая гирлянда', 18),
  thing(208, 'attic', 'eave', 'Разноцветная гирлянда', 20),
  thing(209, 'attic', 'eave', 'Гирлянда-сосульки', 22),
  thing(210, 'attic', 'roof', 'Звезда на крыше', 22),
  thing(211, 'attic', 'roof', 'Флюгер-олень', 26),
  thing(212, 'attic', 'porch', 'Фонарики-звёзды', 12),
  thing(213, 'attic', 'porch', 'Колокол у двери', 14),

  thing(301, 'cellar', 'left', 'Снеговик', 14),
  thing(302, 'cellar', 'left', 'Деревянный олень', 16),
  thing(303, 'cellar', 'left', 'Леденцы-трости', 12),
  thing(304, 'cellar', 'right', 'Сани с подарками', 18),
  thing(305, 'cellar', 'right', 'Ёлочка в кадке', 14),
  thing(306, 'cellar', 'right', 'Щелкунчик-часовой', 16),
  thing(307, 'cellar', 'path', 'Фонарики вдоль дорожки', 15),
  thing(308, 'cellar', 'path', 'Ограда из леденцов', 17),
  thing(309, 'cellar', 'big', 'Ледяной фонтан', 28),
  thing(310, 'cellar', 'big', 'Снежная крепость', 26),
  thing(311, 'cellar', 'big', 'Ледяная арка', 30),
  thing(312, 'cellar', 'live', 'Костёр с какао', 20),
  thing(313, 'cellar', 'live', 'Снежный кот', 18),
];

const BY_CODE = new Map(CATALOG.map((i) => [i.code, i]));
export const itemByCode = (code: number): CatalogItem | undefined => BY_CODE.get(code);

export const CURRENCY_OF: Record<Shop, Currency> = { tree: 'coins', gift: 'coins', attic: 'flakes', cellar: 'keys' };

/** Ярус места 1..66 (места нумеруются снизу вверх). */
export function tierOfSlot(slot: number): Tier {
  let last = 0;
  for (const t of TIERS) {
    last += TIER_SIZES[t - 1]!;
    if (slot <= last) return t;
  }
  return 5;
}

/** Места яруса по возрастанию. */
export function slotsOfTier(tier: Tier): number[] {
  const first = TIER_SIZES.slice(0, tier - 1).reduce((s, n) => s + n, 0);
  return Array.from({ length: TIER_SIZES[tier - 1]! }, (_, i) => first + 1 + i);
}
