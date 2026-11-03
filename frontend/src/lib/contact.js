// Aides d'affichage pour la refonte visuelle v2: liens Appeler / WhatsApp,
// message WhatsApp prérempli selon l'étape, et badge d'urgence calculé à
// partir des champs déjà présents sur le lead (aucune donnée nouvelle).

// Numéro au format international sans "+" pour wa.me.
// "06 12 34 56 78" -> "33612345678" ; "+212 6..." -> "2126..." ; "0033 6..." -> "336..."
export function toWhatsAppNumber(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length === 10 && digits.startsWith("0")) digits = `33${digits.slice(1)}`;
  digits = digits.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function firstNameOf(lead) {
  return (lead.firstName || "").trim() || (lead.lastName || "").trim();
}

export function whatsAppMessage(lead, senderFirstName) {
  const hello = firstNameOf(lead) ? `Bonjour ${firstNameOf(lead)}` : "Bonjour";
  const me = senderFirstName ? `c'est ${senderFirstName} de Connect & Drive` : "c'est Connect & Drive";
  switch (lead.status) {
    case "DEVIS_ENVOYE":
      return `${hello}, ${me}. Avez-vous pu consulter votre devis pour votre borne de recharge ? Je reste disponible pour toute question.`;
    case "EN_ATTENTE":
      return `${hello}, ${me}. Je reviens vers vous au sujet de votre projet de borne de recharge : avez-vous du nouveau de votre côté ?`;
    case "SIGNE":
      if (lead.installationDate) {
        const d = new Date(lead.installationDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        return `${hello}, ${me}. Nous vous confirmons votre installation le ${d}.`;
      }
      return `${hello}, ${me}. Merci pour votre confiance ! Nous revenons vers vous pour planifier l'installation de votre borne.`;
    default:
      return `${hello}, ${me}. Suite à votre demande pour une borne de recharge, quand seriez-vous disponible pour un rapide échange ?`;
  }
}

export function whatsAppUrl(lead, senderFirstName) {
  const number = toWhatsAppNumber(lead.phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(whatsAppMessage(lead, senderFirstName))}`;
}

export function initials(user) {
  if (!user) return "";
  // Lettres uniquement (ex. nom "-" pour Ilham → "I" et non "I-").
  const letter = (s) => (String(s || "").match(/\p{L}/u) || [""])[0];
  const a = letter(user.firstName);
  const b = letter(user.lastName);
  return (a + b).toUpperCase() || "?";
}

const DAY = 24 * 60 * 60 * 1000;

function daysSince(date, now) {
  return Math.floor((now - new Date(date).getTime()) / DAY);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Renvoie { text, tone: "red"|"orange"|"blue"|"green" } ou null.
// Le rappel manuel ("Client à rappeler" avec une date) passe en priorité.
export function urgencyOf(lead, now = Date.now()) {
  const nowDate = new Date(now);

  if (lead.callbackRequested && lead.callbackDate) {
    const cb = new Date(lead.callbackDate);
    if (cb.getTime() < now && !sameDay(cb, nowDate)) return { text: `Rappel en retard · ${daysSince(cb, now)} j`, tone: "red" };
    if (sameDay(cb, nowDate)) {
      return { text: `Rappel aujourd'hui ${cb.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`, tone: "orange" };
    }
  }

  switch (lead.status) {
    case "NOUVEAU": {
      const hours = Math.floor((now - new Date(lead.createdAt).getTime()) / (60 * 60 * 1000));
      if (hours < 24) return { text: hours < 1 ? "Reçu à l'instant" : `Reçu il y a ${hours} h`, tone: "blue" };
      const d = Math.floor(hours / 24);
      return { text: `Pas encore contacté · ${d} j`, tone: d >= 2 ? "red" : "orange" };
    }
    case "DEVIS_ENVOYE": {
      if (!lead.quoteFollowupStartedAt) return null;
      const d = daysSince(lead.quoteFollowupStartedAt, now);
      if (d >= 6) return { text: `Sans réponse · ${d} j`, tone: "red" };
      return { text: d === 0 ? "Devis envoyé aujourd'hui" : `Devis envoyé il y a ${d} j`, tone: "blue" };
    }
    case "EN_ATTENTE": {
      if (lead.onHoldUntil && new Date(lead.onHoldUntil).getTime() <= now) return { text: "À reprendre", tone: "orange" };
      return null;
    }
    case "SIGNE": {
      if (lead.installationStatus !== "PROGRAMMEE") return { text: "Installation à planifier", tone: "green" };
      return null;
    }
    default:
      return null;
  }
}

export function isUrgent(lead, now = Date.now()) {
  const u = urgencyOf(lead, now);
  return Boolean(u && (u.tone === "red" || u.tone === "orange"));
}
