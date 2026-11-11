// Le jeu en ligne : abris collectifs, progression des régions, classement, chaîne de relais.
// Règle d'or : aucune méthode ne lève d'exception vers l'appelant. Hors ligne (réseau coupé, connexion anonyme
// désactivée, tables absentes), tout renvoie une valeur neutre et les livraisons attendent dans une file locale.
import type { LngLat } from '../core/geo';
import { hash } from '../core/geo';
import type { CrateKind, DeliveryResult, OrderView } from '../game/api';
import type { GameSave } from '../game/save';
import { NetClient } from './client';
import { REGIONS, type RegionId, isRegionId, regionAt } from './regions';

// ───────────────────────── types publics

export interface RegionProgress {
  id: RegionId; name: string;
  /** Abris ayant reçu au moins une livraison. */
  shelters: number;
  /** Abris de niveau collectif 1 ou plus. */
  activeShelters: number;
  points: number; deliveries: number;
  /** De 0 (éteinte) à 1 (réseau rétabli) : abris actifs rapportés à REGION_GOAL. */
  progress: number;
}
export interface ShelterLevel { level: number; points: number }
export interface LeaderRow {
  rank: number; id: string; pseudo: string; level: number; score: number; deliveries: number; distanceKm: number;
  region: string | null;
  /** Vrai pour la ligne du joueur lui-même. */
  me: boolean;
}
/** Le colis confié à la chaîne de relais (ce qu'il faut pour le réafficher chez un autre joueur). */
export interface RelayParcel {
  name: string; crate: CrateKind; weightKg: number; fragile: boolean;
  /** Points de base à la livraison. */
  reward: number;
  destId: string; destName: string; destAt: LngLat;
}
export interface Relay {
  id: string; parcel: RelayParcel; destId: string;
  /** Abri où il attend, null s'il est porté. */
  atShelter: string | null;
  state: 'waiting' | 'carried' | 'delivered';
  /** Nombre de porteurs qui se sont déjà relayés. */
  hops: number;
  /** Vrai si le joueur fait déjà partie de la chaîne. */
  mine: boolean;
  createdAt: string;
}
export interface RelayReward { id: number; relayId: string; points: number; hops: number; parcel: string; at: string }
export interface CollectiveEvent { shelterId: string; level: number; levelBefore: number; points: number }
export interface PlayerStats { level: number; score: number; deliveries: number; distanceKm: number }

/** Nombre d'abris actifs pour qu'une région soit entièrement rallumée sur la carte. */
export const REGION_GOAL = 120;
/** Points collectifs nécessaires pour chaque niveau d'abri (identiques à collective_level() du schéma SQL). */
export const COLLECTIVE_THRESHOLDS = [600, 3000, 10000, 25000, 60000] as const;

/** Prépare un colis du jeu pour la chaîne de relais. */
export function parcelOf(o: OrderView): RelayParcel {
  return { name: o.name, crate: o.crate, weightKg: o.weightKg, fragile: o.fragile, reward: o.reward, destId: o.destId, destName: o.destName, destAt: o.destAt };
}

/** Nettoie un pseudo : renvoie null s'il n'est pas acceptable (2 à 20 caractères visibles). */
export function cleanPseudo(name: string): string | null {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  return n >= 2 && n <= 20 && s.length <= 20 ? s : null;
}

// ───────────────────────── outils internes

export interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }
export interface NetworkOptions {
  /** Stockage local (file d'attente, pseudo, dernier état connu). null = mémoire seulement. Par défaut : localStorage. */
  storage?: KeyValue | null;
  now?: () => number;
}

interface Outgoing { shelterId: string; name: string; lng: number; lat: number; region: RegionId; points: number; tries: number }
type Reply = Record<string, unknown>;

const K_OUTBOX = 'dernier-relais/net/file', K_PSEUDO = 'dernier-relais/net/pseudo', K_REGIONS = 'dernier-relais/net/regions';
const OUTBOX_MAX = 150, LEVEL_TTL_MS = 60_000, PLAYER_EVERY_MS = 60_000, POLL_MS = 90_000;
const CRATES: CrateKind[] = ['bois', 'alu', 'plastique', 'carton'];

