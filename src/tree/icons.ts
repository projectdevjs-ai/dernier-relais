// Pictogrammes de l'arbre de compétences : grille 24, trait rond, dessinés à la main.
// Un seul tracé par icône : il sert à la fois au SVG de l'interface et aux textures de la scène 3D.
import type { SkillBranch } from '../game/api';

const ring = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICON = {
  scanner: `${ring(12, 12, 1.8)}M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8`,
  portage: 'M8.5 7V5.5A2.5 2.5 0 0 1 11 3h2a2.5 2.5 0 0 1 2.5 2.5V7M6.5 7h11A1.5 1.5 0 0 1 19 8.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5A1.5 1.5 0 0 1 6.5 7zM9 13h6',
  endurance: 'M3 12.5h4l2-5 3.5 10 2.5-7 1.5 2H21',
  reseau: `${ring(5.5, 6, 2)}${ring(18.5, 6, 2)}${ring(12, 18, 2)}M7.5 6h9M6.5 7.8l4.5 8.4M17.5 7.8L13 16.2`,
  cadenas: 'M8 11V8.2a4 4 0 0 1 8 0V11M6.8 11h10.4a1.3 1.3 0 0 1 1.3 1.3v6.9a1.3 1.3 0 0 1-1.3 1.3H6.8a1.3 1.3 0 0 1-1.3-1.3v-6.9A1.3 1.3 0 0 1 6.8 11zM12 14.6v2.4',
  fermer: 'M6 6l12 12M18 6L6 18',
  coche: 'M5 12.5l4.5 4.5L19 7.5',
  point: 'M12 3l7 9-7 9-7-9z',
  fleche: 'M5 12h13M13 6.5l5.5 5.5-5.5 5.5',
} as const;
export type IconName = keyof typeof ICON;

export const BRANCH_ICON: Record<SkillBranch, IconName> = { scanner: 'scanner', portage: 'portage', endurance: 'endurance', 'réseau': 'reseau' };

export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls ? `tr-ic ${cls}` : 'tr-ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON[name]);
  svg.appendChild(p);
  return svg;
}

/** Dessine l'icône en blanc, centrée, dans un canvas carré (texture de la scène). */
export function drawIcon(g: CanvasRenderingContext2D, name: IconName, size: number, lineWidth = 2): void {
  g.save();
  g.clearRect(0, 0, size, size);
  const k = (size * 0.86) / 24;
  g.translate(size * 0.07, size * 0.07);
  g.scale(k, k);
  g.strokeStyle = '#fff';
  g.lineWidth = lineWidth;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke(new Path2D(ICON[name]));
  g.restore();
}
