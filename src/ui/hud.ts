// L'interface du jeu : un calque transparent posé au-dessus de la carte.
// HUD permanent (haut + scanner), une seule fiche en bas, panneaux, écran de note, toasts, aide.
import './hud.css';
import type { ActionResult, Ambiance, GameEvent, GameView, HudApi, HudEvents, WeatherKind } from '../game/api';
import type { Ctx, Tone } from './ctx';
import { btn, fmtInt, h, setAttr, setDisabled, setText, setVar, show } from './dom';
import { GradeScreen } from './grade';
import { Help } from './help';
import { icon, type IconName } from './icons';
import { OrderPanel } from './order';
import { PorterPanel, type PorterTab } from './porter';
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

  constructor(private root: HTMLElement, events: HudEvents, opts?: { ambiance?: Ambiance }) {
    root.classList.add('dr-hud');
    this.setAmbiance(opts?.ambiance ?? 'crépuscule');

    const ctx: Ctx = {
      events,
      toast: (text, tone) => this.toasts.push(text, tone),
      run: (r) => this.run(r),
      openOrder: (id) => this.openOrder(id),
      openShelter: (id) => this.openShelter(id),
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
    const menu = btn('dr-iconbtn dr-surface dr-menu', 'Menu du porteur', icon('menu'));
    menu.addEventListener('click', () => this.openPorter());

    this.loadBox = h('div', 'dr-chip dr-load', icon('bag'), this.loadTxt);
    this.loadBox.setAttribute('role', 'img');
    this.balance = btn('dr-balance', 'Rééquilibrer la charge', h('span', 'dr-bal-track', this.balDot));
    this.balance.hidden = true;
    this.balance.addEventListener('click', () => events.actions.steady());
    this.gps = h('div', 'dr-chip dr-gps', h('i', 'dr-gps-dot'), this.gpsTxt);

    const top = h('div', 'dr-top',
      h('div', 'dr-top-row', this.lvlBox, h('span', 'dr-grow'), this.wxBox, menu),
      h('div', 'dr-top-row', this.loadBox, this.balance, h('span', 'dr-grow'), this.gps));

    // ----- Bas droite : recentrer et scanner -----
    const recenter = btn('dr-iconbtn dr-surface dr-recenter', 'Recentrer la carte sur moi', icon('locate'));
    recenter.addEventListener('click', () => events.onRecenter());
    this.scan = btn('dr-scan', 'Scanner les alentours');
    this.scan.innerHTML = '<svg class="dr-scan-ring" viewBox="0 0 80 80" aria-hidden="true"><circle class="dr-scan-track" cx="40" cy="40" r="36"/><circle class="dr-scan-prog" cx="40" cy="40" r="36" pathLength="100" transform="rotate(-90 40 40)"/></svg>';
    this.scan.append(h('span', 'dr-scan-core', icon('scan'), this.scanSec));
    this.scan.addEventListener('click', () => this.run(events.actions.scan()));
    const fabs = h('div', 'dr-fabs', recenter, this.scan);

    root.append(top, fabs);
    this.sheet = new Sheet(root, ctx);
    this.help = new Help(root);
    this.toasts = new Toasts(root);
    this.shelter = new ShelterPanel(root, ctx);
    this.order = new OrderPanel(root, ctx);
    this.porter = new PorterPanel(root, ctx, { setAmbiance: (a) => this.setAmbiance(a), replayHelp: () => this.showHelp() });
    this.porter.showAmbiance(this.ambiance);
    this.grade = new GradeScreen(root);
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

    this.sheet.render(view);
    if (this.shelter.id) this.shelter.render(view);
    if (this.order.id) this.order.render(view);
    this.porter.render(view);
  }

  handle(e: GameEvent): void {
    switch (e.type) {
      case 'scan':
        this.toasts.push(e.found === 0 ? 'Rien dans la zone' : e.found === 1 ? '1 colis repéré' : `${e.found} colis repérés`, e.found ? 'good' : 'info', 'scan');
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

  // ---------- Au-delà du contrat (menu, démo) ----------
  openPorter(tab?: PorterTab): void {
    this.shelter.panel.close(); this.order.panel.close();
    this.porter.open(tab, this.view);
  }
  setSheetExpanded(on: boolean): void {
    this.sheet.setExpanded(on);
  }
  showHelp(): void { this.help.start(); }
  setAmbiance(a: Ambiance): void {
    this.ambiance = a;
    this.root.dataset.ambiance = a === 'clair' ? 'clair' : 'crepuscule';
    this.porter?.showAmbiance(a);
  }

  private closePanels(): void {
    this.shelter.panel.close(); this.order.panel.close(); this.porter.panel.close();
  }
  private run(r: ActionResult): boolean {
    if (r.ok) return true;
    this.toast(r.why, 'warn');
    return false;
  }
  private toast(text: string, tone: Tone): void { this.toasts.push(text, tone); }
}
