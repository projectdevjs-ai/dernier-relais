import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellAt, cellsAround, dist } from '../src/core/geo';
import type { Grade, NpcId } from '../src/game/api';
import { driftBalance, driftDir, isUnbalanced, nextStamina, wearPerSecond } from '../src/game/carry';
import { type ContractState, advance, contractView, drawContracts, isDone, progressFor } from '../src/game/contracts';
import { dangerInCell, dangersFor, insideDanger } from '../src/game/dangers';
import { gradeDelivery, gradeFromScore } from '../src/game/grade';
import { HIDDEN_LINE, LINES, npcLine } from '../src/game/npc';
import { ITEMS, baseReward, deadlineFor, destPenalty, easeOrder, makeOrder, minutesLeft, orderName, orderReward, pickDestination, sheltersNear } from '../src/game/orders';
import { addXp } from '../src/game/progress';
import { BAG_KG, DEST, GRADE_MULT, NEWBIE, SCAN_COOLDOWN_MIN_S, SCAN_COOLDOWN_S, STAR_THRESHOLDS, xpNeeded } from '../src/game/rules';
import { nextStarAt, nextUnlock, npcFor, starsFor, unlockText } from '../src/game/shelters';
import { SKILLS, learnBlock, modsFor, skillViews } from '../src/game/skills';
import { dayKey, nextDayMs, weekKey } from '../src/game/time';
import { BASE, T0, findSpot, off, shelter, spot } from './game.helpers';

const A = shelter('A', off(0, 0)), B = shelter('B', off(300, 0)), C = shelter('C', off(0, 400)), D = shelter('D', off(-500, 0)), E = shelter('E', off(900, 900));

