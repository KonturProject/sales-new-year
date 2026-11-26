import { describe, expect, test } from 'vitest';
import type { Snapshot } from '@/data/api';
import { emptySnapshot } from '@/data/testkit';
import { applyPatch, configPreview, describeChange, describeEntry, mergeConfig, removalPreview, removeChange } from './configPreview';

const person = (id: string) => ({ id, name: `Тест ${id}`, shortName: id, group: 'СР1' as const, hireDate: null, fireDate: null, baseLevel: 'experienced' as const, hiddenFromRating: false, transfers: [] });
/** СР1: трое опытных без личного плана (0,27 × 22 × 3 = 17,82 оплаты на игру) и 6 оплат на сегодня — 33 %. */
const withSix = (over: Partial<Snapshot> = {}) =>
  emptySnapshot(1, { staff: ['a', 'b', 'c'].map(person), provisional: [{ date: '2026-12-10', group: 'СР1', count: 6 }], ...over });

describe('mergeConfig', () => {
  test('нормы сливаются по уровню и полю, выходные сохраняются', () => {
    expect(mergeConfig({ nonWorking: ['2026-12-05'], norms: { rookie1: { quality: 2 } } }, { norms: { rookie1: { long: 1 }, experienced: { quality: 3 } } }))
      .toEqual({ nonWorking: ['2026-12-05'], norms: { rookie1: { quality: 2, long: 1 }, experienced: { quality: 3 } } });
  });

  test('исходный объект не меняется', () => {
    const raw = { norms: { rookie1: { quality: 2 } } };
    mergeConfig(raw, { norms: { rookie1: { quality: 5 } } });
    expect(raw).toEqual({ norms: { rookie1: { quality: 2 } } });
  });
});

describe('configPreview', () => {
  test('норма оплат меняет план, а с ним процент и монеты', () => {
    const p = configPreview(withSix(), { norms: { experienced: { payments: 0.5 } } });
    expect(p.changes).toEqual([{ group: 'СР1', before: { percent: 33, coins: 33, flakes: 0, keys: 0 }, after: { percent: 18, coins: 18, flakes: 0, keys: 0 } }]);
    expect(describeChange(p.changes[0]!)).toBe('СР1: план 33 % → 18 %; монеты 33 → 18');
  });

  test('ничего не меняется — список пуст', () => {
    expect(configPreview(withSix(), { norms: { rookie1: { quality: 3 } } }).changes).toEqual([]);
  });
});

describe('applyPatch / removeChange (клиентское зеркало записи сервера)', () => {
  const state = (config = {}, configChanges: Snapshot['configChanges'] = []) => ({ config, configChanges });

  test('на всю игру: сливает и вычёркивает свои поля из записей «с даты», опустевшие удаляются', () => {
    const s = state({ norms: { experienced: { quality: 4 } } }, [
      { from: '2026-12-07', config: { norms: { experienced: { quality: 2, long: 1 } } } },
      { from: '2026-12-14', config: { norms: { experienced: { quality: 3 } } } },
    ]);
    expect(applyPatch(s, { norms: { experienced: { quality: 5 } } })).toEqual({
      config: { norms: { experienced: { quality: 5 } } },
      configChanges: [{ from: '2026-12-07', config: { norms: { experienced: { long: 1 } } } }],
    });
  });

  test('с даты: сливает в запись этой даты или создаёт новую, по порядку дат', () => {
    const s = state({}, [{ from: '2026-12-14', config: { norms: { rookie1: { quality: 2 } } } }]);
    const next = applyPatch(s, { norms: { rookie1: { long: 1 } } }, '2026-12-07');
    expect(next.configChanges.map((c) => c.from)).toEqual(['2026-12-07', '2026-12-14']);
    expect(applyPatch(next, { norms: { rookie1: { quality: 3 } } }, '2026-12-14').configChanges[1]).toEqual({ from: '2026-12-14', config: { norms: { rookie1: { quality: 3 } } } });
  });

  test('удаление записи', () => {
    const s = state({}, [{ from: '2026-12-07', config: { norms: { rookie1: { quality: 2 } } } }]);
    expect(removeChange(s, '2026-12-07').configChanges).toEqual([]);
  });
});

describe('configPreview с датой', () => {
  const raise = { norms: { experienced: { payments: 0.5 } } };

  test('дата в будущем: future, но план на игру меняется уже сегодня', () => {
    expect(configPreview(withSix(), raise, '2026-12-21')).toMatchObject({ future: true, evaluatedDays: 0 });
    expect(configPreview(withSix(), raise, '2026-12-21').changes).toHaveLength(1);
  });

  test('воронка не загружена: оценённых дней нет', () => {
    expect(configPreview(withSix(), raise, '2026-12-01')).toMatchObject({ evaluatedDays: 0, evaluatedThrough: null });
  });

  test('снимок без поля configChanges (старый бэкенд) работает как с пустым списком', () => {
    const s = withSix();
    delete (s as Partial<Snapshot>).configChanges;
    expect(configPreview(s, raise, '2026-12-01').changes).toHaveLength(1);
  });
});

describe('removalPreview', () => {
  test('удаление записи «с даты» показывает возврат к базе', () => {
    const s = withSix({ configChanges: [{ from: '2026-12-01', config: raise() }] });
    expect(removalPreview(s, '2026-12-01').changes[0]).toMatchObject({ before: { percent: 18 }, after: { percent: 33 } });
    function raise() { return { norms: { experienced: { payments: 0.5 } } }; }
  });
});

describe('describeEntry', () => {
  test('с запятой, целые без «,0»', () => {
    expect(describeEntry({ from: '2026-12-09', config: { norms: { experienced: { quality: 2, long: 1.5 }, rookie1: { quality: 0.25 } } } }))
      .toBe('с 09.12.2026: Опытный — качественные 2, длинные 1,5; Новичок 1 — качественные 0,25');
  });
});

describe('describeChange', () => {
  test('только изменившееся', () => {
    const line = { percent: 40, coins: 12, flakes: 30, keys: 9 };
    expect(describeChange({ group: 'СР6', before: line, after: { ...line, flakes: 35, keys: 11 } })).toBe('СР6: снежинки 30 → 35; ключики 9 → 11');
  });
});
