# Score Logger — version partagée

Application web installable (PWA) pour garder les scores de tous nos sports et jeux, du squash aux jeux de société, depuis un téléphone Android. Les parties sont rangées dans des **groupes** (ex. « Squash boulot », « Famille ») : chacun se connecte avec son compte Google et saisit les parties qui le concernent. Les données sont stockées en ligne dans Firebase (Google). L'application fonctionne aussi hors connexion et envoie les parties dès que le réseau revient.

## Principe

- **Groupe** : des joueurs et leurs parties. Chaque groupe a son **code**. On le rejoint en se connectant avec Google puis en saisissant ce code, ou sans code si un administrateur nous y a invité. On peut faire partie de plusieurs groupes. Un membre ne voit que les groupes dont il fait partie.
- **Joueur** : dans chaque groupe, ton compte est relié à un joueur. Si d'autres membres ont déjà saisi des parties contre toi, choisis ton nom : ces parties deviennent les tiennes.
- **Sport ou jeu** : nom, icône et règle de victoire. Par défaut, le plus grand score gagne. On peut cocher « le plus petit score gagne » pour le golf ou certains jeux de cartes, et « demander le nom du jeu » pour une catégorie comme « Jeu de société » : chaque partie indique alors le jeu (Catan, Dixit…), avec les jeux déjà saisis en suggestion. Les sports sont communs à tous les groupes.
- **Partie** : entre joueurs du même groupe, avec des scores numériques (décimales et négatifs acceptés). Elle apparaît chez chacun des joueurs, de leur point de vue. Trois modes :
  - **Chacun pour soi** : moi contre un ou plusieurs adversaires, un score chacun ;
  - **Équipes** : mon équipe (moi et mes coéquipiers) contre une ou plusieurs équipes adverses, un score par équipe ;
  - **Coopératif** : tous ensemble contre le jeu ; résultat **Gagné** ou **Perdu**, score commun facultatif.
- **Résultat** calculé automatiquement :
  - **victoire** si je suis (ou mon équipe est) seul en tête ;
  - **nul** si je suis à égalité en tête ;
  - **défaite** sinon.

  Dans une partie à plusieurs, ma place est aussi calculée (ex. 2e/4, ou 2e/3 équipes). En coopératif, le résultat est celui saisi.
- **Stats sur plusieurs groupes** : les joueurs reliés au même compte Google sont réunis. Tes stats « Tous mes groupes » additionnent donc tes parties de chaque groupe.
- **Droits** : les membres d'un groupe voient toutes ses parties. Seuls l'auteur d'une partie, ses joueurs, le responsable du groupe et les administrateurs peuvent la modifier ou la supprimer. Un joueur relié à un compte ne peut être renommé que par ce compte, le responsable ou un administrateur.

## Responsables et administrateurs

**Créer un groupe** : tout membre d'au moins un groupe peut créer un groupe (**Réglages → Mon compte → ✨ Créer un groupe**). Il en devient le **responsable** (🔑). Quelqu'un qui n'a encore aucun groupe ne peut pas en créer : il doit d'abord en rejoindre un.

**Le responsable** gère son groupe, et seulement le sien, dans **Réglages → carte Groupe → 🔑 Gestion du groupe** :

- renommer le groupe, changer son code ;
- **Membres** : changer le joueur d'un membre (👤), le retirer du groupe (✕) ; il ne pourra pas y revenir avec le code ; ↩️ le remet ;
- **Inviter par e-mail** : la personne entre sans code et est directement reliée au joueur choisi ; personne d'autre ne peut revendiquer ce joueur ; si l'adresse est déjà celle d'un membre du groupe, il est relié tout de suite ;
- **modifier ou supprimer n'importe quelle partie** du groupe, **renommer n'importe quel joueur** du groupe ;
- **saisir une partie sans y jouer** : dans l'onglet Partie, toucher la case « Moi » pour choisir un autre joueur principal. Il peut aussi gérer le groupe sans y avoir de joueur (« Je ne joue pas dans ce groupe »).

**Les administrateurs** (e-mails listés dans le champ `admins` du document `config/group`, voir la mise en place) ont les droits d'un responsable sur **tous les groupes**, et voient tous les groupes. Leur carte **🛡️ Administration** liste tous les comptes et permet de **révoquer** (🚫) l'accès d'un compte à tous les groupes ; ↩️ le rétablit. Les parties restent dans l'historique.

**Les membres** voient les parties de leurs groupes et ne modifient que celles où ils jouent ou qu'ils ont saisies.

Pour des parties avec des gens extérieurs, que les autres ne doivent pas voir : crée un groupe (ex. « Perso ») dont tu es le seul membre.

## Onglets

- **Partie** : saisie de toutes les parties d'une journée en une fois, dans le groupe choisi en haut (si tu en as plusieurs). Chaque partie a son mode (Chacun pour soi / Équipes / Coopératif), son sport, le nom du jeu si le sport le demande, puis les joueurs et les scores.
  - **Joueurs du jour** : toucher un joueur l'ajoute comme adversaire de la partie sélectionnée (encadrée) ; le retoucher le retire.
  - **➕ Ajouter une partie** ajoute une nouvelle partie, avec le même sport que la précédente.
  - **💾 Enregistrer les N parties** enregistre tout d'un coup.
