const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Chiffre d'affaires réel d'un lead: le montant du devis accepté s'il existe,
// sinon le prix estimé du simulateur (leads qui signent sans devis formel),
// sinon 0. Reprend exactement la même règle que l'événement Meta "Purchase"
// (voir routes/leads.js) pour que le CA affiché ici corresponde toujours à
// ce qui est réellement compté comme vente ailleurs dans l'appli.
function leadRevenue(lead) {
  if (lead.status !== "SIGNE") return 0;
  const accepted = lead.quotes.find((q) => q.status === "ACCEPTE") || lead.quotes[0];
  if (accepted) return Number(accepted.amount);
  if (lead.estimatedPrice != null) return Number(lead.estimatedPrice);
  return 0;
}

// GET /api/dashboard/stats
// Taux de conversion, délai moyen de signature, répartition par statut/source,
// performance (leads signés/perdus, CA) par commercial + vue globale.
router.get("/stats", async (req, res) => {
  const [byStatus, bySource, total, signedForDelay, leads, users] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    prisma.lead.groupBy({ by: ["source"], _count: true }),
    prisma.lead.count(),
    prisma.lead.findMany({
      where: { status: "SIGNE" },
      include: { statusHistory: { orderBy: { changedAt: "asc" } } },
    }),
    // Un seul passage sur tous les leads (avec leurs devis) pour calculer à
    // la fois le nombre de leads signés/perdus ET le CA réel, par commercial.
    prisma.lead.findMany({
      select: {
        id: true,
        status: true,
        assignedToId: true,
        estimatedPrice: true,
        quotes: { select: { amount: true, status: true } },
      },
    }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, role: true } }),
  ]);

  // Délai moyen entre création (statut NOUVEAU) et signature (statut SIGNE)
  let avgDaysToSign = null;
  if (signedForDelay.length > 0) {
    const durations = signedForDelay
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

  // Taux de conversion global: leads signés / TOTAL des leads (et non
  // seulement parmi les leads "clos" signé+perdu) — c'est la mesure qui
  // reflète directement combien de leads deviennent réellement des clients.
  const signes = byStatus.find((s) => s.status === "SIGNE")?._count || 0;
  const conversionRate = total > 0 ? (signes / total) * 100 : null;

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

  // Performance par commercial: calculée directement sur les leads (pas
  // seulement sur les devis formels) pour que les leads signés via le
  // simulateur (sans devis créé dans le CRM) soient bien comptés dans le
  // nombre de signatures ET dans le chiffre d'affaires.
  function computeBucket(leadsInBucket) {
    const totalLeads = leadsInBucket.length;
    const signedLeads = leadsInBucket.filter((l) => l.status === "SIGNE").length;
    const lostLeads = leadsInBucket.filter((l) => l.status === "PERDU").length;
    const inProgressLeads = totalLeads - signedLeads - lostLeads;
    const revenue = leadsInBucket.reduce((sum, l) => sum + leadRevenue(l), 0);
    return {
      totalLeads,
      signedLeads,
      lostLeads,
      inProgressLeads,
      // Signés / TOTAL des leads du bucket (pas seulement parmi les clos) —
      // même définition que le taux de conversion global ci-dessus.
      conversionRate: totalLeads > 0 ? (signedLeads / totalLeads) * 100 : null,
      revenue,
      avgDealSize: signedLeads > 0 ? revenue / signedLeads : null,
    };
  }

  let performance = [
    { key: "global", name: "Global", ...computeBucket(leads) },
    {
      key: "unassigned",
      name: "Non assigné",
      ...computeBucket(leads.filter((l) => !l.assignedToId)),
    },
    ...users.map((u) => ({
      key: u.id,
      name: `${u.firstName} ${u.lastName}`,
      role: u.role,
      ...computeBucket(leads.filter((l) => l.assignedToId === u.id)),
    })),
  ];

  // Un commercial ne voit que son propre résultat, pas celui des collègues
  // ni la vue globale de l'entreprise.
  if (req.user.role === "COMMERCIAL") {
    performance = performance.filter((r) => r.key === req.user.id);
  }

  res.json({
    total,
    byStatus,
    bySource,
    conversionRate, // % de TOUS les leads (pas seulement les clos) qui ont été signés
    avgDaysToSign,
    staleLeads,
    performance,
  });
});

module.exports = router;
