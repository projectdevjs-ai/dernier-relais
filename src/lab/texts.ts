// Textes du labo : distribution, répliques des scientifiques, libellés des postes.
// Iris Morel : directrice, posée, exigeante mais bienveillante, parle peu et juste.
// Noé Kessler : ingénieur du Passeur et de l'exosquelette, bricoleur, pince-sans-rire, tutoie tout de suite.
// Selma Okoye : médecin et biologiste, ironie tendre, veille sur le porteur.
// Les faits (la Coupure, la Plaine Noire, la capsule et sa balise, le signal de l'Est) suivent src/story/chapters.ts
// sans rien en dévoiler : le labo laisse deviner, la radio raconte.
import type { GameView } from '../game/api';

export type SciId = 'iris' | 'noe' | 'selma';

export const CAST: Record<SciId, { name: string; role: string; model: string }> = {
  iris: { name: 'Dr Iris Morel', role: 'Directrice de la Station Lumen', model: 'sci_iris' },
  noe: { name: 'Noé Kessler', role: 'Ingénieur du Passeur', model: 'sci_noe' },
  selma: { name: 'Dr Selma Okoye', role: 'Biologiste et médecin', model: 'sci_selma' },
};

/**
 * Première rencontre : deux ou trois répliques qui s'enchaînent (le personnage, son poste, ce qu'on y fait).
 * Les personnages n'ont pas de voix enregistrée : leurs répliques peuvent contenir des chiffres.
 */
export const FIRST_LINES: Record<SciId, string[]> = {
  iris: [
    'Tu tiens debout. C’est un bon début. Iris Morel, je dirige la Station Lumen.',
    'Lumen est le dernier laboratoire encore relié au réseau. Cette table montre ce qu’il en reste : chaque point allumé est un abri qui répond.',
    'Ici, tu prends tes contrats et tu regardes la carte se rallumer. Le reste se passe dehors. Noé t’attend au Passeur, juste à côté.',
  ],
  noe: [
    'Alors c’est toi, le colis tombé du ciel. Moi, c’est Noé. Tout ce qui ronronne, clignote ou fume ici, c’est de ma faute.',
    'L’anneau derrière moi, c’est le Passeur. Il te pose dehors, pile là où tu te trouves pour de vrai. Il tient avec du fil et de la patience, mais il tient.',
    'Et sur le râtelier, c’est ton exosquelette. Chaque point que tu gagnes dehors, je le visse dedans : casque, dos, jambes, colonne. Reviens me voir quand tu en as.',
  ],
  selma: [
    'Constantes stables, pour quelqu’un qui vient de tomber du ciel. Selma Okoye : médecin, biologiste, et tout ce qui manque d’autre ici.',
    'Ce coin est le mien : l’infirmerie, les bacs où pousse ce qu’on mange, et derrière cette porte, tes quartiers.',
    'Tu y trouveras une couchette et ton carnet : tout ce que tu fais dehors y est noté. Repose-toi quand il le faut. Je vérifierai.',
  ],
};

/** Première réplique de chaque rencontre, seule (gardée pour scripts/voix.ts, qui attend une phrase par personnage). */
export const FIRST: Record<SciId, string> = { iris: FIRST_LINES.iris[0], noe: FIRST_LINES.noe[0], selma: FIRST_LINES.selma[0] };

