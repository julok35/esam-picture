# Analyse de esam-picture (octobre 2026, v0.3)

Revue du code, des fonctionnalités, du design et de l'ergonomie, avec des propositions pour rendre l'appli plus facile à maintenir et plus utile à l'équipe communication. Base : `index.html` (1604 lignes, 125 Ko), `tests/test_fumee.mjs`, `docs/ARCHITECTURE.md`, et les captures du test de fumée (390x844 et 1400x900). Le test passe intégralement : 28 vérifications sur chaque taille d'écran, aucune erreur de page.

## 1. En bref

L'appli tient ses promesses : tout se passe dans l'appareil, l'aperçu et l'export passent par le même rendu, les fiches sont tolérantes, la charte est respectée, le test de bout en bout couvre le parcours complet. Le code est dense mais bien sectionné et commenté.

Les trois chantiers qui rapporteraient le plus :

1. **Un registre des types de calques** : aujourd'hui, ajouter un type de calque demande de toucher huit endroits du fichier (46 branchements `l.type === "..."`). Un objet `LAYERS` par type (défaut, dessin, éditeur, poignées) rendrait l'ajout d'un calque local et sûr.
2. **Annuler** : aucun retour en arrière n'existe, alors que la suppression d'un calque, « Tout réinitialiser » et « Retirer de la liste » sont immédiats. Le toast accepte déjà un bouton d'action (`toast(msg, label, fn)`) mais il n'est utilisé nulle part.
3. **Installation et hors ligne** : l'appli est conçue pour tout faire sans réseau mais ne s'installe pas sur l'écran d'accueil et ne se charge pas sans connexion. Un manifeste et un service worker minimal (deux petits fichiers, pas de build) la rendraient utilisable en montagne.

## 2. Ce qui est solide

- **Architecture claire** : un seul fichier, sections nommées, conventions constantes (gabarits `innerHTML` avec `esc()`, gestionnaires délégués, `data-*`). `docs/ARCHITECTURE.md` est à jour et suffit pour entrer dans le code.
- **Même rendu partout** : `renderAll` en unités `u = W/1080`, aléa déterministe pour les tracés au crayon, cache d'export séparé. C'est ce qui garantit que ce qu'on voit est ce qu'on publie.
- **Fiche de configuration** : lecture tolérante (`applyCfg`), champs de travail exclus (`noPriv`), écriture à côté des photos dans un dossier de travail, reprise d'un clic (IndexedDB). Bonne base pour la collaboration.
- **Vie privée** : flous sans `ctx.filter`, bords fondus proportionnels, et surtout `withMeta` qui retire tout segment APP1 à APP15 et réécrit un EXIF et un XMP ESAM. Le test vérifie que l'auteur, la date et le GPS d'origine disparaissent bien.
- **Mobile d'abord** : scène collante, poignées de 14 px, pincement, l'objet sélectionné garde la main, le réglage du calque remonte sous l'aperçu. Les captures téléphone confirment que l'éditeur reste visible sans défiler.
- **Test de fumée** : un seul script couvre chargement, formats, gestes, flous, calques, grille, export (dimensions et métadonnées), fiche, reprise, vidéo. C'est rare pour un projet de cette taille.

## 3. Code et maintenabilité

### 3.1 Le dispatch par type de calque est éparpillé

Pour un type de calque, l'information est répartie dans : `TYPES`, `PHOTO_T` ou `DECOR_T`, `defLayer`, `drawLayer`, `layerEditor`, `hasWid`, `applyWidth`, l'action `lreset`, `layerName`, `applyCfg` (cas `larg` du texte), `addLayer` (cas légende, flèche, coin), `applyAll` (logo et légende copiés), et `placeCoin` appelé depuis `drawLayer`. Chaque ajout de type (comme la carte en 0.2) oblige à retrouver toutes ces branches.

Proposition : un registre, toujours dans `index.html`.

```js
const LAYERS = {
  texte: {
    nom:"Texte", groupe:"photo",
    def:() => ({texte:"", couleur:"#FFFFFF", fond:"ombre", y:0.5, larg:0.8}),
    draw:(ctx, u, l, W) => textBlock(ctx, u, l, W, false),
    editor:l => ..., wid:"larg", reset:l => { l.larg = 0.8; },
    nomCourt:l => l.texte ? `Texte : ${clean(l.texte).slice(0, 24)}` : "Texte"
  },
  ...
};
```

`drawLayer`, `layerEditor`, `hasWid`, `applyWidth`, `layerName` et les chips d'ajout deviennent des lectures de `LAYERS[l.type]`. Le même schéma convient aux filtres et aux formats (déjà des tableaux, c'est bien).

