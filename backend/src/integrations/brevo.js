// Intégration Brevo (ex-Sendinblue) — toutes les automatisations email du §5
// du cahier des charges passent par ce module.
//
// Clé API à récupérer dans le compte Brevo existant:
// Brevo > Paramètres du compte > SMTP & API > Clés API
// -> à coller dans backend/.env sous BREVO_API_KEY

const SibApiV3Sdk = require("sib-api-v3-sdk");
const prisma = require("../lib/prisma");

// URL publique du frontend (héberge le logo/bannière utilisés dans les emails).
const APP_URL = process.env.APP_URL || "https://connect-drive-crm1-three.vercel.app";

// Coordonnées affichées dans la signature des emails, par personne.
// Pas encore de champs dédiés sur le compte utilisateur — à migrer vers la
// base si on ajoute d'autres commerciaux plus tard.
const PHONE_BY_EMAIL = {
  "connectanddrivefr@gmail.com": "01 89 70 88 73",
  "angelique@connectanddrive.fr": "07 80 97 18 95",
  "ilham@connectanddrive.fr": "07 56 84 09 85",
};

// Emails affichés dans la signature (en plus de l'adresse d'envoi elle-même).
const EXTRA_EMAILS_BY_EMAIL = {
  "connectanddrivefr@gmail.com": ["contact@connectanddrive.fr", "connectanddrivefr@gmail.com"],
  "angelique@connectanddrive.fr": ["angelique@connectanddrive.fr"],
  "ilham@connectanddrive.fr": ["ilham@connectanddrive.fr"],
};

function getSignature(assignedUser) {
  if (!assignedUser) return "L'équipe Connect & Drive";
  const phone = PHONE_BY_EMAIL[assignedUser.email];
  return `${assignedUser.firstName} - Connect & Drive${phone ? `<br/>${phone}` : ""}`;
}