/** Répliques d'ambiance, sans condition, dites à tour de rôle. */
export const POOL: Record<SciId, string[]> = {
  iris: [
    'Chaque abri relié, c’est une ville qui respire un peu mieux.',
    'Le Passeur est calé sur ta position. Pars quand tu es prêt, pas avant.',
    'On capte quelque chose à l’Est, certaines nuits. Faible, régulier. Je n’aime pas les signaux que je ne comprends pas.',
    'Je ne te demande pas d’être rapide. Je te demande d’arriver.',
    'Noé parle à ses machines, Selma à ses plantes. Moi, je parle peu. Ça équilibre.',
    'Ne laisse pas la Plaine Noire te garder. Elle a déjà ta capsule.',
    'Avant la Coupure, cette table affichait le pays entier. Je n’ai pas oublié à quoi ça ressemblait.',
    'Un colis en retard reste un colis livré. Un colis abandonné, c’est quelqu’un qui attend pour rien.',
    'Ta capsule n’avait ni plan de vol ni nom à bord. Seulement une balise. On en reparlera.',
    'Si une porte s’ouvre dehors, prends le temps d’entrer. Le réseau, ce sont d’abord des gens.',
    'Dors, de temps en temps. C’est une consigne, pas un conseil.',
  ],
  noe: [
    'Si le Passeur fait un bruit de casserole, ne t’inquiète pas. Enfin… pas trop.',
    'Mon bras ? Un souvenir de la première version du Passeur. La deuxième est mieux, promis.',
    'J’ai trois règles : on ne court pas avec une ruche, on ne tape pas sur le Passeur, et on me rend mes tournevis.',
    'Les fixations des jambes fatiguent vite. Le lourd, c’est pour le dos.',
    'Iris dit que je parle à mes machines. C’est faux. Je les engueule.',
    'Tu n’es pas le premier à qui je règle un harnais. Tu es juste celui qui pose le moins de questions.',
    'Le Passeur ne se trompe jamais d’endroit. D’heure, parfois. De quelques secondes. Rien de grave.',
    'Selma m’a interdit le café après minuit. Depuis, je bois beaucoup de café avant minuit.',
    'Ta capsule, je l’ai démontée dix fois dans ma tête. Il y a là-dedans des soudures que je ne sais pas faire.',
    'Quand ça clignote vert, tout va bien. Orange, tu m’appelles. Rouge, tu cours, et tu m’appelles après.',
    'Il y a un crochet vide au fond de l’atelier. Non, ce n’est pas le tien.',
  ],
  selma: [
    'Bois de l’eau. Je ne plaisante pas.',
    'Les ruches que tu ramènes, ce sont mes abeilles préférées. Traite-les bien.',
    'Repose-toi entre deux tournées. Ton corps n’est pas un colis : on ne le remplace pas.',
    'Tu ne te souviens de rien avant la capsule ? Ça reviendra. Ou pas. Dans les deux cas tu es là, et ça me suffit.',
    'Les tomates poussent mal sous lampe, mais elles poussent. Je trouve ça encourageant, comme principe.',
    'Noé jure qu’il dort. Ses cernes disent autre chose. Ne prends pas exemple sur lui.',
    'Tes analyses sont normales. Presque trop, pour quelqu’un qu’on a ramassé dans le sable. J’y réfléchis.',
    'Iris ne le dira jamais, alors je le dis : elle compte chacun de tes retours.',
    'Si un abri t’offre une tisane, accepte. C’est aussi ça, relier les gens.',
    'J’ai gardé la combinaison que tu portais en arrivant. L’étiquette est cousue à la main. Quelqu’un a pris soin de toi, avant nous.',
    'Des chats ? Quels chats ? Je n’ai vu aucun chat dans les quartiers.',
  ],
};

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;
const km = (n: number): string => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace('.', ','));

export interface Progress { linked: number; claimable: number; exoDone: boolean; exoEmpty: boolean }

export function progressOf(v: GameView): Progress {
  const ranks = v.skills.reduce((s, k) => s + k.rank, 0), max = v.skills.reduce((s, k) => s + k.maxRank, 0);
  return {
    linked: v.shelters.filter(s => s.stars > 0).length,
    claimable: v.contracts.filter(c => c.done && !c.claimed).length,
    exoDone: max > 0 && ranks >= max,
    exoEmpty: ranks === 0,
  };
}

/**
 * Répliques liées à la progression, de la plus pressante à la moins pressante. Chacune porte une clé :
 * une réplique déjà dite pendant cette visite n'est pas répétée.
 */
