import { describe, expect, test } from 'vitest';
import type { CharacterId } from './characters';
import { scoreRace } from './match';
import { Race } from './race';
import { MILD_MILE, WILD_WILDS, type Track } from './tracks';

// Deterministic dice: returns the given rolls in order, then 1s.
const seq = (...rolls: number[]) => { let i = 0; return () => rolls[i++] ?? 1; };
const mk = (entries: [string, CharacterId, number?][], dice: () => number, track: Track = MILD_MILE, agent?: () => boolean) =>
  new Race({ track, dice, agent, entries: entries.map(([owner, character, pos]) => ({ owner, character, pos })) });

describe('core rules', () => {
  test('first two across the line take 1st and 2nd; race ends immediately', async () => {
    // plain characters are not implemented => no powers; use Leaptoad-free neutral "twin" (no hooks)
    const race = mk([['A', 'twin', 25], ['B', 'twin', 25], ['C', 'twin', 10]], seq(6, 6, 6));
    const res = await race.run();
    expect(res.places.map((r) => r.owner)).toEqual(['A', 'B']);
    expect(race.racers[2].pos).toBe(10); // C never moved: race ended on B's finish
  });

  test('tripping skips the next main move without rolling', async () => {
    const race = mk([['A', 'twin', 0], ['B', 'twin', 0]], seq(5, 2, 3, 4), WILD_WILDS);
    await race.takeTurn(race.racers[0]); // A rolls 5 -> TRIP space
    expect(race.racers[0].pos).toBe(5);
    expect(race.racers[0].tripped).toBe(true);
    await race.takeTurn(race.racers[0]); // recovers, no die consumed
    expect(race.racers[0].tripped).toBe(false);
    expect(race.racers[0].pos).toBe(5);
    await race.takeTurn(race.racers[1]); // B gets the 2 (proves A did not use a die)
    expect(race.racers[1].pos).toBe(2);
  });

  test('star gives a bronze chip; arrow is a separate move', async () => {
    const race = mk([['A', 'twin', 0]], seq(1, 6), WILD_WILDS);
    await race.takeTurn(race.racers[0]);
    expect(race.bonus.A).toBe(1); // space 1 star
    await race.takeTurn(race.racers[0]); // 1 + 6 = 7 (+3 arrow) -> 10
    expect(race.racers[0].pos).toBe(10);
  });

  test('scoring: gold/silver per race plus bronze chips', async () => {
    const race = mk([['A', 'twin', 29], ['B', 'twin', 28]], seq(1, 6));
    const res = await race.run();
    expect(scoreRace(res, 0)).toEqual({ A: 3, B: 1 });
    expect(scoreRace(res, 3)).toEqual({ A: 5, B: 3 });
  });
});

describe('powers', () => {
  test('rulebook example: Romantic / Scoocher / Banana', async () => {
    const race = mk([['R', 'romantic', 0], ['S', 'scoocher', 3], ['B', 'banana', 4]], seq(5));
    await race.takeTurn(race.racers[0]);
    const [r, s, b] = race.racers;
    expect(r.tripped).toBe(true); // Banana tripped the Romantic
    expect(b.pos).toBe(4);
    expect(r.pos).toBe(7); // 5, then Romantic power: +2 (even though tripped)
    expect(s.pos).toBe(5); // 3 -> 4 (Banana power) -> 5 (Romantic power)
  });

  test('Centaur hoofwhack cannot go below Start', async () => {
    const race = mk([['C', 'centaur', 0], ['X', 'twin', 1], ['Y', 'twin', 5]], seq(6));
    await race.takeTurn(race.racers[0]);
    expect(race.racers[1].pos).toBe(0);
    expect(race.racers[2].pos).toBe(3);
  });

  test('Gunk -1, Coach +1 (and self), Hare +2', async () => {
    const g = mk([['G', 'gunk', 0], ['X', 'twin', 0]], seq(4, 4));
    await g.takeTurn(g.racers[1]);
    expect(g.racers[1].pos).toBe(3);
    const c = mk([['C', 'coach', 0], ['X', 'twin', 0]], seq(3, 3));
    await c.takeTurn(c.racers[0]);
    expect(c.racers[0].pos).toBe(4);
    await c.takeTurn(c.racers[1]); // X is on Coach's old space? no: C moved away
    expect(c.racers[1].pos).toBe(3);
    const h = mk([['H', 'hare', 0], ['X', 'twin', 5]], seq(3));
    await h.takeTurn(h.racers[0]);
    expect(h.racers[0].pos).toBe(5);
  });

  test('Hare skips its main move when starting alone in the lead', async () => {
    const h = mk([['H', 'hare', 9], ['X', 'twin', 5]], seq(6));
    await h.takeTurn(h.racers[0]);
    expect(h.racers[0].pos).toBe(9);
  });

  test('Lackey moves 2 when another racer rolls a 6 (before their move)', async () => {
    const l = mk([['X', 'twin', 0], ['L', 'lackey', 0]], seq(6));
    await l.takeTurn(l.racers[0]);
    expect(l.racers[1].pos).toBe(2);
    expect(l.racers[0].pos).toBe(6);
  });

  test('M.O.U.T.H. eliminates the single racer on its space; last racer ends the race', async () => {
    const race = mk([['M', 'mouth', 0], ['X', 'twin', 3]], seq(3));
    const res = await race.run();
    expect(race.racers[1].eliminated).toBe(true);
    expect(res.places[0].owner).toBe('M');
  });

  test('Blimp: +3 before the second corner, -1 after', async () => {
    const a = mk([['B', 'blimp', 0]], seq(2));
    await a.takeTurn(a.racers[0]);
    expect(a.racers[0].pos).toBe(5);
    const b = mk([['B', 'blimp', 15]], seq(4));
    await b.takeTurn(b.racers[0]);
    expect(b.racers[0].pos).toBe(18);
  });

  test('Leaptoad skips occupied spaces', async () => {
    const race = mk([['L', 'leaptoad', 0], ['X', 'twin', 2], ['Y', 'twin', 3]], seq(3));
    await race.takeTurn(race.racers[0]);
    expect(race.racers[0].pos).toBe(5); // 1, (skip 2,3) 4, 5
  });

  test('Skipper steals the next turn when anyone rolls a 1', async () => {
    const race = mk([['A', 'twin', 0], ['B', 'twin', 0], ['S', 'skipper', 0]], seq(1, 4, 4));
    await race.takeTurn(race.racers[0]);
    expect(race.forcedNext?.owner).toBe('S');
  });
});
