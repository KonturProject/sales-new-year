import type { Currency } from './catalog';

export interface Wallet {
  /** процент плана оплат, дробный: по нему сравниваем группы и отдаём звезду */
  percent: number;
  /** 1 % плана оплат = 1 монета */
  coins: number;
  /** 1 % месячной нормы счетов 6+ = 1 снежинка */
  flakes: number;
  /** 1 % месячной нормы 20+ = 1 ключик */
  keys: number;
}

/** Проценты считаем в целых сотых: 29 из 100 не должно дать 28,999. */
const cents = (n: number) => Math.round(n * 100);
const share = (fact: number, whole: number) => (whole > 0 ? Math.floor((fact * 10_000) / cents(whole)) : 0);

/** Заработанное группой. `gameCents` — план оплат на игру в сотых; нормы — за весь месяц. */
export function wallet(i: { paid: number; gameCents: number; quality: number; qualityNorm: number; long: number; longNorm: number }): Wallet {
  const percent = i.gameCents > 0 ? (i.paid * 10_000) / i.gameCents : 0;
  return {
    percent,
    coins: i.gameCents > 0 ? Math.floor((i.paid * 10_000) / i.gameCents) : 0,
    flakes: share(i.quality, i.qualityNorm),
    keys: share(i.long, i.longNorm),
  };
}

/** Заработано + выдано админом − потрачено. Может быть меньше нуля: план или оплаты поправили после покупки; показывать не меньше 0. */
export function balances(w: Wallet, spent: Record<Currency, number>, granted: Record<Currency, number>): Record<Currency, number> {
  return {
    coins: w.coins + granted.coins - spent.coins,
    flakes: w.flakes + granted.flakes - spent.flakes,
    keys: w.keys + granted.keys - spent.keys,
  };
}
