import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import NewLeadModal from "../components/NewLeadModal";

const COLUMNS = [
  { key: "NOUVEAU", label: "Nouveau" },
  { key: "CONTACTE", label: "Contacté" },
  { key: "DEVIS_ENVOYE", label: "Devis envoyé" },
  { key: "SIGNE", label: "Signé" },
  { key: "PERDU", label: "Perdu" },
];

export default function KanbanPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [dragOverCol, setDragOverCol] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getLeads();
      setLeads(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDrop(status) {
    setDragOverCol(null);
    const leadId = window.__draggedLeadId;
    if (!leadId) return;
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

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <div className="kanban-board">
          {COLUMNS.map((col) => (
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
                <span className="count">{leads.filter((l) => l.status === col.key).length}</span>
              </div>
              <div className="kanban-column-body">
                {leads
                  .filter((l) => l.status === col.key)
                  .map((lead) => (
                    <Link
                      to={`/leads/${lead.id}`}
                      key={lead.id}
                      className="lead-card"
                      draggable
                      onDragStart={() => {
                        window.__draggedLeadId = lead.id;
                      }}
                    >
                      <div className="lead-card-name">
                        {lead.firstName || ""} {lead.lastName || ""}
                        {!lead.firstName && !lead.lastName && lead.email}
                      </div>
                      <div className="lead-card-meta">{lead.email}</div>
                      <div className="lead-card-meta">{lead.postalCode || ""} {lead.city || ""}</div>
                      <span className={`badge badge-${lead.source.toLowerCase()}`}>{lead.source}</span>
                    </Link>
                  ))}
              </div>
            </div>
          ))}
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
