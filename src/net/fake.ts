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
