// Job de relance interne "photos non reçues" (section "Rappels"): 2 jours
// après le passage d'un lead en "en attente de photos", si les photos ne
// sont toujours pas arrivées, le commercial assigné reçoit un rappel.
// Envoyé uniquement au commercial assigné — jamais à l'admin en fallback.
// Lancé en cron (voir vercel.json) ou manuellement via `node src/jobs/photoReminders.js`.

const prisma = require("../lib/prisma");
const { sendPhotoReminderDigest } = require("../integrations/brevo");

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

  // Un seul email récapitulatif par commercial (et non un email par lead).
  const byUser = new Map();
  for (const lead of leads) {
    if (!lead.assignedTo?.email) continue; // pas de commercial -> pas de rappel (sur demande)
    if (!byUser.has(lead.assignedTo.id)) byUser.set(lead.assignedTo.id, { user: lead.assignedTo, leads: [] });
    byUser.get(lead.assignedTo.id).leads.push(lead);
  }

  let sent = 0;
  for (const { user, leads: userLeads } of byUser.values()) {
    try {
      await sendPhotoReminderDigest(user, userLeads);
      await prisma.lead.updateMany({
        where: { id: { in: userLeads.map((l) => l.id) } },
        data: { photosReminderSentAt: new Date() },
      });
      sent += userLeads.length;
      console.log(`[reminders] Rappel photos groupé envoyé à ${user.email} (${userLeads.length} lead(s))`);
    } catch (err) {
      console.error(`[reminders] Échec rappel photos groupé pour ${user.email}:`, err.message);
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
