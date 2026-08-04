// Intégration Webflow — §4.1 du cahier des charges.
// Webflow n'a pas de webhook natif ici, donc on lit les notifications par email:
// recherche Gmail `from:notifications@webflow.io`, extraction nom + email,
// création automatique du lead avec statut "Nouveau".
//
// Nécessite un projet Google Cloud + OAuth consenti une fois (voir README),
// puis un GMAIL_REFRESH_TOKEN valable en continu.
//
// Lancer en polling périodique (cron toutes les 5-10 min) via `npm run webflow:poll`
// ou intégré au serveur (voir server.js).

const { google } = require("googleapis");
const prisma = require("../lib/prisma");
const { sendLeadConfirmation, sendInternalNewLeadNotif } = require("./brevo");

function getGmailClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oAuth2Client });
}

// Parsing simple du corps de l'email de notification Webflow.
// À ajuster une fois un email réel Webflow examiné (le format peut varier
// selon le formulaire). On cherche un pattern "Nom: X" / "Email: Y".
function parseWebflowNotification(subject, bodyText) {
  const nameMatch = bodyText.match(/(?:name|nom)\s*[:\-]\s*(.+)/i);
  const emailMatch = bodyText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phoneMatch = bodyText.match(/(?:phone|t[ée]l[ée]phone)\s*[:\-]\s*([\d +().-]{6,})/i);
  const postalMatch = bodyText.match(/(?:postal|zip)\s*[:\-]\s*(\d{4,5})/i);

  if (!emailMatch) return null;

  const fullName = nameMatch ? nameMatch[1].trim() : "";
  const [firstName, ...rest] = fullName.split(" ");

  return {
    firstName: firstName || null,
    lastName: rest.join(" ") || null,
    email: emailMatch[0],
    phone: phoneMatch ? phoneMatch[1].trim() : null,
    postalCode: postalMatch ? postalMatch[1] : null,
  };
}

function getBody(payload) {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }
  for (const part of payload.parts || []) {
    const text = getBody(part);
    if (text) return text;
  }
  return "";
}

async function pollWebflowLeads() {
  const gmail = getGmailClient();
  const query = process.env.GMAIL_WATCH_QUERY || "from:notifications@webflow.io is:unread";

  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 20 });
  const messages = list.data.messages || [];

  let created = 0;
  for (const msg of messages) {
    const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
    const headers = full.data.payload.headers || [];
    const subject = headers.find((h) => h.name === "Subject")?.value || "";
    const bodyText = getBody(full.data.payload);

    const parsed = parseWebflowNotification(subject, bodyText);
    if (!parsed) {
      console.warn(`[Webflow] email ${msg.id} ignoré: email introuvable dans le corps`);
      continue;
    }

    // Évite les doublons si l'email a déjà été traité (déjà un lead récent avec cet email + source Webflow)
    const existing = await prisma.lead.findFirst({
      where: { email: parsed.email, source: "WEBFLOW" },
    });
    if (existing) continue;

    const lead = await prisma.lead.create({
      data: {
        ...parsed,
        source: "WEBFLOW",
        status: "NOUVEAU",
        statusHistory: { create: { toStatus: "NOUVEAU", changedBy: "webflow_gmail_poll" } },
      },
    });
    created += 1;

    try {
      await sendLeadConfirmation(lead);
      await sendInternalNewLeadNotif(lead);
    } catch (err) {
      console.error("[Brevo] échec envoi email (lead Webflow):", err.message);
    }

    // Marquer le mail comme lu pour ne pas le retraiter
    await gmail.users.messages.modify({
      userId: "me",
      id: msg.id,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
  }

  return created;
}

if (require.main === module) {
  require("dotenv").config();
  pollWebflowLeads()
    .then((n) => {
      console.log(`Terminé: ${n} nouveau(x) lead(s) Webflow créé(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { pollWebflowLeads };
