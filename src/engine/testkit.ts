import type { Config } from './config';
import { tierOfSlot } from './catalog';
import type { Purchase } from './purchase';
import type { Employee } from './staff';
import { GROUPS, type GroupCode } from './types';

/** Выдуманный сотрудник для тестов: опытный из СР1, без дат и личного плана. */
export const person = (over: Partial<Employee> = {}): Employee => ({
  id: 'e1', name: 'Тестов Тест', shortName: 'Тестов Т.', group: 'СР1', hireDate: null, fireDate: null,
  baseLevel: 'experienced', hiddenFromRating: false, transfers: [], ...over,
});

/** Календарь и нормы «Питомцев» за ноябрь: на них написаны перенесённые тесты движка. */
export const novemberConfig: Config = {
  startDate: '2026-11-02',
  endDate: '2026-11-30',
  nonWorking: ['2026-11-04', '2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22', '2026-11-28', '2026-11-29'],
  norms: {
    experienced: { quality: 5, long: 3, payments: 0.3 },
    rookie1: { quality: 1, long: 0, payments: 0 },
    rookie2: { quality: 2, long: 1, payments: 0.1 },
  },
  personalPlanPercent: 105,
  finaleCutoff: '2026-11-30',
};

/** Покупка игрушки (или подарка); время растёт с номером: 2 декабря, 10:00:NN (дальше минуты). */
export const buy = (id: number, group: GroupCode, item: number, slot: number | null, over: Partial<Purchase> = {}): Purchase => ({
  id, at: `2026-12-02T10:${String(Math.floor(id / 60)).padStart(2, '0')}:${String(id % 60).padStart(2, '0')}+03:00`, date: '2026-12-02',
  group, shop: 'tree', item, slot, employeeId: null, cancelledAt: null, ...over,
});

/** Вещь домика: магазин и место — по коду каталога. */
export const thing = (id: number, group: GroupCode, item: number, over: Partial<Purchase> = {}): Purchase =>
  buy(id, group, item, null, { shop: item < 300 ? 'attic' : 'cellar', ...over });

/** Первые `n` мест яруса 1 подряд (покупки с номерами 1..n). */
export const fillTier = (tier: 1, n: number): Purchase[] => Array.from({ length: n }, (_, i) => buy(i + 1, 'СР1', tier, i + 1));

/** `n` покупок подряд, каждая — первая игрушка яруса своего места; лишние повторяют последний ярус. */
export const fillAll = (n: number): Purchase[] =>
  Array.from({ length: n }, (_, i) => {
    const slot = Math.min(i + 1, 66);
    return buy(i + 1, GROUPS[i % 6]!, (tierOfSlot(slot) - 1) * 6 + 1, slot);
  });
