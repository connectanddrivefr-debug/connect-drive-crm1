const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// POST /api/quotes  { leadId, product, amount }
// Créer un devis fait automatiquement passer le lead au statut DEVIS_ENVOYE
router.post("/", async (req, res) => {
  const { leadId, product, amount } = req.body;
  if (!leadId || !product || amount == null) {
    return res.status(400).json({ error: "leadId, product et amount sont requis" });
  }

  const quote = await prisma.quote.create({
    data: { leadId, product, amount },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: "DEVIS_ENVOYE",
      statusHistory: {
        create: {
          toStatus: "DEVIS_ENVOYE",
          changedBy: req.user?.email || "system",
        },
      },
    },
  });

  res.status(201).json(quote);
});

// PATCH /api/quotes/:id  { status }  (accepté / refusé / expiré)
router.patch("/:id", async (req, res) => {
  const { status } = req.body;
  const quote = await prisma.quote.update({
    where: { id: req.params.id },
    data: { status, respondedAt: ["ACCEPTE", "REFUSE"].includes(status) ? new Date() : undefined },
  });
  res.json(quote);
});

module.exports = router;
