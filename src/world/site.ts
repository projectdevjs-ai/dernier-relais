// Implantation d'un abri : le point de livraison (`at`) peut être sur la chaussée, le BÂTIMENT jamais.
// Fonction pure, partagée par la génération du monde (cells.ts) et par le rendu (repli quand la vue du jeu
// ne transmet pas l'implantation) : mêmes rues, même résultat.
import type { LngLat } from '../core/geo';

export interface Site {
  /** Où poser le bâtiment. */
  site: LngLat;
  /** Cap de la façade, en degrés (0 = nord, sens horaire) : elle regarde la rue la plus proche. */
  facing: number;
}

export const SITE = {
  /**
   * Un vrai lieu assez loin de toute rue garde sa position. 12 m et non 8 : la carte du jeu dessine des chaussées
   * larges (jusqu'à 4,6 m de l'axe au bord) et le bâtiment a près de 6 m de demi-largeur ; à 8 m de l'axe il
   * mordait encore sur la rue (constaté à Paris Châtelet).
   */
  keepM: 12,
  /** Reculs essayés depuis l'axe de la rue (mètres) : 15 m de préférence, 12 ou 18 m si c'est mieux dégagé. */
  offsets: [15, 12, 18],
  /** Recul de dernier recours (carrefour serré). */
  lastM: 22,
  /** Dégagement visé : au-delà, deux emplacements se valent. */
  clearM: 15,
  /** Les rues plus lointaines ne comptent pas. */
  searchM: 160,
} as const;

interface Seg { ax: number; ay: number; bx: number; by: number }

/** Distance du point (x, y) au segment, et point du segment le plus proche (rangé dans `out`). */
function segDist(s: Seg, x: number, y: number, out?: { x: number; y: number }): number {
  const dx = s.bx - s.ax, dy = s.by - s.ay, len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / len)) : 0;
  const px = s.ax + dx * t, py = s.ay + dy * t;
  if (out) { out.x = px; out.y = py; }
  return Math.hypot(x - px, y - py);
}

/**
 * Implantation de l'abri dont le point de livraison est `at`, d'après les tracés de rues `roads`.
 * - vrai lieu (`keep`) à plus de 12 m de l'axe de toute rue : il reste où il est, tourné vers la rue ;
 * - sinon : décalé perpendiculairement à la rue la plus proche, de 12 à 18 m, du côté le mieux dégagé
 *   (sans autre rue) ; à un carrefour, les diagonales sont essayées aussi.
 * Renvoie null s'il n'y a aucune rue à proximité (rien à éviter).
 */
export function shelterSite(at: LngLat, roads: readonly (readonly LngLat[])[], keep = false): Site | null {
  // Repère plan local en mètres : x = est, y = nord.
  const ky = 111320, kx = ky * Math.cos((at[1] * Math.PI) / 180), R = SITE.searchM;
  const segs: Seg[] = [];
  for (const r of roads) {
    for (let i = 0; i < r.length; i++) {
      const bx = (r[i][0] - at[0]) * kx, by = (r[i][1] - at[1]) * ky;
      // Un point isolé compte comme un segment nul ; sinon chaque paire de points voisins.
      const j = i > 0 ? i - 1 : r.length === 1 ? 0 : -1;
      if (j < 0) continue;
      const ax = (r[j][0] - at[0]) * kx, ay = (r[j][1] - at[1]) * ky;
      if (Math.min(ax, bx) > R || Math.max(ax, bx) < -R || Math.min(ay, by) > R || Math.max(ay, by) < -R) continue;
      segs.push({ ax, ay, bx, by });
    }
  }
  if (!segs.length) return null;
  const foot = { x: 0, y: 0 }, tmp = { x: 0, y: 0 };
  const clearance = (x: number, y: number, out?: { x: number; y: number }): number => {
    let best = Infinity;
    for (const s of segs) { const d = segDist(s, x, y, tmp); if (d < best) { best = d; if (out) { out.x = tmp.x; out.y = tmp.y; } } }
    return best;
  };
  let near: Seg = segs[0], d0 = Infinity;
  for (const s of segs) { const d = segDist(s, 0, 0); if (d < d0) { d0 = d; near = s; } }
  if (d0 > R) return null;
  let sx = 0, sy = 0;
  if (!(keep && d0 > SITE.keepM)) {
    segDist(near, 0, 0, foot);
    // Perpendiculaire à la rue la plus proche (segment nul : vers le nord).
    let tx = near.bx - near.ax, ty = near.by - near.ay;
    const tl = Math.hypot(tx, ty);
    if (tl > 0) { tx /= tl; ty /= tl; } else { tx = 1; ty = 0; }
    const nx = -ty, ny = tx;
    let best = -1;
    // Les deux côtés de la rue d'abord, puis les directions intermédiaires (carrefours) ; à dégagement égal, le premier essai gagne.
    const turns = [0, 8, 2, 14, 6, 10, 1, 15, 7, 9, 3, 13, 5, 11, 4, 12];
    for (const off of [...SITE.offsets, SITE.lastM]) {
      for (const k of turns) {
        const a = (k * Math.PI) / 8, c = Math.cos(a), s = Math.sin(a);
        const x = foot.x + (nx * c - ny * s) * off, y = foot.y + (nx * s + ny * c) * off;
        const score = Math.min(SITE.clearM, clearance(x, y));
        if (score > best + 0.5) { best = score; sx = x; sy = y; }
      }
      // Bien dégagé à ce recul : inutile d'aller plus loin.
      if (best >= SITE.offsets[1] - 0.5) break;
    }
  }
  clearance(sx, sy, foot);
  const facing = ((Math.atan2(foot.x - sx, foot.y - sy) * 180) / Math.PI + 360) % 360;
  return { site: [at[0] + sx / kx, at[1] + sy / ky], facing: Math.round(facing * 10) / 10 };
}
