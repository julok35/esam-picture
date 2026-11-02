/* Test de fumée (Playwright, Chromium) : sert le dossier, charge des photos fabriquées, exerce chaque onglet,
   exporte une photo et une fiche, puis vérifie la reprise d'une fiche. Captures d'écran dans tests/captures/.
   Lancer : node tests/test_fumee.mjs   (Chromium et Playwright doivent être installés : npx playwright install chromium)
   Options :
     --only <motif>     n'exécute que les sections dont le nom contient le motif (sans tenir compte des accents ni de la
                        casse), par exemple --only pwa, --only fiches, --only reference, --only telephone ; variable ONLY
     --maj-reference    régénère tests/reference/reference.jpg (export de référence) au lieu de le comparer, quand un
                        changement de rendu est voulu ; variable MAJ_REFERENCE=1 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");   // require honore NODE_PATH (installation globale)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const caps = path.join(root, "tests", "captures");
fs.mkdirSync(caps, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".woff2": "font/woff2", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webmanifest": "application/manifest+json" };
let swOverride = null;   // section PWA : sw.js servi avec une autre version, pour simuler une mise à jour publiée
const server = http.createServer((req, res) => {
  if (swOverride && req.url.split("?")[0] === "/sw.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(fs.readFileSync(path.join(root, "sw.js"), "utf8").replace(/const VERSION = "[^"]+"/, `const VERSION = "${swOverride}"`)); return;
  }
  const f = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
function check(cond, msg) { if (cond) console.log(`  ok   ${msg}`); else { failures++; console.log(`  ECHEC ${msg}`); } }
/* options de la ligne de commande (voir l'en-tête) */
const args = process.argv.slice(2), oi = args.indexOf("--only");
const only = oi >= 0 ? args[oi + 1] || "" : process.env.ONLY || "";
const MAJ_REF = args.includes("--maj-reference") || !!process.env.MAJ_REFERENCE;
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
let nSections = 0;
/* une section du test : ignorée si --only ne la désigne pas ; une exception y compte comme un échec sans arrêter les suivantes */
async function section(nom, fn) {
  if (only && !norm(nom).includes(norm(only))) return;
  nSections++;
  console.log(`\n== ${nom}`);
  try { await fn(); } catch (e) { failures++; console.log(`  ECHEC section interrompue par une exception : ${(e && e.stack || String(e)).split("\n").slice(0, 4).join(" | ")}`); }
}
const APP_VER = (/const APP_VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(root, "index.html"), "utf8")) || [])[1];

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