// Signature email complète: bannière visuelle Connect & Drive + bloc de
// coordonnées (téléphone, emails, site, avis Google), reprenant la
// signature réelle utilisée dans les boîtes mail de l'équipe.
function getSignatureHtml(assignedUser) {
  const firstName = assignedUser?.firstName || "L'équipe Connect & Drive";
  const phone = assignedUser ? PHONE_BY_EMAIL[assignedUser.email] : null;
  const emails = assignedUser ? EXTRA_EMAILS_BY_EMAIL[assignedUser.email] : null;

  return `
    <table cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:14px;">
      <tr><td>
        <img src="${APP_URL}/email-signature-banner.png" alt="Connect & Drive" style="max-width:420px;width:100%;height:auto;display:block;margin-bottom:8px;" />
      </td></tr>
      <tr><td style="font-size:13px;line-height:1.6;color:#1e293b;">
        Bien cordialement,<br/>
        <strong>${firstName}</strong><br/>
        Connect & Drive<br/>
        ${phone ? `${phone}<br/>` : ""}
        ${emails ? `${emails.join(" / ")}<br/>` : ""}
        <a href="https://www.connectanddrive.fr" style="color:#5b8fe0;">www.connectanddrive.fr</a><br/>
        <a href="https://share.google/UHtDhJeC3zidJ" style="color:#5b8fe0;">Nos avis Google</a>
      </td></tr>
    </table>
  `;
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
  const signatureHtml = getSignatureHtml(assignedUser);
  const intro = assignedUser
    ? `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Je m'appelle ${assignedUser.firstName}, je m'occupe de votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Je vous appellerai <strong>dans les 24h</strong> pour échanger sur votre projet.</p>
       ${signatureHtml}`
    : `<p>Bonjour ${lead.firstName || ""},</p>
       <p>Nous avons bien reçu votre demande concernant l'installation d'une borne de recharge (IRVE).</p>
       <p>Un membre de notre équipe vous appellera <strong>dans les 24h</strong> pour échanger sur votre projet.</p>
       ${signatureHtml}`;

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
// Si le numéro de téléphone n'a pas été vérifié par SMS (Twilio, simulateur
// connectndrive.fr uniquement), on ajoute une mention bien visible en tête
// de l'email pour alerter l'équipe (suspicion de spam) — le lead continue
// néanmoins à recevoir l'email de confirmation et le signal Meta CAPI
// normalement, seule la notification interne est modifiée.
async function sendInternalNewLeadNotif(lead, assignedUser = null) {
  const to = assignedUser?.email || process.env.ADMIN_EMAIL;
  const isUnverified = lead.source === "SIMULATEUR" && lead.phoneVerified === false;
  const warningHtml = isUnverified
    ? `<p style="background:#fee2e2;color:#b91c1c;font-weight:bold;padding:10px 14px;border-radius:6px;">
         ⚠️ Numéro de téléphone non vérifié — suspicion de spam
       </p>`
    : "";
  return sendEmail({
    to,
    subject: `${isUnverified ? "[Non vérifié] " : ""}Nouveau lead: ${lead.firstName || ""} ${lead.lastName || ""} (${lead.source})`,
    htmlContent: `
      ${warningHtml}
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
  const signatureHtml = getSignatureHtml(assignedUser);
  return sendEmail({
    to: lead.email,
    subject: "Votre devis Connect & Drive — toujours d'actualité ?",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Nous revenons vers vous concernant le devis envoyé le ${new Date(quote.sentAt).toLocaleDateString("fr-FR")}.</p>
      <p>N'hésitez pas à nous contacter si vous avez des questions ou souhaitez donner suite.</p>
      ${signatureHtml}
    `,
    leadId: lead.id,
    type: "RELANCE_DEVIS",
    senderName: assignedUser ? signature : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
  });
}

// --- Règle 3 bis: séquence de relance devis (5 emails) ---
// Voir jobs/quoteReminders.js pour le calendrier. Les réponses et les clics
// sur les boutons arrivent directement chez le commercial assigné.

function ctaButton(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#5b8fe0;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;margin:6px 8px 6px 0;">${label}</a>`;
}

function formatAmount(amount) {
  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) return null;
  return Number(amount).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildQuoteFollowup(step, lead, assignedUser, amount) {
  const prenom = lead.firstName ? ` ${lead.firstName}` : "";
  const contactEmail = assignedUser?.email || "contact@connectanddrive.fr";
  const phone = (assignedUser && PHONE_BY_EMAIL[assignedUser.email]) || PHONE_BY_EMAIL["connectanddrivefr@gmail.com"];
  const telHref = `tel:${phone.replace(/\s/g, "")}`;
  const montant = formatAmount(amount);
  const mailto = (subject) => `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`;

  switch (step) {
    case 1:
      return {
        subject: "Votre devis Connect & Drive",
        body: `
          <p>Bonjour${prenom},</p>
          <p>Vous avez bien reçu votre devis pour l'installation de votre borne de recharge${montant ? `, d'un montant de <strong>${montant} € TTC</strong>` : ""}.</p>
          <p>Une question sur le devis, l'emplacement de la borne ou le déroulé de l'installation ? Répondez simplement à cet email, nous vous répondons rapidement.</p>`,
      };
    case 2:
      return {
        subject: "On fait le point sur votre devis ?",
        body: `
          <p>Bonjour${prenom},</p>
          <p>${assignedUser ? `Je suis ${assignedUser.firstName}, en charge de votre projet de borne de recharge.` : "Nous revenons vers vous au sujet de votre projet de borne de recharge."} Je vous propose un court échange pour faire le point sur votre devis : emplacement, câblage, délai d'installation…</p>
          <p>Je vous appelle dans la journée. Vous pouvez aussi me joindre directement :</p>
          <p>${ctaButton(telHref, `Appeler le ${phone}`)}</p>`,
      };
    case 3:
      return {
        subject: "N'oubliez pas votre devis",
        body: `
          <p>Bonjour${prenom},</p>
          <p>Votre devis${montant ? ` de <strong>${montant} € TTC</strong>` : ""} est toujours disponible.</p>
          <p>Nous restons à votre disposition pour vous accompagner à chaque étape de votre projet, du choix de la borne jusqu'à sa mise en service.</p>
          <p>${ctaButton(mailto("Mon devis Connect & Drive"), "Je souhaite avancer")}</p>`,
      };
    case 4:
      return {
        subject: "Des créneaux d'installation disponibles",
        body: `
          <p>Bonjour${prenom},</p>
          <p>Nos techniciens ont encore des créneaux disponibles dans les prochaines semaines près de chez vous.</p>
          <p>Validez votre devis pour réserver le vôtre :</p>
          <p>${ctaButton(mailto("Je valide mon devis"), "Valider mon devis")}</p>`,
      };
    case 5:
      return {
        subject: "On clôture votre dossier ?",
        body: `
          <p>Bonjour${prenom},</p>
          <p>Sans retour de votre part, nous clôturerons votre dossier dans quelques jours.</p>
          <p>Votre projet est simplement décalé ? Dites-le-nous, nous vous recontacterons au bon moment.</p>
          <p>${ctaButton(mailto("Je suis toujours intéressé"), "Je suis toujours intéressé")}${ctaButton(mailto("Mon projet est reporté"), "Mon projet est reporté")}</p>`,
      };
    default:
      return null;
  }
}

async function sendQuoteFollowup(step, lead, assignedUser = null, amount = null) {
  const content = buildQuoteFollowup(step, lead, assignedUser, amount);
  if (!content) return;
  const signature = getSignature(assignedUser);
  return sendEmail({
    to: lead.email,
    subject: content.subject,
    htmlContent: `${content.body}${getSignatureHtml(assignedUser)}`,
    leadId: lead.id,
    type: "RELANCE_DEVIS",
    senderName: assignedUser ? signature.replace(/<br\/>.*/, "") : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
  });
}

// Tâche d'appel interne (relances 2 et 5): envoyée au commercial assigné,
// à défaut à l'admin. Le lead est aussi marqué "À rappeler" (section Rappels).
async function sendQuoteCallTask(step, lead, assignedUser = null, amount = null) {
  const to = assignedUser?.email || process.env.ADMIN_EMAIL;
  const montant = formatAmount(amount);
  const label = step === 5 ? "Dernier appel avant clôture" : "Appel de suivi devis";
  return sendEmail({
    to,
    subject: `📞 ${label} — ${lead.firstName || ""} ${lead.lastName || ""}`,
    htmlContent: `
      <p>Bonjour ${assignedUser?.firstName || ""},</p>
      <p><strong>${label}</strong> à faire aujourd'hui : le client vient de recevoir la relance n°${step}.</p>
      <ul>
        <li>Client : ${lead.firstName || ""} ${lead.lastName || ""}</li>
        <li>Téléphone : ${lead.phone || "—"}</li>
        <li>Email : ${lead.email}</li>
        <li>Code postal : ${lead.postalCode || "—"}</li>
        ${montant ? `<li>Montant du devis : ${montant} € TTC</li>` : ""}
      </ul>
      <p>Le lead est marqué « À rappeler » dans la section Rappels du CRM.</p>`,
    leadId: lead.id,
    type: "RAPPEL_INTERNE",
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
  const signatureHtml = getSignatureHtml(assignedUser);
  return sendEmail({
    to: lead.email,
    subject: "Bienvenue chez Connect & Drive — prochaines étapes",
    htmlContent: `
      <p>Bonjour ${lead.firstName || ""},</p>
      <p>Merci pour votre confiance ! Votre dossier est validé.</p>
      <p>Prochaines étapes: un technicien vous contactera pour planifier la visite technique puis l'installation.</p>
      ${signatureHtml}
    `,
    leadId: lead.id,
    type: "CONFIRMATION_SIGNATURE",
    senderName: assignedUser ? signature : undefined,
    senderEmail: assignedUser?.email,
    replyTo: assignedUser?.email,
  });
}

// --- Section "Rappels" — relances internes, uniquement chez le commercial
// assigné (jamais l'admin en fallback: si aucun commercial n'est assigné,
// on n'envoie rien, voir jobs/visitReminders.js et jobs/photoReminders.js) ---

// Rappel J-2 avant une visite technique programmée: on demande au commercial
// de reconfirmer le rendez-vous avec le client et le technicien.
async function sendVisitReminderInternal(lead, assignedUser) {
  if (!assignedUser?.email) return; // pas de commercial assigné -> pas d'email
  const dateStr = lead.technicalVisitDate
    ? new Date(lead.technicalVisitDate).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "date non précisée";
  return sendEmail({
    to: assignedUser.email,
    subject: `Rappel: visite technique dans 2 jours — ${lead.firstName || ""} ${lead.lastName || ""}`,
    htmlContent: `
      <p>Bonjour ${assignedUser.firstName || ""},</p>
      <p>Une visite technique est programmée le <strong>${dateStr}</strong> pour ${lead.firstName || ""} ${lead.lastName || ""} (${lead.phone || lead.email}).</p>
      <p>Merci de reconfirmer ce rendez-vous avec le technicien et avec le client pour vous assurer qu'il est toujours bon.</p>
    `,
    leadId: lead.id,
    type: "RAPPEL_VISITE",
  });
}

// Relance interne 2 jours après passage en "en attente de photos": le client
// n'a toujours pas envoyé ses photos, on invite le commercial à le relancer.
async function sendPhotoReminderInternal(lead, assignedUser) {
  if (!assignedUser?.email) return; // pas de commercial assigné -> pas d'email
  return sendEmail({
    to: assignedUser.email,
    subject: `Rappel: photos non reçues — ${lead.firstName || ""} ${lead.lastName || ""}`,
    htmlContent: `
      <p>Bonjour ${assignedUser.firstName || ""},</p>
      <p>${lead.firstName || ""} ${lead.lastName || ""} (${lead.phone || lead.email}) n'a toujours pas envoyé les photos demandées.</p>
      <p>N'hésite pas à relancer le client.</p>
    `,
    leadId: lead.id,
    type: "RAPPEL_PHOTOS",
  });
}

// Version groupée: UN seul email récapitulatif par commercial, listant tous les
// leads dont les photos sont toujours attendues (évite de recevoir N emails
// d'un coup). Un log par lead est tout de même enregistré sur chaque fiche.
async function sendPhotoReminderDigest(assignedUser, leads) {
  if (!assignedUser?.email || !leads.length) return;
  const rows = leads
    .map((l) => `<li>${l.firstName || ""} ${l.lastName || ""} — ${l.phone || l.email}</li>`)
    .join("");
  const subject =
    leads.length === 1
      ? `Rappel: photos non reçues — ${leads[0].firstName || ""} ${leads[0].lastName || ""}`
      : `Rappel: photos non reçues (${leads.length} clients)`;
  await sendEmail({
    to: assignedUser.email,
    subject,
    htmlContent: `
      <p>Bonjour ${assignedUser.firstName || ""},</p>
      <p>Ces clients n'ont toujours pas envoyé les photos demandées :</p>
      <ul>${rows}</ul>
      <p>N'hésite pas à les relancer.</p>
    `,
    type: "RAPPEL_PHOTOS",
  });
  for (const l of leads) {
    await prisma.emailLog.create({
      data: { leadId: l.id, type: "RAPPEL_PHOTOS", recipient: assignedUser.email, subject, success: true },
    });
  }
}

// Rappel J-2 avant une installation programmée: on demande au commercial de
// reconfirmer le rendez-vous d'installation avec le technicien et le client.
async function sendInstallationReminderInternal(lead, assignedUser) {
  if (!assignedUser?.email) return; // pas de commercial assigné -> pas d'email
  const dateStr = lead.installationDate
    ? new Date(lead.installationDate).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "date non précisée";
  return sendEmail({
    to: assignedUser.email,
    subject: `Rappel: installation dans 2 jours — ${lead.firstName || ""} ${lead.lastName || ""}`,
    htmlContent: `
      <p>Bonjour ${assignedUser.firstName || ""},</p>
      <p>Une installation est programmée le <strong>${dateStr}</strong> pour ${lead.firstName || ""} ${lead.lastName || ""} (${lead.phone || lead.email}).</p>
      <p>Merci de reconfirmer ce rendez-vous avec le technicien et avec le client pour vous assurer qu'il est toujours bon.</p>
    `,
    leadId: lead.id,
    type: "RAPPEL_INSTALLATION",
  });
}

module.exports = {
  sendLeadConfirmation,
  sendInternalNewLeadNotif,
  sendQuoteReminder,
  sendQuoteFollowup,
  sendQuoteCallTask,
  sendInternalReminderNotif,
  sendSignatureConfirmation,
  sendVisitReminderInternal,
  sendPhotoReminderInternal,
  sendPhotoReminderDigest,
  sendInstallationReminderInternal,
};
