import { describe, expect, test } from 'vitest';
import type { DayResult } from '@/engine/evaluate';
import {
  cellText, correctionLine, dayLabel, editorCaption, employeeMarks, nowLines, num, outcomeLines, shortDate, signed, staleLine, staleText,
  unassignedLines,
} from './resultsText';
import type { Cell, Outcome } from './results';

const cell = (over: Partial<Cell> = {}): Cell => ({ fact: 0, plan: 0, corrected: 0, stale: false, ...over });
const result = (over: Partial<DayResult> = {}): DayResult => ({
  group: 'СР1', date: '2026-12-02', normQuality: 4, normLong: 1.5, factQuality: 5, factLong: 2,
  longRequired: true, longMet: true, qualityMet: true, ...over,
});
const outcome = (over: Partial<DayResult> = {}): Outcome => ({ evaluated: true, result: result(over) });

describe('числа и даты', () => {
  test('дробное с запятой, минус типографский', () => {
    expect(num(10.5)).toBe('10,5');
    expect(num(3)).toBe('3');
    expect(num(-2)).toBe('−2');
    expect(signed(1)).toBe('+1');
    expect(signed(-2)).toBe('−2');
    expect(signed(1.5)).toBe('+1,5');
    expect(signed(0)).toBe('0');
  });

  test('короткая дата и подпись дня с днём недели', () => {
    expect(shortDate('2026-12-02')).toBe('02.12');
    expect(dayLabel({ date: '2026-12-10', working: true })).toBe('10.12, чт');
    expect(dayLabel({ date: '2026-12-06', working: false })).toBe('06.12, вс — выходной');
  });
});

describe('cellText', () => {
  test('факт / план с запятой; факт не меньше плана — ✓', () => {
    expect(cellText(cell({ fact: 11, plan: 10.5 }))).toMatchObject({ text: '11 / 10,5', verdict: 'ok' });
    expect(cellText(cell({ fact: 9, plan: 10.5 }))).toMatchObject({ text: '9 / 10,5', verdict: 'bad' });
    expect(cellText(cell({ fact: 3, plan: 3 }))).toMatchObject({ verdict: 'ok' });
  });

  test('сравнение в сотых: 0,1 + 0,2 не мешает ✓', () => {
    expect(cellText(cell({ fact: 0.3, plan: 0.1 + 0.2 })).verdict).toBe('ok');
  });

  test('плана нет — «—» и ни ✓, ни ✗', () => {
    expect(cellText(cell({ fact: 4, plan: null }))).toMatchObject({ text: '4 / —', verdict: null });
  });

  test('отметки: выходные, правки, устаревшая правка', () => {
    const t = cellText(cell({ fact: 4, plan: 1, weekend: 2, corrected: -1, stale: true }));
    expect(t).toMatchObject({ weekend: 'из них 2 в выходные', corrected: 'правки −1', stale: true });
    expect(cellText(cell({ weekend: 0 }))).toMatchObject({ weekend: null, corrected: null, stale: false });
  });
});

describe('outcomeLines', () => {
  test('счета 6+ и 20+ против нормы, галочка — когда норма взята', () => {
    expect(outcomeLines(outcome())).toEqual(['счета 6+: 5 из 4 ✓', 'счета 20+: 2 из 1,5 ✓']);
    expect(outcomeLines(outcome({ factQuality: 3, qualityMet: false, factLong: 1, longMet: false }))).toEqual(['счета 6+: 3 из 4', 'счета 20+: 1 из 1,5']);
  });

  test('нормы на 20+ нет (новичок 1)', () => {
    expect(outcomeLines(outcome({ longRequired: false, normLong: 0 }))[1]).toBe('счета 20+: нормы нет');
  });

  test('день не оценивается: выходной или воронка не загружена', () => {
    expect(outcomeLines({ evaluated: false, reason: 'weekend' })).toEqual(['выходной']);
    expect(outcomeLines({ evaluated: false, reason: 'no-funnel' })).toEqual(['воронка за день не загружена']);
  });
});

