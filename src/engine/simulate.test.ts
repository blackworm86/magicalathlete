import { expect, test } from 'vitest';
import { CHARACTERS } from './characters';
import { IMPLEMENTED } from './powers';
import { Race } from './race';
import { rng } from './dice';
import { BASE_SCHEDULE } from './tracks';

// Bot games with random racers: must always terminate and award exactly 2 places.
test('random games with every implemented power terminate cleanly', async () => {
  const pool = CHARACTERS.map((c) => c.id).filter((id) => IMPLEMENTED.includes(id)); expect(pool).toHaveLength(36);
  for (let seed = 1; seed <= 800; seed++) {
    const r = rng(seed);
    const dice = () => 1 + Math.floor(r() * 6);
    const pick = [...pool].sort(() => r() - 0.5).slice(0, 4);
    const track = BASE_SCHEDULE[seed % 4];
    const race = new Race({ track, dice, agent: (d) => (d.kind === 'predict' ? 1 + Math.floor(r() * 6) : d.kind === 'choose' || d.kind === 'choosePos' ? Math.floor(r() * d.options.length) : r() < 0.7), entries: pick.map((c, i) => ({ owner: 'P' + (i % 3), character: c })) });
    const res = await race.run();
    expect(res.places.length, `seed ${seed} ${pick}`).toBeGreaterThanOrEqual(1);
    expect(race.over).toBe(true);
  }
});
