# Architecture de esam-picture

Document pour un développeur qui découvre le projet. Les consignes données à l'assistant de code sont dans `CLAUDE.md` et renvoient ici.

## 1. Vue d'ensemble

Un seul fichier, `index.html` (HTML, CSS et JavaScript ES2017 dans une fonction englobante), aucune étape de construction, aucune dépendance en ligne : les polices sont dans `vendor/`, le logo est embarqué en base64. Tout le traitement (décodage, recadrage, couleurs, flous, composition, export JPEG) se fait dans le navigateur avec l'API canvas 2D.

```
Téléphone ou PC ──► index.html ──► photos choisies (galerie, fichiers, dossier de travail)
                                   ou images extraites d'une vidéo (élément <video> + canvas)
                                   ──► aperçu interactif ──► JPEG + fiche JSON
```

## 2. Carte de `index.html`

Le CSS vient en premier (variables de la charte dans `:root`, mode sombre), puis le HTML (accueil, pellicule, scène, onglets, panneau, dialogue vidéo), puis le script. Chaque section du script porte un commentaire d'en-tête `/* ---------- nom ---------- */`.

| Section | Rôle | Fonctions d'entrée |
|---|---|---|
| utils | Échappement, slug, aléa déterministe, toast, téléchargement, texte multiligne | `esc`, `slug`, `rng`, `toast`, `download`, `wrapLines` |
| modèle | État `S`, formats, filtres, fiche `cfg` par défaut, lecture tolérante d'une fiche, cadre maximal | `newCfg`, `defLayer`, `applyCfg`, `fixCadre`, `persist`, `restoreCfg` |
| chargement | Décodage (orientation EXIF), image de travail, vignette, ajout à la pellicule | `decode`, `addPhotos` |
| dossier de travail | `showDirectoryPicker` (Chrome, Edge) avec reprise par IndexedDB, repli `webkitdirectory`, écriture des fiches et des exports | `openDir`, `walkDir`, `importFolder`, `writeInDir`, `scheduleFicheWrite` |
| rendu : base | Rotation, recadrage, mise à l'échelle, couleurs par pixel (tables par canal, saturation, teinte, vignettage) | `baseCanvas`, `applyColor`, `colorParams` |
| rendu : montage | Composition avec d'autres photos chargées : bandeaux (bandes égales, cadre et étiquette par bande) ou superposition (photo posée en transparence, mode de fusion, fenêtre aux bords fondus) ; photos manquantes remplacées par un panneau | `readMontage`, `fixMontage`, `paneRects`, `montageCanvas`, `drawBandes`, `drawFusion`, `prepCanvas`, `heatCanvas`, `fusionBox`, `fenetreBox` |
| rendu : flous | Zones converties dans le repère de sortie ; doux, pixelisé, dynamique ; masque aux bords fondus | `applyBlurs`, `blurredCanvas`, `downUp` |
| rendu : calques | Logo (cartouche ou seul), titre, texte, légende, flèche et cercle au crayon, zoom incrusté (loupe : zone grossie de la photo ou autre photo incrustée), éléments de cadre (signature, montagne, biais, coin, carte) ; boîte de chaque calque | `drawLayer`, `drawBrand`, `textBlock`, `drawLegende`, `drawFleche`, `drawCercle`, `drawZoom`, `drawZoomLien`, `loupeCanvas`, `zoneBox`, `fitZone`, `drawForme`, `drawCoin`, `drawSignature`, `drawCarte`, `pencil`, `renderAll` |
| aperçu | Vue « cadre » (photo entière + cadre) ou « sortie » (image finale + poignées) ; `V` décrit l'espace courant ; en Montage, étiquettes nommant la photo du dessous et celle du dessus (ou de chaque bande), vue « dessous seul » ou « dessus seul » (`S.mview`, transitoire) | `draw`, `drawOutView`, `drawCropView`, `layoutCanvas`, `tagOn` |
| interactions | Un doigt : déplacer ou poignée (taille, rotation, largeur) ; deux doigts : pincement ; molette ; clavier ; grille magnétique des calques ; double toucher = saisie du texte ; dans Montage : la photo d'une bande suit le doigt (son cadre va dans l'autre sens), la photo superposée ou sa fenêtre se manipule comme un calque ; pour un zoom incrusté, `S.lsub` choisit ce que le doigt règle : la loupe, la zone grossie (anneau sur la photo) ou le cadrage dans la loupe (la photo incrustée suit le doigt) | `curObj`, `pick`, `applyGesture`, `applyWidth`, `snapLayer`, `drawGrid`, événements `pointer*` |
| pellicule et panneaux | Vignettes (avec le rôle de chaque photo dans la composition de la photo choisie : dessous, dessus, bande n, loupe), sélection, onglets ; l'onglet Couleur règle au choix la photo de base ou une photo de la composition (`S.csrc`, fiche de cette photo), avec des raccourcis depuis Montage et la loupe (`data-ctab`) ; un panneau par onglet reconstruit par `renderPanel`, gestionnaires délégués sur `#panel` ; dans Calques, le réglage du calque choisi (`#leditor`) vient en tête du panneau | `renderFilm`, `composition`, `filmRoles`, `colorTarget`, `goTab`, `select`, `renderPanel`, `layerEditor`, `revealEditor`, `focusEditor` |
| export | Rendu plein format dans un cache à part, JPEG 92 %, métadonnées ESAM à la place de celles d'origine, dossier ou téléchargement, partage, export groupé | `renderExport`, `withMeta`, `exifSeg`, `xmpSeg`, `exportPhoto`, `sharePhoto`, `exportAll` |
| vidéos | Pellicule, dialogue `#vdlg`, capture de l'image courante en pleine résolution | `addVideos`, `openVideo`, `videoThumb` |

