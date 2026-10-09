// Liste des techniciens actifs (choix du technicien en charge d'une
// installation sur la fiche client) — accessible aux admins et commerciaux.
const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth, requireRole("ADMIN", "COMMERCIAL"));

router.get("/", async (req, res) => {
  const technicians = await prisma.technician.findMany({
    where: { active: true },
    select: { id: true, firstName: true, lastName: true, kraaftUserId: true },
    orderBy: { firstName: "asc" },
  });
  res.json(technicians);
});

module.exports = router;