describe('commandes', () => {
  it('sont identiques à chaque calcul et pour tous les joueurs', () => {
    const s = spot('17/3|2026-11-11|4', off(40, 10));
    expect(makeOrder(s, [A, B, C])).toEqual(makeOrder(s, [C, B, A]));
  });
  it('ne créent rien sans abri', () => { expect(makeOrder(spot('x', BASE), [])).toBeNull(); });
  it('choisissent un abri à distance de marche raisonnable, pas celui d’à côté quand c’est possible', () => {
    // Abris placés dans la case du colis : A à 20 m, B à 280 m, C à 400 m, D à 500 m ; E à 1,3 km (hors des cases voisines).
    for (let i = 0; i < 40; i++) {
      const s = spot(`d${i}`, off(20, 5));
      expect(pickDestination(s, [A, B, C, D, E])!.id).not.toBe('A');
      expect(pickDestination(s, [A, B])!.id).toBe('B');
      expect(pickDestination(s, [A])!.id).toBe('A');
      // L'abri très lointain n'est jamais choisi.
      expect(pickDestination(s, [A, B, C, D, E])!.id).not.toBe('E');
      const d = dist(pickDestination(s, [A, B, C, D, E])!.at, s.at);
      expect(d).toBeGreaterThanOrEqual(DEST.minM); expect(d).toBeLessThanOrEqual(DEST.maxM);
    }
    const near = (id: string, dx: number, dy: number) => ({ ...shelter(id, off(dx, dy)), cell: cellAt(BASE[0], BASE[1]).id });
    const pool = [near('A', 0, 0), near('B', 300, 0), near('C', 0, 400), near('D', -500, 0)];
    const picked = new Set(Array.from({ length: 60 }, (_, i) => pickDestination(spot(`d${i}`, off(20, 5)), pool)!.id));
    expect([...picked].sort()).toEqual(['B', 'C', 'D']);
  });
  it('sans abri dans la bande visée, prennent celui qui s’en écarte le moins, jamais au-delà du plafond s’il y a plus près', () => {
    const here = cellAt(BASE[0], BASE[1]).id, sh = (id: string, dx: number) => ({ ...shelter(id, off(dx, 0)), cell: here });
    const s = spot('x1', BASE);
    // 150 m (trop près) contre 1 300 m (au-delà du plafond) : le plus près.
    expect(pickDestination(s, [sh('N', 150), sh('F', 1300)])!.id).toBe('N');
    // 60 m contre 800 m : 800 m s'écarte moins de la bande.
    expect(pickDestination(s, [sh('N', 60), sh('F', 800)])!.id).toBe('F');
    // Rien en deçà du plafond : le moins loin.
    expect(pickDestination(s, [sh('F', 1500), sh('G', 1100)])!.id).toBe('G');
    expect(destPenalty(DEST.minM)).toBe(0); expect(destPenalty(DEST.maxM)).toBe(0);
    expect(destPenalty(DEST.minM - 100)).toBe(100 * DEST.nearPenalty); expect(destPenalty(DEST.maxM + 100)).toBe(100);
  });
  it('ne regardent que les abris des cases voisines du colis : même résultat où que soit le joueur', () => {
    const c = cellAt(BASE[0], BASE[1]);
    const inCell = (id: string, dx: number, cx: number) => ({ ...shelter(id, off(dx, 0)), cell: `${c.x + cx}/${c.y}` });
    const s = { ...spot('x2', BASE), cell: c.id };
    const local = [inCell('L1', 300, 0), inCell('L2', 450, 1)], farCells = [inCell('Z1', 320, 2), inCell('Z2', 400, -3)];
    expect(sheltersNear(s, [...local, ...farCells]).map(x => x.id)).toEqual(['L1', 'L2']);
    for (let i = 0; i < 30; i++) {
      const k = { ...spot(`r${i}`, BASE), cell: c.id };
      expect(pickDestination(k, [...local, ...farCells])!.id).toBe(pickDestination(k, local)!.id);
      expect(makeOrder(k, [...farCells, ...local])).toEqual(makeOrder(k, local));
    }
    // Aucun abri dans les cases voisines : on se rabat sur les abris chargés plutôt que de n'avoir aucune commande.
    expect(pickDestination(s, farCells)).not.toBeNull();
  });
  it('simplifient les premières commandes d’un nouveau porteur : abri proche, ni fragile, ni délai', () => {
    const here = cellAt(BASE[0], BASE[1]).id, sh = (id: string, dx: number) => ({ ...shelter(id, off(dx, 0)), cell: here });
    const pool = [sh('P', 30), sh('Q', 200), sh('R', 600)];
    const s = findSpot('nb', BASE, pool, o => o.fragile && o.deadlineMin !== null && o.destId === 'R');
    const o = makeOrder(s, pool)!;
    expect(easeOrder(o, pool)).toBe(true);
    expect(o).toMatchObject({ destId: 'Q', fragile: false, deadlineMin: null });
    expect(o.baseReward).toBe(baseReward(o.weightKg, dist(o.at, o.destAt), false, false));
    // L'abri collé au colis (moins de NEWBIE.minM) n'est pas une destination.
    expect(NEWBIE.minM).toBeGreaterThan(30);
    // Déjà simple et déjà proche : rien ne change.
    const again = { ...o };
    expect(easeOrder(o, pool)).toBe(false); expect(o).toEqual(again);
  });
  it('ont un nom, une caisse, un poids de 1 à 12 kg et une récompense cohérents', () => {
    const names = new Set(ITEMS.map(i => i.name));
    let fragile = 0, timed = 0, rare = 0;
    const crates = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const o = makeOrder(spot(`c${i}`, off(50, 0)), [A, B])!;
      expect(names.has(o.name)).toBe(true);
      expect(Number.isInteger(o.weightKg)).toBe(true);
      expect(o.weightKg).toBeGreaterThanOrEqual(1); expect(o.weightKg).toBeLessThanOrEqual(12);
      expect(o.state).toBe('caché'); expect(o.condition).toBe(1); expect(o.pickedAt).toBeNull();
      expect(o.baseReward).toBe(baseReward(o.weightKg, dist(o.at, o.destAt), o.fragile, o.deadlineMin !== null));
      if (o.deadlineMin !== null) expect(o.deadlineMin).toBe(deadlineFor(dist(o.at, o.destAt)));
      crates.add(o.crate);
      fragile += o.fragile ? 1 : 0; timed += o.deadlineMin !== null ? 1 : 0; rare += o.rareName ? 1 : 0;
    }
    expect(crates).toEqual(new Set(['bois', 'alu', 'plastique', 'carton', 'sac', 'fut', 'coffre']));
    expect(fragile).toBeGreaterThan(60); expect(fragile).toBeLessThan(220);
    expect(timed).toBeGreaterThan(90); expect(timed).toBeLessThan(190);
    expect(rare).toBeGreaterThan(30); expect(rare).toBeLessThan(100);
  });
  it('paient plus pour le poids, la distance, la fragilité et le délai', () => {
    expect(baseReward(10, 300, false, false)).toBeGreaterThan(baseReward(2, 300, false, false));
    expect(baseReward(5, 900, false, false)).toBeGreaterThan(baseReward(5, 300, false, false));
    expect(baseReward(5, 300, true, false)).toBeGreaterThan(baseReward(5, 300, false, false));
    expect(baseReward(5, 300, false, true)).toBeGreaterThan(baseReward(5, 300, false, false));
    expect(baseReward(6, 500, false, false)).toBe(75);
  });
  it('sont mieux payées à 2 étoiles et deviennent rares à 5 étoiles', () => {
    const s = findSpot('r', off(50, 0), [A, B], o => o.rareName !== null);
    const o = makeOrder(s, [A, B])!;
    expect(orderName(o, 4)).toBe(o.name);
    expect(orderName(o, 5)).toBe(o.rareName);
    expect(orderReward(o, 1)).toBe(o.baseReward);
    expect(orderReward(o, 2)).toBeGreaterThan(o.baseReward);
    expect(orderReward(o, 5)).toBeGreaterThan(orderReward(o, 4) * 1.8);
  });
  it('comptent le délai à partir du ramassage', () => {
    const o = makeOrder(findSpot('t', off(50, 0), [A, B], x => x.deadlineMin !== null), [A, B])!;
    expect(minutesLeft(o, T0)).toBe(o.deadlineMin);
    o.pickedAt = T0;
    expect(minutesLeft(o, T0 + 60000)).toBe(o.deadlineMin! - 1);
    expect(minutesLeft(o, T0 + (o.deadlineMin! + 3) * 60000)).toBe(-3);
    expect(minutesLeft({ ...o, deadlineMin: null }, T0)).toBeNull();
  });
});

