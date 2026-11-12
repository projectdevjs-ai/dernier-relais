// Simulation d'un joueur, sans navigateur : vraies tuiles, vrai moteur, joueur qui marche à 1,3 m/s.
// Usage : tsx scripts/simulate.ts [--json fichier] [--lieu N]
// Limites connues : marche en ligne droite (à pied par les rues, compter environ 1,3 fois plus long),
// ciel clair et de jour (pas de bonus pluie ou nuit), pas de réseau (ni relais ni colis d'autres joueurs).
import { writeFileSync } from 'node:fs';
import { type Cell, type LngLat, cellAt, cellsAround, dataTileOf, dist } from '../src/core/geo';
import type { GameEvent, GameView, Grade } from '../src/game/api';
import { Game } from '../src/game/game';
import { MemoryGameStore } from '../src/game/save';
import { dayKey } from '../src/game/time';
import { Story } from '../src/story/story';
import { generateCell } from '../src/world/cells';
import { loadTile } from '../src/world/tiles';
import type { CellContent } from '../src/world/types';

export const PLACES: [string, number, number][] = [
  ['Bouguenais', 47.1822, -1.5761],
  ['Paris Châtelet', 48.8583, 2.3470],
  ['Lille Grand-Place', 50.6366, 3.0635],
  ['Marseille Vieux-Port', 43.2951, 5.3744],
  ['Les Essarts-le-Roi', 48.7167, 1.8930],
  ['Saint-Véran (montagne)', 44.7003, 6.8690],
  ['Locronan (village)', 48.0990, -4.2080],
  ['Beauce (campagne)', 48.2400, 1.6000],
  ['Landes (forêt)', 44.1300, -0.7000],
  ['Pornic (littoral)', 47.1150, -2.1030],
];
const WALK = 1.3;
/** Mercredi 11 novembre 2026, 10 h en temps universel. */
const T0 = Date.UTC(2026, 10, 11, 10, 0, 0);
const SKILL_ORDER = ['sac', 'scan-portee', 'foulee', 'carnet', 'scan-recharge', 'sac', 'calage', 'scan-portee', 'souffle', 'carnet'];

/** Le monde autour du joueur, comme src/world/world.ts mais avec le jour de l'horloge simulée. */
class SimWorld {
  private cells = new Map<string, CellContent>();
  private day = '';
  private here = '';
  async moveTo(p: LngLat, day: string): Promise<CellContent[] | null> {
    const c = cellAt(p[0], p[1]);
    if (c.id === this.here && day === this.day) return null;
    if (day !== this.day) { this.day = day; this.cells.clear(); }
    this.here = c.id;
    await Promise.all(cellsAround(c, 2).map(async (k: Cell) => {
      if (this.cells.has(k.id)) return;
      const t = dataTileOf(k);
      this.cells.set(k.id, generateCell(k, await loadTile(t.z, t.x, t.y), day));
    }));
    const keep = new Set(cellsAround(c, 4).map(k => k.id));
    for (const id of this.cells.keys()) if (!keep.has(id)) this.cells.delete(id);
    return [...this.cells.values()];
  }
}

class MemStorage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

export interface Stats {
  minutes: number;
  firstPickupS: number | null; firstDeliveryS: number | null;
  deliveries: number; deliveries5: number; deliveries30: number;
  /** Distances colis → abri des livraisons, en mètres. */
  legs: number[];
  grades: Record<Grade, number>;
  score: number; level: number; skillPoints: number; starsGained: number; starsGained30: number; sheltersLinked: number; maxStars: number;
  contractsDone: number; contractsClaimed: number;
  /** Épisodes « rien à faire » : 3 scans de suite sans rien, sac vide, rien de révélé. */
  idle: number; idleS: number;
  /** Colis ramassés dont la destination est à plus de 1,2 km. */
  farDest: number; maxLeg: number;
  /** Colis portés dont l'abri n'est plus dans les cases chargées. */
  lostDest: number;
  caches: number; wanderers: number; fronts: number; jams: number; jamsWon: number; specials: number; lost: number; dangers: number;
  km: number; story: string;
  firstTimed: boolean | null; firstFragile: boolean | null;
}
const emptyStats = (): Stats => ({
  minutes: 0, firstPickupS: null, firstDeliveryS: null, deliveries: 0, deliveries5: 0, deliveries30: 0, legs: [],
  grades: { E: 0, D: 0, C: 0, B: 0, A: 0, S: 0 }, score: 0, level: 1, skillPoints: 0, starsGained: 0, starsGained30: 0, sheltersLinked: 0, maxStars: 0,
  contractsDone: 0, contractsClaimed: 0, idle: 0, idleS: 0, farDest: 0, maxLeg: 0, lostDest: 0,
  caches: 0, wanderers: 0, fronts: 0, jams: 0, jamsWon: 0, specials: 0, lost: 0, dangers: 0, km: 0, story: '', firstTimed: null, firstFragile: null,
});

