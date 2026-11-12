// L'interface du jeu : un calque transparent posé au-dessus de la carte.
// HUD permanent (haut + scanner), une seule fiche en bas, panneaux, écran de note, toasts, aide.
import './hud.css';
import type { ActionResult, Ambiance, GameEvent, GameView, HudApi, HudEvents, HudOptions, UiKind, WeatherKind } from '../game/api';
import type { Ctx, Tone } from './ctx';
import { btn, fmtDist, fmtInt, h, setAttr, setDisabled, setText, setVar, show } from './dom';
import { EventsBar, NearAction } from './events';
import { GradeScreen } from './grade';
import { Help } from './help';
import { icon, type IconName } from './icons';
import { OrderPanel } from './order';
import { setPanelSound } from './panel';
import { PorterPanel, type PorterTab } from './porter';
import { PseudoPrompt } from './pseudo';
import { Sheet } from './sheet';
import { ShelterPanel } from './shelter';
import { Toasts } from './toasts';

const WEATHER: Record<WeatherKind, { ic: IconName; label: string }> = {
  clair: { ic: 'sun', label: 'Ciel clair' }, nuages: { ic: 'cloud', label: 'Nuageux' }, pluie: { ic: 'rain', label: 'Pluie' },
  orage: { ic: 'storm', label: 'Orage' }, neige: { ic: 'snow', label: 'Neige' }, brouillard: { ic: 'fog', label: 'Brouillard' },
};

export class Hud implements HudApi {
  private view: GameView | null = null;
  private ambiance: Ambiance = 'crépuscule';
  private toasts: Toasts;
  private sheet: Sheet;
  private shelter: ShelterPanel;
  private order: OrderPanel;
  private porter: PorterPanel;
  private grade: GradeScreen;
  private help: Help;
  private eventsBar: EventsBar;
  private near: NearAction;
  private events: HudEvents;
  private pseudo: PseudoPrompt;
  /** Le choix du nom n'est proposé qu'une fois par séance à l'ouverture de la carte du réseau. */
  private pseudoAsked = false;
  private netDot = h('i', 'dr-menu-dot');
  private netOn: boolean | null = null;

  // Éléments du HUD permanent
  private lvl = h('span', 'dr-lvl-n');
  private lvlBox: HTMLElement;
  private xpFill = h('span', 'dr-bar-fill');
  private stFill = h('span', 'dr-bar-fill');
  private stBar: HTMLElement;
  private wxIcon = h('span', 'dr-wx-ic');
  private wxTemp = h('span', 'dr-wx-t');
  private wxNight = h('span', 'dr-wx-night', icon('moon'), 'Nuit');
  private wxBox: HTMLElement;
  private wxKey = '';
  private loadTxt = h('span', 'dr-load-n');
  private loadBox: HTMLElement;
  private balance: HTMLButtonElement;
  private balDot = h('span', 'dr-bal-dot');
  private gps: HTMLElement;
  private gpsTxt = h('span', '');
  private scan: HTMLButtonElement;
  private scanSec = h('span', 'dr-scan-sec');

