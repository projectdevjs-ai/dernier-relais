// LE LABO — la Station Lumen, lobby et menu principal du jeu, en 3D. Scène three.js autonome
// (son propre canvas plein écran au-dessus du jeu). Toucher un poste y amène la caméra et ouvre
// sa fiche ; le gros bouton « Partir » renvoie sur le terrain par le Passeur.
import * as THREE from 'three';
import type { Ambiance, GameView, SkillBranch } from '../game/api';
import { type IconName, icon } from '../scene3d/icons';
import { Loader3D, Viewport, clamp01, easeInOut, el, lerp, reducedMotion, smooth } from '../scene3d/kit';
import '../scene3d/scene3d.css';
import { Veil } from '../scene3d/veil';
import './lab.css';
import { type LabScene, OVERVIEW, OVERVIEW_WIDE, PAD_AT, PORTER_AT, STATIONS, type Sci, type StationDef, branchLevels, buildLab, labLook } from './room';
import { BRANCH_LABEL, BRANCH_PART, CAST, FIRST, POOL, STATION_TEXT, type SciId, type StationId, contextual, fmtInt, fmtKm, plural, progressOf } from './texts';

export interface LabEvents {
  /** « Partir » : retour au jeu sur la carte, à la position GPS. Appelé à la fin de la séquence du Passeur. */
  onDepart(): void;
  /** Ouvrir le panneau Compétences existant. */
  onSkills(): void;
  /** Ouvrir la carte du réseau de France. */
  onNetwork(): void;
  /** Ouvrir les contrats du jour et de la semaine. */
  onContracts(): void;
  /** Ouvrir le carnet / les statistiques. */
  onJournal(): void;
}
export interface LabOpts {
  ambiance?: Ambiance;
  /** Démo et captures : pas d'animation continue, la scène n'est redessinée qu'après un changement. */
  still?: boolean;
}

const MET_KEY = 'dernier-relais/labo-rencontres';
const ICONS: Record<StationId, IconName> = { teleporteur: 'passeur', exo: 'exo', holo: 'holo', console: 'console', lit: 'lit' };
const BRANCH_ICON: Record<SkillBranch, IconName> = { scanner: 'scanner', portage: 'portage', endurance: 'endurance', 'réseau': 'reseau' };
const BRANCHES: SkillBranch[] = ['scanner', 'portage', 'endurance', 'réseau'];
const DEPART_S = 2.7;

interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov: number; off: number }
const _v = new THREE.Vector3();

export class Lab {
  private readonly host: HTMLDivElement;
  private readonly veil: Veil;
  private readonly flash: HTMLDivElement;
  private readonly tagsEl: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly stats: HTMLDivElement;
  private readonly tags = new Map<string, { el: HTMLButtonElement; at: THREE.Vector3; badge: HTMLSpanElement | null; x: number; y: number }>();
  private vp: Viewport | null = null;
  private loader: Loader3D | null = null;
  private lab: LabScene | null = null;
  private building: Promise<void> | null = null;
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  private readonly ray = new THREE.Raycaster();
  private ambiance: Ambiance;
  private readonly still: boolean;
  private readonly calm = reducedMotion();
  private view: GameView | null = null;
  private sig = '';
  private opened = false;
  private dead = false;
  private raf = 0;
  private last = 0;
  private t = 0;
  private skip = false;
  private dirty = 3;
  // caméra
  private focus: StationId | null = null;
  private from: Shot = this.shotFor(null);
  private to: Shot = this.shotFor(null);
  private cur: Shot = this.shotFor(null);
  private moveT = 1;
  private moveDur = 1.1;
  private yaw = 0;
  private pitch = 0;
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  // dialogue
  private said = new Set<string>();
  private poolAt: Record<SciId, number> = { iris: 0, noe: 0, selma: 0 };
  private talking: Sci | null = null;
  private bubbleTimer = 0;
  // départ
  private departT = -1;
  private departed = false;

