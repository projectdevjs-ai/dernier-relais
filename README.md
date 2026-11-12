# Dernier Relais

Jeu mobile de livraison à pied. Tu marches dans ta vraie ville, tu livres des colis et tu rallumes, abri après abri,
un réseau que tous les joueurs reconstruisent ensemble sur la carte de France.

- **Jouer dans le navigateur** : https://projectdevjs-ai.github.io/dernier-relais/
- **APK Android de test** : https://github.com/projectdevjs-ai/dernier-relais/releases/download/apk/dernier-relais.apk
  (reconstruite automatiquement à chaque mise à jour de la branche `main`)

## Ce que contient le jeu

- Monde généré partout en France à partir des vrais lieux (OpenStreetMap) : un abri tous les 800 m environ, colis du jour sur les rues.
- Boucle de jeu : scanner, ramasser, porter, livrer, note de E à S, étoiles d'abri, compétences, contrats du jour et de la semaine.
- Événements : colis spéciaux, caches, voyageurs, fronts de mauvais temps, abris débordés, colis perdus, arrimage, inspection, preuve photo.
- Histoire en 4 chapitres, prologue, Station Lumen en 3D comme menu principal.
- Météo réelle, vraie nuit, deux ambiances visuelles, sons synthétisés, voix françaises des personnages.
- En ligne (Supabase) : sauvegarde, abris collectifs, progression par région, classement, chaîne de relais entre joueurs.

## Mettre le jeu en ligne (à faire une fois dans Supabase)

1. SQL Editor → nouvelle requête → coller tout `supabase/schema.sql` → Run.
2. Authentication → Sign In / Providers → activer « Allow anonymous sign-ins ».

Tant que ce n'est pas fait, le jeu fonctionne entièrement en local.

## Développement

```
npm install
npm run dev        # jeu en local
npm test           # tests
npm run build      # construction dans dist/
```

Pages de démonstration par partie : `demo-render.html`, `demo-ui.html`, `demo-lab.html`, `demo-intro.html`,
`demo-story.html`, `demo-france.html`, `demo-audio.html`. `?direct` dans l'adresse du jeu saute le prologue et le labo.

```
src/core      géométrie des cases, hasard reproductible
src/world     lecture des tuiles de carte, génération des cases
src/game      règles du jeu (aucun accès à l'écran) ; src/game/api.ts est le contrat entre les parties
src/render    scène 3D sur la carte
src/ui        interface
src/story     histoire principale
src/lab       Station Lumen (menu 3D)      src/intro   prologue
src/audio     sons, vibrations, voix        src/net     jeu en ligne
supabase      schéma de la base
```

Les voix sont générées par `scripts/voix.ts` (Fish Audio), les modèles 3D viennent de Meshy. Aucune clé privée n'est dans ce dépôt.
