// Le ramassage d'un colis, de bout en bout : vérification, séquence en caméra (repérage, inspection, sanglage),
// puis ramassage réel et écran de rangement. Avec « Ramassage rapide », le colis va droit à l'emplacement conseillé.
import type { GameActions, GameEvent, GameView, OrderView, UiKind } from '../game/api';
import { crateLabel } from '../game/crates';
import { strapQualityFromState } from '../game/gestures';
import { SURPRISE_HEARD } from '../game/surprises';
import { LoadScreen } from './load';
import { type MsgTone, PickupSequence, type SeqOptions, type SeqParcel } from './sequence';
import './pickup.css';

export interface FlowHost {
  actions: GameActions;
  /** Dernier état du jeu affiché. */
  view(): GameView | null;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  ui(kind: UiKind): void;
  buzz(pattern: number | number[]): void;
  /** Réglage « Ramassage rapide ». */
  quick(): boolean;
  /** Une couche plein écran s'ouvre ou se ferme (la carte peut se mettre en veille). */
  overlay?(open: boolean): void;
}

const D2R = Math.PI / 180;
function bearing(a: [number, number], b: [number, number]): number {
  const dL = (b[0] - a[0]) * D2R, y = Math.sin(dL) * Math.cos(b[1] * D2R);
  const x = Math.cos(a[1] * D2R) * Math.sin(b[1] * D2R) - Math.sin(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.cos(dL);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}
/** Ce que la séquence a besoin de savoir d'un colis. */
export function seqParcel(o: OrderView, v: GameView | null): SeqParcel {
  const sp = o.special ?? null, at = v?.player.at ?? null;
  return {
    id: o.id, name: o.name, crate: o.crate, weightKg: o.weightKg, fragile: o.fragile, special: sp?.kind ?? null,
    crateLabel: sp ? (sp.known ? 'Colis spécial' : 'Colis scellé') : crateLabel(o.crate),
    timed: o.minutesLeft !== null, inspected: o.inspected === true, labelHidden: o.labelHidden === true,
    known: sp?.known ? `${sp.label}. ${sp.rule}` : o.inspected && o.fragile ? 'Colis fragile : aucun geste brusque' : '',
    bearingDeg: at && o.distanceM > 6 ? bearing(at, o.at) : null, destName: o.destName,
  };
}

export class PickupFlow {
  readonly seq: PickupSequence;
  readonly load: LoadScreen;
  /** Options de la séquence (démo : étape de départ, panorama forcé, rendu allégé). */
  seqOptions: SeqOptions = {};
  private running: string | null = null;
  private heard: OrderView | null = null;
  private over = false;
  /** Vrai pendant le ramassage qui conclut la séquence : le HUD n'annonce rien, l'écran de rangement s'ouvre. */
  private quiet = false;

  constructor(root: HTMLElement, private host: FlowHost) {
    this.load = new LoadScreen(root, { actions: host.actions, ui: k => host.ui(k), closed: () => this.overlay() });
    this.seq = new PickupSequence(root);
  }

  /** Vrai tant que la séquence ou l'écran de rangement couvre le jeu. */
  get busy(): boolean { return this.running !== null || this.load.isOpen; }

  /** Le joueur touche « Ramasser ». À appeler dans le geste (permissions de la caméra et des capteurs). */
  start(orderId: string): void {
    if (this.running) return;
    const { host } = this, v = host.view(), o = v?.orders.find(x => x.id === orderId);
    const can = host.actions.canPickup?.(orderId) ?? (o && o.state === 'révélé' && !o.inRange ? { ok: false as const, why: 'Trop loin du colis.' } : { ok: true as const });
    if (!can.ok) { host.toast(can.why, 'warn'); host.ui('error'); return; }
    if (!o || host.quick()) {
      // Ramassage rapide : ni repérage ni sanglage, le colis part à l'emplacement conseillé.
      const r = host.actions.pickup(orderId);
      if (!r.ok) { host.toast(r.why, 'warn'); host.ui('error'); }
      return;
    }
    this.running = orderId;
    this.overlay();
    void this.seq.run(seqParcel(o, v), {
      listen: () => this.listen(orderId, o),
      foundLabel: () => { host.actions.foundLabel?.(orderId); },
      ui: k => host.ui(k), buzz: p => host.buzz(p),
      conditions: () => {
        const now = host.view() ?? v, w = now?.weather, st = now?.player.stamina ?? 1;
        return { wet: w?.kind === 'pluie' || w?.kind === 'orage' || w?.kind === 'neige', night: w?.night === true, tired: st < 0.3, exhausted: st <= 0 };
      },
    // Colis déjà porté puis posé : on le reprend au sanglage, sans le chercher ni l'inspecter de nouveau.
    }, o.dropped ? { ...this.seqOptions, start: 'sanglage' } : this.seqOptions).then(res => {
      this.running = null;
      if (res.outcome === 'strapped') {
        this.quiet = true;
        let r;
        try { r = host.actions.pickup(orderId); if (r.ok) host.actions.strap(orderId, strapQualityFromState(res.state)); } finally { this.quiet = false; }
        if (!r.ok) { host.toast(r.why, 'warn'); host.ui('error'); this.overlay(); return; }
        // L'écran de rangement s'ouvre sur le colis qu'on vient d'accrocher (affiché dès le prochain état du jeu).
        this.load.open(null, orderId);
        this.overlay();
        return;
      }
      // Sanglage raté, ou abandonné en cours de route : petite pénalité, comme dans l'ancien jeu. Le colis reste au sol.
      if (res.outcome === 'failed' || res.strapping) host.actions.fumble?.(orderId);
      else host.toast('Colis laissé au sol', 'info');
      this.overlay();
    });
  }

  /** Ouvre l'écran de rangement (bouton « Sac »). */
  openBag(): void {
    if (this.running) return;
    this.load.open(this.host.view());
    this.overlay();
  }

  render(v: GameView): void { this.load.render(v); }

  /** Événement du jeu. Renvoie vrai si le HUD n'a pas à l'annoncer (la séquence ou l'écran de rangement le montre déjà). */
  handle(e: GameEvent): boolean {
    if (e.type === 'inspect' && this.running === e.order.id) { this.heard = e.order; return true; }
    if (this.quiet && (e.type === 'pickup' || e.type === 'strap')) return true;
    if (e.type === 'stow' && this.load.isOpen) return true;
    return false;
  }

  /** Referme tout (changement d'écran : labo, prologue). */
  closeAll(): void { this.seq.close(); this.load.close(); }

  private listen(orderId: string, before: OrderView): { text: string; tone: MsgTone; cat?: boolean } {
    this.heard = null;
    const r = this.host.actions.inspect(orderId);
    if (!r.ok) return { text: r.why, tone: 'bad' };
    const o = this.heard ?? before, sp = o.special;
    if (sp) return { text: `${sp.label}. ${sp.rule}`, tone: 'gold' };
    if (o.surprise && o.surprise !== 'label') return { text: SURPRISE_HEARD[o.surprise], tone: 'gold', cat: o.surprise === 'chat' };
    return o.fragile ? { text: 'Ça tinte : colis fragile, aucun geste brusque', tone: '' } : { text: 'Rien d’anormal, le contenu est bien calé', tone: '' };
  }

  private overlay(): void {
    const on = this.busy;
    if (on === this.over) return;
    this.over = on;
    try { this.host.overlay?.(on); } catch { /* la carte se débrouille */ }
  }
}
