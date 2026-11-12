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

/** Colis spéciaux : rares, une contrainte propre, une grosse récompense. */
export type SpecialKind = 'batterie' | 'boitenoire' | 'cryo' | 'ruche';
export interface SpecialView {
  kind: SpecialKind;
  /** « Ruche vivante »… */
  label: string;
  /** La contrainte, en une phrase. */
  rule: string;
  /** Faux tant que le colis n'a été ni écouté ni ramassé : l'interface montre alors un « signal inhabituel » sans dire lequel. */
  known: boolean;
}

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
  // ── Ajouts (systèmes secondaires). Tous facultatifs : un OrderView sans eux reste valide.
  /** Colis spécial. Tant que `known` est faux, `name` vaut « Signal inhabituel ». */
  special?: SpecialView | null;
  /** Colis perdu par un autre porteur, à ramener à son abri. */
  lost?: { by: string } | null;
  /** Fait partie d'un embouteillage de colis (identifiant du JamView). */
  jamId?: string | null;
  /** Le contenu est connu (colis écouté ou déjà ramassé). Sinon l'interface ne dit pas s'il est fragile. */
  inspected?: boolean;
  /** Vrai si le joueur peut l'écouter maintenant (révélé, pas encore écouté, assez près). */
  canInspect?: boolean;
  /** Qualité de l'arrimage, de 0 à 1 ; null si le colis n'a pas été arrimé. */
  strap?: number | null;
  /** Secondes restantes pour faire le geste d'arrimage (0 : trop tard, déjà fait ou colis au sol). */
  strapLeftS?: number;
  /** Colis de la chaîne de relais (pris dans un abri-relais) : identifiant du relais en ligne. */
  relay?: { id: string } | null;
}

/** Chaîne de relais : part des points de base versée au dépôt (au prorata du chemin fait), et part des points de livraison versée à chaque porteur de la chaîne. */
export const RELAY = { dropShare: 0.4, chainShare: 0.6, minProgress: 0.1 } as const;
/** Un colis tel qu'il voyage dans la chaîne de relais (même forme que RelayParcel côté réseau). */
export interface RelayCrate {
  name: string; crate: CrateKind; weightKg: number; fragile: boolean;
  /** Points de base à la livraison (avant les avantages de l'abri et la note). */
  reward: number;
  destId: string; destName: string; destAt: LngLat;
  /** État du colis, 0 à 1 (1 par défaut). */
  condition?: number;
}
/** Résultat d'un dépôt en relais : le colis à confier au réseau et l'avance gagnée. */
export type RelayGiveResult = ActionResult & {
  parcel?: RelayCrate;
  /** Abri où le colis est déposé. */
  shelterId?: string;
  /** Avance de points versée au dépôt. */
  points?: number;
  /** Présent si le colis venait déjà de la chaîne : le relais à reposer. */
  relayId?: string;
};

/** Cache repérée au scanner (à courte portée), à ouvrir sur place. Une fois par jour chacune. */
export interface CacheView { id: string; at: LngLat; distanceM: number; inRange: boolean }
/** Voyageur amical qui marche dans le quartier. Même position pour tous les joueurs au même instant. */
export interface WandererView {
  id: string; name: string; at: LngLat;
  /** Cap en degrés, 0 = nord. */
  headingDeg: number;
  /** Faux pendant ses haltes. */
  moving: boolean;
  /** Le joueur lui a déjà parlé. */
  met: boolean;
  distanceM: number;
  /** Assez près pour lui parler. */
  inRange: boolean;
}
/** Front de mauvais temps : un grand disque qui traverse lentement le secteur. */
export interface FrontView {
  id: string; at: LngLat; radiusM: number;
  /** Direction du déplacement, en degrés (0 = vers le nord). */
  headingDeg: number;
  speedMps: number;
  inside: boolean;
  /** Distance du joueur au bord du front (0 s'il est dedans). */
  distanceM: number;
  /** Secondes avant que le front atteigne le joueur s'il ne bouge pas ; null s'il passe à côté ou s'éloigne. */
  etaS: number | null;
}
/** Embouteillage de colis : un abri débordé confie plusieurs colis d'un coup, avec un bonus si tous arrivent à temps. */
export interface JamView {
  id: string; shelterId: string; shelterName: string; at: LngLat;
  state: 'proposé' | 'en cours';
  /** Nombre de colis du lot, et nombre déjà livrés. */
  count: number; delivered: number;
  /** Temps accordé, en minutes, et temps restant (null tant que le lot n'est pas pris). */
  minutes: number; minutesLeft: number | null;
  /** Points de bonus si tout est livré à temps. */
  bonus: number;
  distanceM: number;
  /** Assez près de l'abri pour prendre le lot. */
  inRange: boolean;
}
/** Colis perdu venu d'un autre joueur (réseau). Voir Game.setNetworkLost. */
export interface LostInput {
  id: string; at: LngLat; name: string; crate: CrateKind; weightKg: number; fragile: boolean;
  destId: string; destName: string; destAt: LngLat;
  /** Nom du porteur qui l'a abandonné. */
  by: string;
  /** État du colis, 0 à 1 (1 par défaut). */
  condition?: number;
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
  // ── Ajouts (systèmes secondaires). Facultatifs : une vue sans eux reste valide (listes vides).
  /** Caches repérées et pas encore ouvertes. */
  caches?: CacheView[];
  wanderers?: WandererView[];
  fronts?: FrontView[];
  jams?: JamView[];
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
  // ── Ajouts
  /** Sorte du colis spécial livré. */
  special?: SpecialKind | null;
  /** Colis perdu ramené : nom du porteur qui l'avait abandonné. */
  lostBy?: string | null;
  /** Points offerts pour une photo-preuve (action `proof`), 0 ou absent si rien à gagner. */
  proofBonus?: number;
  /** Colis de la chaîne de relais : identifiant du relais à déclarer livré (net.deliverRelay). */
  relayId?: string | null;
}

