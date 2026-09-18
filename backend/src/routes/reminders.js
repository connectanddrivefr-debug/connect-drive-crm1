// Section "Rappels": visites techniques programmées/à programmer, demandes
// de rappel client, et suivi des photos en attente. Voir schema.prisma
// (TechnicalVisitStatus, PhotosStatus) et jobs/visitReminders.js + photoReminders.js
// pour les relances automatiques.
const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/reminders — même scoping par rôle que GET /api/leads: un
// commercial ne voit que ses propres leads assignés, l'admin voit tout.
router.get("/", async (req, res) => {
  const where = { status: { notIn: ["SIGNE", "PERDU"] } };
  if (req.user.role === "COMMERCIAL") {
    where.assignedToId = req.user.id;
  }

  const leads = await prisma.lead.findMany({
    where: {
      ...where,
      OR: [
        { technicalVisitStatus: { in: ["A_PROGRAMMER", "PROGRAMMEE"] } },
        { callbackRequested: true },
        { photosStatus: "EN_ATTENTE" },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: { assignedTo: true },
  });

  res.json({
    visitesProgrammees: leads.filter((l) => l.technicalVisitStatus === "PROGRAMMEE"),
    visitesAProgrammer: leads.filter((l) => l.technicalVisitStatus === "A_PROGRAMMER"),
    clientsARappeler: leads.filter((l) => l.callbackRequested),
    photosEnAttente: leads.filter((l) => l.photosStatus === "EN_ATTENTE"),
  });
});

module.exports = router;
