// Panneau Porteur, à onglets : Compétences, Contrats, Carnet, Réglages.
import type { Ambiance, ContractView, GameView, SkillBranch, SkillView } from '../game/api';
import type { LngLat } from '../core/geo';
import type { Ctx } from './ctx';
import { KeyedList, btn, fmtInt, h, setAttr, setDisabled, setText, setVar, show, type Row } from './dom';
import { icon, type IconName } from './icons';
import { Panel } from './panel';

export type PorterTab = 'competences' | 'contrats' | 'carnet' | 'reglages';
const TABS: { id: PorterTab; label: string; ic: IconName }[] = [
  { id: 'competences', label: 'Compétences', ic: 'xp' },
  { id: 'contrats', label: 'Contrats', ic: 'contract' },
  { id: 'carnet', label: 'Carnet', ic: 'book' },
  { id: 'reglages', label: 'Réglages', ic: 'sliders' },
];
const BRANCH: { id: SkillBranch; label: string; ic: IconName }[] = [
  { id: 'scanner', label: 'Scanner', ic: 'scan' },
  { id: 'portage', label: 'Portage', ic: 'bag' },
  { id: 'endurance', label: 'Endurance', ic: 'bolt' },
  { id: 'réseau', label: 'Réseau', ic: 'network' },
];
// Lieux de test. Attention : LngLat = [longitude, latitude].
const PLACES: { label: string; at: LngLat }[] = [
  { label: 'Bouguenais', at: [-1.5761, 47.1822] },
  { label: 'Paris Châtelet', at: [2.347, 48.8583] },
  { label: 'Lille', at: [3.0635, 50.6366] },
  { label: 'Marseille', at: [5.3744, 43.2951] },
  { label: 'Les Essarts-le-Roi', at: [1.893, 48.7167] },
  { label: 'Saint-Véran', at: [6.869, 44.7003] },
  { label: 'Locronan', at: [-4.208, 48.099] },
  { label: 'Beauce', at: [1.6, 48.24] },
  { label: 'Landes', at: [-0.7, 44.13] },
  { label: 'Pornic', at: [-2.103, 47.115] },
];

export interface PorterHooks { setAmbiance(a: Ambiance): void; replayHelp(): void }

export class PorterPanel {
  readonly panel: Panel;
  tab: PorterTab = 'competences';
  private tabBtns = new Map<PorterTab, HTMLButtonElement>();
  private pages = new Map<PorterTab, HTMLElement>();
  private points = h('span', 'dr-points-n');
  private pointsLabel = h('span', 'dr-points-l');
  private skillLists = new Map<SkillBranch, { sec: HTMLElement; list: KeyedList<SkillView> }>();
  private day: KeyedList<ContractView>; private week: KeyedList<ContractView>;
  private dayEmpty = h('p', 'dr-empty', 'Pas de contrat aujourd’hui.');
  private weekEmpty = h('p', 'dr-empty', 'Pas de contrat cette semaine.');
  private log: Record<'score' | 'deliveries' | 'distance' | 'level' | 'xp', HTMLElement>;
  private xpBar = h('span', 'dr-bar-fill');
  private ambBtns = new Map<Ambiance, HTMLButtonElement>();

  constructor(parent: HTMLElement, private ctx: Ctx, hooks: PorterHooks) {
    this.panel = new Panel(parent, 'dr-panel-tall dr-porter', 'Porteur');
    this.panel.head.append(h('h2', 'dr-title', 'Porteur'));

    const tabs = h('div', 'dr-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = btn('dr-tab', null, icon(t.ic), h('span', '', t.label));
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setTab(t.id));
      this.tabBtns.set(t.id, b);
      tabs.append(b);
      const page = h('div', 'dr-page');
      page.setAttribute('role', 'tabpanel');
      page.setAttribute('aria-label', t.label);
      this.pages.set(t.id, page);
    }
    this.panel.body.before(tabs);
    this.panel.body.append(...this.pages.values());

    // Compétences
    const pg = this.pages.get('competences')!;
    pg.append(h('div', 'dr-points', this.points, this.pointsLabel));
    for (const b of BRANCH) {
      const listEl = h('div', 'dr-list');
      const sec = h('div', 'dr-branch', h('div', 'dr-sec', h('h3', 'dr-sec-title', icon(b.ic), b.label)), listEl);
      this.skillLists.set(b.id, { sec, list: new KeyedList(listEl, (s) => s.id, () => this.skillRow()) });
      pg.append(sec);
    }