Conventions du script : rendu par `innerHTML` et gabarits avec `esc()` sur toute valeur venant des données ; gestionnaires posés une fois sur les conteneurs, lisant des attributs `data-*` ; fonctions déclarées, état en `const`/`let`.

## 3. Modèle de données

`S.photos[]` : `{id, name, path, file, key, w, h, img, thumb, cfg, cache, modified, exported}`. `img` est un canvas de travail (côté long 2560 px au plus), `key` = nom, taille et date du fichier (clé localStorage). `S.videos[]` : `{id, name, path, file, url, thumb, n}`.

`cfg`, la fiche de configuration (exportée telle quelle en JSON, `version: 1`) :

```
format     carre | portrait | story | paysage | large | original
rotation   0 | 90 | 180 | 270
cadre      {x, y, w, h} en fraction de l'image source (tournée) ; ratio imposé par le format (fixCadre)
couleur    {lum, contraste, sat, temp, vignette} de -100 à 100
filtre     aucun | esam | nb | chaud | froid | vif | doux | vintage (préréglage ajouté aux réglages)
flous      [{id, forme: ellipse|rect, mode: doux|pixel|dynamique, force: 1..3, x, y, w, h, angle}]  fractions de la source
calques    [{id, type, x, y, s, rot, ...}]  x, y en fraction de l'image de sortie, s échelle, rot en degrés
             logo {mode: cartouche|logo}   titre, texte {texte, couleur, fond: ombre|contour|bande|boite|aucun}  texte {larg}
             legende {animal, date (AAAA-MM-JJ), secteur, couleur}   fleche {couleur, epais}   cercle {couleur, epais, ar}
             signature {texte, couleur}   montagne, biais {couleur, ar, op, miroir}   coin {coin: hg|hd|bg|bd, couleur}
             carte {texte, couleur, style: barre|plein, ar}
             zoom {src, zone: {x, y, w}, forme: cercle|rect, ar, couleur, epais: 0..3, lien, etiquette}  loupe posée sur l'image :
               src = null (une zone de cette photo, repérée par un anneau relié à la loupe) ou le nom d'une autre photo chargée
               (caméra zoom _Z, thermique) ; zone = centre et largeur en fraction de la source grossie (de l'image de sortie en
               bandeaux, comme les flous), la hauteur suit la forme de la loupe
montage    {mode: aucun|bandes|fusion, sens: v|h, sep, sepCouleur, bandes, fusion}  composition avec d'autres photos chargées
             bandes [{src, cadre, etiquette}]  src = nom de fichier de la photo (null : la photo elle-même), cadre en fraction
               de la source de cette photo au ratio de la bande (bandes égales, côte à côte si sens v, empilées si h)
             fusion {src, x, y, s, rot, op, mode: fondu|eclaircir|ecran|chaleur, seuil, fenetre}  photo posée sur la base :
               x, y en fraction de la sortie, s = largeur / largeur de sortie ; fenetre {forme: non|rect|ellipse, x, y, w, h,
               fondu, contour} en fraction de la photo superposée (elle suit son alignement)
grille     {aimant, n: 6|12|24}  grille magnétique des calques (pas carré W/n) ; la dernière valeur choisie sert de défaut
meta       {auteur, droits, description}  métadonnées écrites dans le JPEG exporté ; auteur et droits choisis en dernier servent de défaut
```