const num = (v: unknown, d = 0): number => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : d; };
const text = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const rec = (v: unknown): Reply | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Reply) : null);
const rows = (v: unknown): Reply[] => (Array.isArray(v) ? v.map(rec).filter((x): x is Reply => x !== null) : []);

function emptyRegions(): Map<RegionId, RegionProgress> {
  return new Map(REGIONS.map(r => [r.id, { id: r.id, name: r.name, shelters: 0, activeShelters: 0, points: 0, deliveries: 0, progress: 0 }]));
}
function regionRow(v: unknown): RegionProgress | null {
  const o = rec(v);
  if (!o || !isRegionId(o.id)) return null;
  const active = Math.max(0, num(o.active_shelters ?? o.activeShelters));
  return {
    id: o.id, name: REGIONS.find(r => r.id === o.id)!.name, shelters: Math.max(0, num(o.shelters)), activeShelters: active,
    points: Math.max(0, num(o.points)), deliveries: Math.max(0, num(o.deliveries)), progress: Math.min(1, active / REGION_GOAL),
  };
}
function parcelRow(v: unknown, destId: string): RelayParcel {
  const o = rec(v) ?? {};
  const at = Array.isArray(o.destAt) && o.destAt.length === 2 ? o.destAt : [0, 0];
  return {
    name: text(o.name, 'Colis'), crate: CRATES.includes(o.crate as CrateKind) ? (o.crate as CrateKind) : 'carton',
    weightKg: Math.max(0, num(o.weightKg, 1)), fragile: o.fragile === true, reward: Math.max(0, num(o.reward, 0)),
    destId, destName: text(o.destName), destAt: [num(at[0]), num(at[1])],
  };
}

// ───────────────────────── le réseau

export class Network {
  readonly client: NetClient;
  private kv: KeyValue | null;
  private now: () => number;
  private started = false;

  private outbox: Outgoing[] = [];
  private draining = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  private levels = new Map<string, { level: number; points: number; t: number }>();
  private regionMap = emptyRegions();
  private regionFns = new Set<(r: RegionProgress[]) => void>();
  private collectiveFns = new Set<(e: CollectiveEvent) => void>();
  private regionsLoading: Promise<void> | null = null;
  private regionsSoon: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private live = false;
  private channelMade = false;

  private board: LeaderRow[] = [];
  private players: number | null = null;

  private name: string | null = null;
  private stats: PlayerStats | null = null;
  private region: RegionId | null = null;
  private playerDirty = false;
  private playerSentT = -Infinity;

  constructor(client?: NetClient, opts: NetworkOptions = {}) {
    this.client = client ?? new NetClient();
    this.now = opts.now ?? (() => Date.now());
    this.kv = opts.storage !== undefined ? opts.storage : defaultStorage();
    this.outbox = this.readOutbox();
    this.name = cleanPseudo(this.read(K_PSEUDO) ?? '');
    try { for (const r of rows(JSON.parse(this.read(K_REGIONS) ?? '[]'))) { const p = regionRow(r); if (p) this.regionMap.set(p.id, p); } } catch { /* cache illisible */ }
    this.client.onOnline(up => { if (up) this.onUp(); });
  }

  // ───────── état

  /** Lance la connexion (anonyme) et tout ce qui en dépend. Sans effet si le réseau n'est pas disponible. */
  start(): void {
    if (this.started) return;
    this.started = true;
    try { this.client.start(); } catch { /* hors ligne */ }
  }
  get online(): boolean { return this.client.online; }
  /** S'abonne aux passages en ligne / hors ligne. Renvoie la fonction de désabonnement. */
  onOnline(fn: (online: boolean) => void): () => void { return this.client.onOnline(fn); }
  /** Identifiant du joueur, null tant qu'aucune connexion n'a réussi. */
  userId(): string | null { return this.client.userId; }

  // ───────── joueur

