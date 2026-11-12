// L'ARBRE DE COMPÉTENCES — écran à part entière : un plateau d'atelier en 3D vu de biais, quatre
// branches de modules reliés par des câbles. Toucher un module y amène la caméra et ouvre sa fiche.
// Scène three.js autonome (son propre canvas plein écran, au-dessus du labo et du HUD).
import * as THREE from 'three';
import type { ActionResult, Ambiance, GameView, SkillBranch, SkillView, UiKind } from '../game/api';
import { skillDef } from '../game/skills';
import { Loader3D, Viewport, el, reducedMotion } from '../scene3d/kit';
import { BRANCH_ICON, icon } from './icons';
import { BRANCHES, BRANCH_HEX, BRANCH_NAME, EXTENT, type NodeInput, TreeScene, treeLook } from './scene';
import './tree.css';

export interface SkillTreeEvents {
  learn(id: string): ActionResult;
  onClose?(): void;
  onUi?(kind: UiKind): void;
}
export interface SkillTreeOpts {
  ambiance?: Ambiance;
  /** Démo et captures : pas d'animation, une image par changement. */
  still?: boolean;
  /** Rendu allégé : ni ombres, ni post-traitement, ni décor, ni flou de profondeur. */
  leger?: boolean;
}

/** Effet cumulé d'une compétence à un rang donné (mêmes chiffres que src/game/skills.ts). */
const EFFECT: Record<string, (r: number) => string> = {
  'scan-portee': r => `Portée +${40 * r} m`,
  'scan-recharge': r => `Recharge −${r} s`,
  'bras-long': r => `Ramassage +${10 * r} m`,
  sac: r => `Sac +${5 * r} kg`,
  calage: r => `Usure −${15 * r} %`,
  sangles: r => `Déséquilibre −${25 * r} %`,
  foulee: r => `Fatigue −${15 * r} %`,
  souffle: r => `Récupération +${25 * r} %`,
  'tout-terrain': r => `Dégâts en zone −${30 * r} %`,
  carnet: r => `XP +${10 * r} %`,
  relais: r => `Points d’abri +${10 * r} %`,
  reputation: r => `Contrats +${15 * r} %`,
};

/** Nom court affiché sous le module en vue d'ensemble (le nom complet reste dans la fiche). */
const SHORT: Record<string, string> = {
  'scan-portee': 'Antenne', 'scan-recharge': 'Condensateur', 'bras-long': 'Perche',
  sac: 'Armature', calage: 'Calage', sangles: 'Sangles',
  'exo-bras': 'Attaches bras', 'exo-jambes': 'Att. jambes', 'exo-gyro': 'Gyroscopes',
  foulee: 'Foulée', souffle: 'Souffle', 'tout-terrain': 'Tout-terrain',
  carnet: 'Carnet', relais: 'Voix réseau', reputation: 'Réputation',
};
/** Abrège proprement un nom que la table ne connaît pas : les premiers mots qui tiennent en 13 caractères. */
function shortName(id: string, name: string): string {
  if (SHORT[id]) return SHORT[id];
  if (name.length <= 13) return name;
  let out = '';
  for (const w of name.split(' ')) { if (out && (out + ' ' + w).length > 13) break; out = out ? `${out} ${w}` : w; }
  return out.length > 13 ? `${out.slice(0, 12)}…` : out;
}
/** Ce que le module apporte en une ligne courte, pour les paliers d'exosquelette (pas de chiffre par rang). */
const EXO_FX: Record<string, string> = { 'exo-bras': 'Bras 2 × 12 kg', 'exo-jambes': 'Cuisses 2 × 9 kg', 'exo-gyro': 'Dérive −20 %' };

type State = 'max' | 'dispo' | 'verrou' | 'attente';
interface Need { id: string; rank: number; name: string }
interface Cam { tx: number; tz: number; yaw: number; zoom: number; off: number }

const YAW0 = 0.05, PITCH = 0.96, FOV = 27;
const ZOOM_MIN = 0.42, ZOOM_MAX = 1.12, ZOOM_FOCUS = 0.66;
const plural = (n: number, w: string): string => `${n} ${w}${n > 1 ? 's' : ''}`;
const _v = new THREE.Vector3();

