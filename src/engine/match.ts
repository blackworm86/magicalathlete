import { CHARACTERS, type CharacterId } from './characters';
import { Race, type Agent, type RaceResult } from './race';
import { BASE_SCHEDULE, type Track } from './tracks';

// Place chips by race (1st..4th): gold for 1st, silver for 2nd. Bronze chips (stars etc.) are 1 each.
export const GOLD = [3, 4, 4, 5];
export const SILVER = [1, 2, 2, 3];

/** Points each player earns in one race (may be negative only through Sisyphus' lost chips). */
export function scoreRace(result: RaceResult, raceIndex: number): Record<string, number> {
  const pts: Record<string, number> = {};
  const add = (owner: string, n: number) => { pts[owner] = (pts[owner] ?? 0) + n; };
  const [first, second] = result.places;
  if (first) add(first.owner, GOLD[raceIndex]);
  if (second) add(second.owner, SILVER[raceIndex]);
  for (const [owner, n] of Object.entries(result.bonus)) add(owner, n);
  return pts;
}

// ---- drafting -------------------------------------------------------------------------
/** Snake order for one line of cards: forward, then backward (last player picks twice in a row). */
export function snake(order: string[]): string[] { return [...order, ...[...order].reverse()]; }

export type Variant = 'standard' | 'two-player' | 'double-racer';

/** The pick order of every flipped line of the draft. Each entry is one line of cards. */
export function draftLines(players: string[], first: number, variant: Variant): string[][] {
  const n = players.length;
  const from = (start: number) => Array.from({ length: n }, (_, i) => players[(start + i) % n]);
  if (variant === 'two-player') {
    const abba = snake(from(first)); // ABBA
    const other = snake(from(first + 1));
    return [[...abba, ...abba], [...other, ...other]]; // ABBAABBA, then BAABBAAB
  }
  if (variant === 'double-racer') return [0, 1, 2, 3].map((k) => snake(from(first + k)));
  return [0, 1].map((k) => snake(from(first + k))); // two snake drafts, 2 racers each
}

// ---- the match ------------------------------------------------------------------------
export interface MatchAgent {
  /** Pick one of the flipped cards (index into options). */
  draft(player: string, options: CharacterId[]): number | Promise<number>;
  /** Choose `count` different racers from your hand for the next race (indices into hand). */
  pick(player: string, hand: CharacterId[], count: number, raceIndex: number): number[] | Promise<number[]>;
  /** Egg: pick one of 3 freshly drawn racers (index into options). */
  egg(player: string, options: CharacterId[]): number | Promise<number>;
  /** Twin: pick a past race winner to copy (index into options), or -1 to decline. */
  twin(player: string, options: CharacterId[]): number | Promise<number>;
  /** In-race decisions (optional powers, targets, predictions). */
  race: Agent;
}

export interface MatchOptions {
  players: string[]; // seat order, clockwise
  rng: () => number; // 0..1, seeded
  variant?: Variant; // default: 'two-player' with 2 players, otherwise 'standard'
  schedule?: Track[]; // default: Mild, Wild, Mild, Wild
  agent?: Partial<MatchAgent>;
  onRace?: (race: Race, index: number) => void; // lets the UI subscribe before a race starts
  onRaceEnd?: (summary: RaceSummary, totals: Record<string, number>) => void | Promise<void>;
}

export interface RaceSummary { index: number; track: string; places: { owner: string; character: CharacterId }[]; points: Record<string, number>; picks?: Record<string, CharacterId> }
export interface MatchResult { totals: Record<string, number>; races: RaceSummary[]; winners: string[]; }

export function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Roll-off: highest roll goes first; tied players re-roll among themselves. Returns the winner's index. */
export function rollOff(players: string[], rng: () => number, among = players.map((_, i) => i)): number {
  let cand = among;
  for (let guard = 0; guard < 100 && cand.length > 1; guard++) {
    const rolls = cand.map(() => 1 + Math.floor(rng() * 6));
    const top = Math.max(...rolls);
    cand = cand.filter((_, k) => rolls[k] === top);
  }
  return cand[0];
}

/**
 * Who goes first in the next race: the owner of the farthest-behind racer of the last race (or the
 * first one eliminated). In the multi-racer variants it is the player with fewer points in that race.
 */