describe('note', () => {
  const base = { condition: 1, deadlineMin: null, elapsedMin: 5, weather: 'clair' as const, night: false };
  it('va de E à S selon l’état du colis', () => {
    const grades = [1, 0.9, 0.8, 0.7, 0.5, 0.2].map(c => gradeDelivery({ ...base, condition: c }).grade);
    expect(grades).toEqual(['S', 'A', 'B', 'C', 'D', 'E']);
    expect(gradeFromScore(97)).toBe('S'); expect(gradeFromScore(96.9)).toBe('A'); expect(gradeFromScore(-50)).toBe('E');
  });
  it('applique les multiplicateurs demandés', () => {
    expect(GRADE_MULT).toEqual({ E: 0.5, D: 0.75, C: 1, B: 1.25, A: 1.5, S: 2 });
    for (const c of [1, 0.9, 0.5]) { const g = gradeDelivery({ ...base, condition: c }); expect(g.mult).toBe(GRADE_MULT[g.grade as Grade]); }
  });
  it('récompense le respect du délai et pénalise le retard', () => {
    const ok = gradeDelivery({ ...base, condition: 0.95, deadlineMin: 10, elapsedMin: 9 });
    expect(ok.onTime).toBe(true); expect(ok.grade).toBe('S'); expect(ok.notes).toContain('Dans les temps');
    const late = gradeDelivery({ ...base, deadlineMin: 10, elapsedMin: 14 });
    expect(late.onTime).toBe(false); expect(late.grade).toBe('B'); expect(late.notes).toContain('En retard de 4 min');
    expect(gradeDelivery({ ...base, deadlineMin: 10, elapsedMin: 90 }).grade).toBe('D');
    expect(gradeDelivery(base).onTime).toBe(true);
  });
  it('donne un bonus sous la pluie et de nuit, et l’explique', () => {
    const dry = gradeDelivery({ ...base, condition: 0.9 });
    const rain = gradeDelivery({ ...base, condition: 0.9, weather: 'pluie' });
    const night = gradeDelivery({ ...base, condition: 0.9, weather: 'orage', night: true });
    expect(rain.score).toBeGreaterThan(dry.score); expect(night.score).toBeGreaterThan(rain.score);
    expect(dry.notes).toEqual(['État 90 %']);
    expect(rain.notes).toEqual(['État 90 %', 'Sous la pluie']);
    expect(night.notes).toEqual(['État 90 %', 'Sous l’orage', 'De nuit']);
    expect(gradeDelivery({ ...base, weather: 'neige' }).notes).toContain('Sous la neige');
    expect(gradeDelivery({ ...base, condition: 0.9, weather: 'brouillard' }).score).toBe(dry.score);
  });
});

