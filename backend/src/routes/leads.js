const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
} = require("../integrations/brevo");

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ["NOUVEAU", "CONTACTE", "DEVIS_ENVOYE", "SIGNE", "PERDU"];

// GET /api/leads?status=&source=&q=
router.get("/", async (req, res) => {
  const { status, source, q, unassignedOnly } = req.query;
  const where = {};
  if (status) where.status = status;
  if (source) where.source = source;
  // Phase 2: un commercial ne voit que ses propres leads assignés.
  // L'admin (Julien) voit tout, y compris les leads d'Angélique/Ilham.
  if (req.user.role === "COMMERCIAL") {
    where.assignedToId = req.user.id;
  }
  if (unassignedOnly === "true") {
    where.assignedToId = null;
  }
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { postalCode: { contains: q } },
    ];
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { quotes: true, assignedTo: true },
  });
  res.json(leads);
});

// GET /api/leads/export/csv — export complet (admin uniquement)
router.get("/export/csv", requireRole("ADMIN"), async (req, res) => {
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "desc" },
    include: { quotes: true, assignedTo: true },
  });

  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const header = [
    "Prénom", "Nom", "Email", "Téléphone", "Adresse", "Code postal", "Ville",
    "Source", "Statut", "Commercial assigné", "Montant devis", "Notes", "Créé le",
  ];
  const rows = leads.map((l) => [
    l.firstName, l.lastName, l.email, l.phone, l.address, l.postalCode, l.city,
    l.source, l.status,
    l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : "",
    l.quotes[0] ? Number(l.quotes[0].amount) : "",
    l.notesText, l.createdAt.toISOString(),
  ]);

  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-connect-drive-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + csv); // BOM pour un affichage correct des accents dans Excel
});

// GET /api/leads/:id (fiche contact complète)
router.get("/:id", async (req, res) => {
  const lead = await prisma.lead.findUnique({
    where: { id: req.params.id },
    include: {
      statusHistory: { orderBy: { changedAt: "asc" } },
      quotes: { orderBy: { sentAt: "desc" } },
      emailLogs: { orderBy: { sentAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      calls: { orderBy: { callAt: "desc" } },
      assignedTo: true,
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead introuvable" });
  res.json(lead);
});

// POST /api/leads  (création manuelle, ou appelée par les intégrations Webflow/Meta)
router.post("/", async (req, res) => {
  const {
    firstName, lastName, email, phone,
    address, postalCode, city,
    source = "MANUEL", notesText, assignedToId,
  } = req.body;

  if (!email) return res.status(400).json({ error: "Email requis" });

  const lead = await prisma.lead.create({
    data: {
      firstName, lastName, email, phone,
      address, postalCode, city,
      source, notesText, assignedToId,
      status: "NOUVEAU",
      statusHistory: {
        create: { toStatus: "NOUVEAU", changedBy: req.user?.email || "system" },
      },
    },
    include: { assignedTo: true },
  });

  // Automatisations Brevo déclenchées à la création (§5 cahier des charges)
  // Si un commercial est assigné, l'email de confirmation est personnalisé
  // à son nom (voir integrations/brevo.js).
  try {
    await sendLeadConfirmation(lead, lead.assignedTo);
    await sendInternalNewLeadNotif(lead, lead.assignedTo);
  } catch (err) {
    console.error("[Brevo] échec envoi email création lead:", err.message);
  }

  res.status(201).json(lead);
});

// PATCH /api/leads/:id  (édition des infos)
router.patch("/:id", async (req, res) => {
  const { firstName, lastName, email, phone, address, postalCode, city, notesText, assignedToId } = req.body;

  const before = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Lead introuvable" });

  // Une fois le lead signé, l'assignation est verrouillée (on ne change plus
  // le commercial qui a conclu la vente).
  if (before.status === "SIGNE" && assignedToId !== undefined && assignedToId !== before.assignedToId) {
    return res.status(400).json({ error: "Impossible de réassigner un lead déjà signé" });
  }

  const isNewAssignment = assignedToId !== undefined && assignedToId !== before?.assignedToId && assignedToId;

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: { firstName, lastName, email, phone, address, postalCode, city, notesText, assignedToId },
    include: { assignedTo: true },
  });

  // Quand un lead est assigné (ou réassigné) à un commercial, il reçoit un
  // email de prise en charge personnalisé, envoyé depuis l'adresse du commercial.
  if (isNewAssignment && lead.email) {
    try {
      await sendLeadConfirmation(lead, lead.assignedTo);
    } catch (err) {
      console.error("[Brevo] échec envoi email assignation:", err.message);
    }
  }

  res.json(lead);
});

// PATCH /api/leads/:id/status  (déplacement dans le pipeline kanban)
router.patch("/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Statut invalide. Valeurs possibles: ${VALID_STATUSES.join(", ")}` });
  }

  const current = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Lead introuvable" });

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      status,
      statusHistory: {
        create: {
          fromStatus: current.status,
          toStatus: status,
          changedBy: req.user?.email || "system",
        },
      },
    },
    include: { assignedTo: true },
  });

  // Automatisation "Bienvenue chez Connect & Drive — prochaines étapes"
  // désactivée sur demande: plus d'email envoyé automatiquement au passage
  // en statut SIGNE.

  res.json(lead);
});

// POST /api/leads/:id/notes
router.post("/:id/notes", async (req, res) => {
  const note = await prisma.note.create({
    data: {
      leadId: req.params.id,
      content: req.body.content,
      authorId: req.user?.id,
    },
  });
  res.status(201).json(note);
});

// POST /api/leads/:id/calls
router.post("/:id/calls", async (req, res) => {
  const call = await prisma.callLog.create({
    data: {
      leadId: req.params.id,
      summary: req.body.summary,
      userId: req.user?.id,
    },
  });
  res.status(201).json(call);
});

module.exports = router;
