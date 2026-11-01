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

// Every choice a player can face. The driver (UI, bot, network replay) answers:
// use/reroll -> boolean, choose/choosePos -> index into options, predict -> number 1..6.
export type Decision =
  | { kind: 'use'; racer: Racer; power: CharacterId }
  | { kind: 'reroll'; racer: Racer; roll: number; source: Racer }
  | { kind: 'choose'; racer: Racer; power: CharacterId; options: Racer[] }
  | { kind: 'choosePos'; racer: Racer; power: CharacterId; options: number[] }
  | { kind: 'predict'; racer: Racer; power: CharacterId };
export type Agent = (d: Decision) => boolean | number | Promise<boolean | number>;

export type GameEvent =
  | { t: 'roll'; racer: number; roll: number }
  | { t: 'move'; racer: number; from: number; to: number; kind: MoveKind }
  | { t: 'warp'; racer: number; from: number; to: number }
  | { t: 'trip'; racer: number }
  | { t: 'recover'; racer: number }
  | { t: 'chip'; owner: string; amount: number }
  | { t: 'power'; racer: number; power: CharacterId }
  | { t: 'finish'; racer: number; place: number }
  | { t: 'eliminated'; racer: number };

export interface RaceOptions {
  track: Track;
  entries: { owner: string; character: CharacterId; pos?: number; extra?: CharacterId[] }[];
  dice: () => number; // returns 1..6
  agent?: Agent;
  startRacer?: number; // index of the racer who goes first
  maxSteps?: number;
}

export interface RaceResult {
  places: Racer[]; // [1st, 2nd] (the same racer twice if Mastermind wins both)
  bonus: Record<string, number>; // bronze chips earned (or lost) in the race, per player
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
  skipMain = false; // set by powers during turn start / roll (Hare, Inchworm, Flip Flop, Sisyphus)
  forcedNext: Racer | null = null; // Skipper / Genius: who takes the next turn
  group: Racer[] = []; // racers that arrived on their space simultaneously with the current stop
  predictions = new Map<number, number>(); // Genius: racer id -> predicted roll
  mastermind = new Map<number, number>(); // Mastermind: racer id -> predicted winner racer id
  private copyPick = new Map<number, number>();
  private dice: () => number;
  private agent: Agent;
  private guard: number;
  private startIdx: number;
  private chain = new Set<string>();
  private depth = 0;
  private arrowChain = new Set<string>();
  private arrowDepth = 0;

  constructor(o: RaceOptions) {
    this.track = o.track;
    this.dice = o.dice;
    this.agent = o.agent ?? (() => true);
    this.guard = o.maxSteps ?? 5000;
    const owners = [...new Set(o.entries.map((e) => e.owner))];
    this.racers = o.entries.map((e, id) => ({
      id, owner: e.owner, seat: owners.indexOf(e.owner), character: e.character, extra: e.extra ?? [],
      pos: e.pos ?? 0, tripped: false, finished: false, eliminated: false,
    }));
    this.startIdx = o.startRacer ?? 0;
  }

  // ---- queries -------------------------------------------------------------------------
  isActive = (r: Racer) => !r.finished && !r.eliminated;
  get active() { return this.racers.filter(this.isActive); }
  at(pos: number, except?: Racer) { return this.active.filter((r) => r.pos === pos && r !== except); }
  /** Racers sharing `r`'s space, not counting those that arrived together with it. */
  sharing(r: Racer) { return this.at(r.pos, r).filter((o) => !this.group.includes(o)); }
  leaders() { const m = Math.max(...this.active.map((r) => r.pos)); return this.active.filter((r) => r.pos === m); }
  lasts() { const m = Math.min(...this.active.map((r) => r.pos)); return this.active.filter((r) => r.pos === m); }
  rollDie() { return this.dice(); }

  /** A racer's powers: its own, borrowed ones, and (Copy Cat) the lead racer's. */
  ownPowers(r: Racer): CharacterId[] { return [r.character, ...r.extra]; }
  powersOf(r: Racer): CharacterId[] {
    const own = this.ownPowers(r);
    if (r.character === 'copy_cat') {
      const lead = this.copyTarget(r);
      if (lead) own.push(...this.ownPowers(lead).filter((p) => p !== 'copy_cat'));
    }
    return own;
  }
  has(r: Racer, p: CharacterId) { return this.powersOf(r).includes(p); }
  private copyTarget(cc: Racer): Racer | undefined {
    const lead = this.leaders();
    if (lead.length === 0 || lead.includes(cc)) return undefined;
    if (lead.length === 1) return lead[0];
    return lead.find((l) => l.id === this.copyPick.get(cc.id)) ?? lead[0];
  }

