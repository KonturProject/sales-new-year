import { describe, expect, test } from 'vitest';
import { defaultConfig as current } from '@/engine/config';
import { configFormOf, configPatch, type ConfigForm } from './configForm';


const patch = (over: Partial<ConfigForm> = {}) => configPatch({ ...configFormOf(current), ...over }, current);

describe('configFormOf', () => {

  test('дробные нормы — с запятой, целые без «,0»', () => {
    const cfg = { ...current, norms: { ...current.norms, rookie1: { quality: 1.5, long: 0.25, payments: 2 } } };
    expect(configFormOf(cfg).norms.rookie1).toEqual({ quality: '1,5', long: '0,25', payments: '2' });
  });
});

describe('configPatch с датой', () => {
  const at = (from: string, over: Partial<ConfigForm> = {}) => configPatch({ ...configFormOf(current), ...over }, current, from);




  test('ничего не изменилось относительно значений на дату — ошибка, а не пустой запрос', () => {
    expect(at('2026-12-08')).toEqual({ error: 'Ничего не изменено' });
  });
});

describe('configPatch', () => {
  test('ничего не менялось — ошибка, а не пустой запрос', () => {
    expect(patch()).toEqual({ error: 'Ничего не изменено' });
  });


  test('нормы: только изменённые поля изменённых уровней', () => {
    const form = configFormOf(current);
    expect(patch({ norms: { ...form.norms, experienced: { ...form.norms.experienced, quality: '1' } } })).toEqual({
      norms: { experienced: { quality: 1 } },
    });
    expect(patch({
      norms: { ...form.norms, rookie1: { ...form.norms.rookie1, long: '2' }, rookie2: { ...form.norms.rookie2, quality: '3' } },
    })).toEqual({ norms: { rookie1: { long: 2 }, rookie2: { quality: 3 } } });
  });

  test('норма оплат в день: запятая или точка, до двух знаков', () => {
    const form = configFormOf(current);
    const pays = (text: string) => patch({ norms: { ...form.norms, experienced: { ...form.norms.experienced, payments: text } } });
    expect(pays('0,5')).toEqual({ norms: { experienced: { payments: 0.5 } } });
    expect(pays(' 0.57 ')).toEqual({ norms: { experienced: { payments: 0.57 } } });
    expect(pays('2')).toEqual({ norms: { experienced: { payments: 2 } } });
    expect(pays('0.27')).toEqual({ error: 'Ничего не изменено' });
    for (const bad of ['', 'x', '0,123', '-1', '1,2,3']) {
      expect(pays(bad), bad).toMatchObject({ error: expect.stringContaining('Опытный, оплат в день') });
    }
  });

  test('качественные и длинные: «1,5» и «0.25» принимаются, как оплаты', () => {
    const form = configFormOf(current);
    const norm = (f: 'quality' | 'long', text: string) =>
      patch({ norms: { ...form.norms, rookie2: { ...form.norms.rookie2, [f]: text } } });
    expect(norm('long', '1,5')).toEqual({ norms: { rookie2: { long: 1.5 } } });
    expect(norm('quality', ' 0.25 ')).toEqual({ norms: { rookie2: { quality: 0.25 } } });
    expect(norm('quality', '2')).toEqual({ error: 'Ничего не изменено' });
    for (const [f, title] of [['quality', 'качественные'], ['long', 'длинные']] as const) {
      for (const bad of ['1,555', '', 'x', '-1', '1,2,3']) {
        expect(norm(f, bad), `${f} ${bad}`).toMatchObject({ error: expect.stringContaining(`Новичок 2, ${title}`) });
      }
    }
  });




});