export class SkillTree {
  private readonly host: HTMLDivElement;
  private readonly topEl: HTMLElement;
  private readonly kicker: HTMLSpanElement;
  private readonly ptsN: HTMLElement;
  private readonly ptsL: HTMLSpanElement;
  private readonly ptsBox: HTMLDivElement;
  private readonly tagsEl: HTMLDivElement;
  private readonly legend: HTMLDivElement;
  private readonly card: HTMLElement;
  private readonly loading: HTMLDivElement;
  private readonly tags = new Map<string, { el: HTMLButtonElement; name: HTMLSpanElement; rank: HTMLSpanElement; sub: HTMLSpanElement }>();
  private readonly legs = new Map<SkillBranch, { bar: HTMLElement; n: HTMLElement; el: HTMLButtonElement }>();
  // fiche
  private readonly cBranch: HTMLSpanElement;
  private readonly cState: HTMLSpanElement;
  private readonly cName: HTMLHeadingElement;
  private readonly cDesc: HTMLParagraphElement;
  private readonly cPips: HTMLDivElement;
  private readonly cRank: HTMLSpanElement;
  private readonly cFx: HTMLDivElement;
  private readonly cNow: HTMLElement;
  private readonly cNext: HTMLElement;
  private readonly cNextL: HTMLSpanElement;
  private readonly cWhy: HTMLParagraphElement;
  private readonly cBtn: HTMLButtonElement;
  private readonly cBtnL: HTMLSpanElement;
  private readonly cCost: HTMLSpanElement;

