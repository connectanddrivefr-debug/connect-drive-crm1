require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const authRoutes = require("./routes/auth");
const leadRoutes = require("./routes/leads");
const quoteRoutes = require("./routes/quotes");
const dashboardRoutes = require("./routes/dashboard");
const webhookRoutes = require("./routes/webhooks");
const { runQuoteReminders } = require("./jobs/quoteReminders");
const { pollWebflowLeads } = require("./integrations/webflowGmailPoll");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/webhooks", webhookRoutes);

// Erreurs non gérées -> réponse JSON propre plutôt qu'un crash silencieux
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur interne" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Connect & Drive CRM API en écoute sur le port ${PORT}`);
});

// --- Tâches planifiées (désactivables en dev en ne configurant pas les clés) ---
// Relance des devis sans réponse: tous les jours à 9h
cron.schedule("0 9 * * *", () => {
  runQuoteReminders().catch((err) => console.error("[cron reminders]", err));
});

// Polling des notifications Webflow: toutes les 10 minutes
if (process.env.GMAIL_REFRESH_TOKEN) {
  cron.schedule("*/10 * * * *", () => {
    pollWebflowLeads().catch((err) => console.error("[cron webflow]", err));
  });
}