describe('abris', () => {
  it('ont 5 étoiles aux seuils 100, 350, 800, 1600, 3000', () => {
    expect([...STAR_THRESHOLDS]).toEqual([100, 350, 800, 1600, 3000]);
    expect([0, 99, 100, 349, 350, 800, 1600, 2999, 3000, 99999].map(p => starsFor(p, 5))).toEqual([1, 1, 1, 1, 2, 3, 4, 4, 5, 5]);
    expect([0, 1, 2, 3, 4, 5].map(nextStarAt)).toEqual([100, 350, 800, 1600, 3000, null]);
  });
  it('donnent la première étoile dès la première livraison', () => {
    expect(starsFor(0, 0)).toBe(0); expect(starsFor(20, 1)).toBe(1);
  });
  it('débloquent quelque chose à chaque étoile', () => {
    const all = [1, 2, 3, 4, 5].map(unlockText);
    expect(new Set(all).size).toBe(5);
    for (const u of all) expect(u!.length).toBeGreaterThan(10);
    expect(nextUnlock(0)).toBe(all[0]); expect(nextUnlock(5)).toBeNull(); expect(unlockText(6)).toBeNull();
  });
  it('ont un PNJ reproductible, et les quatre PNJ existent', () => {
    expect(npcFor('32100/22890:abc')).toBe(npcFor('32100/22890:abc'));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => npcFor(`abri-${i}`)));
    expect(seen).toEqual(new Set<NpcId>(['mara', 'tomas', 'agathe', 'kenji']));
  });
  it('ont des répliques courtes et différentes pour chaque PNJ et chaque situation', () => {
    const all: string[] = [];
    for (const npc of Object.keys(LINES) as NpcId[]) {
      const sits = LINES[npc];
      expect(Object.keys(sits).sort()).toEqual(['abîmé', 'accueil', 'attente', 'cinq', 'merci', 'première', 'retard', 'étoile'].sort());
      for (const list of Object.values(sits)) {
        expect(list.length).toBeGreaterThanOrEqual(2);
        for (const l of list) { expect(l.length).toBeGreaterThan(5); expect(l.length).toBeLessThanOrEqual(90); expect(l).not.toContain("'"); all.push(l); }
      }
    }
    expect(new Set(all).size).toBe(all.length);
    expect(npcLine('tomas', 'retard', 's|3')).toBe(npcLine('tomas', 'retard', 's|3'));
    expect(LINES.tomas.retard).toContain(npcLine('tomas', 'retard', 's|3'));
    expect(HIDDEN_LINE).toBe('…');
  });
});

describe('niveaux', () => {
  it('demandent de plus en plus d’XP', () => {
    for (let l = 1; l < 30; l++) expect(xpNeeded(l + 1)).toBeGreaterThan(xpNeeded(l));
    expect(xpNeeded(1)).toBe(100);
  });
  it('montent quand l’XP suffit, plusieurs à la fois s’il le faut', () => {
    expect(addXp({ level: 1, xp: 0 }, 99)).toEqual({ level: 1, xp: 99, gained: 0 });
    expect(addXp({ level: 1, xp: 90 }, 20)).toEqual({ level: 2, xp: 10, gained: 1 });
    expect(addXp({ level: 1, xp: 0 }, xpNeeded(1) + xpNeeded(2) + 5)).toEqual({ level: 3, xp: 5, gained: 2 });
  });
});