for (const [label, vp] of [["telephone", { width: 390, height: 844 }], ["pc", { width: 1400, height: 900 }]]) await section(`${label} ${vp.width}x${vp.height}`, async () => {
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
    await new Promise(r => { const it = setInterval(() => { x.fillStyle = `hsl(${t * 10},70%,50%)`; x.fillRect(0, 0, 640, 360); x.fillStyle = "#fff"; x.font = "40px sans-serif"; x.fillText("t=" + t, 40, 200); t++; if (t > 80) { clearInterval(it); r(); } }, 40); });
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
  const pn = await vpage.textContent("#pname");
  check(/DJI_0002_00m0[01]s\d\d\.jpg/.test(pn), `nom de l'image extraite : ${pn.trim()}`);
  // Rafale : 3 images de 0,5 s à 2,5 s, une par seconde ; ajoutées dans l'ordre, la première devient la photo choisie
  const vSeek = t => vpage.evaluate(t => new Promise(r => { const v = document.getElementById("vel"); v.addEventListener("seeked", () => r(), { once: true }); v.currentTime = t; }), t);
  const vInfo0 = await vpage.textContent("#vbInfo"), vdur = await vpage.evaluate(() => document.getElementById("vel").duration);
  check(await vpage.isVisible("#vburst") && /^\d+ images?, une toutes les 2 s/.test(vInfo0) && (await vpage.getAttribute('[data-vact="bstep"][data-s="2"]', "aria-pressed")) === "true", `bloc Rafale : pas de 2 s par défaut (${vInfo0}, durée ${vdur})`);
  await vSeek(0.5); await vpage.click('[data-vact="bstart"]');
  await vSeek(2.5); await vpage.click('[data-vact="bend"]');
  await vpage.click('[data-vact="bstep"][data-s="1"]');
  check((await vpage.textContent("#vbA")) === "0:00.50" && (await vpage.textContent("#vbB")) === "0:02.50" && (await vpage.textContent("#vbInfo")).startsWith("3 images, une toutes les 1 s"), "rafale : début 0,5 s, fin 2,5 s, pas de 1 s, 3 images annoncées");
  await vpage.screenshot({ path: path.join(caps, `${label}_video_rafale.png`) });
  const nFilm0 = await vpage.evaluate(() => document.querySelectorAll("#film .th:not(.add):not(.vid)").length);
  await vpage.click('[data-vact="burst"]');
  await vpage.waitForFunction(() => document.getElementById("vbProg").textContent.includes("/3")).catch(() => {});
  const vprog = await vpage.textContent("#vbProg"), vstop = await vpage.isVisible('[data-vact="bstop"]');
  await vpage.waitForFunction(n => document.querySelectorAll("#film .th:not(.add):not(.vid)").length === n + 3, nFilm0, { timeout: 20000 }).catch(() => {});
  const vnames = await vpage.evaluate(() => Array.from(document.querySelectorAll("#film .th:not(.add):not(.vid)")).map(b => b.title));
  check(/Image [123]\/3|Rafale terminée/.test(vprog) && (vstop || vprog.includes("terminée")), `progression de la rafale (« ${vprog} »), bouton Arrêter`);
  check(vnames.slice(nFilm0).join() === "DJI_0002_00m00s50.jpg,DJI_0002_00m01s50.jpg,DJI_0002_00m02s50.jpg", `rafale : 3 photos aux bons instants, dans l'ordre (${vnames.slice(nFilm0).join(", ")})`);
  check((await vpage.textContent("#pname")).includes("DJI_0002_00m00s50.jpg") && (await vpage.textContent("#vbProg")).includes("3/3") && !(await vpage.isVisible('[data-vact="bstop"]')), "la première image de la rafale devient la photo choisie");
  await vpage.click('[data-vact="close"]');
  check(await vpage.isVisible("#cv"), "images extraites de la vidéo, devenues des photos");

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

  // 0.14 : modèles de mise en page, avant / après, carrousel Instagram (page à part, photos neuves)
  const npage = await ctxB.newPage();
  npage.on("pageerror", e => errors.push(String(e)));
  npage.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  let answer = null;   // réponse aux boîtes de dialogue (nom d'un modèle, confirmation)
  npage.on("dialog", d => { d.accept(answer == null ? undefined : answer).catch(() => {}); });
  await npage.goto(base);
  const nCfg = n => npage.evaluate(n => { const k = Object.keys(localStorage).find(k => k.startsWith(`esam-picture:${n}|`)); return k ? JSON.parse(localStorage.getItem(k)) : null; }, n);
  const mods = () => npage.evaluate(() => JSON.parse(localStorage.getItem("esam-picture:modeles") || "[]"));
  const nShot = () => npage.evaluate(() => document.getElementById("cv").toDataURL());
  const nFilm = n => npage.waitForFunction(n => document.querySelectorAll("#film .th:not(.add)").length === n, n);
  const nShow = sel => npage.$eval(sel, el => { const b = el.closest(".sub") || el, pn = document.getElementById("panel"); if (getComputedStyle(pn).overflowY === "auto") b.scrollIntoView({ block: "start" }); else window.scrollBy(0, b.getBoundingClientRect().top - document.querySelector(".left").getBoundingClientRect().bottom - 8); });
  const pickPhoto = async n => { await npage.click(`#film .th[title^="${n}"]`); await npage.waitForTimeout(150); };
  const pA = await fakePhoto(ctxB, 1600, 1200, "SEC_A.jpg"), pB = await fakePhoto(ctxB, 1200, 1600, "SEC_B.jpg");
  await npage.setInputFiles("#fileIn", [pA]);
  await npage.waitForSelector("#main:not([hidden])");
  await npage.click('[data-tab="montage"]');
  check(await npage.isDisabled('[data-act="avantApres"]'), "avant / après : bouton désactivé avec une seule photo chargée");
  await npage.setInputFiles("#fileIn", [pB]); await nFilm(2);

  // Modèles : intégrés proposés, enregistrement, application sur une autre photo, ajout, import, export, renommer, supprimer
  await pickPhoto("SEC_A.jpg");
  await npage.click('[data-tab="calques"]');
  let mt = await npage.textContent("#modeles");
  check(mt.includes("Publication standard") && mt.includes("Story") && (await npage.$$('#modeles [data-modact="del"]')).length === 0 && (await npage.isDisabled('[data-act="modSave"]')), "modèles intégrés proposés quand la liste est vide, non supprimables ; rien à enregistrer sans calque");
  await npage.click('[data-addl="logo"]'); await npage.click('[data-addl="titre"]');
  await npage.fill("textarea[data-ltext]", "Modèle test"); await npage.waitForTimeout(500);
  await npage.click('[data-act="ldone"]');
  answer = "Mon modèle"; await npage.click('[data-act="modSave"]'); await npage.waitForTimeout(200);
  let ml = await mods();
  check(ml.length === 1 && ml[0].nom === "Mon modèle" && ml[0].calques.length === 2 && ml[0].calques[1].texte === "Modèle test" && !ml[0].calques.some(l => l.id) && ml[0].grille && typeof ml[0].grille.n === "number", "modèle enregistré dans localStorage (calques et texte, grille, sans ids)");
  mt = await npage.textContent("#modeles");
  check(mt.includes("Mon modèle") && !mt.includes("Publication standard"), "liste des modèles : le modèle enregistré, plus les intégrés");
  const noToast = () => npage.evaluate(() => { document.getElementById("toast").hidden = true; });
  await noToast(); await nShow("#modeles"); await npage.waitForTimeout(200);
  await npage.screenshot({ path: path.join(caps, `${label}_modeles.png`) });
  const mid = ml[0].id, cfMA = await nCfg("SEC_A.jpg");
  await pickPhoto("SEC_B.jpg");
  await npage.click(`[data-modact="apply"][data-mid="${mid}"]`); await npage.waitForTimeout(250);
  let cfMB = await nCfg("SEC_B.jpg");
  check(cfMB.calques.length === 2 && cfMB.calques[0].type === "logo" && cfMB.calques[1].texte === "Modèle test" && cfMB.calques.every(l => l.id && !cfMA.calques.some(a => a.id === l.id)), "modèle appliqué sur une autre photo (textes repris, ids neufs)");
  await npage.click("#undoBtn"); await npage.waitForTimeout(200);
  check((await nCfg("SEC_B.jpg")).calques.length === 0, "appliquer un modèle : une entrée d'historique, annulable");
  await npage.click("#redoBtn"); await npage.waitForTimeout(200);
  await npage.click(`[data-modact="add"][data-mid="${mid}"]`); await npage.waitForTimeout(200);
  check((await nCfg("SEC_B.jpg")).calques.length === 4, "« Ajouter » : les calques du modèle s'ajoutent à ceux de la photo");
  const imp = { nom: "Importé", calques: [{ type: "legende", animal: "Rex", x: 0.5, y: 0.9 }, { type: "inconnu", x: 0.1 }, { type: "logo", mode: "logo", x: 2, s: 99 }] };
  await npage.setInputFiles("#modeleIn", [{ name: "importe.esam-modele.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imp)) }]);
  await npage.waitForTimeout(300);
  ml = await mods(); const mi = ml.find(m => m.nom === "Importé");
  check(ml.length === 2 && mi && mi.calques.length === 2 && mi.calques[0].animal === "Rex" && mi.calques[0].date === "" && mi.calques[1].x === 1.2 && mi.calques[1].s === 5, "modèle importé depuis un JSON (type inconnu écarté, valeurs bornées comme une fiche)");
  await npage.click(`[data-modact="apply"][data-mid="${mi.id}"]`); await npage.waitForTimeout(200);
  cfMB = await nCfg("SEC_B.jpg");
  check(cfMB.calques.length === 2 && cfMB.calques[0].animal === "Rex" && cfMB.calques[0].date === "2024-05-01", "modèle importé appliqué : la légende sans date prend la date de prise de vue");
  const [dlmo] = await Promise.all([npage.waitForEvent("download"), npage.click(`[data-modact="export"][data-mid="${mid}"]`)]);
  const mj = JSON.parse(fs.readFileSync(await dlmo.path(), "utf8"));
  check(dlmo.suggestedFilename() === "Mon_modele.esam-modele.json" && mj.type === "modele" && mj.nom === "Mon modèle" && mj.calques.length === 2, `modèle exporté : ${dlmo.suggestedFilename()}`);
  answer = "Mon modèle 2"; await npage.click(`[data-modact="rename"][data-mid="${mid}"]`); await npage.waitForTimeout(200);
  check((await mods()).find(m => m.id === mid).nom === "Mon modèle 2", "modèle renommé");
  answer = null; await npage.click(`[data-modact="del"][data-mid="${mi.id}"]`); await npage.waitForTimeout(200);
  check((await mods()).length === 1, "modèle supprimé (après confirmation)");
  // modèle par défaut : posé sur une photo ajoutée, pas sur une photo dont la fiche est reprise
  const dJpg = path.join(caps, `${label}_SEC_D.jpg`);
  fs.writeFileSync(dJpg, (await fakePhoto(ctxB, 1000, 800, "SEC_D.jpg")).buffer);   // fichier sur disque : même clé de fiche au retour
  await npage.setInputFiles("#fileIn", dJpg); await nFilm(3);
  await npage.click('[data-tab="cadre"]'); await npage.click('[data-fmt="paysage"]'); await npage.waitForTimeout(300);
  await npage.click('[data-tab="export"]'); await npage.click('[data-act="remove"]'); await nFilm(2);
  await npage.click('[data-tab="calques"]');
  await npage.check(`[data-moddef="${mid}"]`); await npage.waitForTimeout(200);
  check((await npage.evaluate(() => localStorage.getItem("esam-picture:modeleDefaut"))) === mid && await npage.isChecked(`[data-moddef="${mid}"]`), "« Appliquer aux nouvelles photos » : modèle par défaut mémorisé");
  await npage.setInputFiles("#fileIn", [await fakePhoto(ctxB, 1200, 900, "SEC_C.jpg")]); await nFilm(3);
  check((await npage.textContent("#pname")).includes("SEC_C.jpg") && (await npage.$$("[data-csel]")).length === 2 && (await npage.textContent("#panel")).includes("Titre : Modèle test"), "modèle par défaut posé d'office sur la photo ajoutée");
  await npage.setInputFiles("#fileIn", dJpg); await nFilm(4);
  check((await npage.textContent("#pname")).includes("SEC_D.jpg") && (await npage.$$("[data-csel]")).length === 0 && (await npage.textContent("#tagFmt")).includes("1200 x 628"), "photo dont la fiche est reprise : pas de modèle par défaut");

  // Avant / après : deux bandes étiquetées, sens selon le format, photo « Après » choisie dans la liste
  await pickPhoto("SEC_A.jpg");
  await npage.click('[data-tab="montage"]');
  check(await npage.isEnabled('[data-act="avantApres"]') && (await npage.textContent('[data-aapick][aria-pressed="true"]')).includes("SEC_B.jpg"), "avant / après : la photo suivante de la pellicule proposée en « Après »");
  await npage.click('[data-act="avantApres"]'); await npage.waitForTimeout(400);
  let mA = (await nCfg("SEC_A.jpg")).montage;
  check(mA.mode === "bandes" && mA.bandes.length === 2 && mA.bandes[0].src === null && mA.bandes[0].etiquette === "Avant" && mA.bandes[1].src === "SEC_B.jpg" && mA.bandes[1].etiquette === "Après" && mA.sens === "v" && mA.sepCouleur === "#FFFFFF" && mA.sep > 0, "avant / après en carré : deux bandes côte à côte, étiquettes Avant et Après, séparateur blanc");
  const aaKeys = Object.keys(await nCfg("SEC_A.jpg")).sort().join();
  await noToast(); await npage.screenshot({ path: path.join(caps, `${label}_avant_apres.png`) });
  await npage.click('[data-tab="cadre"]'); await npage.click('[data-fmt="portrait"]'); await npage.waitForTimeout(200);
  await npage.click('[data-tab="montage"]');
  await npage.click('[data-aapick]:has-text("SEC_C.jpg")'); await npage.click('[data-act="avantApres"]'); await npage.waitForTimeout(400);
  mA = (await nCfg("SEC_A.jpg")).montage;
  check(mA.sens === "h" && mA.bandes[1].src === "SEC_C.jpg" && mA.bandes[1].etiquette === "Après", "avant / après en portrait : bandes empilées, photo « Après » choisie dans la liste");
  await noToast(); await npage.screenshot({ path: path.join(caps, `${label}_avant_apres_portrait.png`) });
  check(Object.keys(await nCfg("SEC_A.jpg")).sort().join() === aaKeys, "avant / après : aucun nouveau champ dans la fiche");
  await npage.click("#undoBtn"); await npage.waitForTimeout(200);
  mA = (await nCfg("SEC_A.jpg")).montage;
  check(mA.bandes[1].src === "SEC_B.jpg" && mA.sens === "v", "avant / après : une seule entrée d'historique");
  await npage.click('[data-mmode="aucun"]'); await npage.waitForTimeout(200);

  // Carrousel : format à part, lignes de coupe, export découpé en diapositives continues, logo de taille normale
  await npage.click('[data-tab="cadre"]'); await npage.click('[data-fmt="carre"]'); await npage.waitForTimeout(200);
  await npage.click('[data-tab="export"]');
  const [dlq] = await Promise.all([npage.waitForEvent("download"), npage.click('[data-act="export"]')]);
  const carreB64 = fs.readFileSync(await dlq.path()).toString("base64");
  await npage.click('[data-tab="cadre"]'); await npage.click('[data-fmt="carrousel"]'); await npage.waitForTimeout(300);
  check((await npage.textContent("#tagFmt")).includes("3240 x 1080") && (await npage.getAttribute('[data-carn="3"]', "aria-pressed")) === "true" && (await npage.getAttribute('[data-carforme="carre"]', "aria-pressed")) === "true", "format Carrousel : bande de 3 diapositives carrées, 3240 x 1080");
  await noToast(); await npage.screenshot({ path: path.join(caps, `${label}_cadre_carrousel.png`) });
  await npage.click('[data-tab="export"]'); await npage.waitForTimeout(200);
  const shK0 = await nShot();
  check(!(await npage.isVisible('[data-act="exportCar"]')), "bloc Carrousel replié par défaut");
  await npage.click("#carBlock summary"); await npage.waitForTimeout(300);
  const shK1 = await nShot();
  check(shK1 !== shK0 && await npage.isVisible('[data-act="exportCar"]') && (await npage.textContent("#carBlock")).includes("Publiez les images dans l'ordre : le panorama défile d'une diapositive à l'autre"), "bloc Carrousel déplié : lignes de coupe sur l'aperçu, texte d'aide");
  await noToast(); await nShow("#carBlock"); await npage.waitForTimeout(200);
  await npage.screenshot({ path: path.join(caps, `${label}_export_carrousel.png`) });
  const cfK = await nCfg("SEC_A.jpg");
  check(cfK.format === "carrousel" && cfK.carrousel && cfK.carrousel.n === 3 && cfK.carrousel.forme === "carre" && cfK.cadres.carrousel && Math.abs(cfK.cadre.w / cfK.cadre.h * 1600 / 1200 - 3) < 1e-6, "fiche : format Carrousel, réglage {n, forme}, cadre au ratio 3:1 mémorisé");
  const [dlk] = await Promise.all([npage.waitForEvent("download"), npage.click('[data-act="exportCar"]')]);
  const kStem = "20240501_animal_secteur_photo-Com-ESAM_100000", zk = unzip(fs.readFileSync(await dlk.path())) || [];
  const kj = zk.filter(e => e.name.endsWith(".jpg")).map(e => e.name);
  check(dlk.suggestedFilename() === `${kStem}_carrousel.zip` && JSON.stringify(kj) === JSON.stringify([1, 2, 3].map(i => `${kStem}_carrousel-${i}.jpg`)) && zk.every(e => e.ok) && zk.some(e => e.name === `${kStem}.esam.json`), `carrousel exporté : ${dlk.suggestedFilename()} (${zk.map(e => e.name).join(", ")})`);
  const kd = kj.map(n => (jpgDims(zk.find(e => e.name === n).data) || []).join("x"));
  check(kd.length === 3 && kd.every(d => d === "1080x1080"), `diapositives de 1080 x 1080 (${kd.join(", ")})`);
  zk.filter(e => e.name.endsWith(".jpg")).forEach(e => fs.writeFileSync(path.join(caps, `${label}_${e.name}`), e.data));   // à regarder : le panorama continu
  const meas = await npage.evaluate(async ([s1, s2, sq]) => {
    const load = b64 => new Promise(r => { const i = new Image(); i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); r(x.getImageData(0, 0, c.width, c.height)); }; i.src = "data:image/jpeg;base64," + b64; });
    const a = await load(s1), b = await load(s2), q = await load(sq);
    const px = (d, x, y) => { const i = (y * d.width + x) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
    const dist = (u, v) => (Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]) + Math.abs(u[2] - v[2])) / 3;
    let diff = 0, ref = 0;
    for (let y = 0; y < a.height; y++) { diff += dist(px(a, a.width - 1, y), px(b, 0, y)); ref += dist(px(a, a.width - 1, y), px(a, 0, y)); }
    // largeur du cartouche du logo (pixels sombres) sur la ligne de son centre (y = 0,1 de la hauteur)
    const extent = d => { const y = Math.round(d.height * 0.1); let l = -1, r = -1; for (let x = 0; x < d.width; x++) { const p = px(d, x, y); if (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] < 50) { if (l < 0) l = x; r = x; } } return l < 0 ? 0 : r - l; };
    return { diff: diff / a.height, ref: ref / a.height, logoQ: extent(q), logoK: extent(b) };
  }, [zk.find(e => e.name === kj[0]).data.toString("base64"), zk.find(e => e.name === kj[1]).data.toString("base64"), carreB64]);
  check(meas.diff < 8 && meas.diff * 3 < meas.ref, `continuité : bord droit de la diapositive 1 et bord gauche de la 2 proches (écart ${meas.diff.toFixed(1)}, contre ${meas.ref.toFixed(1)} d'un bord à l'autre d'une diapositive)`);
  check(meas.logoK > 250 && meas.logoK < 700 && Math.abs(meas.logoK - meas.logoQ) <= 6, `logo de taille normale sur la diapositive 2 (${meas.logoK} px, ${meas.logoQ} px sur la photo carrée)`);
  check((await nCfg("SEC_A.jpg")).format === "carrousel" && (await nShot()) === shK1, "export du carrousel : fiche et aperçu inchangés");
  await npage.click('[data-carn="4"]'); await npage.waitForTimeout(150); await npage.click('[data-carforme="portrait"]'); await npage.waitForTimeout(300);
  const cfK2 = await nCfg("SEC_A.jpg");
  check((await npage.textContent("#tagFmt")).includes("4320 x 1350") && cfK2.carrousel.n === 4 && cfK2.carrousel.forme === "portrait" && Math.abs(cfK2.cadre.w / cfK2.cadre.h * 1600 / 1200 - 4320 / 1350) < 1e-6, "carrousel de 4 diapositives portrait : 4320 x 1350, cadre au nouveau ratio");
  await npage.click("#carBlock summary"); await npage.waitForTimeout(200);
  check(!(await npage.isVisible('[data-act="exportCar"]')) && !JSON.stringify(await nCfg("SEC_A.jpg")).includes("carBlock"), "bloc replié : rien de transitoire dans la fiche");
  // reprise de la fiche dans une page vierge, lecture tolérante
  const rpage = await ctxB.newPage();
  rpage.on("pageerror", e => errors.push(String(e)));
  await rpage.goto(base);
  await rpage.setInputFiles("#fileIn", [pA]); await rpage.waitForSelector("#main:not([hidden])");
  const ficheIn = o => rpage.setInputFiles("#ficheIn", [{ name: "SEC_A.jpg.esam.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(o)) }]).then(() => rpage.waitForTimeout(400));
  await ficheIn(cfK2);
  check((await rpage.textContent("#tagFmt")).includes("Carrousel 4 x portrait · 4320 x 1350"), "carrousel : fiche reprise (4 diapositives portrait)");
  await ficheIn(Object.assign({}, cfK2, { carrousel: { n: "9", forme: "rond" } }));
  check((await rpage.textContent("#tagFmt")).includes("5400 x 1080"), "fiche au carrousel illisible : valeurs bornées (5 diapositives carrées)");
  const oldK = Object.assign({}, cfK2); delete oldK.carrousel;
  await ficheIn(oldK);
  check((await rpage.textContent("#tagFmt")).includes("3240 x 1080"), "fiche sans réglage de carrousel : 3 diapositives carrées par défaut");

  // 0.15 : visages détectés (faux FaceDetector : Chromium sans tête n'en a pas), pinceau de flou (page à part, photo neuve)
  const fpage = await ctxB.newPage();
  fpage.on("pageerror", e => errors.push(String(e)));
  fpage.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await fpage.addInitScript(() => {
    window.FaceDetector = class {
      constructor(o) { window.__fdOpts = o; }
      async detect(img) {
        window.__fdArg = [img.width, img.height, img.tagName];
        if (window.__fdMode === "erreur") throw new Error("NotSupportedError");
        if (window.__fdMode === "vide") return [];
        // le « visage » de la photo de test (disque en 0.35, 0.45, rayon 144 px) et un second visage, en pixels de l'image de travail
        return [{ boundingBox: { x: 416, y: 396, width: 288, height: 288 } }, { boundingBox: { x: 1000, y: 200, width: 160, height: 200 } }];
      }
    };
  });
  await fpage.goto(base);
  const fA = await fakePhoto(ctxB, 1600, 1200, "VIS_A.jpg");
  await fpage.setInputFiles("#fileIn", [fA]);
  await fpage.waitForSelector("#main:not([hidden])");
  // fiche de VIS_A.jpg écrite en dernier (deux pages du même contexte chargent la même photo : deux clés)
  const lastCfg = pg => pg.evaluate(() => { const r = JSON.parse(localStorage.getItem("esam-picture:recentes") || "{}"), k = Object.keys(r).filter(k => k.startsWith("VIS_A.jpg|")).sort((a, b) => r[b] - r[a])[0]; return k ? JSON.parse(localStorage.getItem(`esam-picture:${k}`)) : null; });
  const fCfg = () => lastCfg(fpage);
  const fShot = () => fpage.evaluate(() => document.getElementById("cv").toDataURL());
  const fToast = () => fpage.textContent("#toast");
  const fNoToast = () => fpage.evaluate(() => { document.getElementById("toast").hidden = true; });
  const setRangeP = (pg, sel, v) => pg.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const closeTo = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const zoneIs = (z, x, y, w, h) => z && z.forme === "ellipse" && z.mode === "doux" && z.force === 2 && closeTo(z.x, x) && closeTo(z.y, y) && closeTo(z.w, w) && closeTo(z.h, h) && !z.angle;
  /* écart moyen (0..255) entre deux images de l'aperçu sur un carré (fractions du canvas : centre fx, fy, demi-côté r) */
  const regionDiff = (a, b, fx, fy, r) => fpage.evaluate(async ([a, b, fx, fy, r]) => {
    const load = u => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = u; });
    const [ia, ib] = await Promise.all([load(a), load(b)]), W = ia.width, H = ia.height;
    const data = im => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.drawImage(im, 0, 0); return x.getImageData(0, 0, W, H).data; };
    const da = data(ia), db = data(ib), x0 = Math.max(0, Math.round((fx - r) * W)), x1 = Math.min(W, Math.round((fx + r) * W)), y0 = Math.max(0, Math.round((fy - r) * H)), y1 = Math.min(H, Math.round((fy + r) * H));
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]); n += 3; }
    return s / Math.max(1, n);
  }, [a, b, fx, fy, r]);
  await fpage.click('[data-tab="flous"]');
  check(await fpage.isVisible('[data-act="faces"]') && (await fpage.textContent("#panel")).includes("rien n'est envoyé"), "bouton « Trouver les visages » et aide, FaceDetector présent");
  // photo tournée d'un quart de tour : les visages (repérés dans l'image non tournée) sont ramenés dans le repère des flous
  await fpage.keyboard.press("r"); await fpage.waitForTimeout(200);
  await fpage.click('[data-act="faces"]'); await fpage.waitForTimeout(500);
  let fc = await fCfg(), fd = await fpage.evaluate(() => [window.__fdOpts, window.__fdArg]);
  check(fd[0] && fd[0].fastMode === false && fd[0].maxDetectedFaces === 20 && fd[1].join() === "1600,1200,CANVAS", "détection sur l'image de travail (fastMode faux, 20 visages au plus)");
  check((await fToast()).includes("2 visage(s) flouté(s)") && fc.rotation === 90 && fc.flous.length === 2 && zoneIs(fc.flous[0], 0.55, 0.35, 0.336, 0.252) && zoneIs(fc.flous[1], 0.75, 0.675, 200 / 1200 * 1.4, 160 / 1600 * 1.4),
    `photo tournée de 90° : deux ellipses « doux » agrandies de 40 % au bon endroit (${fc.flous.map(z => [z.x, z.y, z.w, z.h].map(v => v.toFixed(3)).join("/")).join(" ; ")})`);
  await fpage.keyboard.press("Control+z"); await fpage.waitForTimeout(200);
  fc = await fCfg();
  check(fc.flous.length === 0 && fc.rotation === 90, "Ctrl+Z : les deux visages retirés d'un coup (une seule entrée d'historique)");
  await fpage.keyboard.press("Control+z"); await fpage.waitForTimeout(200);
  // horizon redressé : les zones restent dans la source non inclinée (le rendu leur applique l'inclinaison)
  await fpage.click('[data-tab="cadre"]'); await setRangeP(fpage, "input[data-incl]", 4); await fpage.waitForTimeout(300);
  await fpage.click('[data-tab="flous"]'); await fNoToast();
  await fpage.click('[data-act="faces"]'); await fpage.waitForTimeout(500);
  fc = await fCfg();
  check(fc.rotation === 0 && fc.inclinaison === 4 && fc.flous.length === 2 && zoneIs(fc.flous[0], 0.35, 0.45, 0.252, 0.336) && zoneIs(fc.flous[1], 0.675, 0.25, 0.14, 200 / 1200 * 1.4), "horizon redressé : visages dans la source non inclinée");
  await fpage.click('[data-tab="cadre"]'); await fpage.click('[data-act="incl0"]'); await fpage.waitForTimeout(200);
  await fpage.click('[data-tab="flous"]'); await fpage.waitForTimeout(300);   // la vue « sortie » remplace la vue « cadre » à l'image suivante
  // zones choisies au toucher, modifiables, supprimables comme les autres
  // la scène est collante sous l'en-tête (téléphone) : sa place à l'écran est relue avant chaque geste
  let fb = null; const fBox = async () => { fb = await fpage.locator("#cv").boundingBox(); }, fX = f => fb.x + fb.width * f, fY = f => fb.y + fb.height * f;
  await fBox(); await fpage.mouse.click(fX((0.675 - 0.125) / 0.75), fY(0.25)); await fpage.waitForTimeout(200);
  check((await fpage.getAttribute('[data-fsel]:nth-of-type(2)', "aria-pressed")) === "true", "second visage choisi au toucher");
  await fpage.click('[data-fforce="3"]'); await fpage.waitForTimeout(200);
  check((await fCfg()).flous[1].force === 3, "zone d'un visage modifiable (intensité forte)");
  await fpage.click('[data-act="delZone"]'); await fpage.waitForTimeout(200);
  check((await fCfg()).flous.length === 1, "zone d'un visage supprimable");
  await fpage.evaluate(() => { window.__fdMode = "vide"; }); await fNoToast();
  await fpage.click('[data-act="faces"]'); await fpage.waitForTimeout(400);
  check((await fToast()).includes("Aucun visage trouvé") && (await fCfg()).flous.length === 1, "aucun visage : toast, rien d'ajouté");
  await fpage.evaluate(() => { window.__fdMode = "erreur"; }); await fNoToast();
  await fpage.click('[data-act="faces"]'); await fpage.waitForTimeout(400);
  check((await fToast()).includes("impossible") && (await fCfg()).flous.length === 1 && !(await fpage.isDisabled('[data-act="faces"]')), "erreur de l'API : toast d'explication, aucun changement");
  await fpage.evaluate(() => { window.__fdMode = ""; });

  // Pinceau : un trait en L sur la plaque crée une zone « trace » ; l'aperçu change près du trait, pas loin
  await fpage.click('[data-tab="calques"]'); await fpage.waitForTimeout(300);
  const tr0 = await fShot();
  await fpage.click('[data-tab="flous"]');
  await fpage.click('[data-act="pinceau"]');
  check((await fpage.getAttribute('[data-act="pinceau"]', "aria-pressed")) === "true" && await fpage.isVisible("input[data-bep]"), "mode pinceau activé (type, intensité, épaisseur du pinceau)");
  await fBox(); await fpage.mouse.move(fX(0.6), fY(0.74)); await fpage.mouse.down();
  await fpage.mouse.move(fX(0.92), fY(0.74), { steps: 12 }); await fpage.mouse.move(fX(0.92), fY(0.92), { steps: 6 });
  await fpage.mouse.up(); await fpage.waitForTimeout(500);
  fc = await fCfg();
  let tz = fc.flous[fc.flous.length - 1];
  check(fc.flous.length === 2 && tz.forme === "trace" && tz.pts.length >= 3 && tz.pts.length <= 400 && tz.ep === 0.08 && tz.mode === "doux" && tz.force === 2 && tz.x === undefined, `trait au pinceau : zone « trace » de ${tz.pts && tz.pts.length} points, épaisseur 0.08`);
  check((await fpage.getAttribute('[data-act="pinceau"]', "aria-pressed")) === "false" && (await fpage.getAttribute('[data-fsel]:nth-of-type(2)', "aria-pressed")) === "true" && (await fpage.textContent('[data-fsel]:nth-of-type(2)')).includes("Trait"), "mode pinceau terminé, le trait est choisi");
  check(Math.abs(tz.pts[0][0] - (0.125 + 0.6 * 0.75)) < 0.01 && Math.abs(tz.pts[0][1] - 0.74) < 0.01, `premier point en fraction de la source (${tz.pts[0].map(v => v.toFixed(3))})`);
  await fpage.screenshot({ path: path.join(caps, `${label}_flous_pinceau.png`) });
  await fpage.click('[data-tab="calques"]'); await fpage.waitForTimeout(300);
  const tr1 = await fShot();
  const dNear = await regionDiff(tr0, tr1, 0.76, 0.74, 0.03), dFar = await regionDiff(tr0, tr1, 0.06, 0.06, 0.04);
  check(dNear > 4 && dFar === 0, `rendu flouté près du trait (écart ${dNear.toFixed(1)}), identique loin du trait (${dFar})`);
  await fpage.click('[data-tab="flous"]');
  // toucher dans la boîte du trait mais loin de lui : le trait n'est pas pris ; toucher le trait : il est choisi
  await fpage.click('[data-fsel]:nth-of-type(1)');
  await fBox(); await fpage.mouse.click(fX(0.66), fY(0.88)); await fpage.waitForTimeout(200);
  const keep1 = await fpage.getAttribute('[data-fsel]:nth-of-type(1)', "aria-pressed");
  await fBox(); await fpage.mouse.click(fX(0.8), fY(0.745)); await fpage.waitForTimeout(200);
  check(keep1 === "true" && (await fpage.getAttribute('[data-fsel]:nth-of-type(2)', "aria-pressed")) === "true" && await fpage.isVisible("input[data-fep]") && !(await fpage.isVisible('[data-fforme]')), "trait choisi au toucher près du trait seulement ; curseur Épaisseur, pas de forme");
  // déplacement : tous les points suivent le doigt ; cache par zone identique au rendu à froid
  await fBox(); await fpage.mouse.move(fX(0.8), fY(0.74)); await fpage.mouse.down(); await fpage.mouse.move(fX(0.7), fY(0.74), { steps: 6 }); await fpage.mouse.up(); await fpage.waitForTimeout(400);
  const tz2 = (await fCfg()).flous[1], dys = tz2.pts.map((pt, i) => pt[1] - tz.pts[i][1]), dxs = tz2.pts.map((pt, i) => pt[0] - tz.pts[i][0]);
  check(tz2.pts.length === tz.pts.length && dxs[0] < -0.06 && dxs[0] > -0.09 && dxs.every(d => Math.abs(d - dxs[0]) < 2e-5) && dys.every(d => Math.abs(d) < 2e-5), `trait déplacé d'un bloc (dx=${dxs[0].toFixed(3)} en fraction de la source)`);
  const trWarm = await fShot();
  await fpage.keyboard.press("Control+z"); await fpage.waitForTimeout(200); await fpage.keyboard.press("Control+y"); await fpage.waitForTimeout(400);
  check((await fShot()) === trWarm && JSON.stringify((await fCfg()).flous[1].pts) === JSON.stringify(tz2.pts), "trait : rendu avec le cache par zone identique au rendu à froid (annuler puis rétablir)");
  await setRangeP(fpage, "input[data-fep]", 15); await fpage.waitForTimeout(600);
  tz = (await fCfg()).flous[1];
  check(tz.ep === 0.15 && JSON.stringify(tz.pts) === JSON.stringify(tz2.pts), "épaisseur du trait réglée au curseur (0.15)");
  await fpage.screenshot({ path: path.join(caps, `${label}_flous_trait.png`) });
  // export réel : dimensions exactes, à regarder (plaque floutée par le trait, visage par l'ellipse)
  await fpage.click('[data-tab="export"]');
  const [dlT] = await Promise.all([fpage.waitForEvent("download"), fpage.click('[data-act="export"]')]);
  const tb = fs.readFileSync(await dlT.path()), tdm = jpgDims(tb);
  fs.writeFileSync(path.join(caps, `${label}_export_pinceau.jpg`), tb);
  check(tdm && tdm.join("x") === "1080x1080", `export avec un trait au pinceau : ${tdm && tdm.join("x")}`);
  // fiche reprise dans une page vierge : même trait, même rendu ; lecture tolérante
  await fpage.click('[data-tab="calques"]'); await fpage.waitForTimeout(300);
  const trRef = await fShot(), ficheT = await fCfg();
  const tpage = await ctxB.newPage();
  tpage.on("pageerror", e => errors.push(String(e)));
  await tpage.goto(base);
  await tpage.setInputFiles("#fileIn", [fA]); await tpage.waitForSelector("#main:not([hidden])");
  const tFiche = o => tpage.setInputFiles("#ficheIn", [{ name: "VIS_A.jpg.esam.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(o)) }]).then(() => tpage.waitForTimeout(500));
  const tCfg = () => lastCfg(tpage);
  await tFiche(ficheT);
  await tpage.click('[data-tab="calques"]'); await tpage.waitForTimeout(300);
  const rt = (await tCfg()).flous;
  check(rt.length === 2 && rt[1].forme === "trace" && rt[1].ep === 0.15 && JSON.stringify(rt[1].pts) === JSON.stringify(tz.pts) && (await tpage.evaluate(() => document.getElementById("cv").toDataURL())) === trRef, "fiche reprise : trait retrouvé, même rendu au pixel près");
  await tpage.click('[data-tab="flous"]');
  check(!(await tpage.$('[data-act="faces"]')), "sans FaceDetector, pas de bouton « Trouver les visages »");
  await tFiche(Object.assign({}, ficheT, { flous: [{ forme: "trace", pts: [[0.1, 0.1]] }, { forme: "trace", pts: [[0.1, 0.1], [0.2, "x"], null, [0.3, 0.3]], ep: 9, force: 7 }, { forme: "inconnue", x: 0.5 }] }));
  const rt2 = (await tCfg()).flous;
  check(rt2 && rt2.length === 2 && rt2[0].forme === "trace" && rt2[0].pts.length === 2 && rt2[0].ep === 0.3 && rt2[0].force === 3 && rt2[1].forme === "ellipse", `fiche tolérante : trace sans points valides ignorée, points illisibles écartés, épaisseur et intensité bornées (${JSON.stringify(rt2)})`);
  await tpage.close();
  // touche R : les points du trait tournent avec la photo (comme le lasso), le flou reste sur le même contenu
  await fpage.click('[data-tab="flous"]');
  await fpage.keyboard.press("r"); await fpage.waitForTimeout(300);
  fc = await fCfg(); const tz3 = fc.flous[1];
  check(fc.rotation === 90 && tz3.ep === 0.15 && tz3.pts.every((pt, i) => closeTo(pt[0], 1 - tz.pts[i][1], 1e-9) && closeTo(pt[1], tz.pts[i][0], 1e-9)), "touche R : points du trait tournés avec la photo, épaisseur gardée");
  // point de la plaque sous le trait (source (0.68, 0.74) avant rotation), là où il se trouve après rotation
  const cd = fc.cadre, mo = [(1 - 0.74 - cd.x) / cd.w, (0.68 - cd.y) / cd.h];
  await fpage.click('[data-tab="calques"]'); await fpage.waitForTimeout(300);
  const rotT = await fShot();
  await fpage.click('[data-tab="flous"]'); await fpage.click('[data-fsel]:nth-of-type(2)'); await fpage.keyboard.press("Delete"); await fpage.waitForTimeout(200);
  await fpage.click('[data-tab="calques"]'); await fpage.waitForTimeout(300);
  const rotN = await fShot();
  const rNear = await regionDiff(rotT, rotN, mo[0], mo[1], 0.03), rFar = await regionDiff(rotT, rotN, 0.94, 0.06, 0.04);
  check((await fCfg()).flous.length === 1 && rNear > 4 && rFar === 0, `après rotation, le flou du trait reste sur son contenu (écart ${rNear.toFixed(1)} au trait, ${rFar} loin)`);
  await fpage.keyboard.press("Control+z"); await fpage.waitForTimeout(200);
  check((await fCfg()).flous.length === 2, "trait supprimé par Suppr, rétabli par Ctrl+Z");
  await fpage.close();

  check(errors.length === 0, `aucune erreur de page (${errors.join(" | ").slice(0, 300)})`);
  await ctxB.close();
});
// Base IndexedDB de la version 1 (dossier de travail seul) : le passage en version 2 garde le dossier et ajoute les fiches
await section("base IndexedDB d'avant 0.12", async () => {
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
});
/* 0.16 : appli installable et hors ligne (manifest, icônes, service worker, cache versionné, mise à jour, installation) */
const pngDims = b => b.length > 24 && b.readUInt32BE(0) === 0x89504E47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
await section("pwa hors ligne", async () => {
  const swVer = (/const VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(root, "sw.js"), "utf8")) || [])[1];
  check(APP_VER && swVer === APP_VER, `version du service worker (${swVer}) égale à APP_VERSION de index.html (${APP_VER})`);
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const reqs = []; ctxP.on("request", r => reqs.push(r.url()));
  const pg = await ctxP.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(String(e)));
  await pg.goto(base);
  // manifest : servi, JSON valide, champs attendus, icônes réelles aux tailles annoncées
  const mHref = await pg.getAttribute('link[rel="manifest"]', "href");
  const mRes = await fetch(new URL(mHref || "manifest.webmanifest", base));
  let man = null; try { man = JSON.parse(await mRes.text()); } catch (e) { man = null; }
  check(mRes.ok && man && man.name === "Photos ESAM" && man.short_name === "Photos ESAM" && man.lang === "fr" && man.start_url === "./" && man.scope === "./" && man.display === "standalone", `manifest ${mHref} servi et valide (nom, langue, start_url ./, scope ./, standalone)`);
  const themeMeta = await pg.getAttribute('meta[name="theme-color"]', "content");
  check(man && /^#[0-9A-F]{6}$/i.test(man.background_color) && man.theme_color === themeMeta, `couleurs du manifest (fond ${man && man.background_color}, thème ${man && man.theme_color} = meta theme-color)`);
  const icons = man && Array.isArray(man.icons) ? man.icons : [];
  const iconOk = [];
  for (const ic of icons) {
    const r = await fetch(new URL(ic.src, base)), d = r.ok ? pngDims(Buffer.from(await r.arrayBuffer())) : null;
    iconOk.push(!!d && ic.type === "image/png" && ic.sizes === `${d[0]}x${d[1]}`);
  }
  check(icons.length >= 3 && iconOk.every(Boolean) && icons.some(i => i.sizes === "192x192") && icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"), `icônes du manifest : ${icons.map(i => `${i.src} ${i.sizes}${i.purpose === "maskable" ? " (maskable)" : ""}`).join(", ")}`);
  const apple = await pg.getAttribute('link[rel="apple-touch-icon"]', "href");
  check(apple === "icons/icon-192.png" && (await fetch(new URL(apple, base))).ok && (await pg.getAttribute('meta[name="apple-mobile-web-app-capable"]', "content")) === "yes" && (await pg.getAttribute('meta[name="apple-mobile-web-app-title"]', "content")) === "Photos ESAM", "balises iPhone : icône, appli plein écran, titre");
  // installation : bouton de l'accueil à l'invite du navigateur (événement simulé), pas d'aide iPhone ailleurs
  check(!(await pg.isVisible("#installBtn")) && !(await pg.isVisible("#iosHint")), "accueil : ni bouton d'installation sans invite du navigateur, ni aide iPhone");
  await pg.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => { window.__invite = (window.__invite || 0) + 1; }; e.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(e); window.__annule = e.defaultPrevented;
  });
  check(await pg.isVisible("#installBtn") && (await pg.textContent("#installBtn")) === "Installer l'appli" && await pg.evaluate(() => window.__annule), "invite d'installation captée : bouton « Installer l'appli » affiché");
  await pg.screenshot({ path: path.join(caps, "telephone_accueil_installer.png") });
  await pg.click("#installBtn"); await pg.waitForTimeout(200);
  check((await pg.evaluate(() => window.__invite)) === 1 && !(await pg.isVisible("#installBtn")) && (await pg.textContent("#toast")).includes("installée"), "bouton : invite du navigateur ouverte, bouton masqué ensuite");
  // service worker : enregistré, actif, cache « esam-picture-v<APP_VERSION> » rempli
  const sw = await pg.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(async r => ({ scope: r.scope, script: r.active && r.active.scriptURL, keys: await caches.keys() })),
    new Promise(r => setTimeout(() => r(null), 15000))]));
  check(sw && sw.script === `${base}sw.js` && sw.scope === base, `service worker enregistré (${sw && sw.script}, portée ${sw && sw.scope})`);
  const cacheName = `esam-picture-v${APP_VER}`;
  check(sw && sw.keys.length === 1 && sw.keys[0] === cacheName, `cache versionné ${sw && sw.keys.join(", ")} (attendu ${cacheName})`);
  const cached = await pg.evaluate(n => caches.open(n).then(c => c.keys()).then(k => k.map(r => r.url)), cacheName);
  const attendus = ["", "index.html", "manifest.webmanifest", "vendor/anton-latin.woff2", "vendor/montserrat-latin.woff2", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-512-maskable.png"].map(f => base + f);
  check(attendus.every(u => cached.includes(u)), `fichiers de l'appli en cache (${cached.length})`);
  // hors ligne : rechargement, titre, polices servies par le service worker, une photo se charge et s'exporte
  await ctxP.setOffline(true);
  await pg.reload();
  const off = await pg.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([document.fonts.load("20px Anton"), document.fonts.load("700 16px Montserrat")]).catch(() => {});
    const f = await fetch("vendor/montserrat-latin.woff2").then(r => r.ok && r.headers.get("content-type")).catch(() => "erreur");
    return { titre: document.title, ctrl: !!navigator.serviceWorker.controller, online: navigator.onLine, ver: document.getElementById("verBadge").textContent,
      polices: Array.from(document.fonts).map(x => `${x.family}:${x.status}`), f };
  });
  check(!off.online && off.titre === "Photos ESAM" && off.ctrl && off.ver === `v${APP_VER}`, `hors ligne : la page se recharge (titre « ${off.titre} », ${off.ver}, servie par le service worker)`);
  check(off.polices.length >= 2 && off.polices.every(x => x.endsWith(":loaded")) && off.f === "font/woff2", `hors ligne : polices servies (${off.polices.join(", ")})`);
  await pg.setInputFiles("#fileIn", [await fakePhoto(ctxP, 1200, 900, "HORS_LIGNE.jpg")]);
  await pg.waitForSelector("#main:not([hidden])");
  await pg.click('[data-tab="export"]');
  const [dlo] = await Promise.all([pg.waitForEvent("download"), pg.click('[data-act="export"]')]);
  const dimo = jpgDims(fs.readFileSync(await dlo.path()));
  check(dimo && dimo.join("x") === "1080x1080", `hors ligne : photo chargée et exportée (${dimo && dimo.join("x")})`);
  await ctxP.setOffline(false);
  // mise à jour : un sw.js d'une autre version est publié ; proposé sans rechargement automatique, appliqué au clic
  swOverride = `${APP_VER}-maj`;
  await pg.evaluate(() => { window.__marque = 1; return navigator.serviceWorker.getRegistration().then(r => r.update()); });
  const vu = await pg.waitForSelector("#majBtn:not([hidden])", { timeout: 15000 }).then(() => true, () => false);
  await pg.waitForTimeout(500);
  check(vu && (await pg.textContent("#majBtn")) === "Nouvelle version disponible : recharger" && (await pg.evaluate(() => window.__marque)) === 1, "nouvelle version installée : « Nouvelle version disponible : recharger » proposé, page non rechargée");
  await pg.screenshot({ path: path.join(caps, "telephone_mise_a_jour.png") });
  if (vu) {
    await Promise.all([pg.waitForEvent("load", { timeout: 15000 }), pg.click("#majBtn")]);
    await pg.waitForFunction(() => !!navigator.serviceWorker.controller).catch(() => {});
    const apres = await pg.evaluate(() => caches.keys().then(k => ({ k, marque: window.__marque || 0 })));
    check(apres.marque === 0 && apres.k.join() === `esam-picture-v${APP_VER}-maj` && !(await pg.isVisible("#majBtn")), `au clic : page rechargée avec la nouvelle version, ancien cache supprimé (${apres.k.join(", ")})`);
  }
  swOverride = null;
  const autres = reqs.filter(u => !u.startsWith(base) && !/^(data|blob):/.test(u));
  check(autres.length === 0, `aucune requête vers un autre domaine (${autres.slice(0, 3).join(", ")})`);
  check(errs.length === 0, `aucune erreur de page (${errs.join(" | ").slice(0, 300)})`);
  await ctxP.close();
  // iPhone (Safari) : pas d'invite d'installation, une phrase d'aide
  const ctxI = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" });
  const ip = await ctxI.newPage(); await ip.goto(base);
  check(await ip.isVisible("#iosHint") && (await ip.textContent("#iosHint")).includes("Partager puis Sur l'écran d'accueil") && !(await ip.isVisible("#installBtn")), "iPhone Safari : aide « Partager puis Sur l'écran d'accueil », pas de bouton");
  await ip.screenshot({ path: path.join(caps, "telephone_accueil_iphone.png") });
  await ctxI.close();
});

