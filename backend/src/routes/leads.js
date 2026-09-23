const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
} = require("../integrations/brevo");
const { sendMetaConversionEvent } = require("../integrations/metaConversions");

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ["NOUVEAU", "CONTACTE", "DEVIS_ENVOYE", "SIGNE", "PERDU"];

// GET /api/leads?status=&source=&q=
router.get("/", async (req, res) => {
  const { status, source, q, unassignedOnly } = req.query;
  const filters = [];
  if (status) filters.push({ status });
  if (source) filters.push({ source });
  // Phase 2: un commercial ne voit que ses propres leads assignés.
  // L'admin (Julien) voit tout, y compris les leads d'Angélique/Ilham.
  if (req.user.role === "COMMERCIAL") {
    filters.push({ assignedToId: req.user.id });
  }
  if (unassignedOnly === "true") {
    filters.push({ assignedToId: null });
  }
  if (q) {
    filters.push({
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { postalCode: { contains: q } },
      ],
    });
  }
  // Numéro de téléphone non vérifié (Twilio, simulateur connectndrive.fr
  // uniquement — voir schema.prisma): ces leads sont retirés du pipeline
  // normal et n'apparaissent que dans GET /api/leads/unverified, pour ne
  // pas mélanger les suspicions de spam avec les leads Webflow/Meta/manuels
  // qui restent, eux, toujours considérés comme vérifiés.
  filters.push({ NOT: { AND: [{ source: "SIMULATEUR" }, { phoneVerified: false }] } });

  const leads = await prisma.lead.findMany({
    where: { AND: filters },
    orderBy: { updatedAt: "desc" },
    include: { quotes: true, assignedTo: true },
  });
  res.json(leads);
});

// GET /api/leads/unverified — leads simulateur avec numéro de téléphone non
// vérifié par SMS (suspicion de spam), réservé à l'admin. Ces leads sont
// exclus du pipeline normal (voir GET /) mais restent consultables ici pour
// vérification manuelle (voir PATCH /:id avec { phoneVerified: true }).
// Un lead déclaré spam (statut PERDU, voir PATCH /:id/status) sort de cette
// liste — il reste tracé en base mais n'a plus besoin d'être traité.
router.get("/unverified", requireRole("ADMIN"), async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { source: "SIMULATEUR", phoneVerified: false, status: { not: "PERDU" } },
    orderBy: { createdAt: "desc" },
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
    "Prénom", "Nom", "Email", "Téléphone", "Téléphone vérifié", "Adresse", "Code postal", "Ville",
    "Source", "Provenance (détail)", "Client pro", "Statut", "Commercial assigné", "Montant devis", "Notes", "Créé le",
  ];
  const rows = leads.map((l) => [
    l.firstName, l.lastName, l.email, l.phone, l.phoneVerified ? "Oui" : "Non (suspicion de spam)",
    l.address, l.postalCode, l.city,
    l.source, l.sourceDetail || "", l.isProfessional ? "Oui" : "Non", l.status,
    l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : "",
    l.quotes[0] ? Number(l.quotes[0].amount) : "",
    l.notesText, l.createdAt.toISOString(),
  ]);

  const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="leads-connect-drive-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + csv); // BOM pour un affichage correct des accents dans Excel
});