  private vp: Viewport | null = null;
  private loader: Loader3D | null = null;
  private tree: TreeScene | null = null;
  private opening: Promise<void> | null = null;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 80);
  private ambiance: Ambiance;
  private readonly still: boolean;
  private readonly leger: boolean;
  private readonly calm = reducedMotion();
  private skills: SkillView[] = [];
  private points = 0;
  private level = 0;
  private sig = '';
  private selected: string | null = null;
  private refusal: string | null = null;
  private opened = false;
  private dead = false;
  private raf = 0;
  private last = 0;
  private t = 0;
  private dirty = 0;
  private half = false;
  // caméra
  private cur: Cam = { tx: 0, tz: 0, yaw: YAW0, zoom: 1, off: 0 };
  private want: Cam = { ...this.cur };
  private baseDist = 16;
  private ovTz = 0;
  private fitW = 0;
  private fitH = 0;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;

  constructor(root: HTMLElement, private readonly events: SkillTreeEvents, opts: SkillTreeOpts = {}) {
    this.ambiance = opts.ambiance ?? 'crépuscule';
    this.still = !!opts.still;
    this.leger = !!opts.leger;
    const h = this.host = el('div', 'tr');
    h.dataset.ambiance = this.ambiance;
    h.hidden = true;
    h.setAttribute('role', 'dialog');
    h.setAttribute('aria-modal', 'true');
    h.setAttribute('aria-label', 'Arbre de compétences');
    if (this.leger) h.classList.add('tr-leger');

    this.loading = el('div', 'tr-loading', 'Mise sous tension de l’atelier…');
    const dof = [el('div', 'tr-dof tr-dof-a'), el('div', 'tr-dof tr-dof-b')];
    this.tagsEl = el('div', 'tr-tags');

    // En-tête : titre, points à dépenser, fermer.
    const top = this.topEl = el('header', 'tr-top');
    const head = el('div', 'tr-head');
    this.kicker = el('span', 'tr-kicker', 'Atelier');
    head.append(this.kicker, el('h1', 'tr-title', 'Compétences'));
    const pts = this.ptsBox = el('div', 'tr-pts');
    this.ptsN = el('b', 'tr-pts-n', '0');
    this.ptsL = el('span', 'tr-pts-l', 'point à dépenser');
    pts.append(icon('point', 'tr-pts-ic'), this.ptsN, this.ptsL);
    pts.setAttribute('role', 'status');
    const close = el('button', 'tr-iconbtn tr-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer l’arbre de compétences');
    close.append(icon('fermer'));
    close.addEventListener('click', () => this.requestClose());
    top.append(head, pts, close);

    // Légende : l'avancement de chaque branche ; toucher une branche y amène la caméra.
    this.legend = el('div', 'tr-legend');
    for (const b of BRANCHES) {
      const btn = el('button', 'tr-leg');
      btn.type = 'button';
      btn.style.setProperty('--bc', BRANCH_HEX[b]);
      const bar = el('i', 'tr-leg-fill'), n = el('small', 'tr-leg-n', '0/0');
      const track = el('span', 'tr-leg-bar'); track.append(bar);
      btn.append(el('b', 'tr-leg-name', BRANCH_NAME[b]), icon(BRANCH_ICON[b]), track, n);
      btn.addEventListener('click', () => { this.events.onUi?.('tap'); this.goBranch(b); });
      this.legs.set(b, { bar, n, el: btn });
      this.legend.append(btn);
    }

    // Fiche du module choisi.
    const card = this.card = el('section', 'tr-card');
    card.hidden = true;
    card.setAttribute('aria-live', 'polite');
    const cTop = el('div', 'tr-card-top');
    this.cBranch = el('span', 'tr-card-branch');
    this.cState = el('span', 'tr-chip');
    const cClose = el('button', 'tr-iconbtn tr-card-close');
    cClose.type = 'button';
    cClose.setAttribute('aria-label', 'Refermer la fiche');
    cClose.append(icon('fermer'));
    cClose.addEventListener('click', () => { this.events.onUi?.('tap'); this.select(null); });
    cTop.append(this.cBranch, this.cState, cClose);
    this.cName = el('h2', 'tr-card-name');
    this.cDesc = el('p', 'tr-card-desc');
    const rankRow = el('div', 'tr-card-rank');
    this.cPips = el('div', 'tr-pips');
    this.cRank = el('span', 'tr-rank-txt');
    rankRow.append(this.cPips, this.cRank);
    this.cFx = el('div', 'tr-fx');
    const now = el('div', 'tr-fx-cell'), next = el('div', 'tr-fx-cell tr-fx-next');
    this.cNow = el('b'); this.cNext = el('b'); this.cNextL = el('span', 'tr-fx-l', 'Rang suivant');
    now.append(el('span', 'tr-fx-l', 'Actuellement'), this.cNow);
    next.append(this.cNextL, this.cNext);
    this.cFx.append(now, icon('fleche', 'tr-fx-arrow'), next);
    this.cWhy = el('p', 'tr-why');
    this.cBtn = el('button', 'tr-btn');
    this.cBtn.type = 'button';
    this.cBtnL = el('span', '', 'Apprendre');
    this.cCost = el('span', 'tr-btn-cost');
    this.cBtn.append(this.cBtnL, this.cCost);
    this.cBtn.addEventListener('click', () => this.learn());
    card.append(cTop, this.cName, this.cDesc, rankRow, this.cFx, this.cWhy, this.cBtn);

    h.append(this.loading, ...dof, this.tagsEl, top, this.legend, card);
    root.appendChild(h);

    h.addEventListener('pointerdown', this.onDown);
    h.addEventListener('pointermove', this.onMove);
    h.addEventListener('pointerup', this.onUp);
    h.addEventListener('pointercancel', this.onUp);
    h.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('keydown', this.onKey);
  }

  get isOpen(): boolean { return this.opened; }

  /** Ouvre l'écran. Rejette si WebGL est indisponible : l'appelant garde alors la liste. */
  open(view: GameView): Promise<void> {
    if (this.dead) return Promise.reject(new Error('SkillTree détruit'));
    if (this.opened) { this.update(view); return this.opening ?? Promise.resolve(); }
    if (!this.vp) {
      try {
        this.vp = new Viewport(this.host, { post: !this.leger, shadows: !this.leger });
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error('WebGL indisponible'));
      }
      this.host.prepend(this.vp.canvas);
      this.vp.setLook({ ...treeLook(this.ambiance), bloomThreshold: 1.0, bloomRadius: 0.55, vignette: 0.5, grain: 0.022 });
      this.tree = new TreeScene(this.ambiance, this.leger);
      this.loader = new Loader3D();
    }
    this.opened = true;
    this.host.hidden = false;
    this.selected = null; this.refusal = null;
    this.card.hidden = true;
    this.host.classList.remove('has-card');
    this.sig = '';
    this.update(view);
    this.fit(true);
    this.want = this.overview(); this.cur = { ...this.want };
    this.events.onUi?.('open');
    this.invalidate();
    if (!this.opening) {
      const tree = this.tree!, loader = this.loader!;
      this.host.classList.add('is-loading');
      this.opening = (this.leger ? Promise.resolve() : tree.loadCore(loader)).then(() => {
        this.host.classList.remove('is-loading');
        this.invalidate();
      });
    }
    return this.opening;
  }

  /** Affiche un nouvel état du jeu. Peut être appelé à chaque image : ne fait rien si rien n'a changé. */
  update(view: GameView): void {
    const sig = `${view.player.skillPoints}|${view.player.level}|${view.skills.map(s => `${s.id}:${s.rank}/${s.maxRank}${s.available ? '+' : ''}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.skills = view.skills.map(s => ({ ...s }));
    this.points = view.player.skillPoints;
    this.level = view.player.level;
    if (this.selected && !this.skills.some(s => s.id === this.selected)) this.selected = null;
    this.sync(false);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.host.hidden = true;
    this.touches.clear();
    this.stop();
  }

  setAmbiance(a: Ambiance): void {
    if (a === this.ambiance) return;
    this.ambiance = a;
    this.host.dataset.ambiance = a;
    this.tree?.setAmbiance(a);
    this.vp?.setLook(treeLook(a));
    this.invalidate();
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.opened = false;
    this.stop();
    const h = this.host;
    h.removeEventListener('pointerdown', this.onDown);
    h.removeEventListener('pointermove', this.onMove);
    h.removeEventListener('pointerup', this.onUp);
    h.removeEventListener('pointercancel', this.onUp);
    h.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKey);
    this.tree?.dispose(); this.tree = null;
    this.loader?.dispose(); this.loader = null;
    this.vp?.dispose(); this.vp = null;
    this.tags.clear(); this.legs.clear();
    h.remove();
  }

  /** Ouvre la fiche d'un module (null : retour à la vue d'ensemble). */
  select(id: string | null, immediate = false): void {
    if (id && !this.skills.some(s => s.id === id)) id = null;
    if (id !== this.selected) this.refusal = null;
    this.selected = id;
    this.tree?.setSelected(id);
    this.renderCard();
    const n = id ? this.tree?.nodes.get(id) : null;
    if (n && this.vp) this.want = { tx: n.x * 0.82, tz: n.z, yaw: YAW0 + n.x * -0.05, zoom: ZOOM_FOCUS, off: this.vp.height * 0.2 };
    else this.want = this.overview();
    if (immediate || this.still || this.calm) this.cur = { ...this.want };
    for (const [k, t] of this.tags) t.el.classList.toggle('is-sel', k === id);
    this.invalidate();
  }

  // ---------- État ----------
  private need(s: SkillView): Need | null {
    const d = skillDef(s.id)?.needs;
    if (!d) return null;
    const p = this.skills.find(x => x.id === d.id);
    return p ? { id: d.id, rank: d.rank, name: p.name } : null;
  }
  private lockedBy(s: SkillView): Need | null {
    const n = this.need(s);
    if (!n) return null;
    const p = this.skills.find(x => x.id === n.id);
    return p && p.rank < n.rank ? n : null;
  }
  private levelShort(s: SkillView): boolean { return !!s.needsLevel && this.level < s.needsLevel; }
  private stateOf(s: SkillView): State {
    if (s.rank >= s.maxRank) return 'max';
    if (this.lockedBy(s) || this.levelShort(s)) return 'verrou';
    return s.available ? 'dispo' : 'attente';
  }
  /** Pourquoi le module ne peut pas être appris maintenant (null s'il peut l'être). */
  private blockOf(s: SkillView): string | null {
    if (s.rank >= s.maxRank) return 'Rang maximal atteint : ce module est maîtrisé.';
    const lock = this.lockedBy(s);
    if (lock) return lock.rank > 1 ? `Monte d’abord « ${lock.name} » au rang ${lock.rank}.` : `Apprends d’abord « ${lock.name} ».`;
    if (this.levelShort(s)) return `Noé l’installera quand tu seras niveau ${s.needsLevel} (tu es niveau ${this.level}).`;
    if (s.available) return null;
    if (this.points < s.cost) return this.points === 0
      ? `Il te faut ${plural(s.cost, 'point')} : tu n’en as aucun pour l’instant.`
      : `Il te faut ${plural(s.cost, 'point')} : tu n’en as que ${this.points}.`;
    return 'Ce module n’est pas disponible pour l’instant.';
  }

  /** Reporte l'état courant dans la scène et dans l'interface. */
  private sync(animated: boolean): void {
    const list: NodeInput[] = this.skills.map(s => ({
      id: s.id, branch: s.branch, rank: s.rank, maxRank: s.maxRank,
      available: this.stateOf(s) === 'dispo', locked: this.stateOf(s) === 'verrou', parent: this.need(s)?.id ?? null,
    }));
    this.tree?.setNodes(list, !animated && (this.still || this.calm));
    // En-tête.
    this.kicker.textContent = `Atelier · niveau ${this.level}`;
    this.ptsN.textContent = String(this.points);
    this.ptsL.textContent = this.points > 1 ? 'points à dépenser' : 'point à dépenser';
    this.ptsBox.classList.toggle('is-zero', this.points === 0);
    this.ptsBox.setAttribute('aria-label', `${plural(this.points, 'point')} de compétence à dépenser`);
    // Étiquettes.
    for (const s of this.skills) {
      let t = this.tags.get(s.id);
      if (!t) {
        const b = el('button', 'tr-tag');
        b.type = 'button';
        b.dataset.id = s.id;
        b.style.setProperty('--bc', BRANCH_HEX[s.branch]);
        const name = el('span', 'tr-tag-name'), rank = el('span', 'tr-tag-rank'), sub = el('span', 'tr-tag-sub');
        b.append(name, rank, sub);
        b.addEventListener('click', () => { this.events.onUi?.('tap'); this.select(s.id); });
        this.tagsEl.append(b);
        t = { el: b, name, rank, sub };
        this.tags.set(s.id, t);
      }
      const st = this.stateOf(s);
      t.name.textContent = shortName(s.id, s.name);
      // Sous le nom : ce que le module apporte et son prix s'il est à portée, sinon ce qui manque pour l'obtenir.
      const lock = this.lockedBy(s), gain = EFFECT[s.id]?.(1) ?? EXO_FX[s.id] ?? '';
      const pts = `${s.cost} pt${s.cost > 1 ? 's' : ''}`;
      const sub = st === 'max' ? ''
        : st === 'verrou' ? (lock ? (lock.rank > 1 ? `${shortName(lock.id, lock.name)} rang ${lock.rank}` : `Après ${shortName(lock.id, lock.name)}`) : `Niv. ${s.needsLevel}`)
          : st === 'dispo' ? (gain ? `${gain} · ${pts}` : pts)
            : `Il faut ${pts}`;
      t.sub.textContent = sub;
      t.sub.hidden = !sub;
      t.rank.replaceChildren(st === 'verrou' ? icon('cadenas') : st === 'max' ? icon('coche') : document.createTextNode(`${s.rank}/${s.maxRank}`));
      t.el.dataset.state = st;
      t.el.dataset.rank = String(s.rank);
      t.el.setAttribute('aria-label', `${s.name}, ${BRANCH_NAME[s.branch]}, rang ${s.rank} sur ${s.maxRank}, ${{ max: 'maîtrisé', dispo: 'disponible', verrou: 'verrouillé', attente: 'points insuffisants' }[st]}`);
    }
    for (const [id, t] of this.tags) if (!this.skills.some(s => s.id === id)) { t.el.remove(); this.tags.delete(id); }
    // Légende.
    for (const b of BRANCHES) {
      const g = this.legs.get(b)!, mine = this.skills.filter(s => s.branch === b);
      const r = mine.reduce((a, s) => a + s.rank, 0), m = mine.reduce((a, s) => a + s.maxRank, 0);
      g.bar.style.transform = `scaleX(${m ? r / m : 0})`;
      g.n.textContent = `${r}/${m}`;
      g.el.hidden = mine.length === 0;
      g.el.setAttribute('aria-label', `Branche ${BRANCH_NAME[b]} : ${r} rangs sur ${m}`);
    }
    this.renderCard();
    this.invalidate();
  }

  private renderCard(): void {
    const s = this.selected ? this.skills.find(x => x.id === this.selected) : null;
    this.card.hidden = !s;
    this.host.classList.toggle('has-card', !!s);
    if (!s) return;
    const st = this.stateOf(s), c = this.card;
    c.style.setProperty('--bc', BRANCH_HEX[s.branch]);
    c.dataset.state = st;
    c.dataset.id = s.id;
    this.cBranch.replaceChildren(icon(BRANCH_ICON[s.branch]), document.createTextNode(BRANCH_NAME[s.branch]));
    this.cState.textContent = { max: 'Maîtrisé', dispo: 'Disponible', verrou: 'Verrouillé', attente: 'Points insuffisants' }[st];
    this.cState.dataset.state = st;
    this.cName.textContent = s.name;
    this.cDesc.textContent = s.desc;
    if (this.cPips.childElementCount !== s.maxRank) this.cPips.replaceChildren(...Array.from({ length: s.maxRank }, () => el('i')));
    Array.from(this.cPips.children).forEach((p, i) => p.classList.toggle('on', i < s.rank));
    this.cRank.textContent = `Rang ${s.rank} / ${s.maxRank}`;
    const fx = EFFECT[s.id];
    this.cFx.hidden = !fx;
    if (fx) {
      const max = s.rank >= s.maxRank;
      this.cNow.textContent = s.rank > 0 ? fx(s.rank) : 'Pas encore appris';
      this.cNextL.textContent = max ? 'Rang maximal' : `Rang ${s.rank + 1}`;
      this.cNext.textContent = max ? 'Rien de plus à apprendre' : fx(s.rank + 1);
      this.cFx.classList.toggle('is-max', max);
    }
    const block = this.blockOf(s), why = this.refusal ?? block;
    this.cWhy.hidden = !why;
    this.cWhy.textContent = why ?? '';
    this.cWhy.classList.toggle('is-error', !!this.refusal);
    this.cWhy.classList.toggle('is-ok', st === 'max');
    this.cBtn.hidden = st === 'max';
    this.cBtn.disabled = block !== null;
    this.cBtn.setAttribute('aria-disabled', String(block !== null));
    this.cBtnL.textContent = s.rank > 0 ? 'Améliorer' : 'Apprendre';
    this.cCost.textContent = plural(s.cost, 'point');
    this.cBtn.setAttribute('aria-label', `${s.rank > 0 ? 'Améliorer' : 'Apprendre'} ${s.name} pour ${plural(s.cost, 'point')}`);
  }

  private learn(): void {
    const s = this.selected ? this.skills.find(x => x.id === this.selected) : null;
    if (!s || this.blockOf(s) !== null) { this.events.onUi?.('error'); return; }
    let r: ActionResult;
    try { r = this.events.learn(s.id); } catch { r = { ok: false, why: 'Apprentissage impossible pour l’instant.' }; }
    if (!r.ok) {
      this.refusal = r.why || 'Apprentissage refusé.';
      this.events.onUi?.('error');
      this.renderCard();
      this.card.classList.remove('is-shake');
      void this.card.offsetWidth;
      this.card.classList.add('is-shake');
      return;
    }
    this.refusal = null;
    this.events.onUi?.('confirm');
    // Mise à jour immédiate, sans attendre la prochaine vue du jeu (qui la confirmera).
    s.rank = Math.min(s.maxRank, s.rank + 1);
    this.points = Math.max(0, this.points - s.cost);
    for (const o of this.skills) o.available = o.rank < o.maxRank && !this.lockedBy(o) && !this.levelShort(o) && this.points >= o.cost;
    this.sig = '';
    this.tree?.power(s.id, this.still || this.calm);
    this.sync(true);
    this.ptsBox.classList.remove('is-spent');
    void this.ptsBox.offsetWidth;
    this.ptsBox.classList.add('is-spent');
  }

  private requestClose(): void {
    this.events.onUi?.('close');
    this.close();
    this.events.onClose?.();
  }

  // ---------- Caméra ----------
  private overview(): Cam {
    const top = this.topEl.getBoundingClientRect().bottom, bot = this.host.clientHeight - this.legend.getBoundingClientRect().top;
    return { tx: 0, tz: this.ovTz, yaw: YAW0, zoom: 1, off: ((bot || 90) - (top || 80)) / 2 };
  }
  private goBranch(b: SkillBranch): void {
    const mine = [...(this.tree?.nodes.values() ?? [])].filter(n => n.branch === b);
    if (!mine.length) return;
    if (this.selected) this.select(null, true);
    const x = mine.reduce((a, n) => a + n.x, 0) / mine.length, z = mine.reduce((a, n) => a + n.z, 0) / mine.length;
    this.want = { tx: x * 0.75, tz: z, yaw: YAW0 + (x > 0 ? -0.12 : 0.12), zoom: 0.62, off: 0 };
    if (this.still || this.calm) this.cur = { ...this.want };
    this.invalidate();
  }

  private pose(c: Cam, dist: number): void {
    const cam = this.camera, cp = Math.cos(PITCH);
    cam.position.set(c.tx + Math.sin(c.yaw) * cp * dist, 0.12 + Math.sin(PITCH) * dist, c.tz + Math.cos(c.yaw) * cp * dist);
    cam.lookAt(c.tx, 0.12, c.tz);
    cam.updateMatrixWorld();
  }

  /** Distance de la caméra pour que tout l'arbre tienne entre l'en-tête et la légende. */
  private fit(force: boolean): void {
    const vp = this.vp, tree = this.tree;
    if (!vp || !tree) return;
    vp.resize();
    const w = vp.width, h = vp.height;
    if (!force && w === this.fitW && h === this.fitH) return;
    this.fitW = w; this.fitH = h;
    const cam = this.camera;
    cam.aspect = w / h; cam.clearViewOffset(); cam.updateProjectionMatrix();
    const ov = this.overview();
    const top = this.topEl.getBoundingClientRect().bottom + 6, bottom = this.legend.getBoundingClientRect().top - 4;
    const E = EXTENT, pts: [number, number][] = [[-E.x, E.zFar], [E.x, E.zFar], [-E.x, E.zNear], [E.x, E.zNear]];
        const ok = (d: number): boolean => {
      this.pose(ov, d);
      for (const [x, z] of pts) {
        _v.set(x, 0, z).project(cam);
        const sx = (_v.x * 0.5 + 0.5) * w, sy = (-_v.y * 0.5 + 0.5) * h - ov.off;
        if (sx < 2 || sx > w - 2 || sy < top || sy > bottom) return false;
      }
      return true;
    };
    // La perspective agrandit le devant du plateau : on décale aussi la cible pour équilibrer haut et bas.
    const edge = (z: number, d: number): number => { this.pose(ov, d); _v.set(0, 0, z).project(cam); return (-_v.y * 0.5 + 0.5) * h - ov.off; };
    let hi = 60;
    for (let pass = 0; pass < 4; pass++) {
      let lo = 5; hi = 60;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
      const yFar = edge(E.zFar, hi), yNear = edge(E.zNear, hi), slack = ((yFar - top) - (bottom - yNear)) / 2;
      ov.tz += slack / Math.max(20, (yNear - yFar) / (E.zNear - E.zFar));
    }
    this.baseDist = hi; this.ovTz = ov.tz;
    if (!this.selected) { this.want = this.overview(); }
  }

  /** Avance la caméra vers sa cible. Renvoie vrai tant qu'elle bouge. */
  private stepCamera(dt: number): boolean {
    const c = this.cur, w = this.want, k = this.still || this.calm ? 1 : 1 - Math.exp(-dt * 6.5);
    let moving = false;
    for (const key of ['tx', 'tz', 'yaw', 'zoom', 'off'] as const) {
      const d = w[key] - c[key];
      if (Math.abs(d) < (key === 'off' ? 0.3 : 0.0008)) c[key] = w[key];
      else { c[key] += d * k; moving = true; }
    }
    const vp = this.vp!;
    this.pose(c, this.baseDist * c.zoom);
    const cam = this.camera;
    cam.aspect = vp.aspect;
    if (Math.abs(c.off) > 0.5) cam.setViewOffset(vp.width, vp.height, 0, Math.round(c.off), vp.width, vp.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    return moving;
  }

  /**
   * Pose les étiquettes sous leur module, puis les écarte en espace écran : aucune étiquette ne doit en toucher
   * une autre ni recouvrir un module. Tous les modules montrent leur nom et leur état, même verrouillés
   * (plus discrets) : on lit l'arbre entier sans rien toucher.
   */
  private placeTags(): void {
    const vp = this.vp, tree = this.tree;
    if (!vp || !tree) return;
    const w = vp.width, h = vp.height, cam = this.camera;
    const sx = (): number => (_v.x * 0.5 + 0.5) * w, sy = (): number => (-_v.y * 0.5 + 0.5) * h;
    const obst: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const items: { el: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
    for (const [id, t] of this.tags) {
      const n = tree.nodes.get(id);
      if (!n) continue;
      _v.set(n.x, 0.1, n.z).project(cam);
      const cx = sx(), cy = sy();
      _v.set(n.x + 0.37, 0.1, n.z).project(cam);
      const rx = Math.abs(sx() - cx) * 0.92, ry = rx * 0.66;
      obst.push({ x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry });
      if (t.el.hidden) t.el.hidden = false;
      _v.set(n.x, 0, n.z + 0.43).project(cam);
      const tw = t.el.offsetWidth, th = t.el.offsetHeight;
      items.push({ el: t.el, x: sx() - tw / 2, y: Math.max(sy(), cy + ry + 2), w: tw, h: th });
    }
    const G = 3;
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + G, oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + G;
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) { const d = (a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1) * ox / 2; a.x += d; b.x -= d; }
          else { const d = (a.y + a.h / 2 < b.y + b.h / 2 ? -1 : 1) * oy / 2; a.y += d; b.y -= d; }
        }
        for (const o of obst) {
          const ox = Math.min(a.x + a.w, o.x1) - Math.max(a.x, o.x0) + 1, oy = Math.min(a.y + a.h, o.y1) - Math.max(a.y, o.y0) + 1;
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (ox < oy) a.x += (a.x + a.w / 2 < (o.x0 + o.x1) / 2 ? -1 : 1) * ox;
          else a.y += (a.y + a.h / 2 < (o.y0 + o.y1) / 2 ? -1 : 1) * oy;
        }
        a.x = Math.max(4, Math.min(w - a.w - 4, a.x));
      }
      if (!moved) break;
    }
    for (const a of items) a.el.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
  }

  // ---------- Boucle de rendu (à la demande) ----------
  private invalidate(): void { this.dirty = 2; this.start(); }
  private start(): void { if (!this.raf && this.opened && !document.hidden && this.vp) { this.last = 0; this.raf = requestAnimationFrame(this.loop); } }
  private stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }
  private readonly loop = (now: number): void => {
    this.raf = 0;
    const vp = this.vp, tree = this.tree;
    if (!vp || !tree || !this.opened) return;
    const idle = this.dirty <= 0 && this.touches.size === 0;
    // Au repos, seules les pulsations tournent : une image sur deux suffit.
    this.half = !this.half;
    const ambient = !this.still && !this.calm && tree.ambient;
    if (idle && ambient && this.half && !this.animating) { this.raf = requestAnimationFrame(this.loop); return; }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.t += dt;
    if (this.dirty > 0) this.dirty--;
    if (vp.resize()) this.dirty = 2;
    this.fit(false);
    const anim = tree.tick(this.still ? 1.2 : this.t, this.still || this.calm ? 0 : dt);
    const moving = this.stepCamera(dt);
    this.placeTags();
    vp.render(tree.scene, this.camera, this.still ? 0 : this.t);
    this.animating = anim || moving;
    if (this.animating || this.dirty > 0 || this.touches.size > 0 || ambient) this.raf = requestAnimationFrame(this.loop);
  };
  private animating = false;

  // ---------- Gestes ----------
  private readonly onVisibility = (): void => { if (document.hidden) this.stop(); else if (this.opened) this.invalidate(); };
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.opened) return;
    e.stopPropagation();
    if (this.selected) this.select(null); else this.requestClose();
  };
  private onCanvas(e: Event): boolean { return e.target === this.vp?.canvas; }
  private readonly onDown = (e: PointerEvent): void => {
    if (!this.onCanvas(e)) return;
    if (this.touches.size === 0) this.moved = 0;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) { this.pinch = this.spread(); this.moved = 99; }
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* sans gravité */ }
    this.invalidate();
  };
  private spread(): number {
    const [a, b] = [...this.touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  private readonly onMove = (e: PointerEvent): void => {
    const p = this.touches.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const w = this.want;
    if (this.touches.size >= 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) w.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, w.zoom * (this.pinch / s)));
      this.pinch = s;
    } else {
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.moved <= 10) return;
      // Glisser : à l'horizontale le plateau pivote un peu, à la verticale on se déplace le long de l'arbre.
      const perPx = (this.baseDist * w.zoom * 0.62) / Math.max(320, this.vp?.height ?? 800);
      w.yaw = Math.max(YAW0 - 0.42, Math.min(YAW0 + 0.42, w.yaw - dx * 0.004));
      w.tz = Math.max(-3.8, Math.min(3.8, w.tz - dy * perPx * 1.5));
    }
    this.invalidate();
  };
  private readonly onUp = (e: PointerEvent): void => {
    if (!this.touches.delete(e.pointerId)) return;
    this.pinch = 0;
    if (e.type === 'pointercancel' || this.moved > 10 || this.touches.size > 0) { this.invalidate(); return; }
    const id = this.pick(e.clientX, e.clientY);
    if (id) { this.events.onUi?.('tap'); this.select(id); }
    else if (this.selected) this.select(null);
  };
  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.onCanvas(e)) return;
    e.preventDefault();
    this.want.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.want.zoom * Math.exp(e.deltaY * 0.0012)));
    this.invalidate();
  };

  /** Module le plus proche du point touché (zone tactile d'au moins 44 px). */
  private pick(cx: number, cy: number): string | null {
    const vp = this.vp, tree = this.tree;
    if (!vp || !tree) return null;
    const r = vp.canvas.getBoundingClientRect();
    let best: string | null = null, bd = Infinity;
    for (const n of tree.nodes.values()) {
      _v.set(n.x, 0.1, n.z).project(this.camera);
      const x = r.left + (_v.x * 0.5 + 0.5) * r.width, y = r.top + (-_v.y * 0.5 + 0.5) * r.height;
      _v.set(n.x + 0.4, 0.1, n.z).project(this.camera);
      const rad = Math.max(24, Math.abs(r.left + (_v.x * 0.5 + 0.5) * r.width - x));
      const d = Math.hypot(cx - x, (cy - y) * 1.15);
      if (d <= rad && d < bd) { bd = d; best = n.id; }
    }
    return best;
  }
}
