# Dernier Relais

Jeu mobile de livraison à pied : on marche dans sa vraie ville pour livrer des colis et rallumer un réseau d'abris,
reconstruit par tous les joueurs sur la carte de France. Web 3D, emballé en APK Android avec Capacitor.

## État : étape 2, socle technique

- Monde découpé en cases fixes d'environ 400 m, chargées au fil de la marche. Aucun point de départ fixe.
- Un abri par bloc de 2 x 2 cases, posé sur un vrai lieu (mairie, école, pharmacie, parc…), sinon sur un hameau ou une rue.
- Emplacements de colis sur les rues praticables, renouvelés chaque jour.
- Même monde pour tous les joueurs : tout se calcule à partir de la position de la case.
- Données : tuiles OpenFreeMap (OpenStreetMap), gratuites et sans clé.

La page actuelle est un banc d'essai, pas le jeu : elle sert à vérifier le monde partout en France.

## Commandes

```
npm install
npm run dev      # page de test en local
npm test         # tests de la génération du monde
npm run probe    # contrôle sur données réelles, 10 positions en France
npm run build    # construction dans dist/
```

## Organisation

```
src/core     géométrie des cases, hasard reproductible, sauvegarde
src/world    lecture des tuiles, génération des cases, chargement autour du joueur
src/player   position : GPS réel ou simulée
src/ui       affichage de test
```

## Étapes

1. Cahier de jeu (validé le 11/11/2026)
2. Socle technique (en cours)
3. Carte vivante partout en France
4. Direction visuelle
5. Boucle de jeu, puis systèmes rebranchés un par un
6. En ligne (Supabase)
7. Finition, APK, puis iOS
