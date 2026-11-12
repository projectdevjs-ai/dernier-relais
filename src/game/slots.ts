// Emplacements de chargement : dos, bras et jambes (fixations de l'exosquelette), repris de l'ancien jeu.
// Fonctions pures : règles d'emplacement, répartition gauche/droite, stabilité, rangement conseillé.
import type { SpecialKind } from './api';

export type SlotId = 'dos' | 'brasG' | 'brasD' | 'jambeG' | 'jambeD';
export type Limb = 'dos' | 'bras' | 'jambe';
export interface SlotDef {
  id: SlotId; name: string; limb: Limb;
  /** -1 : gauche, 1 : droite, 0 : au centre. */
  side: -1 | 0 | 1;
  /** Poids maximal du colis accroché là ; null pour le dos (limité par la capacité du sac). */
  maxKg: number | null;
  /** Palier d'exosquelette nécessaire. */
  tier: number;
}
export const SLOT_IDS: SlotId[] = ['dos', 'brasG', 'brasD', 'jambeG', 'jambeD'];
export const SLOTS: Record<SlotId, SlotDef> = {
  dos: { id: 'dos', name: 'Dos', limb: 'dos', side: 0, maxKg: null, tier: 0 },
  brasG: { id: 'brasG', name: 'Bras gauche', limb: 'bras', side: -1, maxKg: 12, tier: 1 },
  brasD: { id: 'brasD', name: 'Bras droit', limb: 'bras', side: 1, maxKg: 12, tier: 1 },
  jambeG: { id: 'jambeG', name: 'Jambe gauche', limb: 'jambe', side: -1, maxKg: 9, tier: 2 },
  jambeD: { id: 'jambeD', name: 'Jambe droite', limb: 'jambe', side: 1, maxKg: 9, tier: 2 },
};
export const isSlot = (v: unknown): v is SlotId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(SLOTS, v);

/** Paliers de l'exosquelette, installés par Noé au labo. Le palier 0 est porté dès le départ. */
export interface ExoTier { name: string; desc: string; /** niveau du porteur requis */ level: number; /** compétence qui l'installe (aucune pour le harnais) */ skill: string | null }
export const EXO: ExoTier[] = [
  { name: 'Harnais dorsal', desc: 'Fixations du dos : tes colis voyagent sur ton dos.', level: 1, skill: null },
  { name: 'Attaches de bras', desc: 'Deux fixations aux bras (12 kg chacune). La charge tangue un peu plus.', level: 2, skill: 'exo-bras' },
  { name: 'Attaches de jambes', desc: 'Deux fixations aux cuisses (9 kg chacune). Fatiguent davantage.', level: 4, skill: 'exo-jambes' },
  { name: 'Stabilisateurs gyroscopiques', desc: 'La charge dérive 20 % moins, rafales comprises.', level: 7, skill: 'exo-gyro' },
];
/** Palier installé d'après les rangs de compétences (les paliers s'installent dans l'ordre). */
export function exoTier(ranks: Record<string, number>): number {
  let t = 0;
  for (let i = 1; i < EXO.length; i++) { if ((ranks[EXO[i].skill!] ?? 0) >= 1) t = i; else break; }
  return t;
}

export const SLOT_RULES = {
  /** dénominateur minimal du déséquilibre latéral, en kg (une petite charge ne fait pas pencher) */ leanMinKg: 15,
  /** en dessous (en valeur absolue), la charge est « équilibrée » ; au-delà de `leanBad`, franchement de travers */ leanOk: 0.12, leanBad: 0.3,
  /** fatigue : +100 % pour ce poids porté aux jambes */ legsFatigueKg: 35,
  /** stabilité perdue par kilo aux bras et aux jambes, et pour un sac presque plein */ armsKg: 60, legsKg: 70, fullFrom: 0.7, fullMult: 0.6,
  /** part du déséquilibre latéral dans la stabilité */ leanShare: 0.8,
  /** stabilisateurs gyroscopiques : dérive multipliée */ gyroMult: 0.8,
  /** au-dessus de ce poids, un colis va d'abord au dos */ heavyKg: 9,
} as const;

/** Ce qu'il faut savoir d'un colis pour le ranger. */
export interface Stowed { id: string; weightKg: number; fragile: boolean; special?: SpecialKind; slot?: SlotId }
export interface Rig { /** palier d'exosquelette */ tier: number; /** capacité du dos, en kg */ backKg: number }