describe('compétences', () => {
  it('forment 4 branches : 10 à 12 compétences à plusieurs rangs, plus les 3 paliers d’exosquelette', () => {
    const ranked = SKILLS.filter(s => !s.exoTier);
    expect(ranked.length).toBeGreaterThanOrEqual(10); expect(ranked.length).toBeLessThanOrEqual(12);
    expect(SKILLS.filter(s => s.exoTier).map(s => [s.id, s.branch, s.maxRank, s.exoTier])).toEqual([['exo-bras', 'portage', 1, 1], ['exo-jambes', 'portage', 1, 2], ['exo-gyro', 'portage', 1, 3]]);
    expect(new Set(SKILLS.map(s => s.branch))).toEqual(new Set(['scanner', 'portage', 'endurance', 'réseau']));
    expect(new Set(SKILLS.map(s => s.id)).size).toBe(SKILLS.length);
    for (const s of SKILLS) {
      expect(s.maxRank).toBeGreaterThanOrEqual(s.exoTier ? 1 : 2);
      if (s.needs) { const n = SKILLS.find(x => x.id === s.needs!.id)!; expect(n.branch).toBe(s.branch); expect(n.maxRank).toBeGreaterThanOrEqual(s.needs.rank); }
    }
  });
  it('vérifient les points, les prérequis et le rang maximal', () => {
    expect(learnBlock('inconnue', {}, 9)).toMatch(/inconnue/);
    expect(learnBlock('sac', {}, 0)).toMatch(/Pas assez/);
    expect(learnBlock('sac', {}, 1)).toBeNull();
    expect(learnBlock('sac', { sac: 4 }, 9)).toMatch(/maximal/);
    expect(learnBlock('sangles', { sac: 1 }, 9)).toMatch(/Armature renforcée/);
    expect(learnBlock('sangles', { sac: 2 }, 9)).toBeNull();
    expect(learnBlock('sangles', { sac: 2 }, 1)).toMatch(/Pas assez/);
    const v = skillViews({ sac: 2 }, 1);
    expect(v.find(s => s.id === 'sac')).toMatchObject({ rank: 2, maxRank: 4, available: true });
    expect(v.find(s => s.id === 'sangles')!.available).toBe(false);
    expect(v.find(s => s.id === 'bras-long')!.available).toBe(false);
  });
  it('ont des effets mesurables', () => {
    const none = modsFor({});
    expect(none).toMatchObject({ scanRangeM: 0, scanCooldownS: SCAN_COOLDOWN_S, capacityKg: BAG_KG, wearMult: 1, balanceMult: 1, pointsMult: 1, xpMult: 1 });
    const all = modsFor(Object.fromEntries(SKILLS.map(s => [s.id, s.maxRank])));
    expect(all.scanRangeM).toBe(120); expect(all.scanCooldownS).toBe(9);
    // Chaque rang du condensateur compte encore avec la recharge de 15 s, sans passer sous le minimum.
    expect([1, 2, 3].map(k => modsFor({ 'scan-recharge': k }).scanCooldownS)).toEqual([13, 11, 9]);
    expect(all.scanCooldownS).toBeGreaterThanOrEqual(SCAN_COOLDOWN_MIN_S); expect(all.capacityKg).toBe(40); expect(all.pickupBonusM).toBe(20);
    expect(all.wearMult).toBeCloseTo(0.55); expect(all.balanceMult).toBeCloseTo(0.5); expect(all.drainMult).toBeCloseTo(0.55);
    expect(all.restMult).toBeCloseTo(1.5); expect(all.dangerMult).toBeCloseTo(0.4);
    expect(all.pointsMult).toBeCloseTo(1.3); expect(all.xpMult).toBeCloseTo(1.3); expect(all.contractMult).toBeCloseTo(1.3);
    expect(modsFor({ sac: 99 }).capacityKg).toBe(40);
  });
});

