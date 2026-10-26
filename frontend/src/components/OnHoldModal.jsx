import { useState } from "react";

// Passage d'un lead en "En attente" : le client n'est pas perdu, il attend
// quelque chose (son véhicule, un financement…). Les relances automatiques
// de devis s'arrêtent; si une date de reprise est choisie, le lead remonte
// dans "Clients à rappeler" (page Rappels) à cette date.
export const ON_HOLD_REASONS = [
  "Attend la livraison de son véhicule",
  "Attend un financement / une aide",
  "Attend l'accord de la copropriété",
  "Projet reporté par le client",
];

function toDateInput(value) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export default function OnHoldModal({ lead, onClose, onConfirm }) {
  const initialReason = lead?.onHoldReason || "";
  const isPreset = ON_HOLD_REASONS.includes(initialReason);
  const [reason, setReason] = useState(isPreset || !initialReason ? initialReason || ON_HOLD_REASONS[0] : "AUTRE");
  const [customReason, setCustomReason] = useState(isPreset ? "" : initialReason);
  const [until, setUntil] = useState(toDateInput(lead?.onHoldUntil));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const finalReason = reason === "AUTRE" ? customReason.trim() : reason;
      // Date de reprise à 9h (heure locale) pour qu'elle apparaisse le matin.
      const untilIso = until ? new Date(`${until}T09:00:00`).toISOString() : null;
      await onConfirm({ onHoldReason: finalReason || null, onHoldUntil: untilIso });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const nom = lead ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email : "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Mettre en attente</h2>
        {nom && <p style={{ marginTop: 0, color: "var(--muted)" }}>{nom}</p>}
        <p style={{ fontSize: 13 }}>
          Les relances automatiques de devis seront suspendues. Le lead n'est pas compté comme perdu.
        </p>

        <label>Motif</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {ON_HOLD_REASONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
          <option value="AUTRE">Autre…</option>
        </select>
        {reason === "AUTRE" && (
          <input
            type="text"
            placeholder="Précisez le motif"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            style={{ marginTop: 8 }}
          />
        )}

        <label>Recontacter le (optionnel)</label>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Enregistrement…" : "Mettre en attente"}
          </button>
        </div>
      </form>
    </div>
  );
}
