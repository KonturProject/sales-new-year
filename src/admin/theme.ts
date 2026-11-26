import type { GroupCode } from '@/engine/types';

/** Цвет и маскот группы для админки и страницы РГ (цвета групп — сквозная константа свода). */
export const THEME: Record<GroupCode, { species: string; accent: string }> = {
  СР1: { species: 'Лев', accent: '#c0675d' },
  СР2: { species: 'Скрудж', accent: '#6f9a6a' },
  СР3: { species: 'Гринч', accent: '#c99c38' },
  СР5: { species: 'Йода', accent: '#555a6c' },
  СР6: { species: 'Знайка', accent: '#8b6fa3' },
  СР9: { species: 'Смурфетта', accent: '#5b86b8' },
};
