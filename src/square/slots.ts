import { TIER_SIZES } from '@/engine/catalog';

/** Непрозрачность картинки ёлки: экран и страница РГ строят места по одной и той же картинке. */
export interface AlphaMask {
  width: number;
  height: number;
  solid(x: number, y: number): boolean;
}

export interface SlotPoint {
  x: number;
  y: number;
}

/** На каждом ярусе два ряда: нижний чуть длиннее. */
const ROWS = TIER_SIZES.map((n) => [Math.ceil(n / 2), Math.floor(n / 2)]);
/** Где на ёлке живут игрушки: доли высоты от верхушки (тело ёлки без ствола и острой макушки). */
const BODY = { top: 0.13, bottom: 0.75 };
const EDGE = 0.1;

/**
 * 66 мест на ёлке снизу вверх, внутри ряда слева направо, в пикселях картинки. Ряд — горизонталь через силуэт, места
 * на нём равномерно, нечётные ряды сдвинуты на полшага, к краям ряд чуть поднимается (ветки смотрят вверх).
 */
export function treeSlots(mask: AlphaMask): SlotPoint[] {
  const rowHas = (y: number) => { for (let x = 0; x < mask.width; x += 2) if (mask.solid(x, y)) return true; return false; };
  let top = 0;
  let bottom = mask.height - 1;
  while (top < bottom && !rowHas(top)) top++;
  while (bottom > top && !rowHas(bottom)) bottom--;
  const h = bottom - top;
  const rows = ROWS.flat();
  const out: SlotPoint[] = [];
  rows.forEach((n, r) => {
    const y = Math.round(top + h * (BODY.bottom - ((BODY.bottom - BODY.top) * (r + 0.5)) / rows.length));
    let left = 0;
    let right = mask.width - 1;
    while (left < right && !mask.solid(left, y)) left++;
    while (right > left && !mask.solid(right, y)) right--;
    const span = (right - left) * (1 - 2 * EDGE);
    const shift = r % 2 ? 0.5 : 0;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : (i + 0.25 + shift * 0.5) / (n - 0.5 + shift * 0.5);
      const x = left + (right - left) * EDGE + span * Math.min(1, Math.max(0, u));
      const lift = Math.abs(u * 2 - 1) ** 2 * h * 0.012;
      let yy = Math.round(y - lift);
      if (!mask.solid(Math.round(x), yy)) yy = y;
      out.push({ x: Math.round(x), y: yy });
    }
  });
  return out;
}
