const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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

// POST /api/users — créer un compte (Commercial/Technicien/Admin), réservé
// à l'admin connecté. Génère un mot de passe temporaire renvoyé une seule
// fois dans la réponse (à transmettre à la personne concernée, qui devra le
// changer). Remplace la route à secret /api/setup/create-user pour ne plus
// dépendre de SETUP_SECRET au quotidien.
router.post("/", requireRole("ADMIN"), async (req, res) => {
  const { email, firstName, lastName, role = "COMMERCIAL" } = req.body;
  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: "email, firstName et lastName sont requis" });
  }
  if (!["ADMIN", "COMMERCIAL", "TECHNICIEN"].includes(role)) {
    return res.status(400).json({ error: "role invalide (ADMIN, COMMERCIAL ou TECHNICIEN)" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "Un compte existe déjà avec cet email" });
  }

  const password = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "!";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, firstName, lastName, role, passwordHash },
  });

  res.status(201).json({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    password,
  });
});

module.exports = router;
