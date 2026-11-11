// Le moteur de jeu. Aucun accès à l'écran ni au réseau : il reçoit le monde, la météo et la position,
// et produit un GameView. Les règles sont dans les petits modules voisins (fonctions pures).
import { type LngLat, cellAt, dist } from '../core/geo';
import type { Fix } from '../player/gps';
import type { CellContent, Shelter } from '../world/types';
import {
  type ActionResult, type ContractView, type DangerView, type DeliveryResult, type GameEngine, type GameEvent, type GameView,
  type OrderView, RANGE, type ShelterView, type SkillView, type Weather,
} from './api';
import { driftBalance, isUnbalanced, nextStamina, wearPerSecond } from './carry';
import { type ContractState, type ProgressEvent, advance, contractView, drawContracts, isDone } from './contracts';
import { type Danger, dangersFor, insideDanger } from './dangers';
import { gradeDelivery, isWet } from './grade';
import { HIDDEN_LINE, type Situation, npcLine } from './npc';
import { type Order, elapsedMin, makeOrder, minutesLeft, orderName, orderReward } from './orders';
import { addXp } from './progress';
import { BALANCE, DAMAGED, SAVE_EVERY_MS, SHELTER_PERK, SPEED, XP, xpNeeded } from './rules';
import { type GameSave, type GameStore, type OrderSave, type ShelterSave, emptyGameSave } from './save';
import { nextStarAt, nextUnlock, npcFor, starsFor, unlockText } from './shelters';
import { type Mods, learnBlock, modsFor, skillDef, skillViews } from './skills';
import { dayKey, nextDayMs, weekKey } from './time';

const no = (why: string): ActionResult => ({ ok: false, why });
const OK: ActionResult = { ok: true };
const CLEAR: Weather = { kind: 'clair', windKmh: 0, tempC: 15, night: false, sunAltDeg: 45 };
/** Durée pendant laquelle le PNJ commente la dernière livraison. */
const OUTCOME_MS = 120000;

function bearing(a: LngLat, b: LngLat): number {
  const k = Math.PI / 180, dL = (b[0] - a[0]) * k;
  const y = Math.sin(dL) * Math.cos(b[1] * k);
  const x = Math.cos(a[1] * k) * Math.sin(b[1] * k) - Math.sin(a[1] * k) * Math.cos(b[1] * k) * Math.cos(dL);
  return ((Math.atan2(y, x) / k) + 360) % 360;
}

export class Game implements GameEngine {
  private store: GameStore;
  private now: () => number;
  private listeners = new Set<(e: GameEvent) => void>();

  // Joueur
  private pos: LngLat | null = null;
  private mode: 'gps' | 'simulé' = 'simulé';
  private heading = 0;
  private speed = 0;
  private anchor: LngLat | null = null;
  private anchorT = 0;
  private lastMoveT = 0;
  private level = 1;
  private xp = 0;
  private skillPoints = 0;
  private score = 0;
  private deliveries = 0;
  private distanceM = 0;
  private stamina = 1;
  private balance = 0;
  private walkS = 0;
  private unbalancedS = 0;
  private ranks: Record<string, number> = {};
  private mods: Mods = modsFor({});

  // Monde
  private cells: CellContent[] = [];
  private loadedCells: string[] = [];
  private shelters: Shelter[] = [];
  private shelterById = new Map<string, Shelter>();
  private shelterSave = new Map<string, ShelterSave>();
  private discovered = new Set<string>();
  private outcomes = new Map<string, { situation: Situation; until: number }>();
  private orders = new Map<string, Order>();
  private done = new Set<string>();
  private lateWarned = new Set<string>();
  private dangers: Danger[] = [];
  private inDanger = false;
  private nearShelter: string | null = null;
  private visited = new Set<string>();
  private visitedList: string[] = [];
  private weather: Weather = CLEAR;
  private cooldownLeft = 0;

  // Temps, contrats, sauvegarde
  private day: string;
  private nextDay: number;
  private contracts: ContractState[] = [];
  private skillsCache: SkillView[] | null = null;
  private contractsCache: ContractView[] | null = null;
  private dirty = false;
  private lastSaveT = -Infinity;
  private saving: Promise<void> = Promise.resolve();

  constructor(opts: { store: GameStore; now?: () => number }) {
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
    const t = this.now();
    this.day = dayKey(t);
    this.nextDay = nextDayMs(t);
    this.contracts = this.drawAll(t, []);
  }

