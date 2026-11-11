// Panneau plein écran « Carte du réseau » : la France en tuiles, région par région, qui se rallume à mesure que
// les joueurs ravitaillent les abris ; chiffres clés, détail d'une région, classement des porteurs.
// Tout se met à jour en direct tant que le panneau est ouvert. Hors ligne, il s'ouvre quand même et le dit.
import type { LeaderRow, Network, RegionProgress } from '../net/network';
import { REGIONS, type RegionId, franceMap, hexPoints, regionInfo } from '../net/regions';
import { KeyedList, btn, fmtInt, h, setAttr, setDisabled, setText, setVar, show, type Row } from './dom';
import { icon } from './icons';
import { Panel } from './panel';
import './france.css';

/** Ce que le panneau utilise du réseau (un objet Network convient tel quel). */
export type FranceSource = Pick<Network, 'online' | 'onOnline' | 'regions' | 'onRegions' | 'leaderboard' | 'playerCount' | 'myRegion' | 'pseudo' | 'setPseudo'>;

type Tab = 'regions' | 'porteurs';
const REFRESH_MS = 30_000;
const pct = (p: number): string => (p > 0 && p < 0.01 ? '< 1 %' : `${Math.round(p * 100)} %`);
const plural = (n: number, one: string, many: string): string => (n >= 2 ? many : one);

export class FrancePanel {
  readonly panel: Panel;
  private status = h('span', 'dr-fr-status');
  private statusTxt = h('span', '');
  private note = h('p', 'dr-fr-note');
  private stat: Record<'shelters' | 'deliveries' | 'players', HTMLElement>;
  private svg: SVGSVGElement;
  private groups = new Map<RegionId, SVGGElement>();
  private tiles = new Map<RegionId, SVGPathElement[]>();
  private lit = new Map<RegionId, number>();
  private card: { name: HTMLElement; mine: HTMLElement; bar: HTMLElement; pct: HTMLElement; active: HTMLElement; deliveries: HTMLElement; points: HTMLElement; hint: HTMLElement };
  private tabBtns = new Map<Tab, HTMLButtonElement>();
  private pages = new Map<Tab, HTMLElement>();
  private regionList: KeyedList<RegionProgress & { rank: number }>;
  private board: KeyedList<LeaderRow>;
  private boardEmpty = h('p', 'dr-empty');
  private pseudoInput = h('input', 'dr-fr-input');
  private pseudoBtn: HTMLButtonElement;
  private pseudoMsg = h('p', 'dr-hint dr-fr-msg');

