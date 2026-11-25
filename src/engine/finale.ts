import { groupRanking, type RankData } from './ranking';
import { GROUPS, type DateStr, type GroupCode } from './types';

export type NominationId = 'plan' | 'toys' | 'house' | 'long' | 'quality' | 'week' | 'team';

export interface FinaleInput {
  /** последний день, оплаты которого считаются */
  cutoff: DateStr;
  /** процент плана оплат по отсечку, дробный */
  percents: Record<GroupCode, number>;
  paid: number;
  gameCents: number;
  toys: Record<GroupCode, number>;
  things: Record<GroupCode, number>;
  qualityPercents: Record<GroupCode, number>;
  longPercents: Record<GroupCode, number>;
  /** лучший недельный процент группы */
  weekBest: Record<GroupCode, number>;
  treeFull: boolean;
  rank: RankData;
}

export interface FinaleResult {
  cutoff: DateStr;
  /** кто надевает звезду; точная ничья — вместе */
  winners: GroupCode[];
  percents: Record<GroupCode, number>;
  branch: { paid: number; percent: number; toys: number; treeFull: boolean };
  best: Record<GroupCode, { employeeIds: string[]; value: number }>;
  /** по одной на группу, без мест */
  nominations: { id: NominationId; title: string; groups: GroupCode[] }[];
}

const TITLE: Record<NominationId, string> = {
  plan: 'Лучший план',
  toys: 'Самая нарядная ёлка',
  house: 'Самый уютный домик',
  long: 'Короли презентаций',
  quality: 'Мастера счетов',
  week: 'Неделя года',
  team: 'Дружная команда',
};

/** Лучшие из групп по значению больше нуля; равенство — все равные. */
function leaders(values: Record<GroupCode, number>, among: readonly GroupCode[]): GroupCode[] {
  const best = Math.max(0, ...among.map((g) => values[g]));
  return best > 0 ? among.filter((g) => values[g] === best) : [];
}

export function finale(i: FinaleInput): FinaleResult {
  const best = {} as FinaleResult['best'];
  for (const g of GROUPS) {
    const top = groupRanking(g, i.rank.cfg.startDate, i.cutoff, i.rank).filter((r) => r.place === 1 && r.value > 0);
    best[g] = { employeeIds: top.map((r) => r.employeeId).sort(), value: top[0]?.value ?? 0 };
  }

  const nominations: FinaleResult['nominations'] = [];
  let left: GroupCode[] = [...GROUPS];
  const order: [NominationId, Record<GroupCode, number>][] = [
    ['plan', i.percents], ['toys', i.toys], ['house', i.things], ['long', i.longPercents], ['quality', i.qualityPercents], ['week', i.weekBest],
  ];
  for (const [id, values] of order) {
    const groups = leaders(values, left);
    if (!groups.length) continue;
    nominations.push({ id, title: TITLE[id], groups });
    left = left.filter((g) => !groups.includes(g));
  }
  if (left.length) nominations.push({ id: 'team', title: TITLE.team, groups: left });

  return {
    cutoff: i.cutoff,
    winners: leaders(i.percents, GROUPS),
    percents: i.percents,
    branch: {
      paid: i.paid,
      percent: i.gameCents > 0 ? (i.paid * 10_000) / i.gameCents : 0,
      toys: GROUPS.reduce((s, g) => s + i.toys[g], 0),
      treeFull: i.treeFull,
    },
    best, nominations,
  };
}