describe('contrats', () => {
  it('tirent 3 contrats du jour et 2 de la semaine, toujours les mêmes pour une date', () => {
    const d = drawContracts('jour', '2026-11-11'), w = drawContracts('semaine', '2026-11-09');
    expect(d).toHaveLength(3); expect(w).toHaveLength(2);
    expect(d).toEqual(drawContracts('jour', '2026-11-11'));
    expect(new Set(d.map(c => c.kind)).size).toBe(3); expect(new Set(w.map(c => c.kind)).size).toBe(2);
    for (const c of [...d, ...w]) { expect(c.goal).toBeGreaterThan(0); expect(c.reward).toBeGreaterThan(0); expect(c.label).toContain(String(c.goal)); }
    expect(d.every(c => c.period === 'jour' && c.id.includes('2026-11-11'))).toBe(true);
  });
  it('changent d’un jour à l’autre et couvrent tous les types', () => {
    const kinds = new Set<string>(), sets = new Set<string>();
    for (let i = 1; i <= 28; i++) {
      const d = drawContracts('jour', `2026-02-${String(i).padStart(2, '0')}`);
      d.forEach(c => kinds.add(c.kind)); sets.add(d.map(c => c.label).join());
    }
    expect(kinds.size).toBe(7); expect(sets.size).toBeGreaterThan(15);
  });
  it('avancent selon les événements', () => {
    const liv = { type: 'livraison' as const, grade: 'B' as Grade, fragile: false, condition: 0.9, timed: false, onTime: true, night: false, wet: false };
    expect(progressFor('livrer', liv)).toBe(1);
    expect(progressFor('notes', liv)).toBe(0); expect(progressFor('notes', { ...liv, grade: 'A' })).toBe(1); expect(progressFor('notes', { ...liv, grade: 'S' })).toBe(1);
    expect(progressFor('fragile', { ...liv, fragile: true })).toBe(0); expect(progressFor('fragile', { ...liv, fragile: true, condition: 0.97 })).toBe(1);
    expect(progressFor('fragile', { ...liv, condition: 1 })).toBe(0);
    expect(progressFor('météo', liv)).toBe(0); expect(progressFor('météo', { ...liv, night: true })).toBe(1); expect(progressFor('météo', { ...liv, wet: true })).toBe(1);
    expect(progressFor('ponctuel', liv)).toBe(0); expect(progressFor('ponctuel', { ...liv, timed: true })).toBe(1); expect(progressFor('ponctuel', { ...liv, timed: true, onTime: false })).toBe(0);
    expect(progressFor('marcher', { type: 'marche', meters: 250 })).toBe(0.25); expect(progressFor('livrer', { type: 'marche', meters: 250 })).toBe(0);
    expect(progressFor('abris', { type: 'abri' })).toBe(1); expect(progressFor('marcher', { type: 'abri' })).toBe(0); expect(progressFor('abris', liv)).toBe(0);
  });
  it('signalent une seule fois qu’ils sont remplis et ne dépassent pas l’objectif', () => {
    const c: ContractState = { id: 'j:x:marcher', period: 'jour', kind: 'marcher', label: 'Marcher 1 km', goal: 1, reward: 60, progress: 0, claimed: false };
    expect(advance(c, { type: 'marche', meters: 640 })).toBe(false);
    expect(contractView(c)).toMatchObject({ progress: 0.6, goal: 1, done: false, claimed: false, reward: 60 });
    expect(advance(c, { type: 'marche', meters: 640 })).toBe(true);
    expect(advance(c, { type: 'marche', meters: 640 })).toBe(false);
    expect(isDone(c)).toBe(true);
    expect(contractView(c, 1.3)).toMatchObject({ progress: 1, done: true, reward: 78 });
  });
});

describe('jour et semaine', () => {
  it('suivent le temps universel, semaine du lundi au dimanche', () => {
    expect(dayKey(T0)).toBe('2026-11-11');
    expect(weekKey(T0)).toBe('2026-11-09');
    expect(weekKey(Date.UTC(2026, 10, 15, 23, 59))).toBe('2026-11-09');
    expect(weekKey(Date.UTC(2026, 10, 16, 0, 0))).toBe('2026-11-16');
    expect(weekKey(Date.UTC(2027, 0, 1))).toBe('2026-12-28');
    expect(nextDayMs(T0)).toBe(Date.UTC(2026, 10, 12));
  });
});

