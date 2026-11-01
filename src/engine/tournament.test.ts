import { expect, test } from 'vitest';
import { rng } from './dice';
import { playTournament, type TournamentAgent } from './tournament';
import { TIERS } from './tiers';

const bot = (r: () => number): Partial<TournamentAgent> => ({
  draft: (_p, o) => Math.floor(r() * o.length),
  pick: (_p, h) => Math.floor(r() * h.length),
  egg: (_p, o) => Math.floor(r() * o.length),
  twin: (_p, o) => Math.floor(r() * o.length),
  starter: (_p, c) => Math.floor(r() * c.length),
  race: (d) => (d.kind === 'predict' ? 1 + Math.floor(r() * 6) : d.kind === 'choose' || d.kind === 'choosePos' ? Math.floor(r() * d.options.length) : r() < 0.7),
});

for (const n of [2, 3, 4, 5, 6]) {
  test(`${n} players: 5-card common draft, 4 races, ranking and tiers`, async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const r = rng(seed);
      const players = Array.from({ length: n }, (_, i) => 'P' + i);
      const drafted: Record<string, string[]> = {};
      const res = await playTournament({
        players, rng: r, agent: { ...bot(r), draft: (p, o) => { (drafted[p] ??= []); return Math.floor(r() * o.length); } },
        onPole: () => undefined,
      });
      expect(res.races).toHaveLength(4);
      expect(res.ranking).toHaveLength(n);
      expect(res.ranking[0].pos).toBe(1);
      for (const p of players) expect(res.hands[p]).toHaveLength(1); // 5 drafted, 4 played, 1 left over
      for (const t of Object.values(res.tiers)) expect(TIERS).toContain(t);
      const sum = res.ranking.reduce((s, x) => s + x.p, 0);
      expect(sum).toBe(Object.values(res.totals).reduce((s, x) => s + x, 0));
    }
  });
}

test('the draft reveals N+1 cards per round, clockwise from a rotating start', async () => {
  const seen: { round: number; len: number; player: string }[] = [];
  const r = rng(3);
  await playTournament({ players: ['A', 'B', 'C'], rng: r, agent: { ...bot(r), draft: (p, o, round) => { seen.push({ round, len: o.length, player: p }); return 0; } } });
  expect(seen).toHaveLength(15);
  expect(seen.slice(0, 3).map((s) => s.len)).toEqual([4, 3, 2]);
  const firsts = [0, 3, 6, 9, 12].map((i) => seen[i].player);
  const idx = firsts.map((p) => 'ABC'.indexOf(p));
  for (let k = 1; k < 5; k++) expect(idx[k]).toBe((idx[k - 1] + 1) % 3);
});