  // ---- decisions -----------------------------------------------------------------------
  async ask(d: Decision) { return !!(await this.agent(d)); }
  async choose(racer: Racer, power: CharacterId, options: Racer[]): Promise<Racer | undefined> {
    if (!options.length) return undefined;
    const v = await this.agent({ kind: 'choose', racer, power, options });
    return options[typeof v === 'number' ? v : v ? 0 : -1];
  }
  async choosePos(racer: Racer, power: CharacterId, options: number[]): Promise<number | undefined> {
    if (!options.length) return undefined;
    const v = await this.agent({ kind: 'choosePos', racer, power, options });
    return options[typeof v === 'number' ? v : v ? 0 : -1];
  }
  async predict(racer: Racer, power: CharacterId): Promise<number> {
    const v = await this.agent({ kind: 'predict', racer, power });
    return typeof v === 'number' ? v : 3;
  }

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
    if (this.places.length === 1) {
      // Mastermind: a right prediction ends the race at once and Mastermind takes 2nd
      // (both 1st and 2nd if it predicted itself).
      for (const m of this.racers) {
        if (this.mastermind.get(m.id) !== r.id || !this.has(m, 'mastermind')) continue;
        if (m === r) { this.places.push(r); this.events.push({ t: 'finish', racer: r.id, place: 2 }); }
        else if (this.isActive(m)) this.finish(m);
        this.over = true;
        return;
      }
    }
    if (this.places.length >= 2) this.over = true;
    else this.checkLastStanding();
  }

  // ---- movement ------------------------------------------------------------------------
  private stickler(r: Racer) { return this.active.some((s) => s !== r && this.has(s, 'stickler')); }

  /** Move `n` spaces (negative = backwards). Resolves passing, stopping, arrows, stars, trips. */
  async move(r: Racer, n: number, kind: MoveKind) {
    if (this.over || !this.isActive(r) || n === 0) return;
    this.tick();
    const dir = Math.sign(n);
    const from = r.pos;
    let pos = from;
    const leap = this.has(r, 'leaptoad');
    let skipped = 0;
    for (let s = Math.abs(n); s > 0; s--) {
      pos += dir;
      if (leap) while (pos > 0 && pos < this.track.finish && this.at(pos, r).length) { pos += dir; skipped++; }
      if (dir > 0 && pos >= this.track.finish) {
        if ((pos > this.track.finish || s > 1) && this.stickler(r)) return; // Stickler: exact finish only
        pos = this.track.finish;
        break;
      }
      if (pos <= 0) { pos = 0; break; }
    }
    if (pos === from) return;

    // Suckerfish can ride along with a racer that starts a move on its space.
    const riders: Racer[] = [];
    if (!this.has(r, 'huge_baby')) {
      for (const f of this.active) {
        if (f !== r && f.pos === from && this.has(f, 'suckerfish') && (await this.ask({ kind: 'use', racer: f, power: 'suckerfish' }))) riders.push(f);
      }
    }
    const group = [r, ...riders];
    for (const g of group) { g.pos = pos; this.events.push({ t: 'move', racer: g.id, from, to: pos, kind }); }
    for (const rider of riders) await this.usePower(rider, () => undefined);
    for (let i = 0; i < skipped; i++) await this.usePower(r, () => undefined); // Leaptoad jumps (Scoocher reacts)
    await this.arrive(group, from, dir);
  }

  /** Several racers move at once (Party Animal). `together` also counts as arriving at the same time. */
  async moveTogether(moves: [Racer, number][], together: Racer[] = []) {
    const group: Racer[] = [];
    for (const [r, n] of moves) {
      if (!this.isActive(r) || !n) continue;
      const to = Math.max(0, Math.min(this.track.finish - 1, r.pos + n));
      if (to === r.pos) continue;
      this.events.push({ t: 'move', racer: r.id, from: r.pos, to, kind: 'power' });
      r.pos = to;
      group.push(r);
    }
    if (group.length) await this.arrive(group, 0, 0, together);
  }

  /** Warp: no movement, no passing, but the racer has stopped on the new space. */
  async warp(r: Racer, to: number) {
    if (this.over || !this.isActive(r) || r.pos === to) return;
    this.events.push({ t: 'warp', racer: r.id, from: r.pos, to });
    r.pos = to;
    await this.arrive([r], to, 0);
  }

  /** Swap spaces simultaneously (Flip Flop). */
  async swap(a: Racer, b: Racer) {
    const pa = a.pos, pb = b.pos;
    this.events.push({ t: 'warp', racer: a.id, from: pa, to: pb }, { t: 'warp', racer: b.id, from: pb, to: pa });
    a.pos = pb; b.pos = pa;
    await this.arrive([a, b], 0, 0);
  }

  /** Huge Baby: nobody else may share its space (except Start). Displaced racers just "stop" one space back. */
  private settleBaby(g: Racer): Racer[] {
    if (g.pos <= 0 || g.pos >= this.track.finish) return [];
    const baby = this.at(g.pos).find((b) => this.has(b, 'huge_baby'));
    if (!baby) return [];
    const out: Racer[] = [];
    for (const o of this.at(g.pos)) {
      if (o === baby) continue;
      this.events.push({ t: 'move', racer: o.id, from: o.pos, to: g.pos - 1, kind: 'power' });
      o.pos = g.pos - 1;
      out.push(o);
    }
    return out;
  }

  /** Racers `group` have just been placed on their new space(s): passing, finishing, stopping. */
  private async arrive(group: Racer[], from: number, dir: number, together: Racer[] = []) {
    const displaced: Racer[] = [];
    for (const g of group) displaced.push(...this.settleBaby(g));
    if (dir !== 0) {
      for (const g of group) {
        const passed = this.active.filter((o) => !group.includes(o) && (dir > 0 ? from < o.pos && o.pos < g.pos : from > o.pos && o.pos > g.pos));
        if (passed.length) await this.dispatch((h, s) => h.onPassing?.(this, s, g, passed));
      }
    }
    const all = [...group, ...displaced.filter((d) => !group.includes(d))];
    this.group = [...group, ...together];
    for (const g of all) {
      if (this.over || !this.isActive(g)) continue;
      if (g.pos >= this.track.finish) { this.finish(g); continue; }
      await this.stop(g);
    }
    this.group = [];
  }

  /** The racer has stopped on a space: space effects, then powers that trigger on stopping. */
  async stop(r: Racer) {
    const at = r.pos;
    const sp = this.track.spaces[at];
    if (sp.type === 'star') this.giveChips(r.owner, sp.amount);
    if (sp.type === 'trip') this.trip(r);
    await this.dispatch((h, s) => h.onStopped?.(this, s, r));
    if (sp.type === 'arrow' && !this.over && this.isActive(r) && r.pos === at) {
      // Rule 5: the same racer taking the same arrow again inside one chain is a loop: do it once, then stop.
      const key = `${r.id}@${at}`;
      if (this.arrowChain.has(key)) return;
      this.arrowChain.add(key);
      this.arrowDepth++;
      try { await this.move(r, sp.amount, 'arrow'); } // separate move, never part of the main move
      finally { if (--this.arrowDepth === 0) this.arrowChain.clear(); }
    }
  }

  // ---- turns ---------------------------------------------------------------------------
  private async mainMove(r: Racer) {
    let rolled: number | undefined;
    let base: number | undefined;
    for (const { self, h } of this.hookList(r)) if (self === r && base === undefined && h.rollOverride) base = await h.rollOverride(this, self);
    if (base === undefined) {
      await this.dispatch((h, s) => h.beforeRoll?.(this, s), r);
      rolled = this.dice();
      // rerolls (Magician: own, up to 2. Dicemonger: anyone, once per turn)
      const src = this.hookList().map(({ self, h }) => ({ self, left: h.rerolls?.(this, self, r) ?? 0 })).filter((s) => s.left > 0);
      for (const s of src) {
        while (s.left > 0 && (await this.ask({ kind: 'reroll', racer: r, roll: rolled, source: s.self }))) {
          s.left--;
          await this.dispatch((h, self) => h.onReroll?.(this, self, r, s.self));
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
    const negatives: Racer[] = [];
    for (const { self, h } of this.hookList()) {
      const b = h.mainMoveBonus?.(this, self, r) ?? 0;
      bonus += b;
      for (let i = 0; i < -b; i++) negatives.push(self); // every -1 is a power happening (Scoocher reacts)
    }
    for (const n of negatives) await this.usePower(n, () => undefined);
    await this.move(r, Math.max(0, base + bonus), 'main');
  }

  async takeTurn(r: Racer) {
    this.current = r;
    this.turnStartPos = r.pos;
    this.skipMain = false;
    this.predictions.delete(r.id);
    const wasTripped = r.tripped; // a trip picked up during this turn only affects the next main move
    await this.dispatch((h, s) => h.onTurnStart?.(this, s), r);
    if (!this.over && this.isActive(r)) {
      if (wasTripped) { r.tripped = false; this.events.push({ t: 'recover', racer: r.id }); }
      else if (!this.skipMain) await this.mainMove(r);
      else this.skipMain = false;
    }
    if (!this.over) await this.dispatch((h, s) => h.onTurnEnd?.(this, s, r, this.turnStartPos));
  }

  async run(): Promise<RaceResult> {
    for (const r of this.racers) if (r.pos >= this.track.finish) r.pos = this.track.finish - 1;
    for (const r of this.racers) for (const p of this.ownPowers(r)) POWERS[p]?.onRaceStart?.(this, r);
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