  private selected: RegionId | null = null;
  private data: RegionProgress[] = [];
  private offs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private soon: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement, private net: FranceSource) {
    this.panel = new Panel(root, 'dr-panel-tall dr-france', 'Carte du réseau');
    this.status.append(h('span', 'dr-fr-dot'), this.statusTxt);
    this.status.setAttribute('role', 'status');
    this.panel.head.append(h('h2', 'dr-title', 'Carte du réseau'), this.status);
    this.panel.foot.dataset.empty = '1';
    this.panel.onClose = () => this.stop();

    // ----- Chiffres clés -----
    const cell = (label: string): [HTMLElement, HTMLElement] => {
      const n = h('span', 'dr-fr-stat-n', '0');
      return [h('div', 'dr-fr-stat', n, h('span', 'dr-fr-stat-l', label)), n];
    };
    const [c1, n1] = cell('Abris actifs'), [c2, n2] = cell('Livraisons'), [c3, n3] = cell('Porteurs');
    this.stat = { shelters: n1, deliveries: n2, players: n3 };

    // ----- Carte -----
    this.svg = this.buildMap();
    const legend = h('div', 'dr-fr-legend',
      h('span', 'dr-fr-key'), h('span', '', 'Éteint'),
      h('span', 'dr-fr-key is-awake'), h('span', '', 'Ravitaillé'),
      h('span', 'dr-fr-key is-lit'), h('span', '', 'Rallumé'));
    legend.setAttribute('aria-hidden', 'true');
    const mapBox = h('div', 'dr-fr-map', this.svg as unknown as HTMLElement, legend);

    // ----- Région choisie -----
    const bar = h('span', 'dr-bar-fill');
    this.card = {
      name: h('h3', 'dr-fr-card-name'), mine: h('span', 'dr-tag dr-tag-warn dr-fr-mine', icon('pin'), 'Ta région'),
      bar, pct: h('span', 'dr-fr-card-pct'),
      active: h('span', 'dr-fr-num'), deliveries: h('span', 'dr-fr-num'), points: h('span', 'dr-fr-num'), hint: h('p', 'dr-hint'),
    };
    const fig = (n: HTMLElement, label: string) => h('span', 'dr-fr-fig', n, h('span', 'dr-fr-fig-l', label));
    const card = h('div', 'dr-fr-card',
      h('div', 'dr-fr-card-top', this.card.name, this.card.mine),
      h('div', 'dr-fr-card-bar', h('span', 'dr-bar', bar), this.card.pct),
      h('div', 'dr-fr-figs', fig(this.card.active, 'abris actifs'), fig(this.card.deliveries, 'livraisons'), fig(this.card.points, 'points')),
      this.card.hint);
    card.setAttribute('aria-live', 'polite');

    // ----- Onglets -----
    const tabs = h('div', 'dr-tabs dr-fr-tabs');
    tabs.setAttribute('role', 'tablist');
    const mk = (id: Tab, label: string, ic: 'network' | 'star') => {
      const b = btn('dr-tab', null, icon(ic), h('span', '', label));
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setTab(id));
      this.tabBtns.set(id, b);
      tabs.append(b);
    };
    mk('regions', 'Régions', 'network');
    mk('porteurs', 'Porteurs', 'star');

    const regionHost = h('ul', 'dr-fr-list');
    this.regionList = new KeyedList(regionHost, r => r.id, r => this.regionRow(r.id));
    const pageRegions = h('div', 'dr-fr-page', regionHost);
    pageRegions.setAttribute('role', 'tabpanel');

    // ----- Classement et pseudo -----
    this.pseudoInput.type = 'text';
    this.pseudoInput.maxLength = 20;
    this.pseudoInput.autocomplete = 'off';
    this.pseudoInput.spellcheck = false;
    this.pseudoInput.enterKeyHint = 'done';
    this.pseudoInput.setAttribute('aria-label', 'Ton nom de porteur');
    this.pseudoBtn = btn('dr-btn dr-btn-sm', null, 'Valider');
    const save = () => { void this.savePseudo(); };
    this.pseudoBtn.addEventListener('click', save);
    this.pseudoInput.addEventListener('keydown', e => { if (e.key === 'Enter') save(); e.stopPropagation(); });
    const boardHost = h('ol', 'dr-fr-board');
    this.board = new KeyedList(boardHost, r => r.id, () => this.boardRow());
    const pagePorters = h('div', 'dr-fr-page',
      h('div', 'dr-sec', h('h3', 'dr-sec-title', 'Ton nom de porteur')),
      h('div', 'dr-fr-pseudo', this.pseudoInput, this.pseudoBtn), this.pseudoMsg,
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('star'), 'Classement')),
      boardHost, this.boardEmpty);
    pagePorters.setAttribute('role', 'tabpanel');
    this.pages.set('regions', pageRegions);
    this.pages.set('porteurs', pagePorters);

    this.panel.body.append(this.note, h('div', 'dr-fr-stats', c1, c2, c3), mapBox, card, tabs, pageRegions, pagePorters);
    this.setTab('regions');
  }

  open(): void {
    if (this.panel.isOpen) return;
    this.selected = this.net.myRegion() ?? this.selected;
    this.pseudoInput.value = this.net.pseudo();
    setText(this.pseudoMsg, '');
    this.renderRegions(this.net.regions());
    this.renderStatus();
    this.panel.open();
    // Mises à jour en direct, seulement tant que le panneau est ouvert.
    this.offs.push(this.net.onRegions(r => { this.renderRegions(r); this.refreshSoon(); }));
    this.offs.push(this.net.onOnline(() => { this.renderStatus(); void this.refresh(); }));
    this.timer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
    void this.refresh();
  }
  close(): void { this.panel.close(); }

  private stop(): void {
    for (const off of this.offs.splice(0)) { try { off(); } catch { /* déjà désabonné */ } }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.soon) { clearTimeout(this.soon); this.soon = null; }
  }

  // ───────── carte

  private buildMap(): SVGSVGElement {
    const map = franceMap(), r = map.r;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of map.tiles) { x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y); }
    const pad = r * 1.4;
    const hex = (x: number, y: number) => `M${hexPoints(x, y, r * 0.95).map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
    let inner = '';
    for (const reg of REGIONS) {
      inner += `<g class="dr-fr-reg" data-id="${reg.id}">`
        + `<path class="dr-fr-hit" d="${map.byRegion[reg.id].map(t => `M${hexPoints(t.x, t.y, r * 1.02).map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`).join('')}"/>`
        + map.byRegion[reg.id].map(t => `<path class="dr-fr-tile" d="${hex(t.x, t.y)}"/>`).join('')
        + '</g>';
    }
    // Les frontières passent au-dessus des tuiles ; celle de la région choisie et celle du joueur sont mises en avant.
    for (const reg of REGIONS) inner += `<path class="dr-fr-border" data-id="${reg.id}" d="${map.borders[reg.id]}"/>`;
    const t = document.createElement('template');
    t.innerHTML = `<svg class="dr-fr-svg" viewBox="${(x0 - pad).toFixed(0)} ${(y0 - pad).toFixed(0)} ${(x1 - x0 + 2 * pad).toFixed(0)} ${(y1 - y0 + 2 * pad).toFixed(0)}" role="img" aria-label="Carte de France par régions">${inner}</svg>`;
    const svg = t.content.firstElementChild as SVGSVGElement;
    for (const g of svg.querySelectorAll<SVGGElement>('g.dr-fr-reg')) {
      const id = g.dataset.id as RegionId;
      this.groups.set(id, g);
      this.tiles.set(id, [...g.querySelectorAll<SVGPathElement>('.dr-fr-tile')]);
    }
    svg.addEventListener('click', e => {
      const g = (e.target as Element).closest<SVGGElement>('g.dr-fr-reg');
      if (g?.dataset.id) this.select(g.dataset.id as RegionId);
    });
    return svg;
  }

  private select(id: RegionId): void {
    this.selected = id;
    this.renderRegions(this.data);
  }

  // ───────── rendu

  private renderStatus(): void {
    const on = this.net.online;
    this.status.classList.toggle('is-on', on);
    setText(this.statusTxt, on ? 'En direct' : 'Hors ligne');
    show(this.note, !on);
    const known = this.data.some(r => r.deliveries > 0);
    setText(this.note, known
      ? 'Le réseau n’est pas joignable pour le moment : voici le dernier état connu. Tu continues à jouer en local.'
      : 'Le réseau n’est pas encore connecté : tu joues en local et ta progression reste gardée sur ce téléphone.');
    setDisabled(this.pseudoBtn, false);
  }

  private renderRegions(list: RegionProgress[]): void {
    this.data = list;
    const mine = this.net.myRegion();
    if (!this.selected) this.selected = mine ?? [...list].sort((a, b) => b.points - a.points)[0]?.id ?? 'idf';
    let shelters = 0, deliveries = 0;
    for (const r of list) {
      shelters += r.activeShelters; deliveries += r.deliveries;
      const tiles = this.tiles.get(r.id) ?? [], g = this.groups.get(r.id);
      const n = r.progress > 0 ? Math.max(1, Math.round(r.progress * tiles.length)) : 0;
      if (this.lit.get(r.id) !== n) {
        this.lit.set(r.id, n);
        tiles.forEach((t, i) => t.classList.toggle('is-lit', i < n));
      }
      g?.classList.toggle('is-awake', r.deliveries > 0);
      g?.classList.toggle('is-sel', r.id === this.selected);
    }
    for (const b of this.svg.querySelectorAll<SVGPathElement>('.dr-fr-border')) {
      const id = b.dataset.id;
      b.classList.toggle('is-mine', id === mine);
      b.classList.toggle('is-sel', id === this.selected);
    }
    // La frontière choisie se dessine en dernier, par-dessus ses voisines.
    const top = this.svg.querySelector(`.dr-fr-border[data-id="${this.selected}"]`);
    if (top && top !== this.svg.lastElementChild) this.svg.append(top);
    setText(this.stat.shelters, fmtInt(shelters));
    setText(this.stat.deliveries, fmtInt(deliveries));

    const sel = list.find(r => r.id === this.selected);
    if (sel) {
      setText(this.card.name, sel.name);
      show(this.card.mine, sel.id === mine);
      setVar(this.card.bar, '--p', String(sel.progress));
      setText(this.card.pct, pct(sel.progress));
      setText(this.card.active, fmtInt(sel.activeShelters));
      setText(this.card.deliveries, fmtInt(sel.deliveries));
      setText(this.card.points, fmtInt(sel.points));
      setText(this.card.hint, sel.deliveries === 0
        ? 'Aucune livraison ici pour l’instant. Le premier colis livré réveillera la région.'
        : sel.activeShelters === 0
          ? `${fmtInt(sel.shelters)} ${plural(sel.shelters, 'abri ravitaillé', 'abris ravitaillés')}, aucun n’a encore atteint le niveau 1.`
          : `${fmtInt(sel.shelters)} ${plural(sel.shelters, 'abri ravitaillé', 'abris ravitaillés')} par les porteurs de la région.`);
    }
    const ranked = [...list].sort((a, b) => b.progress - a.progress || b.points - a.points || a.name.localeCompare(b.name, 'fr')).map((r, i) => ({ ...r, rank: i + 1 }));
    this.regionList.sync(ranked);
    this.renderStatus();
  }

  private regionRow(id: RegionId): Row<RegionProgress & { rank: number }> {
    const rank = h('span', 'dr-fr-rank'), name = h('span', 'dr-fr-row-name', regionInfo(id)?.name ?? id);
    const fill = h('span', 'dr-bar-fill'), val = h('span', 'dr-fr-row-val'), sub = h('span', 'dr-fr-row-sub');
    const b = btn('dr-fr-row', null, rank, h('span', 'dr-fr-row-mid', h('span', 'dr-fr-row-l1', name, val), h('span', 'dr-bar', fill), sub));
    b.addEventListener('click', () => { this.select(id); this.panel.body.scrollTo({ top: 0, behavior: 'smooth' }); });
    const el = h('li', '', b);
    return {
      el,
      update: r => {
        setText(rank, String(r.rank));
        setText(val, pct(r.progress));
        setVar(fill, '--p', String(r.progress));
        setText(sub, `${fmtInt(r.activeShelters)} ${plural(r.activeShelters, 'abri actif', 'abris actifs')} · ${fmtInt(r.deliveries)} ${plural(r.deliveries, 'livraison', 'livraisons')}`);
        b.classList.toggle('is-sel', r.id === this.selected);
        b.classList.toggle('is-mine', r.id === this.net.myRegion());
        setAttr(b, 'aria-pressed', String(r.id === this.selected));
      },
    };
  }

  private boardRow(): Row<LeaderRow> {
    const rank = h('span', 'dr-fr-rank'), name = h('span', 'dr-fr-row-name'), sub = h('span', 'dr-fr-row-sub'), where = h('span', 'dr-fr-row-sub'), score = h('span', 'dr-fr-score');
    const el = h('li', 'dr-fr-porter', rank, h('span', 'dr-fr-row-mid', name, sub, where), score);
    return {
      el,
      update: r => {
        setText(rank, String(r.rank));
        setText(name, r.me ? `${r.pseudo} (toi)` : r.pseudo);
        const reg = r.region ? regionInfo(r.region)?.name ?? '' : '';
        setText(sub, `Niveau ${fmtInt(r.level)} · ${fmtInt(r.deliveries)} ${plural(r.deliveries, 'livraison', 'livraisons')}`);
        setText(where, reg);
        show(where, reg !== '');
        setText(score, fmtInt(r.score));
        el.classList.toggle('is-me', r.me);
        el.classList.toggle('is-top', r.rank <= 3);
      },
    };
  }

  private setTab(tab: Tab): void {
    for (const [id, b] of this.tabBtns) { b.classList.toggle('is-on', id === tab); setAttr(b, 'aria-selected', String(id === tab)); }
    for (const [id, p] of this.pages) show(p, id === tab);
  }

  // ───────── données

  private refreshSoon(): void {
    this.soon ??= setTimeout(() => { this.soon = null; void this.refresh(); }, 2500);
  }
  private async refresh(): Promise<void> {
    try {
      const [rows, players] = await Promise.all([this.net.leaderboard(20), this.net.playerCount()]);
      if (!this.panel.isOpen) return;
      this.board.sync(rows);
      show(this.boardEmpty, rows.length === 0);
      setText(this.boardEmpty, this.net.online ? 'Aucun porteur au classement pour l’instant. Livre un colis pour y entrer.' : 'Le classement s’affichera dès que le réseau sera connecté.');
      setText(this.stat.players, players === null ? '–' : fmtInt(players));
      this.renderStatus();
    } catch { /* le panneau garde son dernier affichage */ }
  }

  private async savePseudo(): Promise<void> {
    setDisabled(this.pseudoBtn, true);
    let ok = false;
    try { ok = await this.net.setPseudo(this.pseudoInput.value); } catch { ok = false; }
    setDisabled(this.pseudoBtn, false);
    this.pseudoMsg.classList.toggle('is-bad', !ok);
    if (!ok) { setText(this.pseudoMsg, 'Choisis un nom de 2 à 20 caractères.'); return; }
    this.pseudoInput.value = this.net.pseudo();
    setText(this.pseudoMsg, this.net.online ? 'Nom enregistré.' : 'Nom enregistré sur ce téléphone. Il sera envoyé dès que le réseau sera connecté.');
    this.pseudoInput.blur();
    void this.refresh();
  }
}
