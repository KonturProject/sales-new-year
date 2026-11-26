import type { GrinchSettings, GrinchState } from '@/engine/grinch';

/** Как `QUIET_MIN` и `QUIET_MAX` в `Code.gs`. */
export const QUIET_MIN = 30;
export const QUIET_MAX = 480;

/** «Тишина, минут»: целое от 30 до 480. */
export function quietError(raw: string): string | null {
  const t = raw.trim();
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  return n >= QUIET_MIN && n <= QUIET_MAX ? null : `Тишина: целое число минут от ${QUIET_MIN} до ${QUIET_MAX}`;
}

/** Что Гринч делает сейчас, для админа. */
export function grinchLines(st: GrinchState, settings: GrinchSettings): string[] {
  if (st.asleep) return ['Гринч спит: не рабочее время'];
  const parts: string[] = [];
  if (st.stolen.length) parts.push(`украдено игрушек: ${st.stolen.length}`);
  if (st.garlandOff !== null) parts.push(`погашена гирлянда яруса ${st.garlandOff}`);
  const pranks = parts.length ? parts.join(' · ') : 'пакостей нет';
  return [
    `Сам по себе: ${settings.auto ? 'да' : 'нет (только по кнопкам)'}, тишина ${settings.quietMin} мин`,
    `Тишина по филиалу с ${st.since.slice(11, 16)}`,
    pranks[0]!.toUpperCase() + pranks.slice(1),
  ];
}
