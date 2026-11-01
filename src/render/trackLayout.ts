// Shared 2D geometry of the board, in tile units (1 tile = 1x1). No imports on purpose:
// used by both the SVG generator script and the 3D scene.
// Layout: START box top-left (cols 0-2), spaces 1..12 across the top (cols 3..14),
// 13..14 down the right edge, 15..29 back along the bottom (cols 14..0), finish podium at left.
export const COLS = 15;
export const ROWS = 4;

export function tileCenter(i: number): { x: number; y: number } {
  if (i === 0) return { x: 1.5, y: 0.5 };
  if (i <= 12) return { x: i + 2 + 0.5, y: 0.5 };
  if (i <= 14) return { x: 14.5, y: i - 12 + 0.5 };
  if (i <= 29) return { x: 29 - i + 0.5, y: 3.5 };
  return { x: 0.5, y: 2 }; // finish podium
}

// Unit vector of the direction of travel on the tile (used to orient arrows).
export function travelDir(i: number): { dx: number; dy: number } {
  if (i <= 12) return { dx: 1, dy: 0 };
  if (i <= 14) return { dx: 0, dy: 1 };
  return { dx: -1, dy: 0 };
}
