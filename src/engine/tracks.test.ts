import { expect, test } from 'vitest';
import { MILD_MILE, WILD_WILDS } from './tracks';

test('both tracks have start + 29 squares, finish at 30', () => {
  for (const t of [MILD_MILE, WILD_WILDS]) {
    expect(t.spaces).toHaveLength(30);
    expect(t.finish).toBe(30);
    expect(t.spaces[0].type).toBe('start');
  }
});

test('Mild Mile has no special spaces', () => {
  expect(MILD_MILE.spaces.slice(1).every((s) => s.type === 'plain')).toBe(true);
});

test('Wild Wilds specials match the physical board', () => {
  const at = (i: number) => WILD_WILDS.spaces[i];
  expect([1, 13].map((i) => at(i).type)).toEqual(['star', 'star']);
  expect([5, 17, 26].map((i) => at(i).type)).toEqual(['trip', 'trip', 'trip']);
  const arrows = Object.fromEntries(WILD_WILDS.spaces.flatMap((s, i) => (s.type === 'arrow' ? [[i, s.amount]] : [])));
  expect(arrows).toEqual({ 7: 3, 11: 1, 16: -4, 23: 2, 24: -2 });
});
