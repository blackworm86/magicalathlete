import { expect, test } from 'vitest';
import { d6, rng } from './dice';

test('same seed gives same rolls, all within 1..6', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) {
    const x = d6(a);
    expect(x).toBe(d6(b));
    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(6);
  }
});