  // ───────────────────────── chargement et sauvegarde

  async load(): Promise<void> {
    let s: GameSave | null = null;
    try { s = await this.store.load(); } catch { /* stockage indisponible : partie neuve */ }
    const t = this.now();
    this.day = dayKey(t);
    this.nextDay = nextDayMs(t);
    const save = s ?? emptyGameSave(this.day);
    this.level = save.level; this.xp = save.xp; this.skillPoints = save.skillPoints;
    this.score = save.score; this.deliveries = save.deliveries; this.distanceM = save.distanceM; this.stamina = save.stamina;
    this.ranks = { ...save.skills };
    this.mods = modsFor(this.ranks);
    this.shelterSave = new Map(Object.entries(save.shelters).map(([k, v]) => [k, { ...v }]));
    this.discovered = new Set(save.discovered);
    this.visited = new Set(save.visited);
    this.visitedList = [...this.visited];
    const sameDay = save.day === this.day;
    this.orders.clear();
    // Un colis porté reste dans le sac d'un jour à l'autre ; les colis seulement révélés ne valent que pour leur jour.
    for (const o of save.orders) if (sameDay || o.state === 'porté') this.orders.set(o.id, { ...o });
    this.done = new Set(sameDay ? save.done : []);
    this.contracts = this.drawAll(t, save.contracts);
    this.skillsCache = this.contractsCache = null;
    this.lastSaveT = t;
    this.dirty = false;
    if (this.cells.length) this.setWorld(this.cells);
  }

  /** État complet à sauvegarder. */
  snapshot(): GameSave {
    const orders: OrderSave[] = [];
    for (const o of this.orders.values()) if (o.state !== 'caché') orders.push({ ...o, state: o.state });
    return {
      version: 1, savedAt: this.now(), level: this.level, xp: this.xp, skillPoints: this.skillPoints, score: this.score,
      deliveries: this.deliveries, distanceM: this.distanceM, stamina: this.stamina, skills: { ...this.ranks },
      shelters: Object.fromEntries(this.shelterSave), discovered: [...this.discovered], visited: [...this.visitedList],
      day: this.day, orders, done: [...this.done],
      contracts: this.contracts.map(c => ({ id: c.id, progress: c.progress, claimed: c.claimed })),
      last: this.pos,
    };
  }

  /** Écrit la sauvegarde tout de suite et attend la fin de l'écriture (fermeture de la page, tests). */
  flush(): Promise<void> { this.saveNow(); return this.saving; }

  private saveNow(): void {
    this.dirty = false;
    this.lastSaveT = this.now();
    const snap = this.snapshot();
    this.saving = this.saving.then(() => this.store.save(snap)).catch(() => { /* la partie continue sans sauvegarde */ });
  }
  /** Sauvegarde automatique : au plus une écriture toutes les 2 s. */
  private autosave(): void { if (this.dirty && this.now() - this.lastSaveT >= SAVE_EVERY_MS) this.saveNow(); }

  private drawAll(t: number, saved: { id: string; progress: number; claimed: boolean }[]): ContractState[] {
    const old = new Map(saved.map(c => [c.id, c]));
    return [...drawContracts('jour', dayKey(t)), ...drawContracts('semaine', weekKey(t))].map(d => {
      const o = old.get(d.id);
      return { ...d, progress: o ? Math.min(d.goal, o.progress) : 0, claimed: o ? o.claimed : false };
    });
  }

  // ───────────────────────── entrées

  setWorld(cells: CellContent[]): void {
    this.cells = cells;
    this.loadedCells = cells.map(c => c.id);
    this.shelters = cells.flatMap(c => c.shelters);
    this.shelterById = new Map(this.shelters.map(s => [s.id, s]));
    // Les colis non scannés sont recalculés à chaque fois ; les colis connus du joueur ne bougent plus.
    for (const [id, o] of this.orders) if (o.state === 'caché') this.orders.delete(id);
    for (const c of cells) for (const spot of c.parcels) {
      if (this.orders.has(spot.id) || this.done.has(spot.id)) continue;
      const o = makeOrder(spot, this.shelters);
      if (o) this.orders.set(o.id, o);
    }
    this.dangers = dangersFor(cells, this.day);
    this.refreshPlace();
  }

