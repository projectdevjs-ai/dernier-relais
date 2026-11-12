// Le lien entre le jeu, le réseau et l'interface : c'est ici que la chaîne de relais est jouée de bout en bout.
//   dépôt      : le jeu vérifie, le serveur enregistre, puis le colis quitte le sac (avance de points) ;
//   prise      : le jeu vérifie, le serveur attribue le relais (un seul gagnant), puis le colis entre dans le sac ;
//   livraison  : le jeu note la livraison comme une autre, le serveur crée la prime de chaque porteur de la chaîne ;
//   primes     : réclamées à la reconnexion et à l'ouverture d'un abri, créditées au joueur avec un message.
// Le jeu n'appelle jamais le réseau et l'interface non plus : ils passent tous deux par cet objet.
// Règle d'or du réseau conservée : rien ici ne lève d'exception, et hors ligne tout renvoie une valeur neutre.
import { type ActionResult, type CollectiveView, type GameEvent, type HudOnline, type HudPseudo, RELAY, type RelayCrate, type RelayGiveResult, type RelayOffer } from '../game/api';
import { COLLECTIVE_THRESHOLDS, type KeyValue, type Network } from './network';

/** Ce que le lien utilise du jeu (un objet Game convient tel quel). */
export interface LinkGame {
  on(fn: (e: GameEvent) => void): () => void;
  giveToRelay(orderId: string, shelterId?: string, dryRun?: boolean): RelayGiveResult;
  takeFromRelay(relay: { id: string; parcel: RelayCrate }, dryRun?: boolean): ActionResult;
  credit(points: number, reason?: string): void;
}
export type LinkNet = Pick<Network, 'online' | 'onOnline' | 'shelterLevels' | 'onCollective' | 'relaysAt' | 'dropRelay' | 'takeRelay' | 'deliverRelay'
  | 'pendingRewards' | 'claimRewards' | 'pseudo' | 'hasPseudo' | 'setPseudo'>;
export interface LinkUi {
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  /** L'état en ligne a changé : l'interface relit ce qu'elle affiche (panneau d'abri ouvert). */
  refresh?(): void;
}
export interface LinkOptions {
  /** Stockage local des livraisons de relais en attente d'envoi. null = mémoire seulement. Par défaut : localStorage. */
  storage?: KeyValue | null;
  /** Nom d'un abri, pour le message de montée de niveau collectif. */
  shelterName?: (id: string) => string | null;
  now?: () => number;
}

interface PendingDelivery { id: string; points: number; tries: number }
const K_DELIVERED = 'dernier-relais/net/relais-livres', K_OWN = 'dernier-relais/net/relais-miens';
const RELAYS_TTL_MS = 20_000, COLLECT_EVERY_MS = 30_000;
const no = (why: string): ActionResult => ({ ok: false, why });

/** Vue d'un niveau collectif : niveau, points, seuil suivant et avancement. */
export function collectiveView(level: number, points: number): CollectiveView {
  const lv = Math.min(5, Math.max(0, Math.floor(level)));
  const nextAt = lv >= 5 ? null : COLLECTIVE_THRESHOLDS[lv], from = lv > 0 ? COLLECTIVE_THRESHOLDS[lv - 1] : 0;
  return { level: lv, points, nextAt, progress: nextAt === null ? 1 : Math.min(1, Math.max(0, (points - from) / (nextAt - from))) };
}

export class OnlineLink {
  /** À passer au HUD : `HudEvents.online`. */
  readonly hud: HudOnline;
  /** À passer au HUD : `HudEvents.pseudo`. */
  readonly pseudo: HudPseudo;
  private kv: KeyValue | null;
  private now: () => number;
  private delivered: PendingDelivery[] = [];
  /** Relais que le joueur a livrés lui-même : sa livraison est déjà payée par la note, pas de prime en plus. */
  private own: string[] = [];
  private offers = new Map<string, { t: number; list: RelayOffer[] }>();
  private flushing = false;
  private collecting: Promise<number> | null = null;
  private collectT = -Infinity;
  private offs: (() => void)[] = [];

