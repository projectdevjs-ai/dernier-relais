// Faux état de jeu pour développer la scène 3D et l'interface sans attendre la logique.
import type { LngLat } from '../core/geo';
import type { GameView, OrderView, ShelterView, SpecialKind } from './api';

export function mockView(c: LngLat = [-1.5761, 47.1822], t = 0): GameView {
  const off = (dx: number, dy: number): LngLat => [c[0] + dx / 75000, c[1] + dy / 111000];
  const shelters: ShelterView[] = [
    { id: 's1', name: 'École maternelle Le Corbusier', kind: 'savoir', at: off(-180, 120), npc: 'mara', stars: 2, points: 340, nextStarAt: 600, nextUnlock: 'Atelier de réparation des caisses', distanceM: 216, inRange: false, deliverable: [], line: 'Te revoilà. Les enfants demandent quand la lumière reviendra.' },
    { id: 's2', name: 'Pharmacie des Couëts', kind: 'soin', at: off(25, -20), npc: 'agathe', stars: 0, points: 0, nextStarAt: 100, nextUnlock: 'Rencontre avec le responsable de l’abri', distanceM: 32, inRange: true, deliverable: ['o3'], line: '…' },
    { id: 's3', name: 'Relais du carrefour', kind: 'carrefour', at: off(260, 210), npc: 'tomas', stars: 5, points: 2400, nextStarAt: null, nextUnlock: null, distanceM: 334, inRange: false, deliverable: [], line: 'Cinq étoiles. On a fait du bon travail, toi et moi.' },
    { id: 's4', name: 'Mairie annexe', kind: 'mairie', at: off(-320, -260), npc: 'kenji', stars: 1, points: 120, nextStarAt: 300, nextUnlock: 'Contrats de la semaine', distanceM: 412, inRange: false, deliverable: ['o4'], line: 'Le réseau tient à un fil. Chaque colis compte.' },
  ];
  const orders: OrderView[] = [
    { id: 'o1', name: 'Pièces de pompe', crate: 'alu', weightKg: 6, fragile: false, at: off(40, 60), destId: 's1', destName: shelters[0].name, destAt: shelters[0].at, state: 'révélé', condition: 1, minutesLeft: 42, reward: 80, distanceM: 72, inRange: false },
    { id: 'o2', name: 'Engrais', crate: 'carton', weightKg: 2, fragile: false, at: off(-12, 14), destId: 's3', destName: shelters[2].name, destAt: shelters[2].at, state: 'révélé', condition: 1, minutesLeft: null, reward: 45, distanceM: 18, inRange: true },
    { id: 'o3', name: 'Médicaments', crate: 'plastique', weightKg: 3, fragile: true, at: off(-90, -40), destId: 's2', destName: shelters[1].name, destAt: shelters[1].at, state: 'porté', condition: 0.86, minutesLeft: 7, reward: 120, distanceM: 32, inRange: false, slot: 'brasG' },
    { id: 'o4', name: 'Outils', crate: 'bois', weightKg: 9, fragile: false, at: off(120, -150), destId: 's4', destName: shelters[3].name, destAt: shelters[3].at, state: 'porté', condition: 0.97, minutesLeft: -3, reward: 95, distanceM: 412, inRange: false, slot: 'dos' },
  ];
  return {
    player: { at: c, headingDeg: (t * 20) % 360, speedMps: 1.3, moving: true, mode: 'simulé', level: 4, xp: 310, xpNext: 500, stamina: 0.62, skillPoints: 2, carriedKg: 12, capacityKg: 44, balance: Math.sin(t / 3) * 0.5, score: 2860, deliveries: 31, distanceKm: 18.4,
      // Rangement : attaches de bras installées, un colis au dos et un au bras gauche.
      exoTier: 1, lean: -0.2, sides: { leftKg: 3, rightKg: 0, armsKg: 3, legsKg: 0 },
      slots: [
        { id: 'dos', name: 'Dos', side: 0, unlocked: true, maxKg: 20, kg: 9, orders: ['o4'] },
        { id: 'brasG', name: 'Bras gauche', side: -1, unlocked: true, maxKg: 12, kg: 3, orders: ['o3'] },
        { id: 'brasD', name: 'Bras droit', side: 1, unlocked: true, maxKg: 12, kg: 0, orders: [] },
        { id: 'jambeG', name: 'Jambe gauche', side: -1, unlocked: false, lockedWhy: 'Attaches de jambes à installer chez Noé, au labo', maxKg: 9, kg: 0, orders: [] },
        { id: 'jambeD', name: 'Jambe droite', side: 1, unlocked: false, lockedWhy: 'Attaches de jambes à installer chez Noé, au labo', maxKg: 9, kg: 0, orders: [] },
      ],
      exo: [
        { tier: 0, name: 'Harnais dorsal', desc: 'Fixations du dos : tes colis voyagent sur ton dos.', installed: true, level: 1 },
        { tier: 1, name: 'Attaches de bras', desc: 'Deux fixations aux bras (12 kg chacune). La charge tangue un peu plus.', installed: true, level: 2 },
        { tier: 2, name: 'Attaches de jambes', desc: 'Deux fixations aux cuisses (9 kg chacune). Fatiguent davantage.', installed: false, level: 4 },
        { tier: 3, name: 'Stabilisateurs gyroscopiques', desc: 'La charge dérive 20 % moins, rafales comprises.', installed: false, level: 7 },
      ],
    },
    scanner: { ready: t % 12 > 8, cooldownLeftS: Math.max(0, 8 - (t % 12)), cooldownS: 8, rangeM: 160 },
    weather: { kind: 'pluie', windKmh: 22, tempC: 9, night: false, sunAltDeg: 18 },
    orders, shelters,
    dangers: [{ id: 'd1', at: off(150, 40), radiusM: 70, inside: false }],
    skills: [
      { id: 'scan-portee', branch: 'scanner', name: 'Antenne longue', desc: 'Portée du scanner +40 m par rang.', rank: 1, maxRank: 3, cost: 1, available: true },
      { id: 'scan-recharge', branch: 'scanner', name: 'Condensateur', desc: 'Recharge du scanner −2 s par rang.', rank: 0, maxRank: 3, cost: 1, available: true },
      { id: 'sac', branch: 'portage', name: 'Armature renforcée', desc: 'Capacité du sac +5 kg par rang.', rank: 2, maxRank: 4, cost: 2, available: true },
      { id: 'exo-bras', branch: 'portage', name: 'Attaches de bras', desc: 'Noé l’installe au labo. Deux fixations aux bras (12 kg chacune). La charge tangue un peu plus.', rank: 1, maxRank: 1, cost: 1, available: false, needsLevel: 2, exoTier: 1 },
      { id: 'exo-jambes', branch: 'portage', name: 'Attaches de jambes', desc: 'Noé l’installe au labo. Deux fixations aux cuisses (9 kg chacune). Fatiguent davantage.', rank: 0, maxRank: 1, cost: 2, available: true, needsLevel: 4, exoTier: 2 },
      { id: 'exo-gyro', branch: 'portage', name: 'Stabilisateurs gyroscopiques', desc: 'Noé l’installe au labo. La charge dérive 20 % moins, rafales comprises.', rank: 0, maxRank: 1, cost: 3, available: false, needsLevel: 7, exoTier: 3 },
      { id: 'souffle', branch: 'endurance', name: 'Second souffle', desc: 'L’endurance revient 20 % plus vite.', rank: 0, maxRank: 2, cost: 2, available: true },
      { id: 'relais', branch: 'réseau', name: 'Voix du réseau', desc: 'Points d’abri +10 % par rang.', rank: 0, maxRank: 3, cost: 3, available: false },
    ],
    contracts: [
      { id: 'c1', period: 'jour', label: 'Livrer 3 colis', progress: 2, goal: 3, reward: 150, done: false, claimed: false },
      { id: 'c2', period: 'jour', label: 'Marcher 2 km', progress: 2, goal: 2, reward: 100, done: true, claimed: false },
      { id: 'c3', period: 'semaine', label: 'Obtenir 5 notes A ou S', progress: 1, goal: 5, reward: 600, done: false, claimed: false },
    ],
    visited: [], loadedCells: [],
    caches: [], wanderers: [], fronts: [], jams: [],
  };
}

