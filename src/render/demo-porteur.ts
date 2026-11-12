// Démo du porteur seul, grand, de face et de trois quarts, pour juger les animations image par image.
// Paramètres d'URL : ?modele=porteur|porteur_civil|…  &anim=idle|walk|run|calmv0|aucun (aucun = pose de repos du fichier)
//                    &t=1.5 (fige l'animation à cet instant, en secondes)  &planche=10 (10 instants du clip sur une page)
//                    &brut=1 (clips du fichier, sans les corrections du jeu)  &dos=1 (vues de dos et de profil)
//                    &fondu=idle,walk,0.5 (mélange à 50 % entre deux clips)  Sans « t » ni « planche » : lecture en boucle.
import * as THREE from 'three';
import { spawn } from './assets';
import { fixClip } from './pose';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(0x6f7f7a);
renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x54605c, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(2, 4, 3); scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(0.7, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5d6b66 }));
scene.add(ground);
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

const label = (text: string, x: number, y: number): void => {
  const el = document.createElement('div'); el.className = 'lab'; el.textContent = text;
  el.style.left = `${x + 3}px`; el.style.top = `${y + 3}px`; document.body.append(el);
};

/** Dessine le modèle dans une case de l'écran (pixels CSS), caméra tournée de `yaw` autour de lui. */
function draw(x: number, y: number, w: number, h: number, yaw: number): void {
  const H = innerHeight;
  renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
  cam.aspect = w / h; cam.updateProjectionMatrix();
  const dist = Math.max(4.4, 2.5 / cam.aspect);
  cam.position.set(Math.sin(yaw) * dist, 1.25, Math.cos(yaw) * dist); cam.lookAt(0, 0.95, 0);
  renderer.render(scene, cam);
}

const inst = await spawn(q.get('modele') ?? 'porteur', 'perso', { height: 1.75 });
scene.add(inst.root);
const mixer = new THREE.AnimationMixer(inst.root);
// Sans « brut » : le clip passe par la correction du jeu (pose.ts), comme dans Porter et Wanderers.
const find = (name: string): THREE.AnimationClip | undefined => {
  const raw = inst.clips.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!raw || q.has('brut')) return raw;
  return fixClip(inst.root, raw, name === 'walk' ? 'walk' : name === 'run' ? 'run' : 'idle');
};
const fondu = q.get('fondu')?.split(',');
const name = q.get('anim') ?? 'idle';
const clip = find(fondu ? fondu[0] : name);
console.log(`clips du fichier : ${inst.clips.map(c => `${c.name} (${c.duration.toFixed(2)} s)`).join(', ')}`);
if (clip) {
  const a = mixer.clipAction(clip); a.play();
  if (fondu) {
    const other = find(fondu[1]);
    const w = Number(fondu[2] ?? 0.5);
    if (other) { a.setEffectiveWeight(1 - w); mixer.clipAction(other).setEffectiveWeight(w).play(); }
  }
}
const [yawA, yawB] = q.has('dos') ? [Math.PI, Math.PI / 2] : [0, Math.PI / 4.5];
const W = innerWidth, H = innerHeight;
const pose = (t: number): void => { mixer.setTime(t); inst.root.updateMatrixWorld(true); };
const n = Number(q.get('planche') ?? 0);
if (n > 0 && clip) {
  // Planche : n instants répartis sur le clip, chacun de face et de trois quarts (2 instants par ligne).
  const rows = Math.ceil(n / 2), ch = H / rows, cw = W / 4;
  for (let i = 0; i < n; i++) {
    const t = (clip.duration * i) / n, x = (i % 2) * 2 * cw, y = Math.floor(i / 2) * ch;
    pose(t);
    draw(x, y, cw, ch, yawA); draw(x + cw, y, cw, ch, yawB);
    label(`${clip.name} ${t.toFixed(2)} s`, x, y);
  }
} else if (q.has('t')) {
  pose(Number(q.get('t')));
  draw(0, 0, W, H / 2, yawA); draw(0, H / 2, W, H / 2, yawB);
  label(`${clip?.name ?? '—'} ${Number(q.get('t')).toFixed(2)} s`, 0, 0);
} else {
  let last = performance.now();
  const loop = (now: number): void => {
    mixer.update(Math.min(0.1, (now - last) / 1000)); last = now;
    draw(0, 0, W, H / 2, yawA); draw(0, H / 2, W, H / 2, yawB);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
// Mesure objective : écart angulaire de chaque os du bras à sa pose de repos (degrés), aux instants extrêmes du clip.
(window as unknown as { demo: unknown }).demo = { inst, mixer, clip, pose };
