// Connexion au serveur du jeu : création paresseuse du client Supabase, connexion anonyme automatique,
// état « en ligne » observable. Toute panne (réseau coupé, connexion anonyme désactivée, tables absentes)
// fait passer en mode hors ligne, sans bruit, avec une nouvelle tentative de plus en plus espacée.
// Rien ici ne lève d'exception vers l'appelant.
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export type Db = SupabaseClient;
/** Réponse habituelle d'une requête Supabase. */
export interface DbResult<T> { data: T | null; error: unknown; count?: number | null }

export interface NetClientOptions {
  /** Fabrique du client (tests). Par défaut : le vrai client, chargé à la première utilisation. */
  create?: () => Db | Promise<Db>;
  now?: () => number;
  /** Première attente avant une nouvelle tentative (elle double à chaque échec). */
  retryMs?: number;
  retryMaxMs?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Vrai si l'erreur vient de l'infrastructure (réseau, session, schéma absent) et non de la requête elle-même. */
export function isOutage(error: unknown): boolean {
  if (!error) return false;
  if (typeof error !== 'object') return true;
  const e = error as Record<string, unknown>;
  const code = str(e.code), status = Number(e.status) || 0, msg = str(e.message).toLowerCase();
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883') return true; // table ou fonction absente
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501' || status === 401 || status === 403) return true; // session refusée
  if (status === 404 || status === 0 && !code) return true; // introuvable, ou aucune réponse du serveur
  if (status >= 500 || status === 429) return true;
  return /fetch|network|timeout|abort|load failed/.test(msg);
}

export class NetClient {
  private db: Db | null = null;
  private creating: Promise<Db | null> | null = null;
  private connecting: Promise<Db | null> | null = null;
  private uid: string | null = null;
  private up = false;
  private fails = 0;
  private retryAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private auto = false;
  private listeners = new Set<(online: boolean) => void>();
  private now: () => number;
  private retryMs: number;
  private retryMaxMs: number;

  constructor(private opts: NetClientOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.retryMs = opts.retryMs ?? 20_000;
    this.retryMaxMs = opts.retryMaxMs ?? 10 * 60_000;
  }

  /** Vrai quand le joueur est connecté et que le serveur du jeu répond. */
  get online(): boolean { return this.up; }
  /** Identifiant du joueur (compte anonyme), null tant qu'aucune connexion n'a réussi. */
  get userId(): string | null { return this.uid; }

  /** S'abonne aux changements d'état. Renvoie la fonction de désabonnement. */
  onOnline(fn: (online: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Lance la connexion et garde le lien en vie : nouvelles tentatives automatiques après une panne. */
  start(): void {
    if (this.auto) return;
    this.auto = true;
    try {
      if (typeof addEventListener === 'function') addEventListener('online', () => { this.retryAt = 0; void this.ensure(); });
    } catch { /* environnement sans fenêtre */ }
    void this.ensure();
  }
  /** Arrête les nouvelles tentatives automatiques (tests, démo). */
  stop(): void {
    this.auto = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Le client prêt à servir, ou null si le jeu est hors ligne (aucune attente inutile entre deux tentatives). */
  async ensure(): Promise<Db | null> {
    if (this.up && this.db) return this.db;
    if (this.connecting) return this.connecting;
    if (this.now() < this.retryAt) return null;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /**
   * Exécute une requête. Renvoie ses données, ou null si le jeu est hors ligne ou si la requête échoue.
   * Une panne d'infrastructure fait basculer hors ligne ; une erreur de la requête elle-même, non.
   */
  async run<T>(fn: (db: Db) => PromiseLike<DbResult<T>>): Promise<T | null> {
    const r = await this.query(fn);
    return r ? r.data : null;
  }
  /** Comme run(), mais renvoie aussi le décompte (`count`) quand la requête en demande un. */
  async query<T>(fn: (db: Db) => PromiseLike<DbResult<T>>): Promise<DbResult<T> | null> {
    try {
      const db = await this.ensure();
      if (!db) return null;
      const r = await fn(db);
      if (r.error) { if (isOutage(r.error)) this.fail(); return null; }
      return r;
    } catch {
      this.fail();
      return null;
    }
  }

  /** Signale une panne constatée ailleurs (canal temps réel fermé, par exemple). */
  fail(): void {
    this.fails++;
    const wait = Math.min(this.retryMaxMs, this.retryMs * 2 ** Math.min(10, this.fails - 1));
    this.retryAt = this.now() + wait;
    this.set(false);
    if (this.auto) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = null; this.retryAt = 0; void this.ensure(); }, wait);
    }
  }

  private set(up: boolean): void {
    if (this.up === up) return;
    this.up = up;
    for (const fn of [...this.listeners]) { try { fn(up); } catch { /* un abonné fautif ne casse pas les autres */ } }
  }

  private async create(): Promise<Db | null> {
    if (this.db) return this.db;
    this.creating ??= (async () => {
      try {
        if (this.opts.create) return await this.opts.create();
        const { createClient } = await import('@supabase/supabase-js');
        return createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'dernier-relais/session' },
          realtime: { params: { eventsPerSecond: 2 } },
        });
      } catch { return null; }
    })();
    this.db = await this.creating;
    this.creating = null;
    return this.db;
  }

  private async connect(): Promise<Db | null> {
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.fail(); return null; }
      const db = await this.create();
      if (!db) { this.fail(); return null; }
      // 1. Session : celle du téléphone si elle existe, sinon un nouveau compte anonyme.
      const got = await db.auth.getSession();
      let user = got.data.session?.user ?? null;
      if (!user) {
        const made = await db.auth.signInAnonymously();
        if (made.error || !made.data.user) { this.fail(); return null; }
        user = made.data.user;
      }
      // 2. Le schéma du jeu est-il en place ? (une seule petite lecture)
      const probe = await db.from('regions').select('id').limit(1);
      if (probe.error) {
        // Session refusée (compte supprimé côté serveur) : on l'oublie, la prochaine tentative en créera une neuve.
        const code = str((probe.error as { code?: unknown }).code);
        if (probe.status === 401 || code === 'PGRST301' || code === 'PGRST303') { try { await db.auth.signOut({ scope: 'local' }); } catch { /* tant pis */ } }
        this.fail();
        return null;
      }
      this.uid = user.id;
      this.fails = 0;
      this.retryAt = 0;
      this.set(true);
      return db;
    } catch {
      this.fail();
      return null;
    }
  }
}
