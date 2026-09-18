// Routes appelées par Vercel Cron (voir vercel.json à la racine backend/)
// Protégées par un secret pour éviter que n'importe qui déclenche les jobs.
const express = require("express");
const { runQuoteReminders } = require("../jobs/quoteReminders");
const { runVisitReminders } = require("../jobs/visitReminders");
const { runPhotoReminders } = require("../jobs/photoReminders");
const { runInstallationReminders } = require("../jobs/installationReminders");
const { pollWebflowLeads } = require("../integrations/webflowGmailPoll");

const router = express.Router();

function checkCronSecret(req, res, next) {
  // Vercel Cron envoie automatiquement ce header avec CRON_SECRET défini en env
  const auth = req.headers.authorization;
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Non autorisé" });
  }
  next();
}

router.get("/quote-reminders", checkCronSecret, async (req, res) => {
  try {
    const n = await runQuoteReminders();
    res.json({ ok: true, remindersSent: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/visit-reminders", checkCronSecret, async (req, res) => {
  try {
    const n = await runVisitReminders();
    res.json({ ok: true, remindersSent: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/photo-reminders", checkCronSecret, async (req, res) => {
  try {
    const n = await runPhotoReminders();
    res.json({ ok: true, remindersSent: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/installation-reminders", checkCronSecret, async (req, res) => {
  try {
    const n = await runInstallationReminders();
    res.json({ ok: true, remindersSent: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/webflow-poll", checkCronSecret, async (req, res) => {
  if (!process.env.GMAIL_REFRESH_TOKEN) {
    return res.json({ ok: true, skipped: "GMAIL_REFRESH_TOKEN non configuré" });
  }
  try {
    const n = await pollWebflowLeads();
    res.json({ ok: true, leadsCreated: n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
