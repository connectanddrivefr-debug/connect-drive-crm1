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

// ---------------------------------------------------------------------------
// Webflow — formulaire de devis du site (webhook natif "Form submission")
// ---------------------------------------------------------------------------
// Configuration côté Webflow: Site settings > Integrations > Webhooks >
// Add webhook > Trigger = "Form submission" > URL = <API_URL>/api/webhooks/webflow
// Webflow affiche une "Secret key" une seule fois à la création: à copier
// dans la variable d'environnement WEBFLOW_WEBHOOK_SECRET.
function verifyWebflowSignature(req) {
  if (!process.env.WEBFLOW_WEBHOOK_SECRET) return true; // pas de secret configuré -> pas de vérification (dev)
  const timestamp = req.headers["x-webflow-timestamp"];
  const signature = req.headers["x-webflow-signature"];
  if (!timestamp || !signature) return false;

  // Rejette les requêtes trop anciennes (protection anti-rejeu)
  if (Math.abs(Date.now() - parseInt(timestamp, 10)) > 5 * 60 * 1000) return false;

  const body = req.rawBody || JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", process.env.WEBFLOW_WEBHOOK_SECRET)
    .update(`${timestamp}:${body}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// Le nom exact des champs dépend de ce qui est configuré dans le formulaire
// Webflow (labels visibles). On teste plusieurs variantes FR/EN courantes.
function pickField(data, candidates) {
  const keys = Object.keys(data);
  for (const candidate of candidates) {
    const match = keys.find((k) => k.trim().toLowerCase() === candidate);
    if (match && data[match]) return String(data[match]).trim();
  }
  return null;
}

function mapWebflowFields(data) {
  const firstName = pickField(data, ["prénom", "prenom", "first name", "firstname"]);
  const lastName = pickField(data, ["nom", "last name", "lastname"]);
  const email = pickField(data, ["email", "e-mail", "adresse email"]);
  const phone = pickField(data, ["téléphone", "telephone", "numéro de téléphone", "phone", "phone number"]);
  const postalCode = pickField(data, ["code postal", "postal code", "zip", "zip code"]);
  const city = pickField(data, ["ville", "city"]);

  const usedKeys = new Set(["prénom", "prenom", "first name", "firstname", "nom", "last name", "lastname",
    "email", "e-mail", "adresse email", "téléphone", "telephone", "numéro de téléphone", "phone", "phone number",
    "code postal", "postal code", "zip", "zip code", "ville", "city"]);
  const notesLines = Object.entries(data)
    .filter(([k]) => !usedKeys.has(k.trim().toLowerCase()))
    .map(([k, v]) => `${k}: ${v}`);

  return { firstName, lastName, email, phone, postalCode, city, notesText: notesLines.length ? notesLines.join("\n") : null };
}

router.post("/webflow", async (req, res) => {
  if (!verifyWebflowSignature(req)) {
    console.warn("[Webflow webhook] signature invalide — requête ignorée");
    return res.sendStatus(200);
  }

  try {
    if (req.body.triggerType === "form_submission") {
      const data = req.body.payload?.data || {};
      const mapped = mapWebflowFields(data);

      if (!mapped.email) {
        console.warn("[Webflow webhook] soumission sans email détecté, ignorée:", JSON.stringify(data));
      } else {
        // Anti-doublon: même email + source WEBFLOW dans les 5 dernières minutes
        // (Webflow peut renvoyer le même événement en cas de retry réseau)
        const recent = await prisma.lead.findFirst({
          where: {
            email: mapped.email,
            source: "WEBFLOW",
            createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
          },
        });

        if (!recent) {
          const lead = await prisma.lead.create({
            data: {
              ...mapped,
              source: "WEBFLOW",
              status: "NOUVEAU",
              statusHistory: { create: { toStatus: "NOUVEAU", changedBy: "webflow_webhook" } },
            },
          });

          try {
            await sendLeadConfirmation(lead);
            await sendInternalNewLeadNotif(lead);
          } catch (err) {
            console.error("[Brevo] échec envoi email (lead Webflow):", err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error("[Webflow webhook] erreur de traitement:", err.message);
  }

  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// Simulateur de devis — connectndrive.fr (2e site, Next.js hébergé sur Netlify)
// ---------------------------------------------------------------------------
// Le site appelle directement cette URL depuis son code serveur (Server
// Action / route handler Next.js) à la soumission du formulaire final du
// simulateur. Authentification par secret partagé (header x-webhook-secret),
// à définir dans SIMULATEUR_WEBHOOK_SECRET et à renseigner côté site.
// Accepte un nombre (1471.9) ou une chaîne formatée FR ("1 471,90 €") et
// renvoie un nombre, ou null si non interprétable.
function parsePrice(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/[€\s ]/g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

router.post("/simulateur", async (req, res) => {
  if (process.env.SIMULATEUR_WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"];
    if (provided !== process.env.SIMULATEUR_WEBHOOK_SECRET) {
      console.warn("[Simulateur webhook] secret invalide — requête refusée");
      return res.status(401).json({ error: "Secret invalide" });
    }
  }

  try {
    const {
      prenom, nom, email, telephone,
      adresse, codePostal, ville, societe,
      answers, // détail des réponses du simulateur (objet ou tableau), optionnel
      // prix TTC affiché au client en fin de simulateur (nombre ou "1 471,90 €").
      // Le site envoie ce champ sous le nom "prix" — on accepte aussi
      // "prixEstimation" par tolérance si ça change plus tard.
      prix, prixEstimation,
    } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Email requis" });
    }

    const estimatedPrice = parsePrice(prix !== undefined ? prix : prixEstimation);

    // Anti-doublon: même email + source SIMULATEUR dans les 5 dernières minutes
    const recent = await prisma.lead.findFirst({
      where: {
        email,
        source: "SIMULATEUR",
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
      },
    });
    if (recent) {
      // Si le prix n'avait pas encore été reçu (ex: doublon de retry réseau
      // avant que le calcul ne soit prêt), on le complète.
      if (estimatedPrice !== null && recent.estimatedPrice === null) {
        await prisma.lead.update({ where: { id: recent.id }, data: { estimatedPrice } });
      }
      return res.status(200).json({ ok: true, deduped: true, leadId: recent.id });
    }

    const notesLines = [];
    if (societe) notesLines.push(`Société: ${societe}`);
    if (answers) {
      try {
        notesLines.push(
          "Réponses simulateur:\n" +
            (typeof answers === "string" ? answers : JSON.stringify(answers, null, 2))
        );
      } catch {
        // ignore si non sérialisable
      }
    }

    const lead = await prisma.lead.create({
      data: {
        firstName: prenom || null,
        lastName: nom || null,
        email,
        phone: telephone || null,
        address: adresse || null,
        postalCode: codePostal || null,
        city: ville || null,
        source: "SIMULATEUR",
        status: "NOUVEAU",
        estimatedPrice,
        notesText: notesLines.length ? notesLines.join("\n\n") : null,
        statusHistory: { create: { toStatus: "NOUVEAU", changedBy: "simulateur_webhook" } },
      },
    });

    try {
      await sendLeadConfirmation(lead);
      await sendInternalNewLeadNotif(lead);
    } catch (err) {
      console.error("[Brevo] échec envoi email (lead Simulateur):", err.message);
    }

    res.status(201).json({ ok: true, leadId: lead.id });
  } catch (err) {
    console.error("[Simulateur webhook] erreur de traitement:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Mise à jour du prix quand le client active le bonus -100€ après coup
// (le bonus est un vrai choix, pas systématique — l'appel initial /simulateur
// a déjà créé le lead avec le prix de base). À appeler côté serveur de
// connectndrive.fr (jamais depuis le navigateur, pour ne pas exposer le
// secret), avec le leadId renvoyé par l'appel initial.
router.post("/simulateur/prix", async (req, res) => {
  if (process.env.SIMULATEUR_WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"];
    if (provided !== process.env.SIMULATEUR_WEBHOOK_SECRET) {
      console.warn("[Simulateur webhook] secret invalide — requête refusée (maj prix)");
      return res.status(401).json({ error: "Secret invalide" });
    }
  }

  try {
    const { leadId, prix, prixEstimation } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "leadId requis" });

    const estimatedPrice = parsePrice(prix !== undefined ? prix : prixEstimation);
    if (estimatedPrice === null) return res.status(400).json({ error: "prix invalide" });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.source !== "SIMULATEUR") {
      return res.status(404).json({ error: "Lead introuvable" });
    }

    await prisma.lead.update({ where: { id: leadId }, data: { estimatedPrice } });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[Simulateur webhook] erreur maj prix:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = router;
