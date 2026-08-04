const express = require("express");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/users — liste des comptes (admin uniquement), utilisé pour le
// menu d'assignation d'un lead à un commercial.
router.get("/", requireRole("ADMIN"), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
    orderBy: { firstName: "asc" },
  });
  res.json(users);
});

module.exports = router;
