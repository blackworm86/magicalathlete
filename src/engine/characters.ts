// The 36 base-game racers. `text` is the card text; `notes` are the rulebook rulings.
// `block` (wooden block colour: orange | purple | cyan | green | yellow) is still to be filled from the photo.
export interface Character {
  id: string;
  name: string;
  power: string; // power name on the card
  text: string;
  notes?: string[];
  block?: 'orange' | 'purple' | 'cyan' | 'green' | 'yellow';
}

const c = (id: string, name: string, power: string, text: string, ...notes: string[]): Character =>
  ({ id, name, power, text, ...(notes.length ? { notes } : {}) });

export const CHARACTERS = [
  c('alchemist', 'Alchemist', "TRANSMUTE 'N' SCOOT", 'When I roll a 1 or 2 for my main move, I can move 4 instead.'),
  c('blimp', 'Blimp', 'BLOW IT', 'When I start my turn before the second corner of the track, I get +3 to my main move. On or after that corner, I get -1.'),
  c('coach', 'Coach', 'GOOD HUSTLE', 'Everyone on my space gets +1 to their main move, including me.', 'I get my power’s benefit too!'),
  c('baba_yaga', 'Baba Yaga', 'LEG IT', 'Trip any racer that stops on my space, or when I stop on theirs.',
    'If I share a space with the Duelist, we can duel, but the Duelist will still trip.',
    'The Hypnotist can cast their spell on me, but they still trip.'),
  c('centaur', 'Centaur', 'HOOFWHACK', 'When I pass a racer, they move backwards 2.', 'A racer can’t be hoofwhacked any farther back than the Start space.'),
  c('copy_cat', 'Copy Cat', 'COPY THAT', 'I have the power of the racer currently in the lead. If there’s a tie, I pick.',
    'I persistently have the power of the lead racer, not just on my turn.',
    'If there’s ever a contradiction between me and the racer I’m copying, their power takes priority.',
    'I never copy “before my race” powers.', 'If there’s a tied lead, I can’t switch my power mid-action.'),
  c('banana', 'Banana', 'THE SLIP', 'I trip any racer that passes me.'),
  c('cheerleader', 'Cheerleader', 'RAH RAH', 'At the start of my turn, I can make the racers in last place move 2. If I do, I move 1.',
    'If there is more than one racer in last place, they all move. But I only move 1 regardless of how many racers are in last.',
    'If I cheer for myself, those are two separate moves: move 2 then move 1.'),
  c('dicemonger', 'Dicemonger', 'DICEY DEALS', 'Anyone can reroll their main move once per turn. When another racer does it, I move 1.', 'If someone else rerolls, I move before they move.'),
  c('duelist', 'Duelist', 'DUEL!', 'Whenever a racer shares my space, I can shout DUEL! We roll our dice and whoever rolls highest moves 2. I win ties.',
    'I can duel multiple times in a turn, including when it’s not my turn. I just need to be sharing a space to immediately declare a duel.',
    'I can’t interrupt actions in progress, like between a roll and a move.'),
  c('genius', 'Genius', 'THINK GOOD', 'I can predict what number I’ll roll for my main move. If I’m right, I take an extra turn.',
    'If I’m racing against Skipper and I predict a 1, Skipper steals the next turn, since their power triggers after mine.',
    'When playing with multiple racers, if I predict right, I get an extra turn but not my other racer(s).'),
  c('heckler', 'Heckler', 'SCHADENFREUDE', 'When a racer ends their turn within 1 space of where they started, I move 2.', 'My power works for racers recovering from tripping.'),
  c('egg', 'Egg', 'SCRAMBLE', 'Before my race, draw 3 new racers from the deck and pick one. I have its powers.',
    'You should still use my racer token!', 'I still get any “before race” powers.'),
  c('gunk', 'Gunk', "GOOP 'EM", 'Other racers get -1 to their main move.',
    'My goop reduces the move amount, not the die roll number. So it doesn’t make a 6 into a 5 and keep the Lackey from doing their job.'),
  c('huge_baby', 'Huge Baby', 'REALLY HUGE', 'No one can ever be on my space, besides the Start. Whenever that would happen, put the racer on the space behind me instead.',
    'When other racers are put behind me because of my power, that doesn’t count as a move: it’s like they just stopped on that space instead.',
    'If I stop on Banana’s space and move them back, it counts as passing them and I trip.'),
  c('flip_flop', 'Flip Flop', 'FLOP FLIP', 'I can skip rolling for my main move and swap spaces with another racer instead.',
    'My flop flip is a warp: it doesn’t count as a move and I don’t roll.',
    'I never occupy the same space as a racer I switch places with. We flop flip simultaneously.'),
  c('hare', 'Hare', 'HUBRIS', 'I get +2 to my main move. When I start my turn alone in the lead, I skip my main move.'),
  c('hypnotist', 'Hypnotist', 'HSSSSST', 'At the start of my turn, I can warp a racer to my space.'),
  c('inchworm', 'Inchworm', 'WRIGGLE', 'When another racer rolls a 1 for their main move, they skip that move and I move 1.',
    'If another racer rolls a 1 and the Skipper is also on the track with me, I wriggle 1 and then the Skipper takes their turn.'),
  c('legs', 'Legs', 'JOG', 'I can skip rolling for my main move and move 5 instead.',
    'My power counts as my main move, so can be gooped by Gunk or get the hustle bonus from Coach.'),
  c('mastermind', 'Mastermind', 'KNOW-IT-ALL', 'At the start of my first turn, I predict which racer will win. If I’m right, the race ends immediately and I finish 2nd.',
    'If I predict myself, I can win both 1st and 2nd.'),
  c('lackey', 'Lackey', 'VERY GOOD SIRE', 'When another racer rolls a 6 for their main move, I move 2.', 'I do my move before the other racer, if it matters.'),
  c('loveable_loser', 'Loveable Loser', "D'AWW", 'At the start of my turn, I get 1 point chip if I’m alone in last place.'),
  c('mouth', 'M.O.U.T.H.', 'CHOMP', 'When I stop on a space with exactly one other racer, they’re eliminated from the race.'),
  c('leaptoad', 'Leaptoad', 'JUMPFROG', 'I skip spaces with other racers on them.', 'Yes, even if I’m moving backwards.'),
  c('magician', 'Magician', 'POOF', 'I can reroll my main move up to two times.', 'I must use whatever my last roll is.'),
  c('party_animal', 'Party Animal', 'ANIMAL MAGNETISM', 'At the start of my turn, all racers move 1 space towards me. Each other racer on my space gives me +1 to my main move.',
    'If Huge Baby parties onto my space, everyone there gets put 1 space back.'),
  c('rocket_scientist', 'Rocket Scientist', 'KABLOOEY', 'I can double my main move roll. When I do, I trip.', 'I roll THEN decide whether to kablooey.'),
  c('sisyphus', 'Sisyphus', 'KEEP ROLLIN’', 'Before my race, I take 4 point chips. When I roll a 6 for my main move, instead of moving, I warp to the Start and lose 1 point chip.',
    'If I roll more than 4 sixes, I continue to lose points, assuming I have any.', 'I don’t get my main move after warping.'),
  c('suckerfish', 'Suckerfish', 'SUCKER!', 'When a racer starts a move on my space, I can move with them.',
    'If I start moving with a racer, I can’t stop until they finish their full move. I can cross the finish line using my power.',
    'I arrive at the space at the same time, but for finishing and triggering powers, the racer I’m moving with resolves first.'),
  c('romantic', 'Romantic', 'AH, LOVE!', 'When anyone stops on a space with exactly one other racer, I move 2.',
    'If two racers move together simultaneously, like with the Party Animal or Suckerfish, my power doesn’t trigger.'),
  c('skipper', 'Skipper', 'SALTY DOG', 'When anyone rolls a 1 for their main move, I go next in turn order.',
    'After I go, turn order continues to my left. (Unless I roll a 1 and go again!)'),
  c('third_wheel', 'Third Wheel', 'ROLL THROUGH', 'At the start of my turn, I can warp to any space with exactly 2 racers on it.', 'I still get my main move after warping.'),
  c('scoocher', 'Scoocher', 'SCOOCH SCOOCH', 'When another racer’s power happens, I move 1.',
    'When Gunk is on the board, I scooch 1 for every -1 that affects a racer’s main move.',
    'With Dicemonger, I move for each reroll.', 'With Leaptoad, I move for each space skipped. If they jumpfrog over 2 consecutive occupied spaces, I move 1 twice.',
    'I scooch 1 on each Magician reroll, even if it’s not used.'),
  c('stickler', 'Stickler', 'ACTUALLY...', 'Other racers can only cross the finish line by moving the exact amount they need. If they overshoot, they don’t move.',
    'This includes any movement from main moves, powers, etc. For example, if the Duelist wins a duel on the final space before the finish line, they don’t cross.'),
  c('twin', 'Twin', 'DOUBLE DIP', 'Before my race, I can pick a racer who won a previous race and race with their powers.',
    'You should still use my racer token!', 'I still get any “before race” powers.'),
] as const satisfies readonly Character[];

export type CharacterId = (typeof CHARACTERS)[number]['id'];
export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((x) => [x.id, x])) as Record<CharacterId, Character>;