const SPECIAL_SLOT: Partial<Record<SpecialKind, { only?: SlotId[]; noLeg?: boolean; why?: string }>> = {
  cryo: { noLeg: true },
  ruche: { noLeg: true },
  batterie: { only: ['dos'], why: 'Dos uniquement : seule la fixation dorsale de l’exosquelette la tient' },
};
/** Contrainte d'emplacement d'un colis spécial, en une phrase (vide s'il n'y en a pas). */
export function specialSlotNote(kind: SpecialKind | undefined): string {
  if (kind === 'cryo' || kind === 'ruche') return 'Jamais sur les jambes.';
  if (kind === 'batterie') return 'Dos uniquement.';
  if (kind === 'boitenoire') return 'Sur le dos, elle est protégée de la pluie.';
  return '';
}

export const slotOf = (p: { slot?: SlotId }): SlotId => p.slot ?? 'dos';
export const kgOf = (list: { weightKg: number }[]): number => list.reduce((a, b) => a + b.weightKg, 0);
/** Vrai si le palier d'exosquelette donne accès à l'emplacement. */
export const slotUnlocked = (k: SlotId, tier: number): boolean => tier >= SLOTS[k].tier;
/** Poids total que le porteur peut emporter : le dos, plus chaque fixation installée. */
export function capacityKg(rig: Rig): number {
  let kg = rig.backKg;
  for (const k of SLOT_IDS) { const s = SLOTS[k]; if (s.maxKg !== null && slotUnlocked(k, rig.tier)) kg += s.maxKg; }
  return kg;
}

/** Pourquoi ce colis ne peut pas aller à cet emplacement, quel que soit ce qui s'y trouve ('' : il peut). */
export function slotRule(p: Stowed, k: SlotId, tier: number): string {
  const s = SLOTS[k], sp = p.special ? SPECIAL_SLOT[p.special] : undefined;
  if (s.limb === 'bras' && tier < 1) return 'Attaches de bras à installer (Noé, au labo)';
  if (s.limb === 'jambe' && tier < 2) return 'Attaches de jambes à installer (Noé, au labo)';
  if (sp?.only && !sp.only.includes(k)) return sp.why ?? 'Pas à cet emplacement';
  if (s.maxKg !== null && p.weightKg > s.maxKg) return `Trop lourd (max ${s.maxKg} kg ici)`;
  if (s.limb === 'jambe' && (p.fragile || sp?.noLeg)) return 'Fragile : les jambes secouent trop';
  return '';
}
/** Pourquoi il n'y a pas la place ('' : il y en a). `bag` : les colis portés (le colis lui-même est ignoré). */
export function slotFull(p: Stowed, k: SlotId, bag: Stowed[], rig: Rig): string {
  const there = bag.filter(b => b.id !== p.id && slotOf(b) === k);
  if (k === 'dos') return kgOf(there) + p.weightKg > rig.backKg ? 'Dos trop chargé' : '';
  return there.length ? 'Emplacement plein' : '';
}
export function slotOk(p: Stowed, k: SlotId, bag: Stowed[], rig: Rig): boolean {
  return !slotRule(p, k, rig.tier) && !slotFull(p, k, bag, rig);
}