Le titre ne revient à la ligne qu'aux retours saisis (sa taille ne dépend que de `s`) ; le texte revient à la ligne dans une zone de largeur `larg` (fraction de W), indépendante de `s`. Le coin est recalé dans son angle à chaque rendu (`placeCoin`). Les champs commençant par `_` (`_box`) sont des données de travail, exclues de la fiche (`noPriv`).

Une fiche se lit par `applyCfg`, qui tolère les champs absents ou inconnus. Dans un dossier de travail, la fiche de `Photo.jpg` est `Photo.jpg.esam.json` à côté d'elle.

Le zoom incrusté grossit la photo d'origine (pleine résolution, couleurs de la fiche de la photo grossie) ; si la zone touche une zone floutée, ou en bandeaux, le contenu vient de l'image de base déjà floutée (`zoomFromBase`), pour ne jamais révéler ce qui est caché. À l'ajout, la photo zoom du même vol (`_Z`) est incrustée d'office.

Le montage désigne les autres photos par leur nom (`src`, comparé au chemin puis au nom des photos chargées) ; chaque photo du montage est rendue avec les couleurs de sa propre fiche. Une photo absente donne un panneau « Photo manquante ». Avec le nommage DJI (`_W` vue large, `_Z` zoom, `_T` thermique), les bandes et la photo superposée sont proposées d'office (`kindOf`, `siblings`), avec des étiquettes par défaut. En bandeaux, le cadre de la fiche (`cadre`) n'est pas utilisé et les zones de flou sont en fraction de l'image de sortie (`cropRef`).

## 4. Pipeline de rendu

`renderAll(ctx, p, W, H, cw, ch)` dessine dans un repère de sortie W x H (l'appelant applique l'échelle) :