  constructor(private net: LinkNet, private game: LinkGame, private ui: LinkUi, private opts: LinkOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.kv = opts.storage !== undefined ? opts.storage : defaultStorage();
    try {
      const raw: unknown = JSON.parse(this.kv?.getItem(K_DELIVERED) ?? '[]');
      if (Array.isArray(raw)) for (const v of raw) if (v && typeof v.id === 'string' && Number.isFinite(v.points)) this.delivered.push({ id: v.id, points: v.points, tries: 0 });
      const own: unknown = JSON.parse(this.kv?.getItem(K_OWN) ?? '[]');
      if (Array.isArray(own)) this.own = own.filter((x): x is string => typeof x === 'string').slice(-40);
    } catch { /* stockage illisible : on repart de zéro */ }

    this.hud = {
      isOnline: () => this.safe(() => this.net.online, false),
      shelterLevel: id => this.shelterLevel(id),
      relaysAt: id => this.relaysAt(id),
      giveRelay: (orderId, shelterId) => this.giveRelay(orderId, shelterId),
      takeRelay: offer => this.takeRelay(offer),
    };
    this.pseudo = {
      get: () => this.safe(() => this.net.pseudo(), 'Porteur'),
      chosen: () => this.safe(() => this.net.hasPseudo(), true),
      set: async name => { try { return await this.net.setPseudo(name); } catch { return false; } },
    };
  }

  /** Branche le lien : livraisons de relais, montées de niveau collectif, primes à la reconnexion. */
  start(): void {
    if (this.offs.length) return;
    this.offs.push(this.game.on(e => {
      if (e.type !== 'delivery' || !e.result.relayId) return;
      this.delivered.push({ id: e.result.relayId, points: Math.max(1, Math.round(e.result.points * RELAY.chainShare)), tries: 0 });
      this.own.push(e.result.relayId);
      if (this.own.length > 40) this.own.splice(0, this.own.length - 40);
      this.persist();
      void this.flush();
    }));
    this.offs.push(this.net.onCollective(e => {
      try {
        if (e.level > e.levelBefore) {
          const name = this.opts.shelterName?.(e.shelterId);
          this.ui.toast(name ? `${name} passe au niveau ${e.level} du réseau` : `Abri collectif : niveau ${e.level} atteint`, 'good');
        }
        this.ui.refresh?.();
      } catch { /* l'affichage ne doit pas gêner le réseau */ }
    }));
    this.offs.push(this.net.onOnline(up => {
      if (up) { void this.flush().then(() => this.collect()); }
      try { this.ui.refresh?.(); } catch { /* voir plus haut */ }
    }));
    if (this.net.online) void this.flush().then(() => this.collect());
  }
  stop(): void { for (const off of this.offs.splice(0)) off(); }

  /** Livraisons de relais pas encore déclarées au serveur (hors ligne au moment de livrer). */
  pendingDeliveries(): number { return this.delivered.length; }

