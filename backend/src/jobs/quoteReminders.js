// Séquence de relance des devis sans réponse.
// Lancé chaque matin par Vercel Cron (backend/vercel.json) ou manuellement
// via `npm run brevo:reminders`.
//
// Tant qu'un lead reste en statut DEVIS_ENVOYE, le client reçoit 5 emails :
//   1. le lendemain matin de l'envoi du devis
//   2. 2 jours après la relance 1  (+ tâche "Appeler" pour le commercial)
//   3. 3 jours après la relance 2
//   4. 3 jours après la relance 3
//   5. 4 jours après la relance 4  (+ tâche "Dernier appel")
// La séquence s'arrête d'elle-même dès que le lead passe en SIGNE / PERDU
// (ou tout autre statut), puisque seuls les leads DEVIS_ENVOYE sont traités.
// Aucun envoi le samedi ni le dimanche (les relances sont décalées au lundi).
// Le job est idempotent : relancé plusieurs fois le même jour, il n'envoie
// jamais deux fois la même relance.

const prisma = require("../lib/prisma");
const { sendQuoteFollowup, sendQuoteCallTask } = require("../integrations/brevo");

// Les délais se comptent en jours calendaires (heure de Paris) : un devis
// envoyé lundi à 18h reçoit sa 1re relance mardi matin.
function parisDayNumber(date) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(date));
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / (24 * 60 * 60 * 1000));
}

// Délai (en jours) avant chaque relance, compté depuis l'étape précédente.
const DELAYS = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 };
const CALL_TASK_STEPS = [2, 5];
const MAX_STEP = 5;
// Une séquence ne démarre pas pour un devis envoyé il y a plus de 30 jours
// (évite de relancer d'un coup les vieux devis au lancement de la fonction).
const MAX_START_AGE_DAYS = 30;

function isWeekendInFrance(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short" }).format(date);
  return day === "Sat" || day === "Sun";
}

// Date de départ de la séquence pour les leads passés en DEVIS_ENVOYE avant
// la mise en place de ce champ : dernier passage en DEVIS_ENVOYE dans
// l'historique, sinon dernier devis, sinon dernière mise à jour.
function startDateOf(lead) {
  return (
    lead.quoteFollowupStartedAt ||
    lead.statusHistory[0]?.changedAt ||
    lead.quotes[0]?.sentAt ||
    lead.updatedAt
  );
}

function quoteAmount(lead) {
  const q = lead.quotes[0];
  if (q) return Number(q.amount);
  return lead.estimatedPrice ? Number(lead.estimatedPrice) : null;
}

async function runQuoteReminders({ now = new Date(), dryRun = false } = {}) {
  if (isWeekendInFrance(now)) {
    console.log("[reminders] Week-end : aucune relance envoyée.");
    return 0;
  }

  const leads = await prisma.lead.findMany({
    where: { status: "DEVIS_ENVOYE", quoteFollowupStep: { lt: MAX_STEP } },
    include: {
      assignedTo: true,
      quotes: { orderBy: { sentAt: "desc" }, take: 1 },
      statusHistory: { where: { toStatus: "DEVIS_ENVOYE" }, orderBy: { changedAt: "desc" }, take: 1 },
    },
  });

  let sent = 0;
  for (const lead of leads) {
    if (!lead.email) continue;
    // Devis déjà accepté ou refusé mais statut pas encore mis à jour : on ne relance pas.
    if (lead.quotes[0] && ["ACCEPTE", "REFUSE"].includes(lead.quotes[0].status)) continue;

    if (
      lead.quoteFollowupStep === 0 &&
      parisDayNumber(now) - parisDayNumber(startDateOf(lead)) > MAX_START_AGE_DAYS
    ) continue;

    const nextStep = lead.quoteFollowupStep + 1;
    const from = lead.quoteFollowupLastAt || startDateOf(lead);
    if (parisDayNumber(now) < parisDayNumber(from) + DELAYS[nextStep]) continue;

    const amount = quoteAmount(lead);
    if (dryRun) {
      console.log(`[reminders][simulation] Relance ${nextStep} -> ${lead.email}`);
      sent++;
      continue;
    }

    try {
      await sendQuoteFollowup(nextStep, lead, lead.assignedTo, amount);

      const isCallStep = CALL_TASK_STEPS.includes(nextStep);
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          quoteFollowupStep: nextStep,
          quoteFollowupLastAt: now,
          ...(lead.quoteFollowupStartedAt ? {} : { quoteFollowupStartedAt: startDateOf(lead) }),
          ...(isCallStep ? { callbackRequested: true, callbackRequestedAt: now } : {}),
        },
      });
      if (lead.quotes[0] && lead.quotes[0].status === "ENVOYE") {
        await prisma.quote.update({
          where: { id: lead.quotes[0].id },
          data: { status: "RELANCE", lastReminderAt: now },
        });
      } else if (lead.quotes[0]) {
        await prisma.quote.update({ where: { id: lead.quotes[0].id }, data: { lastReminderAt: now } });
      }

      if (isCallStep) {
        try {
          await sendQuoteCallTask(nextStep, lead, lead.assignedTo, amount);
        } catch (err) {
          console.error(`[reminders] Échec tâche d'appel ${lead.id}:`, err.message);
        }
      }

      sent++;
      console.log(`[reminders] Relance ${nextStep}/${MAX_STEP} envoyée à ${lead.email}`);
    } catch (err) {
      console.error(`[reminders] Échec relance ${nextStep} pour ${lead.id}:`, err.message);
    }
  }

  return sent;
}

if (require.main === module) {
  require("dotenv").config();
  const dryRun = process.argv.includes("--dry-run");
  runQuoteReminders({ dryRun })
    .then((n) => {
      console.log(`Terminé: ${n} relance(s) ${dryRun ? "à envoyer (simulation)" : "envoyée(s)"}.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runQuoteReminders, DELAYS, isWeekendInFrance };
