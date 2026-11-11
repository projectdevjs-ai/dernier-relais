// Portage : équilibre de la charge, endurance et usure des colis. Fonctions pures.
import type { CrateKind, WeatherKind } from './api';
import { BALANCE, STAMINA, WEAR } from './rules';

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface BalanceCtx {
  moving: boolean;
  /** Charge portée / capacité, 0 à 1. */
  loadFrac: number;
  windKmh: number;
  /** Multiplicateur des compétences (1 = aucun effet). */
  mult: number;
}
/** Sens de la dérive, entre -1 et 1 : lent va-et-vient, sans hasard. `t` = secondes de marche cumulées. */
export function driftDir(t: number): number { return (Math.sin(t * 0.07) + 0.6 * Math.sin(t * 0.19 + 1.3)) / 1.6; }
/** Équilibre après dtS secondes. Dérive en marchant avec une charge, revient doucement à 0 à l'arrêt. */
export function driftBalance(balance: number, dtS: number, t: number, c: BalanceCtx): number {
  if (c.loadFrac <= 0) return 0;
  if (!c.moving) return balance * Math.exp(-BALANCE.settle * dtS);
  const rate = (BALANCE.base + BALANCE.perLoad * clamp(c.loadFrac, 0, 1) + BALANCE.perWind * clamp(c.windKmh / BALANCE.windFullKmh, 0, 1)) * c.mult;
  return clamp(balance + (driftDir(t) * rate - balance * BALANCE.restore) * dtS, -1, 1);
}
export const isUnbalanced = (balance: number): boolean => Math.abs(balance) > BALANCE.limit;

export interface StaminaCtx {
  moving: boolean; running: boolean; loadFrac: number;
  /** Le joueur est dans un abri. */
  inShelter: boolean;
  /** Avantage de l'abri (3 étoiles), 1 sinon. */
  shelterPerk: number;
  drainMult: number; restMult: number;
}
/** Endurance après dtS secondes. Baisse en marchant selon la charge, remonte à l'arrêt et dans un abri. */
export function nextStamina(stamina: number, dtS: number, c: StaminaCtx): number {
  let rate: number;
  if (c.inShelter) rate = STAMINA.rest * STAMINA.shelterMult * c.shelterPerk * c.restMult;
  else if (c.moving) rate = -(STAMINA.drain + STAMINA.drainLoad * clamp(c.loadFrac, 0, 1)) * (c.running ? STAMINA.runMult : 1) * c.drainMult;
  else rate = STAMINA.rest * c.restMult;
  return clamp(stamina + rate * dtS, 0, 1);
}

export interface WearCtx {
  weather: WeatherKind;
  inDanger: boolean;
  /** Charge déséquilibrée depuis plus longtemps que la tolérance. */
  unbalanced: boolean;
  /** Vitesse au-dessus du seuil de course. */
  running: boolean;
  /** Endurance à 0. */
  exhausted: boolean;
  wearMult: number; dangerMult: number;
}
/** Part d'état perdue par seconde par un colis porté. */
export function wearPerSecond(o: { fragile: boolean; crate: CrateKind }, c: WearCtx): number {
  let perMin = 0;
  const wet = c.weather === 'pluie' ? WEAR.rain : c.weather === 'orage' ? WEAR.storm : c.weather === 'neige' ? WEAR.snow : 0;
  perMin += wet * WEAR.crateWet[o.crate] * (o.fragile ? WEAR.fragile : 1);
  if (c.inDanger) perMin += WEAR.danger * c.dangerMult;
  if (c.unbalanced) perMin += WEAR.unbalanced * (o.fragile ? WEAR.fragileUnbalanced : 1);
  if (c.running && o.fragile) perMin += WEAR.running;
  if (c.exhausted) perMin *= WEAR.exhausted;
  return (perMin * c.wearMult) / 60;
}
