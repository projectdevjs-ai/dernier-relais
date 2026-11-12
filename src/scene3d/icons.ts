// Icônes des deux scènes : même style que l'interface du jeu (grille 24, trait 1,8, bouts ronds), dessinées à la main.
const P = {
  /** Le Passeur : un anneau sur son socle. */
  passeur: '<circle cx="12" cy="10.5" r="6.5"/><circle cx="12" cy="10.5" r="2.6"/><path d="M4 20.5h16M8 17.2l-1.5 3.3M16 17.2l1.5 3.3"/>',
  /** Exosquelette : tête, colonne, épaules, jambes. */
  exo: '<circle cx="12" cy="4.8" r="1.9"/><path d="M12 7.5v7M7 9.2h10M7 9.2v5M17 9.2v5M12 14.5l-3 2.2V21M12 14.5l3 2.2V21"/>',
  /** Table holographique : le réseau au-dessus du plateau. */
  holo: '<path d="M4 17.5h16M7 17.5l1.5 3h7l1.5-3M6.5 14l5.5-9.5L17.5 14"/><circle cx="12" cy="4.5" r="1.3"/><circle cx="8.2" cy="11" r="1.1"/><circle cx="15.8" cy="11" r="1.1"/>',
  /** Console : écran et clavier. */
  console: '<rect x="4" y="4.5" width="16" height="10" rx="1.5"/><path d="M7.5 9.5l2 2 3.5-4M3 19.5h18M9 14.5l-1 5M15 14.5l1 5"/>',
  /** Lit : couchette et oreiller. */
  lit: '<path d="M3.5 18.5v-8M3.5 15h17v3.5M20.5 15v-1.5a3 3 0 0 0-3-3H11V15"/><circle cx="7.2" cy="11.8" r="1.6"/>',
  parler: '<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7L8 20v-3.500H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z"/>',
  passer: '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>',
  retour: '<path d="M14.5 5.500l-6.500 6.500 6.500 6.500"/>',
  suivant: '<path d="M9.500 5.500l6.500 6.500-6.500 6.500"/>',
  partir: '<path d="M12 3.500l6.500 16-6.500-3.800-6.500 3.800z"/>',
  fleche: '<path d="M5 12h13M13 6.500l5.500 5.500-5.500 5.500"/>',
  scanner: '<circle cx="12" cy="12" r="1.8"/><path d="M8.600 8.600a4.800 4.800 0 0 0 0 6.800M15.400 8.600a4.800 4.800 0 0 1 0 6.800M5.600 5.600a9 9 0 0 0 0 12.800M18.400 5.600a9 9 0 0 1 0 12.800"/>',
  portage: '<path d="M8.500 7V5.500A2.500 2.500 0 0 1 11 3h2a2.500 2.500 0 0 1 2.500 2.500V7M6.500 7h11A1.500 1.500 0 0 1 19 8.500V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.500A1.500 1.500 0 0 1 6.500 7zM9 13h6"/>',
  endurance: '<path d="M13 3L5.500 13.500H11L10 21l8-10.500h-5.500z"/>',
  reseau: '<circle cx="5.500" cy="6" r="2"/><circle cx="18.500" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.500 6h9M6.500 7.800l4.500 8.400M17.500 7.800L13 16.200"/>',
} as const;

export type IconName = keyof typeof P;

export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls ? `s3-ic ${cls}` : 's3-ic');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = P[name];
  return svg;
}