export type GameEvent =
  | { type: 'scan'; found: number; /** caches repérées par ce balayage */ caches?: number }
  | { type: 'pickup'; order: OrderView }
  | { type: 'drop'; orderId: string }
  | { type: 'delivery'; result: DeliveryResult }
  | { type: 'levelUp'; level: number }
  | { type: 'contract'; contract: ContractView }
  | { type: 'danger'; entered: boolean }
  | { type: 'toast'; text: string; tone?: 'info' | 'good' | 'warn' }
  // ── Ajouts (systèmes secondaires)
  | { type: 'special'; order: OrderView }
  | { type: 'cache'; cacheId: string; points: number; xp: number; skillPoint: boolean }
  | { type: 'wanderer'; id: string; name: string; /** ce qu'il dit */ line: string; gift: 'cache' | 'colis' | 'endurance' | 'xp' }
  | { type: 'front'; phase: 'approche' | 'entrée' | 'sortie'; /** secondes avant l'arrivée (phase « approche ») */ etaS?: number }
  | { type: 'jam'; phase: 'début' | 'réussi' | 'raté'; jam: JamView; /** points gagnés (phase « réussi ») */ bonus?: number }
  | { type: 'inspect'; order: OrderView; xp: number }
  | { type: 'strap'; orderId: string; quality: number; xp: number }
  | { type: 'proof'; orderId: string; points: number };

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
  // ── Ajouts (systèmes secondaires) : tous facultatifs pour le joueur.
  /** Ouvre une cache repérée, sur place. */
  openCache(cacheId: string): ActionResult;
  /** Parle à un rôdeur tout proche : un petit cadeau ou une information, une fois chacun. */
  talk(wandererId: string): ActionResult;
  /** Prend le lot de colis d'un abri débordé (il faut être à l'abri). Le compte à rebours démarre. */
  startJam(jamId: string): ActionResult;
  /** Écoute un colis révélé proche : dit s'il est fragile ou spécial. */
  inspect(orderId: string): ActionResult;
  /** Geste d'arrimage juste après le ramassage. `quality` de 0 à 1 (voir strapQuality dans gestures.ts). */
  strap(orderId: string, quality: number): ActionResult;
  /** Photo-preuve prise pour une livraison qui vient d'avoir lieu : petit bonus de points. */
  proof(orderId: string): ActionResult;
  // ── Chaîne de relais (facultatif : un jeu sans relais reste valide). Le réseau est appelé par l'appelant, pas par le jeu.
  /**
   * Laisse un colis porté dans l'abri-relais où se trouve le joueur (`shelterId`, par défaut l'abri le plus proche à portée).
   * Le colis quitte le sac et le joueur touche une avance. `dryRun` : vérifie et calcule sans rien changer.
   */
  giveToRelay?(orderId: string, shelterId?: string, dryRun?: boolean): RelayGiveResult;
  /** Met dans le sac un colis pris à la chaîne de relais (il faut être à un abri). `dryRun` : vérifie sans rien changer. */
  takeFromRelay?(relay: { id: string; parcel: RelayCrate }, dryRun?: boolean): ActionResult;
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
  /** Ajout facultatif : crédite des points venus d'ailleurs (récompense de relais). `reason` est affiché au joueur. */
  credit?(points: number, reason?: string): void;
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
  /** Ajouts facultatifs : toucher une cache ou un rôdeur. Sans eux, le toucher compte comme « sol ». */
  onTapCache?(id: string): void;
  onTapWanderer?(id: string): void;
}

