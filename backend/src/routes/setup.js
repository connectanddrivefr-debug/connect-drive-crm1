// Route à usage unique pour créer le compte admin (Julien) une fois déployé
// sur Vercel, puisque le sandbox de développement ne peut pas atteindre la
// base Supabase directement (seul Vercel peut le faire en prod).
// Appeler une fois: GET /api/setup/seed-admin avec header
// Authorization: Bearer <SETUP_SECRET>
const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/seed-admin", async (req, res) => {
  const auth = req.headers.authorization;
  if (!process.env.SETUP_SECRET || auth !== `Bearer ${process.env.SETUP_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    return res.status(400).json({ error: "ADMIN_EMAIL / ADMIN_PASSWORD manquants dans les variables d'environnement" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, firstName: "Julien", lastName: "Admin", role: "ADMIN" },
  });

  res.json({ ok: true, email: user.email });
});

module.exports = router;
