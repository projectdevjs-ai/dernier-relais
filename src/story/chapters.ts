// Données de l'histoire principale : chapitres, étapes, conditions et messages radio.
// Aucune logique ici. Les conditions portent sur des compteurs (Stat) que src/story/story.ts tient à jour
// en observant les événements et la vue du contrat (src/game/api.ts). Rien ne dépend d'un lieu précis.
// Les textes des messages radio sont repris caractère pour caractère dans scripts/voix-extra.json (un test le vérifie).

export type Who = 'iris' | 'noe' | 'selma';

/** Compteurs suivis par l'histoire. Tous cumulés, jamais décroissants. */
export type Stat =
  | 'scans'        // balayages du scanner
  | 'ramassages'   // colis chargés
  | 'livraisons'   // colis livrés
  | 'notesA'       // livraisons notées A ou S
  | 'notesS'       // livraisons notées S
  | 'fragiles'     // colis fragiles livrés en bon état (90 % ou plus)
  | 'rudes'        // livraisons de nuit, par mauvais temps ou dans un front
  | 'relies'       // abris reliés (au moins une étoile), plus grand nombre vu
  | 'abris3'       // abris à 3 étoiles ou plus
  | 'abris5'       // abris à 5 étoiles
  | 'ecoutes'      // colis écoutés
  | 'arrimages'    // colis arrimés
  | 'caches'       // caches ouvertes
  | 'rencontres'   // voyageurs à qui le porteur a parlé
  | 'fronts'       // fronts traversés (entrée puis sortie)
  | 'perdus'       // colis perdus ramenés à leur abri
  | 'speciaux'     // colis spéciaux livrés
  | 'lots'         // lots d'abri débordé livrés à temps
  | 'preuves'      // photos-preuves prises
  | 'km';          // distance cumulée à pied, en kilomètres

export const STATS: readonly Stat[] = [
  'scans', 'ramassages', 'livraisons', 'notesA', 'notesS', 'fragiles', 'rudes', 'relies', 'abris3', 'abris5',
  'ecoutes', 'arrimages', 'caches', 'rencontres', 'fronts', 'perdus', 'speciaux', 'lots', 'preuves', 'km',
];

/** L'étape est remplie quand le compteur atteint le but. */
export interface Cond { stat: Stat; goal: number }

export interface Radio { who: Who; text: string }

export interface Step {
  id: string;
  /** Objectif affiché, une ligne courte. */
  objective: string;
  cond: Cond;
  /**
   * Autre façon, plus lente, de remplir l'étape : garantit que l'histoire ne reste jamais bloquée
   * (pas de pluie de la semaine, aucun front, aucun colis rare dans le secteur…). Non affichée.
   */
  orElse?: Cond;
  /** Message radio à l'activation de l'étape, puis à son achèvement. Une à deux phrases. */
  start: Radio;
  done: Radio;
}

export interface Chapter {
  id: string;
  title: string;
  /** Intention du chapitre (pour l'équipe, et sous le titre dans le journal). */
  intent: string;
  steps: Step[];
  /** Phrase du carton de fin de chapitre. */
  ending: string;
}

export const WHO: Record<Who, { name: string; role: string; color: string }> = {
  iris: { name: 'Iris Vasseur', role: 'Station Lumen', color: '#7fc7d9' },
  noe: { name: 'Noé Kessler', role: 'Le Passeur', color: '#e8a24a' },
  selma: { name: 'Selma Okoye', role: 'Infirmerie', color: '#9ccf7a' },
};