### 3.2 Les gestionnaires du panneau sont deux grandes chaînes if/else

`$("panel").addEventListener("click")` et `("input")` lisent une vingtaine d'attributs `data-*` différents (`fmt`, `filtre`, `fsel`, `fmode`, `lcol`, `act`...). C'est lisible aujourd'hui mais chaque nouveau réglage ajoute une branche et le risque d'oublier `persist`, `renderPanel` ou `draw`.

Proposition : une table d'actions `{nom: (p, valeur) => ...}` avec un seul attribut `data-act` et un `data-val`, et une fin de traitement commune (invalidation du cache, persist, rendu). Les curseurs peuvent passer par une table `{attr: {get, set, unité}}` qui sert aussi à générer le gabarit `range()` : l'unité affichée (`%`, `°`) ne serait plus recalculée par une condition de 150 caractères (ligne 1402).

### 3.3 Lisibilité

- 61 lignes dépassent 200 caractères, la plus longue 690 (gabarit de la liste des calques). Les diffs et les revues en souffrent. Règle simple : une ligne par élément de gabarit, 160 caractères au plus.
- Champ mort : `S.mode` est initialisé et jamais lu. Dans `applyColor`, `(c.sat > 0 ? 1 : 1)` est une condition sans effet.
- Le commentaire du modèle en tête du script (ligne 283) duplique `ARCHITECTURE.md` et a déjà dérivé (pas d'`angle` dans les flous, pas de `grille` ni `meta`). Garder une seule source : renvoyer au document.
- Quelques « nombres magiques » de rendu (tailles 86, 56, 40, 340, 150 en unités `u`) gagneraient à être nommés dans un bloc `TAILLES` : c'est la charte, elle doit se lire d'un coup d'oeil.

### 3.4 Robustesse de la lecture des fiches

`applyCfg` recopie tous les champs d'un calque venu du JSON avec `Object.assign(defLayer(type), ..., l, ...)`. Un JSON peut ainsi injecter des clés inattendues (y compris `__proto__`, que `Object.assign` applique comme prototype). Le risque est faible (rien ne vient du réseau) mais la correction est simple : ne copier que les clés connues du type (ce que le registre de 3.1 fournit gratuitement). Même logique pour `couleur` : vérifier le format `#RRGGBB`.

### 3.5 Mémoire sur téléphone

Chaque photo garde un canvas de travail de 2560 px de côté long : environ 20 Mo par photo. Vingt photos d'intervention représentent 400 Mo, ce qui fait tomber l'onglet sur beaucoup de téléphones. En plus, un recadrage serré (zoom 30 %) sur ce canvas sort une image de 1080 px agrandie depuis environ 770 px, alors que la photo d'origine (4000 px) l'aurait fournie nette.

Proposition : garder un canvas de prévisualisation plus petit (1600 px suffit pour un aperçu à 1080 px x dpr 2 plafonné à W) et redécoder la photo depuis le `File` au moment de l'export, à pleine résolution, puis libérer. On gagne sur les deux tableaux : moins de mémoire et de meilleurs exports. Le `File` est déjà conservé dans `p.file`.

### 3.6 Performance de l'aperçu

- Chaque mouvement d'un curseur Couleur recalcule `applyColor` pixel par pixel sur le canvas d'aperçu puis toutes les zones de flou (le cache de flou est invalidé avec la base). Sur téléphone avec trois zones, le curseur peut saccader. Pistes : calculer la couleur sur une base réduite de moitié pendant le glissement et au complet au relâchement, ou passer les tables par canal au flou en gardant le cache des régions floutées (le flou ne dépend pas des couleurs si on l'applique avant `applyColor` ; l'ordre inverse a toutefois l'avantage de flouter l'image finale, à peser).
- `persist()` reconstruit toute la pellicule (`renderFilm`) à chaque fin de geste, y compris les `<img>` en data URL. Mettre à jour seulement la pastille « modifiée » de la vignette concernée.
- `renderPanel()` reconstruit tout le panneau à chaque clic. C'est acceptable, mais avec une table d'actions (3.2) on peut ne redessiner que la sous-partie concernée.

### 3.7 Nommage des exports

`outName` produit `nom_format.jpg`. Deux photos du même nom dans deux sous-dossiers écrasent le même fichier dans `publication/`, et un second export du même format écrase le premier sans prévenir. Proposition : reprendre le chemin relatif dans `publication/`, ou suffixer `_2`, `_3`.

### 3.8 Tests et outillage

- Le test de fumée est précieux mais monolithique : un échec en milieu de parcours masque la suite, et il dure longtemps. Le découper en scénarios (chargement, cadre, couleur, flous, calques, export, fiche, vidéo) qui partagent une mise en place.
- Les fonctions pures (`fixCadre`, `applyCfg`, `snapAxis`, `wrapLines`, `exifSeg`, `withMeta`, `colorParams`) ne sont pas testables isolément car tout est dans une fonction englobante. Exposer un objet `window.__esam = {fixCadre, applyCfg, ...}` (sans effet pour l'utilisateur) permet des tests unitaires rapides via `page.evaluate`, et des cas limites : fiche d'une ancienne version, cadre hors image, JSON corrompu, EXIF avec une chaîne de plus de 4 octets.
- Rendu de référence : exporter une photo de test avec tous les calques et comparer un hachage (ou une différence de pixels tolérante) avec une image de référence versionnée. C'est la seule façon de détecter une régression de rendu (police, ombre, position) que le test actuel ne voit pas.
- Pas d'intégration continue : un workflow GitHub Actions qui lance `node tests/test_fumee.mjs` et la vérification des tirets sur chaque pull request fermerait la boucle. Chromium s'installe en une ligne dans l'action Playwright.
- Pas de `package.json` : en ajouter un minimal (scripts `test` et `check`) documente les commandes sans introduire de build.

## 4. Fonctionnalités : manques et propositions

Classées par valeur pour l'équipe communication.

### 4.1 Annuler et confirmer (fort, peu coûteux)

Pile d'annulation par photo : un instantané de `cfg` (déjà sérialisable) avant chaque `persist`, limitée à 30 entrées, boutons « Annuler » et « Rétablir » au-dessus du panneau, raccourcis Ctrl+Z et Ctrl+Maj+Z sur PC. Pour les actions destructrices (supprimer un calque, une zone, « Tout réinitialiser », « Retirer de la liste »), un toast « Annuler » suffit et le mécanisme existe déjà.

### 4.2 Zoom de l'aperçu pour placer les flous (fort)

Sur téléphone, l'aperçu fait 46 % de la hauteur : un visage ou une plaque dans une photo de groupe mesure quelques millimètres à l'écran et la zone de flou est difficile à placer et à dimensionner avec précision. Or c'est la fonction la plus sensible de l'appli. Propositions : pincement à vide (sans objet sous les doigts) qui zoome la vue, double toucher qui centre et agrandit sur la zone choisie, ou une loupe qui s'affiche pendant le glissement d'une zone. La vue `V` (espace, échelle) est déjà le bon endroit pour ajouter un décalage et un facteur.

### 4.3 Export multi-formats (fort)

La même photo part en 4:5 sur Instagram et en 9:16 en story. Aujourd'hui il faut changer le format, replacer le cadre, exporter, recommencer. Proposition : dans l'onglet Export, cocher plusieurs formats ; pour chaque format sans cadre défini, prendre le cadre maximal centré ; les calques étant en fractions de la sortie, ils suivent. Mémoriser un cadre par format dans la fiche (`cadres: {carre: {...}, story: {...}}`, avec lecture tolérante de l'ancien `cadre`) évite de perdre un recadrage soigné quand on change de format.

### 4.4 Modèles de mise en page (fort)

Les publications ESAM se ressemblent : logo en haut, titre, légende, signature. La fiche JSON le permet déjà en partie, et un détail du code le fait sans le dire : importer une seule fiche dont le nom ne correspond à aucune photo l'applique à la photo sélectionnée. Rendre cela explicite : « Enregistrer comme modèle » (nom, liste des calques, format, filtre, grille, métadonnées) et « Appliquer un modèle » depuis l'onglet Calques, modèles gardés dans localStorage et exportables en JSON pour les partager dans l'équipe. « Copier les réglages vers les autres photos » deviendrait un cas particulier.

### 4.5 Zones sûres et guides (moyen)

En story, l'interface des réseaux recouvre le haut et le bas de l'image (environ 250 px sur 1920). Afficher ces zones en hachuré dans la vue sortie pour le format story évite des titres cachés. Même idée pour la zone de la légende Instagram en 4:5 (rien n'est recouvert, mais un rappel du bord bas utile).

### 4.6 Comparaison avant et après (moyen)

Appui long sur l'aperçu pour voir la photo sans couleur ni flou ni calques. Utile pour juger un filtre. Coût faible : un drapeau lu par `renderAll`.

### 4.7 Export groupé en archive (moyen)

Sur téléphone, « Exporter toutes les photos modifiées » déclenche N téléchargements espacés de 400 ms ; certains navigateurs bloquent au-delà du premier. Une archive ZIP (bibliothèque `fflate`, environ 30 Ko, dans `vendor/`) rend l'export groupé fiable hors dossier de travail. Alternativement, un partage multi-fichiers via `navigator.share({files})` quand il est pris en charge.

### 4.8 Hors ligne et installation (fort pour l'usage terrain)

Un `manifest.webmanifest` (nom, icônes à partir du logo, `display: standalone`, couleur de thème) et un `sw.js` qui met en cache `index.html` et `vendor/` à l'installation, avec mise à jour quand `APP_VERSION` change. Deux fichiers statiques, compatibles avec GitHub Pages et la règle « pas de build ». L'appli devient une icône sur le téléphone et fonctionne sans réseau.

### 4.9 Aide à la détection (à étudier)

La détection automatique des visages n'est pas disponible de façon fiable sans bibliothèque (l'API `FaceDetector` du navigateur reste expérimentale et désactivée par défaut). Un modèle embarqué pèserait plusieurs Mo, ce qui est contraire à l'esprit du projet. À garder pour plus tard ; en attendant, un bouton « Ajouter une zone ici » au double toucher sur l'aperçu, qui crée la zone sous le doigt plutôt qu'au centre, ferait gagner un geste à chaque visage.

### 4.10 Petits manques

- Pas de retouche « recadrage libre » dans le format original (le format original exporte toute la photo).
- Pas de choix de qualité JPEG ni de PNG (utile pour un visuel à fond uni avec texte, où le JPEG bave). Une case « PNG » dans Export suffirait.
- Le texte et le titre n'ont pas d'alignement (gauche, centre, droite) : tout est centré.
- La légende impose un ordre animal, date, secteur ; pas de champ libre pour « 3 h d'intervention ». Le calque Texte compense.
- HEIC : accepté par l'extension dans le sélecteur mais aucun navigateur ne le décode ; l'utilisateur reçoit « format non lisible ». Mieux vaut un message explicite (« exportez en JPEG depuis l'album ») ou retirer l'extension du filtre.

## 5. Design et UI/UX

### 5.1 Ce qui marche

La charte est appliquée avec retenue : Anton pour les titres, Montserrat partout ailleurs, bleu et jaune ESAM pour les états actifs, mode sombre pris en charge. Les puces (`chip`) à état pressé sont plus lisibles que des listes déroulantes, surtout au doigt. Les étiquettes en haut de l'aperçu (format, dimensions, mode) sont une bonne idée. Le parcours par onglets suit l'ordre naturel du travail : cadrer, corriger, flouter, habiller, exporter.

### 5.2 Points à améliorer

- **Onglet Export sur téléphone** : la capture montre que le bouton « Exporter la photo » arrive après trois champs de métadonnées et un paragraphe d'explication. L'action principale doit être visible dès l'ouverture de l'onglet : bouton primaire en tête (ou collant en bas), métadonnées repliées dans un bloc « Métadonnées » déplié à la demande.
- **Flèches de la liste des calques** : la flèche vers le haut porte l'intitulé « Dessous » et celle vers le bas « Dessus ». C'est exact (le haut de la liste est dessiné en premier) mais contre-intuitif. Inverser l'ordre d'affichage de la liste (le calque du dessus en haut, comme dans tous les logiciels de dessin) règle la contradiction, ou remplacer les flèches par « Monter » et « Descendre » avec la liste dans l'ordre visuel.
- **Zone des calques sur téléphone** : la liste des calques arrive après les deux rangées de chips et le bloc Grille magnétique. Quand il y a huit calques, elle est loin sous l'aperçu. Mettre la liste juste après les chips d'ajout, la grille en dernier (réglage rare).
- **Deux rangées de chips « + Type »** : onze puces en deux groupes occupent beaucoup de place pour une action faite une fois par photo. Une seule rangée défilante ou un bouton « + Ajouter » ouvrant une feuille (bottom sheet) avec des vignettes des types serait plus compact et plus parlant (une vignette montre ce qu'est un « Biais » ou une « Carte », noms qui ne s'expliquent pas tout seuls).
- **Textes d'aide** : nombreux et longs (celui de la grille fait trois lignes, celui de la liste des calques quatre). Ils aident au premier usage puis coûtent de l'espace. Une icône « ? » qui déplie l'aide, ou une aide affichée seulement tant que l'action n'a jamais été faite, allégerait les panneaux.
- **Accueil** : deux paragraphes gris et un hint sur le dossier de travail s'affichent même sur téléphone où le dossier n'est pas modifiable. Afficher le bon texte selon l'appareil, et déplacer les explications longues sous un lien « Comment ça marche ».
- **Première photo** : à l'arrivée sur l'onglet Cadre, rien n'indique qu'on peut glisser l'image. L'étiquette en haut à droite le dit, en petit et sur fond sombre. Une animation discrète de la main au premier chargement (puis plus jamais) ou un contour qui pulse une fois guiderait sans texte.
- **Retour utilisateur sur l'export** : un toast de 2,6 s « Photo téléchargée ». La vignette reçoit une pastille verte, mais rien ne dit où est le fichier ni ne permet de l'ouvrir. Sur PC avec dossier de travail, un lien « Ouvrir publication/ » n'est pas possible, mais un rappel du chemin complet dans la carte Export l'est.
- **Contraste des poignées** : la poignée blanche de largeur (texte, carte) ressemble à une poignée de coin sur fond clair. Une forme différente (un petit rectangle plutôt qu'un disque) la distinguerait de la poignée jaune de taille.
- **Le badge de version** « v0.3 » dans l'en-tête téléphone prend 60 px pour une information de débogage. Le déplacer dans l'accueil ou sous l'onglet Export.

### 5.3 Accessibilité

- Les curseurs `range` n'ont pas d'étiquette liée : le libellé est un `span`. Ajouter `aria-labelledby` ou un `<label for>`.
- Le canvas n'a ni `aria-label` ni résumé textuel ; au moins un `aria-label` décrivant la vue (« Aperçu de la photo, format Portrait ») et une annonce `role="status"` des changements de sélection.
- Les onglets ont `role="tab"` sans `role="tablist"` effectif pour le clavier (pas de navigation aux flèches) ni `aria-controls`.
- Les actions au clavier existent (flèches, Suppr) mais ne sont pas découvrables : les mentionner dans l'aide de l'onglet.

## 6. Risques et défauts constatés

| Gravité | Constat | Piste |
|---|---|---|
| Moyenne | 20 Mo de mémoire par photo (canvas 2560 px), pas de limite de nombre de photos | Canvas d'aperçu plus petit, redécodage à l'export (3.5) |
| Moyenne | Export d'un recadrage serré agrandi depuis le canvas 2560 px, plus flou que nécessaire | Idem |
| Moyenne | Aucune annulation ; suppressions et réinitialisation immédiates | Pile d'annulation, toast « Annuler » (4.1) |
| Faible | Collision de noms dans `publication/` (même nom dans deux sous-dossiers, ou export répété) | Chemin relatif ou suffixe (3.7) |
| Faible | Exports groupés par téléchargements successifs, bloqués par certains navigateurs | Archive ZIP ou partage multi-fichiers (4.7) |
| Faible | Clés arbitraires d'une fiche JSON recopiées dans les calques | Liste blanche par type (3.4) |
| Faible | HEIC accepté puis refusé avec un message générique | Message explicite (4.10) |
| Faible | localStorage jamais nettoyé (une clé par photo jamais supprimée) | Purger les clés les plus anciennes au-delà de 200 |
| Faible | `S.mode` mort, condition sans effet dans `applyColor`, commentaire du modèle dérivé | Nettoyage (3.3) |

Aucun défaut bloquant n'a été relevé : le test de fumée passe, l'export est conforme et les métadonnées d'origine sont bien retirées.

## 7. Feuille de route proposée

Chaque étape est livrable seule, avec sa version et sa ligne de changelog.

**Étape 1, gains rapides (v0.4)**
- Toast « Annuler » sur suppression de calque, de zone, réinitialisation et retrait de photo.
- Onglet Export : bouton d'export en tête, métadonnées repliées.
- Liste des calques dans l'ordre visuel, libellés « Monter » et « Descendre », liste placée avant la grille.
- Message HEIC explicite ; nettoyage (`S.mode`, condition sans effet, commentaire du modèle).
- `package.json` minimal et workflow GitHub Actions (test de fumée et vérification des tirets).

**Étape 2, structure (v0.5)**
- Registre `LAYERS` et table d'actions du panneau, sans changement de comportement ; le test de fumée sert de filet.
- Liste blanche des clés dans `applyCfg`.
- `window.__esam` pour les tests unitaires ; découpage du test de fumée en scénarios ; image de référence pour le rendu.

**Étape 3, usage terrain (v0.6)**
- Manifeste et service worker : installation et hors ligne.
- Zoom de l'aperçu (pincement à vide, double toucher) pour les flous.
- Canvas d'aperçu réduit et redécodage à l'export.

**Étape 4, productivité de l'équipe (v0.7)**
- Pile d'annulation complète (Ctrl+Z).
- Export multi-formats avec un cadre mémorisé par format.
- Modèles de mise en page enregistrés et partageables.
- Zones sûres en story, comparaison avant et après.