    // Contrats
    const dayEl = h('div', 'dr-list'), weekEl = h('div', 'dr-list');
    this.day = new KeyedList(dayEl, (c) => c.id, () => this.contractRow());
    this.week = new KeyedList(weekEl, (c) => c.id, () => this.contractRow());
    this.pages.get('contrats')!.append(
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('sun'), 'Aujourd’hui')), dayEl, this.dayEmpty,
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('contract'), 'Cette semaine')), weekEl, this.weekEmpty);

    // Carnet : un registre, une ligne par mesure.
    const line = (ic: IconName, label: string): { el: HTMLElement; val: HTMLElement } => {
      const val = h('span', 'dr-log-val');
      return { el: h('div', 'dr-log-row', icon(ic), h('span', 'dr-log-label', label), h('span', 'dr-log-dots'), val), val };
    };
    const sc = line('star', 'Score'), dl = line('crate', 'Livraisons'), di = line('route', 'Distance à pied'), lv = line('xp', 'Niveau');
    const xp = h('span', 'dr-log-xp');
    this.log = { score: sc.val, deliveries: dl.val, distance: di.val, level: lv.val, xp };
    this.pages.get('carnet')!.append(h('div', 'dr-log', sc.el, dl.el, di.el, lv.el), h('div', 'dr-log-xpwrap', h('span', 'dr-bar', this.xpBar), xp));

    // Réglages
    const seg = h('div', 'dr-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Ambiance');
    for (const [a, label, ic] of [['crépuscule', 'Crépuscule', 'moon'], ['clair', 'Clair', 'sun']] as [Ambiance, string, IconName][]) {
      const b = btn('dr-seg-btn', null, icon(ic), h('span', '', label));
      b.addEventListener('click', () => { hooks.setAmbiance(a); ctx.events.onAmbiance(a); });
      this.ambBtns.set(a, b);
      seg.append(b);
    }
    const gps = btn('dr-btn dr-btn-wide dr-btn-line', null, icon('gps'), h('span', '', 'Utiliser mon GPS'));
    gps.addEventListener('click', () => { ctx.events.onUseGps(); this.panel.close(); });
    const places = h('div', 'dr-places');
    for (const p of PLACES) {
      const b = btn('dr-place', null, p.label);
      b.addEventListener('click', () => { ctx.events.onGoto(p.at, p.label); this.panel.close(); });
      places.append(b);
    }
    const help = btn('dr-btn dr-btn-wide dr-btn-line', null, icon('help'), h('span', '', 'Revoir l’aide'));
    help.addEventListener('click', () => { this.panel.close(); hooks.replayHelp(); });
    this.pages.get('reglages')!.append(
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('sun'), 'Ambiance')), seg,
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('gps'), 'Position')), gps,
      h('p', 'dr-hint', 'Ou visite un lieu de test, en position simulée :'), places,
      h('div', 'dr-sec', h('h3', 'dr-sec-title', icon('help'), 'Aide')), help);

    this.setTab(this.tab);
  }

  setTab(t: PorterTab): void {
    this.tab = t;
    for (const [id, b] of this.tabBtns) { b.setAttribute('aria-selected', String(id === t)); b.classList.toggle('is-on', id === t); }
    for (const [id, p] of this.pages) p.hidden = id !== t;
    this.panel.body.scrollTop = 0;
  }
  showAmbiance(a: Ambiance): void {
    for (const [id, b] of this.ambBtns) { b.setAttribute('aria-pressed', String(id === a)); b.classList.toggle('is-on', id === a); }
  }
  open(tab: PorterTab | undefined, v: GameView | null): void {
    if (tab) this.setTab(tab);
    if (v) this.render(v, true);
    this.panel.open();
  }

  render(v: GameView, force = false): void {
    if (!this.panel.isOpen && !force) return;
    const p = v.player;
    if (this.tab === 'competences') {
      setText(this.points, String(p.skillPoints));
      setText(this.pointsLabel, p.skillPoints > 1 ? 'points à dépenser' : 'point à dépenser');
      for (const b of BRANCH) {
        const g = this.skillLists.get(b.id)!;
        const items = v.skills.filter((s) => s.branch === b.id);
        show(g.sec, items.length > 0);
        g.list.sync(items);
      }
    } else if (this.tab === 'contrats') {
      const day = v.contracts.filter((c) => c.period === 'jour'), week = v.contracts.filter((c) => c.period === 'semaine');
      this.day.sync(day); this.week.sync(week);
      show(this.dayEmpty, day.length === 0); show(this.weekEmpty, week.length === 0);
    } else if (this.tab === 'carnet') {
      setText(this.log.score, `${fmtInt(p.score)} pts`);
      setText(this.log.deliveries, fmtInt(p.deliveries));
      setText(this.log.distance, `${p.distanceKm.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
      setText(this.log.level, String(p.level));
      setText(this.log.xp, `${fmtInt(p.xp)} / ${fmtInt(p.xpNext)} XP avant le niveau ${p.level + 1}`);
      setVar(this.xpBar, '--p', String(p.xpNext > 0 ? Math.min(1, p.xp / p.xpNext) : 0));
    }
  }

  private skillRow(): Row<SkillView> {
    const name = h('span', 'dr-row-name'), desc = h('span', 'dr-skill-desc'), pips = h('span', 'dr-pips');
    const label = h('span', ''), cost = h('span', 'dr-cost');
    const learn = btn('dr-btn dr-btn-sm', null, label, cost);
    const el = h('div', 'dr-row dr-skill', h('div', 'dr-skill-txt', h('span', 'dr-row-l1', name), desc, pips), learn);
    let id = '', nPips = 0;
    learn.addEventListener('click', () => { this.ctx.run(this.ctx.events.actions.learn(id)); });
    return {
      el,
      update(s) {
        id = s.id;
        setText(name, s.name); setText(desc, s.desc);
        if (nPips !== s.maxRank) { nPips = s.maxRank; pips.replaceChildren(...Array.from({ length: s.maxRank }, () => h('i', 'dr-pip'))); }
        Array.from(pips.children).forEach((c, i) => c.classList.toggle('is-on', i < s.rank));
        setAttr(pips, 'aria-label', `Rang ${s.rank} sur ${s.maxRank}`);
        pips.setAttribute('role', 'img');
        const max = s.rank >= s.maxRank;
        setText(label, max ? 'Acquis' : 'Apprendre');
        setText(cost, `${s.cost} pt${s.cost > 1 ? 's' : ''}`);
        show(cost, !max);
        setAttr(learn, 'aria-label', max ? `${s.name} : rang maximal` : `Apprendre ${s.name} pour ${s.cost} point${s.cost > 1 ? 's' : ''}`);
        learn.classList.toggle('dr-btn-take', s.available);
        learn.classList.toggle('is-max', max);
        setDisabled(learn, !s.available);
      },
    };
  }

  private contractRow(): Row<ContractView> {
    const name = h('span', 'dr-row-name'), prog = h('span', 'dr-contract-prog'), reward = h('span', 'dr-contract-reward');
    const fill = h('span', 'dr-bar-fill');
    const claim = btn('dr-btn dr-btn-sm dr-btn-take', null, 'Réclamer');
    const doneTag = h('span', 'dr-tag dr-tag-good', icon('check'), 'Réclamé');
    const el = h('div', 'dr-row dr-contract', h('div', 'dr-skill-txt', h('span', 'dr-row-l1', name, reward), h('span', 'dr-contract-line', h('span', 'dr-bar', fill), prog)), claim, doneTag);
    let id = '';
    claim.addEventListener('click', () => { this.ctx.run(this.ctx.events.actions.claim(id)); });
    return {
      el,
      update(c) {
        id = c.id;
        setText(name, c.label);
        setText(reward, `+${fmtInt(c.reward)} pts`);
        setText(prog, `${fmtInt(Math.min(c.progress, c.goal))} / ${fmtInt(c.goal)}`);
        setVar(fill, '--p', String(c.goal > 0 ? Math.min(1, c.progress / c.goal) : 0));
        show(claim, c.done && !c.claimed);
        show(doneTag, c.claimed);
        el.classList.toggle('is-done', c.done);
        setAttr(claim, 'aria-label', `Réclamer la récompense : ${c.label}`);
      },
    };
  }
}
