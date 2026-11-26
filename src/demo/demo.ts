import type { Snapshot } from '@/data/api';
import { workingDaysBetween } from '@/engine/calendar';
import { CATALOG, TIERS, slotsOfTier, CURRENCY_OF, type CatalogItem } from '@/engine/catalog';
import { defaultConfig as cfg } from '@/engine/config';
import { wallet } from '@/engine/coins';
import type { FunnelDay } from '@/engine/evaluate';
import { groupNorms, groupPlan } from '@/engine/evaluate';
import type { Purchase } from '@/engine/purchase';
import type { Employee } from '@/engine/staff';
import { treeState } from '@/engine/tree';
import { GROUPS, type DateStr, type GroupCode } from '@/engine/types';

/** Витрины: экран и проверки показывают по ним все состояния игры (`?demo=…`). ФИО выдуманные. */
export const DEMOS = ['start', 'early', 'middle', 'late', 'full', 'weekend', 'grinch', 'finale', 'empty'] as const;
export type DemoName = (typeof DEMOS)[number];

const NOW: Record<DemoName, string> = {
  start: '2026-12-01T09:30', early: '2026-12-03T15:00', middle: '2026-12-10T16:40', late: '2026-12-24T17:30', full: '2026-12-29T19:00',
  weekend: '2026-12-12T13:00', grinch: '2026-12-10T13:00', finale: '2026-12-30T13:00', empty: '2026-12-10T10:00',
};
/** Темп к плану: «full» — сильный декабрь, чтобы ёлка заполнилась. */
const PACE: Partial<Record<DemoName, number>> = { full: 1.25, finale: 1.25 };

const HEADCOUNT: Record<GroupCode, number> = { СР1: 10, СР2: 7, СР3: 10, СР5: 11, СР6: 6, СР9: 9 };
/** Доля плана, которую группа делает к концу месяца (как ноябрь: от 54 до 135 %). */
const STRENGTH: Record<GroupCode, number> = { СР1: 0.6, СР2: 0.95, СР3: 1.3, СР5: 0.85, СР6: 1.0, СР9: 1.2 };
const PLAN = 6;

