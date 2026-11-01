import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CharacterId } from '../engine/characters';
import type { Track, Color } from '../engine/tracks';
import { tileCenter, travelDir } from './trackLayout';
import { buildRacer } from './racerMesh';

const TILE: Record<Color, number> = { p: 0xe96fc0, y: 0xf5b82e, g: 0x3f9f3f, b: 0x4a9be8, r: 0xee4422 };
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** World position (x,z) of a tile; tile 30 is the finish podium. */
export function tilePos(i: number) { const c = tileCenter(i); return new THREE.Vector3(c.x - 7.5, 0.1, c.y - 2); }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number) {
  g.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, q = k % 2 ? r : R; g[k ? 'lineTo' : 'moveTo'](cx + q * Math.cos(a), cy + q * Math.sin(a)); }
  g.closePath();
}

function specialTex(track: Track, i: number) {
  const sp = track.spaces[i];
  return canvasTex(128, 128, (g) => {
    g.fillStyle = sp.type === 'star' ? '#ffd23f' : sp.type === 'trip' ? '#ee4422' : '#3f9f3f';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#7a3fb8'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
    g.textAlign = 'center'; g.font = '900 34px Arial Black, Arial';
    if (sp.type === 'star') {
      starPath(g, 64, 64, 50, 22); g.fillStyle = '#ee4422'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
      g.fillStyle = '#fff'; g.fillText(String(sp.amount), 64, 76);
    } else if (sp.type === 'trip') {
      g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 4; g.font = '900 38px Arial Black, Arial';
      g.strokeText('TRIP!', 64, 76); g.fillText('TRIP!', 64, 76);
    } else if (sp.type === 'arrow') {
      const d = travelDir(i), sg = Math.sign(sp.amount); // screen direction of the arrow
      g.save(); g.translate(64, 64); g.rotate(Math.atan2(d.dy * sg, d.dx * sg));
      g.beginPath(); g.moveTo(-44, -18); g.lineTo(6, -18); g.lineTo(6, -38); g.lineTo(48, 0); g.lineTo(6, 38); g.lineTo(6, 18); g.lineTo(-44, 18); g.closePath();
      g.fillStyle = '#f5b82e'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke(); g.restore();
      g.fillStyle = '#000'; g.fillText(String(Math.abs(sp.amount)), 64, 77);
    }
  });
}

export interface RacerView {
  id: number; owner: string; character: CharacterId;
  group: THREE.Group; mesh: THREE.Mesh | null; disc: THREE.Mesh; ring: THREE.Mesh;
  pos: number; // tile currently shown
  place: number; // 0 = racing, 1/2 = finished on podium, -1 = eliminated
}

