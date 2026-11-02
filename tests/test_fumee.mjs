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
/* grande photo (3000 x 2000 stockée, carré rouge en haut à gauche du stockage) avec une orientation EXIF 6 (à tourner de 90°
   dans le sens horaire) : elle doit s'afficher en portrait 1707 x 2560, le carré rouge en haut à droite */
async function fakeOriented(ctxB, name) {
  const pg = await ctxB.newPage();
  const b64 = await pg.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 3000; c.height = 2000; const x = c.getContext("2d");
    x.fillStyle = "#2F6FE0"; x.fillRect(0, 0, 3000, 2000); x.fillStyle = "#E20C0F"; x.fillRect(0, 0, 700, 500);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  await pg.close();
  const jpg = Buffer.from(b64, "base64"), u16 = v => [v >> 8 & 255, v & 255], u32 = v => [v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
  const tiff = [0x4D, 0x4D, 0, 42, ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0, 0, 0, 0, 0];
  const body = [...Buffer.from("Exif\0\0"), ...tiff];
  return { name, mimeType: "image/jpeg", buffer: Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xFF, 0xE1, ...u16(body.length + 2), ...body]), jpg.subarray(2)]) };
}
/* lecture d'un ZIP (méthode store) : entrées du répertoire central, données lues à l'en-tête local, CRC-32 vérifié */
const CRC_T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = CRC_T[(c ^ x) & 255] ^ c >>> 8; return (c ^ 0xFFFFFFFF) >>> 0; };
function unzip(buf) {
  const e = buf.length - 22; if (e < 0 || buf.readUInt32LE(e) !== 0x06054b50) return null;
  const n = buf.readUInt16LE(e + 10), out = [];
  let i = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(i) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(i + 8), method = buf.readUInt16LE(i + 10), crc = buf.readUInt32LE(i + 16), size = buf.readUInt32LE(i + 20);
    const nl = buf.readUInt16LE(i + 28), xl = buf.readUInt16LE(i + 30), cl = buf.readUInt16LE(i + 32), off = buf.readUInt32LE(i + 42);
    const name = buf.subarray(i + 46, i + 46 + nl).toString("utf8"), at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(at, at + size);
    out.push({ name, data, ok: buf.readUInt32LE(off) === 0x04034b50 && method === 0 && (flags & 0x0800) !== 0 && crc32(data) === crc });
    i += 46 + nl + xl + cl;
  }
  return out;
}
/* dimensions d'un JPEG (marqueur SOF) : [largeur, hauteur] */
function jpgDims(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) return null;
    const m = b[i + 1];
    if (m >= 0xC0 && m <= 0xC3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
const near = (a, b) => a && b && ["x", "y", "w", "h"].every(k => Math.abs(a[k] - b[k]) < 1e-6);
/* lecture brute du magasin « fiches » d'IndexedDB : {clé: {cfg, t}} */
const idbFiches = pg => pg.evaluate(() => new Promise((res, rej) => {
  const r = indexedDB.open("esam-picture");
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result; if (!db.objectStoreNames.contains("fiches")) { db.close(); res(null); return; }
    const tx = db.transaction("fiches", "readonly"), st = tx.objectStore("fiches"), out = {}, cur = st.openCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c) return; out[c.key] = c.value; c.continue(); };
    tx.oncomplete = () => { db.close(); res(out); };
  };
}));
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
  // Horizon : curseur sous la rotation, rendu différent, bouton 0 qui rend l'aperçu d'origine au pixel près
  const shotCv = () => page.evaluate(() => document.getElementById("cv").toDataURL());
  const setRange = (sel, v) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  check(await page.isVisible("input[data-incl]") && await page.isVisible('[data-act="incl0"]'), "curseur Horizon et bouton 0 dans l'onglet Cadre");
  const sh0 = await shotCv();
  await setRange("input[data-incl]", 5); await page.waitForTimeout(600);
  const sh5 = await shotCv();
  let cfI = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))));
  check(cfI.inclinaison === 5 && sh5 !== sh0 && (await page.textContent("#panel")).includes("5°"), `horizon redressé de 5° : fiche (inclinaison=${cfI.inclinaison}) et aperçu changés`);
  await page.screenshot({ path: path.join(caps, `${label}_cadre_horizon.png`) });
  await page.click('[data-act="incl0"]'); await page.waitForTimeout(300);
  cfI = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))));
  check(cfI.inclinaison === 0 && (await shotCv()) === sh0, "bouton 0 : horizon d'origine, aperçu identique à l'origine");
  await setRange("input[data-incl]", 5); await page.waitForTimeout(500);

  // Couleur
  await page.click('[data-tab="couleur"]');
  await page.click('[data-filtre="esam"]');
  await page.$eval('input[data-col="contraste"]', el => { el.value = 30; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_couleur.png`) });
  check((await page.getAttribute('[data-filtre="esam"]', "aria-pressed")) === "true", "filtre ESAM sélectionné");
  // aperçu allégé pendant le glissement : demi-résolution tout de suite, pleine résolution 250 ms après, sans toucher au cache normal
  const quick = await page.evaluate(async () => {
    const el = document.querySelector('input[data-col="contraste"]'), cv = document.getElementById("cv"), frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.value = 32; el.dispatchEvent(new Event("input", { bubbles: true })); await frame();
    const q = cv.toDataURL(); await new Promise(r => setTimeout(r, 600)); await frame();
    return [q, cv.toDataURL()];
  });
  await page.keyboard.press("Control+z"); await page.waitForTimeout(200); await page.keyboard.press("Control+y"); await page.waitForTimeout(300);   // cache vidé : rendu à froid
  const cold = await shotCv();
  check(quick[0] !== quick[1] && quick[1] === cold, "curseur de couleur : aperçu allégé pendant le glissement, puis pleine résolution identique à un rendu à froid");
  // couleurs conservées : le reste en noir et blanc ; le fond bleu de la photo de test devient gris, puis redevient bleu si on garde le bleu
  const pixel = async () => page.evaluate(() => { const cv = document.getElementById("cv"), d = cv.getContext("2d").getImageData(Math.round(cv.width / 2), Math.round(cv.height / 2), 1, 1).data; return [d[0], d[1], d[2]]; });
  const px0 = await pixel();
  await page.click('[data-selact="1"]');
  await page.waitForTimeout(600);
  check((await page.getAttribute('[data-steinte="jaune"]', "aria-pressed")) === "true" && (await page.getAttribute('[data-steinte="rouge"]', "aria-pressed")) === "true" && (await page.getAttribute('[data-steinte="bleu"]', "aria-pressed")) === "false", "couleurs conservées : jaune fluo et rouge vif par défaut");
  const px1 = await pixel();
  check(px0[2] - px0[0] > 25 && Math.abs(px1[0] - px1[1]) < 8 && Math.abs(px1[1] - px1[2]) < 8, `fond bleu passé en gris (${px0} puis ${px1})`);
  await page.click('[data-steinte="bleu"]');
  await page.$eval('input[data-sel="renfort"]', el => { el.value = 40; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(600);
  const px2 = await pixel();
  check(px2[2] - px2[0] > 25, `le bleu conservé reste bleu (${px2})`);
  await page.screenshot({ path: path.join(caps, `${label}_couleur_selectif.png`) });
  const cfSel = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).selectif);
  check(cfSel && cfSel.actif === true && cfSel.teintes.join() === "jaune,rouge,bleu" && cfSel.renfort === 40, "couleurs conservées enregistrées dans la fiche");
  // zone au lasso autour du centre : le bleu ne reste que dedans, le coin passe en gris ; « tout en gris » inverse
  const pixelAt = async (fx, fy) => page.evaluate(([fx, fy]) => { const cv = document.getElementById("cv"), d = cv.getContext("2d").getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
  const cvb = await page.locator("#cv").boundingBox(), lx = f => cvb.x + cvb.width * f, ly = f => cvb.y + cvb.height * f;
  await page.click('[data-act="lasso"]');
  check((await page.getAttribute('[data-act="lasso"]', "aria-pressed")) === "true", "mode lasso activé");
  await page.mouse.move(lx(0.3), ly(0.3)); await page.mouse.down();
  for (const [fx, fy] of [[0.7, 0.3], [0.7, 0.7], [0.3, 0.7], [0.3, 0.35]]) await page.mouse.move(lx(fx), ly(fy), { steps: 8 });
  await page.mouse.up(); await page.waitForTimeout(700);
  const zone = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))).selectif.zones);
  check(zone.length === 1 && zone[0].pts.length >= 8 && zone[0].sens === "garder", `zone au lasso enregistrée (${zone.length && zone[0].pts.length} points)`);
  const pc = await pixelAt(0.5, 0.5), pk = await pixelAt(0.08, 0.08);
  check(pc[2] - pc[0] > 25 && Math.abs(pk[0] - pk[1]) < 8 && Math.abs(pk[1] - pk[2]) < 8, `bleu gardé au centre (${pc}), coin en gris (${pk})`);
  check((await page.getAttribute('[data-zsel]', "aria-pressed")) === "true", "la zone tracée est choisie");
  await page.click('[data-zsens="exclure"]'); await page.waitForTimeout(700);
  const pc2 = await pixelAt(0.5, 0.5), pk2 = await pixelAt(0.08, 0.08);
  check(Math.abs(pc2[0] - pc2[1]) < 8 && Math.abs(pc2[1] - pc2[2]) < 8 && pk2[2] - pk2[0] > 25, `zone « tout en gris » : centre gris (${pc2}), coin bleu (${pk2})`);
  await page.screenshot({ path: path.join(caps, `${label}_couleur_lasso.png`) });
  await page.click('[data-act="delLasso"]'); await page.waitForTimeout(300);
  check((await page.$$('[data-zsel]')).length === 0, "zone supprimée");
  await page.click('[data-steinte="bleu"]');
  await page.waitForTimeout(300);

  // Flous
  await page.click('[data-tab="flous"]');
  await page.click('[data-act="addZone"]');
  await page.click('[data-fmode="pixel"]');
  await page.click('[data-act="addZone"]');
  await page.click('[data-fmode="dynamique"]');
  await page.click('[data-act="addZone"]');
  check((await page.$$('[data-fsel]')).length === 3, "trois zones de flou ajoutées");
  // flous en cache par zone : déplacer la première zone (les deux autres, qui la recouvrent, sont recalculées), puis la
  // troisième (les deux premières sont reprises du cache) ; le rendu doit être celui d'un calcul à froid, au pixel près
  const drag = async (dx, dy) => { const b = await page.locator("#cv").boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300); };
  await page.click('[data-fsel]:nth-of-type(1)'); await drag(-60, -40);
  const fl0 = await shotCv();
  await page.click('[data-fsel]:nth-of-type(3)'); await drag(25, 30);
  const warm = await shotCv();
  await page.keyboard.press("Control+z"); await page.waitForTimeout(200);
  await page.keyboard.press("Control+y"); await page.waitForTimeout(300);
  const coldF = await shotCv();
  check(warm !== fl0 && warm === coldF, "flous : rendu avec le cache par zone identique au rendu à froid, au pixel près");
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

  // Annuler / rétablir (un glissement entier = une entrée), dupliquer, monter / descendre, raccourcis clavier
  const hb = await page.locator("header.top").boundingBox(), vb = await page.locator("#verBadge").boundingBox();
  check(await page.isVisible("#undoBtn") && await page.isEnabled("#undoBtn") && await page.isVisible("#redoBtn") && vb.x + vb.width <= vp.width && vb.y + vb.height <= hb.y + hb.height, "en-tête : Annuler, Rétablir et version sur une ligne");
  await page.click('button.sel:has-text("Cercle")');
  await page.waitForTimeout(200);
  cf = await cfgOf();
  const ci = cf.calques.findIndex(l => l.type === "cercle"), cer0 = cf.calques[ci], ids0 = cf.calques.map(l => l.id);
  const b9 = await page.locator("#cv").boundingBox();
  await page.mouse.move(b9.x + b9.width / 2, b9.y + b9.height / 2); await page.mouse.down();
  await page.mouse.move(b9.x + b9.width / 2 - 50, b9.y + b9.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  cf = await cfgOf();
  const cer1 = cf.calques[ci];
  check(cer1.x < cer0.x - 0.01 && cer1.y > cer0.y, `cercle déplacé à la souris (x ${cer0.x.toFixed(3)} -> ${cer1.x.toFixed(3)})`);
  await page.click("#undoBtn"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques[ci].x === cer0.x && cf.calques[ci].y === cer0.y && await page.isEnabled("#redoBtn"), "annuler : le glissement entier est défait d'un coup");
  await page.click("#redoBtn"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques[ci].x === cer1.x && cf.calques[ci].y === cer1.y && await page.isDisabled("#redoBtn"), "rétablir : le cercle revient à sa place");
  await page.click('[data-act="ldup"]'); await page.waitForTimeout(200);
  cf = await cfgOf();
  const dup = cf.calques[ci + 1];
  check(cf.calques.length === 13 && dup.type === "cercle" && dup.id !== cer1.id && Math.abs(dup.x - cer1.x - 0.03) < 1e-9 && Math.abs(dup.y - cer1.y - 0.03) < 1e-9 && dup.ar === cer1.ar && dup.ey === cer1.ey, "dupliquer : copie décalée posée juste au-dessus");
  check(await page.$$eval("#panel .list li", lis => lis.findIndex(li => li.getAttribute("aria-selected") === "true")) === ci + 1, "la copie devient le calque choisi");
  await page.click('[data-act="ldescendre"]'); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques[ci].id === dup.id && cf.calques[ci + 1].id === cer1.id, "descendre : la copie passe sous l'original");
  await page.click('[data-act="lmonter"]'); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques[ci].id === cer1.id && cf.calques[ci + 1].id === dup.id, "monter : la copie repasse au-dessus");
  await page.click(`button.sel[data-csel="${ids0[ids0.length - 1]}"]`); await page.waitForTimeout(200);
  check(await page.isDisabled('[data-act="lmonter"]') && await page.isEnabled('[data-act="ldescendre"]'), "Monter désactivé pour le calque du dessus");
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Control+z"); await page.waitForTimeout(150); }
  cf = await cfgOf();
  check(cf.calques.length === 12 && cf.calques.map(l => l.id).join() === ids0.join(), "Ctrl+Z trois fois : monter, descendre et dupliquer défaits");
  await page.keyboard.press("Control+y"); await page.waitForTimeout(150);
  check((await cfgOf()).calques.length === 13, "Ctrl+Y : la copie revient");
  await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
  await page.click(`button.sel[data-csel="${ids0[ids0.length - 1]}"]`); await page.waitForTimeout(200);
  await page.keyboard.press("Control+d"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques.length === 13 && cf.calques[12].type === "zoom" && cf.calques[12].id !== ids0[11], "Ctrl+D : le calque choisi est dupliqué");
  await page.keyboard.press("Delete"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.calques.map(l => l.id).join() === ids0.join(), "Suppr : la copie est supprimée");
  await page.click('button.sel:has-text("Cercle")'); await page.waitForTimeout(200);
  const s0 = (await cfgOf()).calques[ci].s;
  await page.keyboard.type("+"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(Math.abs(cf.calques[ci].s - s0 * 1.05) < 1e-9, `touche + : calque agrandi de 5 % (s ${s0} -> ${cf.calques[ci].s.toFixed(3)})`);
  await page.keyboard.press("Control+z"); await page.waitForTimeout(150);
  const cad0 = (await cfgOf()).cadre;
  check((await cfgOf()).calques[ci].s === s0, "Ctrl+Z : taille d'origine");
  await page.keyboard.press("r"); await page.waitForTimeout(200);
  check((await cfgOf()).rotation === 90 && (await cfgOf()).inclinaison === 5, "touche R : photo tournée de 90 degrés, horizon conservé");
  await page.keyboard.press("Control+z"); await page.waitForTimeout(200);
  cf = await cfgOf();
  check(cf.rotation === 0 && JSON.stringify(cf.cadre) === JSON.stringify(cad0), "Ctrl+Z : rotation et cadre retrouvés");
  await page.keyboard.press("4"); await page.waitForTimeout(150);
  const t4 = await page.getAttribute('[data-tab="flous"]', "aria-selected");
  await page.keyboard.press("5"); await page.waitForTimeout(150);
  check(t4 === "true" && (await page.getAttribute('[data-tab="calques"]', "aria-selected")) === "true", "touches 4 et 5 : onglets Flous puis Calques");

  // Avant / après : bouton « Original » maintenu, puis touche O ; l'aperçu normal revient à l'identique
  await page.click('[data-act="ldone"]'); await page.waitForTimeout(300);
  const shot = () => page.evaluate(() => document.getElementById("cv").toDataURL());
  const avant = await shot();
  const obx = await page.locator("#origBtn").boundingBox();
  await page.mouse.move(obx.x + obx.width / 2, obx.y + obx.height / 2); await page.mouse.down(); await page.waitForTimeout(300);
  const orig = await shot(), pressed = await page.getAttribute("#origBtn", "aria-pressed");
  await page.screenshot({ path: path.join(caps, `${label}_original.png`) });
  await page.mouse.up(); await page.waitForTimeout(300);
  const apres = await shot();
  check(pressed === "true" && orig !== avant && apres === avant, "bouton Original maintenu : l'aperçu montre la photo d'origine, puis revient");
  await page.keyboard.down("o"); await page.waitForTimeout(300);
  const origK = await shot();
  await page.keyboard.up("o"); await page.waitForTimeout(300);
  check(origK === orig && (await shot()) === avant, "touche O maintenue : même original, puis retour à l'aperçu");

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
  check(dlm.suggestedFilename() === "20240501_Rex_Belledonne_photo-Com-ESAM_100000-montage.jpg" && dimsm[0] === 1080 && dimsm[1] === 1350, `montage exporté ${dlm.suggestedFilename()} (${dimsm.join("x")})`);
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
  check((await page.textContent("#panel")).includes("20240501_Rex_Belledonne_photo-Com-ESAM_100000.jpg"), "nom du fichier déduit de la légende et de l'EXIF (date inversée, animal, secteur, heure)");
  await page.fill('[data-nom="animaux"]', "Rex et Luna");
  await page.fill('[data-nom="heure"]', "101530");
  await page.waitForTimeout(500);
  check((await page.textContent("#panel")).includes("20240501_Rex_et_Luna_Belledonne_photo-Com-ESAM_101530.jpg"), "nom du fichier modifié dans l'onglet Export");
  await page.fill('[data-nom="animaux"]', "");
  await page.fill('[data-nom="heure"]', "");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(caps, `${label}_export.png`) });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
  const out = path.join(caps, `${label}_${dl.suggestedFilename()}`); await dl.saveAs(out);
  const sz = fs.statSync(out).size;
  check(dl.suggestedFilename() === "20240501_Rex_Belledonne_photo-Com-ESAM_100000.jpg" && sz > 30000, `photo exportée ${dl.suggestedFilename()} (${sz} octets)`);
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
  check(fiche.format === "portrait" && fiche.flous.length === 3 && fiche.calques.length === 12 && fiche.filtre === "esam" && fiche.inclinaison === 5, "fiche JSON complète (horizon compris)");
  check(fiche.nom && fiche.nom.animaux === "" && fiche.nom.heure === "", "fiche : bloc nom (champs vides = déduits)");
  const fz = fiche.calques.find(l => l.type === "zoom");
  check(fz && fz.src === "IMG_portrait.jpg" && fz.forme === "rect" && fz.etiquette === "Zoom", "fiche : zoom incrusté conservé");
  check(fiche.montage.mode === "aucun" && fiche.montage.bandes.length === 2 && fiche.montage.fusion.src === "IMG_portrait.jpg", "fiche : montage conservé (bandes et superposition)");

  // 0.13 : texte de publication et texte alternatif proposés, copiés, enregistrés dans la fiche
  await ctxB.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base }).catch(() => {});
  await page.click('[data-act="pubPropose"]'); await page.click('[data-act="altPropose"]');
  const pubV = await page.inputValue('[data-pub="texte"]'), altV = await page.inputValue('[data-pub="alt"]');
  check(pubV.includes("Rex") && pubV.includes("Belledonne") && pubV.includes("1er mai 2024") && pubV.includes("Chien secouru en Belledonne") && pubV.includes("Équipe de Secours Animalier en Montagne") && pubV.includes("#ESAM #SecoursAnimalier #Montagne"), `texte de publication proposé (animal, date en lettres, secteur, titre, pied ESAM) : ${JSON.stringify(pubV.slice(0, 120))}`);
  check(altV === "Photo ESAM : Rex secouru(e) le 1er mai 2024 dans le secteur Belledonne", `texte alternatif proposé : ${altV}`);
  await page.click('[data-act="pubCopy"]'); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  check((await page.textContent("#toast")).includes("copié") && (clip === null || clip === pubV), `bouton Copier : toast de confirmation${clip === null ? "" : ", presse-papiers rempli"}`);
  await page.waitForTimeout(500);
  let cfP = await cfgOf();
  check(cfP.pub && cfP.pub.texte === pubV && cfP.pub.alt === altV, "textes enregistrés dans la fiche (pub.texte, pub.alt)");
  // place un bloc du panneau juste sous l'aperçu (collant sur téléphone, panneau défilant sur PC) pour la capture
  const showBlock = sel => page.$eval(sel, el => { const b = el.closest(".sub") || el, pn = document.getElementById("panel"); if (getComputedStyle(pn).overflowY === "auto") b.scrollIntoView({ block: "start" }); else window.scrollBy(0, b.getBoundingClientRect().top - document.querySelector(".left").getBoundingClientRect().bottom - 8); });
  await page.evaluate(() => { document.getElementById("toast").hidden = true; });
  await showBlock('[data-pub="texte"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(caps, `${label}_export_publication.png`) });

  // Cadres par format : chaque format retrouve son dernier cadre, un format jamais réglé prend le cadre maximal
  await page.click('[data-tab="cadre"]');
  let cfC = await cfgOf(); const cPort = cfC.cadre;
  check(cfC.format === "portrait" && near(cfC.cadres && cfC.cadres.portrait, cPort), "cadre du format portrait mémorisé (cadres.portrait)");
  await page.click('[data-fmt="carre"]'); await page.waitForTimeout(200);
  await setRange("input[data-zoom]", 50); await page.waitForTimeout(500);
  const cCarre = (await cfgOf()).cadre;
  await page.click('[data-fmt="portrait"]'); await page.waitForTimeout(300);
  cfC = await cfgOf();
  check(cfC.format === "portrait" && near(cfC.cadre, cPort) && near(cfC.cadres.carre, cCarre), "cadre portrait retrouvé en revenant au format portrait, cadre carré gardé");
  await page.click('[data-fmt="carre"]'); await page.waitForTimeout(300);
  check(near((await cfgOf()).cadre, cCarre), "cadre carré retrouvé en revenant au format carré");
  const hadLarge = !!(await cfgOf()).cadres.large;
  await page.click('[data-fmt="large"]'); await page.waitForTimeout(300);
  cfC = await cfgOf();
  check(!hadLarge && cfC.cadre.w > 0.999 && Math.abs(cfC.cadre.h - 0.75) < 1e-6, `format jamais réglé : cadre maximal (${cfC.cadre.w.toFixed(3)} x ${cfC.cadre.h.toFixed(3)})`);
  await page.click('[data-fmt="portrait"]'); await page.waitForTimeout(300);

  // Déclinaisons : format courant verrouillé, story coché en plus, ZIP de deux JPEG aux bonnes dimensions, aperçu intact
  await page.click('[data-tab="export"]'); await page.waitForTimeout(300);
  check(await page.isChecked('[data-decl="portrait"]') && await page.isDisabled('[data-decl="portrait"]'), "déclinaisons : format courant coché et verrouillé");
  await page.check('[data-decl="story"]');
  await showBlock('[data-act="exportDecl"]'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(caps, `${label}_export_declinaisons.png`) });
  const shD = await shotCv();
  const [dld] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exportDecl"]')]);
  const stem = "20240501_Rex_Belledonne_photo-Com-ESAM_100000";
  const zd = unzip(fs.readFileSync(await dld.path())) || [];
  const zdn = zd.map(e => e.name).sort();
  check(dld.suggestedFilename() === `${stem}_declinaisons.zip` && JSON.stringify(zdn) === JSON.stringify([`${stem}.esam.json`, `${stem}_portrait.jpg`, `${stem}_portrait.txt`, `${stem}_story.jpg`, `${stem}_story.txt`]) && zd.every(e => e.ok), `déclinaisons : ${dld.suggestedFilename()} (${zdn.join(", ")})`);
  const dP = jpgDims(zd.find(e => e.name.endsWith("_portrait.jpg")).data), dS = jpgDims(zd.find(e => e.name.endsWith("_story.jpg")).data);
  fs.writeFileSync(path.join(caps, `${label}_declinaison_story.jpg`), zd.find(e => e.name.endsWith("_story.jpg")).data);   // à regarder : calques et flous dans le format story
  check(dP && dP.join("x") === "1080x1350" && dS && dS.join("x") === "1080x1920", `déclinaisons aux bonnes dimensions (portrait ${dP && dP.join("x")}, story ${dS && dS.join("x")})`);
  await page.waitForTimeout(300);
  check((await cfgOf()).format === "portrait" && (await shotCv()) === shD, "déclinaisons : format de la fiche et aperçu inchangés");

  // ZIP groupé : signature PK, nom daté, JPEG, texte et fiche de chaque photo modifiée
  const dt = new Date(), ymd = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
  const [dlz] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exportAll"]')]);
  const zb = fs.readFileSync(await dlz.path()), ze = unzip(zb) || [];
  const zen = ze.map(e => e.name);
  check(zb.subarray(0, 4).equals(Buffer.from([0x50, 0x4B, 3, 4])) && dlz.suggestedFilename() === `${ymd}_photos-Com-ESAM.zip`, `ZIP groupé ${dlz.suggestedFilename()} (signature PK)`);
  check(ze.length >= 5 && ze.every(e => e.ok) && zen.filter(n => n.endsWith(".jpg")).length === 2 && zen.includes(`${stem}.jpg`) && zen.includes(`${stem}.txt`) && zen.includes(`${stem}.esam.json`), `entrées du ZIP (${zen.join(", ")})`);
  const zj = jpgDims(ze.find(e => e.name === `${stem}.jpg`).data), zt = ze.find(e => e.name === `${stem}.txt`).data.toString("utf8"), zf = JSON.parse(ze.find(e => e.name === `${stem}.esam.json`).data.toString("utf8"));
  check(zj && zj.join("x") === "1080x1350", `JPEG extrait du ZIP : ${zj && zj.join("x")}`);
  check(zt === `${altV}\n\n${pubV}` && zf.format === "portrait" && zf.pub.alt === altV, "texte (.txt : alternatif, ligne vide, publication) et fiche du ZIP");
  await page.uncheck("[data-zipfiches]");
  const [dlz2] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exportAll"]')]);
  const ze2 = unzip(fs.readFileSync(await dlz2.path())) || [];
  check(ze2.length && !ze2.some(e => e.name.endsWith(".esam.json")) && (await page.evaluate(() => localStorage.getItem("esam-picture:zipFiches"))) === "0", "« Inclure les fiches » décoché : ZIP sans fiche, préférence gardée");
  await page.check("[data-zipfiches]");

  // Qualité presse : dimensions doublées, suffixe _presse, préférence gardée
  await page.click('[data-qual="presse"]'); await page.waitForTimeout(200);
  check((await page.textContent("#panel")).includes("2160 x 2700") && (await page.textContent("#panel")).includes(`${stem}_presse.jpg`), "qualité presse annoncée (2160 x 2700, _presse)");
  const [dlp] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"]')]);
  const pb = fs.readFileSync(await dlp.path()), pd = jpgDims(pb);
  check(dlp.suggestedFilename() === `${stem}_presse.jpg` && pd && pd.join("x") === "2160x2700" && pb.includes("Photos ESAM v"), `export presse ${dlp.suggestedFilename()} (${pd && pd.join("x")})`);
  check((await page.evaluate(() => localStorage.getItem("esam-picture:qualite"))) === "presse", "qualité gardée dans le navigateur");
  await page.click('[data-qual="reseaux"]'); await page.waitForTimeout(200);

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
  await page2.click('[data-tab="cadre"]');
  check((await page2.inputValue("input[data-incl]")) === "5", "fiche reprise : horizon redressé de 5°");
  // une fiche ancienne, sans inclinaison, reste lue (0)
  const ancienne = JSON.parse(fs.readFileSync(fichePath, "utf8")); delete ancienne.inclinaison; delete ancienne.cadres; delete ancienne.pub;
  await page2.setInputFiles("#ficheIn", [{ name: "DJI_0001.jpg.esam.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(ancienne)) }]);
  await page2.waitForTimeout(500);
  check((await page2.inputValue("input[data-incl]")) === "0", "fiche d'avant 0.12 (sans horizon) : lue avec 0°");
  const cfA = await page2.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI")))));
  check(cfA.format === "portrait" && Object.keys(cfA.cadres).join() === "portrait" && cfA.pub.texte === "" && cfA.pub.alt === "", "fiche d'avant 0.13 (sans cadres ni textes) : lue, seul le cadre courant mémorisé");
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

  // Grande photo de téléphone avec orientation EXIF 6 : décodée directement à la taille de travail, dans le bon sens
  const opage = await ctxB.newPage();
  opage.on("pageerror", e => errors.push(String(e)));
  await opage.goto(base);
  await opage.setInputFiles("#fileIn", [await fakeOriented(ctxB, "IMG_48MP.jpg")]);
  await opage.waitForSelector("#main:not([hidden])");
  await opage.waitForTimeout(300);
  const opx = (fx, fy) => opage.evaluate(([fx, fy]) => { const cv = document.getElementById("cv"), d = cv.getContext("2d").getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
  const ptr = await opx(0.95, 0.03), ptl = await opx(0.05, 0.03);
  check((await opage.textContent("#pname")).includes("1707 x 2560") && ptr[0] > ptr[2] + 40 && ptl[2] > ptl[0] + 40, `orientation EXIF 6 respectée, image de travail 1707 x 2560 (haut droite ${ptr}, haut gauche ${ptl})`);
  await opage.screenshot({ path: path.join(caps, `${label}_orientation.png`) });

  // Fiches dans IndexedDB : fiche retrouvée après rechargement sans sa copie localStorage, reprise des fiches anciennes, purge à 90 jours
  const idbJpg = path.join(caps, `${label}_IDB.jpg`);
  fs.writeFileSync(idbJpg, (await fakePhoto(ctxB, 1200, 900, "IDB.jpg")).buffer);   // fichier sur disque : même date à chaque chargement
  const ipage = await ctxB.newPage();
  ipage.on("pageerror", e => errors.push(String(e)));
  await ipage.goto(base);
  await ipage.setInputFiles("#fileIn", idbJpg);
  await ipage.waitForSelector("#main:not([hidden])");
  await ipage.$eval("input[data-incl]", el => { el.value = -3.5; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await ipage.waitForTimeout(900);
  let fi = await idbFiches(ipage);
  const ik = fi && Object.keys(fi).find(k => k.startsWith(`${label}_IDB.jpg|`));
  check(ik && JSON.parse(fi[ik].cfg).inclinaison === -3.5 && Date.now() - fi[ik].t < 60000, "fiche écrite dans IndexedDB (horodatée)");
  await ipage.evaluate(() => new Promise((res, rej) => {
    // une fiche de plus de 90 jours dans IndexedDB, une fiche d'avant 0.12 seulement dans localStorage, la copie de la photo effacée
    Object.keys(localStorage).filter(k => k.includes("_IDB.jpg|")).forEach(k => localStorage.removeItem(k));
    localStorage.setItem("esam-picture:ANCIENNE.jpg|12|34", JSON.stringify({ version: 1, format: "story", rotation: 0 }));
    for (let i = 0; i < 45; i++) localStorage.setItem(`esam-picture:LOT${i}.jpg|1|${i}`, JSON.stringify({ version: 1, format: "carre" }));
    const r = indexedDB.open("esam-picture");
    r.onsuccess = () => { const db = r.result, tx = db.transaction("fiches", "readwrite"); tx.objectStore("fiches").put({ cfg: "{}", t: Date.now() - 100 * 864e5 }, "VIEILLE.jpg|1|1"); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  }));
  await ipage.reload(); await ipage.waitForTimeout(800);
  await ipage.setInputFiles("#fileIn", idbJpg);
  await ipage.waitForSelector("#main:not([hidden])");
  await ipage.waitForTimeout(300);
  check((await ipage.inputValue("input[data-incl]")) === "-3.5" && !(await ipage.evaluate(() => Object.keys(localStorage).some(k => k.includes("_IDB.jpg|")))), "fiche retrouvée après rechargement, depuis IndexedDB seul");
  fi = await idbFiches(ipage);
  check(!fi["VIEILLE.jpg|1|1"] && fi["ANCIENNE.jpg|12|34"] && JSON.parse(fi["ANCIENNE.jpg|12|34"].cfg).format === "story", "à l'ouverture : fiche de plus de 90 jours purgée, fiche de localStorage reprise dans IndexedDB");
  const nLs = await ipage.evaluate(() => Object.keys(localStorage).filter(k => /\|\d+\|\d+$/.test(k)).length);
  check(nLs === 40 && Object.keys(fi).filter(k => k.startsWith("LOT")).length === 45, `copie localStorage limitée aux 40 fiches les plus récentes (${nLs}), les 45 fiches d'un lot ancien toutes dans IndexedDB`);

  check(errors.length === 0, `aucune erreur de page (${errors.join(" | ").slice(0, 300)})`);
  await ctxB.close();
}
// Base IndexedDB de la version 1 (dossier de travail seul) : le passage en version 2 garde le dossier et ajoute les fiches
{
  console.log("\n== base IndexedDB d'avant 0.12");
  const ctxU = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctxU.addInitScript(() => {
    if (location.pathname !== "/" || sessionStorage.getItem("v1")) return;
    sessionStorage.setItem("v1", "1");
    const r = indexedDB.open("esam-picture", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv").put({ name: "Dossier test" }, "dossier"); };
    r.onsuccess = () => { r.result.close(); };
  });
  const up = await ctxU.newPage();
  const errs = []; up.on("pageerror", e => errs.push(String(e)));
  await up.goto(base); await up.waitForTimeout(800);
  const st = await up.evaluate(() => new Promise(res => { const r = indexedDB.open("esam-picture"); r.onsuccess = () => { const db = r.result, out = { v: db.version, stores: Array.from(db.objectStoreNames) }; const tx = db.transaction("kv", "readonly"), g = tx.objectStore("kv").get("dossier"); tx.oncomplete = () => { out.dossier = g.result && g.result.name; db.close(); res(out); }; }; }));
  check(st.v === 2 && st.stores.includes("kv") && st.stores.includes("fiches") && st.dossier === "Dossier test", `base passée en version ${st.v} (${st.stores.join(", ")}), dossier de travail conservé`);
  check(errs.length === 0, `aucune erreur de page (${errs.join(" | ").slice(0, 300)})`);
  await ctxU.close();
}
await browser.close(); server.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
