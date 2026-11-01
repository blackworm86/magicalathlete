// Generates vector versions of both tracks from the track data: public/assets/maps/*.svg
// Run: node --experimental-strip-types scripts/gen-track-svg.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { MILD_MILE, WILD_WILDS, type Track } from '../src/engine/tracks.ts';
import { COLS, ROWS, tileCenter, travelDir } from '../src/render/trackLayout.ts';

const U = 80; // px per tile
const FILL = { p: '#e96fc0', y: '#f5b82e', g: '#3f9f3f', b: '#4a9be8', r: '#ee4422' };
const PURPLE = '#7a3fb8';

function tile(t: Track, i: number): string {
  const { x, y } = tileCenter(i);
  const cx = x * U, cy = y * U, s = U - 8;
  const sp = t.spaces[i];
  const box = (fill: string, stroke = '#000') =>
    `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
  if (sp.type === 'plain') {
    const label = i % 5 === 0 && t.id === 'mild'
      ? `<text x="${cx}" y="${cy + 10}" text-anchor="middle" font-size="30" font-weight="900" fill="${FILL[sp.color === 'r' ? 'b' : 'r']}">${i}</text>` : '';
    return box(FILL[sp.color]) + label;
  }
  if (sp.type === 'star') return box('#ffd23f', PURPLE) + `<polygon points="${star(cx, cy, 26, 11)}" fill="#ee4422" stroke="#000" stroke-width="2"/><text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="26" font-weight="900" fill="#fff">${sp.amount}</text>`;
  if (sp.type === 'trip') return box('#ee4422', PURPLE) + `<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="22" font-weight="900" fill="#fff" stroke="#000" stroke-width="1">TRIP!</text>`;
  if (sp.type === 'arrow') {
    const d = travelDir(i), sg = Math.sign(sp.amount), ax = d.dx * sg, ay = d.dy * sg;
    const rot = Math.atan2(ay, ax) * 180 / Math.PI;
    return box('#3f9f3f', PURPLE) + `<g transform="translate(${cx} ${cy}) rotate(${rot})"><polygon points="-26,-12 4,-12 4,-22 28,0 4,22 4,12 -26,12" fill="#f5b82e" stroke="#000" stroke-width="2"/></g><text x="${cx}" y="${cy + 8}" text-anchor="middle" font-size="22" font-weight="900" fill="#000">${Math.abs(sp.amount)}</text>`;
  }
  return '';
}
function star(cx: number, cy: number, R: number, r: number) {
  return Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? r : R; return `${(cx + q * Math.cos(a)).toFixed(1)},${(cy + q * Math.sin(a)).toFixed(1)}`; }).join(' ');
}

function svg(t: Track): string {
  const W = COLS * U, H = ROWS * U;
  const start = tileCenter(0);
  const body = t.spaces.slice(1).map((_, k) => tile(t, k + 1)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 ${W + 40} ${H + 40}" font-family="Arial Black, Impact, sans-serif">
<rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" rx="60" fill="#000"/>
<rect x="${U + 4}" y="${U + 4}" width="${(COLS - 2) * U - 8}" height="${(ROWS - 2) * U - 8}" fill="#111" stroke="#fff" stroke-width="3"/>
<rect x="0" y="0" width="${3 * U - 6}" height="${U - 8}" rx="30" fill="#4a9be8" stroke="#fff" stroke-width="3" transform="translate(4 4)"/>
<text x="${start.x * U}" y="${start.y * U + 14}" text-anchor="middle" font-size="40" font-weight="900" fill="#ee4422" font-style="italic">START</text>
<rect x="8" y="${U + 20}" width="${U * 1.7}" height="${U * 2 - 40}" rx="30" fill="#f5b82e" stroke="#fff" stroke-width="3"/>
<text x="${U * 0.9}" y="${U * 1.9}" text-anchor="middle" font-size="22" fill="#000">1ST</text>
<text x="${U * 0.9}" y="${U * 2.5}" text-anchor="middle" font-size="22" fill="#000">2ND</text>
<text x="${W / 2}" y="${H / 2 + 24}" text-anchor="middle" font-size="86" font-weight="900" fill="#fff">${t.name.toUpperCase()}</text>
${body}
</svg>
`;
}

mkdirSync('public/assets/maps', { recursive: true });
for (const t of [MILD_MILE, WILD_WILDS]) writeFileSync(`public/assets/maps/${t.id}.svg`, svg(t));
console.log('wrote public/assets/maps/{mild,wild}.svg');
