import { describe, expect, test } from 'vitest';
import { finaleOf } from '@/data/finale';
import { emptySnapshot } from '@/data/testkit';
import type { Employee } from '@/engine/staff';
import type { GroupCode } from '@/engine/types';
import { cutoffDefault, cutoffError, finaleLines } from './finale';

const emp = (id: string, group: GroupCode): Employee => ({
  id, name: `Тест ${id}`, shortName: `${id} Т.`, group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [],
});
const s = (over = {}) => emptySnapshot(1, {
  serverNow: '2026-12-30T11:50:00+03:00',
  paymentsImportedThrough: '2026-12-29',
  funnelThrough: '2026-12-26',
  staff: (['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'] as const).map((g, i) => emp(`e${i}`, g)),
  payments: Array.from({ length: 4 }, (_, i) => ({ date: '2026-12-07', group: 'СР2' as const, author: 'Тест e1', invoice: `I${i}` })),
  ...over,
});

describe('cutoffDefault и cutoffError: «Считать по»', () => {
  test('по умолчанию 29.12, но не позже загрузки оплат; без загрузки — пусто', () => {
    expect(cutoffDefault(s())).toBe('2026-12-29');
    expect(cutoffDefault(s({ paymentsImportedThrough: '2026-12-24' }))).toBe('2026-12-24');
    expect(cutoffDefault(s({ paymentsImportedThrough: null }))).toBeNull();
  });

  test('дата не позже последнего импорта оплат и в пределах игры', () => {
    expect(cutoffError(s(), '2026-12-29')).toBeNull();
    expect(cutoffError(s(), '2026-12-30')).toBe('Не позже последней загрузки оплат: 29.12');
    expect(cutoffError(s(), '2026-11-30')).toBe('Дата в пределах игры: 01.12–30.12');
    expect(cutoffError(s(), '29.12')).toBe('Дата вида 2026-12-29');
    expect(cutoffError(s({ paymentsImportedThrough: null }), '2026-12-20')).toBe('Оплаты из файла ещё не загружены');
  });
});

describe('finaleLines: предпросмотр', () => {
  test('победитель, номинации из finale() и чего не хватает', () => {
    const snap = s();
    const lines = finaleLines(snap, finaleOf(snap, '2026-12-29'));
    expect(lines).toContain('Звезду надевает СР2');
    expect(lines).toContain('Лучший план — СР2');
    expect(lines.some((l) => l.startsWith('Филиал: оплат 4'))).toBe(true);
    expect(lines).toContain('Лучшие сотрудники: СР2 — e1 Т. (4)');
    expect(lines).toContain('Не хватает: ёлка не заполнена (0 из 66) — финал пройдёт и так');
    expect(lines).toContain('Не хватает: воронка загружена по 26.12 — счета 6+ и 20+ без последних дней');
  });

  test('ничья — звезду надевают вместе; у всех ноль — победителя нет', () => {
    const tie = s({ payments: ['СР3', 'СР9'].flatMap((g, k) => [0, 1].map((i) => ({ date: '2026-12-07', group: g as GroupCode, author: `Тест e${k === 0 ? 2 : 5}`, invoice: `${g}${i}` }))) });
    expect(finaleLines(tie, finaleOf(tie, '2026-12-29'))).toContain('Звезду надевают вместе: СР3 и СР9');
    const none = s({ payments: [] });
    expect(finaleLines(none, finaleOf(none, '2026-12-29'))).toContain('Звезду не надевает никто: оплат нет');
  });
});