  constructor(private root: HTMLElement, events: HudEvents, opts?: HudOptions) {
    root.classList.add('dr-hud');
    this.events = events;
    this.setAmbiance(opts?.ambiance ?? 'crépuscule');
    // Tous les panneaux (carte du réseau comprise) annoncent leur ouverture et leur fermeture.
    setPanelSound(events.onUi ? (kind) => this.ui(kind) : null);

    const ctx: Ctx = {
      events,
      toast: (text, tone) => this.toasts.push(text, tone),
      run: (r) => this.run(r),
      openOrder: (id) => this.openOrder(id),
      openShelter: (id) => this.openShelter(id),
      ui: (kind) => this.ui(kind),
    };

    // ----- Haut : niveau, endurance, météo, menu, charge, équilibre, GPS -----
    this.stBar = h('span', 'dr-bar dr-bar-st', this.stFill);
    this.lvlBox = h('div', 'dr-lvl',
      h('span', 'dr-lvl-badge', this.lvl),
      h('span', 'dr-lvl-bars',
        h('span', 'dr-lvl-line', icon('xp'), h('span', 'dr-bar dr-bar-xp', this.xpFill)),
        h('span', 'dr-lvl-line', icon('bolt'), this.stBar)));
    this.lvlBox.setAttribute('role', 'img');
    this.wxBox = h('div', 'dr-chip dr-wx', this.wxIcon, this.wxTemp, this.wxNight);
    this.wxBox.setAttribute('role', 'img');
    const menu = btn('dr-iconbtn dr-surface dr-menu', 'Menu du porteur', icon('menu'), this.netDot);
    this.netDot.hidden = true;
    menu.addEventListener('click', () => this.openPorter());

    this.loadBox = h('div', 'dr-chip dr-load', icon('bag'), this.loadTxt);
    this.loadBox.setAttribute('role', 'img');
    this.balance = btn('dr-balance', 'Rééquilibrer la charge', h('span', 'dr-bal-track', this.balDot));
    this.balance.hidden = true;
    this.balance.addEventListener('click', () => events.actions.steady());
    this.gps = h('div', 'dr-chip dr-gps', h('i', 'dr-gps-dot'), this.gpsTxt);

    this.eventsBar = new EventsBar(root, ctx);
    const top = h('div', 'dr-top',
      h('div', 'dr-top-row', this.lvlBox, h('span', 'dr-grow'), this.wxBox, menu),
      h('div', 'dr-top-row', this.loadBox, this.balance, h('span', 'dr-grow'), this.gps),
      this.eventsBar.el);

    // ----- Bas droite : recentrer et scanner -----
    const recenter = btn('dr-iconbtn dr-surface dr-recenter', 'Recentrer la carte sur moi', icon('locate'));
    recenter.addEventListener('click', () => events.onRecenter());
    this.scan = btn('dr-scan', 'Scanner les alentours');
    this.scan.innerHTML = '<svg class="dr-scan-ring" viewBox="0 0 80 80" aria-hidden="true"><circle class="dr-scan-track" cx="40" cy="40" r="36"/><circle class="dr-scan-prog" cx="40" cy="40" r="36" pathLength="100" transform="rotate(-90 40 40)"/></svg>';
    this.scan.append(h('span', 'dr-scan-core', icon('scan'), this.scanSec));
    this.scan.addEventListener('click', () => { if (this.run(events.actions.scan())) this.ui('tap'); });
    const fabs = h('div', 'dr-fabs', recenter, this.scan);

    root.append(top, fabs);
    this.sheet = new Sheet(root, ctx);
    this.near = new NearAction(root, ctx);
    this.help = new Help(root);
    this.toasts = new Toasts(root);
    this.shelter = new ShelterPanel(root, ctx);
    this.order = new OrderPanel(root, ctx);
    this.porter = new PorterPanel(root, ctx, {
      setAmbiance: (a) => this.setAmbiance(a), replayHelp: () => this.showHelp(),
      openNetwork: () => this.openNetwork(), editPseudo: () => this.pseudo.open(),
      settings: opts?.settings ?? {},
    });
    this.pseudo = new PseudoPrompt(root, ctx);
    this.porter.showAmbiance(this.ambiance);
    this.grade = new GradeScreen(root, (id) => events.actions.proof(id));
    this.grade.onShow = () => this.closePanels();
    this.help.auto();
  }