interface Run { store: MemoryGameStore; storage: MemStorage; stats: Stats; elapsedS: number; skillsLearnt: number }

/** Une session de jeu : le joueur part de `home` à l'instant `t0` et joue `minutes` minutes. */
async function session(run: Run, home: LngLat, t0: number, minutes: number): Promise<void> {
  const clock = { t: t0 }, st = run.stats;
  const game = new Game({ store: run.store, now: () => clock.t });
  const story = new Story({ storage: run.storage as unknown as Storage, now: () => clock.t });
  const world = new SimWorld();
  const base = run.elapsedS;
  const at = (): number => base + (clock.t - t0) / 1000;
  /** Distance colis → abri de chaque colis ramassé, pour la moyenne des livraisons. */
  const legOf = new Map<string, number>();
  game.on((e: GameEvent) => {
    story.handle(e);
    switch (e.type) {
      case 'pickup':
        st.firstPickupS ??= at();
        if (st.firstTimed === null) { st.firstTimed = e.order.minutesLeft !== null; st.firstFragile = e.order.fragile; }
        { const d = dist(e.order.at, e.order.destAt); legOf.set(e.order.id, d); if (d > 1200) st.farDest++; st.maxLeg = Math.max(st.maxLeg, Math.round(d)); }
        if (e.order.lost) st.lost++;
        if (e.order.special) st.specials++;
        break;
      case 'delivery': {
        const r = e.result;
        st.firstDeliveryS ??= at();
        st.deliveries++; st.grades[r.grade]++;
        st.legs.push(Math.round(legOf.get(r.orderId) ?? 0));
        if (at() <= 300) st.deliveries5++;
        if (at() <= 1800) st.deliveries30++;
        st.starsGained += r.starsAfter - r.starsBefore;
        if (at() <= 1800) st.starsGained30 += r.starsAfter - r.starsBefore;
        break;
      }
      case 'contract': st.contractsDone++; break;
      case 'cache': st.caches++; break;
      case 'wanderer': st.wanderers++; break;
      case 'front': if (e.phase === 'entrée') st.fronts++; break;
      case 'jam': if (e.phase === 'début') st.jams++; else if (e.phase === 'réussi') st.jamsWon++;
        if (process.env.SIM_DEBUG) console.log('  lot', e.phase, Math.round(at()), 's', e.jam.minutes, 'min', e.jam.delivered, '/', e.jam.count);
        break;
      case 'danger': if (e.entered) st.dangers++; break;
      default: break;
    }
  });
  await game.load();
  let pos: LngLat = [home[0], home[1]];
  const place = async (): Promise<void> => {
    const cells = await world.moveTo(pos, dayKey(clock.t));
    game.setPosition({ lng: pos[0], lat: pos[1], acc: 5, source: 'gps' });
    if (cells) game.setWorld(cells);
  };
  await place();
  let emptyScans = 0, idleNow = false, explore: LngLat | null = null;
  const lostSeen = new Set<string>();
  for (let s = 0; s < minutes * 60; s++) {
    let v: GameView = game.view();
    // Gestes immédiats.
    for (const c of v.contracts) if (c.done && !c.claimed && game.claim(c.id).ok) st.contractsClaimed++;
    while (v.player.skillPoints > 0 && run.skillsLearnt < SKILL_ORDER.length) {
      if (!game.learn(SKILL_ORDER[run.skillsLearnt]).ok) break;
      run.skillsLearnt++; v = game.view();
    }
    if (Math.abs(v.player.balance) > 0.5) game.steady();
    for (const c of v.caches ?? []) if (c.inRange) game.openCache(c.id);
    for (const w of v.wanderers ?? []) if (w.inRange && !w.met) game.talk(w.id);
    for (const sh of v.shelters) if (sh.inRange && sh.deliverable.length) { const ids = [...sh.deliverable]; if (game.deliver(sh.id).ok) for (const id of ids) game.proof(id); }
    for (const j of v.jams ?? []) if (j.state === 'proposé' && j.inRange && v.player.carriedKg + 15 <= v.player.capacityKg) game.startJam(j.id);
    v = game.view();
    for (const o of v.orders) {
      if (o.state !== 'révélé' || !o.inRange) continue;
      if (o.canInspect) game.inspect(o.id);
      if (game.pickup(o.id).ok) game.strap(o.id, 0.8);
    }
    if (v.scanner.ready) {
      const before = v.orders.length + (v.caches?.length ?? 0);
      game.scan();
      v = game.view();
      emptyScans = v.orders.length + (v.caches?.length ?? 0) > before ? 0 : emptyScans + 1;
    } else v = game.view();

    // Où aller ?
    const carried = v.orders.filter(o => o.state === 'porté');
    const free = v.player.capacityKg - v.player.carriedKg;
    const revealed = v.orders.filter(o => o.state === 'révélé' && o.weightKg <= free);
    const known = new Set(v.shelters.map(x => x.id));
    for (const o of carried) if (!known.has(o.destId) && !lostSeen.has(o.id)) { lostSeen.add(o.id); st.lostDest++; }
    let target: LngLat | null = null;
    const cache = v.caches?.[0];
    // Une cache repérée à moins de 200 m vaut le détour.
    if (cache && cache.distanceM < 200) target = cache.at;
    else if (carried.length) {
      const near = revealed[0];
      // Tournée : un colis proche se prend au passage tant que le sac n'a pas 3 colis.
      target = near && carried.length < 3 && near.distanceM < 150 ? near.at : carried[0].destAt;
    } else if (revealed.length) target = revealed[0].at;
    else if (v.caches?.length) target = v.caches[0].at;
    if (target) { idleNow = false; explore = null; emptyScans = 0; }
    else {
      if (emptyScans >= 3 && !idleNow) { idleNow = true; st.idle++; }
      if (idleNow) st.idleS++;
      // Rien en vue : le joueur marche vers l'abri non relié le plus proche, sinon tout droit vers le nord-est.
      if (!explore || dist(explore, pos) < 20) {
        const sh = v.shelters.find(x => x.stars === 0 && x.distanceM > 45) ?? v.shelters.find(x => x.distanceM > 200);
        explore = sh ? sh.at : [pos[0] + 0.004, pos[1] + 0.003];
      }
      target = explore;
    }
    // Un pas d'une seconde.
    const d = dist(pos, target);
    if (d > 0.5) { const k = Math.min(1, WALK / d); pos = [pos[0] + (target[0] - pos[0]) * k, pos[1] + (target[1] - pos[1]) * k]; }
    clock.t += 1000;
    await place();
    game.tick(1);
    if (s % 5 === 0) story.observe(game.view());
  }
  const v = game.view();
  story.observe(v);
  await game.flush();
  run.elapsedS += minutes * 60;
  st.minutes += minutes;
  st.score = v.player.score; st.level = v.player.level; st.km = v.player.distanceKm;
  st.skillPoints = v.player.level - 1;
  const snap = game.snapshot();
  const stars = Object.values(snap.shelters).filter(x => x.deliveries > 0);
  st.sheltersLinked = stars.length;
  st.maxStars = Math.max(0, ...v.shelters.map(x => x.stars));
  const ss = story.state();
  st.story = ss.finished ? 'terminée' : `ch.${ss.chapter} ét.${ss.step}/${ss.stepCount} (${ss.stepId})`;
}