  constructor(root: HTMLElement, private readonly events: LabEvents, opts: LabOpts = {}) {
    this.ambiance = opts.ambiance ?? 'crépuscule';
    this.still = !!opts.still;
    const h = this.host = el('div', 's3 s3-lab');
    h.dataset.ambiance = this.ambiance;
    h.hidden = true;
    h.setAttribute('role', 'region');
    h.setAttribute('aria-label', 'Station Lumen');

    // En-tête : le nom du jeu (le labo remplace l'écran titre) et la progression du porteur.
    const top = el('div', 'lab-top');
    const brand = el('div', 'lab-brand');
    brand.append(el('span', 'lab-kicker', 'Station Lumen'), el('h1', 'lab-title', 'Dernier Relais'));
    this.stats = el('div', 'lab-stats');
    top.append(brand, this.stats);

    this.tagsEl = el('div', 'lab-tags');
    for (const s of STATIONS) this.addTag(s.id, STATION_TEXT[s.id].tag, ICONS[s.id], s.tag, () => this.go(s.id));
    this.bubble = el('div', 'lab-bubble');
    this.bubble.hidden = true;
    this.bubble.setAttribute('role', 'status');
    this.bubble.addEventListener('click', () => this.hush());
    this.card = el('div', 'lab-card');
    this.card.hidden = true;

    const bottom = el('div', 'lab-bottom');
    this.goBtn = el('button', 'lab-go');
    this.goBtn.type = 'button';
    const goText = el('span', 'lab-go-text');
    goText.append(el('b', '', 'Partir'), el('small', '', 'Le Passeur te dépose à ta position'));
    this.goBtn.append(icon('passeur'), goText, icon('fleche', 'lab-go-arrow'));
    this.goBtn.addEventListener('click', () => this.depart());
    bottom.append(this.card, this.goBtn);

    this.flash = el('div', 'lab-flash');
    h.append(top, this.tagsEl, this.bubble, bottom, this.flash);
    this.veil = new Veil(h, 'Dernier Relais', 'Station Lumen');
    root.appendChild(h);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('keydown', this.onKey);
  }

  // ---------- API ----------
  /** Charge (la première fois) et affiche le labo. Résolue quand la scène est visible. */
  async open(view: GameView): Promise<void> {
    if (this.dead) return;
    this.view = view;
    this.opened = true;
    this.host.hidden = false;
    this.veil.cover(true);
    this.resetVisit();
    if (!this.building) {
      this.veil.loader(true);
      this.building = this.build();
    }
    await this.building;
    if (this.dead || !this.opened) return;
    this.sig = '';
    this.update(view);
    this.veil.loader(false);
    this.frame(performance.now(), true);
    this.veil.lift();
    this.start();
  }

  /** Nouvel état du jeu : exosquelette, badges, carte, contrats, répliques. Peu coûteux si rien n'a changé. */
  update(view: GameView): void {
    this.view = view;
    const p = view.player, g = progressOf(view);
    const sig = `${p.level}|${p.xp}|${p.skillPoints}|${p.deliveries}|${p.score}|${p.distanceKm.toFixed(1)}|${p.stamina < 0.35}|${g.linked}|${g.claimable}|`
      + view.skills.map(s => s.rank).join('') + view.contracts.map(c => `${c.progress}${c.done ? 'd' : ''}${c.claimed ? 'c' : ''}`).join(',') + (p.at ? p.at.map(n => n.toFixed(2)).join() : '');
    if (sig === this.sig) return;
    this.sig = sig;
    this.lab?.sync(view);
    this.renderStats(view);
    this.setBadge('exo', p.skillPoints);
    this.setBadge('console', g.claimable);
    for (const id of ['iris', 'noe', 'selma'] as SciId[]) {
      const fresh = !this.met()[id] || contextual(id, view).some(c => !this.said.has(`${id}:${c.key}`));
      this.tags.get(id)?.el.classList.toggle('has-news', fresh);
    }
    if (this.focus) this.renderCard(this.focus);
    this.dirty = 3;
  }

  /** Cache le labo et met le rendu en pause (aucune image calculée tant qu'il est fermé). */
  close(): void {
    this.opened = false;
    this.stop();
    this.hush();
    this.host.hidden = true;
  }