describe('nowLines', () => {
  test('план и кошелёк группы', () => {
    expect(nowLines({ now: { percent: 41, coins: 12, flakes: 30, keys: 9 } })).toEqual(['план 41 %', 'монет 12 · снежинок 30 · ключиков 9']);
  });
});

describe('подписи сотрудника и группы', () => {
  test('отметки сотрудника: отсутствие, вне рейтинга, вне итога группы', () => {
    expect(employeeMarks({ absence: null, hidden: false, inGroupTotal: true })).toEqual([]);
    expect(employeeMarks({ absence: 'vacation', hidden: true, inGroupTotal: false })).toEqual(['отпуск', 'не в рейтинге', 'не входит в итог группы']);
    expect(employeeMarks({ absence: 'sick', hidden: false, inGroupTotal: true })).toEqual(['больничный']);
  });

  test('подпись редактора: «правки» только когда они есть', () => {
    expect(editorCaption(3, 0)).toBe('из файла 3');
    expect(editorCaption(3, 1)).toBe('из файла 3, правки +1');
    expect(editorCaption(0, -2)).toBe('из файла 0, правки −2');
  });

  test('не разнесено: строка только при ненулевой разнице, «авторы не из штата» — только если есть', () => {
    expect(unassignedLines({ payments: 0, unmatched: 0 })).toEqual([]);
    expect(unassignedLines({ payments: 2, unmatched: 0 })).toEqual(['не разнесено по сотрудникам: 2']);
    expect(unassignedLines({ payments: 3, unmatched: 1 })).toEqual(['не разнесено по сотрудникам: 3', 'из них авторы не из штата: 1']);
    expect(unassignedLines({ payments: -1, unmatched: 0 })).toEqual(['не разнесено по сотрудникам: −1']);
  });
});

describe('staleText', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    c: { id: 1, date: '2026-12-02', employeeId: 'a1', kind: 'long' as const, delta: 1, base: 2 }, fileNow: 3, stale: true, ...over,
  });

  test('текст из спеки: сделана при 2, теперь 3', () => {
    expect(staleText(view())).toBe('правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
    expect(staleText(view({ c: { id: 1, date: '2026-12-02', employeeId: 'a1', kind: 'payments', delta: -2, base: 5 }, fileNow: 0 })))
      .toContain('правка −2 сделана при 5 в файле, теперь в файле 0');
  });

  test('не устарела — пусто', () => {
    expect(staleText(view({ stale: false }))).toBe('');
    expect(staleText(view({ fileNow: null, stale: false }))).toBe('');
  });
});

describe('correctionLine и staleLine: правки в разборе загрузки', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    c: { id: 1, date: '2026-12-02', employeeId: 'a1', kind: 'long' as const, delta: 1, base: 2 },
    group: 'СР3' as const, name: 'Тест Иванов', fileNow: 3, stale: true, ...over,
  });

  test('устаревшая правка — строкой из спеки: дата, группа, ФИО, показатель, что случилось', () => {
    expect(staleLine(view())).toBe('02.12, СР3, Тест Иванов, длинные: правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
  });

  test('правка ушедшего из штата — группа «—»', () => {
    expect(staleLine(view({ group: null, name: 'нет в штате' }))).toContain('02.12, —, нет в штате, длинные:');
  });

  test('правка в списке: без пометки, если не устарела, с пометкой, если устарела', () => {
    expect(correctionLine(view({ stale: false }))).toBe('02.12, СР3, Тест Иванов, длинные: +1');
    expect(correctionLine(view({ c: { id: 2, date: '2026-12-03', employeeId: 'a1', kind: 'payments', delta: -2, base: 2 }, stale: false }))).toBe('03.12, СР3, Тест Иванов, оплаты: −2');
    expect(correctionLine(view())).toBe('02.12, СР3, Тест Иванов, длинные: +1 — ⚠ правка +1 сделана при 2 в файле, теперь в файле 3 — проверьте, не пришёл ли счёт сам');
  });
});