/* étiquettes de la scène sur téléphone : format et consigne sans chevauchement, même avec « Carrousel 3 x carré » */
await section("etiquettes 390x844", async () => {
  const ctxE = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const pg = await ctxE.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(String(e)));
  await pg.goto(base);
  await pg.setInputFiles("#fileIn", [await fakePhoto(ctxE, 1600, 1200, "ETQ.jpg")]);
  await pg.waitForSelector("#main:not([hidden])");
  const boxes = () => pg.evaluate(() => ["tagFmt", "tagMode", "stage"].map(id => { const el = document.getElementById(id); if (el.hidden) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom, h: r.height }; }));
  const apart = (a, b) => !a || !b || a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;
  for (const [tab, fmt, nom] of [["cadre", "carrousel", "carrousel_cadre"], ["calques", "carrousel", "carrousel_calques"], ["cadre", "paysage", "paysage"]]) {
    await pg.click('[data-tab="cadre"]'); await pg.click(`[data-fmt="${fmt}"]`); await pg.click(`[data-tab="${tab}"]`); await pg.waitForTimeout(300);
    const [f, m, st] = await boxes(), dans = b => !b || (b.x >= st.x && b.r <= st.r && b.y >= st.y && b.b <= st.b);
    check(apart(f, m) && dans(f) && dans(m) && f.h <= 40 && (!m || m.h <= 40), `${nom} : étiquettes « ${(await pg.textContent("#tagFmt")).trim()} » et « ${(await pg.textContent("#tagMode")).trim()} » côte à côte sans chevauchement, deux lignes au plus (hauteurs ${f.h.toFixed(0)} et ${m ? m.h.toFixed(0) : 0} px)`);
    await pg.screenshot({ path: path.join(caps, `telephone_etiquettes_${nom}.png`) });
  }
  check((await pg.textContent("#tagFmt")).includes("Paysage 1.91:1 · 1200 x 628"), "texte complet du format conservé (nom · dimensions)");
  check(errs.length === 0, `aucune erreur de page (${errs.join(" | ").slice(0, 300)})`);
  await ctxE.close();
});

