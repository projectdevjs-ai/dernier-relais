// TEMPORAIRE : planche de contrôle des modèles.
import * as THREE from 'three';
import { Viewport, Loader3D } from './kit';
const q = new URLSearchParams(location.search);
const names = (q.get('m') ?? 'teleporteur,exo_rack,holo_table,lab_console,lit_repos,med_bay').split(',');
const yaw = Number(q.get('yaw') ?? 0.5);
const vp = new Viewport(document.body, { post: false });
const sc = new THREE.Scene(); sc.background = new THREE.Color(0x30383a);
sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(3, 5, 4); sc.add(d);
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const L = new Loader3D();
const cols = 2, rows = Math.ceil(names.length / cols);
Promise.all(names.map(n => L.load(n, { height: 2 }))).then(ms => {
  ms.forEach((m, i) => {
    const g = new THREE.Group(); g.add(m.root); g.rotation.y = yaw;
    g.position.set((i % cols) * 4.2, -Math.floor(i / cols) * 3, 0); sc.add(g);
    // repère : flèche rouge = +Z du modèle (l'avant supposé)
    const ar = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.02, 0), 1.6, 0xff3030); g.add(ar);
    const mixer = new THREE.AnimationMixer(m.root); const an = q.get('a'); const c = m.clips.find(c => c.name === an);
    if (c) { const a = mixer.clipAction(c); a.play(); a.paused = true; a.time = Number(q.get('at') ?? 0) * (names.length > 1 ? (i / (names.length - 1)) : 1) * (q.has('frac') ? c.duration : 1); mixer.update(0); }
  });
  const cx = (cols - 1) * 2.1, cy = -(rows - 1) * 1.5 + 1;
  cam.position.set(cx, cy + 2.5, 16 + rows * 2.2); cam.lookAt(cx, cy, 0);
  vp.render(sc, cam, 0); console.log('fiche ok');
});
