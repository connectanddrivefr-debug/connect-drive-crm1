// Lecture d'un bon de livraison (PDF ou photo) dans le navigateur, sans
// service payant: texte du PDF (pdf.js), sinon reconnaissance de caractères
// (Tesseract.js) sur la photo ou les pages scannées. Puis classement: chaque
// numéro de série connu du stock trouvé dans le BL est rattaché à la dernière
// référence produit (code fabricant / EAN) qui le précède.

async function pdfToText(file, onProgress) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let text = "";
  const canvases = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Regroupe les morceaux par ligne (même ordonnée)
    const lines = new Map();
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      lines.set(y, (lines.get(y) || "") + " " + it.str);
    }
    text += [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.trim()).join("\n") + "\n";
    canvases.push(page);
  }
  if (text.replace(/\s/g, "").length > 40) return text;
  // PDF scanné (images): on rend chaque page et on passe en reconnaissance
  let ocr = "";
  for (let i = 0; i < canvases.length; i++) {
    const page = canvases[i];
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    ocr += (await ocrImage(canvas, (p) => onProgress && onProgress((i + p) / canvases.length))) + "\n";
  }
  return ocr;
}

async function ocrImage(image, onProgress) {
  const Tesseract = (await import("tesseract.js")).default;
  const { data } = await Tesseract.recognize(image, "eng", {
    logger: (m) => m.status === "recognizing text" && onProgress && onProgress(m.progress),
  });
  return data.text;
}

export async function extractBlText(file, onProgress) {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return pdfToText(file, onProgress);
  return ocrImage(file, onProgress);
}

// Codes fabricant type TRY32-1-OL5-F (lettres/chiffres séparés par des tirets)
const REF_RE = /\b[A-Z]{2,6}\d{0,4}(?:-[A-Z0-9]{1,6}){2,}\b/g;
const EAN_RE = /\b\d{13}\b|\b\d{8}\b/g;

// Rapprochement tolérant aux erreurs de lecture (O/0, I/l/1, S/5, B/8)
function loose(s) {
  return s.toUpperCase().replace(/[O]/g, "0").replace(/[IL|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

// known: [{ serialNumber, model, ean, reference }]
// -> { groups: [{ key, reference, ean, serials: [...] }], notFound: [serials du stock absents du BL] }
export function classifyFromBl(text, known) {
  const upper = text.toUpperCase();
  const byLoose = new Map();
  for (const k of known) {
    const l = loose(k.serialNumber);
    byLoose.set(l, byLoose.has(l) ? null : k.serialNumber); // null = ambigu
  }

  // Événements dans l'ordre du texte: références et numéros de série
  const events = [];
  for (const m of upper.matchAll(REF_RE)) {
    // numéros de document (BL-2026-451, CMD-..., FAC-...) ne sont pas des références produit
    if (/^(BL|BC|BR|CMD|CDE|FAC|FA|DEV|AV|NUM|DOC)\d*-/.test(m[0])) continue;
    events.push({ i: m.index, kind: "ref", v: m[0] });
  }
  for (const m of upper.matchAll(EAN_RE)) events.push({ i: m.index, kind: "ean", v: m[0] });
  for (const m of upper.matchAll(/[A-Z0-9][A-Z0-9\-_.]{4,}/g)) {
    const serial = byLoose.get(loose(m[0].replace(/[.\-_]+$/, "")));
    if (serial) events.push({ i: m.index, kind: "sn", v: serial });
  }
  events.sort((a, b) => a.i - b.i);

  let curRef = null;
  let curEan = null;
  const assigned = new Map();
  for (const e of events) {
    if (e.kind === "ref") {
      if (e.v !== curRef) curEan = null;
      curRef = e.v;
    } else if (e.kind === "ean") curEan = e.v;
    else if ((curRef || curEan) && !assigned.has(e.v)) assigned.set(e.v, { reference: curRef, ean: curEan });
  }

  const groups = new Map();
  for (const [serial, r] of assigned) {
    const key = r.reference || r.ean;
    if (!groups.has(key)) groups.set(key, { key, reference: r.reference, ean: r.ean, serials: [] });
    groups.get(key).serials.push(serial);
  }
  return { groups: [...groups.values()], found: assigned.size };
}