  /** Pseudo actuel (un nom par défaut tant que le joueur n'en a pas choisi). */
  pseudo(): string {
    if (this.name) return this.name;
    const uid = this.client.userId;
    return uid ? `Porteur ${1000 + (hash(uid) % 9000)}` : 'Porteur';
  }
  /** Change le pseudo (2 à 20 caractères). Renvoie faux s'il est refusé ; hors ligne, il sera envoyé plus tard. */
  async setPseudo(name: string): Promise<boolean> {
    try {
      const clean = cleanPseudo(name);
      if (!clean) return false;
      this.name = clean;
      this.write(K_PSEUDO, clean);
      this.playerDirty = true;
      await this.syncPlayer(true);
      return true;
    } catch { return false; }
  }
  /** Tient la fiche publique du joueur à jour (classement). À appeler quand ses chiffres changent ; l'envoi est espacé. */
  setPlayer(stats: PlayerStats, at?: LngLat | null): void {
    try {
      const s = this.stats;
      if (!s || s.level !== stats.level || Math.round(s.score) !== Math.round(stats.score) || s.deliveries !== stats.deliveries || Math.abs(s.distanceKm - stats.distanceKm) >= 0.1) {
        this.stats = { ...stats };
        this.playerDirty = true;
      }
      if (at) this.setPosition(at);
      void this.syncPlayer(false);
    } catch { /* jamais d'erreur vers le jeu */ }
  }
  /** Raccourci : lit les chiffres du joueur dans une sauvegarde (à brancher sur CloudGameStore, option onSave). */
  observeSave(save: GameSave): void {
    this.setPlayer({ level: save.level, score: save.score, deliveries: save.deliveries, distanceKm: save.distanceM / 1000 }, save.last);
  }
  /** Position du joueur : sert à connaître sa région. */
  setPosition(at: LngLat): void {
    try {
      const r = regionAt(at[0], at[1]);
      if (r !== this.region) { this.region = r; this.playerDirty = true; }
    } catch { /* position illisible */ }
  }
  /** Région où se trouve le joueur, null si sa position est inconnue. */
  myRegion(): RegionId | null { return this.region; }

  // ───────── livraisons

  /** À appeler à chaque livraison du jeu : crédite l'abri collectif, sa région et la fiche du joueur. */
  onDelivery(result: DeliveryResult, shelter: { id: string; name: string; at: LngLat }): void {
    try {
      const points = Math.round(result.points);
      if (!shelter.id || !(points > 0)) return;
      this.outbox.push({
        shelterId: shelter.id, name: shelter.name || result.shelterName || 'Abri', lng: shelter.at[0], lat: shelter.at[1],
        region: regionAt(shelter.at[0], shelter.at[1]), points, tries: 0,
      });
      if (this.outbox.length > OUTBOX_MAX) this.outbox.splice(0, this.outbox.length - OUTBOX_MAX);
      this.writeOutbox();
      this.setPosition(shelter.at);
      void this.drain();
    } catch { /* jamais d'erreur vers le jeu */ }
  }
  /** Livraisons en attente d'envoi (hors ligne ou limite de fréquence). */
  pendingDeliveries(): number { return this.outbox.length; }
  /** Prévenu quand une livraison du joueur a été comptée pour un abri collectif (niveau avant / après). */
  onCollective(fn: (e: CollectiveEvent) => void): () => void {
    this.collectiveFns.add(fn);
    return () => { this.collectiveFns.delete(fn); };
  }

  /** Niveau collectif (0 à 5) et points des abris demandés. Réponses gardées une minute ; hors ligne : ce qui est déjà connu. */
  async shelterLevels(ids: string[]): Promise<Map<string, ShelterLevel>> {
    const out = new Map<string, ShelterLevel>();
    try {
      const t = this.now(), ask: string[] = [];
      for (const id of new Set(ids)) {
        const c = this.levels.get(id);
        if (c) out.set(id, { level: c.level, points: c.points });
        if (!c || t - c.t > LEVEL_TTL_MS) ask.push(id);
      }
      for (let i = 0; i < ask.length; i += 80) {
        const part = ask.slice(i, i + 80);
        const data = await this.client.run<unknown[]>(db => db.from('shelters').select('id,level,points').in('id', part));
        if (!data) break;
        const got = new Map(rows(data).map(r => [text(r.id), r]));
        for (const id of part) { // un abri absent de la table n'a encore reçu aucune livraison
          const r = got.get(id), v = { level: Math.min(5, Math.max(0, num(r?.level))), points: Math.max(0, num(r?.points)) };
          this.levels.set(id, { ...v, t });
          out.set(id, v);
        }
      }
    } catch { /* on renvoie ce qu'on a */ }
    return out;
  }

  // ───────── régions