/* fiches de configuration des versions précédentes (tests/fiches/) : acceptées, champs retrouvés, rendu et export sans erreur */
const TYPES_CONNUS = ["logo", "titre", "texte", "legende", "fleche", "cercle", "zoom", "signature", "montagne", "biais", "coin", "carte"];
const DIMS = { carre: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], paysage: [1200, 628], large: [1920, 1080] };
const proche = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const calque = (c, t) => c.calques.find(l => l.type === t);
/* vérifications propres à chaque fiche (c : la fiche telle que l'appli l'a relue et enregistrée) */
const ATTENDUS = {
  "v0.1.esam.json": c => c.filtre === "chaud" && c.couleur.lum === 10 && c.flous.map(z => z.forme).join() === "ellipse,rect" && calque(c, "texte").larg === 0.9 && c.calques.every(l => l.ex === 1 && l.ey === 1)
    && c.inclinaison === 0 && Object.keys(c.cadres).join() === "portrait" && c.pub.texte === "" && c.carrousel.n === 3 && c.selectif.actif === false && c.montage.mode === "aucun",
  "v0.2.esam.json": c => c.grille.aimant === true && c.grille.n === 24 && ["signature", "montagne", "biais", "coin", "carte"].every(t => calque(c, t)) && calque(c, "texte").larg === 0.6 && calque(c, "coin").coin === "hd" && calque(c, "biais").miroir === true && c.flous[0].angle === 20,
  "v0.4-bandes.esam.json": c => c.montage.mode === "bandes" && c.montage.sens === "h" && c.montage.sep === 8 && c.montage.bandes.length === 2 && c.montage.bandes[1].src === "DJI_0001_T.jpg" && c.montage.bandes[0].etiquette === "Vue large" && c.grille.aimant === false,
  "v0.5-fusion-zoom.esam.json": c => c.montage.mode === "fusion" && c.montage.fusion.src === "DJI_0001_T.jpg" && c.montage.fusion.mode === "chaleur" && c.montage.fusion.fenetre.forme === "ellipse"
    && c.calques[0].forme === "rect" && proche(c.calques[0].ar, 1.05) && proche(c.calques[0].hr, 1.05) && c.calques[1].src === "DJI_0001_T.jpg" && c.calques[1].ar === 1 && c.calques[1].hr === 1 && c.meta.description.includes("thermique"),
  "v0.7.esam.json": c => c.rotation === 90 && calque(c, "titre").ex === 1.3 && calque(c, "titre").ey === 0.8 && calque(c, "cercle").ar === 1.6 && calque(c, "carte").hr === 0.9 && calque(c, "zoom").ar === 1.2 && calque(c, "zoom").hr === 0.8 && calque(c, "texte").larg === 0.7 && c.grille.n === 6,
  "v0.10.esam.json": c => c.selectif.actif && c.selectif.teintes.join() === "jaune,rouge" && c.selectif.renfort === 25 && c.selectif.zones.map(z => z.sens).join() === "garder,exclure" && c.selectif.zones[1].pts.length === 5
    && c.nom.animaux === "Rex et Luna" && c.nom.heure === "101530" && c.nom.date === "2024-05-01",
  "v0.12.esam.json": c => c.inclinaison === -4.5 && calque(c, "zoom").etiquette === "Plaque",
  "v0.13.esam.json": c => c.inclinaison === 1.5 && ["carre", "portrait", "story", "paysage"].every(k => c.cadres[k]) && c.pub.alt.startsWith("Photo ESAM : Filou") && c.pub.texte.includes("#ESAM") && c.nom.secteur === "Oisans",
  "v0.14.esam.json": c => c.carrousel.n === 4 && c.carrousel.forme === "portrait" && c.cadres.carrousel && proche(c.cadre.w / c.cadre.h * 1600 / 1200, 4320 / 1350, 1e-6),
  "v0.15.esam.json": c => c.flous.length === 2 && c.flous[1].forme === "trace" && c.flous[1].pts.length === 4 && c.flous[1].ep === 0.1 && c.flous[1].mode === "pixel" && c.inclinaison === 2,
  "reference.esam.json": c => c.inclinaison === 3 && c.flous[1].forme === "trace" && c.calques.length === 8 && calque(c, "zoom").etiquette === "Zoom"
};
await section("fiches anciennes", async () => {
  const dir = path.join(root, "tests", "fiches");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".esam.json")).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  check(files.length >= 10 && files.every(f => ATTENDUS[f]), `${files.length} fiches dans tests/fiches, chacune avec ses vérifications`);
  const ctxF = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctxF.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(String(e)));
  pg.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  await pg.goto(base);
  await pg.setInputFiles("#fileIn", [await fakePhoto(ctxF, 1600, 1200, "DJI_0001.jpg"), await fakePhoto(ctxF, 1600, 1200, "DJI_0001_T.jpg")]);
  await pg.waitForFunction(() => document.querySelectorAll("#film .th:not(.add)").length === 2);
  const lire = () => pg.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith("esam-picture:DJI_0001.jpg|")); return k ? JSON.parse(localStorage.getItem(k)) : null; });
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), e0 = errs.length;
    await pg.click('#film .th[title^="DJI_0001.jpg"]');
    await pg.evaluate(() => { const t = document.getElementById("toast"); t.hidden = true; t.textContent = ""; });
    await pg.setInputFiles("#ficheIn", [{ name: f, mimeType: "application/json", buffer: fs.readFileSync(path.join(dir, f)) }]);
    await pg.waitForFunction(() => document.getElementById("toast").textContent.includes("appliquée")).catch(() => {});
    const c = await lire();
    const nCal = (d.calques || []).filter(l => TYPES_CONNUS.includes(l && l.type)).length;
    const base0 = c && c.format === d.format && c.calques.length === nCal && c.flous.length === (d.flous || []).length && c.montage.mode === ((d.montage && d.montage.mode) || "aucun");
    let propre = false; try { propre = !!(c && ATTENDUS[f] && ATTENDUS[f](c)); } catch (e) { propre = false; }
    // chaque onglet se dessine, puis l'export passe par le rendu complet
    for (const t of ["cadre", "montage", "couleur", "flous", "calques", "export"]) { await pg.click(`[data-tab="${t}"]`); await pg.waitForTimeout(80); }
    const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 20000 }), pg.click('[data-act="export"]')]);
    const dims = jpgDims(fs.readFileSync(await dl.path()));
    const att = d.format === "carrousel" ? [d.carrousel.n * 1080, d.carrousel.forme === "portrait" ? 1350 : 1080] : DIMS[d.format];
    const okDims = dims && att && dims.join("x") === att.join("x");
    const rate = [!base0 && "format, nombre de calques, de flous ou montage", !propre && "champs propres à la version", !okDims && "dimensions de l'export"].filter(Boolean);
    if (rate.length) console.log(`       ${f} relue : ${JSON.stringify(c).slice(0, 1500)}`);
    check(base0 && propre && okDims && errs.length === e0, `${f}${rate.length ? ` (en défaut : ${rate.join(", ")})` : ""} : acceptée (format ${c && c.format}, ${c && c.calques.length} calques, ${c && c.flous.length} flous, montage ${c && c.montage.mode}), champs propres à la version retrouvés, export ${dims && dims.join("x")}${errs.length > e0 ? ` ; erreurs : ${errs.slice(e0).join(" | ").slice(0, 200)}` : ""}`);
    if (f === "v0.5-fusion-zoom.esam.json" || f === "v0.14.esam.json") await pg.screenshot({ path: path.join(caps, `pc_fiche_${f.replace(/\.esam\.json$/, "")}.png`) });
  }
  check(errs.length === 0, `aucune erreur de page (${errs.join(" | ").slice(0, 300)})`);
  await ctxF.close();
});

