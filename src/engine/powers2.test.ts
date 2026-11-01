import { describe, expect, test } from 'vitest';
import type { CharacterId } from './characters';
import { Race, type Agent } from './race';
import { MILD_MILE } from './tracks';

const seq = (...rolls: number[]) => { let i = 0; return () => rolls[i++] ?? 1; };
type E = [string, CharacterId, number?, CharacterId[]?];
const mk = (entries: E[], dice: () => number, agent?: Agent) =>
  new Race({ track: MILD_MILE, dice, agent, entries: entries.map(([owner, character, pos, extra]) => ({ owner, character, pos, extra })) });

describe('Huge Baby', () => {
  test('a racer landing on its space is put one space behind', async () => {
    const r = mk([['A', 'twin', 0], ['B', 'huge_baby', 4]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(3);
  });
  test('Huge Baby landing on a racer pushes them behind; passing Banana still trips the baby', async () => {
    const r = mk([['B', 'huge_baby', 0], ['N', 'banana', 3]], seq(3));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(2);
    expect(r.racers[0].pos).toBe(3);
    expect(r.racers[0].tripped).toBe(true);
  });
  test('Baba Yaga cannot trip it, M.O.U.T.H. cannot eat it', async () => {
    const a = mk([['Y', 'baba_yaga', 0], ['B', 'huge_baby', 4]], seq(4));
    await a.takeTurn(a.racers[0]);
    expect(a.racers[1].tripped).toBe(false);
    const b = mk([['M', 'mouth', 0], ['B', 'huge_baby', 4]], seq(4));
    await b.takeTurn(b.racers[0]);
    expect(b.racers[1].eliminated).toBe(false);
  });
});

describe('Stickler', () => {
  test('others cross the finish only by the exact amount', async () => {
    const r = mk([['A', 'twin', 28], ['S', 'stickler', 0]], seq(3, 2));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(28);
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].finished).toBe(true);
  });
  test('a duel won on the last space before the finish does not cross', async () => {
    const r = mk([['X', 'twin', 26], ['D', 'duelist', 29], ['S', 'stickler', 0]], seq(3, 6, 1));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(29);
    expect(r.racers[1].finished).toBe(false);
  });
});

describe('Duelist', () => {
  test('wins ties and moves 2', async () => {
    const r = mk([['D', 'duelist', 0], ['X', 'twin', 3]], seq(3, 2, 2));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(5);
  });
  test('loser of the roll lets the other racer move 2', async () => {
    const r = mk([['D', 'duelist', 0], ['X', 'twin', 3]], seq(3, 1, 5));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(5);
    expect(r.racers[0].pos).toBe(3);
  });
});

describe('predictions', () => {
  test('Genius predicting the roll takes an extra turn', async () => {
    const r = mk([['G', 'genius', 0], ['X', 'twin', 0]], seq(4), (d) => (d.kind === 'predict' ? 4 : true));
    await r.takeTurn(r.racers[0]);
    expect(r.forcedNext?.owner).toBe('G');
    const w = mk([['G', 'genius', 0], ['X', 'twin', 0]], seq(3), (d) => (d.kind === 'predict' ? 4 : true));
    await w.takeTurn(w.racers[0]);
    expect(w.forcedNext).toBeNull();
  });
  test('Mastermind predicting the winner ends the race and takes 2nd', async () => {
    const r = mk([['M', 'mastermind', 0], ['X', 'twin', 28], ['Y', 'twin', 5]], seq(1, 3), (d) => (d.kind === 'choose' ? 1 : true));
    const res = await r.run();
    expect(res.places.map((p) => p.owner)).toEqual(['X', 'M']);
  });
  test('Mastermind predicting itself can win 1st and 2nd', async () => {
    const r = mk([['M', 'mastermind', 28], ['X', 'twin', 5]], seq(3), (d) => (d.kind === 'choose' ? 0 : true));
    const res = await r.run();
    expect(res.places.map((p) => p.owner)).toEqual(['M', 'M']);
  });
});

describe('warps', () => {
  test('Flip Flop swaps instead of rolling', async () => {
    const r = mk([['F', 'flip_flop', 3], ['X', 'twin', 9]], seq(6), (d) => (d.kind === 'choose' ? 0 : true));
    await r.takeTurn(r.racers[0]);
    expect([r.racers[0].pos, r.racers[1].pos]).toEqual([9, 3]);
  });
  test('Hypnotist warps a racer to its space, but Baba Yaga still trips the Hypnotist', async () => {
    const r = mk([['H', 'hypnotist', 5], ['B', 'baba_yaga', 8]], seq(1));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(5);
    expect(r.racers[0].tripped).toBe(true);
  });
  test('Third Wheel warps to a space with exactly 2 racers, then still moves', async () => {
    const r = mk([['T', 'third_wheel', 0], ['X', 'twin', 7], ['Y', 'twin', 7]], seq(2));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(9);
  });
});

describe('Rocket Scientist / Sisyphus', () => {
  test('Rocket Scientist doubles the roll and trips', async () => {
    const r = mk([['R', 'rocket_scientist', 0]], seq(3));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(6);
    expect(r.racers[0].tripped).toBe(true);
  });
  test('Rocket Scientist: Gunk shrinks the doubled move', async () => {
    const r = mk([['R', 'rocket_scientist', 0], ['G', 'gunk', 10]], seq(3));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(5);
  });
  test('Sisyphus takes 4 chips, loses 1 and warps to Start on a 6', async () => {
    const r = mk([['S', 'sisyphus', 0], ['X', 'twin', 28]], seq(6, 2));
    const res = await r.run();
    expect(r.racers[0].pos).toBe(0);
    expect(res.bonus.S).toBe(3);
  });
});

describe('Suckerfish / Copy Cat / borrowed powers', () => {
  test('Suckerfish rides along', async () => {
    const r = mk([['X', 'twin', 0], ['F', 'suckerfish', 0]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect([r.racers[0].pos, r.racers[1].pos]).toEqual([4, 4]);
  });
  test('Copy Cat copies the lead racer: with Gunk, everyone else gets -2', async () => {
    const r = mk([['X', 'twin', 0], ['G', 'gunk', 10], ['C', 'copy_cat', 0]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(2);
  });
  test('borrowed powers (Egg / Twin) work like own powers', async () => {
    const r = mk([['X', 'twin', 0], ['T', 'twin', 10, ['gunk']]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(3);
  });
});

describe('site rulings', () => {
  test('Party Animal arrivals are simultaneous: Romantic does not trigger', async () => {
    const r = mk([['P', 'party_animal', 10], ['X', 'twin', 9], ['R', 'romantic', 20]], seq(1));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(10);
    expect(r.racers[2].pos).toBe(19);
  });
  test('Scoocher moves 1 per -1 from Gunk', async () => {
    const r = mk([['X', 'twin', 0], ['G', 'gunk', 10], ['S', 'scoocher', 3]], seq(4));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[2].pos).toBe(4);
  });
  test('Scoocher moves once per space Leaptoad skips', async () => {
    const r = mk([['L', 'leaptoad', 0], ['X', 'twin', 1], ['Y', 'twin', 2], ['S', 'scoocher', 20]], seq(3));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[0].pos).toBe(5);
    expect(r.racers[3].pos).toBe(22);
  });
  test('Centaur passing Banana: Banana goes back 2 and still trips Centaur', async () => {
    const r = mk([['C', 'centaur', 0], ['B', 'banana', 3]], seq(5));
    await r.takeTurn(r.racers[0]);
    expect(r.racers[1].pos).toBe(1);
    expect(r.racers[0].tripped).toBe(true);
  });
});