/** Éléments des systèmes secondaires à ajouter au faux état (démos du rendu et de l'interface). */
export interface MockEvents {
  /** Le colis o2 devient un colis spécial ; 'inconnu' : pas encore écouté (« signal inhabituel »). */
  special?: SpecialKind | 'inconnu';
  /** Le colis porté o3 devient un colis spécial identifié. */
  carriedSpecial?: SpecialKind;
  /** Le colis o1 devient un colis perdu. */
  lost?: boolean;
  /** 'proche' : à portée d'ouverture. */
  cache?: boolean | 'proche';
  wanderer?: boolean | 'proche';
  /** 'dedans' : le joueur est dans le front. */
  front?: boolean | 'dedans';
  /** 'proche' : le joueur est à l'abri débordé. */
  jam?: boolean | 'proche' | 'en cours';
  /** Le colis porté o4 vient d'être ramassé : geste d'arrimage encore possible. */
  strap?: boolean;
}
const SPECIAL_TEXT: Record<SpecialKind, [label: string, rule: string, kg: number]> = {
  cryo: ['Caisson cryogénique', 'Se réchauffe : perd 3 % d’état par minute dès que tu le prends. Livre vite.', 8],
  ruche: ['Ruche vivante', 'Ne cours pas : chaque foulée de course l’abîme.', 11],
  boitenoire: ['Boîte noire', 'Très bien payée, mais le délai est très court.', 6],
  batterie: ['Cellule instable', 'Très lourde : elle remplit presque le sac et te fatigue plus vite.', 16],
};
/**
 * Ajoute au faux état les éléments demandés, placés devant le joueur : `off(droite, devant)` en mètres,
 * dans le repère de la caméra (`bearingDeg` : cap de la caméra, celui de la scène par défaut).
 */
