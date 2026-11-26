import { serverToday, type Snapshot } from '@/data/api';
import { buildFacts } from '@/data/facts';
import { itemByCode, type Currency, type Shop } from '@/engine/catalog';
import { GROUPS, type GroupCode } from '@/engine/types';
import { num } from './resultsText';

/** Как `REASON_MAX` и `reason_` в `Code.gs`: длиннее или «формулу» сервер отклонит. */
const REASON_MAX = 200;
/** Как `GRANT_MAX` в `Code.gs`. */
const GRANT_MAX = 500;
const CURRENCIES: Currency[] = ['coins', 'flakes', 'keys'];

export const SHOP_TITLE: Record<Shop, string> = { tree: 'Ёлка', gift: 'Подарок', attic: 'Чердак', cellar: 'Подвал' };
export const CURRENCY_TITLE: Record<Currency, string> = { coins: 'монеты', flakes: 'снежинки', keys: 'ключики' };

/** Причина отмены или выдачи: обязательна; в ячейку таблицы не попадёт формула. */
export function reasonError(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Напишите причину';
  if (t.length > REASON_MAX) return `Причина длиннее ${REASON_MAX} знаков`;
  if (/^[=+\-@]/.test(t)) return 'Причина не может начинаться с = + − @';
  return null;
}

export function cancelBody(id: number, reason: string): { body: { id: number; reason: string } } | { error: string } {
  const error = reasonError(reason);
  return error ? { error } : { body: { id, reason: reason.trim() } };
}

/** «02.12 10:05» из времени сервера. */
const stamp = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}`;

export interface PurchaseLine {
  id: number;
  group: GroupCode;
  cancelled: boolean;
  text: string;
  /** «отменена 02.12 12:00: причина» или `null` */
  note: string | null;
}

/** Журнал покупок, новые сверху; `reasons` — причины отмен из `getPrivate` (ключ — номер покупки). */
export function purchaseLines(s: Snapshot, reasons: Record<string, string>, group?: GroupCode): PurchaseLine[] {
  const names = new Map(s.staff.map((e) => [e.id, e.shortName]));
  return [...s.purchases]
    .filter((p) => !group || p.group === group)
    .sort((a, b) => b.id - a.id)
    .map((p) => {
      const item = itemByCode(p.item);
      const parts = [`№${p.id}`, stamp(p.at), p.group, `${SHOP_TITLE[p.shop] ?? p.shop}: ${item?.name ?? `код ${p.item}`}`];
      if (p.slot !== null) parts.push(`место ${p.slot}`);
      const who = p.employeeId ? names.get(p.employeeId) : undefined;
      if (who) parts.push(`для ${who}`);
      return {
        id: p.id,
        group: p.group,
        cancelled: p.cancelledAt !== null,
        text: parts.join(' · '),
        note: p.cancelledAt !== null ? `отменена ${stamp(p.cancelledAt)}: ${reasons[String(p.id)] ?? 'причина не видна'}` : null,
      };
    });
}

export interface GrantForm {
  group: string;
  kind: string;
  delta: string;
  reason: string;
}

/** Выдача (минус — изъятие): тело для `grant` без `ref` и строка «станет» по нынешнему остатку группы. */
export function grantPlan(
  s: Snapshot,
  form: GrantForm,
): { body: { group: GroupCode; kind: Currency; delta: number; reason: string }; preview: string } | { error: string } {
  if (!GROUPS.includes(form.group as GroupCode)) return { error: 'Выберите группу' };
  if (!CURRENCIES.includes(form.kind as Currency)) return { error: 'Выберите, что выдать' };
  const raw = form.delta.trim().replace('−', '-');
  const delta = /^[+-]?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > GRANT_MAX) return { error: `Сколько: целое число от −${GRANT_MAX} до ${GRANT_MAX}, не ноль` };
  const error = reasonError(form.reason);
  if (error) return { error };
  const group = form.group as GroupCode;
  const kind = form.kind as Currency;
  const now = buildFacts(s, serverToday(s)).groups[group].balance[kind];
  const after = now + delta;
  return {
    body: { group, kind, delta, reason: form.reason.trim() },
    preview: `${group}: ${CURRENCY_TITLE[kind]} ${num(now)} → ${num(after)}${after < 0 ? ' (на площади 0)' : ''}`,
  };
}
