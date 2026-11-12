// PROJECT REBIRTH — survie et combats tactiques, déterministes et jouables hors connexion.
import { hash } from '../core/geo';

export type Resource = 'scrap' | 'circuits' | 'rations' | 'medkits' | 'charges';
export type Resources = Record<Resource, number>;
export type Faction = 'lumen' | 'nomades' | 'archives';
export type Factions = Record<Faction, number>;
export type Recipe = 'ration' | 'medkit' | 'charge' | 'repair';
export type CombatMove = 'strike' | 'guard' | 'pulse' | 'evade' | 'focus' | 'feint';
export type EnemyIntent = 'charge' | 'strike' | 'sweep' | 'recover';
export type EnemyKind = 'scavenger' | 'drone' | 'stray';
export interface Encounter {
  id: string; kind: EnemyKind; name: string; title: string; subtitle: string;
  turn: number; hp: number; maxHp: number; guard: number; last: string;
  focus: number; stunned: number;
}
export interface Rebirth {
  resources: Resources; factions: Factions; integrity: number;
  encounter: Encounter | null; victories: number;
  radio: RadioSignal | null; radioLog: string[];
}
export interface RadioSignal { id: string; title: string; source: string; text: string; faction: Faction }
const SIGNALS: { title: string; source: string; text: string; faction: Faction }[] = [
  { title: 'ÉMISSION 07 · LE PHARE', source: 'Canal des Archives', faction: 'archives',
    text: 'Un relais autonome répète le même appel depuis dix-sept ans. Une signature humaine existe encore dans les données.' },
  { title: 'CANAL 13 · LES ERRANTS', source: 'Fréquence nomade', faction: 'nomades',
    text: 'Un groupe avance sans équipement dans la brume. Les survivants demandent des vivres. Les récupérateurs approchent.' },
  { title: 'MESSAGE 22 · ORIGINE', source: 'Station Lumen', faction: 'lumen',
    text: 'Les cartes ne racontent pas tout. Une balise enterrée semble relier les premières stations au réseau perdu.' },
  { title: 'SIGNAL 31 · NUIT BLANCHE', source: 'Transmission inconnue', faction: 'archives',
    text: 'Des lumières répondent aux drones au-delà du périphérique. Leur fréquence ressemble à celle d’une voix humaine.' },
  { title: 'APPEL 09 · PÉNURIE', source: 'Refuge indépendant', faction: 'lumen',
    text: 'Les stocks sont presque vides. Le dernier convoi a disparu. Une route secondaire existe, mais elle traverse les anciennes zones rouges.' },
  { title: 'FRÉQUENCE 66 · ACCORD', source: 'Caravane nomade', faction: 'nomades',
    text: 'Deux bandes rivales proposent un cessez-le-feu. Un messager pourrait faire la différence avant la prochaine nuit.' },
];
/** Chaque case possède une chance déterministe de transmettre un signal, indépendamment du serveur. */
export function signalForCell(cell: string): RadioSignal | null {
  if(hash('radio:'+cell)%5!==0) return null;
  const d=SIGNALS[hash('script:'+cell)%SIGNALS.length];
  return { id:'radio:'+cell, ...d };
}

