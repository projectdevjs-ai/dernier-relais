// LE LABO — la Station Lumen, lobby et menu principal du jeu, en 3D. Scène three.js autonome
// (son propre canvas plein écran au-dessus du jeu). Comme dans l'ancienne version, le labo est un hall en
// TROIS POSTES que l'on parcourt en glissant à gauche ou à droite : Salle des cartes, Le Passeur, Quartiers.
// Derrière la porte des quartiers : la chambre (repos, carnet, compétences). « Partir » renvoie sur le terrain.
import * as THREE from 'three';
import type { Ambiance, GameView, SkillBranch } from '../game/api';
import { type IconName, icon } from '../scene3d/icons';
import { Loader3D, Viewport, clamp01, easeInOut, el, lerp, reducedMotion, smooth } from '../scene3d/kit';
import '../scene3d/scene3d.css';
import { Veil } from '../scene3d/veil';
import './lab.css';
import { CHAMBER, EXO_AT, type LabScene, PAD_AT, SX, type Sci, branchLevels, buildLab, labLook, porterSpot } from './room';
import { BRANCH_LABEL, BRANCH_PART, CAST, FIRST, FIRST_NAME, HINT_FIRST, POOL, STATIONS, type SciId, type StationId, contextual, fmtInt, fmtKm, plural, progressOf } from './texts';

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
  /** Facultatif : un scientifique vient de dire cette réplique (pour jouer sa voix). */
  onVoice?(who: SciId, text: string): void;
  /** Facultatif : ouvrir l'arbre de compétences (tuile « Compétences » de la chambre). Sans lui : onSkills. */
  onSkillTree?(): void;
  /** Facultatif : le porteur vient de se reposer dans sa chambre (l'ancien remettait l'endurance au maximum). */
  onRest?(): void;
}
export interface LabOpts {
  ambiance?: Ambiance;
  /** Démo et captures : pas d'animation continue, la scène n'est redessinée qu'après un changement. */
  still?: boolean;
  /** Démo et captures : fige la séquence de départ à cette fraction (0 à 1) au lieu de la terminer. */
  holdDepartAt?: number;
}

const MET_KEY = 'dernier-relais/labo-rencontres';
const BRANCH_ICON: Record<SkillBranch, IconName> = { scanner: 'scanner', portage: 'portage', endurance: 'endurance', 'réseau': 'reseau' };
const BRANCHES: SkillBranch[] = ['scanner', 'portage', 'endurance', 'réseau'];
const DEPART_S = 2.7;
type Mode = 'hall' | 'exo' | 'room';