function newRun(): Run { return { store: new MemoryGameStore(), storage: new MemStorage(), stats: emptyStats(), elapsedS: 0, skillsLearnt: 0 }; }
const mmss = (s: number | null): string => (s === null ? '  —  ' : `${String(Math.floor(s / 60)).padStart(2)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const gr = (g: Record<Grade, number>): string => (['S', 'A', 'B', 'C', 'D', 'E'] as Grade[]).filter(k => g[k]).map(k => `${k}${g[k]}`).join(' ') || '—';

const mean = (a: number[]): number => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const only = args.includes('--lieu') ? Number(args[args.indexOf('--lieu') + 1]) : null;
  const out: Record<string, { heure: Stats; semaine: Stats }> = {};
  console.log('SESSION DE 60 MINUTES (joueur neuf)');
  console.log('lieu                     1er colis  1re livr.  livr/5min livr/30min livr/h  étoiles30  dist.moy/max   notes            points niv  contrats  rien-à-faire  >1,2km  abri-perdu  histoire');
  const weeks: string[] = [];
  for (let i = 0; i < PLACES.length; i++) {
    if (only !== null && only !== i) continue;
    const [name, lat, lng] = PLACES[i], home: LngLat = [lng, lat];
    const hour = newRun();
    await session(hour, home, T0, 60);
    const h = hour.stats;
    console.log(`${name.padEnd(24)} ${mmss(h.firstPickupS)}      ${mmss(h.firstDeliveryS)}      ${String(h.deliveries5).padStart(2)}        ${String(h.deliveries30).padStart(2)}        ${String(h.deliveries).padStart(2)}      ${String(h.starsGained30).padStart(2)}       ${String(mean(h.legs)).padStart(4)}/${String(h.maxLeg).padStart(4)} m  ${gr(h.grades).padEnd(16)} ${String(h.score).padStart(5)}  ${String(h.level).padStart(2)}  ${h.contractsDone}/${h.contractsClaimed}       ${String(h.idle).padStart(2)} (${String(h.idleS).padStart(4)} s)  ${String(h.farDest).padStart(3)}     ${String(h.lostDest).padStart(3)}        ${h.story}  1re:${h.firstTimed ? 'délai ' : ''}${h.firstFragile ? 'fragile' : ''}`);
    const week = newRun();
    for (let d = 0; d < 7; d++) await session(week, home, T0 + d * 86400_000 + 6 * 3600_000, 30);
    const w = week.stats;
    weeks.push(`${name.padEnd(24)} ${String(w.deliveries).padStart(3)}     ${(w.deliveries / 7).toFixed(1).padStart(4)}       ${String(w.starsGained).padStart(2)}       ${String(w.sheltersLinked).padStart(2)}     ${w.maxStars}      ${gr(w.grades).padEnd(18)} ${String(w.score).padStart(6)}  ${String(w.level).padStart(2)}   ${String(w.contractsDone).padStart(2)}/${String(w.contractsClaimed).padStart(2)}     ${String(w.idle).padStart(2)} (${String(w.idleS).padStart(4)} s)  ${String(w.farDest).padStart(3)}   ${w.km.toFixed(1).padStart(5)}  c${w.caches} r${w.wanderers} f${w.fronts} l${w.jams}/${w.jamsWon} s${w.specials} p${w.lost} d${w.dangers}   ${w.story}`);
    out[name] = { heure: h, semaine: w };
  }
  console.log('\nSEMAINE : 7 SESSIONS DE 30 MINUTES (même joueur, un jour après l’autre)');
  console.log('lieu                     livr.  /session  étoiles  abris  max★  notes              points  niv  contrats  rien-à-faire  >1,2km   km    spéciaux (caches rôdeurs fronts lots/réussis spéciaux perdus dangers)   histoire');
  for (const l of weeks) console.log(l);
  if (json) writeFileSync(json, JSON.stringify(out, null, 1));
}
await main();