export function contextual(id: SciId, v: GameView): { key: string; text: string }[] {
  const p = v.player, g = progressOf(v), out: { key: string; text: string }[] = [];
  if (id === 'iris') {
    if (p.deliveries === 0) out.push({ key: 'depart', text: 'Le Passeur te dépose dans le monde réel, là où tu te trouves vraiment. Tu portes, tu relies les abris, tu reviens quand tu veux. Rien de plus, rien de moins.' });
    if (g.claimable > 0) out.push({ key: `contrat${g.claimable}`, text: `${plural(g.claimable, 'contrat rempli', 'contrats remplis')}. Passe à la console : un travail fait mérite d’être réglé.` });
    if (g.linked === 1) out.push({ key: 'abris1', text: 'Un abri relié. Regarde la table : ce point-là, c’est toi qui l’as rallumé.' });
    else if (g.linked > 1) out.push({ key: `abris${g.linked}`, text: `${g.linked} abris reliés autour de toi. La carte se rallume lentement. C’est comme ça que ça tient.` });
    if (p.deliveries >= 25) out.push({ key: 'liv25', text: `${p.deliveries} livraisons. Les abris ne demandent plus qui tu es. Ils demandent quand tu reviens.` });
    else if (p.deliveries >= 5) out.push({ key: 'liv5', text: `${p.deliveries} livraisons. Le réseau commence à connaître ton pas.` });
    if (p.level >= 3) out.push({ key: `niv${p.level}`, text: `Niveau ${p.level}. Je distribue peu de compliments, alors garde celui-ci.` });
  } else if (id === 'noe') {
    if (p.skillPoints > 0) out.push({ key: `pts${p.skillPoints}`, text: `Tu as ${plural(p.skillPoints, 'point', 'points')} à dépenser. Viens au râtelier, j’ai déjà sorti la clé de douze.` });
    if (g.exoDone) out.push({ key: 'complet', text: 'Plus rien à visser. J’ai vérifié deux fois, par déformation. Cet exosquelette, c’est toi qui le fais tenir maintenant.' });
    if (g.exoEmpty) out.push({ key: 'vide', text: 'L’exosquelette est léger, mais il encaisse : dos, bras, jambes. Garde le même poids à gauche et à droite, sinon tu finis le nez dans le bitume.' });
    if (p.level >= 5) out.push({ key: `niv${p.level}`, text: `Niveau ${p.level}. Tu forcis : il va falloir que je resserre les fixations.` });
    else if (p.level >= 2) out.push({ key: `niv${p.level}`, text: `Niveau ${p.level}. Ça grince moins quand tu marches, je l’entends d’ici.` });
    if (p.deliveries >= 10) out.push({ key: 'liv10', text: `${p.deliveries} livraisons et pas une soudure qui lâche. Je suis presque vexé de n’avoir rien à réparer.` });
  } else {
    if (p.stamina < 0.35) out.push({ key: 'fatigue', text: 'Tu es à bout de souffle, et ne me dis pas que non : je le vois d’ici. Va t’allonger avant de repartir.' });
    if (p.distanceKm >= 10) out.push({ key: 'km10', text: `${km(p.distanceKm)} kilomètres dans les jambes. À ce rythme, tu connaîtras bientôt le pays mieux que la table d’Iris.` });
    else if (p.distanceKm >= 1) out.push({ key: 'km1', text: `${km(p.distanceKm)} kilomètres depuis ton arrivée. Le corps suit. Préviens-moi le jour où il discute.` });
    if (p.deliveries === 0) out.push({ key: 'chambre', text: 'Ta couchette est derrière la porte. Ton carnet t’y attend : tout ce que tu fais dehors y est noté.' });
    else if (p.deliveries >= 15) out.push({ key: 'liv15', text: `${p.deliveries} livraisons. Autant de gens qui dorment mieux, si tu veux mon avis de médecin.` });
    if (p.level >= 4) out.push({ key: `niv${p.level}`, text: `Niveau ${p.level}, et toujours tes deux genoux. Je note ça comme un succès médical.` });
  }
  return out;
}

export type StationId = 'cartes' | 'passeur' | 'chambre';

/** Les trois postes de la Station Lumen, de gauche à droite. */
export const STATIONS: { id: StationId; name: string; desc: string; sci: SciId }[] = [
  { id: 'cartes', name: 'Salle des cartes', desc: 'La table d’Iris : le réseau de toute la France en direct, et tes contrats.', sci: 'iris' },
  { id: 'passeur', name: 'Le Passeur', desc: 'L’anneau qui te dépose dehors, à ta position réelle. Noé y règle aussi ton exosquelette.', sci: 'noe' },
  { id: 'chambre', name: 'Quartiers', desc: 'L’infirmerie de Selma. Derrière la porte : ta couchette, ton carnet, ton profil.', sci: 'selma' },
];
/** Prénom utilisé sur les boutons « Parler à … » */
export const FIRST_NAME: Record<SciId, string> = { iris: 'Iris', noe: 'Noé', selma: 'Selma' };
/** Indication donnée après la première réplique d'Iris */
export const HINT_FIRST = 'Glisse à droite pour rejoindre le Passeur';

export const BRANCH_LABEL = { scanner: 'Scanner', portage: 'Portage', endurance: 'Endurance', 'réseau': 'Réseau' } as const;
/** Partie de l'exosquelette que chaque branche allume. */
export const BRANCH_PART = { scanner: 'Casque', portage: 'Armature dorsale', endurance: 'Jambes', 'réseau': 'Colonne' } as const;

export function fmtKm(n: number): string { return km(n); }
export function fmtInt(n: number): string { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
export { plural };