// GET /api/leads/backfill-signed-at — à usage unique (admin uniquement):
// renseigne signedAt pour les leads déjà signés avant l'ajout du suivi par
// mois, à partir de la date du dernier passage en statut SIGNE dans
// l'historique. Sans effet sur les leads qui ont déjà une valeur.
router.get("/backfill-signed-at", requireRole("ADMIN"), async (req, res) => {
  const leads = await prisma.lead.findMany({
    where: { status: "SIGNE", signedAt: null },
    include: {
      statusHistory: { where: { toStatus: "SIGNE" }, orderBy: { changedAt: "desc" }, take: 1 },
    },
  });

  let updated = 0;
  for (const lead of leads) {
    const signedAt = lead.statusHistory[0]?.changedAt || lead.updatedAt;
    await prisma.lead.update({ where: { id: lead.id }, data: { signedAt } });
    updated += 1;
  }

  res.json({ ok: true, updated });
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
    source = "MANUEL", sourceDetail, isProfessional, notesText, assignedToId,
  } = req.body;

  if (!email) return res.status(400).json({ error: "Email requis" });

  const lead = await prisma.lead.create({
    data: {
      firstName, lastName, email, phone,
      address, postalCode, city,
      source, sourceDetail: sourceDetail || null, isProfessional: Boolean(isProfessional),
      notesText, assignedToId,
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

  try {
    await sendMetaConversionEvent("Lead", lead);
  } catch (err) {
    console.error("[MetaCAPI] échec envoi événement création lead:", err.message);
  }

  res.status(201).json(lead);
});

// PATCH /api/leads/:id  (édition des infos)
router.patch("/:id", async (req, res) => {
  const {
    firstName, lastName, email, phone, address, postalCode, city,
    sourceDetail, isProfessional, notesText, assignedToId,
    technicalVisitStatus, technicalVisitDate, technicalVisitSlots,
    callbackRequested, photosStatus,
    installationStatus, installationDate,
    phoneVerified,
  } = req.body;

  const before = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: "Lead introuvable" });

  // Une fois le lead signé, l'assignation est verrouillée (on ne change plus
  // le commercial qui a conclu la vente).
  if (before.status === "SIGNE" && assignedToId !== undefined && assignedToId !== before.assignedToId) {
    return res.status(400).json({ error: "Impossible de réassigner un lead déjà signé" });
  }

  const isNewAssignment = assignedToId !== undefined && assignedToId !== before?.assignedToId && assignedToId;

  // --- Section "Rappels": horodatage automatique sur les transitions ---
  const rappelData = {};
  if (technicalVisitStatus !== undefined) {
    rappelData.technicalVisitStatus = technicalVisitStatus;
  }
  if (technicalVisitDate !== undefined) {
    rappelData.technicalVisitDate = technicalVisitDate ? new Date(technicalVisitDate) : null;
    // Nouvelle date (ou date effacée) -> on autorise à nouveau le rappel J-2.
    if (technicalVisitDate !== before.technicalVisitDate?.toISOString()) {
      rappelData.technicalVisitReminderSentAt = null;
    }
  }
  if (technicalVisitSlots !== undefined) {
    rappelData.technicalVisitSlots = technicalVisitSlots || null;
  }
  if (callbackRequested !== undefined) {
    rappelData.callbackRequested = Boolean(callbackRequested);
    if (callbackRequested && !before.callbackRequested) {
      rappelData.callbackRequestedAt = new Date();
    }
    if (!callbackRequested) {
      rappelData.callbackRequestedAt = null;
    }
  }
  if (photosStatus !== undefined) {
    rappelData.photosStatus = photosStatus;
    if (photosStatus === "EN_ATTENTE" && before.photosStatus !== "EN_ATTENTE") {
      rappelData.photosRequestedAt = new Date();
      rappelData.photosReminderSentAt = null; // nouveau cycle de relance
    }
    if (photosStatus === "RECUES" || photosStatus === "NON_DEMANDEES") {
      rappelData.photosRequestedAt = photosStatus === "NON_DEMANDEES" ? null : before.photosRequestedAt;
      rappelData.photosReminderSentAt = null;
    }
  }
  if (installationStatus !== undefined) {
    rappelData.installationStatus = installationStatus;
  }
  if (installationDate !== undefined) {
    rappelData.installationDate = installationDate ? new Date(installationDate) : null;
    // Nouvelle date (ou date effacée) -> on autorise à nouveau le rappel J-2.
    if (installationDate !== before.installationDate?.toISOString()) {
      rappelData.installationReminderSentAt = null;
    }
  }
  // Vérification manuelle d'un numéro par l'admin depuis la section "Numéros
  // non vérifiés": fait ressortir le lead du côté du pipeline normal.
  if (phoneVerified !== undefined) {
    rappelData.phoneVerified = Boolean(phoneVerified);
    if (phoneVerified && !before.phoneVerifiedAt) {
      rappelData.phoneVerifiedAt = new Date();
    }
  }

  const lead = await prisma.lead.update({
    where: { id: req.params.id },
    data: {
      firstName, lastName, email, phone, address, postalCode, city,
      ...(sourceDetail !== undefined ? { sourceDetail: sourceDetail || null } : {}),
      ...(isProfessional !== undefined ? { isProfessional: Boolean(isProfessional) } : {}),
      notesText, assignedToId,
      ...rappelData,
    },
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

// DELETE /api/leads/:id  (suppression définitive — réservée à l'admin)
router.delete("/:id", requireRole("ADMIN"), async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } });
  if (!lead) return res.status(404).json({ error: "Lead introuvable" });

  await prisma.lead.delete({ where: { id: req.params.id } });
  res.status(204).send();
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
      // Horodatage du mois de signature (objectifs commerciaux, voir
      // section "Signé" du pipeline): posé à l'entrée dans SIGNE, effacé
      // si le lead en ressort (ex: erreur, réouverture du dossier).
      ...(status === "SIGNE" && current.status !== "SIGNE" ? { signedAt: new Date() } : {}),
      ...(status !== "SIGNE" && current.status === "SIGNE" ? { signedAt: null } : {}),
      statusHistory: {
        create: {
          fromStatus: current.status,
          toStatus: status,
          changedBy: req.user?.email || "system",
        },
      },
    },
    include: { assignedTo: true, quotes: { orderBy: { sentAt: "desc" } } },
  });

  // Automatisation "Bienvenue chez Connect & Drive — prochaines étapes"
  // désactivée sur demande: plus d'email envoyé automatiquement au passage
  // en statut SIGNE.

  // Signal le plus précieux pour Meta: un lead qui devient un vrai client.
  // On envoie la valeur réelle (devis accepté, sinon prix estimé du
  // simulateur) pour que l'algorithme optimise vers ce type de profil.
  if (status === "SIGNE" && current.status !== "SIGNE") {
    const acceptedQuote = lead.quotes.find((q) => q.status === "ACCEPTE") || lead.quotes[0];
    const value = acceptedQuote ? Number(acceptedQuote.amount) : (lead.estimatedPrice ? Number(lead.estimatedPrice) : undefined);
    try {
      await sendMetaConversionEvent("Purchase", lead, value ? { value, currency: "EUR" } : {});
    } catch (err) {
      console.error("[MetaCAPI] échec envoi événement signature:", err.message);
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
