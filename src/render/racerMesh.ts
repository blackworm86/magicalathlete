import { contours } from 'd3-contour';
import * as THREE from 'three';
import { BLOCK, type Block } from '../engine/blocks';
import type { CharacterId } from '../engine/characters';

// A racer miniature is a flat, screen-printed wooden cut-out: we extrude its photo silhouette
// (traced from the PNG's alpha) and print the photo on the faces; the edge is the block colour.
export const BLOCK_HEX: Record<Block, number> = { orange: 0xe8741a, purple: 0x6e3aa8, cyan: 0x25a9cf, green: 0x2f9a45, yellow: 0xf0bb12 };
// Real proportions. A board space is 1 unit. Huge Baby (375 px wide in the photo) is as wide and as thick as
// a whole space, so 375 px = 1 unit; a standard 300 px tall piece is then 0.8 units = 5 cm, and 2 cm thick = 0.32 units.
const PX_PER_UNIT = 375;
const THICKNESS = 0.32;
const MAX_WIDTH = 1.0;
const GRID_H = 110;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
}

// Douglas-Peucker simplification of a closed ring.
function simplify(pts: [number, number][], eps: number): [number, number][] {
  const d = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const rec = (a: number, b: number, out: [number, number][]) => {
    let m = 0, idx = -1;
    for (let i = a + 1; i < b; i++) { const v = d(pts[i], pts[a], pts[b]); if (v > m) { m = v; idx = i; } }
    if (m > eps && idx > 0) { rec(a, idx, out); out.push(pts[idx]); rec(idx, b, out); }
  };
  const out: [number, number][] = [pts[0]];
  const mid = Math.floor(pts.length / 2);
  rec(0, mid, out); out.push(pts[mid]); rec(mid, pts.length - 1, out); out.push(pts[pts.length - 1]);
  return out;
}

/** Outline of the opaque part of an image as a closed polygon in 0..1 coordinates (y up). */
function outline(img: HTMLImageElement): [number, number][] {
  const gh = GRID_H, gw = Math.max(8, Math.round((GRID_H * img.width) / img.height));
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, gw, gh);
  const px = g.getImageData(0, 0, gw, gh).data;
  const W = gw + 2, H = gh + 2; // 1-cell empty border so contours close
  const v = new Float32Array(W * H);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) v[(y + 1) * W + x + 1] = px[(y * gw + x) * 4 + 3] / 255;
  const mp = contours().size([W, H]).thresholds([0.7])(Array.from(v))[0].coordinates as number[][][][];
  let best: number[][] = [];
  for (const poly of mp) if (poly[0].length > best.length) best = poly[0];
  const ring = best.map(([x, y]) => [(x - 1) / gw, 1 - (y - 1) / gh] as [number, number]);
  ring.pop(); // d3 closes rings by repeating the first point
  return simplify(ring, 0.004);
}

const cache = new Map<string, Promise<{ img: HTMLImageElement; tex: THREE.Texture; poly: [number, number][] }>>();
function load(id: CharacterId, base: string) {
  const url = `${base}assets/racers/${id}.png`;
  if (!cache.has(url)) cache.set(url, loadImage(url).then((img) => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
    return { img, tex, poly: outline(img) };
  }));
  return cache.get(url)!;
}

/** Builds the 3D wooden piece for a racer. Origin = bottom centre, standing on the board (y up). */
export async function buildRacer(id: CharacterId, base = import.meta.env.BASE_URL): Promise<THREE.Mesh> {
  const { img, tex, poly } = await load(id, base);
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  let w = img.width / PX_PER_UNIT, h = img.height / PX_PER_UNIT;
  if (w > MAX_WIDTH) { h *= MAX_WIDTH / w; w = MAX_WIDTH; }
  const depth = id === 'huge_baby' ? w : THICKNESS; // Huge Baby is as thick as it is wide: a whole space
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(-0.5, 0, -depth / 2); // centre horizontally, centre thickness on z
  geo.scale(w, h, 1);
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 });
  const side = new THREE.MeshStandardMaterial({ color: BLOCK_HEX[BLOCK[id]], roughness: 0.6, metalness: 0 });
  const m = new THREE.Mesh(geo, [face, side]);
  m.castShadow = true;
  m.userData = { width: w, height: h, depth };
  return m;
}