export const CHAPTERS: Chapter[] = [
  {
    id: 'c1', title: 'Premier signal',
    intent: 'Les premiers pas du porteur : scanner, porter, livrer, relier trois abris. À la fin, Lumen entend enfin le signal de l’Est.',
    steps: [
      {
        id: 'c1-scan', objective: 'Lance le scanner', cond: { stat: 'scans', goal: 1 },
        start: { who: 'iris', text: 'Porteur, ici Lumen. Le Passeur t’a posé là où se trouve ton signal : lance le scanner, qu’on voie ce qui attend autour de toi.' },
        done: { who: 'iris', text: 'Je vois tes échos sur la table. Chaque point, c’est quelque chose qu’on attend quelque part.' },
      },
      {
        id: 'c1-colis', objective: 'Ramasse un colis', cond: { stat: 'ramassages', goal: 1 },
        start: { who: 'noe', text: 'Ici Noé. Approche-toi d’un colis et charge-le : l’exosquelette prend le poids, toi tu gardes l’équilibre.' },
        done: { who: 'noe', text: 'Il tient. Marche droit, et garde le même poids à gauche et à droite.' },
      },
      {
        id: 'c1-abri', objective: 'Livre ton colis et relie un premier abri', cond: { stat: 'relies', goal: 1 },
        start: { who: 'iris', text: 'Ton colis est attendu dans un abri. Porte-le jusqu’à sa porte, c’est tout ce qu’on te demande.' },
        done: { who: 'iris', text: 'Un abri relié, et quelqu’un qui t’a ouvert la porte. Chaque abri relié, c’est une ville qui respire un peu mieux.' },
      },
      {
        id: 'c1-note', objective: 'Obtiens une note A ou S', cond: { stat: 'notesA', goal: 1 },
        start: { who: 'noe', text: 'Les abris notent chaque livraison : l’état du colis, le délai. Arrime bien, marche souple, et vise un A.' },
        done: { who: 'noe', text: 'Du beau travail. Les fixations n’ont même pas grincé.' },
      },
      {
        id: 'c1-deux', objective: 'Relie un deuxième abri', cond: { stat: 'relies', goal: 2 },
        start: { who: 'iris', text: 'Un abri seul reste une île. Relies-en un deuxième, et la ligne passera entre eux.' },
        done: { who: 'iris', text: 'Deux lumières, et un fil entre elles. Le réseau recommence ici, avec toi.' },
      },
      {
        id: 'c1-fragile', objective: 'Livre un colis fragile en bon état', cond: { stat: 'fragiles', goal: 1 }, orElse: { stat: 'livraisons', goal: 12 },
        start: { who: 'selma', text: 'Ici Selma. Certains colis ne pardonnent rien : écoute-les avant de les charger, et porte les fragiles comme tu porterais quelqu’un.' },
        done: { who: 'selma', text: 'Tu as la main douce quand il le faut. Quelqu’un dormira mieux ce soir grâce à ça.' },
      },
      {
        id: 'c1-nuit', objective: 'Livre de nuit ou par mauvais temps', cond: { stat: 'rudes', goal: 1 }, orElse: { stat: 'livraisons', goal: 6 },
        start: { who: 'selma', text: 'Le monde ne s’arrête pas quand le jour tombe ou que le ciel se couvre. Livre une fois de nuit ou sous la pluie, et rentre entier.' },
        done: { who: 'selma', text: 'Tu es rentré entier, c’est tout ce que je demandais. Bois de l’eau, je ne plaisante pas.' },
      },
      {
        id: 'c1-trois', objective: 'Relie un troisième abri', cond: { stat: 'relies', goal: 3 },
        start: { who: 'iris', text: 'Avec trois abris, Lumen pourra enfin trianguler ce signal de l’Est qui nous arrive chaque nuit. Relie le troisième.' },
        done: { who: 'iris', text: 'On l’entend clairement, maintenant. Le signal de l’Est porte la même signature que la balise de ta capsule.' },
      },
    ],
    ending: 'Tu n’es pas tombé du ciel par hasard : quelqu’un, à l’Est, t’a envoyé.',
  },
  {
    id: 'c2', title: 'Ce que porte le vent',
    intent: 'Apprendre à lire le terrain : écouter les colis, ouvrir les caches, parler aux voyageurs, traverser un front. Lumen découvre qui émet.',
    steps: [
      {
        id: 'c2-ecoute', objective: 'Écoute un colis avant de le prendre', cond: { stat: 'ecoutes', goal: 1 },
        start: { who: 'noe', text: 'Avant de charger, colle l’oreille à la caisse. Elle te dira si elle est fragile, ou si elle cache autre chose.' },
        done: { who: 'noe', text: 'Tu vois, les caisses parlent à qui prend le temps.' },
      },
      {
        id: 'c2-cache', objective: 'Ouvre une cache', cond: { stat: 'caches', goal: 1 },
        start: { who: 'iris', text: 'D’anciens porteurs ont laissé des caches le long des chemins. Ton scanner les repère de près : ouvres-en une.' },
        done: { who: 'iris', text: 'Celle-ci porte la marque de Lumen. Ce n’est pourtant aucun de nous qui l’a posée là.' },
      },
      {
        id: 'c2-voyageur', objective: 'Parle à un voyageur de passage', cond: { stat: 'rencontres', goal: 1 }, orElse: { stat: 'caches', goal: 2 },
        start: { who: 'selma', text: 'Tu n’es pas seul à marcher dehors. Si tu croises quelqu’un sur ta route, arrête-toi et parle-lui.' },
        done: { who: 'selma', text: 'Les gens des chemins savent des choses que nos capteurs ignorent. Certains ont déjà croisé un porteur venu de l’Est.' },
      },
      {
        id: 'c2-front', objective: 'Traverse un front de mauvais temps', cond: { stat: 'fronts', goal: 1 }, orElse: { stat: 'livraisons', goal: 8 },
        start: { who: 'noe', text: 'Un front, c’est un mur de pluie qui traverse tout le secteur. Entres-y, ressors de l’autre côté, et dis-moi ce que l’exosquelette en pense.' },
        done: { who: 'noe', text: 'Trempé, mais debout. Mes soudures et toi, vous tenez mieux que prévu.' },
      },
      {
        id: 'c2-etoiles', objective: 'Amène un abri à 3 étoiles', cond: { stat: 'abris3', goal: 1 },
        start: { who: 'iris', text: 'Un abri qu’on ravitaille souvent finit par émettre plus fort. Portes-en un jusqu’à trois étoiles.' },
        done: { who: 'iris', text: 'J’ai relu le registre du Passeur : trois porteurs envoyés avant toi, deux revenus. Le signal de l’Est utilise l’indicatif du troisième.' },
      },
    ],
    ending: 'Avant toi, trois porteurs. Le troisième n’est jamais rentré, et pourtant il émet encore.',
  },
  {
    id: 'c3', title: 'Le troisième porteur',
    intent: 'Suivre la trace de celui qui n’est pas revenu : arrimage, colis perdus, colis rares, longue marche. La piste mène à une seconde station.',
    steps: [
      {
        id: 'c3-arrimage', objective: 'Arrime 3 colis', cond: { stat: 'arrimages', goal: 3 },
        start: { who: 'noe', text: 'Le troisième porteur, c’est moi qui avais réglé son harnais. Arrime trois colis, que je voie si tu as sa main.' },
        done: { who: 'noe', text: 'Le même geste, le même soin. Il aurait aimé te croiser.' },
      },
      {
        id: 'c3-perdu', objective: 'Ramène un colis perdu à son abri', cond: { stat: 'perdus', goal: 1 }, orElse: { stat: 'livraisons', goal: 30 },
        start: { who: 'iris', text: 'Des colis restent en route quand un porteur tombe ou renonce. Ramène-en un à son abri : personne ne doit attendre pour rien.' },
        done: { who: 'iris', text: 'Colis rendu. Quelqu’un, quelque part, n’aura pas porté pour rien.' },
      },
      {
        id: 'c3-special', objective: 'Livre un colis spécial', cond: { stat: 'speciaux', goal: 1 }, orElse: { stat: 'livraisons', goal: 40 },
        start: { who: 'selma', text: 'Il existe des colis rares : une ruche, une batterie, du froid, une boîte noire. Si ton scanner capte un signal inhabituel, suis-le.' },
        done: { who: 'selma', text: 'Ces colis-là, c’est lui qui les déposait pour nous. Il en arrive encore, et aucun ne part d’ici.' },
      },
      {
        id: 'c3-marche', objective: 'Parcours 10 km à pied', cond: { stat: 'km', goal: 10 },
        start: { who: 'selma', text: 'Dix kilomètres dans les jambes, et ton corps saura ce que le sien a enduré. Marche, mais repose-toi entre deux tournées.' },
        done: { who: 'selma', text: 'Dix kilomètres. Tes genoux ont le droit de se plaindre, et moi celui d’être fière.' },
      },
      {
        id: 'c3-cinq', objective: 'Relie 5 abris', cond: { stat: 'relies', goal: 5 },
        start: { who: 'iris', text: 'Il nous faut cinq abris pour remonter la piste jusqu’à sa source. Relie-les, un par un.' },
        done: { who: 'iris', text: 'La piste s’éclaire. Les colis de l’Est ne partent pas d’un abri : ils partent d’une autre station, avec son propre Passeur.' },
      },
    ],
    ending: 'Quelque part à l’Est, une seconde station envoie des porteurs. Tu es l’un d’eux.',
  },
  {
    id: 'c4', title: 'L’Est répond',
    intent: 'Rendre le réseau assez solide pour répondre : lot d’abri débordé, livraisons parfaites, photo-preuve, abri à 5 étoiles. Les deux stations se parlent.',
    steps: [
      {
        id: 'c4-lot', objective: 'Livre à temps le lot d’un abri débordé', cond: { stat: 'lots', goal: 1 }, orElse: { stat: 'livraisons', goal: 60 },
        start: { who: 'noe', text: 'Quand un abri déborde, il confie tout d’un coup. Prends un lot entier et livre-le dans les temps : le Passeur a besoin de cette cadence pour s’accorder.' },
        done: { who: 'noe', text: 'Tout le lot, à l’heure. Le Passeur ronronne, et je n’ai même pas eu à taper dessus.' },
      },
      {
        id: 'c4-parfait', objective: 'Obtiens 3 notes S', cond: { stat: 'notesS', goal: 3 },
        start: { who: 'iris', text: 'Pour émettre vers l’Est, il faut un réseau sans défaut. Trois livraisons parfaites, et j’ouvre le canal.' },
        done: { who: 'iris', text: 'Canal ouvert. Pour la première fois depuis la Coupure, Lumen appelle au lieu d’écouter.' },
      },
      {
        id: 'c4-preuve', objective: 'Prends une photo-preuve après une livraison', cond: { stat: 'preuves', goal: 1 }, orElse: { stat: 'livraisons', goal: 70 },
        start: { who: 'selma', text: 'Quand ils répondront, ils voudront savoir si le monde tient encore. Rapporte-moi une preuve : une photo, juste après une livraison.' },
        done: { who: 'selma', text: 'C’est celle-là qu’on enverra. Une porte ouverte et un colis posé, je ne connais pas de meilleure nouvelle.' },
      },
      {
        id: 'c4-phare', objective: 'Amène un abri à 5 étoiles', cond: { stat: 'abris5', goal: 1 },
        start: { who: 'iris', text: 'Un abri à cinq étoiles émet aussi fort qu’une station. Fais-en un, et notre réponse partira de là.' },
        done: { who: 'iris', text: 'Message parti. Maintenant, on attend.' },
      },
      {
        id: 'c4-attente', objective: 'Parcours 25 km à pied', cond: { stat: 'km', goal: 25 },
        start: { who: 'iris', text: 'La réponse mettra du temps. Continue de marcher : chaque pas que tu fais tient le canal ouvert.' },
        done: { who: 'iris', text: 'L’Est a répondu : « Dernier relais atteint. » C’était toi, le relais qui manquait entre nos deux stations.' },
      },
    ],
    ending: 'Deux stations, un seul réseau. La route de l’Est est ouverte, et elle passe par toi.',
  },
];

/** Objectif affiché quand toute l’histoire écrite est terminée. */
export const AFTER = 'Le réseau tient. Continue de porter.';

/** Tous les messages radio, dans l'ordre de l'histoire (sert à scripts/voix-extra.json et aux tests). */
export function allRadio(): Radio[] {
  return CHAPTERS.flatMap(c => c.steps.flatMap(s => [s.start, s.done]));
}
