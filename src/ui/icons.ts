// Icônes de l'interface : un seul style (grille 24, trait 1,8, bouts ronds), dessinées à la main.
const P = {
  scan: '<circle cx="12" cy="12" r="1.8"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>',
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  crate: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.2"/>',
  shelter: '<path d="M3.5 11.5L12 4.5l8.5 7M6 10v9.5h12V10M10 19.5v-5h4v5"/>',
  bag: '<path d="M8.5 7V5.5A2.5 2.5 0 0 1 11 3h2a2.5 2.5 0 0 1 2.5 2.5V7M6.5 7h11A1.5 1.5 0 0 1 19 8.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5A1.5 1.5 0 0 1 6.5 7zM9 13h6"/>',
  bolt: '<path d="M13 3L5.5 13.5H11L10 21l8-10.5h-5.5z"/>',
  xp: '<path d="M12 3l6.5 9-6.5 9-6.5-9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  weight: '<path d="M9 7.5a3 3 0 1 1 6 0M6.5 9.5h11l2 10.5h-15z"/>',
  fragile: '<path d="M8 3.5h8l-.7 6a3.3 3.3 0 0 1-6.6 0zM12 12.8V20M8.5 20h7"/>',
  star: '<path d="M12 3.4l2.65 5.5 6.05.8-4.45 4.2 1.1 6-5.35-2.9-5.35 2.9 1.1-6L3.3 9.7l6.05-.8z"/>',
  lock: '<rect x="5.5" y="11" width="13" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  gps: '<path d="M12 3.5l6.5 16-6.5-3.8-6.5 3.8z"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  moon: '<path d="M19.5 14.2A8 8 0 1 1 9.8 4.5a6.5 6.5 0 0 0 9.7 9.7z"/>',
  cloud: '<path d="M7.5 18h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.1 4.5 4.5 0 0 0 7.5 18z"/>',
  rain: '<path d="M7.5 15h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 6.1 4.5 4.5 0 0 0 7.5 15zM8.5 18l-1 2.8M12.5 18l-1 2.8M16.5 18l-1 2.8"/>',
  storm: '<path d="M7.5 15h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 6.1 4.5 4.5 0 0 0 7.5 15zM12.8 16.5l-2.3 3h3L11.5 22.5"/>',
  snow: '<path d="M7.5 15h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 6.1 4.5 4.5 0 0 0 7.5 15zM8.5 18.6v.01M12 20.8v.01M15.5 18.6v.01"/>',
  fog: '<path d="M7.5 14h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 5.1 4.5 4.5 0 0 0 7.5 14zM5 17.5h14M8 21h8"/>',
  network: '<circle cx="5.5" cy="6" r="2"/><circle cx="18.5" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7.5 6h9M6.5 7.8l4.5 8.4M17.5 7.8L13 16.2"/>',
  contract: '<path d="M9 3.5h6v3H9zM9 5H6.5a1 1 0 0 0-1 1v13.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H15M9 13.5l2 2 4-4.5"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13.5H8a3 3 0 0 1-3-3zM5 17.5a3 3 0 0 1 3-3h11M9 8.5h6"/>',
  sliders: '<path d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9"/><circle cx="15.2" cy="7.5" r="2.2"/><circle cx="8.8" cy="16.5" r="2.2"/>',
  drop: '<path d="M12 4v10M8 10.5l4 4 4-4M5 19.5h14"/>',
  pickup: '<path d="M12 15V5M8 8.5l4-4 4 4M5 19.5h14"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>',
  warn: '<path d="M12 4l9 15.5H3zM12 10v4.5M12 17.3v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.01"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.9M12 16.8v.01"/>',
  shield: '<path d="M12 3.5l7 2.5v5.3c0 4.4-2.9 7.7-7 9.2-4.1-1.5-7-4.8-7-9.2V6zM9 12l2.2 2.2L15.2 10"/>',
  arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
  // Systèmes secondaires
  special: '<path d="M12 2.8l7.2 9.2-7.2 9.2L4.8 12z"/><path d="M12 8.3l2.9 3.7-2.9 3.7L9.1 12z"/>',
  cache: '<path d="M4.5 10.5a4 4 0 0 1 4-4h7a4 4 0 0 1 4 4v8h-15zM4.5 12.5h15M12 11v3.2"/>',
  walker: '<circle cx="13" cy="4.6" r="1.8"/><path d="M13 8.2l-3.2 2.2-.9 3.6M13 8.2l1 5 3.2 2.3.8 4.4M14 13.2l-2.4 3.2-2.4 3.5M13.5 9.6l3.7 2.2"/>',
  front: '<path d="M3 9h10.5a2.5 2.5 0 1 0-2.4-3.2M3 13h15.5a2.6 2.6 0 1 1-2.5 3.3M3 17h7.5"/>',
  stack: '<path d="M4 20.5v-6h7v6zM13 20.5v-6h7v6zM8.5 14.5v-6h7v6zM3 20.5h18"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.6A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>',
  ear: '<path d="M7.5 10a4.5 4.5 0 0 1 9 0c0 3-2.6 3.4-2.6 6a2.6 2.6 0 0 1-4.8 1.4M10 10.2a2 2 0 0 1 4 0M19 5.5a8 8 0 0 1 1.3 4.5M4.9 5.6a8 8 0 0 0-1.2 4.4"/>',
  strap: '<rect x="7" y="8" width="10" height="8" rx="1.5"/><path d="M2.5 12H7M17 12h4.5M12 8v8"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
} as const;

export type IconName = keyof typeof P;

/** Crée une icône SVG décorative (masquée aux lecteurs d'écran). `filled` remplit la forme. */
export function icon(name: IconName, cls = ''): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="dr-ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
