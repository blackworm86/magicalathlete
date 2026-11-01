// Both base-game tracks (read from the physical board). Space 0 = START, spaces 1..29 are
// racing squares, `finish` (30) is the finish line: reaching it means crossing it.
export type Color = 'p' | 'y' | 'g' | 'b' | 'r'; // pink yellow green blue red
export type Space =
  | { type: 'start' | 'plain'; color: Color }
  | { type: 'star'; amount: number }
  | { type: 'trip' }
  // amount > 0 = forward along the track, < 0 = backward
  | { type: 'arrow'; amount: number };

export interface Track {
  id: 'mild' | 'wild';
  name: string;
  finish: number;
  corners: [number, number]; // the two corner spaces (top-right, bottom-right)
  spaces: Space[];
}

const CYCLE: Color[] = ['p', 'y', 'g', 'b', 'r'];
const FINISH = 30;

function build(id: Track['id'], name: string, special: Record<number, Space>): Track {
  const spaces: Space[] = [{ type: 'start', color: 'b' }];
  for (let i = 1; i < FINISH; i++) spaces.push(special[i] ?? { type: 'plain', color: CYCLE[(i - 1) % 5] });
  return { id, name, finish: FINISH, corners: [12, 15], spaces };
}

export const MILD_MILE = build('mild', 'Mild Mile', {});

export const WILD_WILDS = build('wild', 'Wild Wilds', {
  1: { type: 'star', amount: 1 },
  5: { type: 'trip' },
  7: { type: 'arrow', amount: 3 },
  11: { type: 'arrow', amount: 1 },
  13: { type: 'star', amount: 1 },
  16: { type: 'arrow', amount: -4 },
  17: { type: 'trip' },
  23: { type: 'arrow', amount: 2 },
  24: { type: 'arrow', amount: -2 },
  26: { type: 'trip' },
});

// Race schedule of the base game: Mild, Wild, Mild, Wild.
export const BASE_SCHEDULE: Track[] = [MILD_MILE, WILD_WILDS, MILD_MILE, WILD_WILDS];
