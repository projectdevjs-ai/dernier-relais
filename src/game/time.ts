// Jour et semaine de jeu. Même convention que le monde (src/world/world.ts) : date en temps universel.
export function dayKey(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
/** Date du lundi de la semaine, en temps universel. */
export function weekKey(ms: number): string {
  const d = new Date(ms);
  const back = (d.getUTCDay() + 6) % 7;
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}
/** Instant du prochain changement de jour. */
export function nextDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
