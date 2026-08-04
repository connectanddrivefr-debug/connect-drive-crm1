// Webhooks publics (pas d'auth JWT — sécurisés autrement: signature Meta / verify token)
const express = require("express");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { sendLeadConfirmation, sendInternalNewLeadNotif } = require("../integrations/brevo");

const router = express.Router();

// ---------------------------------------------------------------------------
// Meta Lead Ads (Facebook/Instagram) — §4.2 du cahier des charges
// ---------------------------------------------------------------------------
// 1. Étape de vérification (GET) exigée par Meta lors de la config du webhook
//    dans Meta App Dashboard > Webhooks > Page > leadgen
router.get("/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2. Réception temps réel des nouveaux leads (POST)
//    Meta n'envoie que le leadgen_id — il faut ensuite appeler la Graph API
//    pour récupérer les champs du formulaire (nom, email, code postal, etc.)
//    avec META_PAGE_ACCESS_TOKEN. Voir README section Meta Lead Ads.
router.post("/meta", async (req, res) => {
  // Vérification de la signature (X-Hub-Signature-256) recommandée en prod
  if (process.env.META_APP_SECRET) {
    const signature = req.headers["x-hub-signature-256"];
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", process.env.META_APP_SECRET)
        .update(req.rawBody || JSON.stringify(req.body))
        .digest("hex");
    if (signature !== expected) {
      console.warn("[Meta webhook] signature invalide — requête ignorée");
      return res.sendStatus(200); // toujours 200 pour Meta, mais on ignore le traitement
    }
  }

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "leadgen") continue;
        const { leadgen_id: leadgenId, form_id: formId, ad_id: adId } = change.value || {};
        try {
          const leadData = await fetchMetaLeadFields(leadgenId);
          await createLeadFromMeta(leadData, { leadgenId, formId, adId });
        } catch (err) {
          // Ne fait pas échouer tout le webhook: on crée quand même un lead
          // minimal pour ne perdre aucun contact, à compléter manuellement.
          console.error("[Meta webhook] échec récupération détails, création lead minimal:", err.message);
          await createFallbackLead({ leadgenId, formId, adId, error: err.message });
        }
      }
    }
  } catch (err) {
    console.error("[Meta webhook] erreur de traitement:", err.message);
  }

  // Toujours répondre 200 rapidement, sinon Meta désactive le webhook
  res.sendStatus(200);
});

// Appelle la Graph API pour récupérer les champs du formulaire à partir du leadgen_id
async function fetchMetaLeadFields(leadgenId) {
  if (!process.env.META_PAGE_ACCESS_TOKEN) {
    throw new Error("META_PAGE_ACCESS_TOKEN non configuré");
  }
  const url = `https://graph.facebook.com/v20.0/${leadgenId}?access_token=${process.env.META_PAGE_ACCESS_TOKEN}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Graph API error ${resp.status}`);
  const data = await resp.json();

  // data.field_data est un tableau [{ name: 'email', values: [...] }, ...]
  // Champs standards Meta: full_name, email, phone_number, post_code, city...
  // Toute autre question (personnalisée, ex: "type d'installation") est
  // conservée telle quelle et ajoutée aux notes du lead.
  const fields = {};
  for (const f of data.field_data || []) {
    fields[f.name] = f.values?.[0];
  }
  return fields;
}

const KNOWN_FIELD_KEYS = new Set([
  "full_name", "first_name", "last_name", "email",
  "phone_number", "post_code", "zip_code", "city",
]);

function splitFullName(fullName) {
  if (!fullName) return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

// Construit un texte de notes à partir des questions personnalisées du
// formulaire (tout ce qui n'est pas un champ standard reconnu).
function buildNotesFromCustomFields(fields) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (KNOWN_FIELD_KEYS.has(key)) continue;
    lines.push(`${key}: ${value}`);
  }
  return lines.length ? lines.join("\n") : null;
}

async function createLeadFromMeta(fields, meta = {}) {
  const { firstName, lastName } = fields.first_name
    ? { firstName: fields.first_name, lastName: fields.last_name }
    : splitFullName(fields.full_name);

  const lead = await prisma.lead.create({
    data: {
      firstName,
      lastName,
      email: fields.email,
      phone: fields.phone_number,
      postalCode: fields.post_code || fields.zip_code,
      city: fields.city,
      source: "META",
      status: "NOUVEAU",
      notesText: buildNotesFromCustomFields(fields),
      statusHistory: { create: { toStatus: "NOUVEAU", changedBy: "meta_webhook" } },
    },
  });

  try {
    if (lead.email) {
      await sendLeadConfirmation(lead);
      await sendInternalNewLeadNotif(lead);
    }
  } catch (err) {
    console.error("[Brevo] échec envoi email (lead Meta):", err.message);
  }

  return lead;
}

// Lead minimal créé quand la récupération des détails Graph API échoue
// (ex: permission manquante) — évite de perdre le contact, à compléter à la main.
async function createFallbackLead({ leadgenId, formId, adId, error }) {
  return prisma.lead.create({
    data: {
      email: `lead-meta-${leadgenId || Date.now()}@a-completer.local`,
      source: "META",
      status: "NOUVEAU",
      notesText: [
        "⚠️ Détails non récupérés automatiquement (à compléter manuellement).",
        leadgenId ? `leadgen_id: ${leadgenId}` : null,
        formId ? `form_id: ${formId}` : null,
        adId ? `ad_id: ${adId}` : null,
        error ? `Erreur: ${error}` : null,
      ].filter(Boolean).join("\n"),
      statusHistory: { create: { toStatus: "NOUVEAU", changedBy: "meta_webhook_fallback" } },
    },
  });
}

module.exports = router;
