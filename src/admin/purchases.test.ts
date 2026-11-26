import { describe, expect, test } from 'vitest';
import { emptySnapshot } from '@/data/testkit';
import { buy, thing } from '@/engine/testkit';
import { cancelBody, grantPlan, purchaseLines, reasonError } from './purchases';

describe('reasonError: причина отмены и выдачи', () => {
  test('нужна, не длиннее 200 знаков и не похожа на формулу', () => {
    expect(reasonError('')).toBe('Напишите причину');
    expect(reasonError('   ')).toBe('Напишите причину');
    expect(reasonError('x'.repeat(201))).toBe('Причина длиннее 200 знаков');
    expect(reasonError('=1+1')).toBe('Причина не может начинаться с = + − @');
    expect(reasonError('-5 по ошибке')).toBe('Причина не может начинаться с = + − @');
    expect(reasonError(' купили не туда ')).toBeNull();
  });
});

describe('cancelBody: отмена покупки', () => {
  test('без причины — ошибка, с причиной — тело для cancelPurchase', () => {
    expect(cancelBody(7, '')).toEqual({ error: 'Напишите причину' });
    expect(cancelBody(7, ' купили не туда ')).toEqual({ body: { id: 7, reason: 'купили не туда' } });
  });
});

describe('purchaseLines: журнал покупок', () => {
  const s = emptySnapshot(1, {
    staff: [{ id: 'a1', name: 'Тест Альфов', shortName: 'Альфов Т.', group: 'СР3', hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [] }],
    purchases: [
      buy(1, 'СР3', 1, 14, { employeeId: 'a1' }),
      thing(2, 'СР6', 201),
      buy(3, 'СР1', 101, null, { shop: 'gift', cancelledAt: '2026-12-02T12:00:00+03:00' }),
    ],
  });

  test('новые сверху: время, группа, лавка, вещь, место, кому; отменённая — с причиной', () => {
    const lines = purchaseLines(s, { 3: 'купили по ошибке' });
    expect(lines.map((l) => l.id)).toEqual([3, 2, 1]);
    expect(lines[2]!.text).toMatch(/^№1 · 02\.12 10:00 · СР3 · Ёлка: .+ · место 14 · для Альфов Т\.$/);
    expect(lines[1]!.text).toMatch(/^№2 · 02\.12 10:00 · СР6 · Чердак: .+$/);
    expect(lines[0]).toMatchObject({ cancelled: true, note: 'отменена 02.12 12:00: купили по ошибке' });
    expect(lines[2]).toMatchObject({ cancelled: false, note: null });
  });

  test('фильтр по группе', () => {
    expect(purchaseLines(s, {}, 'СР6').map((l) => l.id)).toEqual([2]);
  });
});

describe('grantPlan: выдача валюты', () => {
  // у СР2 есть 30 снежинок от прежней выдачи
  const s = emptySnapshot(1, { grants: [{ id: 1, date: '2026-12-02', group: 'СР2', kind: 'flakes', delta: 30 }] });
  const form = (over: Partial<Record<'group' | 'kind' | 'delta' | 'reason', string>> = {}) =>
    ({ group: 'СР2', kind: 'flakes', delta: '-5', reason: 'вернули за отмену', ...over });

  test('−5 снежинок: тело для grant и «станет»', () => {
    expect(grantPlan(s, form())).toEqual({
      body: { group: 'СР2', kind: 'flakes', delta: -5, reason: 'вернули за отмену' },
      preview: 'СР2: снежинки 30 → 25',
    });
  });

  test('меньше нуля — предупреждение, что на площади будет 0', () => {
    expect(grantPlan(s, form({ delta: '-40' }))).toMatchObject({ preview: 'СР2: снежинки 30 → −10 (на площади 0)' });
  });

  test('ошибки: число, ноль, предел 500, причина', () => {
    expect(grantPlan(s, form({ delta: '2,5' }))).toEqual({ error: 'Сколько: целое число от −500 до 500, не ноль' });
    expect(grantPlan(s, form({ delta: '0' }))).toEqual({ error: 'Сколько: целое число от −500 до 500, не ноль' });
    expect(grantPlan(s, form({ delta: '501' }))).toEqual({ error: 'Сколько: целое число от −500 до 500, не ноль' });
    expect(grantPlan(s, form({ reason: '' }))).toEqual({ error: 'Напишите причину' });
    expect(grantPlan(s, form({ group: 'СР4' }))).toEqual({ error: 'Выберите группу' });
    expect(grantPlan(s, form({ kind: 'gold' }))).toEqual({ error: 'Выберите, что выдать' });
  });

  test('монеты и ключики подписываются своими словами; плюс без минуса', () => {
    expect(grantPlan(s, form({ kind: 'coins', delta: '+3' }))).toMatchObject({ preview: 'СР2: монеты 0 → 3' });
    expect(grantPlan(s, form({ kind: 'keys', delta: '2' }))).toMatchObject({ preview: 'СР2: ключики 0 → 2' });
  });
});
