import { useEffect, useState } from "react";
import { api } from "../api/client";

// Suggestions courantes pour la provenance manuelle — l'utilisateur peut
// aussi taper une valeur libre non listée ici (ex: un nouveau partenaire).
const SOURCE_DETAIL_SUGGESTIONS = [
  "V2C", "Facebook", "Bouche à oreille", "Salon / événement", "Ancien client", "Parrainage",
];

export default function NewLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    address: "", postalCode: "", city: "",
    sourceDetail: "", isProfessional: false,
    notesText: "", assignedToId: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState(null);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => setUsers(null));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createLead({ ...form, assignedToId: form.assignedToId || undefined, source: "MANUEL" });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>Nouveau lead</h2>
        <div className="form-grid">
          <div>
            <label>Prénom</label>
            <input value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
          </div>
          <div>
            <label>Nom</label>
            <input value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
          </div>
          <div>
            <label>Email *</label>
            <input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} />
          </div>
          <div>
            <label>Téléphone</label>
            <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </div>
          <div>
            <label>Adresse</label>
            <input value={form.address} onChange={(e) => update("address", e.target.value)} />
          </div>
          <div>
            <label>Code postal</label>
            <input value={form.postalCode} onChange={(e) => update("postalCode", e.target.value)} />
          </div>
          <div>
            <label>Ville</label>
            <input value={form.city} onChange={(e) => update("city", e.target.value)} />
          </div>
          <div>
            <label>Provenance (précision)</label>
            <input
              list="source-detail-suggestions"
              placeholder="Ex: V2C, Facebook…"
              value={form.sourceDetail}
              onChange={(e) => update("sourceDetail", e.target.value)}
            />
            <datalist id="source-detail-suggestions">
              {SOURCE_DETAIL_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.isProfessional}
            onChange={(e) => update("isProfessional", e.target.checked)}
          />
          Client professionnel (pro)
        </label>

        {users && users.length > 0 && (
          <>
            <label>Commercial assigné (optionnel)</label>
            <select value={form.assignedToId} onChange={(e) => update("assignedToId", e.target.value)}>
              <option value="">— Non assigné —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
              ))}
            </select>
          </>
        )}

        <label>Notes</label>
        <textarea value={form.notesText} onChange={(e) => update("notesText", e.target.value)} rows={3} />

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Création…" : "Créer le lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
