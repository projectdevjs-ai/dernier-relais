// Petits outils DOM partagés par l'interface : création d'éléments, écritures « seulement si ça change »,
// listes à clés (pour ne jamais reconstruire une liste entière à chaque rendu) et formats d'affichage.
import type { LngLat } from '../core/geo';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const k of kids) if (k) el.append(k);
  return el;
}

/** Bouton natif (type=button). `aria` sert d'étiquette quand le bouton n'a qu'une icône. */
export function btn(cls: string, aria: string | null, ...kids: Child[]): HTMLButtonElement {
  const b = h('button', cls, ...kids);
  b.type = 'button';
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}

export function setText(el: Element, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}
export function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
export function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}
export function show(el: HTMLElement, on: boolean): void {
  if (el.hidden === on) el.hidden = !on;
}
export function setDisabled(el: HTMLButtonElement, off: boolean): void {
  if (el.disabled !== off) el.disabled = off;
}

export interface Row<T> { el: HTMLElement; update(item: T): void }

/** Liste dont chaque ligne est gardée d'un rendu à l'autre grâce à sa clé. */
export class KeyedList<T> {
  private rows = new Map<string, Row<T>>();
  constructor(private host: HTMLElement, private key: (item: T) => string, private create: (item: T) => Row<T>) {}
  sync(items: T[]): void {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const k = this.key(item);
      seen.add(k);
      let row = this.rows.get(k);
      if (!row) { row = this.create(item); this.rows.set(k, row); }
      row.update(item);
      if (this.host.children[i] !== row.el) this.host.insertBefore(row.el, this.host.children[i] ?? null);
    });
    for (const [k, row] of this.rows) if (!seen.has(k)) { row.el.remove(); this.rows.delete(k); }
  }
}

// ---------- Formats ----------
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m < 100 ? m : m / 5) * (m < 100 ? 1 : 5)} m`;
  return `${nf1.format(m / 1000)} km`;
}
export function fmtKg(kg: number): string { return `${nf1.format(kg)} kg`; }
export function fmtInt(n: number): string { return nf0.format(Math.round(n)); }
export function fmtPct(x: number): string { return `${Math.round(x * 100)} %`; }
/** Délai restant, court. null = pas de délai. */
export function fmtDelay(min: number | null): string {
  if (min === null) return 'Sans délai';
  const a = Math.abs(Math.round(min));
  const t = a >= 60 ? `${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}` : `${a} min`;
  return min < 0 ? `Retard ${t}` : t;
}
export function delayTone(min: number | null): '' | 'warn' | 'bad' {
  if (min === null) return '';
  return min < 0 ? 'bad' : min < 10 ? 'warn' : '';
}
export function condTone(c: number): 'good' | 'warn' | 'bad' { return c >= 0.8 ? 'good' : c >= 0.5 ? 'warn' : 'bad'; }

/** Distance à vol d'oiseau en mètres. */
export function distM(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
