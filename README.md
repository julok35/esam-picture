# esam-picture : photos ESAM pour les réseaux sociaux

Appli web très simple pour préparer les photos d'une intervention avant publication sur Facebook, Instagram et LinkedIn.

Outil de l'ESAM (Equipe de Secours Animalier en Montagne), dans la lignée de [esam-rush](https://github.com/julok35/esam-rush) (dérushage drone) : même charte, même principe (un seul fichier, tout se passe dans l'appareil, rien n'est envoyé sur Internet).

- **En ligne** : https://julok35.github.io/esam-picture/ (publié par GitHub Pages depuis `main`).
- **Hors ligne** : ouvrir `index.html` via un petit serveur local (`python -m http.server`) ; les polices sont embarquées dans `vendor/`.

## Ce que fait l'appli

| Étape | Détail |
|---|---|
| Choisir les photos | Galerie du téléphone ou fichiers (« Choisir des photos ou vidéos »), ou dossier de travail sur ordinateur (Chrome, Edge). |
| Extraire d'une vidéo | Une vidéo choisie apparaît dans la pellicule ; lecture, curseur, pas d'une image ou d'une seconde, « Capturer » ajoute l'image en pleine résolution comme photo. |
| Cadre | Format de publication (carré 1:1, portrait 4:5, story 9:16, paysage 1.91:1, large 16:9, original), rotation, recadrage en glissant, pinçant ou tirant un coin. |
| Couleur | Luminosité, contraste, saturation, température, vignettage ; filtres (ESAM, noir et blanc, chaud, froid, vif, doux, vintage). |
| Flous | Zones ovales ou rectangulaires, trois rendus (doux, pixelisé, dynamique), trois intensités, bords fondus pour rester discrets ; déplaçables, redimensionnables, orientables. |
| Calques | Logo ESAM (cartouche ou logo seul), titre, texte, légende (nom de l'animal, date, secteur), flèche et cercle « au crayon ». Chaque calque se déplace, s'agrandit et s'oriente au doigt, à la souris ou par curseurs. |
| Export | JPEG aux dimensions du format choisi, partage direct (téléphone), export de toutes les photos modifiées. Aucune métadonnée d'origine (localisation, date, auteur, appareil) : le fichier porte les métadonnées ESAM (auteur, droits, description facultative). |
| Fiche de configuration | JSON par photo décrivant tout le travail ; export et import pour reprendre plus tard ou sur un autre appareil. Avec un dossier de travail, la fiche `Photo.jpg.esam.json` est écrite à côté de la photo et reprise à l'ouverture suivante ; les exports vont dans `publication/`. |

Le travail en cours est aussi gardé dans le navigateur (localStorage, clé = nom, taille et date du fichier) : rouvrir la même photo retrouve ses réglages.

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

Playwright et Chromium doivent être installés (`npm i -g playwright && npx playwright install chromium`). Le test sert le dossier, fabrique des photos et une vidéo, exerce chaque onglet, exporte une photo et une fiche, puis vérifie la reprise de la fiche et l'extraction d'une image de vidéo, en 390x844 (téléphone) et 1400x900 (PC).

Licence MIT, voir `LICENSE`.