/** L'interface, implémentée dans src/ui/hud.ts (export class Hud implements HudApi). */
export interface HudApi {
  render(view: GameView): void;
  /** Réagit aux événements du jeu (toasts, écran de note, étoile gagnée…). */
  handle(e: GameEvent): void;
  openShelter(id: string): void;
  openOrder(id: string): void;
  /** Ajouts facultatifs : réaction au toucher d'une cache ou d'un rôdeur dans la scène. */
  openCache?(id: string): void;
  openWanderer?(id: string): void;
  /** Ajout facultatif : l'état en ligne a changé (niveau collectif, relais) : le panneau d'abri ouvert relit ses données. */
  refreshOnline?(): void;
}
export interface HudEvents {
  actions: GameActions;
  /** Demandes qui ne concernent pas la logique du jeu. */
  onUseGps(): void;
  onRecenter(): void;
  onAmbiance(a: Ambiance): void;
  /** Aller à un lieu de test en position simulée. */
  onGoto(at: LngLat, label: string): void;
  // ── Ajouts facultatifs : un bouton ou une section n'apparaît que si ce qu'il lui faut est fourni.
  /** Ouvrir la carte du réseau (le HUD n'importe pas le réseau : c'est l'appelant qui ouvre le panneau). */
  onNetwork?(): void;
  /** Le jeu en ligne vu par l'interface : état, abris collectifs, chaîne de relais. */
  online?: HudOnline;
  /** Le nom de porteur du joueur. */
  pseudo?: HudPseudo;
  onSound?(on: boolean): void;
  onVoices?(on: boolean): void;
  onHaptics?(on: boolean): void;
  /** Volume général, de 0 à 1. */
  onVolume?(v: number): void;
  onReplayIntro?(): void;
  onLab?(): void;
  /** Lancer l'installation de l'application (le bouton n'apparaît que si `settings.canInstall` ou `Hud.setCanInstall(true)`). */
  onInstall?(): void;
  /** Sons d'interface : ouverture et fermeture de panneau, appui, action refusée, action confirmée. */
  onUi?(kind: UiKind): void;
}
export type UiKind = 'tap' | 'open' | 'close' | 'error' | 'confirm';
/** État initial des réglages affichés par le HUD (la mémorisation est faite par l'appelant). */
export interface HudSettings { sound?: boolean; voices?: boolean; haptics?: boolean; volume?: number; canInstall?: boolean }
export interface HudOptions { ambiance?: Ambiance; settings?: HudSettings }
/** Niveau collectif d'un abri (0 à 5), partagé entre tous les joueurs. */
export interface CollectiveView {
  level: number; points: number;
  /** Points du niveau suivant, null au niveau 5. */
  nextAt: number | null;
  /** Avancement vers le niveau suivant, 0 à 1. */
  progress: number;
}
/** Colis qui attend dans un abri-relais. */
export interface RelayOffer {
  id: string; parcel: RelayCrate;
  /** Nombre de porteurs qui se sont déjà relayés. */
  hops: number;
  /** Vrai si le joueur fait déjà partie de la chaîne (il ne peut pas reprendre son propre relais). */
  mine: boolean;
}
/** Fourni par l'appelant (voir src/net/link.ts). Aucune méthode ne lève d'exception ; hors ligne, tout renvoie une valeur neutre. */
export interface HudOnline {
  /** Lecture immédiate, sans appel réseau. */
  isOnline(): boolean;
  /** Niveau collectif de l'abri, null s'il est inconnu (hors ligne). */
  shelterLevel(shelterId: string): Promise<CollectiveView | null>;
  relaysAt(shelterId: string): Promise<RelayOffer[]>;
  /** Dépose un colis porté dans l'abri-relais. `points` : l'avance gagnée. */
  giveRelay(orderId: string, shelterId: string): Promise<ActionResult & { points?: number }>;
  takeRelay(offer: RelayOffer): Promise<ActionResult>;
}
export interface HudPseudo {
  get(): string;
  /** Faux tant que le joueur garde le nom généré sans l'avoir confirmé. */
  chosen(): boolean;
  /** Renvoie faux si le nom est refusé (2 à 20 caractères). */
  set(name: string): Promise<boolean>;
}