  /** Progression des 13 régions (toujours 13 lignes ; des zéros tant que rien n'est connu). */
  regions(): RegionProgress[] { return REGIONS.map(r => ({ ...this.regionMap.get(r.id)! })); }
  /** S'abonne aux mises à jour en direct des régions. Renvoie la fonction de désabonnement. */
  onRegions(fn: (regions: RegionProgress[]) => void): () => void {
    this.regionFns.add(fn);
    try {
      void this.loadRegions();
      // Filet de sécurité si le canal temps réel ne passe pas : relecture périodique tant que quelqu'un écoute.
      this.poll ??= setInterval(() => { if (this.client.online) void this.loadRegions(); }, POLL_MS);
    } catch { /* hors ligne */ }
    return () => {
      this.regionFns.delete(fn);
      if (!this.regionFns.size && this.poll) { clearInterval(this.poll); this.poll = null; }
    };
  }

  // ───────── classement

  /** Les meilleurs porteurs, par score. Hors ligne : le dernier classement connu (vide au départ). */
  async leaderboard(limit = 20): Promise<LeaderRow[]> {
    try {
      const n = Math.min(100, Math.max(1, Math.floor(limit)));
      const data = await this.client.run<unknown[]>(db => db.from('players').select('id,pseudo,level,score,deliveries,distance_km,region').order('score', { ascending: false }).limit(n));
      if (data) {
        const me = this.client.userId;
        this.board = rows(data).map((r, i) => ({
          rank: i + 1, id: text(r.id), pseudo: text(r.pseudo, 'Porteur'), level: Math.max(1, num(r.level, 1)), score: num(r.score),
          deliveries: num(r.deliveries), distanceKm: num(r.distance_km), region: typeof r.region === 'string' ? r.region : null, me: !!me && r.id === me,
        }));
      }
    } catch { /* dernier classement connu */ }
    return this.board.map(r => ({ ...r }));
  }
  /** Nombre de porteurs inscrits, null si inconnu. */
  async playerCount(): Promise<number | null> {
    try {
      const r = await this.client.query<unknown[]>(db => db.from('players').select('id', { count: 'exact', head: true }));
      if (r && typeof r.count === 'number') this.players = r.count;
    } catch { /* dernier nombre connu */ }
    return this.players;
  }

  // ───────── chaîne de relais

  /** Relais en attente dans cet abri (les plus anciens d'abord). */
  async relaysAt(shelterId: string): Promise<Relay[]> {
    try {
      const data = await this.client.run<unknown[]>(db => db.from('relays').select('id,payload,dest_shelter,at_shelter,carriers,state,created_at')
        .eq('at_shelter', shelterId).eq('state', 'waiting').order('created_at', { ascending: true }).limit(30));
      return rows(data).map(r => this.relayRow(r)).filter((x): x is Relay => x !== null);
    } catch { return []; }
  }
  /** Relais que le joueur porte en ce moment (à relire après un redémarrage du jeu). */
  async carriedRelays(): Promise<Relay[]> {
    try {
      const uid = this.client.userId;
      if (!uid) return [];
      const data = await this.client.run<unknown[]>(db => db.from('relays').select('id,payload,dest_shelter,at_shelter,carriers,state,created_at')
        .eq('carrier', uid).eq('state', 'carried').limit(10));
      return rows(data).map(r => this.relayRow(r)).filter((x): x is Relay => x !== null);
    } catch { return []; }
  }
  /**
   * Dépose un colis dans un abri-relais. `what` = un colis du jeu (nouveau relais) ou l'identifiant d'un relais porté.
   * Renvoie l'identifiant du relais, ou null si le dépôt est refusé ou impossible (hors ligne).
   */
  async dropRelay(shelterId: string, what: RelayParcel | string): Promise<string | null> {
    try {
      const args = typeof what === 'string'
        ? { p_relay_id: what, p_at_shelter: shelterId, p_dest_shelter: null, p_payload: null }
        : { p_relay_id: null, p_at_shelter: shelterId, p_dest_shelter: what.destId, p_payload: what };
      const r = rec(await this.client.run<unknown>(db => db.rpc('relay_drop', args)));
      return r?.ok === true && typeof r.id === 'string' ? r.id : null;
    } catch { return null; }
  }
  /** Prend un relais en attente. Un seul joueur peut l'obtenir : renvoie null si un autre a été plus rapide. */
  async takeRelay(relayId: string): Promise<Relay | null> {
    try {
      const r = rec(await this.client.run<unknown>(db => db.rpc('relay_take', { p_relay_id: relayId })));
      return r?.ok === true ? this.relayRow(r.relay) : null;
    } catch { return null; }
  }
  /** Livre un relais porté à son abri de destination : chaque porteur de la chaîne reçoit `points` (400 au plus). */
  async deliverRelay(relayId: string, points: number): Promise<boolean> {
    try {
      const r = rec(await this.client.run<unknown>(db => db.rpc('relay_deliver', { p_relay_id: relayId, p_points: Math.round(points) })));
      return r?.ok === true;
    } catch { return false; }
  }
  /** Récompenses de relais que le joueur n'a pas encore réclamées. */
  async pendingRewards(): Promise<RelayReward[]> {
    try {
      const uid = this.client.userId;
      if (!uid) return [];
      const data = await this.client.run<unknown[]>(db => db.from('relay_rewards').select('id,relay_id,points,hops,parcel,created_at')
        .eq('player', uid).is('claimed_at', null).order('created_at', { ascending: true }).limit(50));
      return rows(data).map(r => ({ id: num(r.id), relayId: text(r.relay_id), points: num(r.points), hops: Math.max(1, num(r.hops, 1)), parcel: text(r.parcel), at: text(r.created_at) }));
    } catch { return []; }
  }
  /** Réclame toutes les récompenses en attente. Renvoie le total de points à créditer au joueur (0 si rien ou hors ligne). */
  async claimRewards(): Promise<number> {
    try {
      const r = rec(await this.client.run<unknown>(db => db.rpc('relay_claim_rewards')));
      return r?.ok === true ? Math.max(0, num(r.points)) : 0;
    } catch { return 0; }
  }