- **Historique** : **Mes parties** (avec le bilan de chaque jour) ou **Toutes les parties** (avec le vainqueur des parties auxquelles je n'ai pas joué), pour un groupe ou tous mes groupes. Recherche, filtre par sport, détail, modification, suppression.
- **Stats** : pour un groupe ou tous mes groupes, mes stats ou celles de n'importe quel joueur. Tous sports confondus ou par sport, sur tout, cette année ou les 30 derniers jours.
  - Parties, victoires, défaites, nuls, % de victoires, forme sur les 10 dernières parties, série en cours.
  - **Par sport**, **Scores**, **Faits marquants** (victime préférée, bête noire, meilleur partenaire…), **Face-à-face** (les adversaires, y compris les joueurs des équipes adverses), **Partenaires** (bilan avec chaque coéquipier ou partenaire de jeu coopératif), **Par mode**, **Par jeu** (dans la vue d'un sport dont on note le nom du jeu), **Selon le nombre de joueurs**.
- **Réglages** : mes groupes (mon nom dans chacun, 📤 inviter quelqu'un avec le lien et le code, ➕ rejoindre un groupe, ✨ créer un groupe), carte Groupe (gestion pour le responsable, joueurs : renommer ; un nom existant fusionne les deux), sports et jeux, export JSON, import des parties de l'ancienne version.

## Mise en place de Firebase (une seule fois, environ 10 minutes)

Firebase est gratuit pour des groupes d'amis (offre Spark : 50 000 lectures et 20 000 écritures par jour).

1. Va sur <https://console.firebase.google.com>, clique sur **Créer un projet**, donne-lui un nom (ex. `score-logger`). Google Analytics n'est pas nécessaire.
2. **Connexion Google** : menu **Créer → Authentication → Commencer**, onglet **Sign-in method**, choisis **Google**, active-le, choisis ton e-mail d'assistance, puis **Enregistrer**.
   Onglet **Paramètres → Domaines autorisés** : ajoute `<ton-pseudo>.github.io`. `localhost` y est déjà, pour les tests sur le PC.
3. **Base de données** : menu **Créer → Firestore Database → Créer une base de données**. Choisis un emplacement en Europe (ex. `europe-west1`) et le **mode production**.
4. **Règles de sécurité** : dans Firestore, onglet **Règles**, remplace tout par le contenu du fichier [`firestore.rules`](firestore.rules), puis **Publier**.
5. **Administrateurs** : dans Firestore, onglet **Données**, clique sur **Commencer une collection** :
   - ID de la collection : `config` ;
   - ID du document : `group` ;
   - un champ `admins`, de type `array`, contenant une valeur `string` : ton adresse Gmail **en minuscules**. Ajoute d'autres adresses pour avoir plusieurs administrateurs.
6. **Configuration de l'application** : ⚙️ **Paramètres du projet**, section **Vos applications**, clique sur l'icône **Web** `</>`, donne un nom (pas besoin de Firebase Hosting). Copie les valeurs de `firebaseConfig` dans [`js/firebase-config.js`](js/firebase-config.js). Ces valeurs ne sont pas secrètes : ce sont les codes des groupes et les règles qui protègent les données.
7. `git commit` puis `git push` (voir plus bas).

## Première connexion

1. Ouvre l'application et touche **Se connecter avec Google**.
2. **Administrateur** : l'application te fait créer ton premier groupe (nom et code). **Membre** : saisis le code du groupe ; les personnes invitées par e-mail passent cette étape.
3. Dans chaque groupe, choisis ton nom dans la liste des joueurs existants, ou crée ton joueur. Si un administrateur t'a attribué un joueur, tu y es relié automatiquement.
4. Si des parties de l'ancienne version sont encore sur le téléphone, l'application propose de les **envoyer dans un groupe**. Dans ces parties, « Moi » devient ton joueur, et les adversaires sont rapprochés par leur nom des joueurs existants. On peut aussi le faire plus tard dans **Réglages → Sauvegarde** (le groupe est celui choisi dans la carte Joueurs), ou importer un fichier `scores-AAAA-MM-JJ.json` exporté par l'ancienne version.

Pour inviter quelqu'un : **Réglages → Mes groupes → 📤**, qui envoie le lien et le code du groupe par WhatsApp, SMS, etc.

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

Modifie les fichiers, change la version dans `js/version.js` (ex. `v1.0` → `v1.1`), puis fais `git commit` et `git push`. La version s'affiche à côté de « Parties du jour » : elle permet de vérifier qu'un téléphone a bien la dernière. Les téléphones récupèrent la nouvelle version à la prochaine ouverture de l'app avec du réseau. Si tu ajoutes ou renommes un fichier, ajoute-le aussi à la liste `ASSETS` de `sw.js`. Si tu modifies `firestore.rules`, recopie-le dans la console Firebase.

## Tester sur le PC

```sh
cd score-logger-mobile
python -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>. Dans Chrome, F12 puis le mode appareil mobile permet de simuler un téléphone. Un double-clic sur `index.html` ne fonctionne pas, car les modules JavaScript ont besoin d'un serveur.

## Organisation du code

- `js/cloud.js` : connexion Google et accès à Firestore.
- `js/store.js` : données (groupes, sports, joueurs, parties), vues du point de vue d'un joueur, administration, import de l'ancienne version.
- `js/stats.js` : calcul des résultats et des statistiques.
- `js/app.js` : interface.
- `firestore.rules` : règles de sécurité (qui peut lire et modifier quoi).
