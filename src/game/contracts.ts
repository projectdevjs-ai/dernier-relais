// Contrats du jour et de la semaine, tirés de façon reproductible à partir de la date.
import { rng } from '../core/geo';
import type { ContractView, Grade } from './api';
import { INTACT } from './rules';

export type ContractKind = 'livrer' | 'marcher' | 'notes' | 'fragile' | 'abris' | 'météo' | 'ponctuel';
export interface ContractDef { id: string; period: 'jour' | 'semaine'; kind: ContractKind; label: string; goal: number; reward: number }
export interface ContractState extends ContractDef { progress: number; claimed: boolean }

/** Ce qui fait avancer les contrats. */
export type ProgressEvent =
  | { type: 'livraison'; grade: Grade; fragile: boolean; condition: number; timed: boolean; onTime: boolean; night: boolean; wet: boolean }
  | { type: 'marche'; meters: number }
  | { type: 'abri' };

const s = (n: number): string => (n > 1 ? 's' : '');
const LABEL: Record<ContractKind, (n: number) => string> = {
  livrer: n => `Livrer ${n} colis`,
  marcher: n => `Marcher ${n} km`,
  notes: n => `Obtenir ${n} note${s(n)} A ou S`,
  fragile: n => `Livrer ${n} colis fragile${s(n)} intact${s(n)}`,
  abris: n => `Découvrir ${n} abri${s(n)}`,
  météo: n => `Livrer ${n} colis de nuit ou sous la pluie`,
  ponctuel: n => `Livrer ${n} colis avant la fin du délai`,
};
/** Objectifs possibles par type : [objectif, récompense]. */
const OPTIONS: Record<'jour' | 'semaine', Record<ContractKind, [number, number][]>> = {
  jour: {
    livrer: [[2, 80], [3, 120], [4, 160]], marcher: [[1, 60], [2, 120], [3, 180]], notes: [[1, 70], [2, 140]],
    fragile: [[1, 100]], abris: [[1, 80], [2, 150]], météo: [[1, 90], [2, 170]], ponctuel: [[1, 80], [2, 150]],
  },
  semaine: {
    livrer: [[10, 400], [15, 600], [20, 800]], marcher: [[8, 450], [12, 650], [15, 800]], notes: [[5, 500], [8, 750]],
    fragile: [[3, 450]], abris: [[4, 450], [6, 650]], météo: [[3, 400], [5, 650]], ponctuel: [[4, 450], [6, 650]],
  },
};
const KINDS = Object.keys(LABEL) as ContractKind[];
export const CONTRACT_COUNT = { jour: 3, semaine: 2 } as const;

/** Contrats d'une période. `key` : date du jour, ou du lundi de la semaine. */
export function drawContracts(period: 'jour' | 'semaine', key: string): ContractDef[] {
  const r = rng(`contrats|${period}|${key}`);
  const pool = [...KINDS];
  const out: ContractDef[] = [];
  for (let i = 0; i < CONTRACT_COUNT[period]; i++) {
    const kind = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const opts = OPTIONS[period][kind];
    const [goal, reward] = opts[Math.floor(r() * opts.length)];
    out.push({ id: `${period === 'jour' ? 'j' : 's'}:${key}:${kind}`, period, kind, label: LABEL[kind](goal), goal, reward });
  }
  return out;
}

/** De combien un événement fait avancer un contrat (km pour la marche, unités sinon). */
export function progressFor(kind: ContractKind, e: ProgressEvent): number {
  if (e.type === 'marche') return kind === 'marcher' ? e.meters / 1000 : 0;
  if (e.type === 'abri') return kind === 'abris' ? 1 : 0;
  switch (kind) {
    case 'livrer': return 1;
    case 'notes': return e.grade === 'A' || e.grade === 'S' ? 1 : 0;
    case 'fragile': return e.fragile && e.condition >= INTACT ? 1 : 0;
    case 'météo': return e.night || e.wet ? 1 : 0;
    case 'ponctuel': return e.timed && e.onTime ? 1 : 0;
    default: return 0;
  }
}
export const isDone = (c: ContractState): boolean => c.progress >= c.goal - 1e-9;
/** Fait avancer un contrat. Renvoie vrai s'il vient d'être rempli. */
export function advance(c: ContractState, e: ProgressEvent): boolean {
  if (isDone(c)) return false;
  const add = progressFor(c.kind, e);
  if (add <= 0) return false;
  c.progress = Math.min(c.goal, c.progress + add);
  return isDone(c);
}
export function contractView(c: ContractState, rewardMult = 1): ContractView {
  const done = isDone(c);
  const progress = done ? c.goal : c.kind === 'marcher' ? Math.floor(c.progress * 10) / 10 : Math.floor(c.progress);
  return { id: c.id, period: c.period, label: c.label, progress, goal: c.goal, reward: Math.round(c.reward * rewardMult), done, claimed: c.claimed };
}
