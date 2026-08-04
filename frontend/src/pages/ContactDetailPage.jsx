import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";

const STATUS_LABELS = {
  NOUVEAU: "Nouveau",
  CONTACTE: "Contacté",
  DEVIS_ENVOYE: "Devis envoyé",
  SIGNE: "Signé",
  PERDU: "Perdu",
};

const PRODUCTS = [
  { value: "V2C_TRYDAN", label: "V2C Trydan" },
  { value: "SMAPPEE_EV_WALL", label: "Smappee EV Wall" },
  { value: "AUTRE", label: "Autre" },
];

export default function ContactDetailPage() {
  const { id } = useParams();
  const [lead, setLead] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [callText, setCallText] = useState("");
  const [quoteForm, setQuoteForm] = useState({ product: "V2C_TRYDAN", amount: "" });

  async function load() {
    const data = await api.getLead(id);
    setLead(data);
  }

  useEffect(() => {
    load();
  }, [id]);

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
      </div>

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
          <p>Email: {lead.email}</p>
          <p>Téléphone: {lead.phone || "—"}</p>
          <p>Adresse: {lead.address || "—"}</p>
          <p>Code postal / Ville: {lead.postalCode || "—"} {lead.city || ""}</p>
          {lead.notesText && <p>Notes initiales: {lead.notesText}</p>}
        </section>

        <section className="card">
          <h3>Devis</h3>
          {lead.quotes.length === 0 && <p className="muted">Aucun devis envoyé.</p>}
          {lead.quotes.map((q) => (
            <div key={q.id} className="quote-row">
              <span>{PRODUCTS.find((p) => p.value === q.product)?.label || q.product}</span>
              <span>{Number(q.amount).toLocaleString("fr-FR")} €</span>
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
