import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

function leadName(lead) {
  return `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email;
}

// "2026-09" -> "Septembre 2026" — même sélecteur de mois que la colonne
// "Signé" du pipeline, appliqué ici aux installations programmées.
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
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
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [installationMonth, setInstallationMonth] = useState(currentMonthStr);

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

  // Mois disponibles pour la colonne "Installation programmée": tous les
  // mois où au moins une installation est programmée, plus le mois en
  // cours même s'il est encore vide — même logique que la colonne "Signé"
  // du pipeline.
  const installationMonths = Array.from(
    new Set([
      currentMonthStr,
      ...data.installationsProgrammees
        .filter((l) => l.installationDate)
        .map((l) => l.installationDate.slice(0, 7)),
    ])
  ).sort().reverse();
  const installationsDuMois = data.installationsProgrammees.filter(
    (l) => l.installationDate && l.installationDate.slice(0, 7) === installationMonth
  );

  // Visites et installations programmées dans les 2 prochains jours -> à
  // reconfirmer avec le technicien et le client (même logique que le rappel
  // automatique J-2).
  const dansMoinsDe48h = (dateStr) => dateStr && daysUntil(dateStr) <= 2 && daysUntil(dateStr) >= 0;
  const aConfirmer = [
    ...data.visitesProgrammees.filter((l) => dansMoinsDe48h(l.technicalVisitDate)),
    ...data.installationsProgrammees.filter((l) => dansMoinsDe48h(l.installationDate)),
  ];

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

        <div className="reminder-column">
          <div className="reminder-column-header">
            <span>Installation programmée</span>
            <span className="count">{installationsDuMois.length}</span>
          </div>
          <div className="kanban-column-monthbar">
            <select value={installationMonth} onChange={(e) => setInstallationMonth(e.target.value)}>
              {installationMonths.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="reminder-column-body">
            {installationsDuMois.length === 0 && <p className="muted">Aucune installation programmée ce mois-ci.</p>}
            {installationsDuMois.map((lead) => (
              <ReminderCard key={lead.id} lead={lead}>
                <div className="reminder-card-date">
                  {lead.installationDate
                    ? new Date(lead.installationDate).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })
                    : "Date non précisée"}
                </div>
              </ReminderCard>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
