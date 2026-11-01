import { CHARACTERS, type CharacterId } from './characters';
import { scoreRace, shuffle, type RaceSummary } from './match';
import { Race, type Agent, type RaceResult } from './race';
import { shiftTier, START_TIERS, tierRank, type Tier } from './tiers';
import { BASE_SCHEDULE, type Track } from './tracks';

// Tournament rules ("regole torneo"), as used by the tournament site:
//  - pole position (random): who starts race 1, who picks first in race 1, who starts the draft
//  - common draft: 5 rounds; each reveals N+1 cards, everyone takes one clockwise; next round starts with the
//    next player; the leftover card is discarded -> 5 cards each
//  - race 1: cards are chosen clockwise from the pole player; races 2-4: by standings (points, then tier of
//    the previous card, then chance); the LAST player in the standings chooses who starts
//  - after each race the winner's card moves up one tier and the last-place card down one
export const DRAFT_ROUNDS = 5;
export const MAX_TOURNAMENT_PLAYERS = 6;

export interface TournamentAgent {
  draft(player: string, options: CharacterId[], round: number): number | Promise<number>;
  pick(player: string, hand: CharacterId[], raceIndex: number): number | Promise<number>;
  egg(player: string, options: CharacterId[]): number | Promise<number>;
  twin(player: string, options: CharacterId[]): number | Promise<number>;
  starter(player: string, candidates: string[]): number | Promise<number>;
  race: Agent;
}

export interface TierChange { up: CharacterId | null; down: CharacterId | null }
export interface TournamentOptions {
  players: string[]; // seat order, clockwise
  rng: () => number;
  agent?: Partial<TournamentAgent>;
  tiers?: Record<CharacterId, Tier>; // current global tiers (default: starting tiers)
  schedule?: Track[];
  onPole?: (pole: { start: string; reveal: string; draft: string }) => void | Promise<void>;
  onRace?: (race: Race, index: number) => void | Promise<void>;
  onRaceEnd?: (summary: RaceSummary, totals: Record<string, number>, tiers: TierChange) => void | Promise<void>;
}
export interface Standing { player: string; pos: number; p: number; wins: number; bronze: number }
export interface TournamentResult {
  totals: Record<string, number>; races: RaceSummary[]; ranking: Standing[]; winners: string[];
  tiers: Record<CharacterId, Tier>; hands: Record<string, CharacterId[]>;
}

/** Last place of a finished race, among racers that did not take 1st/2nd: first eliminated, else farthest behind. */
export function lastRacer(result: RaceResult) {
  const placed = new Set(result.places.map((r) => r.id));
  const pool = result.racers.filter((r) => !placed.has(r.id));
  if (!pool.length) return null;
  const out = result.events.find((e) => e.t === 'eliminated');
  if (out && out.t === 'eliminated') return result.racers[out.racer];
  return [...pool].sort((a, b) => a.pos - b.pos || b.id - a.id)[0];
}