  // ---------- HudApi ----------
  render(view: GameView): void {
    this.view = view;
    const p = view.player;

    setText(this.lvl, String(p.level));
    setVar(this.xpFill, '--p', (p.xpNext > 0 ? Math.min(1, p.xp / p.xpNext) : 0).toFixed(3));
    setVar(this.stFill, '--p', Math.max(0, Math.min(1, p.stamina)).toFixed(2));
    this.stBar.classList.toggle('is-low', p.stamina < 0.25);
    setAttr(this.lvlBox, 'aria-label', `Niveau ${p.level}, ${fmtInt(p.xp)} XP sur ${fmtInt(p.xpNext)}, endurance ${Math.round(p.stamina * 100)} %`);

    const w = view.weather, wx = WEATHER[w.kind];
    const night = w.night && w.kind !== 'clair';
    const key = `${w.kind}${w.night}`;
    if (key !== this.wxKey) { this.wxKey = key; this.wxIcon.replaceChildren(icon(w.kind === 'clair' && w.night ? 'moon' : wx.ic)); }
    setText(this.wxTemp, `${Math.round(w.tempC)}°`);
    show(this.wxNight, night);
    setAttr(this.wxBox, 'aria-label', `${wx.label}, ${Math.round(w.tempC)} degrés${w.night ? ', nuit' : ''}`);

    setText(this.loadTxt, `${fmtInt(p.carriedKg)}/${fmtInt(p.capacityKg)} kg`);
    this.loadBox.classList.toggle('is-full', p.capacityKg > 0 && p.carriedKg / p.capacityKg >= 0.9);
    setAttr(this.loadBox, 'aria-label', `Charge : ${fmtInt(p.carriedKg)} kg sur ${fmtInt(p.capacityKg)}`);

    // Équilibre : visible seulement si on porte quelque chose.
    const carrying = p.carriedKg > 0;
    show(this.balance, carrying);
    if (carrying) {
      const b = Math.max(-1, Math.min(1, p.balance));
      setVar(this.balDot, '--b', b.toFixed(2));
      this.balance.classList.toggle('is-warn', Math.abs(b) > 0.5);
    }

    setText(this.gpsTxt, p.mode === 'gps' ? 'GPS réel' : 'Position simulée');
    setAttr(this.gps, 'data-mode', p.mode === 'gps' ? 'gps' : 'sim');

    // Scanner : anneau de recharge, bouton inactif tant qu'il recharge.
    const s = view.scanner;
    const cooling = s.cooldownLeftS > 0;
    const prog = cooling && s.cooldownS > 0 ? 1 - Math.min(1, s.cooldownLeftS / s.cooldownS) : 1;
    setVar(this.scan, '--p', prog.toFixed(2));
    setDisabled(this.scan, cooling);
    setText(this.scanSec, cooling ? String(Math.ceil(s.cooldownLeftS)) : '');
    setAttr(this.scan, 'aria-label', cooling ? `Scanner en recharge, ${Math.ceil(s.cooldownLeftS)} secondes` : 'Scanner les alentours');

    // Pastille d'état en ligne sur le bouton du menu : lecture immédiate, aucun appel réseau.
    const net = this.events.online;
    if (net) {
      const on = net.isOnline();
      if (on !== this.netOn) { this.netOn = on; this.netDot.hidden = false; this.netDot.classList.toggle('is-on', on); }
    }

    this.eventsBar.render(view);
    this.near.render(view);
    this.sheet.render(view);
    if (this.shelter.id) this.shelter.render(view);
    if (this.order.id) this.order.render(view);
    this.porter.render(view);
  }

  handle(e: GameEvent): void {
    switch (e.type) {
      case 'scan':
        if (e.found || !e.caches) this.toasts.push(e.found === 0 ? 'Rien dans la zone' : e.found === 1 ? '1 colis repéré' : `${e.found} colis repérés`, e.found ? 'good' : 'info', 'scan');
        if (e.caches) this.toasts.push('Une cache est tout près', 'good', 'cache');
        break;
      case 'pickup': this.toasts.push(`${e.order.name} : dans le sac`, 'good', 'bag'); break;
      case 'drop': this.toasts.push('Colis posé', 'info', 'drop'); break;
      case 'delivery': this.grade.push(e.result); break;
      case 'levelUp': if (!this.grade.busy) this.toasts.push(`Niveau ${e.level} atteint`, 'good', 'xp'); break;
      case 'contract':
        this.toasts.push(e.contract.claimed ? `Récompense reçue : +${fmtInt(e.contract.reward)} pts` : `Contrat rempli : ${e.contract.label}`, 'good', 'contract');
        break;
      case 'danger': this.toasts.push(e.entered ? 'Zone dangereuse : ne traîne pas' : 'Tu es sorti de la zone', e.entered ? 'warn' : 'info'); break;
      case 'toast': this.toasts.push(e.text, e.tone ?? 'info'); break;
      // ----- Systèmes secondaires -----
      case 'special': if (e.order.special) this.toasts.push(`${e.order.special.label}. ${e.order.special.rule}`, 'warn', 'special', 5500); break;
      case 'inspect': {
        const sp = e.order.special;
        if (sp) this.toasts.push(`${sp.label}. ${sp.rule}`, 'warn', 'special', 5500);
        else this.toasts.push(e.order.fragile ? `Ça tinte : colis fragile (+${e.xp} XP)` : `Rien de fragile là-dedans (+${e.xp} XP)`, 'info', 'ear');
        break;
      }
      case 'cache':
        this.toasts.push(`Cache ouverte : +${fmtInt(e.points)} pts, +${fmtInt(e.xp)} XP${e.skillPoint ? ' et 1 point de compétence' : ''}`, 'good', 'cache', 4000);
        break;
      case 'wanderer': this.toasts.push(`${e.name} : ${e.line}`, 'good', 'walker', 6000); break;
      case 'front':
        if (e.phase === 'approche') this.toasts.push(`Front de mauvais temps dans ${Math.max(1, Math.round((e.etaS ?? 0) / 60))} min : évite-le ou traverse-le`, 'warn', 'front', 4500);
        else if (e.phase === 'entrée') this.toasts.push('Dans le front : tes colis s’usent, la note en tiendra compte', 'warn', 'front', 4500);
        else this.toasts.push('Front traversé', 'info', 'front');
        break;
      case 'jam':
        if (e.phase === 'début') this.toasts.push(`${e.jam.count} colis groupés : ${e.jam.minutes} min pour tout livrer`, 'info', 'stack', 4000);
        else if (e.phase === 'réussi') this.toasts.push(`Lot livré à temps : +${fmtInt(e.bonus ?? 0)} pts`, 'good', 'stack', 4000);
        else this.toasts.push('Trop tard pour le bonus du lot. Les colis restent à livrer', 'info', 'stack', 4000);
        break;
      case 'strap':
        this.toasts.push(e.quality >= 1 ? `Bien arrimé : charge plus stable (+${e.xp} XP)` : e.quality === 0.5 ? 'Trop serré : arrimage moyen' : 'Sangle un peu lâche : arrimage moyen', e.quality >= 1 ? 'good' : 'info', 'strap');
        break;
      case 'proof': if (!this.grade.proofDone(e.orderId, e.points)) this.toasts.push(`Photo-preuve : +${fmtInt(e.points)} pts`, 'good', 'camera'); break;
    }
  }

