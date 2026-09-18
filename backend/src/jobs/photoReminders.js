// Job de relance interne "photos non reçues" (section "Rappels"): 2 jours
// après le passage d'un lead en "en attente de photos", si les photos ne
// sont toujours pas arrivées, le commercial assigné reçoit un rappel.
// Envoyé uniquement au commercial assigné — jamais à l'admin en fallback.
// Lancé en cron (voir vercel.json) ou manuellement via `node src/jobs/photoReminders.js`.

const prisma = require("../lib/prisma");
const { sendPhotoReminderInternal } = require("../integrations/brevo");

const DELAY_DAYS = parseInt(process.env.PHOTO_REMINDER_DELAY_DAYS || "2", 10);

async function runPhotoReminders() {
  const cutoff = new Date(Date.now() - DELAY_DAYS * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      photosStatus: "EN_ATTENTE",
      photosRequestedAt: { lte: cutoff },
      photosReminderSentAt: null, // une seule relance automatique par demande
    },
    include: { assignedTo: true },
  });

  let sent = 0;
  for (const lead of leads) {
    if (!lead.assignedTo?.email) continue; // pas de commercial -> pas de rappel (sur demande)
    try {
      await sendPhotoReminderInternal(lead, lead.assignedTo);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { photosReminderSentAt: new Date() },
      });
      sent += 1;
      console.log(`[reminders] Rappel photos envoyé pour ${lead.email}`);
    } catch (err) {
      console.error(`[reminders] Échec rappel photos pour ${lead.id}:`, err.message);
    }
  }

  return sent;
}

if (require.main === module) {
  require("dotenv").config();
  runPhotoReminders()
    .then((n) => {
      console.log(`Terminé: ${n} rappel(s) photos envoyé(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runPhotoReminders };
