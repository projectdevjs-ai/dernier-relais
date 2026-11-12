// Surprises cachées dans les colis ordinaires, révélées à l'écoute (reprises de l'ancien jeu).
// Tirées de l'identifiant du colis : mêmes surprises pour tous les joueurs.
import { hash } from '../core/geo';

export type Surprise = 'chat' | 'bonus' | 'lore' | 'label';
/** Parts cumulées : chat 5 %, pièces en trop 10 %, message scellé 10 %, mauvaise étiquette 8 %. */
export const SURPRISE = {
  chances: [['chat', 0.05], ['bonus', 0.15], ['lore', 0.25], ['label', 0.33]] as [Surprise, number][],
  /** multiplicateur de points à la livraison */ mult: { chat: 1.15, bonus: 1.3, lore: 1, label: 1.6 } as Record<Surprise, number>,
} as const;

export function surpriseFor(orderId: string): Surprise | null {
  const r = hash(`surprise|${orderId}`) / 4294967296;
  for (const [k, upTo] of SURPRISE.chances) if (r < upTo) return k;
  return null;
}
/** Ce que le joueur entend en écoutant le colis. */
/** L'étiquette ne s'entend pas : elle se voit sur le dessus du colis. */
export const SURPRISE_HEARD: Record<Exclude<Surprise, 'label'>, string> = {
  chat: 'Un miaulement ! Un chat clandestin s’est glissé dedans. Il viendra avec toi.',
  bonus: 'Ça cliquette : des pièces en trop, la livraison rapportera plus',
  lore: 'Un froissement de papier : un message scellé est glissé dedans',
};
/** Ligne ajoutée au détail de la note. */
export const SURPRISE_NOTE: Record<Surprise, string> = { chat: 'Chat clandestin', bonus: 'Pièces en trop', lore: 'Message scellé', label: 'Vraie adresse retrouvée' };

/** Messages scellés trouvés dans les colis. */
export const LORE: string[] = [
  '« Si tu lis ceci, la Station Lumen tient toujours. Ne crois pas ceux qui disent que le Passeur est un mythe. » — I.V.',
  '« Jour 212 depuis la Coupure. Les antennes du Nord se sont tues une à une. Il reste des voix, si on écoute bien. »',
  '« Noé a encore réparé la machine avec une pièce de lave-linge. Elle a marché. Personne ne sait pourquoi. »',
  '« La Plaine Noire n’était pas noire avant. Le sable s’est assombri la nuit où le ciel a brûlé. »',
  '« À celui qui porte : chaque abri relié rallume une lumière quelque part. Merci. » — un habitant',
  '« Selma garde une ruche sur le toit du labo. Elle dit que tant que les abeilles vivent, nous aussi. »',
  '« Rapport du Passeur : 3 porteurs envoyés, 2 revenus. Le troisième envoie encore des colis. Mais d’où ? »',
  '« Ne laisse jamais un colis sous la pluie trop longtemps. Certains souvenirs ne sèchent pas. »',
];
export const loreFor = (orderId: string): { index: number; text: string } => { const i = hash(`message|${orderId}`) % LORE.length; return { index: i, text: LORE[i] }; };
