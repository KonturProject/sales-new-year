import type { Config } from './config';
import type { Employee } from './staff';

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