export function nextFirst(players: string[], result: RaceResult, points: Record<string, number>, variant: Variant, rng: () => number): number {
  if (variant !== 'standard') {
    const pts = players.map((p) => points[p] ?? 0);
    const low = Math.min(...pts);
    const tied = players.map((_, i) => i).filter((i) => pts[i] === low);
    return tied.length === 1 ? tied[0] : rollOff(players, rng, tied);
  }
  const firstOut = result.events.find((e) => e.t === 'eliminated');
  const racer = firstOut && firstOut.t === 'eliminated'
    ? result.racers[firstOut.racer]
    : [...result.racers].sort((a, b) => a.pos - b.pos || a.id - b.id)[0];
  return players.indexOf(racer.owner);
}

export async function playMatch(o: MatchOptions): Promise<MatchResult> {
  const { players, rng } = o;
  const variant: Variant = o.variant ?? (players.length === 2 ? 'two-player' : 'standard');
  if (players.length < 2 || players.length > 6) throw new Error('2 to 6 players');
  if (variant === 'standard' && players.length < 3) throw new Error('standard game needs 3+ players');
  if (variant === 'double-racer' && players.length !== 3) throw new Error('double-racer variant is for 3 players');
  const schedule = o.schedule ?? BASE_SCHEDULE;
  const ag: MatchAgent = {
    draft: () => 0,
    pick: (_p, _h, count) => Array.from({ length: count }, (_, i) => i),
    egg: () => 0,
    twin: () => 0,
    race: () => true,
    ...o.agent,
  };
  const dice = () => 1 + Math.floor(rng() * 6);
  const racersPerPlayer = variant === 'standard' ? 1 : 2;

  // Recruit
  const deck = shuffle(CHARACTERS.map((c) => c.id), rng);
  const hands: Record<string, CharacterId[]> = Object.fromEntries(players.map((p) => [p, []]));
  const draftFirst = rollOff(players, rng);
  const lineSize = (line: string[]) => (variant === 'standard' ? 2 * players.length : line.length);
  for (const line of draftLines(players, draftFirst, variant)) {
    const flipped = deck.splice(0, lineSize(line));
    for (const player of line) {
      const idx = await ag.draft(player, flipped);
      hands[player].push(...flipped.splice(flipped[idx] === undefined ? 0 : idx, 1));
    }
  }

  // Race x4
  const totals: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const winners: CharacterId[] = []; // characters that won previous races (Twin)
  const races: RaceSummary[] = [];
  let first = rollOff(players, rng);
  for (let i = 0; i < Math.min(4, schedule.length); i++) {
    const order = Array.from({ length: players.length }, (_, k) => players[(first + k) % players.length]);
    const entries: { owner: string; character: CharacterId; extra?: CharacterId[] }[] = [];
    for (const player of order) {
      const hand = hands[player];
      let idxs = [...new Set(await ag.pick(player, hand, racersPerPlayer, i))].filter((k) => hand[k] !== undefined);
      for (let k = 0; idxs.length < racersPerPlayer && k < hand.length; k++) if (!idxs.includes(k)) idxs.push(k);
      idxs = idxs.slice(0, racersPerPlayer);
      const chosen = idxs.map((k) => hand[k]);
      hands[player] = hand.filter((_, k) => !idxs.includes(k));
      for (const character of chosen) {
        const entry: (typeof entries)[number] = { owner: player, character };
        if (character === 'egg') {
          const options = deck.splice(0, 3); // draw 3 new racers, pick one
          if (options.length) entry.extra = [options[Math.max(0, Math.min(options.length - 1, await ag.egg(player, options)))]];
        } else if (character === 'twin' && winners.length) {
          const k = await ag.twin(player, winners);
          if (winners[k] !== undefined) entry.extra = [winners[k]];
        }
        entries.push(entry);
      }
    }
    const race = new Race({ track: schedule[i], entries, dice, agent: ag.race, startRacer: 0 });
    o.onRace?.(race, i);
    const result = await race.run();
    const points = scoreRace(result, i);
    for (const p of players) totals[p] = Math.max(0, totals[p] + (points[p] ?? 0)); // chips can't go below 0
    if (result.places[0]) winners.push(result.places[0].character);
    races.push({ index: i, track: schedule[i].id, places: result.places.map((r) => ({ owner: r.owner, character: r.character })), points });
    await o.onRaceEnd?.(races[races.length - 1], { ...totals });
    first = nextFirst(players, result, points, variant, rng);
  }
  const best = Math.max(...Object.values(totals));
  return { totals, races, winners: players.filter((p) => totals[p] === best) };
}