export function withEvents(v: GameView, x: MockEvents, t = 0, bearingDeg = -18): GameView {
  const c = v.player.at ?? [-1.5761, 47.1822], b = (bearingDeg * Math.PI) / 180;
  const off = (right: number, ahead: number): LngLat =>
    [c[0] + (right * Math.cos(b) + ahead * Math.sin(b)) / 75000, c[1] + (ahead * Math.cos(b) - right * Math.sin(b)) / 111000];
  for (const o of v.orders) Object.assign(o, { special: null, lost: null, jamId: null, inspected: o.state === 'porté', canInspect: o.state === 'révélé' && o.distanceM <= 60, strap: null, strapLeftS: 0 });
  const o1 = v.orders.find(o => o.id === 'o1'), o2 = v.orders.find(o => o.id === 'o2'), o3 = v.orders.find(o => o.id === 'o3'), o4 = v.orders.find(o => o.id === 'o4');
  if (x.special && o2) {
    const kind = x.special === 'inconnu' ? 'ruche' : x.special, known = x.special !== 'inconnu', [label, rule, kg] = SPECIAL_TEXT[kind];
    Object.assign(o2, { name: known ? label : 'Signal inhabituel', special: { kind, label, rule, known }, inspected: known, canInspect: !known, weightKg: kg, reward: 310, crate: kind === 'ruche' ? 'bois' : 'alu', fragile: kind === 'cryo', minutesLeft: kind === 'boitenoire' ? 7 : null, at: off(-9, 22), distanceM: 24, inRange: true });
  }
  if (x.carriedSpecial && o3) {
    const [label, rule, kg] = SPECIAL_TEXT[x.carriedSpecial];
    Object.assign(o3, { name: label, special: { kind: x.carriedSpecial, label, rule, known: true }, weightKg: kg, reward: 340, crate: 'alu', fragile: x.carriedSpecial === 'cryo', minutesLeft: x.carriedSpecial === 'boitenoire' ? 4 : null, condition: 0.91 });
  }
  if (x.lost && o1) Object.assign(o1, { name: 'Livres', crate: 'carton', lost: { by: 'Lina' }, minutesLeft: null, reward: 105, inspected: true, canInspect: false, at: off(15, 46), distanceM: 48 });
  if (x.strap && o4) Object.assign(o4, { strapLeftS: 8 });
  if (x.cache) v.caches = [x.cache === 'proche'
    ? { id: 'k1', at: off(9, 10), distanceM: 13, inRange: true }
    : { id: 'k1', at: off(8, 30), distanceM: 31, inRange: false }];
  if (x.wanderer) {
    // Aller-retour le long d'une rue, 1,1 m/s, avec une halte à chaque bout.
    const span = 36, lap = 2 * (span / 1.1 + 10), s = t % lap, half = lap / 2, back = s >= half, u = Math.min(1, Math.max(0, ((back ? s - half : s) - 10) / (span / 1.1)));
    const k = back ? 1 - u : u, near = x.wanderer === 'proche';
    v.wanderers = [{ id: 'w1', name: 'Lina', at: near ? off(-13, 7) : off(-20 + span * k, 44), headingDeg: near ? bearingDeg + 130 : bearingDeg + (back ? 270 : 90), moving: !near && u > 0 && u < 1, met: false, distanceM: near ? 15 : 48, inRange: near }];
  }
  if (x.front) {
    const inside = x.front === 'dedans';
    v.fronts = [{ id: 'f1', at: inside ? off(10, 60 - t * 0.67) : off(40, 240 - t * 0.67), radiusM: 160, headingDeg: bearingDeg + 180, speedMps: 0.67, inside, distanceM: inside ? 0 : 140, etaS: inside ? 0 : 150 }];
  }
  if (x.jam) {
    const s = v.shelters.find(sh => sh.id === 's2') ?? v.shelters[0], going = x.jam === 'en cours';
    if (s) { s.at = off(20, 58); s.distanceM = 61; s.inRange = !going && x.jam !== true; }
    if (s) v.jams = [{ id: 'j1', shelterId: s.id, shelterName: s.name, at: s.at, state: going ? 'en cours' : 'proposé', count: 3, delivered: going ? 1 : 0, minutes: 22, minutesLeft: going ? 14 : null, bonus: 85, distanceM: s.distanceM, inRange: !going && s.inRange }];
  }
  return v;
}
