// Job de relance des devis sans réponse (§5, règle 3 & 4 du cahier des charges).
// Lancé en cron (voir server.js) ou manuellement via `npm run brevo:reminders`.

const prisma = require("../lib/prisma");
const { sendQuoteReminder, sendInternalReminderNotif } = require("../integrations/brevo");

const DELAY_DAYS = parseInt(process.env.QUOTE_REMINDER_DELAY_DAYS || "4", 10);

async function runQuoteReminders() {
  const cutoff = new Date(Date.now() - DELAY_DAYS * 24 * 60 * 60 * 1000);

  const staleQuotes = await prisma.quote.findMany({
    where: {
      status: "ENVOYE",
      sentAt: { lte: cutoff },
      lastReminderAt: null, // une seule relance automatique par devis (V1)
    },
    include: { lead: true },
  });

  for (const quote of staleQuotes) {
    try {
      await sendQuoteReminder(quote, quote.lead);
      await sendInternalReminderNotif(quote, quote.lead);
      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: "RELANCE", lastReminderAt: new Date() },
      });
      console.log(`[reminders] Relance envoyée pour le devis ${quote.id} (${quote.lead.email})`);
    } catch (err) {
      console.error(`[reminders] Échec relance devis ${quote.id}:`, err.message);
    }
  }

  return staleQuotes.length;
}

if (require.main === module) {
  require("dotenv").config();
  runQuoteReminders()
    .then((n) => {
      console.log(`Terminé: ${n} relance(s) traitée(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runQuoteReminders };
