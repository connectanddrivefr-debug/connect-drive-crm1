// Meta Conversions API — envoi côté serveur des événements de conversion
// (Lead à la création, Purchase à la signature) pour optimiser le ciblage
// publicitaire vers les vrais clients plutôt que les simples clics.
// Nécessite META_PIXEL_ID et META_CAPI_ACCESS_TOKEN (Gestionnaire d'évènements
// Meta > Paramètres > Conversions API > Générer un jeton d'accès).
const crypto = require("crypto");

function sha256(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return crypto.createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");
}

function normalizedPhone(phone) {
  if (!phone) return undefined;
  // Meta attend un numéro sans espaces/symboles, idéalement au format E.164.
  // On retire tout sauf les chiffres; les numéros FR à 10 chiffres reçoivent
  // le préfixe pays 33 (sans le 0 initial), sinon on envoie tel quel.
  const digits = String(phone).replace(/[^0-9]/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `33${digits.slice(1)}`;
  return digits;
}

// Construit la valeur "fbc" (Facebook Click ID cookie) attendue par Meta à
// partir d'un simple fbclid brut récupéré dans l'URL — format exigé:
// fb.<subdomainIndex>.<timestamp_ms>.<fbclid>. Si la valeur reçue est déjà
// au format fbc (commence par "fb."), elle est utilisée telle quelle.
function normalizedFbc(fbc, fbclid) {
  if (fbc && String(fbc).startsWith("fb.")) return String(fbc);
  if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
  return undefined;
}

// eventName: "Lead" (nouvelle demande) ou "Purchase" (lead signé/client)
// context (optionnel): signaux web pour un meilleur rattachement publicitaire
//   - sourceUrl: URL de la page où la conversion a eu lieu (ex: page "merci")
//   - clientIp / userAgent: IP et user-agent RÉELS du visiteur (pas du serveur)
//   - fbc / fbclid: identifiant de clic publicitaire Meta (le plus important
//     pour rattacher précisément un lead à la bonne pub/campagne)
//   - fbp: cookie navigateur Meta (_fbp), complémentaire à fbc
async function sendMetaConversionEvent(eventName, lead, customData = {}, context = {}) {
  // Deux ensembles de données possibles, envoyés en parallèle s'ils sont
  // configurés: le pixel web historique (META_PIXEL_ID) et l'ensemble de
  // données CRM dédié à l'intégration "Prospects qualifiés" du Gestionnaire
  // de publicités (META_CRM_DATASET_ID) — cf. Ads Manager > Recommandations
  // > "Associez votre CRM à l'API Conversions de Meta".
  const targets = [
    { pixelId: process.env.META_PIXEL_ID, accessToken: process.env.META_CAPI_ACCESS_TOKEN },
    { pixelId: process.env.META_CRM_DATASET_ID, accessToken: process.env.META_CRM_ACCESS_TOKEN },
  ].filter((t) => t.pixelId && t.accessToken);

  if (targets.length === 0) {
    // Intégration pas encore configurée: on ignore silencieusement, ce n'est
    // jamais bloquant pour la création/mise à jour d'un lead.
    return;
  }

  const fbc = normalizedFbc(context.fbc, context.fbclid);

  const userData = {
    em: sha256(lead.email) ? [sha256(lead.email)] : undefined,
    ph: normalizedPhone(lead.phone) ? [sha256(normalizedPhone(lead.phone))] : undefined,
    fn: sha256(lead.firstName) ? [sha256(lead.firstName)] : undefined,
    ln: sha256(lead.lastName) ? [sha256(lead.lastName)] : undefined,
    ct: sha256(lead.city) ? [sha256(lead.city)] : undefined,
    zp: sha256(lead.postalCode) ? [sha256(lead.postalCode)] : undefined,
    country: [sha256("france")],
    // external_id: identifiant unique du lead côté CRM (haché) — signal de
    // correspondance supplémentaire recommandé par Meta, indépendant de
    // l'email/téléphone (utile si l'un des deux est absent ou mal formé).
    external_id: sha256(lead.id) ? [sha256(lead.id)] : undefined,
    // Signaux web transmis par le site (quand disponibles): bien plus
    // fiables que la seule correspondance email/téléphone pour rattacher
    // l'évènement au bon clic publicitaire.
    client_ip_address: context.clientIp || undefined,
    client_user_agent: context.userAgent || undefined,
    fbc: fbc || undefined,
    fbp: context.fbp || undefined,
  };
  Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

  // Sans email ni téléphone, Meta ne pourra faire aucune correspondance:
  // pas la peine d'envoyer l'évènement.
  if (!userData.em && !userData.ph) return;

  // action_source: "website" quand on a un vrai contexte de navigation (URL
  // de la page + fbc/fbclid ou IP/user-agent du visiteur) — permet à Meta un
  // rattachement précis au clic publicitaire. Sinon "system_generated", le
  // schéma de l'intégration "Associer votre CRM" du gestionnaire d'évènements
  // (évènement créé côté CRM sans contexte de navigation directe).
  const hasWebContext = Boolean(fbc || context.userAgent || context.clientIp || context.sourceUrl);
  const actionSource = hasWebContext ? "website" : "system_generated";

  const payload = {
    data: [
      {
        event_name: eventName,
        // event_id: identifiant unique et stable de cet évènement (même lead
        // + même type d'évènement = même id), pour que Meta déduplique
        // proprement en cas de renvoi/retry plutôt que de compter deux fois.
        event_id: `${eventName.toLowerCase()}-${lead.id}`,
        event_time: Math.floor(Date.now() / 1000),
        action_source: actionSource,
        ...(actionSource === "website"
          ? { event_source_url: context.sourceUrl || "https://connectndrive.fr/merci" }
          : {}),
        user_data: userData,
        custom_data: {
          event_source: "crm",
          lead_event_source: "Connect & Drive CRM",
          ...customData,
        },
      },
    ],
  };

  await Promise.all(
    targets.map(async ({ pixelId, accessToken }) => {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${accessToken}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.error(`[MetaCAPI] échec envoi événement "${eventName}" (${pixelId}):`, JSON.stringify(json));
        }
      } catch (err) {
        console.error(`[MetaCAPI] exception envoi événement "${eventName}" (${pixelId}):`, err.message);
      }
    })
  );
}

module.exports = { sendMetaConversionEvent };