  setAmbiance(a: Ambiance): void {
    this.ambiance = a;
    this.host.dataset.ambiance = a;
    this.lab?.setAmbiance(a);
    this.vp?.setLook(labLook(a));
    this.dirty = 3;
  }

  /** Libère tout : scène, textures, canvas, écouteurs, éléments d'interface. */
  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.close();
    clearTimeout(this.bubbleTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('keydown', this.onKey);
    this.vp?.canvas.removeEventListener('pointerdown', this.onDown);
    this.vp?.canvas.removeEventListener('pointermove', this.onMove);
    this.vp?.canvas.removeEventListener('pointerup', this.onUp);
    this.vp?.canvas.removeEventListener('pointercancel', this.onUp);
    this.lab?.dispose();
    this.loader?.dispose();
    this.vp?.dispose();
    this.lab = null; this.vp = null; this.loader = null;
    this.host.remove();
  }

  /** Place la caméra sur un poste (null : vue d'ensemble). immediate : sans transition. */
  go(id: StationId | null, immediate = false): void {
    if (this.departT >= 0) return;
    this.hush();
    this.focus = id;
    this.from = { ...this.cur, pos: this.cur.pos.clone(), look: this.cur.look.clone() };
    this.to = this.shotFor(id);
    this.moveDur = this.calm ? 0.01 : 1.15;
    this.moveT = immediate || this.still ? 1 : 0;
    this.yaw = this.pitch = 0;
    this.host.classList.toggle('is-focus', !!id);
    this.host.dataset.poste = id ?? '';
    if (id) this.renderCard(id);
    this.card.hidden = !id;
    this.dirty = 3;
  }

