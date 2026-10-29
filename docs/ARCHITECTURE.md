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
| rendu : flous | Zones converties dans le repère de sortie ; doux, pixelisé, dynamique ; masque aux bords fondus | `applyBlurs`, `blurredCanvas`, `downUp` |
| rendu : calques | Logo (cartouche ou seul), titre, texte, légende, flèche et cercle au crayon, éléments de cadre (signature, montagne, biais, coin, carte) ; boîte de chaque calque | `drawLayer`, `drawBrand`, `textBlock`, `drawLegende`, `drawFleche`, `drawCercle`, `drawForme`, `drawCoin`, `drawSignature`, `drawCarte`, `pencil`, `renderAll` |
| aperçu | Vue « cadre » (photo entière + cadre) ou « sortie » (image finale + poignées) ; `V` décrit l'espace courant | `draw`, `drawOutView`, `drawCropView`, `layoutCanvas` |
| interactions | Un doigt : déplacer ou poignée (taille, rotation, largeur) ; deux doigts : pincement ; molette ; clavier ; grille magnétique des calques ; double toucher = saisie du texte | `curObj`, `pick`, `applyGesture`, `applyWidth`, `snapLayer`, `drawGrid`, événements `pointer*` |
| pellicule et panneaux | Vignettes, sélection, onglets ; un panneau par onglet reconstruit par `renderPanel`, gestionnaires délégués sur `#panel` ; dans Calques, le réglage du calque choisi (`#leditor`) vient en tête du panneau | `renderFilm`, `select`, `renderPanel`, `layerEditor`, `revealEditor`, `focusEditor` |
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
grille     {aimant, n: 6|12|24}  grille magnétique des calques (pas carré W/n) ; la dernière valeur choisie sert de défaut
meta       {auteur, droits, description}  métadonnées écrites dans le JPEG exporté ; auteur et droits choisis en dernier servent de défaut
```

Le titre ne revient à la ligne qu'aux retours saisis (sa taille ne dépend que de `s`) ; le texte revient à la ligne dans une zone de largeur `larg` (fraction de W), indépendante de `s`. Le coin est recalé dans son angle à chaque rendu (`placeCoin`). Les champs commençant par `_` (`_box`) sont des données de travail, exclues de la fiche (`noPriv`).

Une fiche se lit par `applyCfg`, qui tolère les champs absents ou inconnus. Dans un dossier de travail, la fiche de `Photo.jpg` est `Photo.jpg.esam.json` à côté d'elle.

## 4. Pipeline de rendu

`renderAll(ctx, p, W, H, cw, ch)` dessine dans un repère de sortie W x H (l'appelant applique l'échelle) :

1. `baseCanvas` : source tournée, recadrée, mise à l'échelle cw x ch, puis `applyColor` (cache par clé format + cadre + rotation + couleur + filtre + taille).
2. `blurredCanvas` : les zones de flou appliquées sur la base (cache par la liste des zones).
3. Les calques dans l'ordre de la liste, chacun dans son repère (translation, rotation, échelle) ; `drawLayer` mémorise la boîte `_box` pour les poignées et la détection du doigt.

Les tailles des calques sont en unités `u = W/1080` : un même calque a la même proportion quel que soit le format. L'aperçu rend dans un canvas de la taille de l'écran (au plus W), l'export dans un canvas W x H ; les deux passent par les mêmes fonctions, avec le même aléa (`rng(hash(id))`) pour les tracés au crayon.

Métadonnées : le JPEG encodé par le canvas ne reprend rien de la photo d'origine (ni EXIF, ni GPS, ni date, ni appareil). `withMeta` retire en plus tout segment APP1 à APP15 et commentaire, puis écrit un EXIF (Artist, Copyright, Software, ImageDescription, en ASCII sans accents, Orientation 1) et un XMP (dc:creator, dc:rights, dc:description, xmp:CreatorTool, en UTF-8). Aucune date, aucun lieu. Les images extraites d'une vidéo passent par le même traitement.

Flous sans `ctx.filter` : la région est réduite en plusieurs passes puis remontée (`downUp`), ce qui approche un flou gaussien ; le pixelisé remonte sans lissage ; le dynamique superpose la région décalée le long de l'orientation. Le masque est la forme pleine légèrement réduite puis adoucie par `downUp`, d'où des bords fondus proportionnels à la zone.

## 5. Tests

`node tests/test_fumee.mjs` : sert le dossier par HTTP, fabrique deux photos et une vidéo WebM dans le navigateur, puis en 390x844 (tactile) et 1400x900 : chargement, formats, zoom et déplacement du cadre, filtre et curseur de couleur, trois zones de flou, six calques, cinq éléments de cadre, saisie du texte à l'ajout, déplacement d'un calque à la souris, aimantation sur la grille et désactivation, export JPEG (nom, dimensions et métadonnées vérifiés : la photo de test porte un EXIF de téléphone avec auteur, date et GPS, absents de l'export), export de la fiche, reprise de la fiche dans une page vierge, extraction d'une image de vidéo. Captures dans `tests/captures/` (ignorées par git).

## 6. Changelog

- 0.3 (2026-10-29) : les photos exportées et les images extraites des vidéos ne contiennent plus aucune métadonnée d'origine (localisation, date, auteur, appareil) ; elles portent à la place les métadonnées ESAM (auteur, droits, description facultative), réglables dans l'onglet Export.
- 0.2 (2026-10-28) : grille magnétique pour les calques (large, moyenne, fine ou désactivée) ; éléments de cadre : signature ESAM, montagne, biais, coin aux bandes ESAM, carte ; le réglage du calque choisi s'affiche en haut du panneau, la saisie du texte s'ouvre à l'ajout ou d'un double toucher ; le titre ne revient plus à la ligne tout seul, le texte a une largeur de zone réglable (poignée blanche).
- 0.1 (2026-10-28) : première version : photos de la galerie, des fichiers ou d'un dossier de travail ; extraction d'images d'une vidéo ; cadre aux formats des réseaux ; couleurs et filtres ; flous doux, pixelisé, dynamique ; logo, titre, texte, légende, flèche, cercle ; export JPEG, partage, fiche de configuration JSON.
