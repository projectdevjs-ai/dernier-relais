// Faux état de jeu pour développer la scène 3D et l'interface sans attendre la logique.
import type { LngLat } from '../core/geo';
import type { GameView, OrderView, ShelterView } from './api';

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
    { id: 'o2', name: 'Semences', crate: 'carton', weightKg: 2, fragile: false, at: off(-12, 14), destId: 's3', destName: shelters[2].name, destAt: shelters[2].at, state: 'révélé', condition: 1, minutesLeft: null, reward: 45, distanceM: 18, inRange: true },
    { id: 'o3', name: 'Médicaments', crate: 'plastique', weightKg: 3, fragile: true, at: off(-90, -40), destId: 's2', destName: shelters[1].name, destAt: shelters[1].at, state: 'porté', condition: 0.86, minutesLeft: 7, reward: 120, distanceM: 32, inRange: false },
    { id: 'o4', name: 'Outils', crate: 'bois', weightKg: 9, fragile: false, at: off(120, -150), destId: 's4', destName: shelters[3].name, destAt: shelters[3].at, state: 'porté', condition: 0.97, minutesLeft: -3, reward: 95, distanceM: 412, inRange: false },
  ];
  return {
    player: { at: c, headingDeg: (t * 20) % 360, speedMps: 1.3, moving: true, mode: 'simulé', level: 4, xp: 310, xpNext: 500, stamina: 0.62, skillPoints: 2, carriedKg: 12, capacityKg: 20, balance: Math.sin(t / 3) * 0.5, score: 2860, deliveries: 31, distanceKm: 18.4 },
    scanner: { ready: t % 12 > 8, cooldownLeftS: Math.max(0, 8 - (t % 12)), cooldownS: 8, rangeM: 160 },
    weather: { kind: 'pluie', windKmh: 22, tempC: 9, night: false, sunAltDeg: 18 },
    orders, shelters,
    dangers: [{ id: 'd1', at: off(150, 40), radiusM: 70, inside: false }],
    skills: [
      { id: 'scan-portee', branch: 'scanner', name: 'Antenne longue', desc: 'Portée du scanner +40 m par rang.', rank: 1, maxRank: 3, cost: 1, available: true },
      { id: 'scan-recharge', branch: 'scanner', name: 'Condensateur', desc: 'Recharge du scanner −1 s par rang.', rank: 0, maxRank: 3, cost: 1, available: true },
      { id: 'sac', branch: 'portage', name: 'Armature renforcée', desc: 'Capacité du sac +5 kg par rang.', rank: 2, maxRank: 4, cost: 2, available: true },
      { id: 'souffle', branch: 'endurance', name: 'Second souffle', desc: 'L’endurance revient 20 % plus vite.', rank: 0, maxRank: 2, cost: 2, available: true },
      { id: 'relais', branch: 'réseau', name: 'Voix du réseau', desc: 'Points d’abri +10 % par rang.', rank: 0, maxRank: 3, cost: 3, available: false },
    ],
    contracts: [
      { id: 'c1', period: 'jour', label: 'Livrer 3 colis', progress: 2, goal: 3, reward: 150, done: false, claimed: false },
      { id: 'c2', period: 'jour', label: 'Marcher 2 km', progress: 2, goal: 2, reward: 100, done: true, claimed: false },
      { id: 'c3', period: 'semaine', label: 'Obtenir 5 notes A ou S', progress: 1, goal: 5, reward: 600, done: false, claimed: false },
    ],
    visited: [], loadedCells: [],
  };
}
