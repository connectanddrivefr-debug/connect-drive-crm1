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

  res.json({
    total,
    byStatus,
    bySource,
    conversionRate, // % de leads "clos" (signé ou perdu) qui ont été signés
    avgDaysToSign,
  });
});

module.exports = router;
