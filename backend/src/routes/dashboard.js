const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard/stats
// Taux de conversion, délai moyen de signature, répartition par statut/source
router.get("/stats", async (req, res) => {
  const [byStatus, bySource, total, signed] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    prisma.lead.groupBy({ by: ["source"], _count: true }),
    prisma.lead.count(),
    prisma.lead.findMany({
      where: { status: "SIGNE" },
      include: { statusHistory: { orderBy: { changedAt: "asc" } } },
    }),
  ]);

  // Délai moyen entre création (statut NOUVEAU) et signature (statut SIGNE)
  let avgDaysToSign = null;
  if (signed.length > 0) {
    const durations = signed
      .map((lead) => {
        const created = lead.statusHistory.find((h) => h.toStatus === "NOUVEAU");
        const signedEntry = [...lead.statusHistory].reverse().find((h) => h.toStatus === "SIGNE");
        if (!created || !signedEntry) return null;
        return (new Date(signedEntry.changedAt) - new Date(created.changedAt)) / (1000 * 60 * 60 * 24);
      })
      .filter((d) => d !== null);
    if (durations.length > 0) {
      avgDaysToSign = durations.reduce((a, b) => a + b, 0) / durations.length;
    }
  }

  const perdus = byStatus.find((s) => s.status === "PERDU")?._count || 0;
  const signes = byStatus.find((s) => s.status === "SIGNE")?._count || 0;
  const issues = perdus + signes;
  const conversionRate = issues > 0 ? (signes / issues) * 100 : null;

  // Leads "non traités depuis 48h": encore au statut Nouveau ou Contacté,
  // créés il y a plus de 48h. Visible par l'admin (vue globale, tous
  // commerciaux confondus) pour repérer ce qui traîne.
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const staleWhere = {
    status: { in: ["NOUVEAU", "CONTACTE"] },
    createdAt: { lte: cutoff48h },
  };
  if (req.user.role === "COMMERCIAL") {
    staleWhere.assignedToId = req.user.id;
  }
  const staleLeads = await prisma.lead.findMany({
    where: staleWhere,
    select: {
      id: true, firstName: true, lastName: true, email: true,
      status: true, createdAt: true, source: true,
      assignedTo: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Chiffre d'affaires signé / montant total des devis envoyés, par
  // commercial + vue globale. Seuils d'affichage définis côté frontend
  // (>=35% vert, 20-35% orange, <20% rouge).
  const [quotes, users] = await Promise.all([
    prisma.quote.findMany({
      select: { amount: true, status: true, lead: { select: { assignedToId: true } } },
    }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, role: true } }),
  ]);

  function computeBucket(quotesInBucket) {
    const totalAmount = quotesInBucket.reduce((sum, q) => sum + Number(q.amount), 0);
    const signedAmount = quotesInBucket
      .filter((q) => q.status === "ACCEPTE")
      .reduce((sum, q) => sum + Number(q.amount), 0);
    return {
      totalAmount,
      signedAmount,
      rate: totalAmount > 0 ? (signedAmount / totalAmount) * 100 : null,
    };
  }

  let revenueByCommercial = [
    { key: "global", name: "Global", ...computeBucket(quotes) },
    {
      key: "unassigned",
      name: "Non assigné",
      ...computeBucket(quotes.filter((q) => !q.lead.assignedToId)),
    },
    ...users.map((u) => ({
      key: u.id,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role,
      ...computeBucket(quotes.filter((q) => q.lead.assignedToId === u.id)),
    })),
  ];

  // Un commercial ne voit que son propre résultat, pas celui des collègues
  // ni le CA global de l'entreprise.
  if (req.user.role === "COMMERCIAL") {
    revenueByCommercial = revenueByCommercial.filter((r) => r.key === req.user.id);
  }

  res.json({
    total,
    byStatus,
    bySource,
    conversionRate, // % de leads "clos" (signé ou perdu) qui ont été signés
    avgDaysToSign,
    staleLeads,
    revenueByCommercial,
  });
});

module.exports = router;
