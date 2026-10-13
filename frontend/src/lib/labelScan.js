// Lecture de TOUS les codes d'une photo d'étiquette (QR S/N + code-barres
// produit EAN + code-barres S/N), directement dans le navigateur (zxing-wasm,
// gratuit). Une photo par carton suffit: on récupère le numéro de série ET
// la référence produit.
import { normalizeSerial } from "./serial";

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

// Renvoie { serials: [...], eans: [...], raw: [...] }
export async function readLabel(fileOrBlob) {
  const readBarcodes = await getReader();
  const buf = new Uint8Array(await fileOrBlob.arrayBuffer());
  const results = await readBarcodes(buf, { tryHarder: true, maxNumberOfSymbols: 12 });
  const serials = [];
  const eans = [];
  for (const r of results) {
    const text = (r.text || "").trim();
    if (!text) continue;
    const digits = text.replace(/\s/g, "");
    if (isEan(digits)) {
      if (!eans.includes(digits)) eans.push(digits);
      continue;
    }
    const s = normalizeSerial(text);
    if (s && !serials.includes(s)) serials.push(s);
  }
  return { serials, eans, raw: results.map((r) => `${r.format}: ${r.text}`) };
}
