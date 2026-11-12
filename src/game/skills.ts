// Arbre de compétences : 4 branches, 12 compétences à plusieurs rangs, et les trois paliers d'exosquelette
// (branche « portage ») que Noé installe au labo : ils débloquent les emplacements de bras et de jambes.
import type { SkillBranch, SkillView } from './api';
import { BAG_KG, SCAN_COOLDOWN_MIN_S, SCAN_COOLDOWN_S } from './rules';
import { EXO, exoTier } from './slots';

export interface SkillDef {
  id: string; branch: SkillBranch; name: string; desc: string; maxRank: number;
  /** Points de compétence par rang. */
  cost: number;
  /** Prérequis : rang minimal d'une autre compétence. */
  needs?: { id: string; rank: number };
  /** Niveau du porteur requis (paliers d'exosquelette). */
  needsLevel?: number;
  /** Palier d'exosquelette installé par cette compétence. */
  exoTier?: number;
}
/** Un palier d'exosquelette vu comme une compétence : même nom, même description et même niveau requis que dans l'ancien jeu. */
const exo = (tier: number, cost: number, needs?: string): SkillDef => {
  const e = EXO[tier];
  return { id: e.skill!, branch: 'portage', name: e.name, desc: `Noé l’installe au labo. ${e.desc}`, maxRank: 1, cost, needsLevel: e.level, exoTier: tier, ...(needs ? { needs: { id: needs, rank: 1 } } : {}) };
};
export const SKILLS: SkillDef[] = [
  { id: 'scan-portee', branch: 'scanner', name: 'Antenne longue', desc: 'Portée du scanner +40 m par rang.', maxRank: 3, cost: 1 },
  { id: 'scan-recharge', branch: 'scanner', name: 'Condensateur', desc: 'Recharge du scanner −1 s par rang.', maxRank: 3, cost: 1 },
  { id: 'bras-long', branch: 'scanner', name: 'Perche de ramassage', desc: 'Ramassage possible 10 m plus loin par rang.', maxRank: 2, cost: 2, needs: { id: 'scan-portee', rank: 1 } },
  { id: 'sac', branch: 'portage', name: 'Armature renforcée', desc: 'Capacité du sac +5 kg par rang.', maxRank: 4, cost: 1 },
  { id: 'calage', branch: 'portage', name: 'Calage soigné', desc: 'Les colis s’abîment 15 % moins vite par rang.', maxRank: 3, cost: 1, needs: { id: 'sac', rank: 1 } },
  { id: 'sangles', branch: 'portage', name: 'Sangles croisées', desc: 'La charge se déséquilibre 25 % moins vite par rang.', maxRank: 2, cost: 2, needs: { id: 'sac', rank: 2 } },
  exo(1, 1), exo(2, 2, 'exo-bras'), exo(3, 3, 'exo-jambes'),
  { id: 'foulee', branch: 'endurance', name: 'Foulée économe', desc: 'La marche fatigue 15 % de moins par rang.', maxRank: 3, cost: 1 },
  { id: 'souffle', branch: 'endurance', name: 'Second souffle', desc: 'L’endurance revient 25 % plus vite par rang.', maxRank: 2, cost: 1 },
  { id: 'tout-terrain', branch: 'endurance', name: 'Tout-terrain', desc: 'Zones dangereuses : colis 30 % moins abîmés par rang.', maxRank: 2, cost: 2, needs: { id: 'foulee', rank: 1 } },
  { id: 'carnet', branch: 'réseau', name: 'Carnet de route', desc: 'XP des livraisons +10 % par rang.', maxRank: 3, cost: 1 },
  { id: 'relais', branch: 'réseau', name: 'Voix du réseau', desc: 'Points d’abri +10 % par rang.', maxRank: 3, cost: 2 },
  { id: 'reputation', branch: 'réseau', name: 'Bonne réputation', desc: 'Récompenses des contrats +15 % par rang.', maxRank: 2, cost: 2, needs: { id: 'relais', rank: 1 } },
];
const BY_ID = new Map(SKILLS.map(s => [s.id, s]));
export const skillDef = (id: string): SkillDef | undefined => BY_ID.get(id);
export type Ranks = Record<string, number>;
const rank = (r: Ranks, id: string): number => Math.max(0, Math.min(BY_ID.get(id)?.maxRank ?? 0, r[id] ?? 0));

/** Effets cumulés des compétences. */
export interface Mods {
  scanRangeM: number; scanCooldownS: number; pickupBonusM: number; capacityKg: number;
  wearMult: number; balanceMult: number; drainMult: number; restMult: number; dangerMult: number;
  xpMult: number; pointsMult: number; contractMult: number;
  /** Palier d'exosquelette installé, 0 à 3. `capacityKg` est la capacité du dos seul. */
  exoTier: number;
}
export function modsFor(r: Ranks): Mods {
  return {
    scanRangeM: 40 * rank(r, 'scan-portee'),
    scanCooldownS: Math.max(SCAN_COOLDOWN_MIN_S, SCAN_COOLDOWN_S - rank(r, 'scan-recharge')),
    pickupBonusM: 10 * rank(r, 'bras-long'),
    capacityKg: BAG_KG + 5 * rank(r, 'sac'),
    wearMult: 1 - 0.15 * rank(r, 'calage'),
    balanceMult: 1 - 0.25 * rank(r, 'sangles'),
    drainMult: 1 - 0.15 * rank(r, 'foulee'),
    restMult: 1 + 0.25 * rank(r, 'souffle'),
    dangerMult: 1 - 0.3 * rank(r, 'tout-terrain'),
    xpMult: 1 + 0.1 * rank(r, 'carnet'),
    pointsMult: 1 + 0.1 * rank(r, 'relais'),
    contractMult: 1 + 0.15 * rank(r, 'reputation'),
    exoTier: exoTier({ 'exo-bras': rank(r, 'exo-bras'), 'exo-jambes': rank(r, 'exo-jambes'), 'exo-gyro': rank(r, 'exo-gyro') }),
  };
}

/** Pourquoi la compétence ne peut pas être apprise, ou null si elle peut l'être. `level` : niveau du porteur (sans lui, pas de condition de niveau). */
export function learnBlock(id: string, r: Ranks, points: number, level = Infinity): string | null {
  const d = BY_ID.get(id);
  if (!d) return 'Compétence inconnue.';
  if (rank(r, id) >= d.maxRank) return 'Rang maximal déjà atteint.';
  if (d.needs && rank(r, d.needs.id) < d.needs.rank) {
    const n = BY_ID.get(d.needs.id);
    return `Il faut d’abord « ${n?.name ?? d.needs.id} » au rang ${d.needs.rank}.`;
  }
  if (d.needsLevel && level < d.needsLevel) return `Noé l’installera quand tu seras niveau ${d.needsLevel}.`;
  if (points < d.cost) return 'Pas assez de points de compétence.';
  return null;
}
export function skillViews(r: Ranks, points: number, level = Infinity): SkillView[] {
  return SKILLS.map(d => ({
    id: d.id, branch: d.branch, name: d.name, desc: d.desc, rank: rank(r, d.id), maxRank: d.maxRank, cost: d.cost,
    available: learnBlock(d.id, r, points, level) === null,
    ...(d.needsLevel ? { needsLevel: d.needsLevel } : {}), ...(d.exoTier ? { exoTier: d.exoTier } : {}),
  }));
}
