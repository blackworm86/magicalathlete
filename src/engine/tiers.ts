import type { CharacterId } from './characters';

// Starting tiers (S best .. E weakest) used by the tournament rules; they move after each tournament race.
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export const TIERS: Tier[] = ['E', 'D', 'C', 'B', 'A', 'S'];
export const START_TIERS: Record<CharacterId, Tier> = {
  alchemist: 'C',
  baba_yaga: 'D',
  banana: 'B',
  blimp: 'C',
  centaur: 'D',
  cheerleader: 'D',
  coach: 'D',
  copy_cat: 'D',
  dicemonger: 'D',
  duelist: 'C',
  egg: 'D',
  flip_flop: 'S',
  genius: 'D',
  gunk: 'B',
  hare: 'D',
  heckler: 'A',
  huge_baby: 'D',
  hypnotist: 'A',
  inchworm: 'D',
  lackey: 'C',
  leaptoad: 'C',
  legs: 'A',
  loveable_loser: 'B',
  magician: 'D',
  mastermind: 'D',
  mouth: 'B',
  party_animal: 'C',
  rocket_scientist: 'C',
  romantic: 'A',
  scoocher: 'S',
  sisyphus: 'C',
  skipper: 'C',
  stickler: 'C',
  suckerfish: 'A',
  third_wheel: 'D',
  twin: 'B',
};

export const tierRank = (t: Tier) => TIERS.indexOf(t);
export const shiftTier = (t: Tier, d: number): Tier => TIERS[Math.max(0, Math.min(5, TIERS.indexOf(t) + d))];