1. `baseCanvas` : la photo seule (`ownCanvas` : source tournée, recadrée, mise à l'échelle cw x ch, puis `applyColor`, cache par clé format + cadre + rotation + couleur + filtre + taille) ou le montage (`montageCanvas`, clé étendue au montage et aux fiches des photos référencées). Bandeaux : chaque bande est un recadrage de sa photo (`paneCanvas`) ; superposition : la photo superposée entière, tournée et colorée (`prepCanvas`, côté long limité à deux fois la base), dessinée dans un calque cw x ch avec sa transformation, masquée par la fenêtre (forme réduite puis adoucie par `downUp`), puis composée avec l'opacité et le mode (`globalCompositeOperation` : lighten, screen ; chaleur = alpha par luminance, `heatCanvas`). Les rendus intermédiaires sont gardés dans `p.cache.preps` (huit au plus).
2. `blurredCanvas` : les zones de flou appliquées sur la base (cache par la liste des zones).
3. Les calques dans l'ordre de la liste, chacun dans son repère (translation, rotation, échelle) ; `drawLayer` mémorise la boîte `_box` pour les poignées et la détection du doigt. Le zoom incrusté dessine d'abord, dans le repère de l'image, l'anneau de la zone et son trait (`drawZoomLien`), puis la loupe dans son repère : ombre, contenu (`loupeCanvas`, recadrage de la source à la résolution d'export, en cache dans `p.cache.preps`), contour, étiquette.

Vue d'aperçu de la superposition (« le dessous seul », « le dessus seul ») : `drawOutView` pose un champ de travail `_vue` sur `cfg.montage` le temps du rendu (clé de cache distincte), jamais écrit dans la fiche ni utilisé à l'export.

Les tailles des calques sont en unités `u = W/1080` : un même calque a la même proportion quel que soit le format. L'aperçu rend dans un canvas de la taille de l'écran (au plus W), l'export dans un canvas W x H ; les deux passent par les mêmes fonctions, avec le même aléa (`rng(hash(id))`) pour les tracés au crayon.

Métadonnées : le JPEG encodé par le canvas ne reprend rien de la photo d'origine (ni EXIF, ni GPS, ni date, ni appareil). `withMeta` retire en plus tout segment APP1 à APP15 et commentaire, puis écrit un EXIF (Artist, Copyright, Software, ImageDescription, en ASCII sans accents, Orientation 1) et un XMP (dc:creator, dc:rights, dc:description, xmp:CreatorTool, en UTF-8). Aucune date, aucun lieu. Les images extraites d'une vidéo passent par le même traitement.

Flous sans `ctx.filter` : la région est réduite en plusieurs passes puis remontée (`downUp`), ce qui approche un flou gaussien ; le pixelisé remonte sans lissage ; le dynamique superpose la région décalée le long de l'orientation. Le masque est la forme pleine légèrement réduite puis adoucie par `downUp`, d'où des bords fondus proportionnels à la zone.

## 5. Tests

`node tests/test_fumee.mjs` : sert le dossier par HTTP, fabrique deux photos et une vidéo WebM dans le navigateur, puis en 390x844 (tactile) et 1400x900 : chargement, formats, zoom et déplacement du cadre, filtre et curseur de couleur, trois zones de flou, six calques, cinq éléments de cadre, saisie du texte à l'ajout, déplacement d'un calque à la souris, aimantation sur la grille et désactivation, zoom incrusté (anneau de la zone déplacé à la souris, grossissement, photo de la caméra zoom incrustée et cadrée dans la loupe, badge dans la pellicule, forme rectangle, étiquette), montage (bandeaux : choix et cadrage d'une bande à la souris, étiquette, bandes empilées ; superposition : panneau dessous / dessus, badges de la pellicule, vue « le dessus seul », opacité, déplacement de la photo superposée, fenêtre ovale déplacée, export du montage avec son suffixe, inversion dessous / dessus dans les deux sens), export JPEG (nom, dimensions et métadonnées vérifiés : la photo de test porte un EXIF de téléphone avec auteur, date et GPS, absents de l'export), export de la fiche, reprise de la fiche dans une page vierge, extraction d'une image de vidéo. Captures dans `tests/captures/` (ignorées par git).

## 6. Changelog

- 0.6 (2026-10-30) : couleurs de chaque photo du montage : l'onglet Couleur propose « Image à régler » (dessous, dessus, bandes, loupe) et modifie la fiche de la photo choisie en montrant le résultat dans le montage ; boutons « Couleurs du dessus / du dessous / de cette photo / de la photo incrustée » dans Montage et dans la loupe ; « Mêmes réglages que la photo de base ».

- 0.5 (2026-10-30) : superposition plus lisible : le panneau montre qui est dessous (la photo choisie dans la pellicule) et qui est dessus, avec vignettes et noms ; bouton « Inverser » ; étiquettes « Dessous » et « Dessus » sur l'aperçu (et le nom de la photo de chaque bande) ; badges dans la pellicule (Dessous, Dessus, Bande n, Loupe) ; aperçu « le dessous seul » ou « le dessus seul ». Nouveau calque « Zoom incrusté » : loupe ronde ou rectangle qui grossit une zone de la photo (anneau sur la zone, trait de liaison, grossissement réglable) ou qui incruste la photo de la caméra zoom ou thermique, cadrée au doigt dans la loupe ; contour, étiquette.

- 0.4 (2026-10-30) : onglet Montage. Bandeaux : plusieurs photos (vue large, zoom, infrarouge) sur une même image, côte à côte ou empilées, chaque bande cadrée au doigt avec une étiquette, séparateur réglable. Superposition : la photo infrarouge posée en transparence sur la photo et alignée dessus (déplacement, zoom, rotation fine, opacité, modes fondu, éclaircir, lumière, chaleur), limitée au besoin à une fenêtre rectangle ou ovale aux bords fondus. Photos DJI (_W, _Z, _T) proposées d'office.
- 0.3 (2026-10-29) : les photos exportées et les images extraites des vidéos ne contiennent plus aucune métadonnée d'origine (localisation, date, auteur, appareil) ; elles portent à la place les métadonnées ESAM (auteur, droits, description facultative), réglables dans l'onglet Export.
- 0.2 (2026-10-28) : grille magnétique pour les calques (large, moyenne, fine ou désactivée) ; éléments de cadre : signature ESAM, montagne, biais, coin aux bandes ESAM, carte ; le réglage du calque choisi s'affiche en haut du panneau, la saisie du texte s'ouvre à l'ajout ou d'un double toucher ; le titre ne revient plus à la ligne tout seul, le texte a une largeur de zone réglable (poignée blanche).
- 0.1 (2026-10-28) : première version : photos de la galerie, des fichiers ou d'un dossier de travail ; extraction d'images d'une vidéo ; cadre aux formats des réseaux ; couleurs et filtres ; flous doux, pixelisé, dynamique ; logo, titre, texte, légende, flèche, cercle ; export JPEG, partage, fiche de configuration JSON.
