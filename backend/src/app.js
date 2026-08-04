// Application Express — séparée de server.js pour pouvoir être réutilisée
// telle quelle par Vercel (serverless) ET par un serveur classique (Render,
// VPS, local) sans dupliquer la config des routes.
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const leadRoutes = require("./routes/leads");
const quoteRoutes = require("./routes/quotes");
const dashboardRoutes = require("./routes/dashboard");
const webhookRoutes = require("./routes/webhooks");
const cronRoutes = require("./routes/cron");
const setupRoutes = require("./routes/setup");
const userRoutes = require("./routes/users");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/webhooks", webhookRoutes);
// Endpoints déclenchés par Vercel Cron (voir vercel.json) — protégés par CRON_SECRET
app.use("/api/cron", cronRoutes);
// Route à usage unique pour créer le compte admin après déploiement
app.use("/api/setup", setupRoutes);
app.use("/api/users", userRoutes);

// Erreurs non gérées -> réponse JSON propre plutôt qu'un crash silencieux
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne" });
});

module.exports = app;
