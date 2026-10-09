// Normalisation des numéros de série scannés (code-barres / QR code des
// cartons de bornes). Le contenu d'un QR code varie selon le fabricant:
// numéro seul, "SN:XXXX", URL avec ?sn=XXXX, ou plusieurs champs séparés.
// On extrait le numéro de série et on le met en forme (sans espaces,
// majuscules) pour que le même carton donne toujours la même valeur.
// La même fonction est dupliquée côté backend (backend/src/lib/serial.js).
function normalizeSerial(raw) {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  if (!s) return "";

  // URL: paramètre sn / serial / s, sinon dernier segment du chemin
  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      const param = ["sn", "serial", "serialnumber", "s"]
        .map((k) => url.searchParams.get(k))
        .find(Boolean);
      if (param) s = param;
      else {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length) s = parts[parts.length - 1];
      }
    } catch {
      /* garde la valeur brute */
    }
  }

  // "SN: XXXX" / "S/N XXXX" / "Serial=XXXX" au milieu d'un texte
  const m = s.match(/(?:S\/N|SN|SERIAL(?:\s*NUMBER)?|N°\s*SÉRIE|NO\.?\s*SERIE)\s*[:=#]?\s*([A-Z0-9][A-Z0-9\-_.]{3,})/i);
  if (m) s = m[1];

  return s.replace(/\s+/g, "").toUpperCase();
}

export { normalizeSerial };
