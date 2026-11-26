import type { SnapshotConfig } from '@/data/api';
import type { Config } from '@/engine/config';
import { ruNum } from '@/engine/format';
import type { Level } from '@/engine/types';
import { ruDate } from './dom';

export interface ConfigForm {
  norms: Record<Level, { quality: string; long: string; payments: string }>;
}

export const LEVELS: readonly Level[] = ['experienced', 'rookie1', 'rookie2'];
export const LEVEL_TITLE: Record<Level, string> = { experienced: 'Опытный', rookie1: 'Новичок 1', rookie2: 'Новичок 2' };
export const NORM_FIELD_TITLE = { quality: 'качественные', long: 'длинные', payments: 'оплат в день' } as const;
export const NORM_FIELDS = ['quality', 'long', 'payments'] as const;

export function configFormOf(current: Config): ConfigForm {
  const norms = Object.fromEntries(LEVELS.map((l) => [
    l,
    { quality: ruNum(current.norms[l].quality), long: ruNum(current.norms[l].long), payments: ruNum(current.norms[l].payments) },
  ])) as ConfigForm['norms'];
  return { norms };
}

/** Не больше двух знаков после запятой или точки: так же проверяет сервер. */
const hundredths = (text: string): number | null => (/^\d+([.,]\d{1,2})?$/.test(text.trim()) ? Number(text.trim().replace(',', '.')) : null);

/**
 * Что отправить в `setConfig`: только изменённое. Что это число нужного вида, проверяется здесь, а диапазоны —
 * на сервере (его сообщение админ увидит как есть).
 */
export function configPatch(form: ConfigForm, current: Config, from?: string): SnapshotConfig | { error: string } {
  if (from !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < current.startDate || from > current.endDate)) {
    return { error: `Дата правки: выберите день игры, с ${ruDate(current.startDate)} по ${ruDate(current.endDate)}` };
  }
  const out: SnapshotConfig = {};

  const norms: NonNullable<SnapshotConfig['norms']> = {};
  for (const level of LEVELS) {
    for (const field of NORM_FIELDS) {
      const n = hundredths(form.norms[level][field]);
      if (n === null) return { error: `${LEVEL_TITLE[level]}, ${NORM_FIELD_TITLE[field]}: число, например 0,4 (не больше двух знаков после запятой)` };
      if (n !== current.norms[level][field]) norms[level] = { ...norms[level], [field]: n };
    }
  }
  if (Object.keys(norms).length) out.norms = norms;

  return Object.keys(out).length ? out : { error: 'Ничего не изменено' };
}
