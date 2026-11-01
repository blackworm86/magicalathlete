import type { CharacterId } from '../engine/characters';
import type { RaceSummary } from '../engine/match';
import type { GameEvent } from '../engine/race';
import type { PromptSpec } from '../ui/prompts';

export type Rules = 'friendly' | 'tournament';
// Same player colours as the tournament site.
export const PLAYER_COLORS = ['#ff7a59', '#7fb2ff', '#6fe0a3', '#ffe14d', '#ff9fd2', '#c4a7ff'];

export interface PlayerInfo { id: string; name: string; bot: boolean; color: string; team?: string }

/** What the host streams to every screen (its own and the other players'). Language-neutral. */
export type LogEntry =
  | { t: 'start'; rules: Rules; players: PlayerInfo[] }
  | { t: 'pole'; start: string; reveal: string; draft: string }
  | { t: 'race'; index: number; track: 'mild' | 'wild'; racers: { id: number; owner: string; character: CharacterId; pos: number }[] }
  | { t: 'ev'; e: GameEvent }
  | { t: 'raceEnd'; summary: RaceSummary; totals: Record<string, number>; up?: CharacterId | null; down?: CharacterId | null }
  | { t: 'end'; totals: Record<string, number>; ranking: { id: string; pos: number; p: number }[]; winners: string[]; ranked: boolean }
  | { t: 'info'; spec: PromptSpec };

export interface RoomMeta { host: string; rules: Rules; status: 'lobby' | 'playing' | 'done'; created: number; order?: string[]; alive?: number }

/** Firebase does not store empty lists or objects, so they come back missing: put them back before the view uses them. */
export function normalize(e: LogEntry): LogEntry {
  switch (e.t) {
    case 'start': return { ...e, players: e.players ?? [] };
    case 'race': return { ...e, racers: e.racers ?? [] };
    case 'raceEnd': return { ...e, totals: e.totals ?? {}, summary: { ...e.summary, places: e.summary?.places ?? [], points: e.summary?.points ?? {} } };
    case 'end': return { ...e, totals: e.totals ?? {}, ranking: e.ranking ?? [], winners: e.winners ?? [] };
    default: return e;
  }
}
export interface RoomPlayer { uid: string; name: string; team?: string; guest: boolean; bot?: boolean; joined: number }
export interface Request { to: string; spec: PromptSpec }
