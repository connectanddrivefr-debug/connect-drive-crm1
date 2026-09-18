// Section "Rappels": visites techniques programmées/à programmer, demandes
// de rappel client, suivi des photos en attente, et installations
// programmées. Voir schema.prisma (TechnicalVisitStatus, PhotosStatus,
// InstallationStatus) et jobs/visitReminders.js + photoReminders.js +
// installationReminders.js pour les relances automatiques.
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
        { installationStatus: "PROGRAMMEE" },
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
    installationsProgrammees: leads.filter((l) => l.installationStatus === "PROGRAMMEE"),
  });
});

module.exports = router;
