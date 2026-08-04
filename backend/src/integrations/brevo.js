// Intégration Brevo (ex-Sendinblue) — toutes les automatisations email du §5
// du cahier des charges passent par ce module.
//
// Clé API à récupérer dans le compte Brevo existant:
// Brevo > Paramètres du compte > SMTP & API > Clés API
// -> à coller dans backend/.env sous BREVO_API_KEY

const SibApiV3Sdk = require("sib-api-v3-sdk");
const prisma = require("../lib/prisma");

function getClient() {
  const client = SibApiV3Sdk.ApiClient.instance;
  client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
  return new SibApiV3Sdk.TransactionalEmailsApi();
}

async function sendEmail({ to, subject, htmlContent, leadId, type, senderName, replyTo }) {
  if (!process.env.BREVO_API_KEY) {
    console.warn(`[Brevo] BREVO_API_KEY absent — email "${type}" non envoyé (mode simulation).`);
    if (leadId) {
      await prisma.emailLog.create({
        data: { leadId, type, recipient: to, subject, success: false, errorMsg: "BREVO_API_KEY manquant" },
      });
    }
    return;
  }

  const api = getClient();
  const payload = {
    // Nom d'expéditeur personnalisable (ex: "Angélique - Connect & Drive")
    // tout en gardant l'adresse technique vérifiée sur Brevo.
    sender: { email: process.env.BREVO_SENDER_EMAIL, name: senderName || process.env.BREVO_SENDER_NAME },
    to: [{ email: to }],
    subject,
    htmlContent,
  };
  // Les réponses du client arrivent directement dans la boîte du commercial assigné.
  if (replyTo) {
    payload.replyTo = { email: replyTo };
  }

  try {
    const result = await api.sendTransacEmail(payload);
    if (leadId) {
      await prisma.emailLog.create({
        data: { leadId, type, recipient: to, subject, brevoMessageId: result.messageId, success: true },
      });
    }
    return result;
  } catch (err) {
    if (leadId) {
      await prisma.emailLog.create({
        data: { leadId, type, recipient: to, subject, success: false, errorMsg: err.message },
      });
    }
    throw err;
  }
}

// --- Règle 1: Nouveau lead -> email de confirmation au client ---
// Si un commercial est assigné (assignedUser), l'email est personnalisé à
// son nom et les réponses du client arrivent dans sa boîte mail.
async function sendLeadConfirmation(lead, assignedUser = null) {
  const intro = assignedUser
    ? `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Je m'appelle ${assignedUser.firstName}, je m'occupe de votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Je vous appellerai <strong>demain après-midi</strong> pour échanger sur votre projet.</p>
       <p>À très vite,<br/>${assignedUser.firstName} - Connect & Drive</p>`
    : `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Nous avons bien reçu votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Un membre de notre équipe vous appellera <strong>demain après-midi</strong> pour échanger sur votre projet.</p>
       <p>À très vite,<br/>L'équipe Connect & Drive</p>`;

  return sendEmail({
    to: lead.email,
    subject: "Votre demande a bien été reçue — Connect & Drive",
    htmlContent: intro,
    leadId: lead.id,
    type: "CONFIRMATION_LEAD",
    senderName: assignedUser ? `${assignedUser.firstName} - Connect & Drive` : undefined,
    replyTo: assignedUser?.email,
  });
}

// --- Règle 2: Nouveau lead -> notification interne ---
async function sendInternalNewLeadNotif(lead) {
  const to = process.env.ADMIN_EMAIL; // Phase 2: router vers le commercial assigné
  return sendEmail({
    to,
    subject: `Nouveau lead: ${lead.firstName || ""} ${lead.lastName || ""} (${lead.source})`,
    htmlContent: `
      <p>Nouveau lead reçu via <strong>${lead.source}</strong>.</p>
      <ul>
        <li>Nom: ${lead.firstName || ""} ${lead.lastName || ""}</li>
        <li>Email: ${lead.email}</li>
        <li>Téléphone: ${lead.phone || "—"}</li>
        <li>Code postal: ${lead.postalCode || "—"}</li>
      </ul>
    `,
    leadId: lead.id,
    type: "NOTIF_INTERNE",
  });
}

// --- Règle 3: Devis sans réponse après X jours -> relance client ---
async function sendQuoteReminder(quote, lead) {
  return sendEmail({
    to: lead.email,
    subject: "Votre devis Connect & Drive — toujours d'actualité ?",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Nous revenons vers vous concernant le devis envoyé le ${new Date(quote.sentAt).toLocaleDateString("fr-FR")}.</p>
      <p>N'hésitez pas à nous contacter si vous avez des questions ou souhaitez donner suite.</p>
      <p>L'équipe Connect & Drive</p>
    `,
    leadId: lead.id,
    type: "RELANCE_DEVIS",
  });
}

// --- Règle 4: Devis sans réponse après X jours -> rappel interne ---
async function sendInternalReminderNotif(quote, lead) {
  const to = process.env.ADMIN_EMAIL; // Phase 2: commercial assigné
  return sendEmail({
    to,
    subject: `Rappel: devis sans réponse — ${lead.firstName || ""} ${lead.lastName || ""}`,
    htmlContent: `<p>Le devis envoyé le ${new Date(quote.sentAt).toLocaleDateString("fr-FR")} à ${lead.email} est toujours sans réponse.</p>`,
    leadId: lead.id,
    type: "RAPPEL_INTERNE",
  });
}

// --- Règle 5: Lead signé -> confirmation + prochaines étapes ---
async function sendSignatureConfirmation(lead) {
  return sendEmail({
    to: lead.email,
    subject: "Bienvenue chez Connect & Drive — prochaines étapes",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Merci pour votre confiance ! Votre dossier est validé.</p>
      <p>Prochaines étapes: un technicien vous contactera pour planifier la visite technique puis l'installation.</p>
      <p>L'équipe Connect & Drive</p>
    `,
    leadId: lead.id,
    type: "CONFIRMATION_SIGNATURE",
  });
}

module.exports = {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
  sendQuoteReminder,
  sendInternalReminderNotif,
  sendSignatureConfirmation,
};
