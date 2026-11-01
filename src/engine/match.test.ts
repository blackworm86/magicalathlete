import { describe, expect, test } from 'vitest';
import { rng } from './dice';
import { draftLines, nextFirst, playMatch, rollOff, snake, type MatchAgent, type Variant } from './match';
import { Race } from './race';
import { MILD_MILE } from './tracks';

describe('draft', () => {
  test('snake order: last player picks twice in a row', () => {
    expect(snake(['A', 'B', 'C'])).toEqual(['A', 'B', 'C', 'C', 'B', 'A']);
  });
  test('standard: two snake drafts, second starts one seat later', () => {
    expect(draftLines(['A', 'B', 'C'], 0, 'standard').map((l) => l.join(''))).toEqual(['ABCCBA', 'BCAACB']);
  });
  test('two players: ABBAABBA then BAABBAAB', () => {
    expect(draftLines(['A', 'B'], 0, 'two-player').map((l) => l.join(''))).toEqual(['ABBAABBA', 'BAABBAAB']);
  });
  test('3-player double racer: 4 snakes, rotating the first drafter', () => {
    expect(draftLines(['A', 'B', 'C'], 0, 'double-racer').map((l) => l.join(''))).toEqual(['ABCCBA', 'BCAACB', 'CABBAC', 'ABCCBA']);
  });
});

test('roll-off picks one winner', () => {
  const r = rng(5);
  for (let i = 0; i < 50; i++) expect(rollOff(['A', 'B', 'C', 'D'], r)).toBeGreaterThanOrEqual(0);
});

test('next race starts with the owner of the farthest-behind racer (first eliminated wins the tie-break)', async () => {
  const seq = (...v: number[]) => { let i = 0; return () => v[i++] ?? 1; };
  const race = new Race({ track: MILD_MILE, dice: seq(6, 2, 6), entries: [{ owner: 'A', character: 'twin', pos: 24 }, { owner: 'B', character: 'twin', pos: 24 }, { owner: 'C', character: 'twin', pos: 3 }] });
  const res = await race.run();
  expect(nextFirst(['A', 'B', 'C'], res, {}, 'standard', rng(1))).toBe(2);
});

describe('whole matches', () => {
  const bot = (r: () => number): Partial<MatchAgent> => ({
    draft: (_p, o) => Math.floor(r() * o.length),
    pick: (_p, hand, count) => [...hand.keys()].sort(() => r() - 0.5).slice(0, count),
    egg: (_p, o) => Math.floor(r() * o.length),
    twin: (_p, o) => Math.floor(r() * o.length),
    race: (d) => (d.kind === 'predict' ? 1 + Math.floor(r() * 6) : d.kind === 'choose' || d.kind === 'choosePos' ? Math.floor(r() * d.options.length) : r() < 0.7),
  });
  const cases: [string[], Variant][] = [
    [['A', 'B'], 'two-player'], [['A', 'B', 'C'], 'standard'], [['A', 'B', 'C'], 'double-racer'],
    [['A', 'B', 'C', 'D'], 'standard'], [['A', 'B', 'C', 'D', 'E'], 'standard'], [['A', 'B', 'C', 'D', 'E', 'F'], 'standard'],
  ];
  for (const [players, variant] of cases) {
    test(`${players.length} players, ${variant}: plays 4 races and crowns a winner`, async () => {
      for (let seed = 1; seed <= 25; seed++) {
        const r = rng(seed);
        const res = await playMatch({ players, variant, rng: r, agent: bot(r) });
        expect(res.races).toHaveLength(4);
        expect(res.winners.length).toBeGreaterThan(0);
        for (const p of players) expect(res.totals[p]).toBeGreaterThanOrEqual(0);
        const placed = res.races.flatMap((x) => x.places.length);
        expect(Math.min(...placed)).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

test('Egg draws 3 new racers; Twin only offers past race winners', async () => {
  let eggOptions = 0, twinOptions = 0;
  for (let seed = 1; seed <= 200 && !(eggOptions && twinOptions); seed++) {
    const r = rng(seed);
    await playMatch({
      players: ['A', 'B', 'C'], rng: r,
      agent: {
        draft: (_p, o) => Math.max(0, o.findIndex((c) => c === 'egg' || c === 'twin')),
        pick: (_p, hand) => [Math.max(0, hand.findIndex((c) => c === 'egg' || c === 'twin'))],
        egg: (_p, o) => { eggOptions = o.length; return 0; },
        twin: (_p, o) => { twinOptions = o.length; return 0; },
      },
    });
  }
  expect(eggOptions).toBe(3);
  expect(twinOptions).toBeGreaterThan(0);
});
