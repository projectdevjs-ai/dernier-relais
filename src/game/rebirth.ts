// PROJECT REBIRTH — survie et combats tactiques, déterministes et jouables hors connexion.
import { hash } from '../core/geo';

export type Resource = 'scrap' | 'circuits' | 'rations' | 'medkits' | 'charges';
export type Resources = Record<Resource, number>;
export type Faction = 'lumen' | 'nomades' | 'archives';
export type Factions = Record<Faction, number>;
export type Recipe = 'ration' | 'medkit' | 'charge' | 'repair';
export type CombatMove = 'strike' | 'guard' | 'pulse' | 'evade';
export type EnemyKind = 'scavenger' | 'drone' | 'stray';
export interface Encounter {
  id: string; kind: EnemyKind; name: string; title: string; subtitle: string;
  turn: number; hp: number; maxHp: number; guard: number; last: string;
}
export interface Rebirth {
  resources: Resources; factions: Factions; integrity: number;
  encounter: Encounter | null; victories: number;
}
export const DEFAULT_RESOURCES: Resources = { scrap: 3, circuits: 1, rations: 2, medkits: 1, charges: 0 };
export const DEFAULT_FACTIONS: Factions = { lumen: 0, nomades: 0, archives: 0 };
export const RECIPES: Record<Recipe, { title: string; desc: string; cost: Partial<Resources> }> = {
  ration: { title: 'Ration de terrain', desc: 'Transforme des matériaux en nourriture de survie.', cost: { scrap: 2 } },
  medkit: { title: 'Trousse médicale', desc: 'Soigne les blessures et restaure ton intégrité.', cost: { scrap: 3, circuits: 1 } },
  charge: { title: 'Impulsion EMP', desc: 'Neutralise les systèmes et affaiblit les ennemis.', cost: { scrap: 2, circuits: 2 } },
  repair: { title: 'Renforcer l’armure', desc: 'Répare immédiatement 30 points d’intégrité.', cost: { scrap: 3 } },
};
export const ENEMIES: Record<EnemyKind, { name: string; title: string; subtitle: string; hp: number; damage: number; faction: Faction }> = {
  scavenger: { name: 'Récupérateur', title: 'LES FERRAILLEURS', subtitle: 'Une bande rôde dans cette zone. Leurs armes sont rudimentaires, mais efficaces.', hp: 42, damage: 11, faction: 'nomades' },
  drone: { name: 'Drone de surveillance', title: 'PROTOCOL // SENTINEL', subtitle: 'Une IA militaire oubliée verrouille ta position. L’EMP peut la désactiver.', hp: 34, damage: 13, faction: 'archives' },
  stray: { name: 'Errant', title: 'LES SILHOUETTES', subtitle: 'Un inconnu s’approche à travers la brume. Il n’a pas l’air amical.', hp: 48, damage: 9, faction: 'lumen' },
};
export function kindFor(id: string): EnemyKind { return (['scavenger', 'drone', 'stray'] as const)[hash(id) % 3]; }
export function spawnEncounter(id: string): Encounter {
  const kind = kindFor(id), data = ENEMIES[kind];
  return { id, kind, name: data.name, title: data.title, subtitle: data.subtitle, turn: 0,
    hp: data.hp, maxHp: data.hp, guard: 0, last: 'Menace détectée. Choisis ta stratégie.' };
}
export function freshRebirth(): Rebirth {
  return { resources: { ...DEFAULT_RESOURCES }, factions: { ...DEFAULT_FACTIONS },
    integrity: 100, encounter: null, victories: 0 };
}
export function cleanRebirth(raw: unknown): Rebirth {
  const x = raw && typeof raw === 'object' ? raw as Partial<Rebirth> : {};
  const finite = (v: unknown, base: number, cap: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(cap, Math.floor(v))) : base;
  const resources = { ...DEFAULT_RESOURCES }, factions = { ...DEFAULT_FACTIONS };
  for (const k of Object.keys(resources) as Resource[]) resources[k] = finite(x.resources?.[k], resources[k], 9999);
  for (const k of Object.keys(factions) as Faction[]) factions[k] =
    typeof x.factions?.[k] === 'number' && Number.isFinite(x.factions[k])
      ? Math.max(-100, Math.min(100, Math.floor(x.factions[k]))) : 0;
  let encounter: Encounter | null = null;
  const e = x.encounter;
  if (e && typeof e.id === 'string' && e.id.length < 200 && ['scavenger','drone','stray'].includes(e.kind)) {
    const data = ENEMIES[e.kind];
    encounter = { id: e.id, kind: e.kind, name: data.name, title: data.title, subtitle: data.subtitle,
      turn: finite(e.turn, 0, 100), hp: finite(e.hp, data.hp, data.hp), maxHp: data.hp,
      guard: finite(e.guard, 0, 100), last: typeof e.last === 'string' ? e.last.slice(0, 160) : '' };
  }
  return { resources, factions, integrity: finite(x.integrity, 100, 100),
    encounter, victories: finite(x.victories, 0, 1000000) };
}
export function canCraft(s: Rebirth, recipe: Recipe): boolean {
  return Object.entries(RECIPES[recipe].cost).every(([k,v]) => s.resources[k as Resource] >= (v ?? 0))
    && (recipe !== 'repair' || s.integrity < 100);
}
export function craft(s: Rebirth, recipe: Recipe): Rebirth | null {
  if (!canCraft(s, recipe)) return null;
  const n = cleanRebirth(s);
  for (const [k,v] of Object.entries(RECIPES[recipe].cost)) n.resources[k as Resource] -= v ?? 0;
  if (recipe === 'ration') n.resources.rations++;
  if (recipe === 'medkit') n.resources.medkits++;
  if (recipe === 'charge') n.resources.charges++;
  if (recipe === 'repair') n.integrity = Math.min(100, n.integrity + 30);
  return n;
}
export interface BattleResult { state: Rebirth; outcome: 'continue' | 'victory' | 'escape' | 'defeat' | 'invalid'; message: string; }
export function combat(s: Rebirth, move: CombatMove): BattleResult {
  const n = cleanRebirth(s), e = n.encounter;
  if (!e) return { state: n, outcome: 'invalid', message: 'Aucune rencontre active.' };
  if (!['strike','guard','pulse','evade'].includes(move)) return { state:n, outcome:'invalid', message:'Action inconnue.' };
  if (move === 'pulse' && n.resources.charges === 0) return { state:n, outcome:'invalid', message:'Aucune charge EMP dans le sac.' };
  e.turn++;
  if (move === 'evade') {
    const escaped = (hash(e.id + ':escape:' + e.turn) % 100) < 65 || e.turn >= 4;
    if (escaped) { n.encounter = null; return { state:n, outcome:'escape', message:'Retraite réussie. Le secteur reste dangereux.' }; }
    e.last = 'Retraite impossible : la menace coupe ton itinéraire.';
  } else if (move === 'guard') {
    e.guard = 1;
    e.last = 'Position défensive : prochaine attaque amortie.';
  } else if (move === 'pulse') {
    n.resources.charges--;
    const damage = e.kind === 'drone' ? 31 : 19;
    e.hp = Math.max(0, e.hp - damage);
    e.last = 'Impulsion déclenchée : -' + damage + ' intégrité ennemie.';
  } else {
    const damage = 10 + (hash(e.id + ':hit:' + e.turn) % 7);
    e.hp = Math.max(0, e.hp - damage);
    e.last = 'Coup porté : -' + damage + ' intégrité ennemie.';
  }
  if (e.hp <= 0) {
    n.encounter = null; n.victories++;
    n.resources.scrap += 2 + hash(e.id) % 3;
    if (e.kind === 'drone') n.resources.circuits++;
    const faction = ENEMIES[e.kind].faction;
    n.factions[faction] = Math.max(-100, n.factions[faction] - 2);
    return { state:n, outcome:'victory', message:'Menace neutralisée. Matériaux récupérés, mais ta réputation auprès de cette faction diminue.' };
  }
  const base = ENEMIES[e.kind].damage;
  const incoming = Math.max(1, base + (hash(e.id + ':counter:' + e.turn) % 5) - (e.guard ? 8 : 0));
  e.guard = 0;
  n.integrity = Math.max(0, n.integrity - incoming);
  e.last += ' Contre-attaque : -' + incoming + ' intégrité.';
  if (!n.integrity) { n.integrity = 30; n.encounter = null;
    return { state:n, outcome:'defeat', message:'Système de secours activé. Tu survis, mais ton équipement est endommagé.' }; }
  return { state:n, outcome:'continue', message:e.last };
}
