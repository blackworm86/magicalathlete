import type { CharacterId } from './characters';
import { POWERS, type PowerHooks } from './powers';
import type { Track } from './tracks';

export type MoveKind = 'main' | 'power' | 'arrow';

export interface Racer {
  id: number;
  owner: string; // player id
  seat: number; // clockwise seat index of the owner
  character: CharacterId;
  extra: CharacterId[]; // borrowed powers (Egg, Twin)
  pos: number;
  tripped: boolean;
  finished: boolean;
  eliminated: boolean;
}

// Every optional choice a player can face. The driver (UI, bot, network replay) answers yes/no.
export type Decision =
  | { kind: 'use'; racer: Racer; power: CharacterId }
  | { kind: 'reroll'; racer: Racer; roll: number; source: Racer };
export type Agent = (d: Decision) => boolean | Promise<boolean>;

export type GameEvent =
  | { t: 'roll'; racer: number; roll: number }
  | { t: 'move'; racer: number; from: number; to: number; kind: MoveKind }
  | { t: 'trip'; racer: number }
  | { t: 'recover'; racer: number }
  | { t: 'chip'; owner: string; amount: number }
  | { t: 'power'; racer: number; power: CharacterId }
  | { t: 'finish'; racer: number; place: number }
  | { t: 'eliminated'; racer: number };

export interface RaceOptions {
  track: Track;
  entries: { owner: string; character: CharacterId; pos?: number }[];
  dice: () => number; // returns 1..6
  agent?: Agent;
  startRacer?: number; // index of the racer who goes first
  maxSteps?: number;
}

export interface RaceResult {
  places: Racer[]; // [1st, 2nd]
  bonus: Record<string, number>; // bronze chips earned in the race, per player
  events: GameEvent[];
}

export class Race {
  readonly track: Track;
  readonly racers: Racer[];
  readonly events: GameEvent[] = [];
  readonly bonus: Record<string, number> = {};
  readonly places: Racer[] = [];
  over = false;
  current!: Racer;
  turnStartPos = 0;
  skipMain = false; // set by powers during turn start / roll (Hare, Inchworm)
  forcedNext: Racer | null = null; // Skipper
  private dice: () => number;
  private agent: Agent;
  private guard: number;
  private startIdx: number;
  private chain = new Set<string>();
  private depth = 0;

  constructor(o: RaceOptions) {
    this.track = o.track;
    this.dice = o.dice;
    this.agent = o.agent ?? (() => true);
    this.guard = o.maxSteps ?? 5000;
    const owners = [...new Set(o.entries.map((e) => e.owner))];
    this.racers = o.entries.map((e, id) => ({
      id, owner: e.owner, seat: owners.indexOf(e.owner), character: e.character, extra: [],
      pos: e.pos ?? 0, tripped: false, finished: false, eliminated: false,
    }));
    this.startIdx = o.startRacer ?? 0;
  }

  // ---- queries -------------------------------------------------------------------------
  isActive = (r: Racer) => !r.finished && !r.eliminated;
  get active() { return this.racers.filter(this.isActive); }
  at(pos: number, except?: Racer) { return this.active.filter((r) => r.pos === pos && r !== except); }
  /** Lead = closest to the finish among racers still racing. */
  leaders() { const m = Math.max(...this.active.map((r) => r.pos)); return this.active.filter((r) => r.pos === m); }
  lasts() { const m = Math.min(...this.active.map((r) => r.pos)); return this.active.filter((r) => r.pos === m); }
  powersOf(r: Racer): CharacterId[] { return [r.character, ...r.extra]; }
  has(r: Racer, p: CharacterId) { return this.powersOf(r).includes(p); }
  ask(d: Decision) { return Promise.resolve(this.agent(d)); }

  // ---- trigger dispatch ----------------------------------------------------------------
  // Order of simultaneous powers: current player first, then the other players clockwise.
  private hookList(only?: Racer) {
    const seats = Math.max(...this.racers.map((r) => r.seat)) + 1;
    const cur = this.current?.seat ?? 0;
    const out: { self: Racer; h: PowerHooks }[] = [];
    for (const self of this.active) {
      if (only && self !== only) continue;
      for (const p of this.powersOf(self)) { const h = POWERS[p]; if (h) out.push({ self, h }); }
    }
    const rank = (r: Racer) => (r.seat - cur + seats) % seats;
    return out.sort((a, b) => rank(a.self) - rank(b.self) || a.self.id - b.self.id);
  }

  async dispatch(f: (h: PowerHooks, self: Racer) => Promise<void> | void, only?: Racer) {
    for (const { self, h } of this.hookList(only)) {
      if (this.over) return;
      if (!this.isActive(self)) continue;
      await f(h, self);
    }
  }

  private tick() { if (--this.guard < 0) throw new LoopError(); }

  /** A power took effect: log it and let Scoocher & co. react. */
  async usePower(r: Racer, effect: () => Promise<void> | void) {
    this.tick();
    // Rule 5: an endless trigger chain is completed once in order, then stops. We detect it as
    // the same power firing again from an identical board state inside one chain.
    const sig = `${r.id}|${this.racers.map((x) => `${x.pos}${x.tripped ? 't' : ''}${this.isActive(x) ? '' : 'x'}`).join(',')}`;
    if (this.chain.has(sig)) return;
    this.chain.add(sig);
    this.depth++;
    try {
      this.events.push({ t: 'power', racer: r.id, power: r.character });
      await effect();
      await this.dispatch((h, s) => h.onPowerUsed?.(this, s, r));
    } finally {
      if (--this.depth === 0) this.chain.clear();
    }
  }

