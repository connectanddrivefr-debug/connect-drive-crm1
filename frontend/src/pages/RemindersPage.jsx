import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

function leadName(lead) {
  return `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email;
}

function daysUntil(dateStr) {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function ReminderCard({ lead, children }) {
  return (
    <Link to={`/leads/${lead.id}`} className="reminder-card">
      <div className="reminder-card-name">{leadName(lead)}</div>
      <div className="reminder-card-meta">{lead.phone || lead.email}</div>
      {lead.assignedTo && (
        <div className="reminder-card-meta muted">{lead.assignedTo.firstName} {lead.assignedTo.lastName}</div>
      )}
      {children}
    </Link>
  );
}

export default function RemindersPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const result = await api.getReminders();
      setData(result);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading || !data) return <p>Chargement…</p>;

  // Visites programmées dans les 2 prochains jours -> à reconfirmer avec le
  // technicien et le client (même logique que le rappel automatique J-2).
  const aConfirmer = data.visitesProgrammees.filter(
    (l) => l.technicalVisitDate && daysUntil(l.technicalVisitDate) <= 2 && daysUntil(l.technicalVisitDate) >= 0
  );

  return (
    <div className="reminders-page">
      <div className="kanban-header">
        <h1>Rappels</h1>
      </div>

      {aConfirmer.length > 0 && (
        <div className="reminder-banner">
          <strong>À reconfirmer sous 48h :</strong> {aConfirmer.map((l) => leadName(l)).join(", ")} — pensez à
          valider le rendez-vous avec le technicien et le client.
        </div>
      )}

      <div className="reminders-grid">
        <div className="reminder-column">
          <div className="reminder-column-header">
            <span>Visite programmée</span>
            <span className="count">{data.visitesProgrammees.length}</span>
          </div>
          <div className="reminder-column-body">
            {data.visitesProgrammees.length === 0 && <p className="muted">Aucune visite programmée.</p>}
            {data.visitesProgrammees.map((lead) => (
              <ReminderCard key={lead.id} lead={lead}>
                <div className="reminder-card-date">
                  {lead.technicalVisitDate
                    ? new Date(lead.technicalVisitDate).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })
                    : "Date non précisée"}
                </div>
              </ReminderCard>
            ))}
          </div>
        </div>

        <div className="reminder-column">
          <div className="reminder-column-header">
            <span>Visite à programmer</span>
            <span className="count">{data.visitesAProgrammer.length}</span>
          </div>
          <div className="reminder-column-body">
            {data.visitesAProgrammer.length === 0 && <p className="muted">Rien à programmer.</p>}
            {data.visitesAProgrammer.map((lead) => (
              <ReminderCard key={lead.id} lead={lead}>
                <div className="reminder-card-date">{lead.technicalVisitSlots || "Créneaux non précisés"}</div>
              </ReminderCard>
            ))}
          </div>
        </div>

        <div className="reminder-column">
          <div className="reminder-column-header">
            <span>Client à rappeler</span>
            <span className="count">{data.clientsARappeler.length}</span>
          </div>
          <div className="reminder-column-body">
            {data.clientsARappeler.length === 0 && <p className="muted">Aucun rappel en attente.</p>}
            {data.clientsARappeler.map((lead) => (
              <ReminderCard key={lead.id} lead={lead}>
                {lead.callbackRequestedAt && (
                  <div className="reminder-card-date">
                    Demandé le {new Date(lead.callbackRequestedAt).toLocaleDateString("fr-FR")}
                  </div>
                )}
              </ReminderCard>
            ))}
          </div>
        </div>

        <div className="reminder-column">
          <div className="reminder-column-header">
            <span>Photos à recevoir</span>
            <span className="count">{data.photosEnAttente.length}</span>
          </div>
          <div className="reminder-column-body">
            {data.photosEnAttente.length === 0 && <p className="muted">Aucune photo en attente.</p>}
            {data.photosEnAttente.map((lead) => (
              <ReminderCard key={lead.id} lead={lead}>
                {lead.photosRequestedAt && (
                  <div className="reminder-card-date">
                    Demandées le {new Date(lead.photosRequestedAt).toLocaleDateString("fr-FR")}
                  </div>
                )}
              </ReminderCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
