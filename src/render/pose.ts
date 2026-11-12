// Corrections d'allure des personnages animés (squelette Meshy : Shoulder / Arm / ForeArm / Hand de chaque côté).
// Constat (demo-porteur.html?brut=1) : le clip de marche fourni est une démarche « maniérée » — coude plié à angle
// droit, avant-bras ramené devant le ventre, poignet cassé — et le clip d'attente tient les bras écartés du corps,
// mains tournées vers l'extérieur. Ce n'est pas un dégât de compression : la pose est lisse d'une image à l'autre.
// Correction : les pistes des bras sont REFAITES par le calcul, le reste du corps (jambes, bassin, colonne, tête)
// garde l'animation d'origine. Bras le long du corps, balancement opposé aux jambes, poignets droits.
import * as THREE from 'three';

export type PoseKind = 'idle' | 'walk' | 'run';
export interface PoseClips { idle: THREE.AnimationClip | null; walk: THREE.AnimationClip | null; run: THREE.AnimationClip | null }

interface Style {
  /** Écart du bras par rapport au corps (radians). */
  out: number;
  /** Amplitude du balancement avant / arrière (radians). */
  swing: number;
  /** Pli du coude au repos, et pli ajouté quand le bras passe devant (radians). */
  elbow: number; elbowSwing: number;
}
const STYLES: Record<'idle' | 'walk', Style> = {
  idle: { out: 0.1, swing: 0, elbow: 0.16, elbowSwing: 0 },
  walk: { out: 0.09, swing: 0.4, elbow: 0.2, elbowSwing: 0.32 },
};

const done = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();
const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), arc = new THREE.Quaternion();
const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3(), ref = new THREE.Vector3();

/** Clips du porteur (idle, walk, run), corrigés. Le résultat est partagé entre les copies d'un même modèle. */
export function fixClips(root: THREE.Object3D, clips: THREE.AnimationClip[], idleName = 'idle'): PoseClips {
  const get = (name: string, kind: PoseKind): THREE.AnimationClip | null => {
    const clip = clips.find(c => c.name.toLowerCase() === name);
    return clip ? fixClip(root, clip, kind) : null;
  };
  return { idle: get(idleName, 'idle'), walk: get('walk', 'walk'), run: get('run', 'run') };
}

/**
 * Renvoie le clip corrigé. `root` doit être dans sa pose de repos (modèle tout juste instancié).
 * Attente et marche : bras refaits. Course : les bras d'origine sont bons, seuls les poignets sont redressés.
 */
export function fixClip(root: THREE.Object3D, clip: THREE.AnimationClip, kind: PoseKind): THREE.AnimationClip {
  const known = done.get(clip);
  if (known) return known;
  const sides = (['Left', 'Right'] as const).map(side => ({
    shoulder: root.getObjectByName(`${side}Shoulder`), arm: root.getObjectByName(`${side}Arm`),
    fore: root.getObjectByName(`${side}ForeArm`), hand: root.getObjectByName(`${side}Hand`),
  }));
  const footL = root.getObjectByName('LeftFoot'), footR = root.getObjectByName('RightFoot'), hips = root.getObjectByName('Hips');
  let out = clip;
  if (sides.every(s => s.shoulder && s.arm && s.fore && s.hand) && footL && footR && hips) {
    const rig = sides as { shoulder: THREE.Object3D; arm: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }[];
    out = kind === 'run' ? straightWrists(clip, rig.map(s => s.hand)) : rebuildArms(root, clip, STYLES[kind], rig, footL, footR, hips);
  }
  done.set(clip, out);
  return out;
}