  setWeather(w: Weather): void { this.weather = w; }

  setPosition(fix: Fix): void {
    if (!Number.isFinite(fix.lng) || !Number.isFinite(fix.lat)) return;
    const t = this.now(), p: LngLat = [fix.lng, fix.lat];
    this.mode = fix.source;
    if (!this.pos || !this.anchor) { this.anchor = p; this.anchorT = t; }
    else {
      const d = dist(this.anchor, p);
      const dtS = Math.min(SPEED.idleMs / 1000, Math.max(0.001, (t - this.anchorT) / 1000));
      const v = d / dtS;
      if (d >= SPEED.stepM && v > SPEED.teleport) {
        // Saut de position (lieu de test, GPS perdu) : ni distance, ni vitesse.
        this.anchor = p; this.anchorT = t; this.speed = 0;
      } else if (d >= SPEED.stepM) {
        this.heading = bearing(this.anchor, p);
        this.speed = this.speed > 0 ? 0.5 * this.speed + 0.5 * v : v;
        this.distanceM += d;
        this.progress({ type: 'marche', meters: d });
        this.anchor = p; this.anchorT = t; this.lastMoveT = t;
        this.dirty = true;
      }
    }
    this.pos = p;
    const here = cellAt(p[0], p[1]).id;
    if (!this.visited.has(here)) { this.visited.add(here); this.visitedList.push(here); this.dirty = true; }
    this.refreshPlace();
    this.autosave();
  }

  tick(dtS: number): void {
    if (!(dtS > 0)) { this.autosave(); return; }
    const t = this.now();
    if (t >= this.nextDay) this.newDay(t);
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dtS);
    if (this.speed > 0 && t - this.lastMoveT > SPEED.idleMs) this.speed = 0;
    // Après une longue pause (application en arrière-plan), on ne rattrape pas le temps perdu.
    const dt = Math.min(dtS, 5);
    const moving = this.speed > SPEED.moving, running = this.speed > SPEED.run;
    const carried = this.carried();
    const loadFrac = this.carriedKg(carried) / this.mods.capacityKg;

    const before = this.stamina;
    const near = this.nearShelter;
    this.stamina = nextStamina(this.stamina, dt, {
      moving, running, loadFrac, inShelter: near !== null,
      shelterPerk: near !== null && this.starsOf(near) >= 3 ? SHELTER_PERK.restMult : 1,
      drainMult: this.mods.drainMult, restMult: this.mods.restMult,
    });
    if (this.stamina !== before) this.dirty = true;

    if (moving && carried.length) this.walkS += dt;
    this.balance = driftBalance(this.balance, dt, this.walkS, { moving, loadFrac, windKmh: this.weather.windKmh, mult: this.mods.balanceMult });
    this.unbalancedS = isUnbalanced(this.balance) ? this.unbalancedS + dt : 0;

    if (carried.length) {
      const ctx = {
        weather: this.weather.kind, inDanger: this.inDanger, unbalanced: this.unbalancedS > BALANCE.graceS,
        running, exhausted: this.stamina <= 0, wearMult: this.mods.wearMult, dangerMult: this.mods.dangerMult,
      };
      for (const o of carried) {
        const w = wearPerSecond(o, ctx) * dt;
        if (w > 0) { o.condition = Math.max(0, o.condition - w); this.dirty = true; }
        if (o.deadlineMin !== null && !this.lateWarned.has(o.id) && elapsedMin(o, t) > o.deadlineMin) {
          this.lateWarned.add(o.id);
          this.emit({ type: 'toast', text: `Délai dépassé : ${orderName(o, this.starsOf(o.destId))}`, tone: 'warn' });
        }
      }
    }
    this.autosave();
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ───────────────────────── actions

  scan(): ActionResult {
    if (!this.pos) return no('Position inconnue.');
    if (this.cooldownLeft > 0) return no('Le scanner se recharge.');
    const range = this.scanRange();
    let found = 0;
    for (const o of this.orders.values()) {
      if (o.state === 'caché' && dist(o.at, this.pos) <= range) { o.state = 'révélé'; found++; }
    }
    this.cooldownLeft = this.mods.scanCooldownS;
    this.emit({ type: 'scan', found });
    if (found) this.saveNow();
    return OK;
  }

