import type { Race, Racer } from './race';

// Hooks a power can implement. `self` is the racer that owns the power.
export interface PowerHooks {
  /** Added to `mover`'s main move (Coach, Gunk, Hare, Blimp, Party Animal). */
  mainMoveBonus?(race: Race, self: Racer, mover: Racer): number;
  /** Own turn, before rolling: return a move amount to skip the roll (Legs). */
  rollOverride?(race: Race, self: Racer): Promise<number | undefined>;
  /** Own turn, after rolling: replace the roll (Alchemist). */
  rollReplace?(race: Race, self: Racer, roll: number): Promise<number | undefined>;
  /** How many rerolls this power gives `mover` this turn (Magician, Dicemonger). */
  rerolls?(race: Race, self: Racer, mover: Racer): number;
  onReroll?(race: Race, self: Racer, mover: Racer): Promise<void> | void;
  onTurnStart?(race: Race, self: Racer): Promise<void> | void; // own turn only
  onRolled?(race: Race, self: Racer, mover: Racer, roll: number): Promise<void> | void;
  onPassing?(race: Race, self: Racer, mover: Racer, passed: Racer[]): Promise<void> | void;
  onStopped?(race: Race, self: Racer, mover: Racer): Promise<void> | void;
  onPowerUsed?(race: Race, self: Racer, by: Racer): Promise<void> | void;
  onTurnEnd?(race: Race, self: Racer, mover: Racer, startPos: number): Promise<void> | void;
}

const ask = (race: Race, self: Racer) => race.ask({ kind: 'use', racer: self, power: self.character });
const aloneIn = (group: Racer[], r: Racer) => group.length === 1 && group[0] === r;

// Implemented base-game powers. Everything not listed here is still TODO (see IMPLEMENTED).
export const POWERS: Partial<Record<string, PowerHooks>> = {
  banana: {
    onPassing: (race, self, mover, passed) => {
      if (mover !== self && passed.includes(self)) return race.usePower(self, () => race.trip(mover));
    },
  },
  centaur: {
    async onPassing(race, self, mover, passed) {
      if (mover !== self) return;
      await race.usePower(self, async () => { for (const p of passed) await race.move(p, -Math.min(2, p.pos), 'power'); });
    },
  },
  coach: {
    mainMoveBonus: (race, self, mover) => (mover.pos === self.pos ? 1 : 0),
  },
  gunk: {
    mainMoveBonus: (_r, self, mover) => (mover !== self ? -1 : 0),
  },
  hare: {
    mainMoveBonus: (_r, self, mover) => (mover === self ? 2 : 0),
    onTurnStart(race, self) { if (aloneIn(race.leaders(), self)) race.skipMain = true; },
  },
  blimp: {
    mainMoveBonus: (race, self, mover) =>
      mover !== self ? 0 : race.turnStartPos < race.track.corners[1] ? 3 : -1,
  },
  legs: {
    async rollOverride(race, self) { return (await ask(race, self)) ? 5 : undefined; },
  },
  alchemist: {
    async rollReplace(race, self, roll) { return roll <= 2 && (await ask(race, self)) ? 4 : undefined; },
  },
  lackey: {
    onRolled: (race, self, mover, roll) => {
      if (mover !== self && roll === 6) return race.usePower(self, () => race.move(self, 2, 'power'));
    },
  },
  loveable_loser: {
    onTurnStart: (race, self) => {
      if (aloneIn(race.lasts(), self)) return race.usePower(self, () => race.giveChips(self.owner, 1));
    },
  },
  scoocher: {
    onPowerUsed: (race, self, by) => {
      if (by !== self) return race.usePower(self, () => race.move(self, 1, 'power'));
    },
  },
  romantic: {
    onStopped: (race, self, mover) => {
      if (race.at(mover.pos).length === 2) return race.usePower(self, () => race.move(self, 2, 'power'));
    },
  },
  baba_yaga: {
    onStopped(race, self, mover) {
      if (mover === self) {
        const others = race.at(self.pos, self);
        if (others.length) return race.usePower(self, () => others.forEach((o) => race.trip(o)));
      } else if (mover.pos === self.pos) return race.usePower(self, () => race.trip(mover));
    },
  },
  mouth: {
    onStopped(race, self, mover) {
      if (mover !== self) return;
      const others = race.at(self.pos, self);
      if (others.length === 1) return race.usePower(self, () => race.eliminate(others[0]));
    },
  },
  heckler: {
    onTurnEnd: (race, self, mover, startPos) => {
      if (Math.abs(mover.pos - startPos) <= 1) return race.usePower(self, () => race.move(self, 2, 'power'));
    },
  },
  cheerleader: {
    async onTurnStart(race, self) {
      if (!(await ask(race, self))) return;
      await race.usePower(self, async () => {
        for (const r of race.lasts()) await race.move(r, 2, 'power');
        await race.move(self, 1, 'power');
      });
    },
  },
  party_animal: {
    async onTurnStart(race, self) {
      await race.usePower(self, async () => {
        for (const r of race.active) if (r !== self && r.pos !== self.pos) await race.move(r, Math.sign(self.pos - r.pos), 'power');
      });
    },
    mainMoveBonus: (race, self, mover) => (mover === self ? race.at(self.pos, self).length : 0),
  },
  skipper: {
    onRolled: (race, self, _mover, roll) => { if (roll === 1) race.forcedNext = self; },
  },
  inchworm: {
    onRolled: (race, self, mover, roll) => {
      if (mover !== self && roll === 1) return race.usePower(self, async () => { race.skipMain = true; await race.move(self, 1, 'power'); });
    },
  },
  magician: {
    rerolls: (_r, self, mover) => (mover === self ? 2 : 0),
    onReroll: (race, self, mover) => { if (mover === self) return race.usePower(self, () => undefined); },
  },
  dicemonger: {
    rerolls: () => 1,
    onReroll: (race, self, mover) => {
      if (mover !== self) return race.usePower(self, () => race.move(self, 1, 'power'));
    },
  },
  leaptoad: {}, // behaviour lives in Race.move (skips occupied spaces)
};

export const IMPLEMENTED = Object.keys(POWERS);