/** Course : poignets tenus dans l'axe de l'avant-bras (pose de repos), le reste est inchangé. */
function straightWrists(clip: THREE.AnimationClip, hands: THREE.Object3D[]): THREE.AnimationClip {
  const names = new Set(hands.map(h => `${h.name}.quaternion`));
  const tracks = clip.tracks.filter(t => !names.has(t.name));
  for (const h of hands) tracks.push(new THREE.QuaternionKeyframeTrack(`${h.name}.quaternion`, [0, clip.duration], [...h.quaternion.toArray(), ...h.quaternion.toArray()]));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Oriente l'os pour que son enfant pointe vers `want` (repère monde), en partant de sa pose de repos : aucune torsion ajoutée. */
function aim(bone: THREE.Object3D, rest: THREE.Quaternion, child: THREE.Object3D, want: THREE.Vector3): void {
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  parent.getWorldQuaternion(q);
  q2.copy(q).multiply(rest);                              // orientation monde de l'os s'il restait au repos
  ref.copy(child.position).normalize().applyQuaternion(q2); // direction actuelle de l'os
  arc.setFromUnitVectors(ref, want);
  q2.premultiply(arc);                                    // orientation monde voulue
  bone.quaternion.copy(q.invert().multiply(q2));
  bone.updateWorldMatrix(false, false);
}

function rebuildArms(
  root: THREE.Object3D, clip: THREE.AnimationClip, st: Style,
  rig: { shoulder: THREE.Object3D; arm: THREE.Object3D; fore: THREE.Object3D; hand: THREE.Object3D }[],
  footL: THREE.Object3D, footR: THREE.Object3D, hips: THREE.Object3D,
): THREE.AnimationClip {
  // Pose de repos de tout le squelette : relevée avant l'échantillonnage, rendue ensuite.
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion][] = [];
  root.traverse(o => saved.push([o, o.position.clone(), o.quaternion.clone()]));
  const rest = rig.map(s => ({ shoulder: s.shoulder.quaternion.clone(), arm: s.arm.quaternion.clone(), fore: s.fore.quaternion.clone(), hand: s.hand.quaternion.clone() }));
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  // Côté de chaque bras (vers l'extérieur) et longueur de jambe, dans le repère du modèle (il regarde vers +z).
  const local = (o: THREE.Object3D, v: THREE.Vector3): THREE.Vector3 => root.worldToLocal(o.getWorldPosition(v));
  const hipX = local(hips, a).x, legLen = Math.max(1e-4, Math.abs(local(hips, a).y - local(footL, b).y));
  const sx = rig.map(s => Math.sign(local(s.arm, a).x - hipX) || 1);

  const n = Math.max(16, Math.round(clip.duration * 30));
  const times = new Float32Array(n + 1);
  const values = rig.map(() => ({ shoulder: [] as number[], arm: [] as number[], fore: [] as number[], hand: [] as number[] }));
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  for (let i = 0; i <= n; i++) {
    times[i] = (clip.duration * i) / n;
    // La dernière image reprend la première : la boucle est sans couture.
    mixer.setTime(i === n ? 0 : times[i]);
    root.updateMatrixWorld(true);
    // Phase du pas : le pied droit devant fait avancer le bras gauche, et inversement.
    const stride = THREE.MathUtils.clamp((local(footR, a).z - local(footL, b).z) / (legLen * 0.55), -1, 1);
    rig.forEach((s, k) => {
      const sw = k === 0 ? stride : -stride;
      const ang = st.swing * sw, bend = ang + st.elbow + st.elbowSwing * Math.max(0, sw);
      const co = Math.cos(st.out), so = Math.sin(st.out) * sx[k];
      s.shoulder.quaternion.copy(rest[k].shoulder);
      aim(s.arm, rest[k].arm, s.fore, dir.set(so, -Math.cos(ang) * co, Math.sin(ang) * co).normalize().applyQuaternion(rootQ));
      aim(s.fore, rest[k].fore, s.hand, dir.set(so * 0.4, -Math.cos(bend), Math.sin(bend)).normalize().applyQuaternion(rootQ));
      s.hand.quaternion.copy(rest[k].hand);
      for (const key of ['shoulder', 'arm', 'fore', 'hand'] as const) {
        const list = values[k][key], qq = s[key].quaternion, m = list.length;
        // Même hémisphère que la clé précédente : l'interpolation prend le chemin court.
        const flip = m >= 4 && list[m - 4] * qq.x + list[m - 3] * qq.y + list[m - 2] * qq.z + list[m - 1] * qq.w < 0 ? -1 : 1;
        list.push(qq.x * flip, qq.y * flip, qq.z * flip, qq.w * flip);
      }
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  for (const [o, p, r] of saved) { o.position.copy(p); o.quaternion.copy(r); }
  root.updateMatrixWorld(true);

  const names = new Set<string>();
  const tracks: THREE.KeyframeTrack[] = [];
  rig.forEach((s, k) => {
    for (const key of ['shoulder', 'arm', 'fore', 'hand'] as const) {
      names.add(`${s[key].name}.quaternion`);
      tracks.push(new THREE.QuaternionKeyframeTrack(`${s[key].name}.quaternion`, times, values[k][key]));
    }
  });
  return new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks.filter(t => !names.has(t.name)), ...tracks]);
}