/** Детерминированный генератор (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const iso = (d: DateStr, hhmm: string) => `${d}T${hhmm}:00+03:00`;

export function demoSnapshot(name: DemoName): Snapshot {
  const now = iso(NOW[name].slice(0, 10), NOW[name].slice(11));
  const today = now.slice(0, 10);
  const base: Snapshot = {
    version: 1, serverNow: now, funnelThrough: null, paymentsImportedThrough: null, config: {}, configChanges: [],
    staff: [], absences: [], payments: [], provisional: [], funnel: [], corrections: [], purchases: [], grants: [],
    lastPaymentAt: null, grinch: { auto: true, quietMin: 120, commands: [] }, finale: null, commands: [],
  };
  if (name === 'empty') return base;

  const staff: Employee[] = GROUPS.flatMap((group) => Array.from({ length: HEADCOUNT[group] }, (_, i): Employee => ({
    id: `${group}-${i + 1}`, name: `Тест ${group}-${i + 1}`, shortName: `Тест ${group}-${i + 1}`, group, hireDate: null, fireDate: null,
    baseLevel: 'experienced', hiddenFromRating: false, transfers: [], paymentPlan: PLAN,
  })));
  const days = workingDaysBetween(cfg.startDate, today, cfg);
  const official = days.filter((d) => d < today);
  const rnd = random(name.length * 7919);
  const pace = PACE[name] ?? 1;

  // оплаты: дневной план группы × сила × шум; официальные — строками по вчера, сегодня — предварительно
  const payments: Snapshot['payments'] = [];
  const provisional: Snapshot['provisional'] = [];
  const paidByDay: Record<GroupCode, Record<DateStr, number>> = Object.fromEntries(GROUPS.map((g) => [g, {}])) as never;
  let invoice = 1;
  for (const g of GROUPS) {
    const people = staff.filter((e) => e.group === g);
    let carry = 0;
    for (const d of days) {
      carry += (people.length * PLAN * STRENGTH[g] * pace) / 22 * (0.4 + rnd() * 1.2);
      const n = d === today ? Math.floor(carry * 0.5) : Math.floor(carry);
      carry -= n;
      paidByDay[g][d] = n;
      if (d === today) { if (n) provisional.push({ date: d, group: g, count: n }); continue; }
      for (let i = 0; i < n; i++) payments.push({ date: d, group: g, author: people[(invoice + i) % people.length]!.name, invoice: `D-${invoice++}` });
    }
  }
  const funnel: FunnelDay[] = official.flatMap((date) => staff.map((e) => ({
    employeeId: e.id, date,
    quality: Math.round(4 * (0.8 + rnd() * 0.5)),
    long: Math.round(1.5 * (0.8 + rnd() * 0.9)),
  })));

  const snap: Snapshot = {
    ...base, staff, payments, provisional, funnel,
    funnelThrough: official.at(-1) ?? null, paymentsImportedThrough: official.at(-1) ?? null,
  };
  snap.purchases = shop(snap, days, rnd);
  if (name === 'grinch') snap.lastPaymentAt = iso(today, '10:30');
  else if (provisional.length) snap.lastPaymentAt = iso(today, '15:10');
  if (name === 'finale') snap.finale = { cutoff: '2026-12-29', at: now };
  return snap;
}

/** Покупки «как вели бы себя РГ»: каждый рабочий день группа тратит, что накопила, на ёлку, чердак и подвал. */
function shop(s: Snapshot, days: DateStr[], rnd: () => number): Purchase[] {
  const out: Purchase[] = [];
  const spent: Record<GroupCode, Record<'coins' | 'flakes' | 'keys', number>> = Object.fromEntries(GROUPS.map((g) => [g, { coins: 0, flakes: 0, keys: 0 }])) as never;
  const toys = CATALOG.filter((i) => i.shop === 'tree');
  const things = CATALOG.filter((i) => i.shop === 'attic' || i.shop === 'cellar');
  const owned: Record<GroupCode, Set<string>> = Object.fromEntries(GROUPS.map((g) => [g, new Set<string>()])) as never;
  let id = 1;
  for (const [n, d] of days.entries()) {
    const cut = { ...s, payments: s.payments.filter((p) => p.date <= d), provisional: s.provisional.filter((p) => p.date <= d), funnel: s.funnel.filter((f) => f.date < d) };
    for (const g of GROUPS) {
      let paid = 0;
      for (const p of cut.payments) if (p.group === g) paid++;
      for (const p of cut.provisional) if (p.group === g) paid += p.count;
      const norms = groupNorms(g, s.staff, s.absences, () => cfg, cfg);
      let q = 0, l = 0;
      for (const f of cut.funnel) if (f.employeeId.startsWith(g)) { q += f.quality; l += f.long; }
      const w = wallet({ paid, gameCents: groupPlan(g, d, s.staff, s.absences, () => cfg, cfg).gameCents, quality: q, qualityNorm: norms.quality, long: l, longNorm: norms.long });
      const left = { coins: w.coins - spent[g].coins, flakes: w.flakes - spent[g].flakes, keys: w.keys - spent[g].keys };
      const buy = (item: CatalogItem, slot: number | null) => {
        const cur = CURRENCY_OF[item.shop];
        left[cur] -= item.price; spent[g][cur] += item.price;
        const hh = String(10 + ((id * 7) % 8)).padStart(2, '0');
        out.push({ id: id++, at: iso(d, `${hh}:${String((id * 13) % 60).padStart(2, '0')}`), date: d, group: g, shop: item.shop, item: item.code, slot, employeeId: rnd() < 0.5 ? `${g}-${1 + Math.floor(rnd() * 6)}` : null, cancelledAt: null });
      };
      for (let guard = 0; guard < 6; guard++) {
        const t = treeState(out);
        const tier = t.full ? null : TIERS.find((x) => x <= t.opened && slotsOfTier(x).some((sl) => t.free.includes(sl)));
        const choices = tier ? toys.filter((i) => i.tier === tier && i.price <= left.coins) : [];
        if (!choices.length) break;
        const item = choices[Math.floor(rnd() * choices.length)]!;
        const free = slotsOfTier(tier!).filter((sl) => t.free.includes(sl));
        buy(item, free[Math.floor(rnd() * free.length)]!);
      }
      if (n % 2 === 1) {
        for (const shopName of ['attic', 'cellar'] as const) {
          const cur = CURRENCY_OF[shopName];
          const fresh = things.filter((i) => i.shop === shopName && !owned[g].has(i.place!) && i.price <= left[cur]);
          if (!fresh.length) continue;
          const item = fresh[Math.floor(rnd() * fresh.length)]!;
          owned[g].add(item.place!);
          buy(item, null);
        }
      }
    }
  }
  return out;
}
