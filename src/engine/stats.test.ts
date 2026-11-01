import { expect, test } from 'vitest';
import { beatsMost, favourites, losesMostTo, mostLosing, mostWinning, racerStats, rivals, type FullMatch } from './stats';

const m = (id: string, races: FullMatch['races'], players: [string, number, number][]): FullMatch => ({
  id, date: 1, races, players: players.map(([uid, p, pos]) => ({ uid, name: uid, p, pos })),
});
const hist: FullMatch[] = [
  m('a', [
    { track: 'mild', picks: { x: 'banana', y: 'gunk' }, first: 'x', firstChar: 'banana', second: 'y', secondChar: 'gunk' },
    { track: 'wild', picks: { x: 'banana', y: 'hare' }, first: 'y', firstChar: 'hare' },
    { track: 'mild', picks: { x: 'coach', y: 'hare' }, first: 'x', firstChar: 'coach', second: 'y', secondChar: 'hare' },
  ], [['x', 12, 1], ['y', 8, 2]]),
  m('b', [{ track: 'mild', picks: { x: 'banana', y: 'coach' }, first: 'y', firstChar: 'coach' }], [['x', 3, 2], ['y', 9, 1]]),
];

test('racer stats: played, 1st, 2nd and races without a podium', () => {
  const s = racerStats(hist, 'x');
  expect(s.find((r) => r.id === 'banana')).toEqual({ id: 'banana', played: 3, wins: 1, seconds: 0, none: 2 });
  expect(s.find((r) => r.id === 'coach')).toEqual({ id: 'coach', played: 1, wins: 1, seconds: 0, none: 0 });
});

test('favourites, most winning and most losing', () => {
  const s = racerStats(hist, 'x');
  expect(favourites(s)[0].id).toBe('banana');
  expect(mostWinning(s).map((r) => r.id)).toEqual(['coach', 'banana']); // equal wins: the better win rate first
  expect(mostLosing(s).map((r) => r.id)).toEqual(['banana']);
});

test('old history entries without race details are ignored', () => {
  expect(racerStats([{ id: 'o', date: 1, players: [{ uid: 'x', name: 'x', p: 1, pos: 1 }, { uid: 'y', name: 'y', p: 0, pos: 2 }] }], 'x')).toEqual([]);
});

test('rivals: who you beat and who beats you', () => {
  const r = rivals(hist, 'x');
  expect(r).toEqual([{ uid: 'y', name: 'y', wins: 1, losses: 1, draws: 0 }]);
  expect(beatsMost(r)[0].uid).toBe('y');
  expect(losesMostTo(r)[0].uid).toBe('y');
});
