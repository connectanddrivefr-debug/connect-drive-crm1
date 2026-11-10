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
      // Nouveau devis envoyé -> la séquence de relance repart de zéro.
      quoteFollowupStartedAt: new Date(),
      quoteFollowupStep: 0,
      quoteFollowupLastAt: null,
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

const PRODUCT_LABELS = { V2C_TRYDAN: "V2C Trydan", SMAPPEE_EV_WALL: "Smappee EV Wall", AUTRE: "Autre" };
const fmt = (n) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

// Trace les modifications / suppressions de devis dans les notes du lead.
async function logQuoteNote(req, leadId, content) {
  try {
    await prisma.note.create({ data: { leadId, authorId: req.user?.id, content } });
  } catch (e) {
    console.error("Note devis non enregistrée :", e.message);
  }
}

// PATCH /api/quotes/:id  { status?, amount?, product? }
// - status : accepté / refusé / expiré
// - amount / product : correction d'un devis (erreur de saisie, nouveau prix)
router.patch("/:id", async (req, res) => {
  const { status, amount, product } = req.body;
  const existing = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Devis introuvable" });

  const data = {};
  if (status !== undefined) {
    data.status = status;
    if (["ACCEPTE", "REFUSE"].includes(status)) data.respondedAt = new Date();
  }
  if (amount !== undefined) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return res.status(400).json({ error: "Montant invalide" });
    }
    data.amount = value;
  }
  if (product !== undefined) {
    if (!PRODUCT_LABELS[product]) return res.status(400).json({ error: "Produit invalide" });
    data.product = product;
  }

  const quote = await prisma.quote.update({ where: { id: req.params.id }, data });

  const changes = [];
  if (data.amount !== undefined && Number(existing.amount) !== data.amount) {
    changes.push(`montant ${fmt(existing.amount)} → ${fmt(data.amount)}`);
  }
  if (data.product !== undefined && existing.product !== data.product) {
    changes.push(`produit ${PRODUCT_LABELS[existing.product]} → ${PRODUCT_LABELS[data.product]}`);
  }
  if (changes.length) {
    await logQuoteNote(req, existing.leadId, `Devis modifié par ${req.user?.email || "?"} : ${changes.join(", ")}`);
  }

  res.json(quote);
});

// DELETE /api/quotes/:id  — supprime un devis saisi par erreur
router.delete("/:id", async (req, res) => {
  const existing = await prisma.quote.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Devis introuvable" });

  await prisma.quote.delete({ where: { id: req.params.id } });
  await logQuoteNote(
    req,
    existing.leadId,
    `Devis supprimé par ${req.user?.email || "?"} : ${PRODUCT_LABELS[existing.product] || existing.product} ${fmt(existing.amount)} du ${new Date(existing.sentAt).toLocaleDateString("fr-FR")}`
  );
  res.status(204).end();
});

module.exports = router;
