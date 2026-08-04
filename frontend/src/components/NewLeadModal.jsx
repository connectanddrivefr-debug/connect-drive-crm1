import { useState } from "react";
import { api } from "../api/client";

export default function NewLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    address: "", postalCode: "", city: "", notesText: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createLead({ ...form, source: "MANUEL" });
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
        </div>
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