  /** Déclare au serveur les relais livrés : c'est ce qui crée la prime des autres porteurs de la chaîne. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.delivered.length && this.net.online) {
        const d = this.delivered[0];
        const ok = await this.net.deliverRelay(d.id, d.points);
        // Refus répété alors que le serveur répond (relais déjà clos, limite de fréquence) : on ne bloque pas la file.
        if (ok || ++d.tries >= 3) { this.delivered.shift(); this.persist(); } else break;
      }
    } catch { /* on reprendra à la prochaine connexion */ }
    this.flushing = false;
  }

  /** Réclame les primes de relais en attente et les crédite au joueur. Renvoie les points crédités. */
  collect(force = false): Promise<number> {
    if (this.collecting) return this.collecting;
    if (!force && this.now() - this.collectT < COLLECT_EVERY_MS) return Promise.resolve(0);
    this.collectT = this.now();
    this.collecting = this.collectOnce().catch(() => 0).finally(() => { this.collecting = null; });
    return this.collecting;
  }
  private async collectOnce(): Promise<number> {
    if (!this.net.online) return 0;
    const pending = await this.net.pendingRewards();
    if (!pending.length) return 0;
    // La prime d'un relais que le joueur a livré lui-même n'est pas comptée : sa note l'a déjà payé.
    let skip = 0, others = 0;
    for (const r of pending) { if (this.own.includes(r.relayId)) skip += r.points; else others++; }
    const total = await this.net.claimRewards();
    const gain = Math.max(0, Math.round(total - skip));
    if (gain > 0) this.game.credit(gain, others > 1 ? `Tes relais sont arrivés : +${gain} points` : `Ton relais est arrivé : +${gain} points`);
    return gain;
  }

  // ───────── ce que l'interface demande

  private async shelterLevel(id: string): Promise<CollectiveView | null> {
    try {
      if (!this.net.online) return null;
      const v = (await this.net.shelterLevels([id])).get(id);
      return v ? collectiveView(v.level, v.points) : null;
    } catch { return null; }
  }

  private async relaysAt(shelterId: string): Promise<RelayOffer[]> {
    try {
      if (!this.net.online) return [];
      void this.flush().then(() => this.collect());
      const c = this.offers.get(shelterId);
      if (c && this.now() - c.t < RELAYS_TTL_MS) return c.list;
      const list = (await this.net.relaysAt(shelterId)).map(r => ({ id: r.id, parcel: r.parcel, hops: r.hops, mine: r.mine }));
      if (this.net.online) this.offers.set(shelterId, { t: this.now(), list });
      return list;
    } catch { return []; }
  }

  private async giveRelay(orderId: string, shelterId: string): Promise<ActionResult & { points?: number }> {
    try {
      if (!this.net.online) return no('Les relais demandent une connexion.');
      const check = this.game.giveToRelay(orderId, shelterId, true);
      if (!check.ok || !check.parcel) return check.ok ? no('Colis introuvable.') : check;
      const id = await this.net.dropRelay(shelterId, check.relayId ?? check.parcel);
      if (!id) return no(this.net.online ? 'Dépôt refusé : cet abri-relais est plein, ou tu as déjà trop de relais en route.' : 'Connexion perdue : le colis reste dans ton sac.');
      this.offers.delete(shelterId);
      const done = this.game.giveToRelay(orderId, shelterId);
      return done.ok ? { ok: true, points: done.points } : done;
    } catch { return no('Dépôt impossible pour l’instant.'); }
  }

  private async takeRelay(offer: RelayOffer): Promise<ActionResult> {
    try {
      if (!this.net.online) return no('Les relais demandent une connexion.');
      if (offer.mine) return no('Tu as déjà porté ce colis : laisse-le à un autre porteur.');
      const check = this.game.takeFromRelay(offer, true);
      if (!check.ok) return check;
      const got = await this.net.takeRelay(offer.id);
      this.offers.clear();
      if (!got) return no(this.net.online ? 'Trop tard : un autre porteur l’a pris, ou tu portes déjà trois relais.' : 'Connexion perdue : réessaie dans un instant.');
      return this.game.takeFromRelay({ id: got.id, parcel: got.parcel });
    } catch { return no('Prise impossible pour l’instant.'); }
  }

  private safe<T>(fn: () => T, fallback: T): T { try { return fn(); } catch { return fallback; } }
  private persist(): void {
    try {
      this.kv?.setItem(K_DELIVERED, JSON.stringify(this.delivered.map(d => ({ id: d.id, points: d.points }))));
      this.kv?.setItem(K_OWN, JSON.stringify(this.own));
    } catch { /* stockage plein ou indisponible */ }
  }
}

function defaultStorage(): KeyValue | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
