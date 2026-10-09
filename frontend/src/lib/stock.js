// Constantes partagées du module stock.
export const SUPPLIERS = ["V2C", "Smappee", "Teltonika", "Tesla", "Autre"];

export const MODELS_BY_SUPPLIER = {
  V2C: ["V2C Trydan", "V2C Trydan 7,4 kW câble 5 m (TRY32-1-OL5-F)", "V2C Trydan Pro", "V2C Freedom Pro"],
  Smappee: ["Smappee EV Wall", "Smappee EV One"],
  Teltonika: ["Teltonika TeltoCharge"],
  Tesla: ["Tesla Wall Connector"],
  Autre: [],
};

export const ALL_MODELS = Object.values(MODELS_BY_SUPPLIER).flat();

// Codes-barres produit (EAN) imprimés sur les étiquettes des cartons: ils
// identifient la RÉFÉRENCE (identique sur tous les cartons du même modèle),
// pas la borne. Scanné pendant une réception, un EAN connu sélectionne
// automatiquement le modèle; seul le S/N est enregistré comme numéro de série.
// À compléter au fil des nouvelles références reçues.
export const EAN_MODELS = {
  "3770038367006": "V2C Trydan 7,4 kW câble 5 m (TRY32-1-OL5-F)",
};

export const STATUS_LABELS = {
  EN_STOCK: "Au dépôt",
  CHEZ_TECHNICIEN: "Chez technicien",
  INSTALLEE: "Installée",
  RETOUR_SAV: "Retour SAV",
};

export const MOVEMENT_LABELS = {
  RECEPTION: "Réception au dépôt",
  DOTATION: "Remise au technicien",
  RETOUR_DEPOT: "Retour au dépôt",
  INSTALLATION: "Installation chez le client",
  RETOUR_SAV: "Retour SAV fournisseur",
  CORRECTION: "Correction",
};

export function techName(t) {
  if (!t) return "";
  return `${t.firstName}${t.lastName ? ` ${t.lastName}` : ""}`;
}

export function leadLabel(l) {
  if (!l) return "";
  const name = `${l.firstName || ""} ${l.lastName || ""}`.trim() || "Client";
  return [l.company, name, l.city].filter(Boolean).join(" — ");
}

// Code purement numérique de 8, 12, 13 ou 14 chiffres: c'est le plus souvent
// le code-barres produit (EAN/UPC, identique sur tous les cartons du même
// modèle), pas le numéro de série — on le signale pour vérification.
export function looksLikeProductCode(code) {
  return /^(\d{8}|\d{12,14})$/.test(code);
}

export function fmtDate(d, withTime = false) {
  if (!d) return "";
  return new Date(d).toLocaleString("fr-FR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" });
}
