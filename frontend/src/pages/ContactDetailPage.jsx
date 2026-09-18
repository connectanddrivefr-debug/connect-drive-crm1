import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";

const STATUS_LABELS = {
  NOUVEAU: "Nouveau",
  CONTACTE: "Contacté",
  DEVIS_ENVOYE: "Devis envoyé",
  SIGNE: "Signé",
  PERDU: "Perdu",
};

// Suggestions courantes pour la provenance manuelle — l'utilisateur peut
// aussi taper une valeur libre non listée ici.
const SOURCE_DETAIL_SUGGESTIONS = [
  "V2C", "Facebook", "Bouche à oreille", "Salon / événement", "Ancien client", "Parrainage",
];

const VISIT_STATUS_LABELS = {
  NON_PROGRAMMEE: "Aucune visite en cours",
  A_PROGRAMMER: "À programmer",
  PROGRAMMEE: "Programmée",
};

const PHOTOS_STATUS_LABELS = {
  NON_DEMANDEES: "Non demandées",
  EN_ATTENTE: "En attente du client",
  RECUES: "Reçues",
};

// "2026-09-20T14:30:00.000Z" -> "2026-09-20T14:30" (format attendu par <input type="datetime-local">)
function toDatetimeLocal(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const PRODUCTS = [
  { value: "V2C_TRYDAN", label: "V2C Trydan" },
  { value: "SMAPPEE_EV_WALL", label: "Smappee EV Wall" },
  { value: "AUTRE", label: "Autre" },
];

// Libellés lisibles pour les clés du simulateur de devis (connectndrive.fr)
const ANSWER_KEY_LABELS = {
  lieu: "Lieu",
  voiture: "Véhicule électrique",
  phase: "Alimentation",
  borne: "Borne choisie",
  cable: "Câble",
  distance: "Distance câble",
  quand: "Délai souhaité",
};

// "des-que-possible" → "Des que possible"
function humanize(value) {
  const text = String(value).replace(/[-_]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Affiche joliment les notes initiales d'un lead. Reconnaît le format
// "Réponses simulateur:\n{...json...}" (envoyé par connectndrive.fr) et le
// transforme en petites étiquettes lisibles ; sinon affiche le texte brut.
function renderNotes(notesText) {
  const blocks = notesText.split("\n\n");
  return (
    <div className="notes-box">
      {blocks.map((block, i) => {
        const match = block.match(/^Réponses simulateur:\n([\s\S]+)$/);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            return (
              <div key={i} className="notes-answers">
                {Object.entries(data).map(([k, v]) => (
                  <span key={k} className="notes-chip">
                    <strong>{ANSWER_KEY_LABELS[k] || humanize(k)}:</strong> {humanize(v)}
                  </span>
                ))}
              </div>
            );
          } catch {
            // JSON non valide: on retombe sur l'affichage brut ci-dessous
          }
        }
        return <p key={i} className="notes-line">{block}</p>;
      })}
    </div>
  );
}

export default function ContactDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [callText, setCallText] = useState("");
  const [quoteForm, setQuoteForm] = useState({ product: "V2C_TRYDAN", amount: "" });
  const [users, setUsers] = useState(null); // null = pas encore chargé / pas admin
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState({ address: "", postalCode: "", city: "" });
  const [editingOrigin, setEditingOrigin] = useState(false);
  const [originForm, setOriginForm] = useState({ sourceDetail: "", isProfessional: false });
  const [visitSlots, setVisitSlots] = useState("");
  const [visitDate, setVisitDate] = useState("");

  async function load() {
    const data = await api.getLead(id);
    setLead(data);
  }

  useEffect(() => {
    load();
    // Échoue silencieusement si l'utilisateur n'est pas admin (403) —
    // le sélecteur d'assignation reste simplement caché dans ce cas.
    api.getUsers().then(setUsers).catch(() => setUsers(null));
  }, [id]);

  useEffect(() => {
    if (!lead) return;
    setVisitSlots(lead.technicalVisitSlots || "");
    setVisitDate(toDatetimeLocal(lead.technicalVisitDate));
  }, [lead?.id, lead?.technicalVisitSlots, lead?.technicalVisitDate]);

  async function changeVisitStatus(status) {
    await api.updateLead(id, { technicalVisitStatus: status });
    load();
  }

  async function saveVisitSlots(e) {
    e.preventDefault();
    await api.updateLead(id, { technicalVisitSlots: visitSlots.trim() || null });
    load();
  }

  async function saveVisitDate(e) {
    e.preventDefault();
    await api.updateLead(id, { technicalVisitDate: visitDate ? new Date(visitDate).toISOString() : null });
    load();
  }

  async function toggleCallback(checked) {
    await api.updateLead(id, { callbackRequested: checked });
    load();
  }

  async function changePhotosStatus(status) {
    await api.updateLead(id, { photosStatus: status });
    load();
  }

  async function changeAssignment(userId) {
    await api.updateLead(id, { assignedToId: userId || null });
    load();
  }

  async function handleDelete() {
    const nom = `${lead?.firstName || ""} ${lead?.lastName || ""}`.trim() || lead?.email;
    if (!window.confirm(`Supprimer définitivement le lead "${nom}" ? Cette action est irréversible.`)) {
      return;
    }
    try {
      await api.deleteLead(id);
      navigate("/");
    } catch (err) {
      alert(`Erreur: ${err.message}`);
    }
  }

  function startEditAddress() {
    setAddressForm({
      address: lead.address || "",
      postalCode: lead.postalCode || "",
      city: lead.city || "",
    });
    setEditingAddress(true);
  }

  async function submitAddress(e) {
    e.preventDefault();
    await api.updateLead(id, {
      address: addressForm.address.trim() || null,
      postalCode: addressForm.postalCode.trim() || null,
      city: addressForm.city.trim() || null,
    });
    setEditingAddress(false);
    load();
  }

  function startEditOrigin() {
    setOriginForm({
      sourceDetail: lead.sourceDetail || "",
      isProfessional: Boolean(lead.isProfessional),
    });
    setEditingOrigin(true);
  }

  async function submitOrigin(e) {
    e.preventDefault();
    await api.updateLead(id, {
      sourceDetail: originForm.sourceDetail.trim() || null,
      isProfessional: originForm.isProfessional,
    });
    setEditingOrigin(false);
    load();
  }

  if (!lead) return <p>Chargement…</p>;

  async function changeStatus(status) {
    await api.updateLeadStatus(id, status);
    load();
  }

  async function submitNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    await api.addNote(id, noteText);
    setNoteText("");
    load();
  }

  async function submitCall(e) {
    e.preventDefault();
    if (!callText.trim()) return;
    await api.addCall(id, callText);
    setCallText("");
    load();
  }

  async function submitQuote(e) {
    e.preventDefault();
    if (!quoteForm.amount) return;
    await api.createQuote({ leadId: id, product: quoteForm.product, amount: parseFloat(quoteForm.amount) });
    setQuoteForm({ product: "V2C_TRYDAN", amount: "" });
    load();
  }

  return (
    <div className="contact-page">
      <Link to="/" className="back-link">&larr; Retour au pipeline</Link>

      <div className="contact-header">
        <h1>{lead.firstName || ""} {lead.lastName || ""}</h1>
        <span className={`badge badge-${lead.source.toLowerCase()}`}>{lead.source}</span>
        {lead.sourceDetail && <span className="badge">{lead.sourceDetail}</span>}
        {lead.isProfessional && <span className="badge badge-pro">Pro</span>}
        {users && (
          <button type="button" className="btn-danger" onClick={handleDelete} title="Supprimer ce lead (admin uniquement)">
            Supprimer le lead
          </button>
        )}
      </div>

      {lead.estimatedPrice != null && (
        <div className="price-callout">
          <span className="price-callout-label">Prix estimé (simulateur)</span>
          <span className="price-callout-value">{Number(lead.estimatedPrice).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € TTC</span>
        </div>
      )}

      <div className="status-selector">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <button
            key={key}
            className={`status-pill ${lead.status === key ? "active" : ""}`}
            onClick={() => changeStatus(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="contact-grid">
        <section className="card">
          <h3>Coordonnées</h3>
          <div className="info-list">
            <div className="info-field">
              <span className="info-label">Email</span>
              <span className="info-value">{lead.email}</span>
            </div>

            <div className="info-field">
              <span className="info-label">Téléphone</span>
              <span className="info-value">
                {lead.phone ? (
                  <a href={`tel:${lead.phone}`} className="phone-link" title="Cliquer pour appeler — sélectionner le texte pour copier">
                    {lead.phone}
                  </a>
                ) : (
                  "—"
                )}
              </span>
            </div>

            {!editingAddress && (
              <>
                <div className="info-field">
                  <span className="info-label">Adresse</span>
                  <span className="info-value">{lead.address || "—"}</span>
                </div>
                <div className="info-field">
                  <span className="info-label">Code postal / Ville</span>
                  <span className="info-value">{lead.postalCode || "—"} {lead.city || ""}</span>
                </div>
                <button type="button" className="btn-link" onClick={startEditAddress}>
                  {lead.address ? "Modifier l'adresse" : "Ajouter l'adresse"}
                </button>
              </>
            )}
            {editingAddress && (
              <form onSubmit={submitAddress} className="inline-form-stack">
                <label>
                  Adresse (n°, rue)
                  <input
                    placeholder="Ex: 12 rue des Lilas"
                    value={addressForm.address}
                    onChange={(e) => setAddressForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </label>
                <label>
                  Code postal
                  <input
                    placeholder="Code postal"
                    value={addressForm.postalCode}
                    onChange={(e) => setAddressForm((f) => ({ ...f, postalCode: e.target.value }))}
                  />
                </label>
                <label>
                  Ville
                  <input
                    placeholder="Ville"
                    value={addressForm.city}
                    onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))}
                  />
                </label>
                <div className="inline-form-actions">
                  <button type="submit" className="btn-primary">Enregistrer</button>
                  <button type="button" className="btn-ghost" onClick={() => setEditingAddress(false)}>Annuler</button>
                </div>
              </form>
            )}

            {!editingOrigin && (
              <>
                <div className="info-field">
                  <span className="info-label">Provenance (détail)</span>
                  <span className="info-value">{lead.sourceDetail || "—"}</span>
                </div>
                <div className="info-field">
                  <span className="info-label">Type de client</span>
                  <span className="info-value">{lead.isProfessional ? "Professionnel" : "Particulier"}</span>
                </div>
                <button type="button" className="btn-link" onClick={startEditOrigin}>
                  Modifier la provenance / le type de client
                </button>
              </>
            )}
            {editingOrigin && (
              <form onSubmit={submitOrigin} className="inline-form-stack">
                <label>
                  Provenance (précision)
                  <input
                    list="source-detail-suggestions-detail"
                    placeholder="Ex: V2C, Facebook…"
                    value={originForm.sourceDetail}
                    onChange={(e) => setOriginForm((f) => ({ ...f, sourceDetail: e.target.value }))}
                  />
                  <datalist id="source-detail-suggestions-detail">
                    {SOURCE_DETAIL_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                  </datalist>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={originForm.isProfessional}
                    onChange={(e) => setOriginForm((f) => ({ ...f, isProfessional: e.target.checked }))}
                  />
                  Client professionnel (pro)
                </label>
                <div className="inline-form-actions">
                  <button type="submit" className="btn-primary">Enregistrer</button>
                  <button type="button" className="btn-ghost" onClick={() => setEditingOrigin(false)}>Annuler</button>
                </div>
              </form>
            )}

            {lead.notesText && (
              <div className="info-field">
                <span className="info-label">Notes initiales</span>
                {renderNotes(lead.notesText)}
              </div>
            )}

            {users && lead.status !== "SIGNE" && (
              <div className="info-field">
                <span className="info-label">Commercial assigné</span>
                <select value={lead.assignedToId || ""} onChange={(e) => changeAssignment(e.target.value)}>
                  <option value="">— Non assigné —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</option>
                  ))}
                </select>
              </div>
            )}
            {lead.status === "SIGNE" && (
              <div className="info-field">
                <span className="info-label">Commercial assigné</span>
                <span className="info-value">
                  {lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : "— Non assigné —"}
                  <span className="muted"> (verrouillé, lead signé)</span>
                </span>
              </div>
            )}
            {!users && lead.status !== "SIGNE" && lead.assignedTo && (
              <div className="info-field">
                <span className="info-label">Commercial assigné</span>
                <span className="info-value">{lead.assignedTo.firstName} {lead.assignedTo.lastName}</span>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <h3>Rappels</h3>
          <div className="info-list">
            <div className="info-field">
              <span className="info-label">Visite technique</span>
              <select value={lead.technicalVisitStatus} onChange={(e) => changeVisitStatus(e.target.value)}>
                {Object.entries(VISIT_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {lead.technicalVisitStatus === "A_PROGRAMMER" && (
              <form onSubmit={saveVisitSlots} className="inline-form">
                <input
                  placeholder="Créneaux dispo du client (ex: mardi/jeudi après-midi)"
                  value={visitSlots}
                  onChange={(e) => setVisitSlots(e.target.value)}
                />
                <button type="submit" className="btn-primary">Enregistrer</button>
              </form>
            )}

            {lead.technicalVisitStatus === "PROGRAMMEE" && (
              <form onSubmit={saveVisitDate} className="inline-form">
                <input
                  type="datetime-local"
                  value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)}
                />
                <button type="submit" className="btn-primary">Enregistrer</button>
              </form>
            )}

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(lead.callbackRequested)}
                onChange={(e) => toggleCallback(e.target.checked)}
              />
              Client à rappeler
            </label>

            <div className="info-field">
              <span className="info-label">Photos</span>
              <select value={lead.photosStatus} onChange={(e) => changePhotosStatus(e.target.value)}>
                {Object.entries(PHOTOS_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card">
          <h3>Devis</h3>
          {lead.quotes.length === 0 && <p className="muted">Aucun devis envoyé.</p>}
          {lead.quotes.map((q) => (
            <div key={q.id} className="quote-row">
              <span>{PRODUCTS.find((p) => p.value === q.product)?.label || q.product}</span>
              <span>{Number(q.amount).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
              <span className={`badge badge-quote-${q.status.toLowerCase()}`}>{q.status}</span>
              <span className="muted">{new Date(q.sentAt).toLocaleDateString("fr-FR")}</span>
            </div>
          ))}
          <form onSubmit={submitQuote} className="inline-form">
            <select value={quoteForm.product} onChange={(e) => setQuoteForm((f) => ({ ...f, product: e.target.value }))}>
              {PRODUCTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <input
              type="number" step="0.01" placeholder="Montant €"
              value={quoteForm.amount}
              onChange={(e) => setQuoteForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <button type="submit" className="btn-primary">Envoyer devis</button>
          </form>
        </section>

        <section className="card">
          <h3>Historique du statut</h3>
          <ul className="timeline">
            {lead.statusHistory.map((h) => (
              <li key={h.id}>
                <strong>{STATUS_LABELS[h.toStatus]}</strong> — {new Date(h.changedAt).toLocaleString("fr-FR")}
                {h.changedBy && <span className="muted"> ({h.changedBy})</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Emails envoyés (Brevo)</h3>
          {lead.emailLogs.length === 0 && <p className="muted">Aucun email envoyé.</p>}
          <ul className="timeline">
            {lead.emailLogs.map((e) => (
              <li key={e.id}>
                {e.subject} — {new Date(e.sentAt).toLocaleString("fr-FR")}
                {!e.success && <span className="error"> (échec: {e.errorMsg})</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Appels</h3>
          <ul className="timeline">
            {lead.calls.map((c) => (
              <li key={c.id}>{c.summary} — {new Date(c.callAt).toLocaleString("fr-FR")}</li>
            ))}
          </ul>
          <form onSubmit={submitCall} className="inline-form">
            <input placeholder="Résumé de l'appel" value={callText} onChange={(e) => setCallText(e.target.value)} />
            <button type="submit" className="btn-primary">Ajouter</button>
          </form>
        </section>

        <section className="card">
          <h3>Notes</h3>
          <ul className="timeline">
            {lead.notes.map((n) => (
              <li key={n.id}>{n.content} — {new Date(n.createdAt).toLocaleString("fr-FR")}</li>
            ))}
          </ul>
          <form onSubmit={submitNote} className="inline-form">
            <input placeholder="Ajouter une note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            <button type="submit" className="btn-primary">Ajouter</button>
          </form>
        </section>
      </div>
    </div>
  );
}
