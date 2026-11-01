# Score Logger — version mobile

Application web installable (PWA) pour garder les scores de tous mes sports et jeux, du squash aux jeux de société, depuis un téléphone Android. Elle fonctionne hors connexion. Les données sont stockées **uniquement sur le téléphone** : rien n'est envoyé sur internet, et ce dépôt ne contient aucune donnée personnelle.

## Principe

- **Sport ou jeu** : nom, icône et règle de victoire. Par défaut, le plus grand score gagne. On peut cocher « le plus petit score gagne » pour le golf ou certains jeux de cartes.
- **Partie** : moi contre un ou plusieurs adversaires, avec un score numérique pour chacun (décimales et négatifs acceptés).
- **Résultat** calculé automatiquement :
  - **victoire** si je suis seul en tête ;
  - **nul** si je suis à égalité en tête ;
  - **défaite** sinon.
  
  Dans une partie à plusieurs, ma place est aussi calculée (ex. 2e/4).

## Onglets

- **Partie** : saisie de toutes les parties d'une journée en une fois. Chaque partie a son sport, mon score, puis chaque adversaire avec son score à droite.
  - **Joueurs du jour** : toucher un joueur l'ajoute comme adversaire de la partie sélectionnée (encadrée) ; le retoucher le retire.
  - **➕ Ajouter une partie** ajoute une nouvelle partie, avec le même sport que la précédente.
  - **💾 Enregistrer les N parties** enregistre tout d'un coup.
- **Historique** : parties regroupées par jour avec le bilan, recherche, filtre par sport, détail, modification, suppression.
- **Stats** : tous sports confondus ou par sport, sur tout, cette année ou les 30 derniers jours.
  - Parties, victoires, défaites, nuls, % de victoires, forme sur les 10 dernières parties, série en cours.
  - **Par sport** (vue « Tous ») : bilan de chaque sport ; toucher un sport ouvre ses stats.
  - **Scores** (vue d'un sport) : score moyen, record, place moyenne dans les parties à plusieurs.
  - **Faits marquants** : sport le plus pratiqué, meilleur sport, adversaire le plus fréquent, victime préférée, bête noire.
  - **Face-à-face** : bilan contre chaque adversaire. Dans une partie à plusieurs, chaque adversaire compte à part : ai-je fait mieux que lui ? Toucher un nom ouvre sa fiche.
  - **Selon le nombre de joueurs** (vue d'un sport joué à des tables de tailles différentes) : bilan et place moyenne.
- **Réglages** : mon prénom, sports et jeux, joueurs (renommer met à jour toutes les parties ; un nom existant fusionne les deux), sauvegarde et restauration en JSON.

## Mise en ligne sur GitHub Pages (gratuit)

1. Crée un dépôt sur GitHub, par exemple `score-logger`.
2. Envoie le **contenu** de ce dossier à la racine du dépôt :
   ```sh
   cd score-logger-mobile
   git init
   git add .
   git commit -m "Version mobile"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/score-logger.git
   git push -u origin main
   ```
3. Sur GitHub, ouvre **Settings → Pages**, choisis **Source : Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`. Clique sur **Save**.
4. Une à deux minutes plus tard, l'app est accessible à l'adresse `https://<ton-pseudo>.github.io/score-logger/`.

## Installation sur le téléphone

Ouvre l'adresse dans **Chrome** sur Android, puis menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).

## Sauvegarde

**Réglages → Sauvegarde → Télécharger / Partager** produit un fichier `scores-AAAA-MM-JJ.json`. **Importer** le recharge, par exemple sur un nouveau téléphone. Les sports et les parties sont fusionnés avec ceux déjà présents, sans doublon.

⚠️ Les parties n'existent que sur le téléphone. Exporte-les régulièrement : effacer les données de Chrome ou désinstaller l'app les supprime.

## Mettre à jour l'app

Modifie les fichiers, puis fais `git commit` et `git push`. Les téléphones récupèrent la nouvelle version à la prochaine ouverture de l'app avec du réseau. Si tu ajoutes ou renommes un fichier, ajoute-le à la liste `ASSETS` de `sw.js` et incrémente `VERSION`.

## Tester sur le PC

```sh
cd score-logger-mobile
python -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>. Dans Chrome, F12 puis le mode appareil mobile permet de simuler un téléphone. Un double-clic sur `index.html` ne fonctionne pas, car les modules JavaScript ont besoin d'un serveur.
