// S.K.U.L.O. - the rating used for ranked games (same maths as the tournament site's Elo).
// Each tournament counts as pairwise matches between all players: more points wins (1), equal points
// draw (0.5), otherwise the better final position wins. Change = K/(N-1) * sum(result - expected);
// start 1500, K 24, doubled during a player's first 3 tournaments. Computed in date order over the history.
export const ELO = { start: 1500, k: 24, prov: 3 };

export interface HistPlayer { uid: string; name: string; team?: string; p: number; pos: number; rw?: number; bz?: number }
export interface HistMatch { id: string; date: number; players: HistPlayer[]; rules?: string }
export interface EloChange { b: number; a: number; d: number }
export interface EloResult {
  ratings: Record<string, { name: string; r: number; n: number }>;
  per: Record<string, Record<string, EloChange>>; // match id -> uid -> change
  series: Record<string, { t: number; date: number; r: number; d: number }[]>;
  list: HistMatch[];
}

export function computeElo(hist: HistMatch[]): EloResult {
  const R: EloResult['ratings'] = {}, per: EloResult['per'] = {}, series: EloResult['series'] = {};
  const list = hist.filter((h) => h?.players?.length > 1).slice().sort((a, b) => (a.date || 0) - (b.date || 0));
  list.forEach((h, ti) => {
    const ps = h.players.map((p) => {
      R[p.uid] ??= { name: p.name, r: ELO.start, n: 0 };
      R[p.uid].name = p.name;
      return { uid: p.uid, p: +p.p || 0, pos: +p.pos || 0 };
    });
    const n = ps.length;
    const d = ps.map((a) => {
      let s = 0;
      for (const b of ps) {
        if (a === b) continue;
        const ex = 1 / (1 + Math.pow(10, (R[b.uid].r - R[a.uid].r) / 400));
        const res = a.p === b.p ? 0.5 : a.pos && b.pos ? (a.pos < b.pos ? 1 : 0) : a.p > b.p ? 1 : 0;
        s += res - ex;
      }
      return ((ELO.k * (R[a.uid].n < ELO.prov ? 2 : 1)) / (n - 1)) * s;
    });
    per[h.id] = {};
    ps.forEach((a, q) => {
      const b0 = R[a.uid].r;
      R[a.uid].r = b0 + d[q];
      R[a.uid].n++;
      const ch = { b: Math.round(b0), a: Math.round(R[a.uid].r), d: Math.round(R[a.uid].r) - Math.round(b0) };
      per[h.id][a.uid] = ch;
      (series[a.uid] ??= []).push({ t: ti, date: h.date, r: ch.a, d: ch.d });
    });
  });
  for (const k of Object.keys(R)) R[k].r = Math.round(R[k].r);
  return { ratings: R, per, series, list };
}

export interface PlayerStats { matches: number; wins: number; podiums: number; avgPoints: number; best: number; winRate: number | null; raceWins: number }
export function playerStats(hist: HistMatch[], uid: string): PlayerStats {
  let matches = 0, wins = 0, podiums = 0, pts = 0, best = 0, rw = 0;
  for (const h of hist) {
    const p = h.players?.find((x) => x.uid === uid);
    if (!p) continue;
    matches++; pts += p.p || 0; best = Math.max(best, p.p || 0); rw += p.rw || 0;
    if (p.pos === 1) wins++;
    if (p.pos <= 3) podiums++;
  }
  return { matches, wins, podiums, avgPoints: matches ? Math.round((pts / matches) * 10) / 10 : 0, best, winRate: matches ? Math.round((wins / matches) * 100) : null, raceWins: rw };
}
