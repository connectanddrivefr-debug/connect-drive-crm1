// Catalogue officiel des références V2C (export GS1 CodeOnline « Mes produits »,
// 17/07/2026) : code-barres EAN imprimé sur l'étiquette du carton -> produit.
// Chargé automatiquement dans ProductRef, pour qu'aucune référence n'ait à être
// tapée à la main lors d'une réception.
// [EAN, libellé, code article V2C (MPN, pour mémoire)]
const V2C_PRODUCTS = [
  // Trydan
  ["3770038367013", "V2C Trydan 7,4 kW mono – prise T2S", "9901500050"],
  ["3770038367006", "V2C Trydan 7,4 kW mono – câble 5 m", "9901500000"],
  ["3770038367143", "V2C Trydan 7,4 kW mono – câble 10 m", "9901500210"],
  ["3770038367198", "V2C Trydan 7,4 kW mono – câble 5 m, protections intégrées", "9911500010"],
  ["3770038367204", "V2C Trydan 7,4 kW mono – câble 10 m, protections intégrées", "9911500221"],
  ["3770038367037", "V2C Trydan 22 kW tri – prise T2S", "9901500060"],
  ["3770038367020", "V2C Trydan 22 kW tri – câble 5 m", "9901500025"],
  ["3770038367150", "V2C Trydan 22 kW tri – câble 10 m", "9901500125"],
  // Trydan PRO
  ["3770038367051", "V2C Trydan PRO 7,4 kW mono – prise T2S", "9901500355"],
  ["3770038367044", "V2C Trydan PRO 7,4 kW mono – câble 5 m", "9901500300"],
  ["3770038367174", "V2C Trydan PRO 7,4 kW mono – câble 10 m", "9901000310"],
  ["3770038367211", "V2C Trydan PRO 7,4 kW mono – câble 5 m, protections intégrées", "9911500320"],
  ["3770038367228", "V2C Trydan PRO 7,4 kW mono – câble 10 m, protections intégrées", "9911500321"],
  ["3770038367075", "V2C Trydan PRO 22 kW tri – prise T2S", "9901500365"],
  ["3770038367068", "V2C Trydan PRO 22 kW tri – câble 5 m", "9901500335"],
  ["3770038367181", "V2C Trydan PRO 22 kW tri – câble 10 m", "9901500435"],
  // Trydan PRO MID
  ["3770038367082", "V2C Trydan PRO MID 7,4 kW mono – câble 5 m", "9931500305"],
  ["3770038367280", "V2C Trydan PRO MID 7,4 kW mono – câble 10 m", "9931500315"],
  ["3770038367099", "V2C Trydan PRO MID 22 kW tri – câble 5 m", "9931500340"],
  ["3770038367297", "V2C Trydan PRO MID 22 kW tri – câble 10 m", "9931500445"],
  // Pole PRO
  ["3770038367259", "V2C Pole PRO 7,4 kW murale", null],
  ["3770038367242", "V2C Pole PRO 7,4 kW sur pied", null],
  ["3770038367136", "V2C Pole PRO 22 kW murale", null],
  ["3770038367129", "V2C Pole PRO 22 kW sur pied", null],
  // Alva
  ["3770038367372", "V2C Alva mono – 2 prises", "108900505000"],
  ["3770038367389", "V2C Alva mono – 2 câbles 5 m", "108900505005"],
  ["3770038367396", "V2C Alva mono – 2 câbles 10 m", "108900505010"],
  ["3770038367433", "V2C Alva mono – 2 prises, protections et MID", "108900505200"],
  ["3770038367440", "V2C Alva mono – 2 câbles 5 m, protections et MID", "108900505205"],
  ["3770038367457", "V2C Alva mono – 2 câbles 10 m, protections et MID", "108900505210"],
  ["3770038367402", "V2C Alva tri – 2 prises", "108900505025"],
  ["3770038367419", "V2C Alva tri – 2 câbles 5 m", "108900505030"],
  ["3770038367426", "V2C Alva tri – 2 câbles 10 m", null], // MPN en doublon dans le fichier GS1
  ["3770038367488", "V2C Alva tri – 2 prises, protections et MID", null], // idem
  ["3770038367464", "V2C Alva tri – 2 câbles 5 m, protections et MID", "108900505220"],
  ["3770038367471", "V2C Alva tri – 2 câbles 10 m, protections et MID", "108900505225"],
  // Denka (DC)
  ["3770038367266", "V2C Denka 20 kW DC", null],
  ["3770038367273", "V2C Denka 40 kW DC", null],
  // Accessoires
  ["3770038367310", "V2C Piédestal simple", "108900500116"],
  ["3770038367327", "V2C Piédestal double", "108900500117"],
  ["3770038367358", "V2C Piédestal Denka", "108900525100"],
  ["3770038367334", "V2C Abri métallique de protection", "108900500130"],
  ["3770038367341", "V2C Support enrouleur de câble", "108900500110"],
  ["3770038367365", "V2C Linky LoRa", "108900500205"],
  ["3770038367303", "V2C Détecteur de fuite de courant DC 6 mA", null],
  ["3770038367105", "V2C Pince ampèremétrique CDP 100 A (solaire)", null],
  ["3770038367112", "V2C Carte RFID", null],
];

