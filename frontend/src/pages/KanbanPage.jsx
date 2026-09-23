import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getCurrentUser } from "../api/client";
import NewLeadModal from "../components/NewLeadModal";

const COLUMNS = [
  { key: "NOUVEAU", label: "Nouveau" },
  { key: "CONTACTE", label: "Contacté" },
  { key: "DEVIS_ENVOYE", label: "Devis envoyé" },
  { key: "SIGNE", label: "Signé" },
  { key: "PERDU", label: "Perdu" },
];

// "2026-09" -> "Septembre 2026" — utilisé pour le sélecteur de mois de la
// colonne "Signé" (suivi des objectifs commerciaux par mois de signature).
function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function KanbanPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [users, setUsers] = useState(null); // liste des commerciaux, admin uniquement
  const [assigneeFilter, setAssigneeFilter] = useState("ALL"); // ALL | ME | UNASSIGNED | <userId>
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [signedMonth, setSignedMonth] = useState(currentMonthStr);
  // Leads simulateur avec numéro de téléphone non vérifié (Twilio) — suspicion
  // de spam, réservé à l'admin (voir GET /api/leads/unverified).
  const [unverifiedLeads, setUnverifiedLeads] = useState(null);

  const currentUser = getCurrentUser();

  async function load() {
    setLoading(true);
    try {
      const data = await api.getLeads();
      setLeads(data);
    } finally {
      setLoading(false);
    }
  }

  function loadUnverified() {
    api.getUnverifiedLeads().then(setUnverifiedLeads).catch(() => setUnverifiedLeads(null));
  }

  async function markPhoneVerified(leadId) {
    await api.updateLead(leadId, { phoneVerified: true });
    loadUnverified();
    load();
  }

  useEffect(() => {
    load();
    // Échoue silencieusement si l'utilisateur n'est pas admin (403) — le
    // filtre par commercial et la section "numéros non vérifiés" restent
    // alors simplement cachés.
    api.getUsers().then(setUsers).catch(() => setUsers(null));
    loadUnverified();
  }, []);

  const visibleLeads = useMemo(() => {
    if (assigneeFilter === "ALL") return leads;
    if (assigneeFilter === "ME") return leads.filter((l) => l.assignedToId === currentUser?.id);
    if (assigneeFilter === "UNASSIGNED") return leads.filter((l) => !l.assignedToId);
    return leads.filter((l) => l.assignedToId === assigneeFilter);
  }, [leads, assigneeFilter, currentUser]);

  // Mois disponibles pour la colonne "Signé": tous les mois où au moins un
  // lead (visible avec le filtre commercial courant) a été signé, plus le
  // mois en cours même s'il est encore vide.
  const signedMonths = useMemo(() => {
    const set = new Set([currentMonthStr]);
    visibleLeads.forEach((l) => {
      if (l.status === "SIGNE" && l.signedAt) set.add(l.signedAt.slice(0, 7));
    });
    return Array.from(set).sort().reverse();
  }, [visibleLeads, currentMonthStr]);

  async function handleDelete(e, lead) {
    e.preventDefault(); // ne pas suivre le lien vers la fiche détail
    e.stopPropagation();
    const nom = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email;
    if (!window.confirm(`Supprimer définitivement le lead "${nom}" ? Cette action est irréversible.`)) {
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id)); // optimiste
    try {
      await api.deleteLead(lead.id);
    } catch (err) {
      alert(`Erreur: ${err.message}`);
      load();
    }
  }

  async function handleDrop(status) {
    setDragOverCol(null);
    const leadId = window.__draggedLeadId;
    if (!leadId) return;
    const fromUnverified = window.__draggedFromUnverified;
    window.__draggedFromUnverified = false;

    // Glisser une carte depuis la colonne "Non vérifié" vers une colonne du
    // pipeline = on considère le lead comme prequalifié: on lève le doute
    // (phoneVerified: true) en même temps qu'on lui donne son statut, comme
    // pour un lead normal.
    if (fromUnverified) {
      setUnverifiedLeads((prev) => (prev ? prev.filter((l) => l.id !== leadId) : prev));
      try {
        await api.updateLead(leadId, { phoneVerified: true });
        await api.updateLeadStatus(leadId, status);
      } catch (err) {
        alert(`Erreur: ${err.message}`);
      }
      load();
      loadUnverified();
      return;
    }

    // Optimistic update
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
    try {
      await api.updateLeadStatus(leadId, status);
    } catch (err) {
      alert(`Erreur: ${err.message}`);
      load();
    }
  }

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <h1>Pipeline des leads</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Ajouter un lead</button>
      </div>

      {users && (
        <div className="status-selector" style={{ marginBottom: 16 }}>
          <button
            className={`status-pill ${assigneeFilter === "ALL" ? "active" : ""}`}
            onClick={() => setAssigneeFilter("ALL")}
          >
            Tous
          </button>
          <button
            className={`status-pill ${assigneeFilter === "ME" ? "active" : ""}`}
            onClick={() => setAssigneeFilter("ME")}
          >
            Mes leads
          </button>
          {users
            .filter((u) => u.id !== currentUser?.id)
            .map((u) => (
              <button
                key={u.id}
                className={`status-pill ${assigneeFilter === u.id ? "active" : ""}`}
                onClick={() => setAssigneeFilter(u.id)}
              >
                {u.firstName} {u.lastName}
              </button>
            ))}
          <button
            className={`status-pill ${assigneeFilter === "UNASSIGNED" ? "active" : ""}`}
            onClick={() => setAssigneeFilter("UNASSIGNED")}
          >
            Non assigné
          </button>
        </div>
      )}

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <div className="kanban-board">
          {unverifiedLeads && (
            <div className="kanban-column unverified-column">
              <div className="kanban-column-header unverified-column-header">
                <span>⚠️ Non vérifié</span>
                <span className="count">{unverifiedLeads.length}</span>
              </div>
              <div className="kanban-column-monthbar unverified-column-note">
                Leads connectndrive.fr avec numéro non confirmé par SMS (Twilio) —
                à prequalifier avant de les faire entrer dans le pipeline.
              </div>
              <div className="kanban-column-body">
                {unverifiedLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="lead-card unverified-card"
                    draggable
                    onDragStart={() => {
                      window.__draggedLeadId = lead.id;
                      window.__draggedFromUnverified = true;
                    }}
                  >
                    <Link to={`/leads/${lead.id}`} className="lead-card-name">
                      {lead.firstName || ""} {lead.lastName || ""}
                      {!lead.firstName && !lead.lastName && lead.email}
                    </Link>
                    <div className="lead-card-meta">{lead.email}</div>
                    <div className="lead-card-meta">{lead.phone || "—"}</div>
                    <div className="lead-card-badges">
                      <span className="badge badge-spam">Non vérifié</span>
                    </div>
                    {lead.estimatedPrice != null && (
                      <span className="lead-card-price">{Number(lead.estimatedPrice).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
                    )}
                    <button
                      type="button"
                      className="btn-primary unverified-card-btn"
                      onClick={() => markPhoneVerified(lead.id)}
                    >
                      Marquer comme vérifié
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {COLUMNS.map((col) => {
            const isSigneCol = col.key === "SIGNE";
            const columnLeads = isSigneCol
              ? visibleLeads.filter((l) => l.status === "SIGNE" && l.signedAt && l.signedAt.slice(0, 7) === signedMonth)
              : visibleLeads.filter((l) => l.status === col.key);

            return (
              <div
                key={col.key}
                className={`kanban-column ${dragOverCol === col.key ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={() => handleDrop(col.key)}
              >
                <div className="kanban-column-header">
                  <span>{col.label}</span>
                  <span className="count">{columnLeads.length}</span>
                </div>
                {isSigneCol && (
                  <div className="kanban-column-monthbar">
                    <select value={signedMonth} onChange={(e) => setSignedMonth(e.target.value)}>
                      {signedMonths.map((m) => (
                        <option key={m} value={m}>{monthLabel(m)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="kanban-column-body">
                  {columnLeads.map((lead) => (
                    <Link
                      to={`/leads/${lead.id}`}
                      key={lead.id}
                      className="lead-card"
                      draggable
                      onDragStart={() => {
                        window.__draggedLeadId = lead.id;
                      }}
                    >
                      {users && (
                        <button
                          type="button"
                          className="lead-card-delete"
                          title="Supprimer ce lead (admin uniquement)"
                          onClick={(e) => handleDelete(e, lead)}
                        >
                          ×
                        </button>
                      )}
                      <div className="lead-card-name">
                        {lead.firstName || ""} {lead.lastName || ""}
                        {!lead.firstName && !lead.lastName && lead.email}
                      </div>
                      <div className="lead-card-meta">{lead.email}</div>
                      <div className="lead-card-meta">{lead.postalCode || ""} {lead.city || ""}</div>
                      {isSigneCol && lead.signedAt && (
                        <div className="lead-card-meta">Signé le {new Date(lead.signedAt).toLocaleDateString("fr-FR")}</div>
                      )}
                      <div className="lead-card-badges">
                        <span className={`badge badge-${lead.source.toLowerCase()}`}>{lead.source}</span>
                        {lead.sourceDetail && <span className="badge">{lead.sourceDetail}</span>}
                        {lead.isProfessional && <span className="badge badge-pro">Pro</span>}
                        {lead.technicalVisitStatus === "PROGRAMMEE" && <span className="badge badge-rappel">Visite prog.</span>}
                        {lead.technicalVisitStatus === "A_PROGRAMMER" && <span className="badge badge-rappel">Visite à prog.</span>}
                        {lead.callbackRequested && <span className="badge badge-rappel">À rappeler</span>}
                        {lead.photosStatus === "EN_ATTENTE" && <span className="badge badge-rappel">Photos</span>}
                        {lead.installationStatus === "PROGRAMMEE" && <span className="badge badge-rappel">Install. prog.</span>}
                      </div>
                      {lead.estimatedPrice != null && (
                        <span className="lead-card-price">{Number(lead.estimatedPrice).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <NewLeadModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