  pickup(orderId: string): ActionResult {
    const o = this.orders.get(orderId);
    if (!o || o.state === 'caché') return no('Colis introuvable.');
    if (o.state === 'porté') return no('Ce colis est déjà dans le sac.');
    if (!this.pos) return no('Position inconnue.');
    if (dist(o.at, this.pos) > this.pickupRange()) return no('Trop loin du colis.');
    if (this.carriedKg(this.carried()) + o.weightKg > this.mods.capacityKg) return no('Sac trop lourd : pose d’abord un colis.');
    o.state = 'porté';
    if (o.pickedAt === null) o.pickedAt = this.now();
    this.emit({ type: 'pickup', order: this.orderView(o, this.now()) });
    this.saveNow();
    return OK;
  }

  drop(orderId: string): ActionResult {
    const o = this.orders.get(orderId);
    if (!o || o.state !== 'porté') return no('Ce colis n’est pas dans le sac.');
    if (!this.pos) return no('Position inconnue.');
    o.state = 'révélé';
    o.at = [this.pos[0], this.pos[1]];
    this.emit({ type: 'drop', orderId });
    this.saveNow();
    return OK;
  }

  deliver(shelterId: string): ActionResult {
    const sh = this.shelterById.get(shelterId);
    if (!sh) return no('Abri introuvable.');
    if (!this.pos) return no('Position inconnue.');
    if (dist(sh.at, this.pos) > RANGE.deliver) return no('Trop loin de l’abri.');
    const mine = this.carried().filter(o => o.destId === shelterId);
    if (!mine.length) return no('Aucun colis pour cet abri.');
    const t = this.now(), npc = npcFor(shelterId);
    const st = this.shelterSave.get(shelterId) ?? { points: 0, deliveries: 0 };
    this.shelterSave.set(shelterId, st);
    let situation: Situation = 'merci';
    for (const o of mine) {
      const starsBefore = starsFor(st.points, st.deliveries);
      const g = gradeDelivery({ condition: o.condition, deadlineMin: o.deadlineMin, elapsedMin: elapsedMin(o, t), weather: this.weather.kind, night: this.weather.night });
      const points = Math.round(orderReward(o, starsBefore) * g.mult * this.mods.pointsMult);
      const xp = Math.round((XP.perDelivery + points * XP.perPoint) * this.mods.xpMult);
      st.points += points; st.deliveries++;
      const starsAfter = starsFor(st.points, st.deliveries);
      const unlocks: string[] = [];
      for (let n = starsBefore + 1; n <= starsAfter; n++) { const u = unlockText(n); if (u) unlocks.push(u); }
      this.score += points; this.deliveries++;
      const levels = this.gainXp(xp);
      this.orders.delete(o.id);
      this.done.add(o.id);
      this.lateWarned.delete(o.id);
      const result: DeliveryResult = {
        orderId: o.id, orderName: orderName(o, starsBefore), shelterId, shelterName: sh.name, npc,
        grade: g.grade, condition: o.condition, onTime: g.onTime, points, xp, notes: g.notes,
        starsBefore, starsAfter, unlock: unlocks.length ? unlocks.join(' · ') : null, levelUp: levels.length > 0,
      };
      this.emit({ type: 'delivery', result });
      for (const level of levels) this.emit({ type: 'levelUp', level });
      this.progress({ type: 'livraison', grade: g.grade, fragile: o.fragile, condition: o.condition, timed: o.deadlineMin !== null, onTime: g.onTime, night: this.weather.night, wet: isWet(this.weather.kind) });
      // Le PNJ réagit au fait le plus marquant de la livraison.
      const s: Situation = starsBefore === 0 ? 'première' : starsAfter > starsBefore ? (starsAfter >= 5 ? 'cinq' : 'étoile')
        : !g.onTime ? 'retard' : o.condition < DAMAGED ? 'abîmé' : 'merci';
      if (situation === 'merci' || s === 'première' || s === 'cinq' || s === 'étoile') situation = s;
    }
    this.outcomes.set(shelterId, { situation, until: t + OUTCOME_MS });
    if (!this.carried().length) { this.balance = 0; this.unbalancedS = 0; }
    this.saveNow();
    return OK;
  }

  steady(): void { this.balance = 0; this.unbalancedS = 0; }

