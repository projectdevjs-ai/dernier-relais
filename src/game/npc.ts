// Répliques des PNJ. Mara : chaleureuse, institutrice. Tomas : bourru, mécanicien.
// Agathe : précise, soignante. Kenji : rêveur, technicien radio.
import { hash } from '../core/geo';
import type { NpcId } from './api';

export type Situation =
  | 'première'  // première rencontre (1re étoile)
  | 'accueil'   // rien de particulier
  | 'attente'   // le joueur porte un colis pour cet abri
  | 'merci'     // livraison sans histoire
  | 'étoile'    // étoile gagnée
  | 'cinq'      // 5 étoiles
  | 'retard'    // colis en retard
  | 'abîmé';    // colis abîmé

export const HIDDEN_LINE = '…';

export const LINES: Record<NpcId, Record<Situation, string[]>> = {
  mara: {
    première: ['Entre, entre ! Je suis Mara. Ici, on apprend aux petits à lire… et à espérer.', 'Un visage nouveau ! Moi, c’est Mara. Tu arrives juste pour la récréation.'],
    accueil: ['Te revoilà ! Les enfants ont dessiné ton sac à dos.', 'Bonjour, toi. Tu prendras bien une tisane avant de repartir ?'],
    attente: ['C’est pour nous, ce colis ? Les enfants trépignent déjà.', 'Oh, tu nous apportes quelque chose ! Pose-le doucement.'],
    merci: ['Merci, vraiment. La classe va pouvoir continuer.', 'Parfait ! Je savais qu’on pouvait compter sur toi.'],
    étoile: ['Une étoile de plus au tableau ! Les enfants l’ont collée eux-mêmes.', 'Tu vois ? Grâce à toi, l’abri grandit.'],
    cinq: ['Cinq étoiles… Cet abri est redevenu une école. Merci.', 'Les enfants disent que tu es de la famille. Ils ont raison.'],
    retard: ['Tu arrives tard, mais tu arrives. C’est déjà beaucoup.', 'On t’attendait plus tôt… Allez, ce n’est pas grave.'],
    abîmé: ['Oh… la caisse a souffert. On fera avec, ne t’en fais pas.', 'C’est un peu cabossé. On réparera ça ensemble.'],
  },
  tomas: {
    première: ['Tomas. Mécano. Si ça tourne encore ici, c’est grâce à moi.', 'T’es le nouveau porteur ? Tomas. Abîme rien et on s’entendra.'],
    accueil: ['Encore toi. Bon. Y a du boulot.', 'Reste pas planté là, la pompe se répare pas toute seule.'],
    attente: ['C’est pour moi, ça ? Donne.', 'T’as mes pièces ? Pose ça sur l’établi.'],
    merci: ['Hm. Correct.', 'Ça fera l’affaire. Merci, porteur.'],
    étoile: ['Une étoile. Fais pas le fier, y en a d’autres à gagner.', 'Pas mal. L’atelier tourne mieux depuis que tu passes.'],
    cinq: ['Cinq étoiles. On a fait du bon travail, toi et moi.', 'J’ai connu pire, comme porteur. Bien pire.'],
    retard: ['T’as vu l’heure ? La pompe attend pas, elle.', 'En retard. La prochaine fois, marche plus vite.'],
    abîmé: ['C’est quoi cette caisse ? Tu l’as traînée par terre ?', 'Cabossé. Je vais devoir redresser ça moi-même.'],
  },
  agathe: {
    première: ['Agathe, soignante. Lave-toi les mains, puis nous parlerons.', 'Je suis Agathe. Ici, chaque colis est compté et noté.'],
    accueil: ['Bonjour. Stock vérifié ce matin : il manque encore des choses.', 'Tu tombes bien. J’ai une liste, et elle est longue.'],
    attente: ['Ce colis est attendu. Pose-le ici, étiquette vers le haut.', 'Tu as ma livraison ? Je la contrôle tout de suite.'],
    merci: ['Tout y est. Travail propre, merci.', 'Conforme. Mes patients te remercient.'],
    étoile: ['Une étoile de plus. C’est noté au registre.', 'L’infirmerie progresse. Tes livraisons y sont pour beaucoup.'],
    cinq: ['Cinq étoiles. Plus personne ne manque de soins ici. Merci.', 'Registre complet. Tu as fait un travail exemplaire.'],
    retard: ['Tu as du retard. En soins, chaque minute compte.', 'Délai dépassé. Je le note, sans rancune.'],
    abîmé: ['L’emballage est abîmé. Je vais devoir tout vérifier.', 'Colis endommagé. Sois plus soigneux la prochaine fois.'],
  },
  kenji: {
    première: ['Oh, quelqu’un ! Je suis Kenji. J’écoutais le ciel, pardon.', 'Kenji, radio de l’abri. Tu entends ? Non ? Moi non plus… pas encore.'],
    accueil: ['Le réseau tient à un fil. Chaque colis compte.', 'Cette nuit, j’ai capté une voix très loin. Ou alors le vent.'],
    attente: ['C’est pour l’antenne ? Montre, montre !', 'Tu portes quelque chose pour moi… Je l’entends grésiller d’ici.'],
    merci: ['Merci. Avec ça, on entendra un peu plus loin.', 'Parfait. Un fil de plus dans la toile.'],
    étoile: ['Une étoile… comme un nouveau signal dans la nuit.', 'Tu entends ? L’abri émet plus fort, grâce à toi.'],
    cinq: ['Cinq étoiles. On nous capte jusqu’à la mer, j’en suis sûr.', 'Le réseau chante, maintenant. Et tu en fais partie.'],
    retard: ['Tu es en retard ? Ah. Je n’avais pas vu l’heure non plus.', 'Le temps file… les ondes aussi. Tant pis pour le délai.'],
    abîmé: ['Aïe. Ça grésille là-dedans, et pas comme il faudrait.', 'La caisse a pris des coups. J’espère que les lampes ont tenu.'],
  },
};

/** Réplique du PNJ pour une situation. `seed` choisit la variante, de façon stable (pas de clignotement à l'écran). */
export function npcLine(npc: NpcId, situation: Situation, seed: string): string {
  const list = LINES[npc][situation];
  return list[hash(`${seed}|${situation}`) % list.length];
}
