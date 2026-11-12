// Faux serveur en mémoire, pour les tests et la démo : il imite juste ce que src/net utilise de Supabase
// (session anonyme, lecture/écriture de tables, appels de fonctions) et sait simuler les pannes.
import type { Db } from './client';

type Row = Record<string, unknown>;
interface Result { data: unknown; error: unknown; count?: number | null; status?: number }

export class FakeServer {
  /** Réseau coupé : toute requête échoue comme un fetch impossible. */
  down = false;
  /** Tables absentes : le schéma n'a pas encore été appliqué. */
  schema = true;
  /** Connexion anonyme activée sur le projet. */
  anonymous = true;
  userId = 'u-1';
  session = false;
  tables: Record<string, Row[]> = { regions: [], players: [], saves: [], shelters: [], relays: [], relay_rewards: [] };
  /** Fonctions SQL simulées. */
  rpcs: Record<string, (args: Row) => unknown> = {};
  /** Journal des appels reçus : « select saves », « upsert saves », « rpc deliver_to_shelter »… */
  calls: string[] = [];

  count(prefix: string): number { return this.calls.filter(c => c.startsWith(prefix)).length; }

  private gate(what: string): Result | null {
    this.calls.push(what);
    if (this.down) throw new TypeError('fetch failed');
    if (!this.schema) return { data: null, error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' }, status: 404 };
    return null;
  }

  /** Le faux client, à donner à NetClient ({ create: () => server.db() }). */
  db(): Db {
    const self = this;
    const from = (table: string) => {
      let op: 'select' | 'upsert' = 'select', payload: Row | null = null, single = false, head = false, max = Infinity;
      const filters: ((r: Row) => boolean)[] = [];
      let sort: { col: string; asc: boolean } | null = null;
      const run = async (): Promise<Result> => {
        const blocked = self.gate(`${op} ${table}`);
        if (blocked) return blocked;
        const list = (self.tables[table] ??= []);
        if (op === 'upsert' && payload) {
          const i = list.findIndex(r => r.id === payload!.id);
          if (i >= 0) list[i] = { ...list[i], ...payload }; else list.push({ ...payload });
          return { data: null, error: null, status: 201 };
        }
        let out = list.filter(r => filters.every(f => f(r)));
        if (sort) { const { col, asc } = sort; out = [...out].sort((a, b) => (Number(a[col]) - Number(b[col]) || String(a[col]).localeCompare(String(b[col]))) * (asc ? 1 : -1)); }
        const count = out.length;
        out = out.slice(0, max);
        if (head) return { data: null, error: null, count, status: 200 };
        return { data: single ? out[0] ?? null : out, error: null, count, status: 200 };
      };
      const b = {
        select(_cols?: string, o?: { head?: boolean }) { head = o?.head === true; return b; },
        upsert(row: Row) { op = 'upsert'; payload = row; return b; },
        eq(col: string, v: unknown) { filters.push(r => r[col] === v); return b; },
        in(col: string, vs: unknown[]) { filters.push(r => vs.includes(r[col])); return b; },
        is(col: string, v: unknown) { filters.push(r => (r[col] ?? null) === v); return b; },
        order(col: string, o?: { ascending?: boolean }) { sort = { col, asc: o?.ascending !== false }; return b; },
        limit(n: number) { max = n; return b; },
        maybeSingle() { single = true; return b; },
        then<A, B>(ok: (r: Result) => A, ko?: (e: unknown) => B) { return run().then(ok, ko); },
      };
      return b;
    };
    const channel = { on() { return channel; }, subscribe(fn?: (s: string) => void) { fn?.('SUBSCRIBED'); return channel; } };
    const fake = {
      auth: {
        async getSession() {
          if (self.down) throw new TypeError('fetch failed');
          return { data: { session: self.session ? { user: { id: self.userId } } : null }, error: null };
        },
        async signInAnonymously() {
          self.calls.push('signin');
          if (self.down) throw new TypeError('fetch failed');
          if (!self.anonymous) return { data: { user: null, session: null }, error: { status: 422, code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' } };
          self.session = true;
          return { data: { user: { id: self.userId }, session: {} }, error: null };
        },
        async signOut() { self.session = false; return { error: null }; },
      },
      from,
      rpc(name: string, args: Row = {}) {
        return {
          then<A, B>(ok: (r: Result) => A, ko?: (e: unknown) => B) {
            return (async (): Promise<Result> => {
              const blocked = self.gate(`rpc ${name}`);
              if (blocked) return blocked;
              const fn = self.rpcs[name];
              if (!fn) return { data: null, error: { code: 'PGRST202', message: 'function not found' }, status: 404 };
              return { data: fn(args), error: null, status: 200 };
            })().then(ok, ko);
          },
        };
      },
      channel() { return channel; },
    };
    return fake as unknown as Db;
  }
}

/**
 * Imite en mémoire les fonctions SQL du jeu (abris collectifs et chaîne de relais), avec les mêmes réponses que
 * supabase/schema.sql, sans les limites de fréquence. Plusieurs faux serveurs peuvent partager les mêmes `tables`
 * (un par joueur, chacun avec son `userId`) pour jouer une chaîne à plusieurs.
 */
export function installGameRpcs(server: FakeServer, opts: { thresholds?: readonly number[]; now?: () => number } = {}): void {
  const th = opts.thresholds ?? [600, 3000, 10000, 25000, 60000], now = opts.now ?? (() => Date.now());
  const level = (pts: number): number => th.filter(x => pts >= x).length;
  const T = server.tables;
  const list = (name: string): Row[] => (T[name] ??= []);
  let seq = 0;
  const stamp = (): string => new Date(now() + seq++).toISOString();
  server.rpcs.deliver_to_shelter = a => {
    const pts = Number(a.p_points) || 0;
    if (!(pts > 0) || typeof a.p_shelter_id !== 'string') return { ok: false, reason: 'invalid' };
    let sh = list('shelters').find(r => r.id === a.p_shelter_id);
    if (!sh) { sh = { id: a.p_shelter_id, name: a.p_name, region: a.p_region, points: 0, level: 0, deliveries: 0 }; list('shelters').push(sh); }
    const before = Number(sh.level) || 0;
    sh.points = (Number(sh.points) || 0) + pts; sh.deliveries = (Number(sh.deliveries) || 0) + 1; sh.level = level(Number(sh.points));
    return { ok: true, level: sh.level, level_before: before, points: sh.points };
  };
  server.rpcs.relay_drop = a => {
    const uid = server.userId, at = a.p_at_shelter;
    if (typeof at !== 'string' || !at) return { ok: false, reason: 'invalid' };
    if (typeof a.p_relay_id === 'string') {
      const r = list('relays').find(x => x.id === a.p_relay_id && x.state === 'carried' && x.carrier === uid && x.dest_shelter !== at);
      if (!r) return { ok: false, reason: 'not_carrier' };
      Object.assign(r, { state: 'waiting', at_shelter: at, last_shelter: at, carrier: null });
      return { ok: true, id: r.id };
    }
    if (typeof a.p_dest_shelter !== 'string' || a.p_dest_shelter === at || !a.p_payload || typeof a.p_payload !== 'object') return { ok: false, reason: 'invalid' };
    const id = `relais-${list('relays').length + 1}`;
    list('relays').push({ id, payload: a.p_payload, dest_shelter: a.p_dest_shelter, at_shelter: at, last_shelter: at, carrier: null, carriers: [uid], state: 'waiting', created_at: stamp() });
    return { ok: true, id };
  };
  server.rpcs.relay_take = a => {
    const uid = server.userId;
    if (list('relays').filter(x => x.carrier === uid && x.state === 'carried').length >= 3) return { ok: false, reason: 'limit' };
    const r = list('relays').find(x => x.id === a.p_relay_id && x.state === 'waiting');
    if (!r) return { ok: false, reason: 'taken' };
    const carriers = r.carriers as string[];
    Object.assign(r, { state: 'carried', carrier: uid, at_shelter: null, carriers: carriers.includes(uid) ? carriers : [...carriers, uid] });
    return { ok: true, relay: { ...r } };
  };
  server.rpcs.relay_deliver = a => {
    const uid = server.userId, pts = Math.min(400, Math.max(1, Math.round(Number(a.p_points) || 1)));
    const r = list('relays').find(x => x.id === a.p_relay_id && x.state === 'carried' && x.carrier === uid);
    if (!r) return { ok: false, reason: 'not_carrier' };
    Object.assign(r, { state: 'delivered', carrier: null, at_shelter: null });
    const carriers = [...new Set(r.carriers as string[])];
    for (const player of carriers) {
      list('relay_rewards').push({ id: list('relay_rewards').length + 1, relay_id: r.id, player, points: pts, hops: carriers.length, parcel: String((r.payload as Row).name ?? ''), created_at: stamp(), claimed_at: null });
    }
    return { ok: true, points: pts, hops: carriers.length };
  };
  server.rpcs.relay_claim_rewards = () => {
    let points = 0, count = 0;
    for (const w of list('relay_rewards')) if (w.player === server.userId && (w.claimed_at ?? null) === null) { w.claimed_at = stamp(); points += Number(w.points) || 0; count++; }
    return { ok: true, points, count };
  };
}
