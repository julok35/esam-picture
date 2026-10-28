# Consignes pour Claude Code

Projet : préparation des photos d'intervention de l'ESAM (secours animalier en montagne) pour les réseaux sociaux. Utilisateur principal : Julien ; destinataires des sorties : l'équipe communication. Toute l'interface, les messages et la documentation sont en français. Projet frère de `esam-rush` (même charte, mêmes conventions).

**Lire d'abord `docs/ARCHITECTURE.md`** : carte de `index.html`, modèle de données (`S`, la fiche `cfg`), pipeline de rendu, interactions, tests.

## Règles à chaque changement

- **Tirets** : jamais de tiret cadratin (U+2014) ni demi-cadratin (U+2013), ni dans le code, ni dans les textes, ni dans les noms de fichiers. Tiret simple uniquement (dans le code, les écrire en échappement (`\u2014` en JavaScript) quand il faut les détecter). Vérifier avant chaque commit :
  `python3 -c "import sys;[print(f, open(f,encoding='utf-8').read().count(chr(0x2014))+open(f,encoding='utf-8').read().count(chr(0x2013))) for f in sys.argv[1:]]" index.html README.md CLAUDE.md docs/ARCHITECTURE.md`
- **Version** : à chaque changement livré, incrémenter `APP_VERSION` dans `index.html` et ajouter une ligne au Changelog de `docs/ARCHITECTURE.md` (succincte, orientée utilisateur).
- **Fiche de configuration** : tout nouveau réglage va dans `cfg` (et donc dans le JSON exporté), avec une valeur par défaut dans `newCfg` ou `defLayer`, et une lecture tolérante dans `applyCfg` (une fiche ancienne doit rester lisible).
- Même rendu à l'aperçu et à l'export : tout ce qui est dessiné passe par `renderAll` (tailles en unités `u = W/1080`), l'aléa des tracés au crayon est déterministe (`rng(hash(id))`). Pas de `ctx.filter` (absent sur Safari) : les flous se font par réductions successives.
- Mobile d'abord (téléphone en portrait, gestes au doigt, scène collante), mais la mise en page PC exploite l'écran large (grille `@media (min-width:1100px)`). Respecter la charte ESAM de `index.html` (Anton, Montserrat, couleurs de `:root`).
- Pas de framework, pas de build : `index.html` reste un seul fichier (ES2017, une fonction englobante). Les bibliothèques tierces vont dans `vendor/` avec leur version dans le nom de fichier.
- Rien n'est envoyé sur Internet : tout le traitement reste dans le navigateur.

## Points délicats déjà rencontrés

- Photos de téléphone : orientation EXIF appliquée par `createImageBitmap(file, {imageOrientation:"from-image"})`, repli sur `<img>`. L'image de travail est limitée à 2560 px de côté long (mémoire sur téléphone).
- Les zones de flou sont en fraction de l'image source (elles suivent le contenu si le cadre change) ; les calques en fraction de l'image de sortie (ce sont des éléments de composition).
- Sur téléphone, l'aperçu doit rester visible pendant les réglages : `.left` (scène + onglets) est collant sous l'en-tête, 46 % de la hauteur au plus.
- Un objet déjà sélectionné garde la main s'il est sous le doigt (sinon on prend l'objet du dessus) : indispensable quand plusieurs calques se superposent au centre.
- Le cache de rendu (`p.cache.base`, `p.cache.blur`) est par taille : l'export rend dans un cache à part pour ne pas écraser celui de l'aperçu.
- Vidéos : le décodage est celui du navigateur ; les `.mov` HEVC d'iPhone ne se lisent pas partout (message à l'utilisateur, pas de conversion).

## Tester

- `node tests/test_fumee.mjs` après toute modification (Playwright et Chromium nécessaires). Regarder les captures dans `tests/captures/` (390x844 et 1400x900).
- Vérifier aussi un export réel : flous visibles aux bords fondus, logo et textes nets, dimensions exactes du format.

## Livraison

- Pousser sur `main` publie l'appli sur https://julok35.github.io/esam-picture/ (GitHub Pages, une à deux minutes).
