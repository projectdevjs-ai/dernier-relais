// CONTRAT entre les trois parties du jeu. Ne pas modifier sans prévenir les autres :
//   src/game    la logique (aucun accès à l'écran), produit un GameView
//   src/render  la scène 3D sur la carte, affiche un GameView
//   src/ui      l'interface (HUD, fiches, panneaux), affiche un GameView et appelle les actions
import type { LngLat } from '../core/geo';
import type { Fix } from '../player/gps';
import type { CellContent, ShelterKind } from '../world/types';

export type Grade = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
export type NpcId = 'mara' | 'tomas' | 'agathe' | 'kenji';
export type CrateKind = 'bois' | 'alu' | 'plastique' | 'carton';

/** Portées de base, en mètres. Les compétences peuvent les augmenter. */
export const RANGE = { pickup: 30, deliver: 40, scan: 160 } as const;

export interface OrderView {
  id: string;
  /** Nom court affichable : « Médicaments », « Pièces de pompe »… */
  name: string;
  crate: CrateKind;
  weightKg: number;
  fragile: boolean;
  /** Où ramasser le colis. */
  at: LngLat;
  destId: string;
  destName: string;
  destAt: LngLat;
  /** 'révélé' : vu au scanner, à ramasser. 'porté' : dans le sac. Les colis non scannés ne sont jamais exposés. */
  state: 'révélé' | 'porté';
  /** État du colis, de 1 (intact) à 0 (détruit). */
  condition: number;
  /** Minutes restantes avant la fin du délai, null si pas de délai. Peut être négatif (en retard). */
  minutesLeft: number | null;
  /** Points de base à la livraison, avant le multiplicateur de note. */
  reward: number;
  /** Distance du joueur au point de ramassage (révélé) ou à l'abri destinataire (porté). */
  distanceM: number;
  /** Vrai si le joueur est assez près pour ramasser (révélé). */
  inRange: boolean;
}

export interface ShelterView {
  id: string;
  name: string;
  kind: ShelterKind;
  at: LngLat;
  npc: NpcId;
  /** 0 à 5. Le PNJ reste masqué tant que stars vaut 0. */
  stars: number;
  points: number;
  /** Points nécessaires pour l'étoile suivante, null à 5 étoiles. */
  nextStarAt: number | null;
  /** Ce que débloque la prochaine étoile, phrase courte. */
  nextUnlock: string | null;
  distanceM: number;
  /** Vrai si le joueur est assez près pour livrer ou parler. */
  inRange: boolean;
  /** Colis portés destinés à cet abri. */
  deliverable: string[];
  /** Réplique du PNJ adaptée à la situation. */
  line: string;
}

export interface PlayerView {
  at: LngLat | null;
  /** Cap en degrés, 0 = nord, sens horaire. */
  headingDeg: number;
  speedMps: number;
  moving: boolean;
  mode: 'gps' | 'simulé';
  level: number;
  xp: number;
  xpNext: number;
  /** 0 à 1. */
  stamina: number;
  skillPoints: number;
  carriedKg: number;
  capacityKg: number;
  /** Équilibre de la charge, de -1 (penche à gauche) à 1 (à droite). 0 = stable. */
  balance: number;
  /** Total de points gagnés. */
  score: number;
  deliveries: number;
  distanceKm: number;
}

export interface ScannerView { ready: boolean; cooldownLeftS: number; cooldownS: number; rangeM: number }

export type WeatherKind = 'clair' | 'nuages' | 'pluie' | 'orage' | 'neige' | 'brouillard';
export interface Weather { kind: WeatherKind; windKmh: number; tempC: number; night: boolean; /** hauteur du soleil en degrés */ sunAltDeg: number }

export type SkillBranch = 'scanner' | 'portage' | 'endurance' | 'réseau';
export interface SkillView {
  id: string; branch: SkillBranch; name: string; desc: string;
  rank: number; maxRank: number; cost: number;
  /** Achetable maintenant (points suffisants, prérequis remplis, rang maximal non atteint). */
  available: boolean;
}
export interface ContractView {
  id: string; period: 'jour' | 'semaine'; label: string;
  progress: number; goal: number; reward: number; done: boolean; claimed: boolean;
}
export interface DangerView { id: string; at: LngLat; radiusM: number; /** vrai si le joueur est dedans */ inside: boolean }