  learn(skillId: string): ActionResult {
    const why = learnBlock(skillId, this.ranks, this.skillPoints);
    if (why) return no(why);
    const d = skillDef(skillId)!;
    this.skillPoints -= d.cost;
    this.ranks[skillId] = (this.ranks[skillId] ?? 0) + 1;
    this.mods = modsFor(this.ranks);
    this.skillsCache = this.contractsCache = null;
    this.saveNow();
    return OK;
  }

  claim(contractId: string): ActionResult {
    const c = this.contracts.find(x => x.id === contractId);
    if (!c) return no('Contrat introuvable.');
    if (!isDone(c)) return no('Contrat pas encore rempli.');
    if (c.claimed) return no('Récompense déjà prise.');
    c.claimed = true;
    const reward = Math.round(c.reward * this.mods.contractMult);
    this.score += reward;
    const levels = this.gainXp(Math.round(reward * XP.contractShare));
    this.contractsCache = null;
    this.emit({ type: 'toast', text: `Contrat rempli : +${reward} points`, tone: 'good' });
    for (const level of levels) this.emit({ type: 'levelUp', level });
    this.saveNow();
    return OK;
  }

  // ───────────────────────── vue

  view(): GameView {
    const t = this.now(), p = this.pos;
    const carriedViews: OrderView[] = [], revealed: OrderView[] = [];
    const deliverable = new Map<string, Order[]>();
    let carriedKg = 0;
    for (const o of this.orders.values()) {
      if (o.state === 'caché') continue;
      const v = this.orderView(o, t);
      if (o.state === 'porté') {
        carriedViews.push(v); carriedKg += o.weightKg;
        const list = deliverable.get(o.destId);
        if (list) list.push(o); else deliverable.set(o.destId, [o]);
      } else revealed.push(v);
    }
    const byDist = (a: { distanceM: number }, b: { distanceM: number }) => a.distanceM - b.distanceM;
    carriedViews.sort(byDist); revealed.sort(byDist);

    const shelters: ShelterView[] = this.shelters.map(s => {
      const st = this.shelterSave.get(s.id), points = st?.points ?? 0, stars = st ? starsFor(st.points, st.deliveries) : 0;
      const d = p ? dist(s.at, p) : 0, mine = deliverable.get(s.id) ?? [];
      return {
        id: s.id, name: s.name, kind: s.kind, at: s.at, npc: npcFor(s.id), stars, points,
        nextStarAt: nextStarAt(stars), nextUnlock: nextUnlock(stars), distanceM: d, inRange: p !== null && d <= RANGE.deliver,
        deliverable: mine.map(o => o.id), line: this.line(s.id, stars, st?.deliveries ?? 0, mine, t),
      };
    }).sort(byDist);

    const dangers: DangerView[] = this.dangers.map(z => ({ id: z.id, at: z.at, radiusM: z.radiusM, inside: p !== null && insideDanger(z, p) }));
    this.skillsCache ??= skillViews(this.ranks, this.skillPoints);
    this.contractsCache ??= this.contracts.map(c => contractView(c, this.mods.contractMult));
    return {
      player: {
        at: p, headingDeg: this.heading, speedMps: this.speed, moving: this.speed > SPEED.moving, mode: this.mode,
        level: this.level, xp: this.xp, xpNext: xpNeeded(this.level), stamina: this.stamina, skillPoints: this.skillPoints,
        carriedKg, capacityKg: this.mods.capacityKg, balance: this.balance, score: this.score, deliveries: this.deliveries,
        distanceKm: Math.round(this.distanceM / 10) / 100,
      },
      scanner: { ready: this.cooldownLeft <= 0, cooldownLeftS: this.cooldownLeft, cooldownS: this.mods.scanCooldownS, rangeM: this.scanRange() },
      weather: this.weather,
      orders: carriedViews.concat(revealed),
      shelters, dangers,
      skills: this.skillsCache, contracts: this.contractsCache,
      visited: this.visitedList, loadedCells: this.loadedCells,
    };
  }

  // ───────────────────────── interne

