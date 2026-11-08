# Score Logger — version partagée

Application web installable (PWA) pour garder les scores de tous nos sports et jeux, du squash aux jeux de société, depuis un téléphone Android. Les parties sont **partagées par un groupe** : chacun se connecte avec son compte Google et saisit les parties qui le concernent. Les données sont stockées en ligne dans Firebase (Google). L'application fonctionne aussi hors connexion et envoie les parties dès que le réseau revient.

## Principe

- **Groupe** : une seule base commune. On la rejoint en se connectant avec Google puis en saisissant le **code du groupe**.
- **Joueur** : chaque compte est relié à un joueur. Si d'autres membres ont déjà saisi des parties contre toi, choisis ton nom à la première connexion : ces parties deviennent les tiennes.
- **Sport ou jeu** : nom, icône et règle de victoire. Par défaut, le plus grand score gagne. On peut cocher « le plus petit score gagne » pour le golf ou certains jeux de cartes. Les sports sont communs à tout le groupe.
- **Partie** : moi contre un ou plusieurs adversaires, avec un score numérique pour chacun (décimales et négatifs acceptés). Elle apparaît aussi chez chacun des adversaires, de leur point de vue.
- **Résultat** calculé automatiquement :
  - **victoire** si je suis seul en tête ;
  - **nul** si je suis à égalité en tête ;
  - **défaite** sinon.

  Dans une partie à plusieurs, ma place est aussi calculée (ex. 2e/4).
- **Droits** : tout le groupe voit toutes les parties. Seuls l'auteur d'une partie, ses joueurs et les administrateurs peuvent la modifier ou la supprimer. Un joueur relié à un compte ne peut être renommé que par ce compte ou un administrateur.

## Administration

Les administrateurs sont les e-mails listés dans le champ `admins` du document `config/group` (voir la mise en place). Ils ont une carte **🔑 Administration** dans les Réglages, et le serveur leur accorde des droits supplémentaires :

- **Modifier ou supprimer n'importe quelle partie**, même sans y avoir joué. La partie s'ouvre alors du point de vue de son premier joueur.
- **Renommer n'importe quel joueur**, même relié à un compte.
- **Révoquer l'accès d'un membre** (🚫). Il ne peut plus rien voir ni saisir, même avec le code du groupe. Ses parties restent dans l'historique. ↩️ rétablit l'accès.
- **Changer le joueur d'un membre** (👤). L'ancien joueur redevient libre.
- **Attribuer un joueur à un e-mail** : la personne entre sans code et est directement reliée à ce joueur. Personne d'autre ne peut revendiquer ce joueur. Si l'adresse est déjà celle d'un membre, il est relié tout de suite.
- **Changer le code du groupe.**

## Onglets

- **Partie** : saisie de toutes les parties d'une journée en une fois. Chaque partie a son sport, mon score, puis chaque adversaire avec son score à droite.
  - **Joueurs du jour** : toucher un joueur l'ajoute comme adversaire de la partie sélectionnée (encadrée) ; le retoucher le retire.
  - **➕ Ajouter une partie** ajoute une nouvelle partie, avec le même sport que la précédente.
  - **💾 Enregistrer les N parties** enregistre tout d'un coup.
