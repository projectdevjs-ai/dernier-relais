// Niveaux du joueur.
import { xpNeeded } from './rules';

export interface Progress { level: number; xp: number }
/** Ajoute de l'XP et fait monter les niveaux. `gained` = nombre de niveaux gagnés. */
export function addXp(p: Progress, amount: number): Progress & { gained: number } {
  let level = Math.max(1, p.level), xp = p.xp + Math.max(0, amount), gained = 0;
  while (xp >= xpNeeded(level)) { xp -= xpNeeded(level); level++; gained++; }
  return { level, xp, gained };
}