  giveChips(owner: string, amount: number) {
    this.bonus[owner] = (this.bonus[owner] ?? 0) + amount;
    this.events.push({ t: 'chip', owner, amount });
  }

  trip(r: Racer) { if (!r.tripped) { r.tripped = true; this.events.push({ t: 'trip', racer: r.id }); } }

  eliminate(r: Racer) {
    r.eliminated = true;
    this.events.push({ t: 'eliminated', racer: r.id });
    this.checkLastStanding();
  }

  private checkLastStanding() {
    const alive = this.active;
    if (this.over) return;
    if (alive.length === 1) { this.finish(alive[0]); this.over = true; } // rule 6
    else if (alive.length === 0) this.over = true;
  }

  private finish(r: Racer) {
    r.finished = true;
    this.places.push(r);
    this.events.push({ t: 'finish', racer: r.id, place: this.places.length });
    if (this.places.length >= 2) this.over = true;
    else this.checkLastStanding();
  }

  // ---- movement ------------------------------------------------------------------------
  /** Move `n` spaces (negative = backwards). Resolves passing, stopping, arrows, stars, trips. */
  async move(r: Racer, n: number, kind: MoveKind) {
    if (this.over || !this.isActive(r) || n === 0) return;
    this.tick();
    const dir = Math.sign(n);
    const from = r.pos;
    let pos = from;
    const leap = this.has(r, 'leaptoad');
    for (let s = Math.abs(n); s > 0; s--) {
      pos += dir;
      if (leap) while (pos > 0 && pos < this.track.finish && this.at(pos, r).length) pos += dir;
      if (pos <= 0) { pos = 0; break; }
      if (pos >= this.track.finish) { pos = this.track.finish; break; }
    }
    if (pos === from) return;
    r.pos = pos;
    this.events.push({ t: 'move', racer: r.id, from, to: pos, kind });

    // passing: started behind a racer and ended ahead of them (reverse when moving backwards)
    const passed = this.active.filter((o) => o !== r && (dir > 0 ? from < o.pos && o.pos < pos : from > o.pos && o.pos > pos));
    if (passed.length) await this.dispatch((h, s) => h.onPassing?.(this, s, r, passed));
    if (this.over || !this.isActive(r)) return;

    if (pos >= this.track.finish) { this.finish(r); return; }
    await this.stop(r);
  }

  /** The racer has stopped on a space: space effects, then powers that trigger on stopping. */
  async stop(r: Racer) {
    const at = r.pos;
    const sp = this.track.spaces[at];
    if (sp.type === 'star') this.giveChips(r.owner, sp.amount);
    if (sp.type === 'trip') this.trip(r);
    await this.dispatch((h, s) => h.onStopped?.(this, s, r));
    if (sp.type === 'arrow' && !this.over && this.isActive(r) && r.pos === at) {
      await this.move(r, sp.amount, 'arrow'); // separate move, never part of the main move
    }
  }

  // ---- turns ---------------------------------------------------------------------------
  private async mainMove(r: Racer) {
    let rolled: number | undefined;
    let base: number | undefined;
    for (const { self, h } of this.hookList(r)) if (self === r && base === undefined && h.rollOverride) base = await h.rollOverride(this, self);
    if (base === undefined) {
      rolled = this.dice();
      // rerolls (Magician: own, up to 2. Dicemonger: anyone, once per turn)
      const src = this.hookList().map(({ self, h }) => ({ self, left: h.rerolls?.(this, self, r) ?? 0 })).filter((s) => s.left > 0);
      for (const s of src) {
        while (s.left > 0 && (await this.ask({ kind: 'reroll', racer: r, roll: rolled, source: s.self }))) {
          s.left--;
          await this.dispatch((h, self) => h.onReroll?.(this, self, r));
          rolled = this.dice();
        }
      }
      this.events.push({ t: 'roll', racer: r.id, roll: rolled });
      base = rolled;
      for (const { self, h } of this.hookList(r)) if (self === r && h.rollReplace) base = (await h.rollReplace(this, self, rolled)) ?? base;
      await this.dispatch((h, s) => h.onRolled?.(this, s, r, rolled!));
      if (this.over || !this.isActive(r)) return;
    }
    if (this.skipMain) return;
    let bonus = 0;
    for (const { self, h } of this.hookList()) bonus += h.mainMoveBonus?.(this, self, r) ?? 0;
    await this.move(r, Math.max(0, base + bonus), 'main');
  }

  async takeTurn(r: Racer) {
    this.current = r;
    this.turnStartPos = r.pos;
    this.skipMain = false;
    await this.dispatch((h, s) => h.onTurnStart?.(this, s), r);
    if (!this.over && this.isActive(r)) {
      if (r.tripped) { r.tripped = false; this.events.push({ t: 'recover', racer: r.id }); }
      else if (!this.skipMain) await this.mainMove(r);
      else this.skipMain = false;
    }
    if (!this.over) await this.dispatch((h, s) => h.onTurnEnd?.(this, s, r, this.turnStartPos));
  }

  async run(): Promise<RaceResult> {
    for (const r of this.racers) if (r.pos >= this.track.finish) r.pos = this.track.finish - 1;
    let i = this.startIdx;
    try {
      this.checkLastStanding();
      while (!this.over) {
        this.tick();
        const r = this.racers[i];
        if (this.isActive(r)) await this.takeTurn(r);
        const fn = this.forcedNext;
        this.forcedNext = null;
        i = fn && this.isActive(fn) ? fn.id : (i + 1) % this.racers.length;
      }
    } catch (e) {
      if (!(e instanceof LoopError)) throw e; // rule 5: unresolvable loop ends the race
      this.over = true;
    }
    return { places: this.places, bonus: this.bonus, events: this.events };
  }
}

export class LoopError extends Error {}
