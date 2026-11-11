// Le moteur de jeu. Aucun accès à l'écran ni au réseau : il reçoit le monde, la météo et la position,
// et produit un GameView. Les règles sont dans les petits modules voisins (fonctions pures).
import { type LngLat, cellAt, dist } from '../core/geo';
import type { Fix } from '../player/gps';
import type { CellContent, Shelter } from '../world/types';
import {
  type ActionResult, type CacheView, type ContractView, type DangerView, type DeliveryResult, type FrontView, type GameEngine, type GameEvent,
  type GameView, type JamView, type LostInput, type OrderView, RANGE, type ShelterView, type SkillView, type WandererView, type Weather,
} from './api';
import { type Cache, cachesFor } from './caches';
import { driftBalance, isUnbalanced, nextStamina, wearPerSecond } from './carry';
import { type ContractState, type ProgressEvent, advance, contractView, drawContracts, isDone } from './contracts';
import { type Danger, dangersFor, insideDanger } from './dangers';
import { type Front, type FrontPath, frontAt, frontEta, frontPath, frontSlot, insideFront, zonesOf } from './fronts';
import { proofBonus, strapBalanceMult, strapXp } from './gestures';
import { type Jam, jamMinutesLeft, jamSlot, jamsFor } from './jams';
import { lostFor, lostFromNetwork } from './lost';
import { gradeDelivery, isWet } from './grade';
import { HIDDEN_LINE, type Situation, npcLine } from './npc';
import { type Order, elapsedMin, makeOrder, minutesLeft, orderName, orderReward } from './orders';
import { addXp } from './progress';
import { BALANCE, CACHE, DAMAGED, FRONT, GESTURE, PROOF, SAVE_EVERY_MS, SHELTER_PERK, SPEED, WANDER, XP, xpNeeded } from './rules';
import { type GameSave, type GameStore, type JamSave, type OrderSave, SAVE_REV, type ShelterSave, emptyGameSave } from './save';
import { nextStarAt, nextUnlock, npcFor, starsFor, unlockText } from './shelters';
import { type Mods, learnBlock, modsFor, skillDef, skillViews } from './skills';
import { SPECIALS, UNKNOWN_SPECIAL, specialDrainMult, specialWearPerSecond } from './specials';
import { dayKey, nextDayMs, weekKey } from './time';
import { type Wanderer, wanderGift, wanderLine, wanderSlot, wandererAt, wanderersFor, whereText } from './wanderers';

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

  // Systèmes secondaires
  private caches: Cache[] = [];
  private cachesFound = new Set<string>();
  private cachesOpened = new Set<string>();
  private wanderers: Wanderer[] = [];
  private wanderSlotN = -1;
  private met = new Set<string>();
  private frontPaths: FrontPath[] = [];
  private frontSlotN = -1;
  private frontZones: string[] = [];
  private fronts: { path: FrontPath; front: Front }[] = [];
  private inFront = false;
  private frontWarned = new Set<string>();
  /** Secondes passées dans un front, par colis porté. */
  private frontS = new Map<string, number>();
  private jamOffers: Jam[] = [];
  private jamSlotN = -1;
  private jams = new Map<string, JamSave>();
  /** Fin de la fenêtre d'arrimage de chaque colis qui vient d'être ramassé (ms). */
  private strapUntil = new Map<string, number>();
  /** Photos-preuves encore possibles, par colis livré. Jamais sauvegardé. */
  private proofs = new Map<string, { bonus: number; shelterId: string; until: number }>();

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
    this.cachesFound = new Set(sameDay ? save.cachesFound : []);
    this.cachesOpened = new Set(sameDay ? save.cachesOpened : []);
    this.met = new Set(sameDay ? save.met : []);
    this.jams = new Map((save.jams ?? []).filter(j => sameDay || j.state === 'en cours').map(j => [j.id, { ...j }]));
    this.strapUntil.clear(); this.proofs.clear(); this.frontS.clear();
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
      rev: SAVE_REV, cachesFound: [...this.cachesFound], cachesOpened: [...this.cachesOpened], met: [...this.met],
      jams: [...this.jams.values()].map(j => ({ ...j })),
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
    // Colis perdus du jour : cachés comme les autres tant qu'ils n'ont pas été scannés.
    for (const o of lostFor(cells, this.day)) if (!this.orders.has(o.id) && !this.done.has(o.id)) this.orders.set(o.id, o);
    this.caches = cachesFor(cells, this.day);
    this.wanderSlotN = this.jamSlotN = this.frontSlotN = -1;
    this.refreshTimed(this.now());
    this.refreshPlace();
  }

  /**
   * Colis perdus venus d'autres joueurs (réseau). À rappeler avec la liste complète à chaque mise à jour :
   * ceux qui n'y sont plus et que le joueur n'a pas ramassés disparaissent.
   */
  setNetworkLost(list: LostInput[]): void {
    const ids = new Set(list.map(i => `réseau|${i.id}`));
    for (const [id, o] of this.orders) if (o.lost?.net && o.state !== 'porté' && !ids.has(id)) this.orders.delete(id);
    for (const i of list) {
      const o = lostFromNetwork(i);
      if (!this.orders.has(o.id) && !this.done.has(o.id)) this.orders.set(o.id, o);
    }
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
    this.refreshTimed(t);
    this.stepFronts(t, dt, carried);
    this.stepJams(t);

    const before = this.stamina;
    const near = this.nearShelter;
    this.stamina = nextStamina(this.stamina, dt, {
      moving, running, loadFrac, inShelter: near !== null,
      shelterPerk: near !== null && this.starsOf(near) >= 3 ? SHELTER_PERK.restMult : 1,
      drainMult: this.mods.drainMult * specialDrainMult(carried), restMult: this.mods.restMult,
    });
    if (this.stamina !== before) this.dirty = true;

    if (moving && carried.length) this.walkS += dt;
    this.balance = driftBalance(this.balance, dt, this.walkS, { moving, loadFrac, windKmh: this.weather.windKmh, mult: this.mods.balanceMult * strapBalanceMult(carried) });
    this.unbalancedS = isUnbalanced(this.balance) ? this.unbalancedS + dt : 0;

    if (carried.length) {
      const ctx = {
        // Dans un front, les colis s'usent comme sous l'orage.
        weather: this.inFront ? 'orage' as const : this.weather.kind, inDanger: this.inDanger, unbalanced: this.unbalancedS > BALANCE.graceS,
        running, exhausted: this.stamina <= 0, wearMult: this.mods.wearMult, dangerMult: this.mods.dangerMult,
      };
      for (const o of carried) {
        const w = (wearPerSecond(o, ctx) + specialWearPerSecond(o.special, { everPicked: true, carried: true, running })) * dt;
        if (w > 0) { o.condition = Math.max(0, o.condition - w); this.dirty = true; }
        if (o.deadlineMin !== null && !this.lateWarned.has(o.id) && elapsedMin(o, t) > o.deadlineMin) {
          this.lateWarned.add(o.id);
          this.emit({ type: 'toast', text: `Délai dépassé : ${orderName(o, this.starsOf(o.destId))}`, tone: 'warn' });
        }
      }
    }
    // Un caisson cryogénique posé au sol continue de se réchauffer.
    for (const o of this.orders.values()) {
      if (o.special !== 'cryo' || o.state !== 'révélé' || o.pickedAt === null) continue;
      o.condition = Math.max(0, o.condition - specialWearPerSecond(o.special, { everPicked: true, carried: false, running: false }) * dt);
      this.dirty = true;
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
    // Les caches ne répondent qu'à courte portée.
    let caches = 0;
    for (const c of this.caches) {
      if (this.cachesFound.has(c.id) || this.cachesOpened.has(c.id) || dist(c.at, this.pos) > CACHE.scanM) continue;
      this.cachesFound.add(c.id); caches++;
    }
    this.cooldownLeft = this.mods.scanCooldownS;
    this.emit(caches ? { type: 'scan', found, caches } : { type: 'scan', found });
    if (found || caches) this.saveNow();
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
    const t = this.now(), wasKnown = o.inspected === true;
    if (o.pickedAt === null) o.pickedAt = t;
    o.inspected = true;
    this.strapUntil.set(o.id, t + GESTURE.strapWindowS * 1000);
    const v = this.orderView(o, t);
    this.emit({ type: 'pickup', order: v });
    // Un colis spécial pris sans l'avoir écouté : on annonce sa contrainte.
    if (o.special && !wasKnown) this.emit({ type: 'special', order: v });
    this.saveNow();
    return OK;
  }

  drop(orderId: string): ActionResult {
    const o = this.orders.get(orderId);
    if (!o || o.state !== 'porté') return no('Ce colis n’est pas dans le sac.');
    if (!this.pos) return no('Position inconnue.');
    o.state = 'révélé';
    o.at = [this.pos[0], this.pos[1]];
    delete o.strap;
    this.strapUntil.delete(o.id); this.frontS.delete(o.id);
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
      const g = gradeDelivery({ condition: o.condition, deadlineMin: o.deadlineMin, elapsedMin: elapsedMin(o, t), weather: this.weather.kind, night: this.weather.night, front: o.front === true || this.inFront });
      if (o.special) g.notes.push('Colis spécial');
      if (o.lost) g.notes.push(`Colis de ${o.lost.by} retrouvé`);
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
      this.strapUntil.delete(o.id); this.frontS.delete(o.id);
      const bonus = proofBonus(points);
      this.proofs.set(o.id, { bonus, shelterId, until: t + PROOF.windowMs });
      const result: DeliveryResult = {
        orderId: o.id, orderName: orderName(o, starsBefore), shelterId, shelterName: sh.name, npc,
        grade: g.grade, condition: o.condition, onTime: g.onTime, points, xp, notes: g.notes,
        starsBefore, starsAfter, unlock: unlocks.length ? unlocks.join(' · ') : null, levelUp: levels.length > 0,
        special: o.special ?? null, lostBy: o.lost?.by ?? null, proofBonus: bonus,
      };
      this.emit({ type: 'delivery', result });
      for (const level of levels) this.emit({ type: 'levelUp', level });
      if (o.jam) this.jamDelivered(o.jam, t);
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

  // ───────────────────────── actions des systèmes secondaires

  openCache(cacheId: string): ActionResult {
    const c = this.caches.find(x => x.id === cacheId);
    if (!c || !this.cachesFound.has(c.id) || this.cachesOpened.has(c.id)) return no('Cache introuvable.');
    if (!this.pos) return no('Position inconnue.');
    if (dist(c.at, this.pos) > CACHE.openM) return no('Trop loin de la cache.');
    this.cachesOpened.add(c.id);
    this.cachesFound.delete(c.id);
    this.score += c.points;
    if (c.skillPoint) { this.skillPoints++; this.skillsCache = null; }
    const levels = this.gainXp(c.xp);
    this.emit({ type: 'cache', cacheId, points: c.points, xp: c.xp, skillPoint: c.skillPoint });
    for (const level of levels) this.emit({ type: 'levelUp', level });
    this.saveNow();
    return OK;
  }

  talk(wandererId: string): ActionResult {
    const w = this.wanderers.find(x => x.id === wandererId);
    if (!w) return no('Il est déjà reparti.');
    if (this.met.has(w.id)) return no(`${w.name} t’a déjà donné ce qu’il avait.`);
    const p = this.pos;
    if (!p) return no('Position inconnue.');
    if (dist(wandererAt(w, this.now()).at, p) > WANDER.talkM) return no(`Trop loin de ${w.name}.`);
    const near = <T extends { at: LngLat }>(list: T[]): T | undefined => list.sort((a, b) => dist(a.at, p) - dist(b.at, p))[0];
    const cache = near(this.caches.filter(c => !this.cachesFound.has(c.id) && !this.cachesOpened.has(c.id)));
    const special = near([...this.orders.values()].filter(o => o.special && o.state !== 'porté' && !o.inspected));
    const gift = wanderGift(w.roll, { cache: !!cache, special: !!special });
    let line: string, levels: number[] = [];
    if (gift === 'cache' && cache) { this.cachesFound.add(cache.id); line = wanderLine(gift, whereText(p, cache.at)); }
    else if (gift === 'colis' && special) { special.state = 'révélé'; special.inspected = true; line = wanderLine(gift, whereText(p, special.at)); }
    else if (gift === 'endurance') { this.stamina = Math.min(1, this.stamina + WANDER.staminaGift); line = wanderLine(gift); }
    else { levels = this.gainXp(WANDER.xpGift); line = wanderLine('xp'); }
    this.met.add(w.id);
    this.emit({ type: 'wanderer', id: w.id, name: w.name, line, gift });
    for (const level of levels) this.emit({ type: 'levelUp', level });
    this.saveNow();
    return OK;
  }

  startJam(jamId: string): ActionResult {
    const j = this.jamOffers.find(x => x.id === jamId);
    if (!j || this.jams.has(jamId)) return no('Ce lot n’est plus proposé.');
    if (!this.pos) return no('Position inconnue.');
    if (dist(j.at, this.pos) > RANGE.deliver) return no('Trop loin de l’abri.');
    for (const o of j.orders) this.orders.set(o.id, { ...o });
    const rec: JamSave = {
      id: j.id, shelterId: j.shelterId, shelterName: j.shelterName, at: j.at, count: j.orders.length, delivered: 0,
      minutes: j.minutes, bonus: j.bonus, startedAt: this.now(), state: 'en cours',
    };
    this.jams.set(j.id, rec);
    this.emit({ type: 'jam', phase: 'début', jam: this.jamView(rec, this.now()) });
    this.saveNow();
    return OK;
  }

  inspect(orderId: string): ActionResult {
    const o = this.orders.get(orderId);
    if (!o || o.state !== 'révélé') return no('Colis introuvable.');
    if (o.inspected) return no('Tu sais déjà ce qu’il contient.');
    if (!this.pos) return no('Position inconnue.');
    if (dist(o.at, this.pos) > GESTURE.inspectM) return no('Trop loin pour l’écouter.');
    o.inspected = true;
    const levels = this.gainXp(GESTURE.inspectXp);
    this.emit({ type: 'inspect', order: this.orderView(o, this.now()), xp: GESTURE.inspectXp });
    for (const level of levels) this.emit({ type: 'levelUp', level });
    this.saveNow();
    return OK;
  }

  strap(orderId: string, quality: number): ActionResult {
    const o = this.orders.get(orderId);
    if (!o || o.state !== 'porté') return no('Ce colis n’est pas dans le sac.');
    if (o.strap !== undefined) return no('Ce colis est déjà arrimé.');
    if ((this.strapUntil.get(o.id) ?? 0) < this.now()) return no('Trop tard pour l’arrimer.');
    const q = Math.min(1, Math.max(0, Number.isFinite(quality) ? quality : 0));
    o.strap = q;
    this.strapUntil.delete(o.id);
    const xp = strapXp(q), levels = xp ? this.gainXp(xp) : [];
    this.emit({ type: 'strap', orderId, quality: q, xp });
    for (const level of levels) this.emit({ type: 'levelUp', level });
    this.saveNow();
    return OK;
  }

  proof(orderId: string): ActionResult {
    const p = this.proofs.get(orderId);
    if (!p || this.now() > p.until) { this.proofs.delete(orderId); return no('Trop tard pour la photo.'); }
    this.proofs.delete(orderId);
    this.score += p.bonus;
    const st = this.shelterSave.get(p.shelterId);
    if (st) st.points += p.bonus;
    this.emit({ type: 'proof', orderId, points: p.bonus });
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

    const caches: CacheView[] = [];
    for (const c of this.caches) {
      if (!this.cachesFound.has(c.id)) continue;
      const d = p ? dist(c.at, p) : 0;
      caches.push({ id: c.id, at: c.at, distanceM: d, inRange: p !== null && d <= CACHE.openM });
    }
    const wanderers: WandererView[] = this.wanderers.map(w => {
      const pose = wandererAt(w, t), d = p ? dist(pose.at, p) : 0;
      return { id: w.id, name: w.name, at: pose.at, headingDeg: pose.headingDeg, moving: pose.moving, met: this.met.has(w.id), distanceM: d, inRange: p !== null && d <= WANDER.talkM };
    });
    const fronts: FrontView[] = this.fronts.map(({ path, front }) => {
      const d = p ? Math.max(0, dist(front.at, p) - front.radiusM) : 0;
      return {
        id: front.id, at: front.at, radiusM: front.radiusM, headingDeg: front.headingDeg, speedMps: front.speedMps,
        inside: p !== null && insideFront(front, p), distanceM: d, etaS: p ? frontEta(path, t, p) : null,
      };
    });
    const jams: JamView[] = [];
    for (const j of this.jams.values()) if (j.state === 'en cours') jams.push(this.jamView(j, t));
    for (const j of this.jamOffers) {
      if (this.jams.has(j.id)) continue;
      const d = p ? dist(j.at, p) : 0;
      jams.push({
        id: j.id, shelterId: j.shelterId, shelterName: j.shelterName, at: j.at, state: 'proposé', count: j.orders.length, delivered: 0,
        minutes: j.minutes, minutesLeft: null, bonus: j.bonus, distanceM: d, inRange: p !== null && d <= RANGE.deliver,
      });
    }
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
      caches, wanderers, fronts, jams,
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
    const known = o.inspected === true, sp = o.special ? SPECIALS[o.special] : null;
    return {
      id: o.id, name: sp && !known ? UNKNOWN_SPECIAL : orderName(o, stars), crate: o.crate, weightKg: o.weightKg, fragile: o.fragile, at: o.at,
      destId: o.destId, destName: o.destName, destAt: o.destAt, state: carried ? 'porté' : 'révélé', condition: o.condition,
      minutesLeft: minutesLeft(o, t), reward: orderReward(o, stars), distanceM: d,
      inRange: !carried && this.pos !== null && d <= this.pickupRange(),
      special: sp ? { kind: sp.kind, label: sp.label, rule: sp.rule, known } : null,
      lost: o.lost ? { by: o.lost.by } : null, jamId: o.jam ?? null,
      inspected: known, canInspect: !carried && !known && this.pos !== null && d <= GESTURE.inspectM,
      strap: o.strap ?? null,
      strapLeftS: carried && o.strap === undefined ? Math.max(0, ((this.strapUntil.get(o.id) ?? 0) - t) / 1000) : 0,
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

  /** Ce qui dépend de l'heure : rôdeurs, lots d'abri et trajets des fronts sont retirés quand leur tranche horaire change. */
  private refreshTimed(t: number): void {
    const ws = wanderSlot(t);
    if (ws !== this.wanderSlotN) { this.wanderSlotN = ws; this.wanderers = wanderersFor(this.cells, t); }
    const js = jamSlot(t);
    if (js !== this.jamSlotN) {
      this.jamSlotN = js;
      this.jamOffers = jamsFor(this.shelters, t);
      // Les lots terminés des tranches passées n'ont plus besoin d'être retenus.
      for (const [id, j] of this.jams) if (j.state !== 'en cours' && Number(id.slice(id.lastIndexOf('|') + 1)) < js) this.jams.delete(id);
    }
    const fs = frontSlot(t);
    if (fs !== this.frontSlotN) {
      this.frontSlotN = fs;
      this.frontZones = zonesOf(this.loadedCells);
      this.frontPaths = [];
      for (const z of this.frontZones) { const path = frontPath(z, fs); if (path) this.frontPaths.push(path); }
    }
  }

  /** Fronts : position du moment, entrée et sortie du joueur, alerte à l'approche, bonus pour les colis qui le traversent. */
  private stepFronts(t: number, dt: number, carried: Order[]): void {
    this.fronts.length = 0;
    const p = this.pos;
    let inside = false;
    for (const path of this.frontPaths) {
      const front = frontAt(path, t);
      if (!front) continue;
      this.fronts.push({ path, front });
      if (!p) continue;
      if (insideFront(front, p)) { inside = true; this.frontWarned.add(path.id); continue; }
      if (this.frontWarned.has(path.id)) continue;
      const eta = frontEta(path, t, p);
      if (eta !== null && eta <= FRONT.warnS) { this.frontWarned.add(path.id); this.emit({ type: 'front', phase: 'approche', etaS: eta }); }
    }
    if (inside !== this.inFront) { this.inFront = inside; this.emit({ type: 'front', phase: inside ? 'entrée' : 'sortie' }); }
    if (!inside) return;
    for (const o of carried) {
      if (o.front) continue;
      const s = (this.frontS.get(o.id) ?? 0) + dt;
      if (s >= FRONT.creditS) { o.front = true; this.frontS.delete(o.id); this.dirty = true; } else this.frontS.set(o.id, s);
    }
  }

  private jamView(j: JamSave, t: number): JamView {
    const d = this.pos ? dist(j.at, this.pos) : 0;
    return {
      id: j.id, shelterId: j.shelterId, shelterName: j.shelterName, at: j.at, state: 'en cours', count: j.count, delivered: j.delivered,
      minutes: j.minutes, minutesLeft: jamMinutesLeft(j.minutes, j.startedAt, t), bonus: j.bonus, distanceM: d, inRange: false,
    };
  }
  /** Temps écoulé : le lot est perdu, les colis restent à livrer comme des commandes ordinaires. */
  private stepJams(t: number): void {
    for (const j of this.jams.values()) {
      if (j.state !== 'en cours' || t <= j.startedAt + j.minutes * 60000) continue;
      const v = this.jamView(j, t);
      j.state = 'raté';
      this.emit({ type: 'jam', phase: 'raté', jam: v });
      this.saveNow();
    }
  }
  /** Un colis du lot est livré ; le dernier, s'il arrive à temps, déclenche le bonus (points pour le joueur et pour l'abri débordé). */
  private jamDelivered(jamId: string, t: number): void {
    const j = this.jams.get(jamId);
    if (!j || j.state !== 'en cours') return;
    j.delivered = Math.min(j.count, j.delivered + 1);
    if (j.delivered < j.count) return;
    const v = this.jamView(j, t);
    j.state = 'réussi';
    this.score += j.bonus;
    const st = this.shelterSave.get(j.shelterId) ?? { points: 0, deliveries: 0 };
    st.points += j.bonus;
    this.shelterSave.set(j.shelterId, st);
    const levels = this.gainXp(Math.round(j.bonus * XP.perPoint));
    this.emit({ type: 'jam', phase: 'réussi', jam: v, bonus: j.bonus });
    for (const level of levels) this.emit({ type: 'levelUp', level });
  }

  /** Changement de jour : les colis non ramassés disparaissent, les contrats sont renouvelés. */
  private newDay(t: number): void {
    this.day = dayKey(t);
    this.nextDay = nextDayMs(t);
    for (const [id, o] of this.orders) if (o.state !== 'porté') this.orders.delete(id);
    this.done.clear();
    this.cachesFound.clear(); this.cachesOpened.clear(); this.met.clear(); this.frontWarned.clear();
    for (const [id, j] of this.jams) if (j.state !== 'en cours') this.jams.delete(id);
    this.contracts = this.drawAll(t, this.contracts);
    this.contractsCache = null;
    this.setWorld(this.cells);
    this.saveNow();
  }
}
