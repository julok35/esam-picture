# esam-picture : photos ESAM pour les réseaux sociaux

**Appli en ligne : https://julok35.github.io/esam-picture/** (à ouvrir sur téléphone ou PC, rien à installer).

Appli web très simple pour préparer les photos d'une intervention avant publication sur Facebook, Instagram et LinkedIn.

Outil de l'ESAM (Equipe de Secours Animalier en Montagne), dans la lignée de [esam-rush](https://github.com/julok35/esam-rush) (dérushage drone) : même charte, même principe (un seul fichier, tout se passe dans l'appareil, rien n'est envoyé sur Internet).

- **En ligne** : https://julok35.github.io/esam-picture/ (publié par GitHub Pages depuis `main`).
- **Hors ligne** : ouvrir `index.html` via un petit serveur local (`python -m http.server`) ; les polices sont embarquées dans `vendor/`.

## Ce que fait l'appli

| Étape | Détail |
|---|---|
| Choisir les photos | Galerie du téléphone ou fichiers (« Choisir des photos ou vidéos »), ou dossier de travail sur ordinateur (Chrome, Edge). |
| Extraire d'une vidéo | Une vidéo choisie apparaît dans la pellicule ; lecture, curseur, pas d'une image ou d'une seconde, « Capturer » ajoute l'image en pleine résolution comme photo. |
| Cadre | Format de publication (carré 1:1, portrait 4:5, story 9:16, paysage 1.91:1, large 16:9, original), rotation, redressement de l'horizon (curseur « Horizon » de -15° à +15° : la photo tourne sous le cadre, agrandie juste assez pour ne laisser aucun coin vide ; flous et zones suivent), recadrage en glissant, pinçant ou tirant un coin. |
| Montage | Bandeaux : vue large, zoom et infrarouge sur une même image, côte à côte ou empilés, chaque bande cadrée au doigt avec une étiquette. Superposition : la photo du dessus (l'infrarouge) posée en transparence sur la photo choisie dans la pellicule (le dessous) et alignée dessus (zoom, rotation, opacité, modes fondu, éclaircir, lumière, chaleur), limitée au besoin à une fenêtre aux bords fondus (réalité augmentée). Le panneau, l'aperçu et la pellicule nomment la photo du dessous et celle du dessus ; un bouton les inverse ; l'aperçu peut montrer le dessous seul ou le dessus seul. |
| Couleur | Luminosité, contraste, saturation, température, vignettage ; filtres (ESAM, noir et blanc, chaud, froid, vif, doux, vintage) ; couleurs conservées : noir et blanc sauf les couleurs choisies (le jaune fluo et le rouge vif des tenues par défaut), avec tolérance, seuil et renfort, et des zones au lasso tracées au doigt (les couleurs ne restent que dans les zones entourées, ou tout en gris dans une zone). Dans un montage, chaque photo (dessous, dessus, bande, loupe) se règle séparément depuis l'onglet, en voyant le résultat dans le montage. |
| Flous | Zones ovales ou rectangulaires, trois rendus (doux, pixelisé, dynamique), trois intensités, bords fondus pour rester discrets ; déplaçables, redimensionnables, orientables. |
| Calques | Logo ESAM (cartouche ou logo seul), titre, texte, légende (nom de l'animal, date, secteur), flèche et cercle « au crayon », zoom incrusté (loupe ronde ou rectangle qui grossit une zone de la photo repérée par un anneau relié par un trait, ou qui incruste la photo de la caméra zoom ou thermique cadrée dedans, avec étiquette). Chaque calque se déplace, s'agrandit et s'oriente au doigt, à la souris ou par curseurs ; les poignées blanches règlent la largeur et la hauteur séparément (texte et formes). Un calque se duplique (copie décalée) et se monte ou se descend dans l'ordre de superposition. |
| Annuler, comparer | Boutons « Annuler » et « Rétablir » dans l'en-tête, pour chaque photo (un glissement ou un curseur compte pour une étape). Bouton « Original » à maintenir sur l'aperçu : la photo d'origine (même cadre, sans couleurs, flous ni calques), pour comparer avant / après. |
| Raccourcis (PC) | Ctrl+Z annuler, Ctrl+Y ou Ctrl+Maj+Z rétablir, Ctrl+D dupliquer le calque ou la zone de flou choisie, O maintenue = original, Suppr supprimer, flèches déplacer, + et - taille de 5 %, R tourner la photo de 90°, 1 à 6 les onglets. Liste sous le bouton « ? » de l'en-tête ; sans effet pendant la saisie d'un texte. |
| Export | JPEG aux dimensions du format choisi, nommé `AAAAMMJJ_animaux_secteur_photo-Com-ESAM_hhmmss.jpg` (date de l'intervention, animaux, secteur, heure de prise de vue comme code unique ; champs modifiables), partage direct (téléphone, avec le texte de publication). Qualité « Réseaux » (JPEG 92 %, taille du format) ou « Presse » (JPEG 97 %, dimensions doublées, suffixe `_presse`). Toutes les photos modifiées en un seul fichier ZIP `AAAAMMJJ_photos-Com-ESAM.zip` (chaque photo avec son texte `.txt` et, au choix, sa fiche). Déclinaisons : la même photo dans plusieurs formats en une fois (carré, portrait, story...), chaque format gardant son propre cadre, dans un ZIP (suffixes `_carre`, `_story`...). Texte de publication (titre, animal, date en toutes lettres, secteur, pied ESAM et mots-dièse) et texte alternatif pour l'accessibilité, proposés d'après la légende, modifiables et copiables d'un geste. Aucune métadonnée d'origine (localisation, date, auteur, appareil) : le fichier porte les métadonnées ESAM (auteur, droits, description facultative). |
| Fiche de configuration | JSON par photo décrivant tout le travail ; export et import pour reprendre plus tard ou sur un autre appareil. Avec un dossier de travail, la fiche `Photo.jpg.esam.json` est écrite à côté de la photo et reprise à l'ouverture suivante ; les exports vont dans `publication/`. |

Le travail en cours est aussi gardé dans le navigateur (IndexedDB, avec une copie des 40 fiches les plus récentes dans localStorage ; clé = nom, taille et date du fichier) : rouvrir la même photo retrouve ses réglages, même après plusieurs centaines de photos. Une fiche non modifiée depuis 90 jours est effacée à l'ouverture de l'appli ; pour la garder plus longtemps, exportez-la ou utilisez un dossier de travail.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | L'appli (un seul fichier, sans étape de construction) |
| `vendor/` | Polices Anton et Montserrat embarquées (licence OFL) |
| `docs/ARCHITECTURE.md` | Documentation technique : modèle de données, pipeline de rendu, conventions, tests |
| `tests/test_fumee.mjs` | Test de bout en bout (Playwright, Chromium) avec captures d'écran dans `tests/captures/` |
| `CLAUDE.md` | Consignes pour Claude Code |

## Tester

```bash
node tests/test_fumee.mjs
```

Playwright et Chromium doivent être installés (`npm i -g playwright && npx playwright install chromium`). Le test sert le dossier, fabrique des photos et une vidéo, exerce chaque onglet, exporte une photo et une fiche, un ZIP groupé, des déclinaisons et une photo en qualité presse (ZIP relus et dimensions vérifiées), puis vérifie la reprise de la fiche et l'extraction d'une image de vidéo, en 390x844 (téléphone) et 1400x900 (PC).

Licence MIT, voir `LICENSE`.
