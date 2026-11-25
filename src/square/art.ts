import type { GroupCode } from '@/engine/types';

/** Все картинки площади. Собирает их `tools/pack.py`; код знает только эти пути. */
export const ART = {
  plaza: 'assets/plaza.jpg',
  tree: 'assets/tree.webp',
  toys: { image: 'assets/toys.webp', frames: 'assets/toys.json' },
  things: { image: 'assets/things.webp', frames: 'assets/things.json' },
  lead: 'assets/lead.webp',
  mascots: {
    СР1: 'assets/mascot-sr1.webp', СР2: 'assets/mascot-sr2.webp', СР3: 'assets/mascot-sr3.webp',
    СР5: 'assets/mascot-sr5.webp', СР6: 'assets/mascot-sr6.webp', СР9: 'assets/mascot-sr9.webp',
  } satisfies Record<GroupCode, string>,
} as const;

/** Клетка листа фигур: 4 в ряд, ноги на линии 376. */
export const CELL = { w: 288, h: 384, foot: 376, tall: 322 } as const;

/** Кадры листа маскота; у Гринча дальше идут его проделки. */
export const POSE = { run: [0, 1, 2, 3], stand: 4, box: 5, reach: 6, joy: 7 } as const;
export const GRINCH_POSE = { sneak: [8, 9], sack: 10, sorry: 11, sackStand: 12, crank: 13, blaster: 14, giggle: 15 } as const;
export const LEAD_POSE = { stand: 0, wave: 1, give: 2, joy: 3 } as const;

export const iconPath = (art: string) => `assets/icons/${art}.webp`;

export const artPaths = (): string[] => [
  ART.plaza, ART.tree, ART.toys.image, ART.toys.frames, ART.things.image, ART.things.frames, ART.lead, ...Object.values(ART.mascots),
];
