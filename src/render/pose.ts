// Corrections d'allure des personnages animés (squelette Meshy : Shoulder / Arm / ForeArm / Hand de chaque côté).
// Constat (demo-porteur.html?brut=1) : le clip de marche fourni est une démarche « maniérée » — coude plié à angle
// droit, avant-bras ramené devant le ventre, poignet cassé — et le clip d'attente tient les bras écartés du corps,
// mains tournées vers l'extérieur. Ce n'est pas un dégât de compression : la pose est lisse d'une image à l'autre.
// Correction : les pistes des bras sont REFAITES par le calcul, le reste du corps (jambes, bassin, colonne, tête)
// garde l'animation d'origine. Bras le long du corps, balancement opposé aux jambes, poignets droits.
// Second constat (demo-porteur.html?anim=idle&t=0.5&vues=180,130&main=Right&recul=2, vue de dos comme en jeu) :
// le squelette n'a PAS d'os de doigts (la main est un seul os, les doigts sont figés dans le maillage), et la main
// gardait son orientation de repos par rapport à l'avant-bras : une fois le bras baissé, la paume regardait vers
// l'arrière et la main s'enfonçait dans la poche de cuisse — de dos, on voyait un moignon tordu. Correction :
// l'axe des doigts et la normale de la paume sont MESURÉS sur le maillage (sommets liés à l'os de la main), puis
// la main est mise dans l'axe de l'avant-bras, paume vers la cuisse (rotation répartie entre bras et avant-bras,
// comme une vraie pronation), et le bras est écarté juste assez pour que la main ne touche plus la poche.
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
  idle: { out: 0.17, swing: 0, elbow: 0.2, elbowSwing: 0 },
  walk: { out: 0.15, swing: 0.4, elbow: 0.22, elbowSwing: 0.32 },
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

/** Repère d'une main dans le repère de son os : `f` = axe poignet → doigts, `n` = normale de la paume (côté paume). */
interface HandFrame { f: THREE.Vector3; n: THREE.Vector3 }
const pv = new THREE.Vector3(), pm = new THREE.Matrix4();

/**
 * Mesure la main sur le maillage : les sommets surtout liés à l'os `hand`, ramenés dans son repère.
 * L'axe des doigts va du poignet au centre de ces sommets ; la paume est la direction où la main est la plus mince.
 * `palm` (repère de l'os, pose de repos) indique grossièrement de quel côté est la paume, pour fixer le signe.
 */
function handFrame(root: THREE.Object3D, hand: THREE.Object3D, palm: THREE.Vector3): HandFrame | null {
  const pts: THREE.Vector3[] = [];
  root.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const idx = mesh.skeleton.bones.indexOf(hand as THREE.Bone);
    const pos = mesh.geometry.getAttribute('position'), si = mesh.geometry.getAttribute('skinIndex'), sw = mesh.geometry.getAttribute('skinWeight');
    if (idx < 0 || !pos || !si || !sw) return;
    pm.multiplyMatrices(mesh.skeleton.boneInverses[idx], mesh.bindMatrix);
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === idx) w += sw.getComponent(i, c);
      if (w > 0.6) pts.push(pv.fromBufferAttribute(pos, i).applyMatrix4(pm).clone());
    }
  });
  if (pts.length < 12) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  const f = c.multiplyScalar(1 / pts.length).clone().normalize();
  // Épaisseur de la main dans le plan perpendiculaire aux doigts : la plus petite des deux directions est la paume.
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(f.x) > 0.8) u.set(0, 1, 0);
  u.addScaledVector(f, -u.dot(f)).normalize();
  const v = new THREE.Vector3().crossVectors(f, u);
  let mu = 0, mv = 0;
  for (const p of pts) { mu += p.dot(u); mv += p.dot(v); }
  mu /= pts.length; mv /= pts.length;
  let cuu = 0, cvv = 0, cuv = 0;
  for (const p of pts) { const a2 = p.dot(u) - mu, b2 = p.dot(v) - mv; cuu += a2 * a2; cvv += b2 * b2; cuv += a2 * b2; }
  const th = 0.5 * Math.atan2(2 * cuv, cuu - cvv) + Math.PI / 2; // +90° : la direction la plus mince
  const n = u.multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).normalize();
  if (n.dot(palm) < 0) n.negate();
  return { f, n };
}

/** Fait tourner l'os autour de l'axe `axis` (repère monde) de `angle` radians. */
function twist(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  bone.parent!.getWorldQuaternion(q);
  bone.getWorldQuaternion(q2).premultiply(arc.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(q.invert().multiply(q2));
  bone.updateWorldMatrix(false, true);
}

const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3(), pd = new THREE.Vector3();
/** Angle (radians, autour de `axis`) qui amène la paume de la main vers `want` (repère monde). */
function palmError(hand: THREE.Object3D, fr: HandFrame, axis: THREE.Vector3, want: THREE.Vector3): number {
  hand.getWorldQuaternion(q);
  pa.copy(fr.n).applyQuaternion(q).addScaledVector(axis, -pa.dot(axis));
  pb.copy(want).addScaledVector(axis, -want.dot(axis));
  if (pa.lengthSq() < 1e-6 || pb.lengthSq() < 1e-6) return 0;
  pa.normalize(); pb.normalize();
  return Math.atan2(pc.crossVectors(pa, pb).dot(axis), pa.dot(pb));
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
  // Repère de chaque main, mesuré sur le maillage au repos. Au repos (bras en T ou en A) la paume regarde le sol.
  const frames = rig.map(s => {
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(rootQ).applyQuaternion(s.hand.getWorldQuaternion(new THREE.Quaternion()).invert());
    return handFrame(root, s.hand, down);
  });

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
      const foreDir = new THREE.Vector3(so * 0.55, -Math.cos(bend), Math.sin(bend)).normalize().applyQuaternion(rootQ);
      aim(s.fore, rest[k].fore, s.hand, dir.copy(foreDir));
      s.hand.quaternion.copy(rest[k].hand);
      const fr = frames[k];
      if (fr) {
        // Paume vers la cuisse, un rien vers l'arrière (main détendue) : la moitié de la rotation est prise par
        // le bras, le reste par l'avant-bras ; le poignet lui-même ne se tord pas.
        const want = pd.set(-sx[k], 0, -0.3).normalize().applyQuaternion(rootQ);
        s.arm.updateWorldMatrix(true, true);
        const e1 = palmError(s.hand, fr, foreDir, want);
        s.fore.getWorldPosition(a); s.arm.getWorldPosition(b);
        twist(s.arm, a.sub(b).normalize(), e1 * 0.5);
        aim(s.fore, rest[k].fore, s.hand, dir.copy(foreDir));
        s.fore.updateWorldMatrix(false, true);
        twist(s.fore, foreDir, palmError(s.hand, fr, foreDir, want));
        // Poignet dans l'axe : les doigts prolongent l'avant-bras, à peine fléchis vers la paume.
        s.hand.getWorldQuaternion(q2);
        ref.copy(fr.f).applyQuaternion(q2);
        b.copy(foreDir).addScaledVector(want, 0.12).normalize();
        q2.premultiply(arc.setFromUnitVectors(ref, b));
        s.fore.getWorldQuaternion(q);
        s.hand.quaternion.copy(q.invert().multiply(q2));
      }
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