- **Historique** : **Mes parties** (avec le bilan de chaque jour) ou **Tout le groupe** (avec le vainqueur des parties auxquelles je n'ai pas joué). Recherche, filtre par sport, détail, modification, suppression.
- **Stats** : mes stats, ou celles de n'importe quel joueur du groupe. Tous sports confondus ou par sport, sur tout, cette année ou les 30 derniers jours.
  - Parties, victoires, défaites, nuls, % de victoires, forme sur les 10 dernières parties, série en cours.
  - **Par sport**, **Scores**, **Faits marquants** (victime préférée, bête noire…), **Face-à-face**, **Selon le nombre de joueurs**.
- **Réglages** : mon compte et mon nom de joueur, **Inviter quelqu'un** (envoie le lien et le code du groupe), sports et jeux, joueurs (renommer ; un nom existant fusionne les deux), export JSON du groupe, import des parties de l'ancienne version.

## Mise en place de Firebase (une seule fois, environ 10 minutes)

Firebase est gratuit pour un groupe d'amis (offre Spark : 50 000 lectures et 20 000 écritures par jour).

1. Va sur <https://console.firebase.google.com>, clique sur **Créer un projet**, donne-lui un nom (ex. `score-logger`). Google Analytics n'est pas nécessaire.
2. **Connexion Google** : menu **Créer → Authentication → Commencer**, onglet **Sign-in method**, choisis **Google**, active-le, choisis ton e-mail d'assistance, puis **Enregistrer**.
   Onglet **Paramètres → Domaines autorisés** : ajoute `<ton-pseudo>.github.io`. `localhost` y est déjà, pour les tests sur le PC.
3. **Base de données** : menu **Créer → Firestore Database → Créer une base de données**. Choisis un emplacement en Europe (ex. `europe-west1`) et le **mode production**.
4. **Règles de sécurité** : dans Firestore, onglet **Règles**, remplace tout par le contenu du fichier [`firestore.rules`](firestore.rules), puis **Publier**.
5. **Code du groupe** : dans Firestore, onglet **Données**, clique sur **Commencer une collection** :
   - ID de la collection : `config` ;
   - ID du document : `group` ;
   - un champ `code`, de type `string`, avec le code secret de ton choix (ex. `squash-du-jeudi-42`) ;
   - un champ `admins`, de type `array`, contenant une valeur `string` : ton adresse Gmail **en minuscules**. Ajoute d'autres adresses pour avoir plusieurs administrateurs.

   Ensuite, le code peut être changé depuis l'application (**Réglages → Administration**). Les membres déjà inscrits restent membres.
6. **Configuration de l'application** : ⚙️ **Paramètres du projet**, section **Vos applications**, clique sur l'icône **Web** `</>`, donne un nom (pas besoin de Firebase Hosting). Copie les valeurs de `firebaseConfig` dans [`js/firebase-config.js`](js/firebase-config.js). Ces valeurs ne sont pas secrètes : c'est le code du groupe et les règles qui protègent les données.
7. `git commit` puis `git push` (voir plus bas).

## Première connexion

1. Ouvre l'application et touche **Se connecter avec Google**.
2. Saisis le code du groupe. Les administrateurs et les personnes invitées par e-mail passent cette étape.
3. Choisis ton nom dans la liste des joueurs existants, ou crée ton joueur. Si un administrateur t'a attribué un joueur, tu y es relié automatiquement.
4. Si des parties de l'ancienne version sont encore sur le téléphone, l'application propose de les **envoyer au groupe**. Dans ces parties, « Moi » devient ton joueur, et les adversaires sont rapprochés par leur nom des joueurs existants. On peut aussi le faire plus tard dans **Réglages → Sauvegarde**, ou importer un fichier `scores-AAAA-MM-JJ.json` exporté par l'ancienne version.

Pour inviter quelqu'un : **Réglages → Inviter quelqu'un**, qui envoie le lien et le code par WhatsApp, SMS, etc.

## Mise en ligne sur GitHub Pages (gratuit)

1. Crée un dépôt sur GitHub, par exemple `score-logger`.
2. Envoie le **contenu** de ce dossier à la racine du dépôt :
   ```sh
   cd score-logger-mobile
   git remote add origin https://github.com/<ton-pseudo>/score-logger.git
   git push -u origin main
   ```
3. Sur GitHub, ouvre **Settings → Pages**, choisis **Source : Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`. Clique sur **Save**.
4. Une à deux minutes plus tard, l'app est accessible à l'adresse `https://<ton-pseudo>.github.io/score-logger/`.

## Installation sur le téléphone

Ouvre l'adresse dans **Chrome** sur Android, puis menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).

## Hors connexion

Une connexion internet est nécessaire au premier lancement et pour se connecter. Ensuite, le téléphone garde une copie des parties : on peut consulter et saisir sans réseau, et les parties sont envoyées automatiquement au retour du réseau.

## Sauvegarde

Les données sont dans Firestore. **Réglages → Sauvegarde → Télécharger / Partager** produit en plus une archive JSON de tout le groupe : sports, joueurs et parties.

## Mettre à jour l'app

Modifie les fichiers, puis fais `git commit` et `git push`. Les téléphones récupèrent la nouvelle version à la prochaine ouverture de l'app avec du réseau. Si tu ajoutes ou renommes un fichier, ajoute-le à la liste `ASSETS` de `sw.js` et incrémente `VERSION`. Si tu modifies `firestore.rules`, recopie-le dans la console Firebase.

## Tester sur le PC

```sh
cd score-logger-mobile
python -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>. Dans Chrome, F12 puis le mode appareil mobile permet de simuler un téléphone. Un double-clic sur `index.html` ne fonctionne pas, car les modules JavaScript ont besoin d'un serveur.

## Organisation du code

- `js/cloud.js` : connexion Google et accès à Firestore.
- `js/store.js` : données du groupe (sports, joueurs, parties), vues du point de vue d'un joueur, import de l'ancienne version.
- `js/stats.js` : calcul des résultats et des statistiques.
- `js/app.js` : interface.
- `firestore.rules` : règles de sécurité (qui peut lire et modifier quoi).
