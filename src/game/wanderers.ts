// Rôdeurs : des voyageurs amicaux qui arpentent une rue de leur case.
// Quand la case fournit le tracé de ses rues (`paths`), le rôdeur fait des allers-retours le long d'une
// vraie rue, avec une halte à chaque bout. Sinon (anciennes données), son trajet relie les emplacements
// de colis de la case (toujours posés sur une rue), avec une halte à chacun. Sa position
// ne dépend que de l'heure : tous les joueurs voient le même rôdeur au même endroit au même instant.
import { type LngLat, dist, hash, rng } from '../core/geo';
import type { CellContent } from '../world/types';
import { WANDER } from './rules';

export const WANDER_NAMES = ['Hugo', 'Lina', 'Sacha', 'Yanis', 'Mila', 'Ezra', 'Noor', 'Basile'];
export type GiftKind = 'cache' | 'colis' | 'endurance' | 'xp';

export interface Wanderer {
  id: string; cell: string; name: string;
  /** Tournée fermée : il revient au premier point après le dernier. */
  path: LngLat[];
  /** Longueur de chaque tronçon (path[i] vers path[i+1], le dernier revient au début), en mètres. */
  legs: number[];
  /** Durée de la halte à chaque point de la tournée, en secondes (0 : il passe sans s'arrêter). Absent : halte partout. */
  pauses?: number[];
  /** Durée d'un tour complet, haltes comprises, en secondes. */
  lapS: number;
  /** Décalage de départ dans le tour, en secondes. */
  phaseS: number;
  /** Tirage qui décide du cadeau, entre 0 et 1. */
  roll: number;
}

export const wanderSlot = (ms: number): number => Math.floor(ms / WANDER.slotMs);

/** Longueur minimale (mètres) d'une rue pour qu'un rôdeur l'arpente. */
const MIN_STREET_M = 40;

/**
 * Rôdeur éventuel d'une case pendant une tranche horaire. Il suit une rue de la case si elle en expose
 * (aller-retour, halte aux deux bouts) ; sinon il lui faut au moins deux emplacements de colis pour tracer sa tournée.
 */
export function wandererInCell(c: CellContent, slot: number): Wanderer | null {
  const streets = c.paths?.filter(p => p.length >= 2 && lengthOf(p) >= MIN_STREET_M) ?? [];
  if (!streets.length && c.parcels.length < 2) return null;
  const r = rng(`rôdeur|${c.id}|${slot}`);
  if (r() >= WANDER.chance) return null;
  let path: LngLat[], pauses: number[] | undefined;
  if (streets.length) {
    // Une rue tirée au sort (tirage propre à la case et à la tranche horaire), parcourue aller puis retour.
    const street = streets[hash(`rue|${c.id}|${slot}`) % streets.length];
    path = [...street, ...street.slice(1, -1).reverse()].map(p => [p[0], p[1]] as LngLat);
    pauses = path.map((_, i) => (i === 0 || i === street.length - 1 ? WANDER.pauseS : 0));
  } else {
    path = [...c.parcels].sort((a, b) => (a.id < b.id ? -1 : 1)).map(p => p.at);
  }
  const legs = path.map((p, i) => dist(p, path[(i + 1) % path.length]));
  const total = legs.reduce((a, b) => a + b, 0);
  if (total < 20) return null;
  const lapS = total / WANDER.speed + (pauses ? pauses.reduce((a, b) => a + b, 0) : WANDER.pauseS * path.length);
  const name = WANDER_NAMES[hash(`nom|${c.id}|${slot}`) % WANDER_NAMES.length];
  const w: Wanderer = { id: `rôdeur|${c.id}|${slot}`, cell: c.id, name, path, legs, lapS, phaseS: r() * lapS, roll: r() };
  if (pauses) w.pauses = pauses;
  return w;
}
function lengthOf(p: LngLat[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += dist(p[i - 1], p[i]);
  return d;
}
export function wanderersFor(cells: CellContent[], ms: number): Wanderer[] {
  const slot = wanderSlot(ms), out: Wanderer[] = [];
  for (const c of cells) { const w = wandererInCell(c, slot); if (w) out.push(w); }
  return out;
}

function bearing(a: LngLat, b: LngLat): number {
  const k = Math.PI / 180, x = (b[0] - a[0]) * Math.cos(a[1] * k), y = b[1] - a[1];
  return ((Math.atan2(x, y) / k) + 360) % 360;
}

export interface WanderPose { at: LngLat; headingDeg: number; moving: boolean }
/** Où est le rôdeur à l'instant donné : il s'arrête un moment aux haltes de sa tournée, puis repart. */
export function wandererAt(w: Wanderer, ms: number): WanderPose {
  let s = ((ms / 1000 + w.phaseS) % w.lapS + w.lapS) % w.lapS;
  const n = w.path.length;
  for (let i = 0; i < n; i++) {
    const a = w.path[i], b = w.path[(i + 1) % n], heading = bearing(a, b);
    const pause = w.pauses ? w.pauses[i] : WANDER.pauseS;
    if (s < pause) return { at: [a[0], a[1]], headingDeg: heading, moving: false };
    s -= pause;
    const legS = w.legs[i] / WANDER.speed;
    if (s < legS) { const k = s / legS; return { at: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], headingDeg: heading, moving: true }; }
    s -= legS;
  }
  return { at: [w.path[0][0], w.path[0][1]], headingDeg: 0, moving: false };
}

/** Cadeau du rôdeur : une information s'il y a quelque chose à signaler, sinon de quoi tenir la route. */
export function wanderGift(roll: number, has: { cache: boolean; special: boolean }): GiftKind {
  if (roll < 0.35 && has.cache) return 'cache';
  if (roll < 0.6 && has.special) return 'colis';
  if (roll < 0.6 && has.cache) return 'cache';
  return roll < 0.8 ? 'endurance' : 'xp';
}

const POINTS = ['au nord', 'au nord-est', 'à l’est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l’ouest', 'au nord-ouest'];
/** « à 120 m au nord-est » */
export function whereText(from: LngLat, to: LngLat): string {
  const d = dist(from, to);
  const m = d < 100 ? Math.max(10, Math.round(d / 10) * 10) : Math.round(d / 50) * 50;
  return `à ${m} m ${POINTS[Math.round(bearing(from, to) / 45) % 8]}`;
}
/** Ce que dit le rôdeur. `where` : indication de lieu pour les cadeaux « cache » et « colis ». */
export function wanderLine(gift: GiftKind, where = ''): string {
  switch (gift) {
    case 'cache': return `« Il y a une cache ${where}. Je te la laisse. »`;
    case 'colis': return `« J’ai vu un colis pas comme les autres, ${where}. »`;
    case 'endurance': return '« Tiens, bois un coup. » Endurance +30 %';
    default: return `« Bonne route, porteur. » +${WANDER.xpGift} XP`;
  }
}