// Codes référence V2C lus dans le QR code de l'étiquette ("S/N;RÉFÉRENCE"),
// confirmés sur des étiquettes réelles. Les autres sont appris tout seuls dès
// qu'une étiquette est lue avec son code-barres produit.
// (étiquette RA9563, BL V2C/SAL/39181 du 28/09/2026)
const V2C_REF_CODES = {
  "3770038367013": "TRY32-1-SO-F", // Trydan mono prise
  "3770038367006": "TRY32-1-OL5-F", // Trydan mono câble 5 m
  "3770038367020": "TRY32-3-OL5-F", // Trydan tri câble 5 m
  "3770038367051": "TRYPRO32-1-SO-F", // Trydan PRO mono prise
  "3770038367075": "TRYPRO32-3-SO-F", // Trydan PRO tri prise
};

let syncPromise = null;

// Charge le catalogue dans ProductRef (une fois par instance du serveur).
// Le libellé officiel remplace les noms provisoires (« V2C réf. 3770… » ou
// tapés à la main) et est reporté sur les bornes déjà en stock.
async function syncCatalog(prisma) {
  const eans = V2C_PRODUCTS.map((p) => p[0]);
  const codes = Object.values(V2C_REF_CODES);
  const existing = await prisma.productRef.findMany({ where: { OR: [{ ean: { in: eans } }, { reference: { in: codes } }] } });
  const byEan = new Map(existing.filter((r) => r.ean).map((r) => [r.ean, r]));
  const byCode = new Map(existing.filter((r) => r.reference).map((r) => [r.reference, r]));
  for (const [ean, label] of V2C_PRODUCTS) {
    const code = V2C_REF_CODES[ean] || null;
    let ref = byEan.get(ean);
    const codeRef = code ? byCode.get(code) : null;
    if (!ref && codeRef && !codeRef.ean) {
      ref = await prisma.productRef.update({ where: { id: codeRef.id }, data: { ean, label, supplier: "V2C" } });
    } else if (!ref) {
      ref = await prisma.productRef.create({ data: { ean, label, supplier: "V2C", reference: codeRef ? null : code } });
    } else if (ref.label !== label || (code && !ref.reference && !codeRef)) {
      ref = await prisma.productRef.update({
        where: { id: ref.id },
        data: { label, supplier: ref.supplier || "V2C", ...(code && !ref.reference && !codeRef ? { reference: code } : {}) },
      });
    }
    if (ref.reference) byCode.set(ref.reference, ref);
  }
  // Bornes déjà en stock: libellé officiel, et EAN retrouvé depuis le code référence
  const labels = new Map(V2C_PRODUCTS.map(([ean, label]) => [ean, label]));
  const codeToEan = new Map(Object.entries(V2C_REF_CODES).map(([ean, code]) => [code, ean]));
  const stale = await prisma.charger.findMany({
    where: { OR: [{ ean: { in: eans } }, { ean: null, reference: { in: [...new Set([...byCode.keys(), ...codeToEan.keys()])] } }] },
    select: { id: true, ean: true, reference: true, model: true },
  });
  for (const c of stale) {
    const ean = c.ean || codeToEan.get(c.reference) || (byCode.get(c.reference) || {}).ean;
    const label = labels.get(ean);
    if (ean && label && (c.ean !== ean || c.model !== label)) {
      await prisma.charger.update({ where: { id: c.id }, data: { ean, model: label } });
    }
  }
  await repairQrSerials(prisma);
}

// Anciennes réceptions: le QR code V2C "RA9563;TRY32-1-SO-F" était enregistré
// tel quel comme numéro de série. On le ramène à "RA9563" et on garde la
// référence lue.
async function repairQrSerials(prisma) {
  const bad = await prisma.charger.findMany({ where: { serialNumber: { contains: ";" } } });
  for (const c of bad) {
    const [sn, code] = c.serialNumber.split(";").map((p) => p.trim().toUpperCase());
    if (!sn) continue;
    const ref = code ? await prisma.productRef.findUnique({ where: { reference: code } }) : null;
    const clash = await prisma.charger.findUnique({ where: { serialNumber: sn } });
    if (clash) {
      console.warn(`[Stock] Doublon à vérifier: ${c.serialNumber} et ${sn}`);
      continue;
    }
    await prisma.charger.update({
      where: { id: c.id },
      data: {
        serialNumber: sn,
        reference: c.reference || code || null,
        ...(ref && !c.ean ? { ean: ref.ean, model: ref.label } : {}),
      },
    });
  }
}

function ensureCatalog(prisma) {
  if (!syncPromise) {
    syncPromise = syncCatalog(prisma).catch((err) => {
      console.error("[Stock] Chargement du catalogue V2C impossible:", err.message);
      syncPromise = null;
    });
  }
  return syncPromise;
}

module.exports = { V2C_PRODUCTS, V2C_REF_CODES, ensureCatalog };
