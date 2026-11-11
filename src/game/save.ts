// Sauvegarde du jeu : format versionné, stockage du téléphone, et stockage en mémoire pour les tests.
import type { LngLat } from '../core/geo';
import type { CrateKind } from './api';
import type { Order } from './orders';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'dernier-relais/jeu';

/** Commande connue du joueur (révélée ou portée). Les colis non scannés ne sont pas sauvegardés. */
export type OrderSave = Omit<Order, 'state'> & { state: 'révélé' | 'porté' };
export interface ShelterSave { points: number; deliveries: number }
export interface ContractSave { id: string; progress: number; claimed: boolean }

export interface GameSave {
  version: 1;
  /** Instant de la sauvegarde (ms). */
  savedAt: number;
  level: number;
  /** XP dans le niveau en cours. */
  xp: number;
  skillPoints: number;
  score: number;
  deliveries: number;
  distanceM: number;
  stamina: number;
  /** Rang de chaque compétence apprise. */
  skills: Record<string, number>;
  /** Progression par abri. */
  shelters: Record<string, ShelterSave>;
  /** Abris déjà approchés. */
  discovered: string[];
  /** Cases déjà parcourues (brume d'exploration). */
  visited: string[];
  /** Jour de jeu auquel se rapportent `orders` (révélés) et `done`. */
  day: string;
  orders: OrderSave[];
  /** Colis livrés aujourd'hui : ils ne réapparaissent pas. */
  done: string[];
  /** Contrats en cours ; l'identifiant contient le jour ou la semaine. */
  contracts: ContractSave[];
  last: LngLat | null;
}

export interface GameStore { load(): Promise<GameSave | null>; save(s: GameSave): Promise<void> }

export function emptyGameSave(day = ''): GameSave {
  return {
    version: 1, savedAt: 0, level: 1, xp: 0, skillPoints: 0, score: 0, deliveries: 0, distanceM: 0, stamina: 1,
    skills: {}, shelters: {}, discovered: [], visited: [], day, orders: [], done: [], contracts: [], last: null,
  };
}

const num = (v: unknown, d: number, min = 0, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const pt = (v: unknown): LngLat | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const CRATES: CrateKind[] = ['bois', 'alu', 'plastique', 'carton'];

function order(v: unknown): OrderSave | null {
  const o = obj(v);
  if (!o) return null;
  const at = pt(o.at), destAt = pt(o.destAt);
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.destId !== 'string' || !at || !destAt) return null;
  if (o.state !== 'révélé' && o.state !== 'porté') return null;
  return {
    id: o.id, cell: typeof o.cell === 'string' ? o.cell : '', name: o.name, rareName: typeof o.rareName === 'string' ? o.rareName : null,
    crate: CRATES.includes(o.crate as CrateKind) ? (o.crate as CrateKind) : 'carton',
    weightKg: num(o.weightKg, 1, 0), fragile: o.fragile === true, at,
    destId: o.destId, destName: typeof o.destName === 'string' ? o.destName : '', destAt,
    deadlineMin: typeof o.deadlineMin === 'number' && Number.isFinite(o.deadlineMin) ? o.deadlineMin : null,
    baseReward: num(o.baseReward, 5), state: o.state, condition: num(o.condition, 1, 0, 1),
    pickedAt: typeof o.pickedAt === 'number' && Number.isFinite(o.pickedAt) ? o.pickedAt : o.state === 'porté' ? 0 : null,
  };
}

/** Lit une sauvegarde venue du stockage : null si elle est illisible ou d'une autre version, valeurs douteuses corrigées. */
export function parseGameSave(raw: unknown): GameSave | null {
  const o = obj(raw);
  if (!o || o.version !== SAVE_VERSION) return null;
  const skills: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.skills) ?? {})) skills[k] = Math.floor(num(v, 0));
  const shelters: Record<string, ShelterSave> = {};
  for (const [k, v] of Object.entries(obj(o.shelters) ?? {})) {
    const s = obj(v);
    if (s) shelters[k] = { points: num(s.points, 0), deliveries: Math.floor(num(s.deliveries, 0)) };
  }
  const contracts: ContractSave[] = [];
  for (const v of Array.isArray(o.contracts) ? o.contracts : []) {
    const c = obj(v);
    if (c && typeof c.id === 'string') contracts.push({ id: c.id, progress: num(c.progress, 0), claimed: c.claimed === true });
  }
  return {
    version: 1, savedAt: num(o.savedAt, 0), level: Math.max(1, Math.floor(num(o.level, 1))), xp: num(o.xp, 0),
    skillPoints: Math.floor(num(o.skillPoints, 0)), score: num(o.score, 0), deliveries: Math.floor(num(o.deliveries, 0)),
    distanceM: num(o.distanceM, 0), stamina: num(o.stamina, 1, 0, 1), skills, shelters,
    discovered: strs(o.discovered), visited: strs(o.visited), day: typeof o.day === 'string' ? o.day : '',
    orders: (Array.isArray(o.orders) ? o.orders : []).map(order).filter((x): x is OrderSave => x !== null),
    done: strs(o.done), contracts, last: pt(o.last),
  };
}

/** Stockage du téléphone. Ne lève jamais d'erreur : sans stockage, le jeu continue sans sauvegarde. */
export class LocalGameStore implements GameStore {
  constructor(private key: string = SAVE_KEY) {}
  async load(): Promise<GameSave | null> {
    try { return parseGameSave(JSON.parse(localStorage.getItem(this.key) ?? 'null')); } catch { return null; }
  }
  async save(s: GameSave): Promise<void> {
    try { localStorage.setItem(this.key, JSON.stringify(s)); } catch { /* stockage plein ou indisponible */ }
  }
}

/** Stockage en mémoire, pour les tests. Passe par le même format texte que le vrai stockage. */
export class MemoryGameStore implements GameStore {
  /** Nombre d'écritures reçues. */
  writes = 0;
  private text: string | null;
  constructor(initial: GameSave | null = null) { this.text = initial ? JSON.stringify(initial) : null; }
  async load(): Promise<GameSave | null> {
    try { return this.text === null ? null : parseGameSave(JSON.parse(this.text)); } catch { return null; }
  }
  async save(s: GameSave): Promise<void> { this.text = JSON.stringify(s); this.writes++; }
  /** Dernière sauvegarde reçue, telle qu'elle serait relue. */
  peek(): GameSave | null { return this.text === null ? null : parseGameSave(JSON.parse(this.text)); }
}
