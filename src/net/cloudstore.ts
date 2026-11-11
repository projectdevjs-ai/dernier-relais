// Sauvegarde en ligne par-dessus la sauvegarde du téléphone.
//   lecture  : la plus récente des deux (champ savedAt) ;
//   écriture : locale tout de suite, puis envoi en ligne au plus une fois toutes les 20 s, ou à la demande (flush).
// La sauvegarde locale fait toujours foi : si le réseau échoue, rien n'est perdu et l'envoi sera retenté.
import { type GameSave, type GameStore, parseGameSave } from '../game/save';
import type { NetClient } from './client';

export interface CloudStoreOptions {
  /** Écart minimal entre deux envois en ligne (20 s par défaut). */
  everyMs?: number;
  /** Attente maximale de la sauvegarde en ligne au chargement, pour ne jamais retarder le lancement du jeu. */
  loadTimeoutMs?: number;
  now?: () => number;
  /** Appelé à chaque sauvegarde reçue du jeu (sert au réseau pour tenir la fiche du joueur à jour). */
  onSave?: (save: GameSave) => void;
}

interface SaveRow { data: unknown; saved_at: number | string | null }

export class CloudGameStore implements GameStore {
  private everyMs: number;
  private loadTimeoutMs: number;
  private now: () => number;
  private pending: GameSave | null = null;
  private lastPushT = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pushing: Promise<boolean> | null = null;
  /** savedAt de la sauvegarde en ligne connue ; null tant qu'on n'a pas pu la lire. */
  private cloudAt: number | null = null;

  constructor(private local: GameStore, private net: NetClient, private opts: CloudStoreOptions = {}) {
    this.everyMs = opts.everyMs ?? 20_000;
    this.loadTimeoutMs = opts.loadTimeoutMs ?? 3000;
    this.now = opts.now ?? (() => Date.now());
  }

  async load(): Promise<GameSave | null> {
    let local: GameSave | null = null;
    try { local = await this.local.load(); } catch { /* stockage indisponible */ }
    let cloud: GameSave | null = null;
    try {
      cloud = await Promise.race([
        this.fetchCloud(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), this.loadTimeoutMs)),
      ]);
    } catch { /* hors ligne : la sauvegarde locale suffit */ }
    if (cloud && (!local || cloud.savedAt > local.savedAt)) {
      try { await this.local.save(cloud); } catch { /* stockage indisponible */ }
      return cloud;
    }
    return local;
  }

  async save(s: GameSave): Promise<void> {
    // D'abord le téléphone : c'est lui qui garantit qu'aucune progression n'est perdue.
    try { await this.local.save(s); } catch { /* stockage plein ou indisponible */ }
    this.pending = s;
    try { this.opts.onSave?.(s); } catch { /* l'abonné ne doit pas gêner la sauvegarde */ }
    const wait = this.lastPushT + this.everyMs - this.now();
    if (wait <= 0) void this.push();
    else if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.push(); }, wait);
  }

  /** Envoie tout de suite la dernière sauvegarde en ligne (fermeture de la page). Renvoie vrai si elle est à jour en ligne. */
  async flush(): Promise<boolean> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pushing) await this.pushing;
    return this.push();
  }

  /** Vrai s'il reste une sauvegarde à envoyer en ligne. */
  get dirty(): boolean { return this.pending !== null; }

  private push(): Promise<boolean> {
    if (this.pushing) return this.pushing;
    this.pushing = this.pushOnce().catch(() => false).finally(() => { this.pushing = null; });
    return this.pushing;
  }

  private async pushOnce(): Promise<boolean> {
    const s = this.pending;
    if (!s) return true;
    this.lastPushT = this.now();
    const uid = this.net.online ? this.net.userId : (await this.net.ensure(), this.net.userId);
    if (!uid || !this.net.online) return false;
    // Ne jamais écraser une sauvegarde en ligne plus récente (lecture trop lente au lancement, autre appareil).
    if (this.cloudAt === null) {
      const row = await this.net.query<{ saved_at: number | string | null }>(db => db.from('saves').select('saved_at').eq('id', uid).maybeSingle());
      if (!row) return false;
      this.cloudAt = Number(row.data?.saved_at ?? 0) || 0;
    }
    if (this.cloudAt > s.savedAt) { if (this.pending === s) this.pending = null; return true; }
    const sent = await this.net.query<null>(db => db.from('saves').upsert({ id: uid, data: s, saved_at: Math.round(s.savedAt) }));
    if (!sent) return false;
    this.cloudAt = s.savedAt;
    if (this.pending === s) this.pending = null;
    return true;
  }

  private async fetchCloud(): Promise<GameSave | null> {
    const uid = (await this.net.ensure(), this.net.userId);
    if (!uid || !this.net.online) return null;
    const r = await this.net.query<SaveRow>(db => db.from('saves').select('data,saved_at').eq('id', uid).maybeSingle());
    if (!r) return null;
    const save = r.data ? parseGameSave(r.data.data) : null;
    this.cloudAt = save ? save.savedAt : 0;
    return save;
  }
}
