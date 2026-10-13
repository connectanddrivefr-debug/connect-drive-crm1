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
//
// Note importante: contrairement aux visites techniques, aux demandes de
// rappel et aux photos (qui se passent avant la signature du devis),
// l'installation est programmée APRÈS que le lead soit passé en statut
// SIGNE. Il ne faut donc pas exclure les leads signés de cette catégorie,
// sous peine de ne plus jamais voir les installations programmées
// apparaître ici alors qu'elles sont bien visibles sur la carte du lead
// dans le pipeline (colonne "Signé").
router.get("/", async (req, res) => {
  const scope = {};
  if (req.user.role === "COMMERCIAL") {
    scope.assignedToId = req.user.id;
  }

  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      status: { notIn: ["PERDU"] },
      OR: [
        { status: { notIn: ["SIGNE"] }, technicalVisitStatus: { in: ["A_PROGRAMMER", "PROGRAMMEE"] } },
        { status: { notIn: ["SIGNE"] }, callbackRequested: true },
        { status: { notIn: ["SIGNE"] }, photosStatus: "EN_ATTENTE" },
        { installationStatus: "PROGRAMMEE" },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: { assignedTo: true },
  });

  res.json({
    visitesProgrammees: leads.filter((l) => l.status !== "SIGNE" && l.technicalVisitStatus === "PROGRAMMEE"),
    visitesAProgrammer: leads.filter((l) => l.status !== "SIGNE" && l.technicalVisitStatus === "A_PROGRAMMER"),
    // Triés par date de rappel prévue (les plus urgents d'abord), ceux sans date à la fin.
    clientsARappeler: leads
      .filter((l) => l.status !== "SIGNE" && l.callbackRequested)
      .sort((a, b) => {
        if (a.callbackDate && b.callbackDate) return new Date(a.callbackDate) - new Date(b.callbackDate);
        if (a.callbackDate) return -1;
        if (b.callbackDate) return 1;
        return 0;
      }),
    photosEnAttente: leads.filter((l) => l.status !== "SIGNE" && l.photosStatus === "EN_ATTENTE"),
    installationsProgrammees: leads.filter((l) => l.installationStatus === "PROGRAMMEE"),
  });
});

module.exports = router;
