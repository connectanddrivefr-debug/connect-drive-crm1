// Point d'entrée pour un serveur classique (dev local, Render, VPS...).
// Sur Vercel, c'est api/index.js qui est utilisé à la place (serverless,
// pas de process persistant donc pas de node-cron — voir vercel.json).
require("dotenv").config();
const cron = require("node-cron");
const app = require("./app");
const { runQuoteReminders } = require("./jobs/quoteReminders");
const { pollWebflowLeads } = require("./integrations/webflowGmailPoll");

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Connect & Drive CRM API en écoute sur le port ${PORT}`);
});

// --- Tâches planifiées (uniquement en mode serveur classique) ---
cron.schedule("0 9 * * *", () => {
  runQuoteReminders().catch((err) => console.error("[cron reminders]", err));
});

if (process.env.GMAIL_REFRESH_TOKEN) {
  cron.schedule("*/10 * * * *", () => {
    pollWebflowLeads().catch((err) => console.error("[cron webflow]", err));
  });
}