  private emit(e: GameEvent): void {
    for (const fn of [...this.listeners]) { try { fn(e); } catch { /* une erreur d'affichage ne doit pas arrêter le jeu */ } }
  }
  private carried(): Order[] {
    const out: Order[] = [];
    for (const o of this.orders.values()) if (o.state === 'porté') out.push(o);
    return out;
  }
  private carriedKg(list: Order[]): number { let kg = 0; for (const o of list) kg += o.weightKg; return kg; }
  private starsOf(shelterId: string): number {
    const st = this.shelterSave.get(shelterId);
    return st ? starsFor(st.points, st.deliveries) : 0;
  }
  private pickupRange(): number { return RANGE.pickup + this.mods.pickupBonusM; }
  /** Portée du scanner : base, compétences, et avantage des abris à 4 étoiles autour du joueur. */
  private scanRange(): number {
    let r = RANGE.scan + this.mods.scanRangeM;
    const p = this.pos;
    if (p && this.shelters.some(s => this.starsOf(s.id) >= 4 && dist(s.at, p) <= SHELTER_PERK.scanAroundM)) r += SHELTER_PERK.scanBonusM;
    return r;
  }

  private orderView(o: Order, t: number): OrderView {
    const stars = this.starsOf(o.destId), carried = o.state === 'porté';
    const d = this.pos ? dist(carried ? o.destAt : o.at, this.pos) : 0;
    return {
      id: o.id, name: orderName(o, stars), crate: o.crate, weightKg: o.weightKg, fragile: o.fragile, at: o.at,
      destId: o.destId, destName: o.destName, destAt: o.destAt, state: carried ? 'porté' : 'révélé', condition: o.condition,
      minutesLeft: minutesLeft(o, t), reward: orderReward(o, stars), distanceM: d,
      inRange: !carried && this.pos !== null && d <= this.pickupRange(),
    };
  }

  private line(id: string, stars: number, deliveries: number, mine: Order[], t: number): string {
    if (stars === 0) return HIDDEN_LINE;
    const npc = npcFor(id), seed = `${id}|${deliveries}`;
    if (mine.length) {
      const s: Situation = mine.some(o => o.deadlineMin !== null && elapsedMin(o, t) > o.deadlineMin) ? 'retard'
        : mine.some(o => o.condition < DAMAGED) ? 'abîmé' : 'attente';
      return npcLine(npc, s, seed);
    }
    const out = this.outcomes.get(id);
    if (out && t < out.until) return npcLine(npc, out.situation, seed);
    return npcLine(npc, stars >= 5 ? 'cinq' : 'accueil', seed);
  }

  /** Ajoute de l'XP ; renvoie les niveaux atteints (un point de compétence par niveau). */
  private gainXp(amount: number): number[] {
    const r = addXp({ level: this.level, xp: this.xp }, amount);
    const levels: number[] = [];
    for (let l = this.level + 1; l <= r.level; l++) levels.push(l);
    this.level = r.level; this.xp = r.xp; this.skillPoints += r.gained;
    if (r.gained) this.skillsCache = null;
    return levels;
  }

  private progress(e: ProgressEvent): void {
    for (const c of this.contracts) {
      const before = c.progress;
      const justDone = advance(c, e);
      if (c.progress !== before) this.contractsCache = null;
      if (justDone) this.emit({ type: 'contract', contract: contractView(c, this.mods.contractMult) });
    }
  }

  /** Ce qui dépend de l'endroit où se trouve le joueur : zone dangereuse, abri proche, abris découverts. */
  private refreshPlace(): void {
    const p = this.pos;
    if (!p) return;
    const inside = this.dangers.some(z => insideDanger(z, p));
    if (inside !== this.inDanger) { this.inDanger = inside; this.emit({ type: 'danger', entered: inside }); }
    let near: string | null = null, best: number = RANGE.deliver;
    for (const s of this.shelters) { const d = dist(s.at, p); if (d <= best) { best = d; near = s.id; } }
    this.nearShelter = near;
    if (near !== null && !this.discovered.has(near)) {
      this.discovered.add(near);
      this.emit({ type: 'toast', text: `Abri découvert : ${this.shelterById.get(near)!.name}`, tone: 'info' });
      this.progress({ type: 'abri' });
      this.saveNow();
    }
  }

  /** Changement de jour : les colis non ramassés disparaissent, les contrats sont renouvelés. */
  private newDay(t: number): void {
    this.day = dayKey(t);
    this.nextDay = nextDayMs(t);
    for (const [id, o] of this.orders) if (o.state !== 'porté') this.orders.delete(id);
    this.done.clear();
    this.contracts = this.drawAll(t, this.contracts);
    this.contractsCache = null;
    this.setWorld(this.cells);
    this.saveNow();
  }
}
