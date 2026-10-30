/* Test de fumée (Playwright, Chromium) : sert le dossier, charge des photos fabriquées, exerce chaque onglet,
   exporte une photo et une fiche, puis vérifie la reprise d'une fiche. Captures d'écran dans tests/captures/.
   Lancer : node tests/test_fumee.mjs   (Chromium et Playwright doivent être installés : npx playwright install chromium) */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");   // require honore NODE_PATH (installation globale)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caps = path.join(root, "tests", "captures");
fs.mkdirSync(caps, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".woff2": "font/woff2", ".json": "application/json", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
function check(cond, msg) { if (cond) console.log(`  ok   ${msg}`); else { failures++; console.log(`  ECHEC ${msg}`); } }

const browser = await chromium.launch();
/* fabrique une photo JPEG (paysage ou portrait) avec des repères colorés, dans un onglet à part */
async function fakePhoto(ctxB, w, h, name) {
  const pg = await ctxB.newPage();
  const b64 = await pg.evaluate(([w, h]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#5b8def"); g.addColorStop(1, "#2a3d1f"); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#e8d7b0"; x.beginPath(); x.arc(w * 0.35, h * 0.45, Math.min(w, h) * 0.12, 0, Math.PI * 2); x.fill();   // un « visage »
    x.fillStyle = "#fff"; x.fillRect(w * 0.6, h * 0.7, w * 0.25, h * 0.08); x.fillStyle = "#000"; x.font = `${h * 0.05}px sans-serif`; x.fillText("AB-123-CD", w * 0.62, h * 0.76);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, [w, h]);
  await pg.close();
  const jpg = Buffer.from(b64, "base64");
  return { name, mimeType: "image/jpeg", buffer: Buffer.concat([jpg.subarray(0, 2), fakeExif(), jpg.subarray(2)]) };
}
/* EXIF d'un téléphone : auteur, date de prise de vue et position GPS, qui ne doivent pas se retrouver dans l'export */
function fakeExif() {
  const u16 = v => [v >> 8 & 255, v & 255], u32 = v => [v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
  const artist = [...Buffer.from("Julien Dupont\0")], date = [...Buffer.from("2024:05:01 10:00:00\0")];
  const ifd0 = 8, gpsAt = ifd0 + 2 + 3 * 12 + 4, dataAt = gpsAt + 2 + 2 * 12 + 4;
  const tiff = [0x4D, 0x4D, 0, 42, ...u32(ifd0), ...u16(3),
    ...u16(0x0132), ...u16(2), ...u32(date.length), ...u32(dataAt),
    ...u16(0x013B), ...u16(2), ...u32(artist.length), ...u32(dataAt + date.length),
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(gpsAt), 0, 0, 0, 0,
    ...u16(2), ...u16(0x0001), ...u16(2), ...u32(2), 0x4E, 0, 0, 0, ...u16(0x0003), ...u16(2), ...u32(2), 0x45, 0, 0, 0, 0, 0, 0, 0,
    ...date, ...artist];
  const body = [...Buffer.from("Exif\0\0"), ...tiff];
  return Buffer.from([0xFF, 0xE1, ...u16(body.length + 2), ...body]);
}

for (const [label, vp] of [["telephone", { width: 390, height: 844 }], ["pc", { width: 1400, height: 900 }]]) {
  console.log(`\n== ${label} ${vp.width}x${vp.height}`);
  const ctxB = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: label === "telephone" });
  const page = await ctxB.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.screenshot({ path: path.join(caps, `${label}_accueil.png`) });
  const photos = [await fakePhoto(ctxB, 1600, 1200, "DJI_0001.jpg"), await fakePhoto(ctxB, 900, 1600, "IMG_portrait.jpg")];
  await page.setInputFiles("#fileIn", photos);
  await page.waitForSelector("#main:not([hidden])");
  await page.waitForFunction(() => document.querySelectorAll("#film .th:not(.add)").length === 2);
  check(await page.isVisible("#cv"), "deux photos chargées, aperçu visible");
  await page.screenshot({ path: path.join(caps, `${label}_cadre.png`) });

  // Cadre : format story puis portrait, zoom
  await page.click('[data-fmt="story"]');
  await page.waitForFunction(() => document.getElementById("tagFmt").textContent.includes("1080 x 1920")).catch(() => {});
  check((await page.textContent("#tagFmt")).includes("1080 x 1920"), "format story appliqué");
  await page.click('[data-fmt="portrait"]');
  await page.$eval('input[data-zoom]', el => { el.value = 60; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500);
  const cadre = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).cadre);
  check(cadre && cadre.w < 0.8, `zoom du cadre enregistré (w=${cadre && cadre.w.toFixed(2)})`);
  // glisser le cadre sur l'aperçu
  const box = await page.locator("#cv").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const cadre2 = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).cadre);
  check(cadre2.x > cadre.x, "cadre déplacé à la souris");

  // Couleur
  await page.click('[data-tab="couleur"]');
  await page.click('[data-filtre="esam"]');
  await page.$eval('input[data-col="contraste"]', el => { el.value = 30; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_couleur.png`) });
  check((await page.getAttribute('[data-filtre="esam"]', "aria-pressed")) === "true", "filtre ESAM sélectionné");

  // Flous
  await page.click('[data-tab="flous"]');
  await page.click('[data-act="addZone"]');
  await page.click('[data-fmode="pixel"]');
  await page.click('[data-act="addZone"]');
  await page.click('[data-fmode="dynamique"]');
  await page.click('[data-act="addZone"]');
  check((await page.$$('[data-fsel]')).length === 3, "trois zones de flou ajoutées");
  await page.screenshot({ path: path.join(caps, `${label}_flous.png`) });

  // Calques
  await page.click('[data-tab="calques"]');
  for (const t of ["logo", "titre", "texte", "legende", "fleche", "cercle"]) await page.click(`[data-addl="${t}"]`);
  check((await page.$$('[data-csel]')).length === 6, "six calques ajoutés");
  await page.click('[data-csel]:nth-of-type(1)');
  await page.click('button.sel:has-text("Titre")');
  await page.fill('textarea[data-ltext]', "Chien secouru en Belledonne");
  await page.click('button.sel:has-text("Légende")');
  await page.fill('input[data-lfield="animal"]', "Rex");
  await page.fill('input[data-lfield="secteur"]', "Belledonne");
  await page.$eval('input[data-lrot]', el => { el.value = 15; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(600);
  // poignée de rotation du calque sélectionné : glisser doit changer rot
  await page.click('button.sel:has-text("Flèche")');
  await page.waitForTimeout(200);
  const rotBefore = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).calques.find(l => l.type === "fleche").rot);
  const bb = await page.locator("#cv").boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 30, bb.y + bb.height / 2 + 30, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const fl = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).calques.find(l => l.type === "fleche"));
  check(Math.abs(fl.x - 0.5) > 0.005, `flèche déplacée à la souris (x=${fl.x.toFixed(3)}, rot avant=${rotBefore})`);

  // Éléments de cadre, saisie du texte à l'ajout, grille magnétique
  for (const t of ["signature", "montagne", "biais", "coin", "carte"]) await page.click(`[data-addl="${t}"]`);
  check((await page.$$('[data-csel]')).length === 11, "cinq éléments de cadre ajoutés");
  check(await page.evaluate(() => document.activeElement && document.activeElement.dataset.ltext === "1"), "saisie du texte ouverte à l'ajout de la carte");
  const ed = await page.locator("#leditor").boundingBox();
  check(ed && ed.y < vp.height - 100, `réglage du calque visible sans descendre (y=${ed && Math.round(ed.y)})`);
  await page.keyboard.type("Drone");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_elements_cadre.png`) });
  const cfgOf = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))));
  let cf = await cfgOf();
  const coin = cf.calques.find(l => l.type === "coin");
  check(Math.abs(coin.x - (1 - 180 / 1080)) < 0.002 && Math.abs(coin.y - (1 - 180 / 1350)) < 0.002, "coin collé à l'angle bas droite");
  check(cf.calques.find(l => l.type === "carte").texte === "Drone" && cf.grille && cf.grille.aimant, "texte de la carte saisi, grille active");
  const b3 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.mouse.down();
  await page.mouse.move(b3.x + b3.width / 2 + 47, b3.y + b3.height / 2 + 23, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  const carte = cf.calques.find(l => l.type === "carte"), rx = Math.round(carte.x * 1080) % 90;
  check(carte.x !== 0.5 && [0, 20, 70].includes(rx), `carte aimantée sur la grille (x=${(carte.x * 1080).toFixed(1)} px)`);
  check(!JSON.stringify(cf).includes("_box"), "pas de champ de travail dans la fiche");
  await page.click('[data-csel]:has-text("Titre")');
  await page.$eval('input[data-ls]', el => { el.value = 180; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click('[data-grille="0"]');
  cf = await cfgOf();
  check(cf.grille.aimant === false, "grille désactivable");
  await page.click('[data-act="ldone"]');
  await page.screenshot({ path: path.join(caps, `${label}_calques.png`) });

  // Poignées blanches : largeur (bord droit) et hauteur (bord bas) du cercle, resté au centre, à l'échelle 1
  await page.click('button.sel:has-text("Cercle")');
  await page.waitForTimeout(200);
  const bc = await page.locator("#cv").boundingBox(), ccx = bc.x + bc.width / 2, ccy = bc.y + bc.height / 2;
  await page.mouse.move(bc.x + bc.width * (540 + 219.5) / 1080, ccy); await page.mouse.down();
  await page.mouse.move(bc.x + bc.width * (540 + 219.5) / 1080 + 40, ccy, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.move(ccx, bc.y + bc.height * (675 + 170) / 1350); await page.mouse.down();
  await page.mouse.move(ccx, bc.y + bc.height * (675 + 170) / 1350 + 30, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  const cer = cf.calques.find(l => l.type === "cercle");
  check(cer.ar > 1.35 && cer.ey > 1.05 && cer.s === 1, `cercle élargi puis étiré en hauteur par ses poignées (ar=${cer.ar.toFixed(2)}, ey=${cer.ey.toFixed(2)})`);
  check((await page.$$('input[data-lar], input[data-ley]')).length === 2, "curseurs Largeur et Hauteur du cercle");
  await page.click('button.sel:has-text("Titre")');
  check((await page.$$('input[data-lex], input[data-ley]')).length === 2, "curseurs d'étirement du titre");
  await page.click('[data-act="ldone"]');

  // Zoom incrusté : loupe sur une zone de la photo (anneau déplacé à la souris, grossissement), puis photo de la caméra zoom incrustée
  await page.click('[data-addl="zoom"]');
  await page.waitForTimeout(300);
  cf = await cfgOf();
  let zl = cf.calques.find(l => l.type === "zoom");
  check(zl && zl.src === null && zl.zone.x > 0 && zl.zone.x < 1 && (await page.$$('[data-csel]')).length === 12, "loupe ajoutée sur une zone de la photo");
  await page.click('[data-lsub="zone"]');
  await page.waitForTimeout(200);
  const b7 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b7.x + b7.width / 2, b7.y + b7.height / 2); await page.mouse.down();
  await page.mouse.move(b7.x + b7.width / 2 - 40, b7.y + b7.height / 2 - 30, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const z0 = zl.zone;
  cf = await cfgOf(); zl = cf.calques.find(l => l.type === "zoom");
  check(zl.zone.x < z0.x && zl.zone.y < z0.y, `zone grossie déplacée à la souris (x ${z0.x.toFixed(3)} -> ${zl.zone.x.toFixed(3)})`);
  await page.$eval('input[data-lgross]', el => { el.value = 4; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500);
  cf = await cfgOf(); zl = cf.calques.find(l => l.type === "zoom");
  check(zl.zone.w < z0.w, `grossissement 4x (largeur de la zone ${z0.w.toFixed(3)} -> ${zl.zone.w.toFixed(3)})`);
  await page.screenshot({ path: path.join(caps, `${label}_zoom_zone.png`) });
  await page.click('[data-lsrc]:not([data-lsrc="self"])');
  await page.waitForTimeout(300);
  cf = await cfgOf(); zl = cf.calques.find(l => l.type === "zoom");
  check(zl.src === "IMG_portrait.jpg" && zl.zone.w <= 1, "photo de la caméra zoom incrustée dans la loupe");
  check((await page.textContent("#film")).includes("Loupe"), "la pellicule signale la photo incrustée");
  await page.click('[data-lsub="contenu"]');
  await page.waitForTimeout(200);
  const b8 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b8.x + b8.width * 0.74, b8.y + b8.height * 0.74); await page.mouse.down();
  await page.mouse.move(b8.x + b8.width * 0.74, b8.y + b8.height * 0.74 - 30, { steps: 5 }); await page.mouse.up();   // la photo portrait tient en largeur : on la fait glisser vers le haut
  await page.waitForTimeout(300);
  cf = await cfgOf();
  const zl2 = cf.calques.find(l => l.type === "zoom");
  check(zl2.zone.y > zl.zone.y, `photo cadrée dans la loupe à la souris (y ${zl.zone.y.toFixed(3)} -> ${zl2.zone.y.toFixed(3)})`);
  await page.fill('input[data-lfield="etiquette"]', "Zoom");
  await page.click('[data-lforme="rect"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_zoom_photo.png`) });
  await page.click('[data-act="ldone"]');

  // Montage : bandeaux (deux bandes, cadrage de la deuxième à la souris), puis superposition avec fenêtre
  await page.click('[data-tab="montage"]');
  await page.click('[data-mmode="bandes"]');
  await page.waitForTimeout(300);
  cf = await cfgOf();
  check(cf.montage.mode === "bandes" && cf.montage.bandes.length === 2 && cf.montage.bandes[0].src === null && cf.montage.bandes[1].src === "IMG_portrait.jpg", "bandeaux : deux bandes, la photo puis la suivante");
  const x1 = cf.montage.bandes[1].cadre.x;
  const b4 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b4.x + b4.width * 0.75, b4.y + b4.height / 2); await page.mouse.down();
  await page.mouse.move(b4.x + b4.width * 0.75 + 40, b4.y + b4.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  check((await page.getAttribute('[data-msel="1"]', "aria-pressed")) === "true" && cf.montage.bandes[1].cadre.x < x1, `bande 2 choisie au doigt et recadrée (x ${x1.toFixed(3)} -> ${cf.montage.bandes[1].cadre.x.toFixed(3)})`);
  await page.fill('input[data-metq]', "Zoom");
  await page.click('[data-msens="h"]');
  await page.waitForTimeout(500);
  cf = await cfgOf();
  check(cf.montage.sens === "h" && cf.montage.bandes[1].etiquette === "Zoom", "bandes empilées, étiquette saisie");
  await page.screenshot({ path: path.join(caps, `${label}_montage_bandes.png`) });
  await page.click('[data-mmode="fusion"]');
  await page.waitForTimeout(300);
  cf = await cfgOf();
  check(cf.montage.mode === "fusion" && cf.montage.fusion && cf.montage.fusion.src === "IMG_portrait.jpg", "superposition : la deuxième photo est posée sur la première");
  check((await page.textContent(".slot:not(.dessus)")).includes("DJI_0001.jpg") && (await page.textContent(".slot.dessus")).includes("IMG_portrait.jpg"), "panneau : qui est dessous, qui est dessus");
  check((await page.textContent("#film")).includes("Dessous") && (await page.textContent("#film")).includes("Dessus"), "pellicule : badges Dessous et Dessus");
  await page.click('[data-mview="dessus"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(caps, `${label}_montage_fusion_dessus.png`) });
  check((await page.getAttribute('[data-mview="dessus"]', "aria-pressed")) === "true", "aperçu « le dessus seul »");
  await page.click('[data-mview="deux"]');
  // couleurs de la photo du dessus, réglées depuis le montage
  await page.click('[data-ctab]:has-text("Couleurs du dessus")');
  await page.waitForTimeout(200);
  check((await page.getAttribute('[data-tab="couleur"]', "aria-selected")) === "true" && /^Dessus.*IMG_portrait\.jpg$/.test(await page.textContent('[data-ctarget][aria-pressed="true"]')), "onglet Couleur ouvert sur la photo du dessus");
  await page.click('[data-filtre="nb"]');
  await page.$eval('input[data-col="sat"]', el => { el.value = -40; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(600);
  const cfTop = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:IMG")))));
  cf = await cfgOf();
  check(cfTop.filtre === "nb" && cfTop.couleur.sat === -40 && cf.filtre === "esam" && cf.couleur.sat === 0, "couleurs du dessus enregistrées dans sa fiche, la photo de base inchangée");
  await page.screenshot({ path: path.join(caps, `${label}_couleur_dessus.png`) });
  await page.click('[data-ctarget]:has-text("Dessous")');
  check((await page.getAttribute('[data-filtre="esam"]', "aria-pressed")) === "true", "retour aux couleurs de la photo de base");
  await page.click('[data-tab="montage"]');
  await page.$eval('input[data-mop]', el => { el.value = 60; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const b5 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b5.x + b5.width / 2, b5.y + b5.height / 2); await page.mouse.down();
  await page.mouse.move(b5.x + b5.width / 2 + 30, b5.y + b5.height / 2 + 20, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  check(cf.montage.fusion.op === 60 && cf.montage.fusion.x > 0.5 && cf.montage.fusion.y > 0.5, `photo superposée déplacée à la souris (x=${cf.montage.fusion.x.toFixed(3)})`);
  await page.click('[data-mforme="ellipse"]');
  await page.click('[data-mblend="eclaircir"]');
  await page.waitForTimeout(300);
  const b6 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b6.x + b6.width / 2 + 30, b6.y + b6.height / 2 + 20); await page.mouse.down();
  await page.mouse.move(b6.x + b6.width / 2 + 5, b6.y + b6.height / 2 + 20, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  check(cf.montage.fusion.fenetre.forme === "ellipse" && cf.montage.fusion.fenetre.x < 0.5 && cf.montage.fusion.mode === "eclaircir", `fenêtre ovale déplacée (x=${cf.montage.fusion.fenetre.x.toFixed(3)})`);
  await page.screenshot({ path: path.join(caps, `${label}_montage_fusion.png`) });
  await page.click('[data-tab="export"]');
  check((await page.textContent("#panel")).includes("superposition de IMG_portrait.jpg"), "montage annoncé dans l'onglet Export");
  const [dlm] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
  const outm = path.join(caps, `${label}_${dlm.suggestedFilename()}`); await dlm.saveAs(outm);
  const dimsm = await page.evaluate(async b64 => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = "data:image/jpeg;base64," + b64; }), fs.readFileSync(outm).toString("base64"));
  check(dlm.suggestedFilename() === "DJI_0001_portrait_montage.jpg" && dimsm[0] === 1080 && dimsm[1] === 1350, `montage exporté ${dlm.suggestedFilename()} (${dimsm.join("x")})`);
  await page.click('[data-tab="montage"]');
  await page.click('[data-act="mswap"]');
  await page.waitForTimeout(400);
  const cfImg = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:IMG")))));
  check((await page.textContent("#pname")).includes("IMG_portrait.jpg") && cfImg.montage.mode === "fusion" && cfImg.montage.fusion.src === "DJI_0001.jpg" && cfImg.montage.fusion.mode === "eclaircir", "inversion : IMG_portrait.jpg dessous, DJI_0001.jpg dessus, mode conservé");
  await page.screenshot({ path: path.join(caps, `${label}_montage_inverse.png`) });
  await page.click('[data-act="mswap"]');
  await page.waitForTimeout(400);
  cf = await cfgOf();
  check((await page.textContent("#pname")).includes("DJI_0001.jpg") && cf.montage.mode === "fusion" && cf.montage.fusion.src === "IMG_portrait.jpg", "inversion dans l'autre sens");
  await page.click('[data-mmode="aucun"]');
  await page.waitForTimeout(300);

  // Export photo et fiche
  await page.click('[data-tab="export"]');
  await page.fill('[data-meta="description"]', "Chien secouru par l'ESAM");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_export.png`) });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
  const out = path.join(caps, `${label}_${dl.suggestedFilename()}`); await dl.saveAs(out);
  const sz = fs.statSync(out).size;
  check(dl.suggestedFilename() === "DJI_0001_portrait.jpg" && sz > 30000, `photo exportée ${dl.suggestedFilename()} (${sz} octets)`);
  const dims = await page.evaluate(async b64 => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = "data:image/jpeg;base64," + b64; }), fs.readFileSync(out).toString("base64"));
  check(dims[0] === 1080 && dims[1] === 1350, `dimensions de l'export ${dims.join("x")}`);
  const jb = fs.readFileSync(out), src = photos[0].buffer;
  check(src.includes("Julien Dupont") && src.includes("2024:05:01"), "la photo d'origine porte auteur, date et GPS");
  const hdr = jb.subarray(0, jb.indexOf(Buffer.from([0xFF, 0xDA])));   // en-têtes, avant les données de l'image
  check(!jb.includes("Julien Dupont") && !jb.includes("2024:05") && !hdr.includes(Buffer.from([0x88, 0x25])), "export sans auteur, date ni GPS d'origine");
  check(jb.includes("Exif\0\0") && jb.includes("ESAM - Equipe de Secours Animalier en Montagne") && jb.includes("(c) ESAM") && jb.includes("Photos ESAM v"), "EXIF ESAM (auteur, droits, logiciel)");
  check(jb.includes(Buffer.from("<dc:creator><rdf:Seq><rdf:li>ESAM - Équipe")) && jb.includes("Chien secouru par l'ESAM"), "XMP ESAM et description");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="fiche"]')]);
  const fichePath = path.join(caps, `${label}_fiche.json`); await dl2.saveAs(fichePath);
  const fiche = JSON.parse(fs.readFileSync(fichePath, "utf8"));
  check(fiche.format === "portrait" && fiche.flous.length === 3 && fiche.calques.length === 12 && fiche.filtre === "esam", "fiche JSON complète");
  const fz = fiche.calques.find(l => l.type === "zoom");
  check(fz && fz.src === "IMG_portrait.jpg" && fz.forme === "rect" && fz.etiquette === "Zoom", "fiche : zoom incrusté conservé");
  check(fiche.montage.mode === "aucun" && fiche.montage.bandes.length === 2 && fiche.montage.fusion.src === "IMG_portrait.jpg", "fiche : montage conservé (bandes et superposition)");

  // Reprise : nouvelle page sans localStorage, chargement de la photo puis de la fiche
  const page2 = await ctxB.newPage();
  await page2.goto(base); await page2.evaluate(() => localStorage.clear());
  await page2.setInputFiles("#fileIn", [photos[0]]);
  await page2.waitForSelector("#main:not([hidden])");
  await page2.setInputFiles("#ficheIn", [{ name: "DJI_0001.jpg.esam.json", mimeType: "application/json", buffer: fs.readFileSync(fichePath) }]);
  await page2.waitForTimeout(500);
  await page2.click('[data-tab="calques"]');
  check((await page2.$$('[data-csel]')).length === 12, "fiche reprise : douze calques retrouvés");
  check((await page2.textContent("#tagFmt")).includes("1080 x 1350"), "fiche reprise : format portrait");
  await page2.screenshot({ path: path.join(caps, `${label}_reprise.png`) });

  // Vidéo : extraction d'une image
  const vpage = await ctxB.newPage();
  await vpage.goto(base);
  const vb64 = await vpage.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360; const x = c.getContext("2d");
    const stream = c.captureStream(25), rec = new MediaRecorder(stream, { mimeType: "video/webm" }), chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(r => { rec.onstop = r; });
    rec.start(); let t = 0;
    await new Promise(r => { const it = setInterval(() => { x.fillStyle = `hsl(${t * 10},70%,50%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = "#fff"; x.font = "40px sans-serif"; x.fillText("t=" + t, 40, 200); t++; if (t > 50) { clearInterval(it); r(); } }, 40); });
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: "video/webm" });
    return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  });
  await vpage.setInputFiles("#fileIn", [{ name: "DJI_0002.webm", mimeType: "video/webm", buffer: Buffer.from(vb64, "base64") }]);
  await vpage.waitForSelector("#vdlg[open]");
  await vpage.waitForFunction(() => document.getElementById("vel").readyState >= 2);
  await vpage.click('[data-vact="step"][data-dt="1"]');
  await vpage.waitForTimeout(400);
  await vpage.screenshot({ path: path.join(caps, `${label}_video.png`) });
  await vpage.click('[data-vact="capture"]');
  await vpage.waitForFunction(() => document.querySelectorAll("#film .th:not(.add):not(.vid)").length === 1);
  await vpage.click('[data-vact="close"]');
  check(await vpage.isVisible("#cv"), "image extraite de la vidéo, devenue une photo");
  const pn = await vpage.textContent("#pname");
  check(/DJI_0002_00m0[01]s\d\d\.jpg/.test(pn), `nom de l'image extraite : ${pn.trim()}`);

  check(errors.length === 0, `aucune erreur de page (${errors.join(" | ").slice(0, 300)})`);
  await ctxB.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
