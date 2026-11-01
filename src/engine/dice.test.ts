import { expect, test } from 'vitest';
import { rng } from './dice';

test('same seed gives the same sequence, values in [0,1)', () => {
  const a = rng(42), b = rng(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    expect(x).toBe(b());
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
  }
});
