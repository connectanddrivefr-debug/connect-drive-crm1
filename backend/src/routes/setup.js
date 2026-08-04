// Route à usage unique pour créer le compte admin (Julien) une fois déployé
// sur Vercel, puisque le sandbox de développement ne peut pas atteindre la
// base Supabase directement (seul Vercel peut le faire en prod).
// Appeler une fois, directement dans le navigateur:
// GET /api/setup/seed-admin?secret=<SETUP_SECRET>
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");

const router = express.Router();

router.get("/seed-admin", async (req, res) => {
  const provided = req.query.secret || (req.headers.authorization || "").replace("Bearer ", "");
  if (!process.env.SETUP_SECRET || provided !== process.env.SETUP_SECRET) {
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

// Création rapide d'un compte (Phase 2: Commercial/Technicien) tant qu'il n'y
// a pas d'écran admin dédié. Génère un mot de passe aléatoire et le renvoie
// une seule fois dans la réponse — à transmettre à la personne concernée.
// Appel: GET /api/setup/create-user?secret=<SETUP_SECRET>&email=...&firstName=...&lastName=...&role=COMMERCIAL
router.get("/create-user", async (req, res) => {
  const provided = req.query.secret || (req.headers.authorization || "").replace("Bearer ", "");
  if (!process.env.SETUP_SECRET || provided !== process.env.SETUP_SECRET) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const { email, firstName, lastName, role = "COMMERCIAL" } = req.query;
  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: "email, firstName et lastName sont requis" });
  }
  if (!["ADMIN", "COMMERCIAL", "TECHNICIEN"].includes(role)) {
    return res.status(400).json({ error: "role invalide (ADMIN, COMMERCIAL ou TECHNICIEN)" });
  }

  const password = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "").slice(0, 12) + "!";
  const passwordHash = await bcrypt.hash(password, 10);

  // Écrase aussi le mot de passe si le compte existe déjà, pour que le mot de
  // passe renvoyé dans la réponse soit toujours celui qui fonctionne réellement.
  const user = await prisma.user.upsert({
    where: { email },
    update: { firstName, lastName, role, passwordHash },
    create: { email, passwordHash, firstName, lastName, role },
  });

  res.json({ ok: true, email: user.email, role: user.role, password });
});

module.exports = router;
