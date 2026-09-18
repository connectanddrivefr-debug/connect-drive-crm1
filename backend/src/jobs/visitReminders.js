// Job de rappel J-2 avant une visite technique programmée (section "Rappels").
// Envoyé uniquement au commercial assigné — jamais à l'admin en fallback.
// Lancé en cron (voir vercel.json) ou manuellement via `node src/jobs/visitReminders.js`.

const prisma = require("../lib/prisma");
const { sendVisitReminderInternal } = require("../integrations/brevo");

const REMINDER_DAYS_BEFORE = parseInt(process.env.VISIT_REMINDER_DAYS_BEFORE || "2", 10);

async function runVisitReminders() {
  const now = Date.now();
  // Fenêtre du jour cible: toute visite dont la date tombe dans les 24h
  // suivant "aujourd'hui + REMINDER_DAYS_BEFORE" reçoit le rappel une seule fois.
  const windowStart = new Date(now + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      technicalVisitStatus: "PROGRAMMEE",
      technicalVisitDate: { gte: windowStart, lt: windowEnd },
      technicalVisitReminderSentAt: null, // une seule relance par visite programmée
    },
    include: { assignedTo: true },
  });

  let sent = 0;
  for (const lead of leads) {
    if (!lead.assignedTo?.email) continue; // pas de commercial -> pas de rappel (sur demande)
    try {
      await sendVisitReminderInternal(lead, lead.assignedTo);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { technicalVisitReminderSentAt: new Date() },
      });
      sent += 1;
      console.log(`[reminders] Rappel visite technique envoyé pour ${lead.email}`);
    } catch (err) {
      console.error(`[reminders] Échec rappel visite pour ${lead.id}:`, err.message);
    }
  }

  return sent;
}

if (require.main === module) {
  require("dotenv").config();
  runVisitReminders()
    .then((n) => {
      console.log(`Terminé: ${n} rappel(s) de visite envoyé(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runVisitReminders };