export async function playTournament(o: TournamentOptions): Promise<TournamentResult> {
  const { players, rng } = o;
  const n = players.length;
  if (n < 2 || n > MAX_TOURNAMENT_PLAYERS) throw new Error('2 to 6 players');
  const schedule = o.schedule ?? BASE_SCHEDULE;
  const tiers: Record<CharacterId, Tier> = { ...START_TIERS, ...(o.tiers ?? {}) };
  const ag: TournamentAgent = {
    draft: () => 0, pick: () => 0, egg: () => 0, twin: () => 0, starter: () => 0, race: () => true, ...o.agent,
  };
  const dice = () => 1 + Math.floor(rng() * 6);
  const clockwise = (start: number) => Array.from({ length: n }, (_, k) => (start + k) % n);
  const pole = { start: Math.floor(rng() * n), reveal: Math.floor(rng() * n), draft: Math.floor(rng() * n) };
  await o.onPole?.({ start: players[pole.start], reveal: players[pole.reveal], draft: players[pole.draft] });

  // common draft
  const deck = shuffle(CHARACTERS.map((c) => c.id), rng);
  const hands: Record<string, CharacterId[]> = Object.fromEntries(players.map((p) => [p, []]));
  for (let round = 0; round < DRAFT_ROUNDS; round++) {
    const revealed = deck.splice(0, Math.min(n + 1, deck.length));
    for (const i of clockwise(pole.draft + round)) {
      const k = Math.max(0, Math.min(revealed.length - 1, Number(await ag.draft(players[i], revealed, round))));
      hands[players[i]].push(...revealed.splice(k, 1));
    }
    // the remaining card is discarded
  }

  const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const wins: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const bronze: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const winners: CharacterId[] = [];
  const races: RaceSummary[] = [];
  const prevCard: Record<string, CharacterId | null> = Object.fromEntries(players.map((p) => [p, null]));
  let starter = pole.start;

  for (let k = 0; k < Math.min(4, schedule.length); k++) {
    // order of choosing
    let order: number[];
    if (k === 0) order = clockwise(pole.reveal);
    else {
      const tag = players.map((_, i) => ({ i, p: totals[players[i]], t: prevCard[players[i]] ? tierRank(tiers[prevCard[players[i]]!]) : 0, x: rng() }));
      order = tag.sort((a, b) => b.p - a.p || b.t - a.t || a.x - b.x).map((z) => z.i);
      const last = order[order.length - 1];
      const idx = Math.max(0, Math.min(n - 1, Number(await ag.starter(players[last], players))));
      starter = idx;
    }
    const picked: Record<string, CharacterId> = {};
    for (const i of order) {
      const hand = hands[players[i]];
      const j = Math.max(0, Math.min(hand.length - 1, Number(await ag.pick(players[i], hand, k))));
      picked[players[i]] = hand.splice(j, 1)[0];
    }
    const entries: { owner: string; character: CharacterId; extra?: CharacterId[] }[] = [];
    for (const i of clockwise(starter)) {
      const player = players[i], character = picked[player];
      const e: (typeof entries)[number] = { owner: player, character };
      if (character === 'egg') {
        const options = deck.splice(0, 3);
        if (options.length) e.extra = [options[Math.max(0, Math.min(options.length - 1, Number(await ag.egg(player, options))))]];
      } else if (character === 'twin' && winners.length) {
        const j = Number(await ag.twin(player, winners));
        if (winners[j] !== undefined) e.extra = [winners[j]];
      }
      entries.push(e);
    }
    const race = new Race({ track: schedule[k], entries, dice, agent: ag.race, startRacer: 0 });
    await o.onRace?.(race, k);
    const result = await race.run();
    const points = scoreRace(result, k);
    for (const p of players) { totals[p] = Math.max(0, totals[p] + (points[p] ?? 0)); bronze[p] += Math.max(0, result.bonus[p] ?? 0); }
    const first = result.places[0];
    if (first) { wins[first.owner]++; winners.push(first.character); }
    for (const p of players) prevCard[p] = picked[p];

    // tiers: the winner's card goes up, the last one's goes down
    const change: TierChange = { up: null, down: null };
    if (first) { change.up = first.character; tiers[first.character] = shiftTier(tiers[first.character], 1); }
    const last = lastRacer(result);
    if (last && last.character !== first?.character) { change.down = last.character; tiers[last.character] = shiftTier(tiers[last.character], -1); }
    const summary: RaceSummary = { index: k, track: schedule[k].id, places: result.places.map((r) => ({ owner: r.owner, character: r.character })), points, picks: { ...picked } };
    races.push(summary);
    await o.onRaceEnd?.(summary, { ...totals }, change);
  }

  const rows = players.map((p, i) => ({ player: p, i, p: totals[p], wins: wins[p], bronze: bronze[p] }))
    .sort((a, b) => b.p - a.p || b.wins - a.wins || b.bronze - a.bronze || a.i - b.i);
  const ranking: Standing[] = rows.map((r, idx) => ({
    player: r.player, p: r.p, wins: r.wins, bronze: r.bronze,
    pos: idx > 0 && rows[idx - 1].p === r.p && rows[idx - 1].wins === r.wins && rows[idx - 1].bronze === r.bronze ? 0 : idx + 1,
  }));
  for (let i = 0; i < ranking.length; i++) if (ranking[i].pos === 0) ranking[i].pos = ranking[i - 1].pos;
  const best = ranking[0].p;
  return { totals, races, ranking, winners: ranking.filter((r) => r.p === best && r.pos === 1).map((r) => r.player), tiers, hands };
}