export interface GameView {
  player: PlayerView;
  scanner: ScannerView;
  weather: Weather;
  orders: OrderView[];
  shelters: ShelterView[];
  dangers: DangerView[];
  skills: SkillView[];
  contracts: ContractView[];
  /** Identifiants des cases déjà parcourues (brume d'exploration). */
  visited: string[];
  /** Cases actuellement chargées autour du joueur. */
  loadedCells: string[];
}

export interface DeliveryResult {
  orderId: string; orderName: string; shelterId: string; shelterName: string; npc: NpcId;
  grade: Grade; condition: number; onTime: boolean;
  /** Points gagnés, multiplicateur de note compris. */
  points: number; xp: number;
  /** Détail lisible de la note : « État 92 % », « Dans les temps », « Sous la pluie »… */
  notes: string[];
  starsBefore: number; starsAfter: number;
  /** Ce que la nouvelle étoile a débloqué, sinon null. */
  unlock: string | null;
  levelUp: boolean;
}

export type GameEvent =
  | { type: 'scan'; found: number }
  | { type: 'pickup'; order: OrderView }
  | { type: 'drop'; orderId: string }
  | { type: 'delivery'; result: DeliveryResult }
  | { type: 'levelUp'; level: number }
  | { type: 'contract'; contract: ContractView }
  | { type: 'danger'; entered: boolean }
  | { type: 'toast'; text: string; tone?: 'info' | 'good' | 'warn' };

export type ActionResult = { ok: true } | { ok: false; why: string };

/** Ce que l'interface peut demander au jeu. Toutes les actions sont synchrones. */
export interface GameActions {
  scan(): ActionResult;
  pickup(orderId: string): ActionResult;
  drop(orderId: string): ActionResult;
  /** Livre tous les colis portés destinés à cet abri. */
  deliver(shelterId: string): ActionResult;
  /** Recentre la charge (geste du joueur quand l'équilibre dérive). */
  steady(): void;
  learn(skillId: string): ActionResult;
  claim(contractId: string): ActionResult;
}

/** Le moteur de jeu, implémenté dans src/game/game.ts (export class Game implements GameEngine). */
export interface GameEngine extends GameActions {
  /** Charge la sauvegarde. À appeler une fois avant tout le reste. */
  load(): Promise<void>;
  /** Cases du monde actuellement chargées (appelé à chaque changement). */
  setWorld(cells: CellContent[]): void;
  setWeather(w: Weather): void;
  setPosition(fix: Fix): void;
  /** Fait avancer le temps de jeu. dtS = secondes écoulées depuis le dernier appel. */
  tick(dtS: number): void;
  view(): GameView;
  /** S'abonne aux événements. Renvoie la fonction de désabonnement. */
  on(fn: (e: GameEvent) => void): () => void;
}

/** La scène 3D, implémentée dans src/render/stage.ts (export class Stage implements StageApi). */
export interface StageApi {
  /** Affiche l'état du jeu. Appelé souvent : ne recréer que ce qui a changé. */
  sync(view: GameView): void;
  /** Onde du scanner autour du joueur. */
  pulseScan(rangeM: number): void;
  /** Petite animation de réussite sur un abri (étoile gagnée, livraison). */
  celebrate(shelterId: string): void;
  setAmbiance(a: Ambiance): void;
  /** Recentre la caméra sur le joueur et reprend le suivi. */
  recenter(): void;
  /** Déplace la caméra sans attendre le joueur (lieux de test). */
  jumpTo(at: LngLat): void;
}
/** 'crépuscule' : palette sombre vert nuit et ambre. 'clair' : monde lumineux. */
export type Ambiance = 'crépuscule' | 'clair';
export interface StageEvents {
  /** Le joueur touche la carte à un endroit vide. */
  onTapGround(at: LngLat): void;
  onTapShelter(id: string): void;
  onTapOrder(id: string): void;
}

/** L'interface, implémentée dans src/ui/hud.ts (export class Hud implements HudApi). */
export interface HudApi {
  render(view: GameView): void;
  /** Réagit aux événements du jeu (toasts, écran de note, étoile gagnée…). */
  handle(e: GameEvent): void;
  openShelter(id: string): void;
  openOrder(id: string): void;
}
export interface HudEvents {
  actions: GameActions;
  /** Demandes qui ne concernent pas la logique du jeu. */
  onUseGps(): void;
  onRecenter(): void;
  onAmbiance(a: Ambiance): void;
  /** Aller à un lieu de test en position simulée. */
  onGoto(at: LngLat, label: string): void;
}