describe('portage', () => {
  const dry = { weather: 'clair' as const, inDanger: false, unbalanced: false, running: false, exhausted: false, wearMult: 1, dangerMult: 1 };
  const box = { fragile: false, crate: 'bois' as const }, glass = { fragile: true, crate: 'bois' as const };
  it('n’abîme rien par temps sec, à l’équilibre et hors danger', () => {
    expect(wearPerSecond(box, dry)).toBe(0); expect(wearPerSecond(glass, dry)).toBe(0);
    expect(wearPerSecond(box, { ...dry, weather: 'nuages' })).toBe(0); expect(wearPerSecond(box, { ...dry, weather: 'brouillard' })).toBe(0);
    expect(wearPerSecond(box, { ...dry, exhausted: true })).toBe(0);
  });
  it('abîme lentement sous la pluie, l’orage et la neige, plus vite les colis fragiles', () => {
    const rain = wearPerSecond(box, { ...dry, weather: 'pluie' });
    expect(rain * 3600).toBeGreaterThan(0.1); expect(rain * 3600).toBeLessThan(0.4);
    expect(wearPerSecond(glass, { ...dry, weather: 'pluie' })).toBeGreaterThan(rain);
    expect(wearPerSecond(box, { ...dry, weather: 'orage' })).toBeGreaterThan(rain);
    expect(wearPerSecond(box, { ...dry, weather: 'neige' })).toBeGreaterThan(0);
    expect(wearPerSecond({ fragile: false, crate: 'carton' }, { ...dry, weather: 'pluie' })).toBeGreaterThan(rain);
    expect(wearPerSecond({ fragile: false, crate: 'alu' }, { ...dry, weather: 'pluie' })).toBeLessThan(rain);
  });
  it('abîme dans une zone dangereuse, en déséquilibre, et en courant avec un colis fragile', () => {
    expect(wearPerSecond(box, { ...dry, inDanger: true })).toBeGreaterThan(0);
    expect(wearPerSecond(box, { ...dry, unbalanced: true })).toBeGreaterThan(0);
    expect(wearPerSecond(glass, { ...dry, unbalanced: true })).toBeGreaterThan(wearPerSecond(box, { ...dry, unbalanced: true }));
    expect(wearPerSecond(box, { ...dry, running: true })).toBe(0);
    expect(wearPerSecond(glass, { ...dry, running: true })).toBeGreaterThan(0);
  });
  it('abîme un peu plus vite à bout d’endurance, moins avec les compétences', () => {
    const w = wearPerSecond(box, { ...dry, weather: 'pluie' });
    const tired = wearPerSecond(box, { ...dry, weather: 'pluie', exhausted: true });
    expect(tired).toBeGreaterThan(w); expect(tired).toBeLessThan(w * 1.5);
    expect(wearPerSecond(box, { ...dry, weather: 'pluie', wearMult: 0.55 })).toBeCloseTo(w * 0.55);
    expect(wearPerSecond(box, { ...dry, inDanger: true, dangerMult: 0.4 })).toBeCloseTo(wearPerSecond(box, { ...dry, inDanger: true }) * 0.4);
  });
  it('reste légère : une heure déséquilibrée coûte moins que l’état entier', () => {
    expect(wearPerSecond(box, { ...dry, unbalanced: true }) * 3600).toBeLessThan(0.7);
  });
  const sim = (loadFrac: number, windKmh: number, seconds: number, mult = 1) => {
    let b = 0, max = 0, over = 0;
    for (let t = 0; t < seconds; t++) { b = driftBalance(b, 1, t, { moving: true, loadFrac, windKmh, mult }); max = Math.max(max, Math.abs(b)); if (isUnbalanced(b)) over++; }
    return { b, max, over };
  };
  it('fait dériver l’équilibre en marchant, davantage avec la charge et le vent', () => {
    expect(driftBalance(0.3, 1, 10, { moving: true, loadFrac: 0, windKmh: 50, mult: 1 })).toBe(0);
    const light = sim(0.1, 0, 600), heavy = sim(1, 0, 600), windy = sim(0.1, 60, 600);
    expect(heavy.max).toBeGreaterThan(light.max); expect(windy.max).toBeGreaterThan(light.max);
    expect(light.over).toBe(0);
    expect(heavy.over).toBeGreaterThan(60);
    expect(heavy.max).toBeLessThanOrEqual(1);
    expect(sim(1, 0, 600, 0.5).over).toBeLessThan(heavy.over);
    for (let t = 0; t < 500; t += 7) expect(Math.abs(driftDir(t))).toBeLessThanOrEqual(1);
  });
  it('laisse l’équilibre revenir doucement à l’arrêt', () => {
    const b = driftBalance(0.8, 5, 0, { moving: false, loadFrac: 0.5, windKmh: 0, mult: 1 });
    expect(b).toBeGreaterThan(0.2); expect(b).toBeLessThan(0.5);
  });
  const walkCtx = { moving: true, running: false, loadFrac: 0, inShelter: false, shelterPerk: 1, drainMult: 1, restMult: 1 };
  it('fait baisser l’endurance en marchant selon la charge, et remonter à l’arrêt et dans un abri', () => {
    const empty = 1 - nextStamina(1, 60, walkCtx), full = 1 - nextStamina(1, 60, { ...walkCtx, loadFrac: 1 });
    expect(empty).toBeGreaterThan(0); expect(full).toBeGreaterThan(empty * 3);
    expect(1 - nextStamina(1, 60, { ...walkCtx, loadFrac: 1, running: true })).toBeGreaterThan(full);
    expect(1 - nextStamina(1, 60, { ...walkCtx, loadFrac: 1, drainMult: 0.55 })).toBeCloseTo(full * 0.55);
    const rest = nextStamina(0.2, 10, { ...walkCtx, moving: false }) - 0.2;
    const inside = nextStamina(0.2, 10, { ...walkCtx, inShelter: true }) - 0.2;
    const perk = nextStamina(0.2, 10, { ...walkCtx, inShelter: true, shelterPerk: 2 }) - 0.2;
    expect(rest).toBeGreaterThan(0); expect(inside).toBeCloseTo(rest * 2); expect(perk).toBeCloseTo(inside * 2);
    expect(nextStamina(0.01, 600, { ...walkCtx, loadFrac: 1 })).toBe(0);
    expect(nextStamina(0.99, 600, { ...walkCtx, moving: false })).toBe(1);
  });
});