export const DEFAULT_RESOURCES: Resources = { scrap: 3, circuits: 1, rations: 2, medkits: 1, charges: 0 };
export const DEFAULT_FACTIONS: Factions = { lumen: 0, nomades: 0, archives: 0 };
export const RECIPES: Record<Recipe, { title: string; desc: string; cost: Partial<Resources> }> = {
  ration: { title: 'Ration de terrain', desc: 'Transforme des matériaux en nourriture de survie.', cost: { scrap: 2 } },
  medkit: { title: 'Trousse médicale', desc: 'Soigne les blessures et restaure ton intégrité.', cost: { scrap: 3, circuits: 1 } },
  charge: { title: 'Impulsion EMP', desc: 'Neutralise les systèmes et affaiblit les ennemis.', cost: { scrap: 2, circuits: 2 } },
  repair: { title: 'Renforcer l’armure', desc: 'Répare immédiatement 30 points d’intégrité.', cost: { scrap: 3 } },
};
export const ENEMIES: Record<EnemyKind, { name: string; title: string; subtitle: string; hp: number; damage: number; faction: Faction }> = {
  scavenger: { name: 'Récupérateur', title: 'LES FERRAILLEURS', subtitle: 'Une bande rôde dans cette zone. Leurs armes sont rudimentaires, mais efficaces.', hp: 42, damage: 11, faction: 'nomades' },
  drone: { name: 'Drone de surveillance', title: 'PROTOCOL // SENTINEL', subtitle: 'Une IA militaire oubliée verrouille ta position. L’EMP peut la désactiver.', hp: 34, damage: 13, faction: 'archives' },
  stray: { name: 'Errant', title: 'LES SILHOUETTES', subtitle: 'Un inconnu s’approche à travers la brume. Il n’a pas l’air amical.', hp: 48, damage: 9, faction: 'lumen' },
};
export function kindFor(id: string): EnemyKind { return (['scavenger', 'drone', 'stray'] as const)[hash(id) % 3]; }
export function spawnEncounter(id: string): Encounter {
  const kind = kindFor(id), data = ENEMIES[kind];
  return { id, kind, name: data.name, title: data.title, subtitle: data.subtitle, turn: 0,
    hp: data.hp, maxHp: data.hp, guard: 0, focus: 0, stunned: 0, last: 'Menace détectée. Choisis ta stratégie.' };
}
export function freshRebirth(): Rebirth {
  return { resources: { ...DEFAULT_RESOURCES }, factions: { ...DEFAULT_FACTIONS },
    integrity: 100, encounter: null, victories: 0, radio: null, radioLog: [] };
}
export function cleanRebirth(raw: unknown): Rebirth {
  const x = raw && typeof raw === 'object' ? raw as Partial<Rebirth> : {};
  const finite = (v: unknown, base: number, cap: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(cap, Math.floor(v))) : base;
  const resources = { ...DEFAULT_RESOURCES }, factions = { ...DEFAULT_FACTIONS };
  for (const k of Object.keys(resources) as Resource[]) resources[k] = finite(x.resources?.[k], resources[k], 9999);
  for (const k of Object.keys(factions) as Faction[]) factions[k] =
    typeof x.factions?.[k] === 'number' && Number.isFinite(x.factions[k])
      ? Math.max(-100, Math.min(100, Math.floor(x.factions[k]))) : 0;
  let encounter: Encounter | null = null;
  const e = x.encounter;
  if (e && typeof e.id === 'string' && e.id.length < 200 && ['scavenger','drone','stray'].includes(e.kind)) {
    const data = ENEMIES[e.kind];
    encounter = { id: e.id, kind: e.kind, name: data.name, title: data.title, subtitle: data.subtitle,
      turn: finite(e.turn, 0, 100), hp: finite(e.hp, data.hp, data.hp), maxHp: data.hp,
      guard: finite(e.guard, 0, 100), focus: finite(e.focus, 0, 2), stunned: finite(e.stunned, 0, 2),
      last: typeof e.last === 'string' ? e.last.slice(0, 160) : '' };
  }
  const rawRadio=x.radio;
  const radio=rawRadio && typeof rawRadio.id==='string' && rawRadio.id.length<150 &&
    typeof rawRadio.title==='string' && typeof rawRadio.text==='string' &&
    ['lumen','nomades','archives'].includes(rawRadio.faction) ?
    { id:rawRadio.id, title:rawRadio.title.slice(0,100), text:rawRadio.text.slice(0,500),
      source:String(rawRadio.source ?? 'Inconnu').slice(0,100), faction:rawRadio.faction } : null;
  const radioLog=Array.isArray(x.radioLog)?x.radioLog.filter((v):v is string=>typeof v==='string').slice(-30).map(v=>v.slice(0,400)):[];
  return { resources, factions, integrity: finite(x.integrity, 100, 100),
    encounter, victories: finite(x.victories, 0, 1000000), radio, radioLog };
}
export function canCraft(s: Rebirth, recipe: Recipe): boolean {
  return Object.entries(RECIPES[recipe].cost).every(([k,v]) => s.resources[k as Resource] >= (v ?? 0))
    && (recipe !== 'repair' || s.integrity < 100);
}
export function craft(s: Rebirth, recipe: Recipe): Rebirth | null {
  if (!canCraft(s, recipe)) return null;
  const n = cleanRebirth(s);
  for (const [k,v] of Object.entries(RECIPES[recipe].cost)) n.resources[k as Resource] -= v ?? 0;
  if (recipe === 'ration') n.resources.rations++;
  if (recipe === 'medkit') n.resources.medkits++;
  if (recipe === 'charge') n.resources.charges++;
  if (recipe === 'repair') n.integrity = Math.min(100, n.integrity + 30);
  return n;
}
export interface BattleResult { state: Rebirth; outcome: 'continue' | 'victory' | 'escape' | 'defeat' | 'invalid'; message: string; }
/** L'adversaire annonce sa prochaine intention avant chaque action. */
export function enemyIntent(e: Encounter): EnemyIntent {
  // Un tour de récupération toutes les 4 actions offre une vraie fenêtre d'attaque.
  if (e.turn > 0 && e.turn % 4 === 3) return 'recover';
  const r = hash(e.id + ':intent:' + e.turn) % 4;
  if (r === 0 || (e.kind === 'drone' && e.turn % 3 === 0)) return 'charge';
  if (r === 1) return 'sweep';
  return 'strike';
}
export const INTENT_LABELS: Record<EnemyIntent, string> = {
  charge: 'ATTAQUE CHARGÉE · puissante mais vulnérable à la feinte',
  strike: 'FRAPPE DIRECTE · protège-toi ou neutralise',
  sweep: 'BALAYAGE · dégâts modérés, esquive difficile',
  recover: 'RÉCUPÉRATION · fenêtre idéale pour charger ton attaque',
};
export function combat(s: Rebirth, move: CombatMove): BattleResult {
  const n = cleanRebirth(s), e = n.encounter;
  if (!e) return { state: n, outcome: 'invalid', message: 'Aucune rencontre active.' };
  if (!(['strike','guard','pulse','evade','focus','feint'] as string[]).includes(move)) {
    return { state: n, outcome:'invalid',message:'Action inconnue.' };
  }
  if (move === 'pulse' && n.resources.charges < 1) return { state:n, outcome:'invalid', message:'Aucune charge EMP dans le sac.' };
  const intent = enemyIntent(e);
  e.turn++;
  let text = '', parry = false;
  if (move === 'evade') {
    const escaped = (hash(e.id + ':escape:' + e.turn) % 100) < 65 || e.turn >= 4;
    if (escaped) { n.encounter = null; return { state:n, outcome:'escape', message:'Retraite réussie. Le secteur reste dangereux.' }; }
    text = 'La retraite échoue. L’ennemi te bloque la route.';
  } else if (move === 'guard') {
    e.guard = 1;
    parry = intent === 'strike' || intent === 'charge';
    text = parry ? 'Parade synchronisée ! La riposte sera presque entièrement absorbée.' :
      'Protection activée : tu réduis les dégâts du prochain assaut.';
  } else if (move === 'pulse') {
    n.resources.charges--;
    const damage = e.kind === 'drone' ? 31 : 19;
    e.hp = Math.max(0, e.hp - damage);
    if (e.kind === 'drone') e.stunned = 1;
    text = 'Onde EMP : -' + damage + ' armure ennemie' + (e.stunned ? ' et systèmes momentanément coupés.' : '.');
  } else if (move === 'focus') {
    e.focus = Math.min(2,e.focus+1);
    text = 'Calibrage de visée : précision stockée ('+e.focus+'/2). Ta garde reste ouverte.';
  } else if (move === 'feint') {
    const damage = 5 + (hash(e.id + ':feint:' + e.turn) % 5);
    e.hp = Math.max(0, e.hp - damage);
    // Fenêtre de contre-attaque : une feinte annule un assaut chargé.
    if (intent === 'charge') e.stunned = 1;
    text = 'Déviation : -' + damage + (e.stunned ? ' · charge ennemie interrompue !' : '.');
  } else {
    const boost = e.focus * 8;
    const damage = 10 + (hash(e.id + ':hit:' + e.turn) % 7) + boost;
    e.focus = 0;
    e.hp = Math.max(0, e.hp - damage);
    text = 'Frappe ciblée : -' + damage + ' armure ennemie' + (boost ? ' (tir calibré).' : '.');
  }
  if (e.hp <= 0) {
    n.encounter = null;n.victories++;
    n.resources.scrap += 2 + hash(e.id) % 3;
    if (e.kind === 'drone') n.resources.circuits++;
    const faction=ENEMIES[e.kind].faction;
    n.factions[faction]=Math.max(-100,n.factions[faction]-2);
    return { state:n, outcome:'victory',
      message:'Menace neutralisée. Butin récupéré et influence de faction modifiée.' };
  }
  if (intent === 'recover' || e.stunned > 0) {
    if (e.stunned > 0) e.stunned--;
    e.last=text + ' L’adversaire ne peut pas riposter ce tour.';
    return { state:n, outcome:'continue', message:e.last };
  }
  const base = ENEMIES[e.kind].damage;
  const intentBoost = intent === 'charge' ? 9 : intent === 'sweep' ? 3 : 0;
  const reduction = e.guard ? (parry ? 16 : 8) : 0;
  const incoming = Math.max(1, base + intentBoost + (hash(e.id + ':counter:' + e.turn) % 5) - reduction);
  e.guard = 0;
  n.integrity = Math.max(0,n.integrity-incoming);
  e.last = text + ' Riposte (' + (intent==='charge'?'chargée':intent==='sweep'?'balayage':'directe') +
    ') : -'+incoming+' intégrité.';
  if (!n.integrity) {
    n.integrity=30;n.encounter=null;
    return { state:n, outcome:'defeat',
      message:'Système de secours activé. Tu survis, mais ton équipement est gravement endommagé.' };
  }
  return { state:n, outcome:'continue', message:e.last };
}
