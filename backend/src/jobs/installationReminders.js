// Job de rappel J-2 avant une installation programmée (section "Rappels").
// Envoyé uniquement au commercial assigné — jamais à l'admin en fallback.
// Lancé en cron (voir vercel.json) ou manuellement via `node src/jobs/installationReminders.js`.

const prisma = require("../lib/prisma");
const { sendInstallationReminderInternal } = require("../integrations/brevo");

const REMINDER_DAYS_BEFORE = parseInt(process.env.INSTALLATION_REMINDER_DAYS_BEFORE || "2", 10);

async function runInstallationReminders() {
  const now = Date.now();
  // Fenêtre du jour cible: toute installation dont la date tombe dans les 24h
  // suivant "aujourd'hui + REMINDER_DAYS_BEFORE" reçoit le rappel une seule fois.
  const windowStart = new Date(now + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      installationStatus: "PROGRAMMEE",
      installationDate: { gte: windowStart, lt: windowEnd },
      installationReminderSentAt: null, // une seule relance par installation programmée
    },
    include: { assignedTo: true },
  });

  let sent = 0;
  for (const lead of leads) {
    if (!lead.assignedTo?.email) continue; // pas de commercial -> pas de rappel (sur demande)
    try {
      await sendInstallationReminderInternal(lead, lead.assignedTo);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { installationReminderSentAt: new Date() },
      });
      sent += 1;
      console.log(`[reminders] Rappel installation envoyé pour ${lead.email}`);
    } catch (err) {
      console.error(`[reminders] Échec rappel installation pour ${lead.id}:`, err.message);
    }
  }

  return sent;
}

if (require.main === module) {
  require("dotenv").config();
  runInstallationReminders()
    .then((n) => {
      console.log(`Terminé: ${n} rappel(s) d'installation envoyé(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runInstallationReminders };
