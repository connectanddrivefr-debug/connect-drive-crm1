// Gestion de stock des bornes — suivi par numéro de série.
// Réception au dépôt -> remise à un technicien -> installation chez le client.
// Accès: ADMIN (Julien) et LOGISTIQUE (Fatima) uniquement. Les techniciens
// n'ont pas accès au CRM: ils n'existent que comme fiches (modèle Technician).
const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { normalizeSerial } = require("../lib/serial");

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("ADMIN", "LOGISTIQUE"));

// Au-delà de ce délai, une borne détenue par un technicien sans être
// installée remonte en alerte (risque de perte / vol).
const HELD_ALERT_DAYS = Number(process.env.STOCK_HELD_ALERT_DAYS || 30);

const leadSelect = { id: true, firstName: true, lastName: true, city: true, company: true };
const techSelect = { id: true, firstName: true, lastName: true };

function cleanSerials(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = normalizeSerial(raw);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Techniciens (fiches simples, sans compte CRM)
// ---------------------------------------------------------------------------
router.get("/technicians", async (req, res) => {
  const technicians = await prisma.technician.findMany({
    orderBy: [{ active: "desc" }, { firstName: "asc" }],
    include: { _count: { select: { chargers: { where: { status: "CHEZ_TECHNICIEN" } } } } },
  });
  res.json(technicians);
});

router.post("/technicians", async (req, res) => {
  const { firstName, lastName, phone, kraaftUserId } = req.body || {};
  if (!firstName || !String(firstName).trim()) {
    return res.status(400).json({ error: "Le prénom du technicien est requis" });
  }
  const tech = await prisma.technician.create({
    data: {
      firstName: String(firstName).trim(),
      lastName: lastName ? String(lastName).trim() : null,
      phone: phone ? String(phone).trim() : null,
      kraaftUserId: kraaftUserId ? String(kraaftUserId).trim() : null,
    },
  });
  res.status(201).json(tech);
});

router.patch("/technicians/:id", async (req, res) => {
  const data = {};
  for (const k of ["firstName", "lastName", "phone", "kraaftUserId"]) {
    if (k in (req.body || {})) data[k] = req.body[k] ? String(req.body[k]).trim() : null;
  }
  if ("active" in (req.body || {})) data.active = Boolean(req.body.active);
  if (data.firstName === null) return res.status(400).json({ error: "Le prénom ne peut pas être vide" });
  try {
    const tech = await prisma.technician.update({ where: { id: req.params.id }, data });
    res.json(tech);
  } catch {
    res.status(404).json({ error: "Technicien introuvable" });
  }
});

// GET /api/stock/clients?q= — recherche minimale de clients pour rattacher
// une borne installée (nom, entreprise, ville uniquement: le compte
// LOGISTIQUE n'a pas accès aux fiches leads complètes).
router.get("/clients", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json([]);
  const leads = await prisma.lead.findMany({
    where: {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { postalCode: { contains: q } },
      ],
    },
    select: leadSelect,
    orderBy: { updatedAt: "desc" },
    take: 8,
  });
  res.json(leads);
});

