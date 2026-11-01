import type { RaceResult } from './race';

// Place chips by race (1st..4th): gold for 1st, silver for 2nd. Bronze chips (stars etc.) are 1 each.
export const GOLD = [3, 4, 4, 5];
export const SILVER = [1, 2, 2, 3];

/** Points each player earns in one race. `raceIndex` is 0..3. */
export function scoreRace(result: RaceResult, raceIndex: number): Record<string, number> {
  const pts: Record<string, number> = {};
  const add = (owner: string, n: number) => { pts[owner] = (pts[owner] ?? 0) + n; };
  const [first, second] = result.places;
  if (first) add(first.owner, GOLD[raceIndex]);
  if (second) add(second.owner, SILVER[raceIndex]);
  for (const [owner, n] of Object.entries(result.bonus)) add(owner, n);
  return pts;
}