  /** Fait parler un scientifique (bulle au-dessus de sa tête). */
  talk(id: SciId): void {
    const lab = this.lab, v = this.view;
    if (!lab || !v || this.departT >= 0) return;
    const sci = lab.scis.find(s => s.id === id);
    if (!sci) return;
    let text: string;
    const met = this.met();
    const ctx = contextual(id, v).find(c => !this.said.has(`${id}:${c.key}`));
    if (!met[id]) { text = FIRST[id]; met[id] = 1; try { localStorage.setItem(MET_KEY, JSON.stringify(met)); } catch { /* stockage indisponible */ } }
    else if (ctx) { text = ctx.text; this.said.add(`${id}:${ctx.key}`); }
    else { const pool = POOL[id]; text = pool[this.poolAt[id] % pool.length]; this.poolAt[id]++; }
    const fresh = contextual(id, v).some(c => !this.said.has(`${id}:${c.key}`));
    this.tags.get(id)?.el.classList.toggle('has-news', fresh);

    this.talking = sci;
    const talks = ['Talk_with_Hands_Open', 'Talk_with_Right_Hand_Open', 'Talk_with_Left_Hand_Raised', 'Talk_with_Left_Hand_on_Hip', 'Talk_Passionately'].filter(n => sci.actor.has(n));
    const dur = Math.min(9, 2.6 + text.length * 0.055);
    if (talks.length && !this.calm) sci.actor.play(talks[(this.poolAt[id] + text.length) % talks.length], 0.35);
    sci.talkUntil = this.t + dur;
    this.bubble.replaceChildren();
    const who = el('div', 'lab-bubble-who');
    who.append(el('b', '', CAST[id].name), el('small', '', CAST[id].role));
    this.bubble.append(who, el('p', '', text));
    this.bubble.dataset.qui = id;
    this.bubble.hidden = false;
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hush(), dur * 1000);
    this.dirty = 3;
  }

  // ---------- Construction ----------
  private async build(): Promise<void> {
    try { this.vp = new Viewport(this.host, { post: true }); } catch (e) {
      // Pas de WebGL : le menu reste utilisable, sans la scène.
      console.warn('[labo] WebGL indisponible, menu sans décor', e);
      this.host.classList.add('no-gl');
      return;
    }
    const vp = this.vp;
    this.host.prepend(vp.canvas);
    vp.setLook({ ...labLook(this.ambiance), bloomThreshold: 0.95, bloomRadius: 0.7, vignette: 0.5, grain: 0.028 });
    this.loader = new Loader3D(k => this.veil.progress(k));
    this.lab = await buildLab(vp, this.loader, this.ambiance);
    if (this.dead) { this.lab.dispose(); return; }
    for (const s of this.lab.scis) {
      this.addTag(s.id, CAST[s.id].name, 'parler', s.head, () => this.talk(s.id), true);
    }
    const c = vp.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    this.cur = this.shotFor(this.focus);
    this.to = this.shotFor(this.focus);
  }

  private addTag(id: string, label: string, ic: IconName, at: THREE.Vector3, onTap: () => void, small = false): void {
    const b = el('button', small ? 'lab-tag lab-tag-sci' : 'lab-tag');
    b.type = 'button';
    b.dataset.id = id;
    const dot = el('span', 'lab-tag-ic');
    dot.appendChild(icon(ic));
    let badge: HTMLSpanElement | null = null;
    if (small) { b.setAttribute('aria-label', `Parler à ${label}`); b.appendChild(dot); }
    else {
      badge = el('span', 'lab-tag-badge');
      badge.hidden = true;
      b.append(dot, el('span', 'lab-tag-name', label), badge);
    }
    b.addEventListener('click', onTap);
    this.tagsEl.appendChild(b);
    this.tags.set(id, { el: b, at, badge, x: -1, y: -1 });
  }

  private setBadge(id: string, n: number): void {
    const b = this.tags.get(id)?.badge;
    if (!b) return;
    b.hidden = n <= 0;
    b.textContent = String(n);
  }

  // ---------- Interface ----------
  private renderStats(v: GameView): void {
    const p = v.player;
    const lvl = el('div', 'lab-lvl');
    const badge = el('span', 'lab-lvl-badge');
    badge.appendChild(el('b', '', String(p.level)));
    const bar = el('span', 'lab-bar');
    const fill = el('span', 'lab-bar-fill');
    fill.style.transform = `scaleX(${clamp01(p.xpNext > 0 ? p.xp / p.xpNext : 0).toFixed(3)})`;
    bar.appendChild(fill);
    const txt = el('span', 'lab-lvl-text');
    txt.append(el('small', '', `Niveau ${p.level}`), bar);
    lvl.append(badge, txt);
    lvl.setAttribute('aria-label', `Niveau ${p.level}, ${p.xp} points d’expérience sur ${p.xpNext}`);
    this.stats.replaceChildren(lvl);
  }

  private renderCard(id: StationId): void {
    const v = this.view, tx = STATION_TEXT[id];
    const head = el('div', 'lab-card-head');
    const back = el('button', 'lab-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Retour à la vue d’ensemble');
    back.appendChild(icon('retour'));
    back.addEventListener('click', () => this.go(null));
    const titles = el('div', 'lab-card-titles');
    titles.append(el('span', 'lab-card-kicker', tx.kicker), el('h2', 'lab-card-title', tx.title));
    head.append(back, titles);
    const body = el('div', 'lab-card-body');
    let action: (() => void) | null = null;
    if (v) {
      const p = v.player, g = progressOf(v);
      if (id === 'exo') {
        const lv = branchLevels(v), grid = el('div', 'lab-branches');
        for (const b of BRANCHES) {
          const list = v.skills.filter(s => s.branch === b);
          const rank = list.reduce((s, k) => s + k.rank, 0), max = list.reduce((s, k) => s + k.maxRank, 0);
          const row = el('div', `lab-branch${lv[b] > 0 ? ' is-on' : ''}`);
          row.dataset.b = b === 'réseau' ? 'reseau' : b;
          const meter = el('span', 'lab-bar');
          const fill = el('span', 'lab-bar-fill');
          fill.style.transform = `scaleX(${lv[b].toFixed(3)})`;
          meter.appendChild(fill);
          const names = el('span', 'lab-branch-name');
          names.append(el('b', '', BRANCH_LABEL[b]), el('small', '', BRANCH_PART[b]));
          row.append(icon(BRANCH_ICON[b]), names, meter, el('span', 'lab-branch-n', `${rank}/${max}`));
          grid.appendChild(row);
        }
        body.appendChild(grid);
        body.appendChild(el('p', p.skillPoints > 0 ? 'lab-note is-hot' : 'lab-note', p.skillPoints > 0
          ? `${plural(p.skillPoints, 'point', 'points')} à dépenser : chaque rang allume une partie de l’exosquelette.`
          : 'Chaque rang appris allume une partie de l’exosquelette.'));
        action = this.events.onSkills;
      } else if (id === 'holo') {
        const stars = v.shelters.reduce((s, h) => s + h.stars, 0);
        body.appendChild(this.figures([[String(g.linked), g.linked > 1 ? 'abris reliés' : 'abri relié'], [String(v.shelters.length), 'abris à portée'], [String(stars), stars > 1 ? 'étoiles' : 'étoile']]));
        body.appendChild(el('p', 'lab-note', g.linked > 0 ? 'Ta balise brille sur la carte. Chaque abri relié s’y allume.' : 'La carte est encore sombre. Livre un premier colis pour allumer un abri.'));
        action = this.events.onNetwork;
      } else if (id === 'console') {
        const day = v.contracts.filter(c => c.period === 'jour'), week = v.contracts.filter(c => c.period === 'semaine');
        const done = (l: typeof day): string => `${l.filter(c => c.done).length}/${l.length}`;
        body.appendChild(this.figures([[done(day), 'du jour'], [done(week), 'de la semaine'], [String(g.claimable), 'à réclamer']]));
        body.appendChild(el('p', g.claimable > 0 ? 'lab-note is-hot' : 'lab-note', g.claimable > 0
          ? `${plural(g.claimable, 'récompense t’attend', 'récompenses t’attendent')}.`
          : v.contracts.length ? 'Remplis-les sur le terrain, réclame-les ici.' : 'Aucun contrat pour le moment.'));
        action = this.events.onContracts;
      } else if (id === 'lit') {
        body.appendChild(this.figures([[fmtInt(p.deliveries), p.deliveries > 1 ? 'livraisons' : 'livraison'], [`${fmtKm(p.distanceKm)} km`, 'parcourus'], [fmtInt(p.score), 'points']]));
        body.appendChild(el('p', 'lab-note', 'Tout ce que tu fais dehors est noté dans ton carnet.'));
        action = this.events.onJournal;
      } else {
        body.appendChild(el('p', 'lab-note', 'Le Passeur est calibré sur ta position. Tu arrives dans le monde réel, exactement là où se trouve ton signal.'));
      }
    }
    this.card.replaceChildren(head, body);
    if (action) {
      const act = action;
      const btn = el('button', 'lab-act');
      btn.type = 'button';
      btn.append(el('span', '', tx.action), icon('fleche'));
      btn.addEventListener('click', () => act());
      this.card.appendChild(btn);
    }
  }

  private figures(list: [string, string][]): HTMLDivElement {
    const row = el('div', 'lab-figs');
    for (const [n, label] of list) {
      const f = el('div', 'lab-fig');
      f.append(el('b', '', n), el('small', '', label));
      row.appendChild(f);
    }
    return row;
  }

  private hush(): void {
    clearTimeout(this.bubbleTimer);
    if (this.bubble.hidden) return;
    this.bubble.hidden = true;
    if (this.talking) this.talking.talkUntil = this.t; // retour au calme à la prochaine image
    this.talking = null;
    this.dirty = 3;
  }

  private met(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(MET_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
  }

  // ---------- Départ par le Passeur ----------
  private depart(): void {
    if (this.departT >= 0 || this.departed) return;
    if (!this.lab || !this.vp) { this.departed = true; this.events.onDepart(); return; }
    this.go('teleporteur');
    this.card.hidden = true;
    this.departT = 0;
    this.host.classList.add('is-leaving');
    const p = this.lab.porter;
    if (!this.calm) p.play(p.pick('walk'), 0.3);
  }

  private stepDepart(dt: number): number {
    const lab = this.lab;
    if (!lab || this.departT < 0) return 0;
    const dur = this.calm || this.still ? 0.5 : DEPART_S;
    this.departT += dt;
    const k = clamp01(this.departT / dur), g = lab.porter.root.parent;
    if (g) {
      // Le porteur rejoint la plateforme, puis se dissout dans la lumière.
      const w = smooth(clamp01(k / 0.72));
      g.position.lerpVectors(PORTER_AT, _v.set(PAD_AT.x, 0, PAD_AT.z + 0.55), w);
      g.rotation.y = lerp(0.3, Math.PI, smooth(clamp01(k / 0.2)));
      if (w >= 1 && lab.porter.currentName === 'walk') lab.porter.play(lab.porter.pick('calm_0', 'calmv0'), 0.3);
      g.visible = k < 0.9;
    }
    this.flash.style.opacity = smooth(clamp01((k - 0.8) / 0.2)).toFixed(3);
    if (k >= 1 && !this.departed) {
      this.departed = true;
      this.veil.cover(true);
      this.flash.style.opacity = '0';
      this.events.onDepart();
    }
    return smooth(clamp01((k - 0.25) / 0.6));
  }

  /** Remet le labo dans son état d'accueil (à chaque ouverture). */
  private resetVisit(): void {
    this.departT = -1;
    this.departed = false;
    this.said = new Set();
    this.host.classList.remove('is-leaving');
    this.flash.style.opacity = '0';
    const g = this.lab?.porter.root.parent;
    if (g && this.lab) {
      g.position.copy(PORTER_AT); g.rotation.y = 0.3; g.visible = true;
      this.lab.porter.play(this.lab.porter.pick('calm_0', 'calmv0'), 0);
    }
    this.go(null, true);
  }

  // ---------- Caméra ----------
  private shotFor(id: StationId | null): Shot {
    const wide = this.vp ? this.vp.aspect > 1 : false;
    if (!id) {
      const o = wide ? OVERVIEW_WIDE : OVERVIEW;
      return { pos: o.cam.clone(), look: o.look.clone(), fov: o.fov, off: 0 };
    }
    const s = STATIONS.find(x => x.id === id) as StationDef;
    const pos = s.cam.clone();
    // En paysage, on se rapproche du poste ; en vertical, l'image est décalée vers le haut pour laisser la place à la fiche.
    if (wide) pos.lerp(s.look, 0.28);
    return { pos, look: s.look.clone(), fov: wide ? 36 : 46, off: wide ? 0 : 0.13 };
  }

  private applyCamera(dt: number): void {
    const cam = this.camera, vp = this.vp;
    if (!vp) return;
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / this.moveDur);
      const k = easeInOut(this.moveT);
      this.cur.pos.lerpVectors(this.from.pos, this.to.pos, k);
      this.cur.look.lerpVectors(this.from.look, this.to.look, k);
      // petit arc : la caméra prend un peu de hauteur au milieu du trajet
      this.cur.pos.y += Math.sin(k * Math.PI) * 0.35;
      this.cur.fov = lerp(this.from.fov, this.to.fov, k);
      this.cur.off = lerp(this.from.off, this.to.off, k);
    } else {
      this.cur.pos.copy(this.to.pos); this.cur.look.copy(this.to.look); this.cur.fov = this.to.fov; this.cur.off = this.to.off;
    }
    if (!this.drag) { const e = Math.min(1, dt * 3); this.yaw -= this.yaw * e; this.pitch -= this.pitch * e; }
    // Rotation légère autour du point visé (glisser le doigt), puis respiration.
    _v.copy(this.cur.pos).sub(this.cur.look);
    const r = _v.length(), a = Math.atan2(_v.x, _v.z) + this.yaw, e = Math.asin(_v.y / r) + this.pitch;
    cam.position.set(this.cur.look.x + Math.sin(a) * Math.cos(e) * r, this.cur.look.y + Math.sin(e) * r, this.cur.look.z + Math.cos(a) * Math.cos(e) * r);
    if (!this.calm && !this.still) {
      const amp = this.focus ? 0.02 : 0.05;
      cam.position.x += Math.sin(this.t * 0.37) * amp * 1.4 + Math.sin(this.t * 0.83 + 1) * amp * 0.4;
      cam.position.y += Math.sin(this.t * 0.29 + 2) * amp;
    }
    cam.lookAt(this.cur.look);
    const off = Math.round(this.cur.off * vp.height);
    if (cam.fov !== this.cur.fov || (cam.view?.offsetY ?? 0) !== off || cam.aspect !== vp.aspect) {
      cam.fov = this.cur.fov; cam.aspect = vp.aspect;
      if (off) cam.setViewOffset(vp.width, vp.height, 0, off, vp.width, vp.height); else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  private placeTags(): void {
    const vp = this.vp;
    if (!vp) return;
    const place = (e: HTMLElement, at: THREE.Vector3, store: { x: number; y: number }): boolean => {
      _v.copy(at).project(this.camera);
      const ok = _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15;
      const x = Math.round((_v.x * 0.5 + 0.5) * vp.width), y = Math.round((-_v.y * 0.5 + 0.5) * vp.height);
      if (ok && (x !== store.x || y !== store.y)) { store.x = x; store.y = y; e.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; }
      return ok;
    };
    for (const tg of this.tags.values()) tg.el.classList.toggle('is-off', !place(tg.el, tg.at, tg));
    if (this.talking && !this.bubble.hidden) {
      _v.copy(this.talking.head).project(this.camera);
      const w = Math.min(300, vp.width - 24);
      const x = Math.max(12 + w / 2, Math.min(vp.width - 12 - w / 2, (_v.x * 0.5 + 0.5) * vp.width));
      const y = Math.max(150, (-_v.y * 0.5 + 0.5) * vp.height - 14);
      this.bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      this.bubble.style.setProperty('--tail', `${Math.round((_v.x * 0.5 + 0.5) * vp.width - x)}px`);
    }
  }

  // ---------- Boucle de rendu ----------
  private start(): void { if (!this.raf && this.opened && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame(this.loop); } }
  private stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
  private readonly loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.frame(now, false);
  };

  private frame(now: number, force: boolean): void {
    const lab = this.lab, vp = this.vp;
    if (!lab || !vp) return;
    const busy = this.moveT < 1 || !!this.drag || this.departT >= 0 || Math.abs(this.yaw) > 0.002 || this.dirty > 0;
    if (this.still && !busy && !force) return;
    // Au repos, une image sur deux suffit (respiration, poussière) : moitié moins de travail pour la batterie.
    this.skip = !this.skip;
    if (!busy && !force && this.skip) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.t += dt;
    if (this.dirty > 0) this.dirty--;
    if (vp.resize()) { this.to = this.shotFor(this.focus); this.dirty = 2; }
    const charge = this.stepDepart(dt);
    lab.tick(this.t, this.still ? 0 : dt, charge);
    this.applyCamera(dt);
    this.placeTags();
    vp.render(lab.scene, this.camera, this.t);
  }

  // ---------- Gestes ----------
  private readonly onVisibility = (): void => { if (document.hidden) this.stop(); else this.start(); };
  private readonly onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && this.opened && this.focus) this.go(null); };
  private readonly onDown = (e: PointerEvent): void => {
    if (this.departT >= 0) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* sans gravité */ }
  };
  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
    if (this.calm) return;
    this.yaw = Math.max(-0.28, Math.min(0.28, this.yaw - dx * 0.0025));
    this.pitch = Math.max(-0.08, Math.min(0.12, this.pitch + dy * 0.0015));
  };
  private readonly onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (e.type === 'pointercancel' || d.moved > 12 || !this.lab || !this.vp) return;
    // Toucher : quel poste, quel scientifique ?
    const r = this.vp.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.lab.hits, false)[0];
    if (!hit) { if (this.focus) this.go(null); else this.hush(); return; }
    const { kind, id } = hit.object.userData as { kind: 'poste' | 'sci'; id: string };
    if (kind === 'sci') this.talk(id as SciId);
    else if (id !== this.focus) this.go(id as StationId);
  };
}