// ---------------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------------
router.get("/summary", async (req, res) => {
  const [byModelStatus, heldChargers, technicians, recentReceptions] = await Promise.all([
    prisma.charger.groupBy({ by: ["model", "status"], _count: { _all: true } }),
    prisma.charger.findMany({
      where: { status: "CHEZ_TECHNICIEN" },
      include: { technician: { select: techSelect } },
      orderBy: { assignedAt: "asc" },
    }),
    prisma.technician.findMany({ where: { active: true }, select: techSelect, orderBy: { firstName: "asc" } }),
    prisma.stockReception.findMany({
      orderBy: { receivedAt: "desc" },
      take: 10,
      include: {
        receivedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { chargers: true } },
      },
    }),
  ]);

  // Tableau modèle x statut
  const models = {};
  const totals = { EN_STOCK: 0, CHEZ_TECHNICIEN: 0, INSTALLEE: 0, RETOUR_SAV: 0 };
  for (const row of byModelStatus) {
    models[row.model] = models[row.model] || { model: row.model, EN_STOCK: 0, CHEZ_TECHNICIEN: 0, INSTALLEE: 0, RETOUR_SAV: 0 };
    models[row.model][row.status] = row._count._all;
    totals[row.status] += row._count._all;
  }

  // Bornes détenues par technicien
  const now = Date.now();
  const byTech = {};
  for (const t of technicians) byTech[t.id] = { technician: t, chargers: [] };
  for (const c of heldChargers) {
    if (!c.technicianId) continue;
    byTech[c.technicianId] = byTech[c.technicianId] || { technician: c.technician, chargers: [] };
    const days = c.assignedAt ? Math.floor((now - new Date(c.assignedAt).getTime()) / 86400000) : null;
    byTech[c.technicianId].chargers.push({
      id: c.id,
      serialNumber: c.serialNumber,
      model: c.model,
      assignedAt: c.assignedAt,
      days,
      overdue: days !== null && days >= HELD_ALERT_DAYS,
    });
  }

  res.json({
    totals,
    models: Object.values(models).sort((a, b) => a.model.localeCompare(b.model)),
    technicians: Object.values(byTech),
    alertDays: HELD_ALERT_DAYS,
    recentReceptions,
  });
});

// ---------------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------------
// GET /api/stock/chargers?status=&technicianId=&q=
router.get("/chargers", async (req, res) => {
  const { status, technicianId, q } = req.query;
  const where = {};
  if (status) where.status = status;
  if (technicianId) where.technicianId = technicianId;
  if (q) {
    const term = String(q).trim();
    where.OR = [
      { serialNumber: { contains: normalizeSerial(term) || term, mode: "insensitive" } },
      { model: { contains: term, mode: "insensitive" } },
      { lead: { lastName: { contains: term, mode: "insensitive" } } },
      { lead: { firstName: { contains: term, mode: "insensitive" } } },
      { lead: { company: { contains: term, mode: "insensitive" } } },
    ];
  }
  const chargers = await prisma.charger.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 300,
    include: {
      technician: { select: techSelect },
      lead: { select: leadSelect },
      reception: { select: { id: true, supplier: true, blNumber: true, receivedAt: true } },
    },
  });
  res.json(chargers);
});

// GET /api/stock/lookup?serial= — vérification instantanée pendant un scan
router.get("/lookup", async (req, res) => {
  const serial = normalizeSerial(req.query.serial);
  if (!serial) return res.status(400).json({ error: "Numéro de série manquant" });
  const charger = await prisma.charger.findUnique({
    where: { serialNumber: serial },
    include: { technician: { select: techSelect }, lead: { select: leadSelect } },
  });
  res.json({ serialNumber: serial, charger });
});

