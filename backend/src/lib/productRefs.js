// Références produit des bornes (EAN du carton / code fabricant -> libellé).
// Le catalogue s'enrichit tout seul: une référence inconnue est créée avec le
// libellé fourni (ou son code), puis renommable depuis la page Stock.
function cleanEan(v) {
  const s = v ? String(v).replace(/\D/g, "") : "";
  return /^\d{8,14}$/.test(s) ? s : null;
}

function cleanRef(v) {
  const s = v ? String(v).trim().toUpperCase().replace(/\s+/g, "") : "";
  return s || null;
}

// Trouve ou crée la référence; renvoie { ean, reference, label } ou null.
async function ensureRef(db, { ean, reference, label, supplier }) {
  ean = cleanEan(ean);
  reference = cleanRef(reference);
  if (!ean && !reference) return null;
  let ref =
    (ean && (await db.productRef.findUnique({ where: { ean } }))) ||
    (reference && (await db.productRef.findUnique({ where: { reference } }))) ||
    null;
  if (ref) {
    const data = {};
    if (ean && !ref.ean) data.ean = ean;
    if (reference && !ref.reference) data.reference = reference;
    if (Object.keys(data).length) {
      ref = await db.productRef.update({ where: { id: ref.id }, data }).catch(() => ref);
    }
    return ref;
  }
  const fallback = [supplier, reference || `réf. ${ean}`].filter(Boolean).join(" ");
  return db.productRef.create({
    data: { ean, reference, label: (label && String(label).trim()) || fallback, supplier: supplier || null },
  });
}

module.exports = { ensureRef, cleanEan, cleanRef };
