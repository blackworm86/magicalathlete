import { expect, test } from 'vitest';
import { computeElo, playerStats, type HistMatch } from './elo';

const m = (id: string, date: number, rows: [string, number, number][]): HistMatch => ({ id, date, players: rows.map(([uid, p, pos]) => ({ uid, name: uid, p, pos })) });

test('winner gains, loser loses, symmetric for two equal players (K doubled while provisional)', () => {
  const e = computeElo([m('a', 1, [['x', 10, 1], ['y', 5, 2]])]);
  expect(e.ratings.x.r).toBe(1524);
  expect(e.ratings.y.r).toBe(1476);
  expect(e.per.a.x).toEqual({ b: 1500, a: 1524, d: 24 });
});

test('equal points is a draw', () => {
  const e = computeElo([m('a', 1, [['x', 8, 1], ['y', 8, 2]])]);
  expect(e.ratings.x.r).toBe(1500);
});

test('ratings sum stays constant and matches are applied in date order', () => {
  const e = computeElo([m('b', 2, [['x', 3, 3], ['y', 9, 1], ['z', 6, 2]]), m('a', 1, [['x', 9, 1], ['y', 6, 2], ['z', 3, 3]])]);
  const sum = Object.values(e.ratings).reduce((s, r) => s + r.r, 0);
  expect(Math.abs(sum - 4500)).toBeLessThanOrEqual(2);
  expect(e.list.map((h) => h.id)).toEqual(['a', 'b']);
  expect(e.series.x).toHaveLength(2);
});

test('player stats', () => {
  const s = playerStats([m('a', 1, [['x', 9, 1], ['y', 3, 2]]), m('b', 2, [['x', 4, 2], ['y', 8, 1]])], 'x');
  expect(s).toMatchObject({ matches: 2, wins: 1, podiums: 2, best: 9, winRate: 50 });
});