export class BoardScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  speed = 1;
  racers = new Map<number, RacerView>();
  private board = new THREE.Group();
  private tweens = new Set<(dt: number) => boolean>();
  private last = performance.now();

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x14173f);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-5, 12, 8); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 6, bottom: -6, near: 1, far: 30 });
    this.scene.add(sun, this.board);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 8.6, 7.4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0.5);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 5; this.controls.maxDistance = 22;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize(host);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(host = this.renderer.domElement.parentElement!) {
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // keep the whole board (about 16.4 units wide) in view
    const hfov = 2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
    const dist = Math.max(11, 8.4 / Math.tan(hfov / 2));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 0.74, 0.67).multiplyScalar(dist));
  }

  private frame() {
    const now = performance.now(), dt = Math.min(0.25, (now - this.last) / 1000) * this.speed;
    this.last = now;
    for (const t of [...this.tweens]) if (!t(dt)) this.tweens.delete(t);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Run `fn(t)` for t in 0..1 over `seconds` (scaled by speed). */
  tween(seconds: number, fn: (t: number) => void): Promise<void> {
    return new Promise((done) => {
      let el = 0;
      this.tweens.add((dt) => { el += dt; const t = Math.min(1, el / seconds); fn(t); if (t >= 1) { done(); return false; } return true; });
    });
  }

  // ---- board -----------------------------------------------------------------------------
  setTrack(track: Track) {
    this.board.clear();
    for (const r of this.racers.values()) this.scene.remove(r.group);
    this.racers.clear();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(15.8, 0.3, 4.8), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 }));
    slab.position.set(0, -0.2, 0); slab.receiveShadow = true;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12.9, 0.05, 1.9), new THREE.MeshStandardMaterial({ map: canvasTex(1024, 150, (g) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, 1024, 150); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '900 110px Arial Black, Arial'; g.fillText(track.name.toUpperCase(), 512, 112);
    }) }));
    panel.position.set(0.5, -0.02, 0); panel.receiveShadow = true;
    this.board.add(slab, panel);
    const box = (w: number, d: number, mats: THREE.Material | THREE.Material[], x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), mats); m.position.set(x, 0, z); m.receiveShadow = true; this.board.add(m);
    };
    const start = tilePos(0);
    box(2.85, 0.9, new THREE.MeshStandardMaterial({ map: canvasTex(256, 96, (g) => { g.fillStyle = '#4a9be8'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#ee4422'; g.font = 'italic 900 62px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('START', 128, 70); }) }), start.x, start.z);
    const fin = tilePos(30);
    box(0.9, 1.9, new THREE.MeshStandardMaterial({ map: canvasTex(96, 200, (g) => { g.fillStyle = '#f5b82e'; g.fillRect(0, 0, 96, 200); g.fillStyle = '#000'; g.textAlign = 'center'; g.font = '900 26px Arial Black'; g.fillText('1ST', 48, 70); g.fillText('2ND', 48, 140); }) }), fin.x, fin.z);
    for (let i = 1; i < track.finish; i++) {
      const sp = track.spaces[i], p = tilePos(i);
      const mat = sp.type === 'plain' ? new THREE.MeshStandardMaterial({ color: TILE[sp.color], roughness: 0.55 }) : new THREE.MeshStandardMaterial({ map: specialTex(track, i), roughness: 0.55 });
      const side = new THREE.MeshStandardMaterial({ color: 0x151515 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.92), [side, side, mat, side, side, side]);
      m.position.set(p.x, 0, p.z); m.receiveShadow = true; this.board.add(m);
      if (track.id === 'mild' && i % 5 === 0) {
        const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(64, 64, (g) => { g.fillStyle = '#fff'; g.font = '900 44px Arial Black'; g.textAlign = 'center'; g.fillText(String(i), 32, 48); }) }));
        label.rotation.x = -Math.PI / 2; label.position.set(p.x, 0.09, p.z); this.board.add(label);
      }
    }
  }

  async addRacer(id: number, owner: string, character: CharacterId, color: number, pos: number) {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 28), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    disc.position.y = 0.03; disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; ring.visible = false;
    group.add(disc, ring);
    const rv: RacerView = { id, owner, character, group, mesh: null, disc, ring, pos, place: 0 };
    this.racers.set(id, rv);
    this.scene.add(group);
    buildRacer(character).then((mesh) => {
      const s = 1.0; mesh.scale.multiplyScalar(s); mesh.position.y = 0.06; group.add(mesh); rv.mesh = mesh;
    });
    this.layout();
  }

  /** Slot (x offset, z offset) of a racer among those sharing its tile. */
  private slotOffsets(): Map<number, THREE.Vector3> {
    const out = new Map<number, THREE.Vector3>();
    const byTile = new Map<number, RacerView[]>();
    for (const r of this.racers.values()) { if (r.place < 0) continue; const k = r.place ? 100 + r.place : r.pos; (byTile.get(k) ?? byTile.set(k, []).get(k)!).push(r); }
    for (const list of byTile.values()) list.forEach((r, i) => out.set(r.id, new THREE.Vector3((i - (list.length - 1) / 2) * Math.min(0.36, 0.9 / list.length), 0, (i % 2) * 0.1)));
    return out;
  }
  private basePos(r: RacerView) {
    if (r.place) { const p = tilePos(30); p.z += r.place === 1 ? -0.5 : 0.5; return p; }
    return tilePos(r.pos);
  }
  layout() {
    const off = this.slotOffsets();
    for (const r of this.racers.values()) {
      if (r.place < 0) continue;
      r.group.position.copy(this.basePos(r)).add(off.get(r.id) ?? new THREE.Vector3());
      r.group.position.y = r.place ? 0.1 : 0.1;
    }
  }
  setActive(id: number | null) { for (const r of this.racers.values()) r.ring.visible = r.id === id; }

  // ---- animations ------------------------------------------------------------------------
  async hop(r: RacerView, from: number, to: number, slide = false) {
    const steps: number[] = []; const dir = Math.sign(to - from);
    for (let i = from; i !== to; i += dir) steps.push(i + dir);
    const per = slide ? 0.5 : Math.min(0.26, 1.6 / Math.max(1, steps.length));
    r.pos = from; this.layout();
    let cur = r.group.position.clone();
    for (const s of steps) {
      const target = tilePos(s);
      const a = cur.clone();
      await this.tween(per, (t) => {
        r.group.position.set(a.x + (target.x - a.x) * t, 0.1 + (slide ? 0 : Math.sin(t * Math.PI) * 0.45), a.z + (target.z - a.z) * t);
      });
      cur = target; r.pos = s;
    }
    r.pos = to; this.layout();
  }

  async warp(r: RacerView, to: number) {
    await this.tween(0.25, (t) => r.group.scale.setScalar(1 - t));
    r.pos = to; this.layout();
    await this.tween(0.25, (t) => r.group.scale.setScalar(t));
  }

  async finishAt(r: RacerView, place: number) {
    const from = r.group.position.clone();
    r.place = place;
    const off = this.slotOffsets().get(r.id) ?? new THREE.Vector3();
    const to = this.basePos(r).add(off);
    await this.tween(0.6, (t) => r.group.position.set(from.x + (to.x - from.x) * t, 0.1 + Math.sin(t * Math.PI) * 0.8, from.z + (to.z - from.z) * t));
    this.layout();
  }

  async setTripped(r: RacerView, down: boolean) {
    const a = r.group.rotation.x, b = down ? -Math.PI / 2 + 0.05 : 0;
    await this.tween(0.3, (t) => { r.group.rotation.x = a + (b - a) * t; });
  }
  async bounce(r: RacerView) { await this.tween(0.35, (t) => { r.group.position.y = 0.1 + Math.sin(t * Math.PI) * 0.5; }); }
  async eliminate(r: RacerView) { r.place = -1; await this.tween(0.5, (t) => { r.group.scale.setScalar(1 - t); r.group.rotation.y = t * 6; }); r.group.visible = false; }
}