// GET /api/stock/chargers/:id — fiche borne + historique complet
router.get("/chargers/:id", async (req, res) => {
  const charger = await prisma.charger.findUnique({
    where: { id: req.params.id },
    include: {
      technician: { select: techSelect },
      lead: { select: leadSelect },
      reception: { include: { receivedBy: { select: { firstName: true, lastName: true } } } },
      movements: {
        orderBy: { createdAt: "desc" },
        include: {
          technician: { select: techSelect },
          lead: { select: leadSelect },
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!charger) return res.status(404).json({ error: "Borne introuvable" });
  res.json(charger);
});

// PATCH /api/stock/chargers/:id — correction (modèle, numéro, notes) ou retour SAV
router.patch("/chargers/:id", async (req, res) => {
  const existing = await prisma.charger.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Borne introuvable" });

  const data = {};
  const changes = [];
  if (req.body.model && req.body.model !== existing.model) {
    data.model = String(req.body.model).trim();
    changes.push(`modèle: ${existing.model} → ${data.model}`);
  }
  if (req.body.serialNumber) {
    const s = normalizeSerial(req.body.serialNumber);
    if (s && s !== existing.serialNumber) {
      const dup = await prisma.charger.findUnique({ where: { serialNumber: s } });
      if (dup) return res.status(409).json({ error: "Ce numéro de série existe déjà" });
      data.serialNumber = s;
      changes.push(`n° série: ${existing.serialNumber} → ${s}`);
    }
  }
  if ("notes" in req.body) data.notes = req.body.notes || null;

  let movementType = changes.length ? "CORRECTION" : null;
  if (req.body.status === "RETOUR_SAV" && existing.status !== "RETOUR_SAV") {
    data.status = "RETOUR_SAV";
    data.technicianId = null;
    data.assignedAt = null;
    movementType = "RETOUR_SAV";
  }

  const charger = await prisma.$transaction(async (tx) => {
    const updated = await tx.charger.update({ where: { id: existing.id }, data });
    if (movementType) {
      await tx.stockMovement.create({
        data: {
          chargerId: existing.id,
          type: movementType,
          userId: req.user.id,
          source: "CRM",
          notes: [changes.join(", "), req.body.movementNote].filter(Boolean).join(" — ") || null,
        },
      });
    }
    return updated;
  });
  res.json(charger);
});

// POST /api/stock/chargers/:id/install { leadId, technicianId? }
// Rattachement manuel à un client (en attendant l'intégration Kraaft).
router.post("/chargers/:id/install", async (req, res) => {
  const { leadId, notes } = req.body || {};
  const charger = await prisma.charger.findUnique({ where: { id: req.params.id } });
  if (!charger) return res.status(404).json({ error: "Borne introuvable" });
  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
  if (!lead) return res.status(400).json({ error: "Client introuvable" });
  const technicianId = req.body.technicianId || charger.technicianId || null;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.charger.update({
      where: { id: charger.id },
      data: { status: "INSTALLEE", leadId: lead.id, technicianId, installedAt: new Date() },
    });
    await tx.stockMovement.create({
      data: {
        chargerId: charger.id,
        type: "INSTALLATION",
        leadId: lead.id,
        technicianId,
        userId: req.user.id,
        source: "CRM",
        notes: notes || null,
      },
    });
    return u;
  });
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Réception au dépôt
// ---------------------------------------------------------------------------
// POST /api/stock/receptions { supplier, blNumber?, notes?, items: [{ serialNumber, model }] }
router.post("/receptions", async (req, res) => {
  const { supplier, blNumber, notes, items } = req.body || {};
  if (!supplier || !String(supplier).trim()) return res.status(400).json({ error: "Fournisseur requis" });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Aucune borne scannée" });

  const seen = new Set();
  const clean = [];
  for (const it of items) {
    const serialNumber = normalizeSerial(it && it.serialNumber);
    const model = it && it.model ? String(it.model).trim() : "";
    if (!serialNumber || seen.has(serialNumber)) continue;
    if (!model) return res.status(400).json({ error: `Modèle manquant pour ${serialNumber}` });
    seen.add(serialNumber);
    clean.push({ serialNumber, model });
  }

  const existing = await prisma.charger.findMany({
    where: { serialNumber: { in: clean.map((c) => c.serialNumber) } },
    select: { serialNumber: true, status: true },
  });
  if (existing.length) {
    return res.status(409).json({
      error: `${existing.length} borne(s) déjà enregistrée(s) dans le stock`,
      duplicates: existing.map((e) => e.serialNumber),
    });
  }

  const reception = await prisma.$transaction(async (tx) => {
    const r = await tx.stockReception.create({
      data: {
        supplier: String(supplier).trim(),
        blNumber: blNumber ? String(blNumber).trim() : null,
        notes: notes || null,
        receivedById: req.user.id,
      },
    });
    for (const c of clean) {
      const charger = await tx.charger.create({
        data: { serialNumber: c.serialNumber, model: c.model, status: "EN_STOCK", receptionId: r.id },
      });
      await tx.stockMovement.create({
        data: {
          chargerId: charger.id,
          type: "RECEPTION",
          userId: req.user.id,
          source: "CRM",
          notes: blNumber ? `BL ${String(blNumber).trim()}` : null,
        },
      });
    }
    return r;
  }, { timeout: 30000 });

  res.status(201).json({ reception, count: clean.length });
});

router.get("/receptions/:id", async (req, res) => {
  const reception = await prisma.stockReception.findUnique({
    where: { id: req.params.id },
    include: {
      receivedBy: { select: { firstName: true, lastName: true } },
      chargers: { include: { technician: { select: techSelect }, lead: { select: leadSelect } }, orderBy: { serialNumber: "asc" } },
    },
  });
  if (!reception) return res.status(404).json({ error: "Réception introuvable" });
  res.json(reception);
});

// ---------------------------------------------------------------------------
// Remise à un technicien / retour au dépôt
// ---------------------------------------------------------------------------
// POST /api/stock/dotations { technicianId, serials: [] }
// Accepte les bornes au dépôt, ou déjà chez un autre technicien (transfert).
router.post("/dotations", async (req, res) => {
  const { technicianId } = req.body || {};
  const serials = cleanSerials(req.body && req.body.serials);
  const tech = technicianId ? await prisma.technician.findUnique({ where: { id: technicianId } }) : null;
  if (!tech) return res.status(400).json({ error: "Technicien introuvable" });
  if (!serials.length) return res.status(400).json({ error: "Aucune borne scannée" });

  const chargers = await prisma.charger.findMany({ where: { serialNumber: { in: serials } } });
  const bySerial = Object.fromEntries(chargers.map((c) => [c.serialNumber, c]));
  const errors = [];
  for (const s of serials) {
    const c = bySerial[s];
    if (!c) errors.push({ serialNumber: s, error: "Inconnue du stock (réception non scannée)" });
    else if (c.status === "INSTALLEE") errors.push({ serialNumber: s, error: "Déjà installée chez un client" });
    else if (c.status === "RETOUR_SAV") errors.push({ serialNumber: s, error: "Marquée en retour SAV" });
  }
  if (errors.length) return res.status(409).json({ error: "Certaines bornes ne peuvent pas être remises", errors });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const s of serials) {
      const c = bySerial[s];
      await tx.charger.update({
        where: { id: c.id },
        data: { status: "CHEZ_TECHNICIEN", technicianId: tech.id, assignedAt: now },
      });
      await tx.stockMovement.create({
        data: {
          chargerId: c.id,
          type: "DOTATION",
          technicianId: tech.id,
          userId: req.user.id,
          source: "CRM",
          notes: c.status === "CHEZ_TECHNICIEN" && c.technicianId && c.technicianId !== tech.id ? "Transfert depuis un autre technicien" : null,
        },
      });
    }
  }, { timeout: 30000 });

  res.status(201).json({ count: serials.length, technician: tech });
});

// POST /api/stock/returns { serials: [] } — retour au dépôt
router.post("/returns", async (req, res) => {
  const serials = cleanSerials(req.body && req.body.serials);
  if (!serials.length) return res.status(400).json({ error: "Aucune borne scannée" });
  const chargers = await prisma.charger.findMany({ where: { serialNumber: { in: serials } } });
  const bySerial = Object.fromEntries(chargers.map((c) => [c.serialNumber, c]));
  const errors = serials
    .filter((s) => !bySerial[s] || bySerial[s].status !== "CHEZ_TECHNICIEN")
    .map((s) => ({ serialNumber: s, error: bySerial[s] ? "Pas chez un technicien" : "Inconnue du stock" }));
  if (errors.length) return res.status(409).json({ error: "Certaines bornes ne peuvent pas revenir au dépôt", errors });

  await prisma.$transaction(async (tx) => {
    for (const s of serials) {
      const c = bySerial[s];
      await tx.charger.update({ where: { id: c.id }, data: { status: "EN_STOCK", technicianId: null, assignedAt: null } });
      await tx.stockMovement.create({
        data: { chargerId: c.id, type: "RETOUR_DEPOT", technicianId: c.technicianId, userId: req.user.id, source: "CRM" },
      });
    }
  }, { timeout: 30000 });
  res.json({ count: serials.length });
});

module.exports = router;
