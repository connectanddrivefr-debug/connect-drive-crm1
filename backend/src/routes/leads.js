const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");
const {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
  sendSignatureConfirmation,
} = require("../integrations/brevo");

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ["NOUVEAU", "CONTACTE", "DEVIS_ENVOYE", "SIGNE", "PERDU"];

// GET /api/leads?status=&source=&q=
router.get("/", async (req, res) => {
  const { status, source, q } = req.query;
  const where = {};
  if (status) where.status = status;
  if (source) where.source = source;
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
    source = "MANUEL", notesText,
  } = req.body;

  if (!email) return res.status(400).json({ error: "Email requis" });

  const lead = await prisma.lead.create({
    data: {
      firstName, lastName, email, phone,
      address, postalCode, city,
      source, notesText,
      status: "NOUVEAU",
      statusHistory: {
        create: { toStatus: "NOUVEAU", changedBy: req.user?.email || "system" },
      },
    },
  });

  // Automatisations Brevo déclenchées à la création (§5 cahier des charges)
  try {
    await sendLeadConfirmation(lead);
    await sendInternalNewLeadNotif(lead);
  } catch (err) {
    console.error("[Brevo] échec envoi email création lead:", err.message);
  }

  res.status(201).json(lead);
});

// PATCH /api/leads/:id  (édition des infos)
router.patch("/:id", async (req, res) => {
  const { firstName, lastName, email, phone, address, postalCode, city, notesText, assignedToId } = req.body;
  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: { firstName, lastName, email, phone, address, postalCode, city, notesText, assignedToId },
  });
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
  });

  // Automatisation: lead signé -> email de confirmation + prochaines étapes
  if (status === "SIGNE") {
    try {
      await sendSignatureConfirmation(lead);
    } catch (err) {
      console.error("[Brevo] échec envoi email signature:", err.message);
    }
  }

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