describe('zones dangereuses', () => {
  const c = cellAt(BASE[0], BASE[1]);
  const ids = cellsAround(c, 6).map(k => k.id);
  it('sont reproductibles par case et par jour, quelques-unes par secteur', () => {
    const today = ids.map(id => dangerInCell(id, '2026-11-11', []));
    expect(today).toEqual(ids.map(id => dangerInCell(id, '2026-11-11', [])));
    const n = today.filter(Boolean).length;
    expect(n).toBeGreaterThan(ids.length * 0.1); expect(n).toBeLessThan(ids.length * 0.4);
    const tomorrow = ids.map(id => dangerInCell(id, '2026-11-12', []));
    expect(tomorrow.map(d => d?.id)).not.toEqual(today.map(d => d?.id));
  });
  it('restent dans leur case, avec un rayon raisonnable', () => {
    for (const id of ids) {
      const d = dangerInCell(id, '2026-11-11', []);
      if (!d) continue;
      expect(cellAt(d.at[0], d.at[1]).id).toBe(id);
      expect(d.radiusM).toBeGreaterThanOrEqual(50); expect(d.radiusM).toBeLessThanOrEqual(90);
      expect(insideDanger(d, d.at)).toBe(true);
    }
    expect(dangerInCell('pas-une-case', '2026-11-11', [])).toBeNull();
  });
  it('se tiennent à l’écart des abris', () => {
    const zones = ids.map(id => dangerInCell(id, '2026-11-11', [])).filter(d => d !== null);
    // Un abri posé au centre de chaque zone : elle doit se déplacer ou disparaître.
    const cells = ids.map(id => ({ id, shelters: zones.filter(z => cellAt(z.at[0], z.at[1]).id === id).map((z, i) => shelter(`${id}-${i}`, z.at)), parcels: [], roads: 1 }));
    const shelters = cells.flatMap(k => k.shelters);
    const moved = dangersFor(cells, '2026-11-11');
    expect(shelters.length).toBe(zones.length);
    for (const z of moved) for (const s of shelters) expect(dist(z.at, s.at)).toBeGreaterThan(z.radiusM + 60);
  });
});

describe('code du jeu', () => {
  it('n’utilise ni hasard non reproductible, ni écran, ni réseau', () => {
    const dir = new URL('../src/game/', import.meta.url);
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts') && n !== 'mock.ts' && n !== 'api.ts')) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/Math\.random|\bdocument\.|\bwindow\.|\bfetch\(|navigator\./);
      if (f !== 'save.ts') expect(src, f).not.toMatch(/localStorage/);
    }
  });
});