/* export de référence : la fiche fixe tests/fiches/reference.esam.json sur la photo de test (déterministe), exportée et
   comparée à tests/reference/reference.jpg en décodant les deux JPEG dans le navigateur ; --maj-reference la régénère */
/* seuils : différence moyenne par pixel et par canal (sur 255), et part des pixels très différents (écart de plus de 64 sur
   un canal) : le second critère voit un changement local (un calque déplacé) que la moyenne dilue */
const REF_JPG = path.join(root, "tests", "reference", "reference.jpg"), REF_SEUIL = 2, REF_FORT = 0.5;
await section("export de reference", async () => {
  const ctxR = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctxR.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(String(e)));
  await pg.goto(base);
  await pg.setInputFiles("#fileIn", [await fakePhoto(ctxR, 1600, 1200, "REF.jpg")]);
  await pg.waitForSelector("#main:not([hidden])");
  await pg.setInputFiles("#ficheIn", [{ name: "reference.esam.json", mimeType: "application/json", buffer: fs.readFileSync(path.join(root, "tests", "fiches", "reference.esam.json")) }]);
  await pg.waitForFunction(() => document.getElementById("toast").textContent.includes("appliquée")).catch(() => {});
  await pg.evaluate(() => document.fonts.ready);
  await pg.click('[data-tab="export"]'); await pg.waitForTimeout(300);
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click('[data-act="export"]')]);
  const jpg = fs.readFileSync(await dl.path());
  fs.writeFileSync(path.join(caps, "pc_export_reference.jpg"), jpg);
  check(errs.length === 0, `fiche de référence appliquée et exportée sans erreur (${errs.join(" | ").slice(0, 200)})`);
  if (MAJ_REF) {
    fs.mkdirSync(path.dirname(REF_JPG), { recursive: true }); fs.writeFileSync(REF_JPG, jpg);
    console.log(`  maj  référence régénérée : tests/reference/reference.jpg (${jpgDims(jpg).join("x")}, ${jpg.length} octets) ; vérifier l'image avant de la commiter`);
  } else if (!fs.existsSync(REF_JPG)) {
    check(false, "référence absente (tests/reference/reference.jpg) : la créer avec node tests/test_fumee.mjs --only reference --maj-reference");
  } else {
    const r = await pg.evaluate(async ([a, b]) => {
      const load = b64 => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/jpeg;base64," + b64; });
      const [ia, ib] = [await load(a), await load(b)];
      if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { dims: [ia.naturalWidth, ia.naturalHeight, ib.naturalWidth, ib.naturalHeight] };
      const px = i => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const da = px(ia), db = px(ib); let s = 0, mx = 0, n = 0, fort = 0;
      for (let k = 0; k < da.length; k += 4) {
        let m = 0; for (let j = 0; j < 3; j++) { const v = Math.abs(da[k + j] - db[k + j]); s += v; n++; if (v > m) m = v; }
        if (m > mx) mx = m; if (m > 64) fort++;
      }
      return { w: ia.naturalWidth, h: ia.naturalHeight, moy: s / n, max: mx, fort: 100 * fort / (da.length / 4) };
    }, [fs.readFileSync(REF_JPG).toString("base64"), jpg.toString("base64")]);
    if (r.dims) check(false, `export de référence : dimensions ${r.dims[2]}x${r.dims[3]} au lieu de ${r.dims[0]}x${r.dims[1]}`);
    else {
      const ok = r.moy < REF_SEUIL && r.fort < REF_FORT, mesure = `différence moyenne ${r.moy.toFixed(3)} sur 255 (seuil ${REF_SEUIL}), pixels très différents ${r.fort.toFixed(2)} % (seuil ${REF_FORT} %), écart maximal ${r.max}`;
      check(ok, ok ? `export conforme à la référence ${r.w}x${r.h} : ${mesure}`
      : `export différent de la référence : ${mesure}. Comparer tests/captures/pc_export_reference.jpg et tests/reference/reference.jpg ; si le changement de rendu est voulu : node tests/test_fumee.mjs --only reference --maj-reference`);
    }
  }
  await ctxR.close();
});
if (only && !nSections) { failures++; console.log(`\nECHEC aucune section ne correspond à « ${only} »`); }
await browser.close(); server.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
