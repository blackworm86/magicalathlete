import { describe, expect, test } from 'vitest';
import type { CharacterId } from './characters';
import { Race, type Agent } from './race';
import { MILD_MILE, WILD_WILDS, type Track } from './tracks';

const seq = (...rolls: number[]) => { let i = 0; return () => rolls[i++] ?? 1; };
type E = [string, CharacterId, number?];
const mk = (entries: E[], dice: () => number, track: Track = MILD_MILE, agent?: Agent) =>
  new Race({ track, dice, agent, entries: entries.map(([owner, character, pos]) => ({ owner, character, pos })) });

describe('arrows come before the powers that react to the stop', () => {
  test('Baba Yaga still trips a racer that stopped on her arrow space, after the arrow moved it', async () => {
    const r = mk([['X', 'twin', 4], ['B', 'baba_yaga', 7]], seq(3), WILD_WILDS);
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(10); // 4 -> 7 (arrow +3) -> 10
    expect(r.racers[0].tripped).toBe(true);
    const arrow = r.events.findIndex((e) => e.t === 'move' && e.kind === 'arrow');
    const trip = r.events.findIndex((e) => e.t === 'trip');
    expect(arrow).toBeGreaterThan(-1);
    expect(trip).toBeGreaterThan(arrow);
  });
  test('M.O.U.T.H. that stops on an arrow space still eats the racer waiting there', async () => {
    const r = mk([['M', 'mouth', 4], ['Y', 'twin', 7]], seq(3), WILD_WILDS);
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].eliminated).toBe(true);
    expect(r.racers[0].pos).toBe(10);
  });
});

describe('Copy Cat', () => {
  const pickIdx = (i: number): Agent => (d) => (d.kind === 'choose' ? i : true);
  test('its player picks whom to copy when the lead is tied', async () => {
    // Gunk and Hare share the lead; Gunk (real) always gives Copy Cat -1
    const a = mk([['C', 'copy_cat', 0], ['G', 'gunk', 10], ['H', 'hare', 10]], seq(3), MILD_MILE, pickIdx(0));
    await a.takeTurn(a.racers[0]);
    expect(a.racers[0].pos).toBe(2); // copies Gunk: 3 - 1
    const b = mk([['C', 'copy_cat', 0], ['G', 'gunk', 10], ['H', 'hare', 10]], seq(3), MILD_MILE, pickIdx(1));
    await b.takeTurn(b.racers[0]);
    expect(b.racers[0].pos).toBe(4); // copies Hare: 3 + 2 - 1
  });
  test('follows the lead when it changes', async () => {
    const r = mk([['C', 'copy_cat', 0], ['G', 'gunk', 10], ['X', 'twin', 2]], seq(4, 6));
    await r.takeTurn(r.racers[2]); // X: 4 - 1 (Gunk) - 1 (Copy Cat copying Gunk) = 2 -> 4
    expect(r.racers[2].pos).toBe(4);
    r.racers[2].pos = 20; // X takes the lead: Copy Cat now has a power-less racer's power
    await r.takeTurn(r.racers[2]);
    expect(r.racers[2].pos).toBe(25); // 6 - 1 (real Gunk) only
  });
});

describe('Suckerfish and Sisyphus', () => {
  test('a Suckerfish riding along makes Scoocher move (its power happened)', async () => {
    const r = mk([['X', 'twin', 0], ['F', 'suckerfish', 0], ['S', 'scoocher', 20]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect([r.racers[0].pos, r.racers[1].pos]).toEqual([4, 4]);
    expect(r.racers[2].pos).toBe(21);
  });
  test('Sisyphus rolling 6 over and over can end the race below the chips it took', async () => {
    const r = mk([['S', 'sisyphus', 0], ['X', 'twin', 0]], seq(6, 1, 6, 1, 6, 1, 6, 1, 6, 1));
    r.giveChips('S', 4); // what happens before the race
    for (let i = 0; i < 5; i++) { await r.takeTurn(r.racers[0]); await r.takeTurn(r.racers[1]); }
    expect(r.bonus.S).toBe(-1); // 4 - 5: the match clamps a player's total at 0
    expect(r.racers[0].pos).toBe(0);
  });
});
