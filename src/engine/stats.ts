import type { CharacterId } from './characters';
import type { HistMatch } from './elo';

// What the dashboard shows besides the rating: which racers a player used and how they did, and who they beat.

/** One race of a tournament as stored in the history. */
export interface RaceRec { track: string; picks: Record<string, CharacterId>; first?: string; firstChar?: CharacterId; second?: string; secondChar?: CharacterId }
export type FullMatch = HistMatch & { races?: RaceRec[] };

export interface RacerStat { id: CharacterId; played: number; wins: number; seconds: number; none: number }

/** For each racer this player used: races played, 1st places, 2nd places and races without a podium. */
export function racerStats(hist: FullMatch[], uid: string): RacerStat[] {
  const by = new Map<CharacterId, RacerStat>();
  for (const m of hist) for (const r of m.races ?? []) {
    const c = r.picks?.[uid];
    if (!c) continue;
    const s = by.get(c) ?? { id: c, played: 0, wins: 0, seconds: 0, none: 0 };
    s.played++;
    if (r.first === uid) s.wins++; else if (r.second === uid) s.seconds++; else s.none++;
    by.set(c, s);
  }
  return [...by.values()];
}

export const favourites = (s: RacerStat[], n = 5) => [...s].sort((a, b) => b.played - a.played || b.wins - a.wins).slice(0, n);
export const mostWinning = (s: RacerStat[], n = 5) => s.filter((x) => x.wins > 0).sort((a, b) => b.wins - a.wins || b.wins / b.played - a.wins / a.played).slice(0, n);
export const mostLosing = (s: RacerStat[], n = 5) => s.filter((x) => x.none > 0).sort((a, b) => b.none - a.none || b.none / b.played - a.none / a.played).slice(0, n);

export interface Rival { uid: string; name: string; wins: number; losses: number; draws: number }
/** Tournaments against each other player: ahead of them (wins), behind (losses) or level (draws). */
export function rivals(hist: FullMatch[], uid: string): Rival[] {
  const by = new Map<string, Rival>();
  for (const m of hist) {
    const me = m.players?.find((p) => p.uid === uid);
    if (!me) continue;
    for (const o of m.players) {
      if (o.uid === uid) continue;
      const r = by.get(o.uid) ?? { uid: o.uid, name: o.name, wins: 0, losses: 0, draws: 0 };
      r.name = o.name;
      if (me.p === o.p) r.draws++; else if (me.pos && o.pos ? me.pos < o.pos : me.p > o.p) r.wins++; else r.losses++;
      by.set(o.uid, r);
    }
  }
  return [...by.values()];
}
export const beatsMost = (r: Rival[], n = 3) => r.filter((x) => x.wins > 0).sort((a, b) => b.wins - a.wins).slice(0, n);
export const losesMostTo = (r: Rival[], n = 3) => r.filter((x) => x.losses > 0).sort((a, b) => b.losses - a.losses).slice(0, n);