  openShelter(id: string): void {
    this.order.panel.close(); this.porter.panel.close();
    this.shelter.open(id, this.view);
  }
  openOrder(id: string): void {
    this.shelter.panel.close(); this.porter.panel.close();
    this.order.open(id, this.view);
  }

  /** Toucher d'une cache dans la scène : on l'ouvre si on est dessus, sinon on dit à quelle distance elle est. */
  openCache(id: string): void {
    const c = this.view?.caches?.find((x) => x.id === id);
    if (!c) return;
    if (c.inRange) this.run(this.events.actions.openCache(id));
    else this.toasts.push(`Cache à ${fmtDist(c.distanceM)} : approche-toi pour l’ouvrir`, 'info', 'cache');
  }
  /** Toucher d'un rôdeur dans la scène. */
  openWanderer(id: string): void {
    const w = this.view?.wanderers?.find((x) => x.id === id);
    if (!w) return;
    if (w.met) this.toasts.push(`${w.name} t’a déjà donné ce qu’il avait`, 'info', 'walker');
    else if (w.inRange) this.run(this.events.actions.talk(id));
    else this.toasts.push(`${w.name}, à ${fmtDist(w.distanceM)} : approche-toi pour lui parler`, 'info', 'walker');
  }

  /** L'état en ligne a changé (niveau collectif, relais, retour du réseau) : le panneau d'abri ouvert relit ses données. */
  refreshOnline(): void { if (this.shelter.id) this.shelter.loadOnline(); }

  /** Carte du réseau. La première fois, le joueur choisit d'abord son nom de porteur. */
  openNetwork(): void {
    const go = this.events.onNetwork;
    if (!go) return;
    this.closePanels();
    const p = this.events.pseudo;
    if (p && !this.pseudoAsked && !p.chosen()) { this.pseudoAsked = true; this.pseudo.open(() => go()); return; }
    go();
  }
  /** Choix du nom de porteur (réglages, démo). */
  openPseudo(): void { this.closePanels(); this.pseudo.open(); }
  /** Le navigateur propose (ou ne propose plus) l'installation : montre ou cache le bouton des réglages. */
  setCanInstall(on: boolean): void { this.porter.setCanInstall(on); }

  // ---------- Au-delà du contrat (menu, démo) ----------
  openPorter(tab?: PorterTab): void {
    this.shelter.panel.close(); this.order.panel.close();
    this.porter.open(tab, this.view);
  }
  setSheetExpanded(on: boolean): void {
    this.sheet.setExpanded(on);
  }
  showHelp(): void { this.sheet.setExpanded(false); this.help.start(); }
  setAmbiance(a: Ambiance): void {
    this.ambiance = a;
    this.root.dataset.ambiance = a === 'clair' ? 'clair' : 'crepuscule';
    this.porter?.showAmbiance(a);
  }

  /** Referme tous les panneaux ouverts (changement d'écran : labo, prologue). */
  closeAll(): void { this.closePanels(); this.pseudo.panel.close(); }

  private closePanels(): void {
    this.shelter.panel.close(); this.order.panel.close(); this.porter.panel.close();
  }
  private run(r: ActionResult): boolean {
    if (r.ok) return true;
    if (r.why) this.toast(r.why, 'warn');
    this.ui('error');
    return false;
  }
  private ui(kind: UiKind): void { try { this.events.onUi?.(kind); } catch { /* le son ne doit jamais gêner l'interface */ } }
  private toast(text: string, tone: Tone): void { this.toasts.push(text, tone); }
}
