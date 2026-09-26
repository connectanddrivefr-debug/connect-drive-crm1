// Intégration Revolut Business (Merchant API) — liens de paiement pour les
// acomptes et les soldes, avec traçabilité automatique via webhook.
//
// Pourquoi l'API plutôt qu'un lien créé à la main dans le dashboard Revolut:
// un lien créé à la main ne permet de saisir que le nom/prénom du client, pas
// son email — impossible de savoir automatiquement qui a payé. En créant
// l'Order via l'API, on attache une référence interne invisible au client
// (merchant_order_data.order_id = "<leadId>-DEPOSIT" ou "<leadId>-SOLDE").
// Revolut renvoie cette même référence dans l'événement webhook
// ORDER_COMPLETED (champ merchant_order_ext_ref), ce qui permet de retrouver
// le bon lead sans avoir besoin d'aucune donnée personnelle du client.
//
// Clé API à récupérer dans Revolut Business > API > API Commerçant, à coller
// dans backend/.env sous REVOLUT_API_KEY (clé secrète de production).
const crypto = require("crypto");

const MERCHANT_API_BASE = "https://merchant.revolut.com/api";
const API_VERSION = "2026-08-17";

function getApiKey() {
  const key = process.env.REVOLUT_API_KEY;
  if (!key) throw new Error("REVOLUT_API_KEY non configurée");
  return key;
}

// Crée une Order Revolut et renvoie son checkout_url — c'est ce lien qu'on
// envoie au client (format https://checkout.revolut.com/payment-link/<token>).
// amount: montant en euros (nombre, ex: 500.00) — converti en centimes pour
// l'API (unité mineure, entier).
// reference: référence interne unique, ex. "<leadId>-DEPOSIT" ou "-SOLDE".
async function createPaymentOrder({ amount, reference, description, customerEmail, customerName }) {
  const amountMinorUnits = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountMinorUnits) || amountMinorUnits <= 0) {
    throw new Error("Montant invalide pour la création du lien de paiement");
  }

  const body = {
    amount: amountMinorUnits,
    currency: "EUR",
    description,
    merchant_order_data: { order_id: reference, description },
  };
  if (customerEmail || customerName) {
    body.customer = {
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(customerName ? { full_name: customerName } : {}),
    };
  }

  const resp = await fetch(`${MERCHANT_API_BASE}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Revolut-Api-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Revolut API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return {
    orderId: data.id,
    checkoutUrl: data.checkout_url,
    token: data.token,
    state: data.state,
  };
}

// Enregistre un webhook auprès de Revolut (opération unique, à exécuter une
// fois après déploiement — voir script scripts/registerRevolutWebhook.js).
// Renvoie signing_secret, à stocker dans REVOLUT_WEBHOOK_SECRET.
async function createWebhook({ url, events }) {
  const resp = await fetch(`${MERCHANT_API_BASE}/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Revolut-Api-Version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, events }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Revolut API error ${resp.status}: ${text}`);
  }

  return resp.json(); // { id, url, events, signing_secret }
}

// Vérifie la signature HMAC-SHA256 d'un événement webhook Revolut.
// Algorithme documenté par Revolut:
//   payload_to_sign = "v1." + timestamp + "." + raw_body
//   signature_attendue = "v1=" + HMAC_SHA256(signing_secret, payload_to_sign)
// Le header Revolut-Signature peut contenir plusieurs signatures séparées par
// une virgule (rotation de clé) — on accepte si l'une correspond.
function verifyWebhookSignature({ rawBody, timestampHeader, signatureHeader }) {
  const secret = process.env.REVOLUT_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[Revolut webhook] REVOLUT_WEBHOOK_SECRET non configuré — signature non vérifiée");
    return true; // comportement identique aux autres webhooks du projet en dev
  }
  if (!timestampHeader || !signatureHeader) return false;

  // Anti-rejeu: refuse les événements dont l'horodatage a plus de 5 minutes.
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return false;
  }

  const payloadToSign = `v1.${timestampHeader}.${rawBody}`;
  const expected =
    "v1=" +
    crypto.createHmac("sha256", secret).update(payloadToSign).digest("hex");

  const candidates = signatureHeader.split(",").map((s) => s.trim());
  return candidates.some((candidate) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

module.exports = { createPaymentOrder, createWebhook, verifyWebhookSignature };