  // ───────────────────────── interne

  private relayRow(v: unknown): Relay | null {
    const o = rec(v);
    if (!o || typeof o.id !== 'string' || typeof o.dest_shelter !== 'string') return null;
    const carriers = Array.isArray(o.carriers) ? o.carriers : [], me = this.client.userId;
    const state = o.state === 'carried' || o.state === 'delivered' ? o.state : 'waiting';
    return {
      id: o.id, parcel: parcelRow(o.payload, o.dest_shelter), destId: o.dest_shelter, atShelter: typeof o.at_shelter === 'string' ? o.at_shelter : null,
      state, hops: carriers.length, mine: !!me && carriers.includes(me), createdAt: text(o.created_at),
    };
  }

  private onUp(): void {
    void this.loadRegions();
    void this.drain();
    void this.syncPlayer(false);
    this.listen();
  }

  /** Envoie les livraisons en attente, une par une, dans l'ordre. */
  private async drain(): Promise<void> {
    if (this.draining || !this.outbox.length) return;
    this.draining = true;
    try {
      while (this.outbox.length) {
        const o = this.outbox[0];
        const reply = rec(await this.client.run<unknown>(db => db.rpc('deliver_to_shelter', {
          p_shelter_id: o.shelterId, p_name: o.name, p_lng: o.lng, p_lat: o.lat, p_region: o.region, p_points: o.points,
        })));
        if (!reply) {
          if (!this.client.online) break; // hors ligne : on reprendra au retour du réseau
          if (++o.tries < 3) { this.retryDrain(30_000); break; }
          this.outbox.shift(); // requête refusée trois fois : on ne bloque pas la file pour elle
        } else if (reply.ok === true) {
          this.outbox.shift();
          const level = Math.min(5, Math.max(0, num(reply.level))), points = Math.max(0, num(reply.points));
          this.levels.set(o.shelterId, { level, points, t: this.now() });
          this.emit(this.collectiveFns, { shelterId: o.shelterId, level, levelBefore: Math.min(5, Math.max(0, num(reply.level_before))), points });
          this.playerDirty = true;
          if (!this.live) this.loadRegionsSoon();
        } else if (reply.reason === 'rate') {
          this.retryDrain(2 * 60_000); // limite de fréquence : on attend, rien n'est perdu
          break;
        } else {
          this.outbox.shift(); // refus définitif (données invalides)
        }
        this.writeOutbox();
      }
    } catch { /* on reprendra plus tard */ }
    this.writeOutbox();
    this.draining = false;
    void this.syncPlayer(false);
  }
  private retryDrain(ms: number): void {
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => { this.drainTimer = null; void this.drain(); }, ms);
  }

  private async syncPlayer(force: boolean): Promise<void> {
    try {
      if (!this.playerDirty || !this.client.online) return;
      const uid = this.client.userId, t = this.now();
      if (!uid || (!force && t - this.playerSentT < PLAYER_EVERY_MS)) return;
      this.playerSentT = t;
      this.playerDirty = false;
      const row: Record<string, unknown> = { id: uid, pseudo: this.pseudo() };
      if (this.stats) {
        row.level = Math.min(999, Math.max(1, Math.floor(this.stats.level)));
        row.score = Math.max(0, Math.round(this.stats.score));
        row.deliveries = Math.max(0, Math.floor(this.stats.deliveries));
        row.distance_km = Math.max(0, Math.round(this.stats.distanceKm * 100) / 100);
      }
      if (this.region) row.region = this.region;
      const sent = await this.client.query<null>(db => db.from('players').upsert(row));
      if (!sent) this.playerDirty = true;
    } catch { this.playerDirty = true; }
  }

  private loadRegions(): Promise<void> {
    this.regionsLoading ??= (async () => {
      try {
        const data = await this.client.run<unknown[]>(db => db.from('regions').select('id,shelters,active_shelters,points,deliveries'));
        if (data) this.applyRegions(data);
      } catch { /* dernier état connu */ }
      this.regionsLoading = null;
    })();
    return this.regionsLoading;
  }
  private loadRegionsSoon(): void {
    this.regionsSoon ??= setTimeout(() => { this.regionsSoon = null; void this.loadRegions(); }, 1500);
  }
  private applyRegions(list: unknown[]): void {
    let changed = false;
    for (const v of list) {
      const p = regionRow(v);
      if (!p) continue;
      const old = this.regionMap.get(p.id)!;
      if (old.shelters !== p.shelters || old.activeShelters !== p.activeShelters || old.points !== p.points || old.deliveries !== p.deliveries) { this.regionMap.set(p.id, p); changed = true; }
    }
    if (!changed) return;
    this.write(K_REGIONS, JSON.stringify(this.regions()));
    this.emit(this.regionFns, this.regions());
  }

  /** Canal temps réel sur la table regions : ouvert une seule fois, il se reconnecte ensuite tout seul. */
  private listen(): void {
    if (this.channelMade) return;
    this.channelMade = true;
    void this.client.ensure().then(db => {
      if (!db) { this.channelMade = false; return; }
      db.channel('dernier-relais-regions')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'regions' }, (payload: { new?: unknown }) => {
          try { if (payload.new) this.applyRegions([payload.new]); } catch { /* message illisible */ }
        })
        .subscribe((status: string) => {
          // Tant que le canal n'est pas établi, la relecture périodique sert de filet de sécurité.
          this.live = status === 'SUBSCRIBED';
          if (this.live) void this.loadRegions();
        });
    }).catch(() => { this.channelMade = false; });
  }

  private emit<T>(fns: Set<(v: T) => void>, v: T): void {
    for (const fn of [...fns]) { try { fn(v); } catch { /* un abonné fautif ne casse pas les autres */ } }
  }

  private read(k: string): string | null { try { return this.kv?.getItem(k) ?? null; } catch { return null; } }
  private write(k: string, v: string): void { try { this.kv?.setItem(k, v); } catch { /* stockage plein ou indisponible */ } }
  private readOutbox(): Outgoing[] {
    try {
      return rows(JSON.parse(this.read(K_OUTBOX) ?? '[]')).filter(o => typeof o.shelterId === 'string' && isRegionId(o.region)).slice(-OUTBOX_MAX)
        .map(o => ({ shelterId: o.shelterId as string, name: text(o.name, 'Abri'), lng: num(o.lng), lat: num(o.lat), region: o.region as RegionId, points: num(o.points, 1), tries: 0 }));
    } catch { return []; }
  }
  private writeOutbox(): void { this.write(K_OUTBOX, JSON.stringify(this.outbox)); }
}

function defaultStorage(): KeyValue | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
