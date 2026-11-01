import * as THREE from 'three';
import { CHARACTERS } from './engine/characters';
import { buildRacer } from './render/racerMesh';

// Gallery of all 36 miniatures (temporary: the real board scene comes next).
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2160);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-3, 8, 6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 6.5, 17);
camera.lookAt(0, 3.2, 0);

const group = new THREE.Group();
scene.add(group);
const cols = 9;
const ang = Number(new URLSearchParams(location.search).get('rot') ?? 0.5);
Promise.all(CHARACTERS.map((c) => buildRacer(c.id))).then((meshes) => {
  meshes.forEach((m, i) => {
    m.position.set((i % cols - (cols - 1) / 2) * 1.9, (3 - Math.floor(i / cols)) * 2.1, 0);
    m.rotation.y = ang;
    group.add(m);
  });
  document.title = 'ready';
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
