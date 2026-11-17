// Lecture de TOUS les codes d'une photo d'étiquette (QR S/N + code-barres
// produit EAN + code-barres S/N), directement dans le navigateur (zxing-wasm,
// gratuit). Une photo par carton suffit: on récupère le numéro de série ET
// la référence produit.
import { normalizeSerial, refCodeFromLabel } from "./serial";

let readerPromise = null;
async function getReader() {
  if (!readerPromise) {
    readerPromise = (async () => {
      const mod = await import("zxing-wasm/reader");
      const wasmUrl = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
      mod.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
        fireImmediately: true,
      });
      return mod.readBarcodes;
    })();
  }
  return readerPromise;
}

export function isEan(code) {
  return /^\d{8,14}$/.test(code);
}

// Sépare les codes lus: code-barres produit (EAN) / numéros de série / codes
// référence fabricant (le QR code V2C contient "S/N;RÉFÉRENCE").
export function splitCodes(texts) {
  const serials = [];
  const eans = [];
  const refCodes = [];
  for (const t of texts) {
    const text = (t || "").trim();
    if (!text) continue;
    const digits = text.replace(/\s/g, "");
    if (isEan(digits)) {
      if (!eans.includes(digits)) eans.push(digits);
      continue;
    }
    const s = normalizeSerial(text);
    if (s && !serials.includes(s)) serials.push(s);
    const code = refCodeFromLabel(text);
    if (code && !refCodes.includes(code)) refCodes.push(code);
  }
  return { serials, eans, refCodes };
}

async function decode(data, fast) {
  const readBarcodes = await getReader();
  const results = await readBarcodes(data, { tryHarder: !fast, maxNumberOfSymbols: 12 });
  return results.map((r) => (r.text || "").trim()).filter(Boolean);
}

// Lit tous les codes d'une image (fichier photo ou ImageData d'une frame caméra).
// Pour une photo, si tous les codes ne sont pas trouvés du premier coup, on
// réessaie à d'autres tailles (une photo de téléphone lue telle quelle rate
// souvent le QR code ou lit mal le code-barres) et on cumule les résultats.
export async function readCodes(input, { fast = false } = {}) {
  if (input instanceof ImageData) return decode(input, fast);
  const found = new Set(await decode(new Uint8Array(await input.arrayBuffer()), fast));
  const complete = () => {
    const { serials, eans, refCodes } = splitCodes([...found]);
    return serials.length > 0 && (eans.length > 0 || refCodes.length > 0) && found.size >= 3;
  };
  if (complete() || typeof createImageBitmap !== "function") return [...found];
  const bitmap = await createImageBitmap(input);
  for (const scale of [1.5, 2, 0.75]) {
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    if (w * h > 24e6) continue;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    (await decode(ctx.getImageData(0, 0, w, h), false)).forEach((c) => found.add(c));
    if (complete()) break;
  }
  bitmap.close && bitmap.close();
  return [...found];
}

// Renvoie { serials: [...], eans: [...], refCodes: [...] }
export async function readLabel(fileOrBlob) {
  return splitCodes(await readCodes(fileOrBlob));
}