/** off / offX : décalage de l'image (fraction de l'écran) pour laisser la place au panneau du poste. */
interface Shot { pos: THREE.Vector3; look: THREE.Vector3; fov: number; off: number; offX: number }
const _v = new THREE.Vector3();
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export class Lab {
  private readonly host: HTMLDivElement;
  private readonly veil: Veil;
  private readonly flash: HTMLDivElement;
  private readonly dim: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly goBtn: HTMLButtonElement;
  private readonly goMain: HTMLElement;
  private readonly goSub: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly stats: HTMLDivElement;
  private vp: Viewport | null = null;
  private loader: Loader3D | null = null;
  private lab: LabScene | null = null;
  private building: Promise<void> | null = null;
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  private readonly ray = new THREE.Raycaster();
  private ambiance: Ambiance;
  private readonly still: boolean;
  private readonly holdDepart: number | null;
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
  // poste courant et caméra
  private st = 1;
  private mode: Mode = 'hall';
  private from: Shot = this.shotFor();
  private to: Shot = this.shotFor();
  private cur: Shot = this.shotFor();
  private moveT = 1;
  private moveDur = 1.0;
  private yaw = 0;
  private drag: { id: number; x: number; y: number; x0: number; y0: number; moved: number } | null = null;
  private walking = false;
  private cats = 0;
  private timers: number[] = [];
  private busyRoom = false;
  // dialogue
  private said = new Set<string>();
  private poolAt: Record<SciId, number> = { iris: 0, noe: 0, selma: 0 };
  private talking: Sci | null = null;
  private bubbleTimer = 0;
  // départ
  private departT = -1;
  private departDur = DEPART_S;
  private readonly departFrom = new THREE.Vector3();
  private departed = false;
  private held = false;

  constructor(root: HTMLElement, private readonly events: LabEvents, opts: LabOpts = {}) {
    this.ambiance = opts.ambiance ?? 'crépuscule';
    this.still = !!opts.still;
    this.holdDepart = typeof opts.holdDepartAt === 'number' ? opts.holdDepartAt : null;
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

    // Flèches vers le poste voisin, avec son nom (ancien : labPrev / labNext).
    const nav = (cls: string, dir: number): HTMLButtonElement => {
      const b = el('button', `lab-nav ${cls}`);
      b.type = 'button';
      const name = el('span', 'lab-nav-name');
      if (dir < 0) b.append(icon('retour'), name); else b.append(name, icon('suivant'));
      b.addEventListener('click', () => this.step(dir));
      b.hidden = true;
      return b;
    };
    this.prevBtn = nav('is-prev', -1);
    this.nextBtn = nav('is-next', 1);

    this.bubble = el('div', 'lab-bubble');
    this.bubble.hidden = true;
    this.bubble.setAttribute('role', 'status');
    this.bubble.addEventListener('click', () => this.hush());
    this.hint = el('div', 'lab-hint');
    this.hint.hidden = true;
    this.hint.setAttribute('role', 'status');
    this.panel = el('div', 'lab-panel');

    const bottom = el('div', 'lab-bottom');
    this.goBtn = el('button', 'lab-go');
    this.goBtn.type = 'button';
    this.goBtn.dataset.act = 'depart';
    const goText = el('span', 'lab-go-text');
    this.goMain = el('b', '', 'Partir');
    this.goSub = el('small', '', 'Le Passeur te dépose à ta position');
    goText.append(this.goMain, this.goSub);
    this.goBtn.append(icon('passeur'), goText, icon('fleche', 'lab-go-arrow'));
    this.goBtn.addEventListener('click', () => this.depart());
    bottom.append(this.panel, this.goBtn);

    this.flash = el('div', 'lab-flash');
    this.dim = el('div', 'lab-dim');
    h.append(top, this.prevBtn, this.nextBtn, this.bubble, this.hint, bottom, this.dim, this.flash);
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
    this.resetVisit();
    this.sig = '';
    this.update(view);
    this.veil.loader(false);
    this.frame(performance.now(), true);
    this.veil.lift();
    this.start();
    // Première visite (ancien) : on arrive à la salle des cartes, Iris prend la parole, puis l'indication.
    if (!this.met().iris && !this.still) this.later(900, () => { if (this.mode === 'hall' && this.st === 0 && this.departT < 0) { this.talk('iris'); this.setHint(HINT_FIRST); } });
  }

  /** Nouvel état du jeu : exosquelette, pastilles, carte, contrats, répliques. Peu coûteux si rien n'a changé. */
  update(view: GameView): void {
    this.view = view;
    const p = view.player, g = progressOf(view);
    const sig = `${p.level}|${p.xp}|${p.skillPoints}|${p.deliveries}|${p.score}|${p.distanceKm.toFixed(1)}|${p.stamina < 0.35}|${g.linked}|${g.claimable}|`
      + view.skills.map(s => s.rank).join('') + view.contracts.map(c => `${c.progress}${c.done ? 'd' : ''}${c.claimed ? 'c' : ''}`).join(',') + (p.at ? p.at.map(n => n.toFixed(2)).join() : '');
    if (sig === this.sig) return;
    this.sig = sig;
    this.lab?.sync(view);
    this.renderStats(view);
    this.render();
    this.dirty = 3;
  }

  /** Cache le labo et met le rendu en pause (aucune image calculée tant qu'il est fermé). */
  close(): void {
    this.opened = false;
    this.stop();
    this.hush();
    this.clearTimers();
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

  /** Va à un poste (identifiant ou rang 0 à 2). immediate : sans travelling. */
  go(station: StationId | number, immediate = false): void {
    const i = typeof station === 'number' ? station : STATIONS.findIndex(s => s.id === station);
    if (i < 0 || i > 2 || this.departT >= 0 || this.busyRoom) return;
    if (this.mode === 'room') return;
    this.hush();
    if (i !== this.st) this.setHint('');
    this.st = i;
    this.mode = 'hall';
    this.travel(immediate);
    this.render();
  }

  /** Poste voisin : −1 à gauche, +1 à droite. */
  step(dir: number): void {
    if (this.mode !== 'hall') return;
    const i = this.st + (dir < 0 ? -1 : 1);
    if (i >= 0 && i <= 2) this.go(i);
  }

  /** Fiche de l'exosquelette, à l'atelier de Noé (ancien : openExo). */
  openExo(immediate = false): void {
    if (this.departT >= 0 || this.busyRoom || this.mode === 'room') return;
    this.hush();
    this.st = 1;
    this.mode = 'exo';
    this.travel(immediate);
    this.render();
  }

  /** Entre dans la chambre des quartiers, par un fondu (ancien : lobEnterRoom). */
  enterRoom(immediate = false): void {
    if (this.departT >= 0 || this.busyRoom || this.mode === 'room') return;
    this.hush();
    this.setHint('');
    this.swap(immediate, () => {
      this.st = 2;
      this.mode = 'room';
      this.lab?.seatPorter();
      this.lab?.lamp(1);
      this.lab?.setCats(this.cats, () => { this.dirty = 3; });
      this.walking = false;
    });
  }

  /** Quitte la chambre et revient au poste des quartiers. */
  leaveRoom(immediate = false): void {
    if (this.mode !== 'room' || this.busyRoom) return;
    this.swap(immediate, () => {
      this.mode = 'hall';
      this.st = 2;
      this.standPorter();
    });
  }

  /** Nombre de chats clandestins installés dans la chambre (0 à 3). Le jeu actuel n'en donne pas encore. */
  setCats(n: number): void {
    this.cats = Math.max(0, Math.min(3, Math.floor(n)));
    if (this.mode === 'room') { this.lab?.setCats(this.cats, () => { this.dirty = 3; }); this.dirty = 3; }
  }

  /** Fait parler un scientifique (bulle au-dessus de sa tête). */
  talk(id: SciId): void {
    const lab = this.lab, v = this.view;
    if (!lab || !v || this.departT >= 0 || this.mode === 'room') return;
    const sci = lab.scis.find(s => s.id === id);
    if (!sci) return;
    if (sci.st !== this.st) { this.st = sci.st; this.mode = 'hall'; this.travel(true); this.render(); }
    let text: string;
    const met = this.met();
    const ctx = contextual(id, v).find(c => !this.said.has(`${id}:${c.key}`));
    if (!met[id]) { text = FIRST[id]; met[id] = 1; try { localStorage.setItem(MET_KEY, JSON.stringify(met)); } catch { /* stockage indisponible */ } }
    else if (ctx) { text = ctx.text; this.said.add(`${id}:${ctx.key}`); }
    else { const pool = POOL[id]; text = pool[this.poolAt[id] % pool.length]; this.poolAt[id]++; }

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
    this.host.classList.add('is-talking');
    clearTimeout(this.bubbleTimer);
    if (!this.still) this.bubbleTimer = window.setTimeout(() => this.hush(), dur * 1000);
    this.render();
    this.dirty = 3;
    try { this.events.onVoice?.(id, text); } catch (e) { console.warn('[labo] voix', e); }
  }

  // ---------- Construction ----------
  private async build(): Promise<void> {
    try { this.vp = new Viewport(this.host, { post: true }); } catch (e) {
      // Pas de WebGL : le menu reste entièrement utilisable (panneaux et boutons), sans la scène.
      console.warn('[labo] WebGL indisponible, menu sans décor', e);
      this.host.classList.add('no-gl');
      return;
    }
    const vp = this.vp;
    this.host.prepend(vp.canvas);
    vp.setLook({ ...labLook(this.ambiance), bloomThreshold: 1.0, bloomRadius: 0.65, vignette: 0.55, grain: 0.028 });
    this.loader = new Loader3D(k => this.veil.progress(k));
    this.lab = await buildLab(vp, this.loader, this.ambiance);
    if (this.dead) { this.lab.dispose(); return; }
    const c = vp.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
  }

  private later(ms: number, fn: () => void): void {
    const id = window.setTimeout(() => { this.timers = this.timers.filter(x => x !== id); if (this.opened && !this.dead) fn(); }, ms);
    this.timers.push(id);
  }
  private clearTimers(): void { this.timers.forEach(clearTimeout); this.timers = []; this.busyRoom = false; this.dim.style.opacity = '0'; }

  /** Fondu au noir, changement de lieu, retour de l'image. */
  private swap(immediate: boolean, change: () => void): void {
    const done = (): void => { change(); this.travel(true); this.render(); this.dirty = 3; };
    if (immediate || this.still || this.calm || !this.lab) { done(); return; }
    this.busyRoom = true;
    this.dim.style.opacity = '1';
    this.later(520, () => { done(); this.dim.style.opacity = '0'; this.later(300, () => { this.busyRoom = false; }); });
  }

  private standPorter(): void {
    const lab = this.lab;
    if (!lab) return;
    lab.porterG.position.copy(porterSpot(this.st)); lab.porterG.rotation.y = 0.55; lab.porterG.visible = true;
    lab.porter.play(lab.porter.pick('calm_0', 'calmv0'), 0);
    this.walking = false;
  }

  private setHint(text: string): void {
    this.hint.textContent = text;
    this.hint.hidden = !text;
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


  // ---------- Panneaux ----------
  private btn(cls: string, label: string, act: string, onTap: () => void, badge = 0): HTMLButtonElement {
    const b = el('button', `lab-btn ${cls}`);
    b.type = 'button';
    b.dataset.act = act;
    b.appendChild(el('span', '', label));
    if (badge > 0) b.appendChild(el('i', 'lab-badge', String(badge)));
    b.addEventListener('click', onTap);
    return b;
  }

  /** Redessine le panneau du bas selon le lieu : poste du hall, atelier de l'exosquelette ou chambre. */
  private render(): void {
    const hall = this.mode === 'hall', S = STATIONS[this.st], leaving = this.departT >= 0;
    this.host.dataset.poste = S.id;
    this.host.dataset.lieu = this.mode;
    const prev = hall ? STATIONS[this.st - 1] : undefined, next = hall ? STATIONS[this.st + 1] : undefined;
    this.prevBtn.hidden = !prev || leaving; this.nextBtn.hidden = !next || leaving;
    if (prev) { (this.prevBtn.querySelector('.lab-nav-name') as HTMLElement).textContent = prev.name; this.prevBtn.setAttribute('aria-label', `Poste précédent : ${prev.name}`); }
    if (next) { (this.nextBtn.querySelector('.lab-nav-name') as HTMLElement).textContent = next.name; this.nextBtn.setAttribute('aria-label', `Poste suivant : ${next.name}`); }
    // « Partir » reste là partout dans le hall ; au Passeur, il porte le libellé de l'ancien.
    this.goBtn.hidden = this.mode === 'room';
    const atPad = this.st === 1;
    this.goMain.textContent = atPad ? 'Se téléporter' : 'Partir';
    this.goSub.textContent = atPad ? 'à ma position' : 'Le Passeur te dépose à ta position';
    this.goBtn.setAttribute('aria-label', atPad ? 'Se téléporter à ma position' : 'Partir : le Passeur te dépose à ta position');
    this.goBtn.classList.toggle('is-pad', atPad);
    this.panel.className = `lab-panel is-${this.mode}`;
    if (this.mode === 'room') this.renderRoom();
    else if (this.mode === 'exo') this.renderExo();
    else this.renderStation();
  }

  private renderStation(): void {
    const S = STATIONS[this.st], v = this.view;
    const dots = el('div', 'lab-dots');
    dots.setAttribute('role', 'tablist');
    dots.setAttribute('aria-label', 'Postes de la Station Lumen');
    STATIONS.forEach((s, i) => {
      const d = el('button', i === this.st ? 'lab-dot is-on' : 'lab-dot');
      d.type = 'button';
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', s.name);
      d.setAttribute('aria-selected', String(i === this.st));
      d.appendChild(el('i'));
      d.addEventListener('click', () => this.go(i));
      dots.appendChild(d);
    });
    const head = el('div', 'lab-panel-head');
    head.append(el('span', 'lab-card-kicker', 'Station Lumen'), el('h2', 'lab-card-title', S.name));
    const body = el('div', 'lab-card-body');
    body.appendChild(el('p', 'lab-note', S.desc));
    const btns = el('div', 'lab-btns');
    const talk = this.btn('is-ghost', `Parler à ${FIRST_NAME[S.sci]}`, 'talk', () => this.talk(S.sci));
    const fresh = !!v && (!this.met()[S.sci] || contextual(S.sci, v).some(c => !this.said.has(`${S.sci}:${c.key}`)));
    talk.classList.toggle('has-news', fresh);
    const g = v ? progressOf(v) : null;
    if (S.id === 'cartes') {
      if (g && g.claimable > 0) body.appendChild(el('p', 'lab-note is-hot', `${plural(g.claimable, 'récompense de contrat t’attend', 'récompenses de contrat t’attendent')}.`));
      btns.append(this.btn('is-main', 'Ouvrir la carte de France', 'network', () => this.events.onNetwork()),
        this.btn('', 'Contrats', 'contracts', () => this.events.onContracts(), g?.claimable ?? 0), talk);
    } else if (S.id === 'passeur') {
      btns.append(this.btn('', 'Exosquelette', 'exo', () => this.openExo(), v?.player.skillPoints ?? 0), talk);
    } else {
      btns.append(this.btn('is-main', 'Entrer dans les quartiers', 'enter', () => this.enterRoom()),
        this.btn('', 'Carnet', 'journal', () => this.events.onJournal()), talk);
    }
    this.panel.replaceChildren(dots, head, body, btns);
  }

  private backHead(kicker: string, title: string, label: string, onBack: () => void): HTMLDivElement {
    const head = el('div', 'lab-card-head');
    const back = el('button', 'lab-back');
    back.type = 'button';
    back.dataset.act = 'back';
    back.setAttribute('aria-label', label);
    back.appendChild(icon('retour'));
    back.addEventListener('click', onBack);
    const titles = el('div', 'lab-card-titles');
    titles.append(el('span', 'lab-card-kicker', kicker), el('h2', 'lab-card-title', title));
    head.append(back, titles);
    return head;
  }

  /** Atelier de Noé : l'exosquelette, branche par branche (ancien : « Noé Kessler · atelier »). */
  private renderExo(): void {
    const v = this.view;
    const head = this.backHead('Noé Kessler · atelier', 'Exosquelette', 'Retour au Passeur', () => this.go(1));
    const body = el('div', 'lab-card-body');
    if (v) {
      const p = v.player, lv = branchLevels(v), grid = el('div', 'lab-branches');
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
    }
    const btns = el('div', 'lab-btns');
    btns.appendChild(this.btn('is-main', 'Compétences', 'skills', () => this.events.onSkills()));
    this.panel.replaceChildren(head, body, btns);
  }

  /** La chambre (ancien : renderRoom) : se reposer, carnet du porteur, compétences. */
  private renderRoom(): void {
    const v = this.view;
    const head = this.backHead('Station Lumen', 'Quartiers', 'Sortir des quartiers', () => this.leaveRoom());
    const body = el('div', 'lab-card-body');
    const tile = (act: string, title: string, sub: string, onTap: () => void): HTMLButtonElement => {
      const b = el('button', 'lab-tile');
      b.type = 'button';
      b.dataset.act = act;
      b.append(el('b', '', title), el('span', '', sub));
      b.addEventListener('click', onTap);
      return b;
    };
    const grid = el('div', 'lab-tiles');
    const sp = v?.player.skillPoints ?? 0;
    grid.append(
      tile('rest', 'Se reposer', 'S’allonger un moment', () => this.rest()),
      tile('journal', 'Carnet', 'Profil, statistiques', () => this.events.onJournal()),
      tile('tree', 'Compétences', sp > 1 ? `${sp} points` : `${sp} point`, () => { if (this.events.onSkillTree) this.events.onSkillTree(); else this.events.onSkills(); }),
    );
    body.appendChild(grid);
    if (v) {
      const p = v.player;
      body.appendChild(this.figures([[fmtInt(p.deliveries), p.deliveries > 1 ? 'livraisons' : 'livraison'], [`${fmtKm(p.distanceKm)} km`, 'parcourus'], [fmtInt(p.score), 'points']]));
    }
    body.appendChild(el('p', 'lab-note', 'En dehors des tournées, le porteur reste en tenue civile.'));
    this.panel.replaceChildren(head, body);
  }

  /** Se reposer (ancien) : le porteur s'allonge, la lampe baisse, la chambre s'assombrit, puis il se relève. */
  private rest(): void {
    const lab = this.lab;
    if (this.mode !== 'room' || this.busyRoom) return;
    const end = (): void => {
      lab?.seatPorter(); lab?.lamp(1);
      this.dim.style.opacity = '0';
      this.panel.hidden = false;
      this.busyRoom = false;
      this.dirty = 3;
      this.setHint('Reposé');
      this.later(2600, () => this.setHint(''));
      try { this.events.onRest?.(); } catch (e) { console.warn('[labo] repos', e); }
    };
    if (!lab || this.still || this.calm) { end(); return; }
    this.busyRoom = true;
    this.panel.hidden = true;
    const lie = lab.porter.pick('Sit_Lie_Bed', 'Sleep_Normally');
    if (lie) lab.porter.play(lie, 0.35, true);
    this.later(1900, () => { this.dim.style.opacity = '0.93'; });
    this.later(2700, () => lab.lamp(0));
    this.later(5400, end);
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
    this.host.classList.remove('is-talking');
    if (this.talking) this.talking.talkUntil = this.t; // retour au calme à la prochaine image
    this.talking = null;
    this.dirty = 3;
  }

  private met(): Record<string, number> {
    try { return JSON.parse(localStorage.getItem(MET_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
  }

  // ---------- Départ par le Passeur ----------
  private depart(): void {
    if (!this.opened || this.departT >= 0 || this.departed || this.busyRoom || this.mode === 'room') return;
    if (!this.lab || !this.vp) { this.departed = true; this.events.onDepart(); return; }
    this.hush();
    this.setHint('');
    const far = this.st !== 1;
    this.st = 1;
    this.mode = 'hall';
    this.travel(false);
    this.departT = 0;
    this.departDur = far ? DEPART_S + 0.9 : DEPART_S;
    this.departFrom.copy(this.lab.porterG.position);
    this.host.classList.add('is-leaving');
    this.render();
    const p = this.lab.porter;
    if (!this.calm) p.play(far ? p.pick('run', 'walk') : p.pick('walk'), 0.3);
    this.walking = true;
  }

  private stepDepart(dt: number): number {
    const lab = this.lab;
    if (!lab || this.departT < 0) return 0;
    const dur = this.calm || this.still ? 0.5 : this.departDur;
    this.departT += dt;
    let k = clamp01(this.departT / dur);
    if (this.holdDepart !== null && k >= this.holdDepart) { k = this.holdDepart; this.held = true; }
    const g = lab.porterG;
    // Le porteur rejoint la plateforme, puis se dissout dans la lumière.
    const w = smooth(clamp01(k / 0.72));
    _v.set(PAD_AT.x, 0, PAD_AT.z + 0.55);
    const face = Math.atan2(_v.x - this.departFrom.x, _v.z - this.departFrom.z);
    g.position.lerpVectors(this.departFrom, _v, w);
    g.rotation.y = w >= 1 ? lerp(face, Math.PI * 2, smooth(clamp01((k - 0.72) / 0.1))) : lerp(0.55, face, smooth(clamp01(k / 0.12)));
    if (w >= 1 && this.walking) { this.walking = false; lab.porter.play(lab.porter.pick('calm_0', 'calmv0'), 0.3); }
    g.visible = k < 0.9;
    this.flash.style.opacity = smooth(clamp01((k - 0.8) / 0.2)).toFixed(3);
    if (k >= 1 && !this.departed) {
      this.departed = true;
      this.veil.cover(true);
      this.flash.style.opacity = '0';
      this.events.onDepart();
    }
    return smooth(clamp01((k - 0.25) / 0.6));
  }

  /** Remet le labo dans son état d'accueil (à chaque ouverture) : au Passeur, ou à la salle des cartes la première fois. */
  private resetVisit(): void {
    this.clearTimers();
    this.departT = -1;
    this.departed = false;
    this.held = false;
    this.said = new Set();
    this.host.classList.remove('is-leaving');
    this.flash.style.opacity = '0';
    this.panel.hidden = false;
    this.setHint('');
    this.hush();
    this.mode = 'hall';
    this.st = this.met().iris ? 1 : 0;
    this.standPorter();
    this.travel(true);
    this.render();
  }

  // ---------- Caméra ----------
  /** Cadrage du lieu courant, à hauteur d'homme (ancien : caméra à 2 m, face au poste). */
  private shotFor(): Shot {
    const wide = this.vp ? this.vp.aspect > 1 : false, x = SX[this.st];
    if (this.mode === 'room') {
      return { pos: V(CHAMBER.x - 0.2, 1.5, CHAMBER.z + (wide ? 3.0 : 3.6)), look: V(CHAMBER.x - 0.6, 0.75, CHAMBER.z - 1.6), fov: wide ? 46 : 58, off: wide ? 0 : 0.16, offX: wide ? -0.18 : 0 };
    }
    if (this.mode === 'exo') {
      return { pos: V(EXO_AT.x + 2.3, 1.5, EXO_AT.z + 4.7), look: V(EXO_AT.x, 1.3, EXO_AT.z), fov: wide ? 36 : 54, off: wide ? 0 : 0.2, offX: wide ? -0.2 : 0 };
    }
    // En vertical, l'image est décalée vers le haut ; en paysage, vers la droite (le panneau est à gauche).
    return wide
      ? { pos: V(x + 0.3, 1.75, 5.6), look: V(x - 0.1, 1.35, -2.4), fov: 42, off: 0, offX: -0.17 }
      : { pos: V(x + 0.3, 1.7, 5.9), look: V(x - 0.1, 1.5, -2.4), fov: 56, off: 0.15, offX: 0 };
  }

  private travel(immediate: boolean): void {
    this.from = { ...this.cur, pos: this.cur.pos.clone(), look: this.cur.look.clone() };
    this.to = this.shotFor();
    this.moveDur = this.calm ? 0.01 : 1.0;
    this.moveT = immediate || this.still ? 1 : 0;
    this.yaw = 0;
    this.dirty = 3;
  }

  private applyCamera(dt: number): void {
    const cam = this.camera, vp = this.vp;
    if (!vp) return;
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + dt / this.moveDur);
      const k = easeInOut(this.moveT);
      this.cur.pos.lerpVectors(this.from.pos, this.to.pos, k);
      this.cur.look.lerpVectors(this.from.look, this.to.look, k);
      this.cur.fov = lerp(this.from.fov, this.to.fov, k);
      this.cur.off = lerp(this.from.off, this.to.off, k);
      this.cur.offX = lerp(this.from.offX, this.to.offX, k);
    } else {
      this.cur.pos.copy(this.to.pos); this.cur.look.copy(this.to.look); this.cur.fov = this.to.fov; this.cur.off = this.to.off; this.cur.offX = this.to.offX;
    }
    if (!this.drag) this.yaw -= this.yaw * Math.min(1, dt * 5);
    // Le doigt entraîne un peu l'image (on sent le hall glisser), puis la respiration.
    cam.position.copy(this.cur.pos);
    cam.position.x += this.yaw;
    if (!this.calm && !this.still) {
      cam.position.x += Math.sin(this.t * 0.37) * 0.03 + Math.sin(this.t * 0.83 + 1) * 0.01;
      cam.position.y += Math.sin(this.t * 0.29 + 2) * 0.015;
    }
    _v.copy(this.cur.look); _v.x += this.yaw;
    cam.lookAt(_v);
    const off = Math.round(this.cur.off * vp.height), offX = Math.round(this.cur.offX * vp.width);
    if (cam.fov !== this.cur.fov || (cam.view?.offsetY ?? 0) !== off || (cam.view?.offsetX ?? 0) !== offX || cam.aspect !== vp.aspect) {
      cam.fov = this.cur.fov; cam.aspect = vp.aspect;
      if (off || offX) cam.setViewOffset(vp.width, vp.height, offX, off, vp.width, vp.height); else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Une seule station est dessinée au repos ; pendant le travelling, celles qui entrent dans le champ. */
  private cull(): void {
    const lab = this.lab, vp = this.vp;
    if (!lab || !vp) return;
    if (this.mode === 'room') { lab.show([false, false, false], true); return; }
    const reach = 4.6 + Math.tan((this.cur.fov * Math.PI) / 360) * vp.aspect * 12 + Math.abs(this.cur.offX) * 8;
    const x = this.cur.pos.x + this.yaw;
    lab.show(SX.map(sx => Math.abs(sx - x) < reach), false);
  }

  /** Dans le hall, le porteur suit d'un poste à l'autre (ancien). */
  private movePorter(dt: number): boolean {
    const lab = this.lab;
    if (!lab || this.mode === 'room' || this.departT >= 0) return false;
    const g = lab.porterG, to = porterSpot(this.st);
    const dx = to.x - g.position.x, dz = to.z - g.position.z, d = Math.hypot(dx, dz);
    if (d < 0.06 || this.still || this.calm) {
      if (d >= 0.06) g.position.copy(to);
      if (this.walking) { this.walking = false; lab.porter.play(lab.porter.pick('calm_0', 'calmv0'), 0.3); }
      const turn = Math.atan2(Math.sin(0.55 - g.rotation.y), Math.cos(0.55 - g.rotation.y));
      if (this.still || this.calm) { g.rotation.y = 0.55; return false; }
      g.rotation.y += turn * Math.min(1, dt * 5);
      return Math.abs(turn) > 0.01;
    }
    if (!this.walking) { this.walking = true; lab.porter.play(lab.porter.pick('walk'), 0.25); }
    const sp = Math.min(3.6, d * 2.2 + 0.9), stp = Math.min(d, sp * dt);
    g.position.x += (dx / d) * stp; g.position.z += (dz / d) * stp;
    const face = Math.atan2(dx, dz);
    g.rotation.y += Math.atan2(Math.sin(face - g.rotation.y), Math.cos(face - g.rotation.y)) * Math.min(1, dt * 9);
    return true;
  }

  private placeBubble(): void {
    const vp = this.vp;
    if (!vp || !this.talking || this.bubble.hidden) return;
    _v.copy(this.talking.head).project(this.camera);
    const w = Math.min(300, vp.width - 24);
    const x = Math.max(12 + w / 2, Math.min(vp.width - 12 - w / 2, (_v.x * 0.5 + 0.5) * vp.width));
    const y = Math.max(150, (-_v.y * 0.5 + 0.5) * vp.height - 14);
    this.bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    this.bubble.style.setProperty('--tail', `${Math.round((_v.x * 0.5 + 0.5) * vp.width - x)}px`);
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
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    const moving = this.movePorter(dt);
    const busy = moving || this.moveT < 1 || !!this.drag || (this.departT >= 0 && !this.held) || Math.abs(this.yaw) > 0.002 || this.dirty > 0 || this.busyRoom;
    if (this.still && !busy && !force) return;
    // Au repos, une image sur deux suffit (respiration, poussière) : moitié moins de travail pour la batterie.
    this.skip = !this.skip;
    if (!busy && !force && this.skip) return;
    this.last = now;
    this.t += dt;
    if (this.dirty > 0) this.dirty--;
    if (vp.resize()) { this.to = this.shotFor(); this.dirty = 2; }
    const charge = this.stepDepart(dt);
    this.applyCamera(dt);
    this.cull();
    lab.tick(this.t, this.still ? 0 : dt, charge);
    this.placeBubble();
    vp.render(lab.scene, this.camera, this.t);
  }

  // ---------- Gestes ----------
  private readonly onVisibility = (): void => { if (document.hidden) this.stop(); else this.start(); };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.opened || this.host.hidden) return;
    if (e.key === 'Escape') { if (this.mode === 'exo') this.go(1); else if (this.mode === 'room') this.leaveRoom(); }
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'ArrowRight') this.step(1);
  };
  private readonly onDown = (e: PointerEvent): void => {
    if (this.departT >= 0 || this.drag) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0 };
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* sans gravité */ }
  };
  private readonly onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    d.moved += Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
    d.x = e.clientX; d.y = e.clientY;
    if (this.calm || this.mode !== 'hall') return;
    this.yaw = Math.max(-0.9, Math.min(0.9, -(d.x - d.x0) * 0.006));
  };
  private readonly onUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    if (e.type === 'pointercancel' || !this.lab || !this.vp) return;
    // Glisser à l'horizontale : poste voisin (ancien : plus de 45 px, et plus large que haut).
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { if (this.mode === 'hall') this.step(dx < 0 ? 1 : -1); return; }
    if (d.moved > 12) return;
    if (!this.bubble.hidden) { this.hush(); return; }
    // Toucher : un scientifique, le râtelier de l'exosquelette, la porte des quartiers.
    const r = this.vp.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.lab.hits, false)[0];
    const u = hit ? hit.object.userData as { kind: 'sci' | 'exo' | 'porte'; id: string; st: number } : null;
    if (this.mode === 'exo') { if (!u || u.kind !== 'exo') this.go(1); return; }
    if (this.mode !== 'hall' || !u || u.st !== this.st) return;
    if (u.kind === 'sci') this.talk(u.id as SciId);
    else if (u.kind === 'exo') this.openExo();
    else this.enterRoom();
  };
}
