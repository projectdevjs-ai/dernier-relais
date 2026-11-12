// Sauvegarde du jeu : format versionné, stockage du téléphone, et stockage en mémoire pour les tests.
import type { LngLat } from '../core/geo';
import type { CrateKind, SpecialKind } from './api';
import type { Order } from './orders';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'dernier-relais/jeu';

/** Commande connue du joueur (révélée ou portée). Les colis non scannés ne sont pas sauvegardés. */
export type OrderSave = Omit<Order, 'state'> & { state: 'révélé' | 'porté' };
export interface ShelterSave { points: number; deliveries: number }
export interface ContractSave { id: string; progress: number; claimed: boolean }
/** Embouteillage de colis pris par le joueur (en cours ou terminé : il n'est pas reproposé). */
export interface JamSave {
  id: string; shelterId: string; shelterName: string; at: LngLat;
  count: number; delivered: number; minutes: number; bonus: number;
  /** Instant où le lot a été pris (ms). */
  startedAt: number;
  state: 'en cours' | 'réussi' | 'raté';
}
/** Révision du format à l'intérieur de la version 1 : les champs ajoutés sont facultatifs, une sauvegarde plus ancienne se charge telle quelle. */
export const SAVE_REV = 2;

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
  // ── Révision 2 (systèmes secondaires). Absents d'une sauvegarde plus ancienne : valeurs vides.
  rev?: number;
  /** Caches repérées et caches ouvertes, du jour `day`. */
  cachesFound?: string[];
  cachesOpened?: string[];
  /** Rôdeurs déjà rencontrés (l'identifiant contient la tranche horaire). */
  met?: string[];
  jams?: JamSave[];
  /** Colis portés venus de la chaîne de relais : identifiant du colis → identifiant du relais en ligne. */
  relays?: Record<string, string>;
}

export interface GameStore { load(): Promise<GameSave | null>; save(s: GameSave): Promise<void> }

export function emptyGameSave(day = ''): GameSave {
  return {
    version: 1, savedAt: 0, level: 1, xp: 0, skillPoints: 0, score: 0, deliveries: 0, distanceM: 0, stamina: 1,
    skills: {}, shelters: {}, discovered: [], visited: [], day, orders: [], done: [], contracts: [], last: null,
    rev: SAVE_REV, cachesFound: [], cachesOpened: [], met: [], jams: [], relays: {},
  };
}

const num = (v: unknown, d: number, min = 0, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const pt = (v: unknown): LngLat | null =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0], v[1]] : null;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const CRATES: CrateKind[] = ['bois', 'alu', 'plastique', 'carton'];
const SPECIALS: SpecialKind[] = ['batterie', 'boitenoire', 'cryo', 'ruche'];

function jam(v: unknown): JamSave | null {
  const j = obj(v), at = j ? pt(j.at) : null;
  if (!j || !at || typeof j.id !== 'string' || typeof j.shelterId !== 'string') return null;
  return {
    id: j.id, shelterId: j.shelterId, shelterName: typeof j.shelterName === 'string' ? j.shelterName : '', at,
    count: Math.floor(num(j.count, 1, 1)), delivered: Math.floor(num(j.delivered, 0)), minutes: num(j.minutes, 10, 1), bonus: num(j.bonus, 0),
    startedAt: num(j.startedAt, 0), state: j.state === 'réussi' || j.state === 'raté' ? j.state : 'en cours',
  };
}

function order(v: unknown): OrderSave | null {
  const o = obj(v);
  if (!o) return null;
  const at = pt(o.at), destAt = pt(o.destAt);
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.destId !== 'string' || !at || !destAt) return null;
  if (o.state !== 'révélé' && o.state !== 'porté') return null;
  const lost = obj(o.lost);
  // Champs de la révision 2 : écrits seulement s'ils sont présents, pour qu'une commande ordinaire garde sa forme d'origine.
  const extra: Partial<OrderSave> = {};
  if (SPECIALS.includes(o.special as SpecialKind)) extra.special = o.special as SpecialKind;
  if (lost && typeof lost.by === 'string') extra.lost = lost.net === true ? { by: lost.by, net: true } : { by: lost.by };
  if (typeof o.jam === 'string') extra.jam = o.jam;
  if (o.inspected === true) extra.inspected = true;
  if (typeof o.strap === 'number' && Number.isFinite(o.strap)) extra.strap = num(o.strap, 0, 0, 1);
  if (o.front === true) extra.front = true;
  if (typeof o.legM === 'number' && Number.isFinite(o.legM)) extra.legM = num(o.legM, 0, 0);
  if (typeof o.rideM === 'number' && Number.isFinite(o.rideM)) extra.rideM = num(o.rideM, 0, 0);
  return {
    id: o.id, cell: typeof o.cell === 'string' ? o.cell : '', name: o.name, rareName: typeof o.rareName === 'string' ? o.rareName : null,
    crate: CRATES.includes(o.crate as CrateKind) ? (o.crate as CrateKind) : 'carton',
    weightKg: num(o.weightKg, 1, 0), fragile: o.fragile === true, at,
    destId: o.destId, destName: typeof o.destName === 'string' ? o.destName : '', destAt,
    deadlineMin: typeof o.deadlineMin === 'number' && Number.isFinite(o.deadlineMin) ? o.deadlineMin : null,
    baseReward: num(o.baseReward, 5), state: o.state, condition: num(o.condition, 1, 0, 1),
    pickedAt: typeof o.pickedAt === 'number' && Number.isFinite(o.pickedAt) ? o.pickedAt : o.state === 'porté' ? 0 : null,
    ...extra,
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
  const relays: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(o.relays) ?? {})) if (typeof v === 'string' && v) relays[k] = v;
  return {
    version: 1, savedAt: num(o.savedAt, 0), level: Math.max(1, Math.floor(num(o.level, 1))), xp: num(o.xp, 0),
    skillPoints: Math.floor(num(o.skillPoints, 0)), score: num(o.score, 0), deliveries: Math.floor(num(o.deliveries, 0)),
    distanceM: num(o.distanceM, 0), stamina: num(o.stamina, 1, 0, 1), skills, shelters,
    discovered: strs(o.discovered), visited: strs(o.visited), day: typeof o.day === 'string' ? o.day : '',
    orders: (Array.isArray(o.orders) ? o.orders : []).map(order).filter((x): x is OrderSave => x !== null),
    done: strs(o.done), contracts, last: pt(o.last),
    rev: SAVE_REV, cachesFound: strs(o.cachesFound), cachesOpened: strs(o.cachesOpened), met: strs(o.met),
    jams: (Array.isArray(o.jams) ? o.jams : []).map(jam).filter((x): x is JamSave => x !== null),
    relays,
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
