// Intégration Brevo (ex-Sendinblue) — toutes les automatisations email du §5
// du cahier des charges passent par ce module.
//
// Clé API à récupérer dans le compte Brevo existant:
// Brevo > Paramètres du compte > SMTP & API > Clés API
// -> à coller dans backend/.env sous BREVO_API_KEY

const SibApiV3Sdk = require("sib-api-v3-sdk");
const prisma = require("../lib/prisma");

// Numéros de téléphone affichés dans la signature des emails, par personne.
// Pas encore de champ "phone" sur le compte utilisateur — à migrer vers la
// base si on ajoute d'autres commerciaux plus tard.
const PHONE_BY_EMAIL = {
  "connectanddrivefr@gmail.com": "01 89 70 88 73",
  "angelique@connectanddrive.fr": "07 80 97 18 95",
};

function getSignature(assignedUser) {
  if (!assignedUser) return "L'équipe Connect & Drive";
  const phone = PHONE_BY_EMAIL[assignedUser.email];
  return `${assignedUser.firstName} - Connect & Drive${phone ? `<br/>${phone}` : ""}`;
}

function getClient() {
  const client = SibApiV3Sdk.ApiClient.instance;
  client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;
  return new SibApiV3Sdk.TransactionalEmailsApi();
}

async function sendEmail({ to, subject, htmlContent, leadId, type, senderName, senderEmail, replyTo }) {
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
    // Expéditeur personnalisable: quand un lead est assigné à un commercial,
    // l'email part directement de son adresse Brevo vérifiée (ex: angelique@
    // connectanddrive.fr) plutôt que de l'adresse générique.
    sender: {
      email: senderEmail || process.env.BREVO_SENDER_EMAIL,
      name: senderName || process.env.BREVO_SENDER_NAME,
    },
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
  const signature = getSignature(assignedUser);
  const intro = assignedUser
    ? `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Je m'appelle ${assignedUser.firstName}, je m'occupe de votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Je vous appellerai <strong>dans les 24h</strong> pour échanger sur votre projet.</p>
       <p>À très vite,<br/>${signature}</p>`
    : `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Nous avons bien reçu votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Un membre de notre équipe vous appellera <strong>dans les 24h</strong> pour échanger sur votre projet.</p>
       <p>À très vite,<br/>${signature}</p>`;

  return sendEmail({
    to: lead.email,
    subject: "Votre demande a bien été reçue — Connect & Drive",
    htmlContent: intro,
    leadId: lead.id,
    type: "CONFIRMATION_LEAD",
    senderName: assignedUser ? `${assignedUser.firstName} - Connect & Drive` : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
  });
}

// --- Règle 2: Nouveau lead -> notification interne ---
// Envoyée au commercial assigné s'il y en a un, sinon à Julien (admin).
async function sendInternalNewLeadNotif(lead, assignedUser = null) {
  const to = assignedUser?.email || process.env.ADMIN_EMAIL;
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
async function sendQuoteReminder(quote, lead, assignedUser = null) {
  const signature = getSignature(assignedUser);
  return sendEmail({
    to: lead.email,
    subject: "Votre devis Connect & Drive — toujours d'actualité ?",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Nous revenons vers vous concernant le devis envoyé le ${new Date(quote.sentAt).toLocaleDateString("fr-FR")}.</p>
      <p>N'hésitez pas à nous contacter si vous avez des questions ou souhaitez donner suite.</p>
      <p>${signature}</p>
    `,
    leadId: lead.id,
    type: "RELANCE_DEVIS",
    senderName: assignedUser ? signature : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
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
async function sendSignatureConfirmation(lead, assignedUser = null) {
  const signature = getSignature(assignedUser);
  return sendEmail({
    to: lead.email,
    subject: "Bienvenue chez Connect & Drive — prochaines étapes",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Merci pour votre confiance ! Votre dossier est validé.</p>
      <p>Prochaines étapes: un technicien vous contactera pour planifier la visite technique puis l'installation.</p>
      <p>${signature}</p>
    `,
    leadId: lead.id,
    type: "CONFIRMATION_SIGNATURE",
    senderName: assignedUser ? signature : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
  });
}

module.exports = {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
  sendQuoteReminder,
  sendInternalReminderNotif,
  sendSignatureConfirmation,
};