export interface Sides { left: number; right: number; legs: number; arms: number; total: number }
/** Poids à gauche, à droite, aux jambes et aux bras. */
export function sideKg(bag: Stowed[]): Sides {
  let left = 0, right = 0, legs = 0, arms = 0, total = 0;
  for (const b of bag) {
    const s = SLOTS[slotOf(b)];
    total += b.weightKg;
    if (s.side < 0) left += b.weightKg;
    if (s.side > 0) right += b.weightKg;
    if (s.limb === 'jambe') legs += b.weightKg;
    if (s.limb === 'bras') arms += b.weightKg;
  }
  return { left, right, legs, arms, total };
}
/** Déséquilibre latéral, de -1 (tout à gauche) à 1 (tout à droite). */
export function lateral(bag: Stowed[]): number {
  const s = sideKg(bag);
  return Math.max(-1, Math.min(1, (s.right - s.left) / Math.max(SLOT_RULES.leanMinKg, s.total || 1)));
}
export type LeanTone = 'good' | 'warn' | 'bad';
export function leanText(lat: number): { text: string; tone: LeanTone } {
  const a = Math.abs(lat);
  return { text: a < SLOT_RULES.leanOk ? 'Équilibré' : lat < 0 ? 'Penche à gauche' : 'Penche à droite', tone: a < SLOT_RULES.leanOk ? 'good' : a < SLOT_RULES.leanBad ? 'warn' : 'bad' };
}
/** Stabilité de la charge, de 0,1 (ça tangue beaucoup) à 1 : même formule que l'ancien jeu. */
export function stability(bag: Stowed[], rig: Rig): number {
  const s = sideKg(bag), R = SLOT_RULES;
  const st = 1 - (Math.abs(s.right - s.left) / Math.max(R.leanMinKg, s.total)) * R.leanShare - s.arms / R.armsKg - s.legs / R.legsKg
    - Math.max(0, s.total / capacityKg(rig) - R.fullFrom) * R.fullMult;
  return Math.max(0.1, Math.min(1, st));
}
/** Multiplicateur de dérive de l'équilibre dû à la répartition : 1 pour une charge stable, davantage quand elle tangue. */
export function loadSwayMult(bag: Stowed[], rig: Rig): number {
  if (!bag.length) return 1;
  return (1.55 / (0.55 + stability(bag, rig))) * (rig.tier >= 3 ? SLOT_RULES.gyroMult : 1);
}
/** Multiplicateur de fatigue dû aux jambes chargées. */
export const legsDrainMult = (bag: Stowed[]): number => 1 + sideKg(bag).legs / SLOT_RULES.legsFatigueKg;

/**
 * Emplacement conseillé : charges lourdes, fragiles ou spéciales au dos, légères aux bras puis aux jambes,
 * côté le plus léger d'abord. null : aucune place.
 */
export function bestSlot(p: Stowed, bag: Stowed[], rig: Rig): SlotId | null {
  const others = bag.filter(b => b.id !== p.id);
  if (kgOf(others) + p.weightKg > capacityKg(rig)) return null;
  const s = sideKg(others), leftFirst = s.left <= s.right;
  const limbs: SlotId[] = leftFirst ? ['brasG', 'brasD', 'jambeG', 'jambeD'] : ['brasD', 'brasG', 'jambeD', 'jambeG'];
  const order: SlotId[] = p.weightKg > SLOT_RULES.heavyKg || p.fragile || p.special ? ['dos', ...limbs] : [limbs[0], limbs[1], 'dos', limbs[2], limbs[3]];
  return order.find(k => slotOk(p, k, others, rig)) ?? null;
}
/** Rangement automatique : emplacement de chaque colis (les colis contraints d'abord, puis les plus lourds). */
export function arrange(bag: Stowed[], rig: Rig): Map<string, SlotId> {
  const items = [...bag].sort((a, b) => (b.special === 'batterie' ? 1 : 0) - (a.special === 'batterie' ? 1 : 0) || b.weightKg - a.weightKg);
  const placed: Stowed[] = [], out = new Map<string, SlotId>();
  for (const it of items) {
    const k = bestSlot({ ...it, slot: undefined }, placed, rig) ?? slotOf(it);
    placed.push({ ...it, slot: k });
    out.set(it.id, k);
  }
  return out;
}
/**
 * Déplacement d'un colis : libre si la place existe, sinon échange avec l'occupant d'une fixation (comme dans l'ancien jeu).
 * Renvoie les nouveaux emplacements, ou la raison du refus.
 */
export function moveTo(p: Stowed, k: SlotId, bag: Stowed[], rig: Rig): { ok: true; moves: [string, SlotId][] } | { ok: false; why: string } {
  const from = slotOf(p);
  if (from === k) return { ok: true, moves: [] };
  const rule = slotRule(p, k, rig.tier);
  if (rule) return { ok: false, why: rule };
  if (!slotFull(p, k, bag, rig)) return { ok: true, moves: [[p.id, k]] };
  const occ = k !== 'dos' ? bag.find(b => b.id !== p.id && slotOf(b) === k) : undefined;
  if (occ) {
    const without = bag.filter(b => b.id !== p.id);
    if (slotOk(occ, from, without, rig)) return { ok: true, moves: [[occ.id, from], [p.id, k]] };
  }
  return { ok: false, why: slotFull(p, k, bag, rig) };
}
