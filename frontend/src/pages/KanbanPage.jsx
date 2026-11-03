import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getCurrentUser } from "../api/client";
import NewLeadModal from "../components/NewLeadModal";
import OnHoldModal from "../components/OnHoldModal";
import { initials, isUrgent, urgencyOf, whatsAppUrl } from "../lib/contact";
import { PhoneIcon, WhatsAppIcon } from "../components/Icons";

const COLUMNS = [
  { key: "NOUVEAU", label: "Nouveau", hint: "À contacter rapidement" },
  { key: "CONTACTE", label: "Contacté", hint: "Devis à préparer" },
  { key: "DEVIS_ENVOYE", label: "Devis envoyé", hint: "Relances automatiques actives" },
  { key: "EN_ATTENTE", label: "En attente", hint: "Relances en pause" },
  { key: "SIGNE", label: "Signé", hint: "Payé" },
  { key: "PERDU", label: "Perdu", hint: "Sortis du pipeline" },
];

// Montant de référence d'un lead: dernier devis envoyé, sinon prix estimé
// du simulateur. Sert uniquement au bandeau de chiffres.
function leadAmount(lead) {
  const quotes = lead.quotes || [];
  if (quotes.length > 0) {
    const last = [...quotes].sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
    return Number(last.amount) || 0;
  }
  return lead.estimatedPrice != null ? Number(lead.estimatedPrice) || 0 : 0;
}

function euros(n) {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}


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
  // Lead déposé dans la colonne "En attente": on demande le motif et la date
  // de reprise avant d'enregistrer le changement de statut.
  const [onHoldLead, setOnHoldLead] = useState(null);
  const [users, setUsers] = useState(null); // liste des commerciaux, admin uniquement
  const [assigneeFilter, setAssigneeFilter] = useState("ALL"); // ALL | ME | UNASSIGNED | <userId>
  const currentMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const [signedMonth, setSignedMonth] = useState(currentMonthStr);
  // Leads simulateur avec numéro de téléphone non vérifié (Twilio) — suspicion
  // de spam, réservé à l'admin (voir GET /api/leads/unverified).
  const [unverifiedLeads, setUnverifiedLeads] = useState(null);
  // Filtre d'affichage "Urgents seulement" (rappels du jour/en retard, leads
  // non contactés, devis sans réponse…) — n'affecte aucune donnée.
  const [urgentOnly, setUrgentOnly] = useState(false);
  // Fluidité du glisser-déposer: carte en cours de déplacement, carte qui
  // vient d'arriver (surbrillance) et petite confirmation avec "Annuler".
  const [draggingId, setDraggingId] = useState(null);
  const [justMovedId, setJustMovedId] = useState(null);
  const [toast, setToast] = useState(null); // { text, undo: lead avant déplacement }

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
    setUnverifiedLeads((prev) => (prev ? prev.filter((l) => l.id !== leadId) : prev));
    await api.updateLead(leadId, { phoneVerified: true });
    loadUnverified();
    load();
  }

  // Le lead est jugé être du spam: on le passe en statut "Perdu" pour le
  // sortir du pipeline actif, sans le supprimer (traçabilité conservée).
  async function markAsSpam(leadId) {
    setUnverifiedLeads((prev) => (prev ? prev.filter((l) => l.id !== leadId) : prev));
    await api.updateLeadStatus(leadId, "PERDU");
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

  const assigneeLeads = useMemo(() => {
    if (assigneeFilter === "ALL") return leads;
    if (assigneeFilter === "ME") return leads.filter((l) => l.assignedToId === currentUser?.id);
    if (assigneeFilter === "UNASSIGNED") return leads.filter((l) => !l.assignedToId);
    return leads.filter((l) => l.assignedToId === assigneeFilter);
  }, [leads, assigneeFilter, currentUser]);

  const visibleLeads = useMemo(
    () => (urgentOnly ? assigneeLeads.filter((l) => isUrgent(l)) : assigneeLeads),
    [assigneeLeads, urgentOnly]
  );

  // Bandeau de chiffres: calculé sur les leads déjà chargés (aucune requête
  // en plus), selon le filtre commercial sélectionné.
  const kpis = useMemo(() => {
    const total = assigneeLeads.length;
    const signed = assigneeLeads.filter((l) => l.status === "SIGNE");
    const pending = assigneeLeads.filter((l) => l.status === "DEVIS_ENVOYE");
    const signedThisMonth = signed.filter((l) => l.signedAt && l.signedAt.slice(0, 7) === currentMonthStr);
    return {
      rate: total > 0 ? Math.round((signed.length / total) * 100) : 0,
      pendingAmount: pending.reduce((s, l) => s + leadAmount(l), 0),
      signedMonthAmount: signedThisMonth.reduce((s, l) => s + leadAmount(l), 0),
      signedMonthCount: signedThisMonth.length,
      urgentCount: assigneeLeads.filter((l) => isUrgent(l)).length,
    };
  }, [assigneeLeads, currentMonthStr]);

  function stopCard(e) {
    e.preventDefault(); // ne pas ouvrir la fiche
    e.stopPropagation();
  }

  function callLead(e, lead) {
    stopCard(e);
    window.location.href = `tel:${lead.phone}`;
  }

  function whatsAppLead(e, lead) {
    stopCard(e);
    const url = whatsAppUrl(lead, currentUser?.firstName);
    if (!url) return;
    window.open(url, "_blank", "noopener");
    // Trace dans les notes de la fiche (sans bloquer l'ouverture de WhatsApp).
    api.addNote(lead.id, `💬 WhatsApp ouvert${currentUser?.firstName ? ` par ${currentUser.firstName}` : ""}`).catch(() => {});
  }

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

  // Ce que le serveur va poser lui-même au changement de statut (voir
  // PATCH /api/leads/:id/status) : appliqué tout de suite à l'écran pour que
  // la carte arrive directement au bon endroit (ex. mois en cours de "Signé").
  function predictStatusChange(lead, status) {
    const now = new Date().toISOString();
    return {
      ...lead,
      status,
      ...(status === "SIGNE" && lead.status !== "SIGNE" ? { signedAt: now } : {}),
      ...(status !== "SIGNE" && lead.status === "SIGNE" ? { signedAt: null } : {}),
      ...(status === "DEVIS_ENVOYE" && lead.status !== "DEVIS_ENVOYE" ? { quoteFollowupStartedAt: now, quoteFollowupStep: 0 } : {}),
      ...(status !== "EN_ATTENTE" && lead.status === "EN_ATTENTE" ? { onHoldReason: null, onHoldUntil: null, onHoldAt: null } : {}),
    };
  }

  function flashMoved(leadId) {
    setJustMovedId(leadId);
    clearTimeout(window.__justMovedTimer);
    window.__justMovedTimer = setTimeout(() => setJustMovedId(null), 1200);
  }

  function showToast(t) {
    setToast(t);
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => setToast(null), 5000);
  }

  // Déplace un lead: mise à jour immédiate à l'écran, enregistrement en
  // arrière-plan, puis on garde la version renvoyée par le serveur.
  async function moveLead(lead, status, extra = {}, { withUndo = true } = {}) {
    const before = lead;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...predictStatusChange(l, status), ...extra } : l)));
    flashMoved(lead.id);
    if (withUndo) {
      const label = COLUMNS.find((c) => c.key === status)?.label || status;
      const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || lead.email;
      showToast({ text: `${name} → ${label}`, undo: before });
    }
    try {
      const saved = await api.updateLeadStatus(lead.id, status, extra);
      if (saved) setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, ...saved } : l)));
    } catch (err) {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? before : l)));
      setToast(null);
      alert(`Erreur: ${err.message}`);
    }
  }

  async function undoMove() {
    const before = toast?.undo;
    setToast(null);
    if (!before) return;
    const extra = before.status === "EN_ATTENTE"
      ? { onHoldReason: before.onHoldReason || null, onHoldUntil: before.onHoldUntil || null }
      : {};
    await moveLead(before, before.status, extra, { withUndo: false });
  }

  async function handleDrop(status) {
    setDragOverCol(null);
    setDraggingId(null);
    const leadId = window.__draggedLeadId;
    window.__draggedLeadId = null;
    if (!leadId) return;
    const lead = leads.find((l) => l.id === leadId);
    // Carte reposée dans sa propre colonne: rien à enregistrer.
    if (!lead || lead.status === status) return;

    if (status === "EN_ATTENTE") {
      setOnHoldLead(lead);
      return;
    }

    moveLead(lead, status);
  }

  return (
    <div className="kanban-page">
      <div className="kanban-header">
        <h1>Pipeline des leads</h1>
        <button className="btn-primary" onClick={() => setShowModal(true)}>+ Ajouter un lead</button>
      </div>

      {!loading && (
        <div className="kpi-strip">
          <div className="kpi-card">
            <span className="kpi-label">Taux de signature</span>
            <span className="kpi-value brand">{kpis.rate} %</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Devis en cours</span>
            <span className="kpi-value">{euros(kpis.pendingAmount)}</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-label">Signé ce mois · {kpis.signedMonthCount}</span>
            <span className="kpi-value">{euros(kpis.signedMonthAmount)}</span>
          </div>
          <button
            type="button"
            className={`kpi-card warn ${urgentOnly ? "active" : ""}`}
            onClick={() => setUrgentOnly((v) => !v)}
            title="Afficher uniquement les leads urgents"
          >
            <span className="kpi-label">À traiter en priorité</span>
            <span className="kpi-value">{kpis.urgentCount} leads</span>
          </button>
        </div>
      )}

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
          <button
            className={`status-pill pill-warn ${urgentOnly ? "active" : ""}`}
            onClick={() => setUrgentOnly((v) => !v)}
          >
            Urgents seulement
          </button>
        </div>
      )}

      {unverifiedLeads && unverifiedLeads.length > 0 && (
        <div className="unverified-section">
          <div className="unverified-section-header">
            <span>⚠️ Numéros non vérifiés — suspicion de spam</span>
            <span className="count">{unverifiedLeads.length}</span>
          </div>
          <div className="unverified-section-body">
            {unverifiedLeads.map((lead) => (
              <div key={lead.id} className="lead-card unverified-card">
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
                <div className="unverified-card-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => markPhoneVerified(lead.id)}
                  >
                    Marquer comme vérifié
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => markAsSpam(lead.id)}
                  >
                    Déclarer comme spam
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p>Chargement…</p>
      ) : (
        <div className="kanban-board">
          {COLUMNS.map((col) => {
            const isSigneCol = col.key === "SIGNE";
            const columnLeads = isSigneCol
              ? visibleLeads.filter((l) => l.status === "SIGNE" && l.signedAt && l.signedAt.slice(0, 7) === signedMonth)
              : visibleLeads.filter((l) => l.status === col.key);

            return (
              <div
                key={col.key}
                className={`kanban-column col-${col.key} ${dragOverCol === col.key ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== col.key) setDragOverCol(col.key);
                }}
                onDragLeave={(e) => {
                  // Ignorer le passage au-dessus d'une carte de la même colonne
                  // (évite le clignotement de la surbrillance).
                  if (e.currentTarget.contains(e.relatedTarget)) return;
                  setDragOverCol((c) => (c === col.key ? null : c));
                }}
                onDrop={() => handleDrop(col.key)}
              >
                <div className="kanban-column-header">
                  <div className="kanban-column-title">
                    <span>{col.label}</span>
                    <span className="count">{columnLeads.length}</span>
                  </div>
                  <span className="kanban-column-hint">{col.hint}</span>
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
                  {columnLeads.map((lead) => {
                    const urgency = urgencyOf(lead);
                    const waUrl = whatsAppUrl(lead, currentUser?.firstName);
                    return (
                    <Link
                      to={`/leads/${lead.id}`}
                      key={lead.id}
                      className={`lead-card ${draggingId === lead.id ? "dragging" : ""} ${justMovedId === lead.id ? "just-moved" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        window.__draggedLeadId = lead.id;
                        e.dataTransfer.effectAllowed = "move";
                        // Laisser le navigateur capturer l'image de la carte avant de l'estomper.
                        requestAnimationFrame(() => setDraggingId(lead.id));
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
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
                      {urgency && <span className={`urgency urgency-${urgency.tone}`}>{urgency.text}</span>}
                      <div className="lead-card-top">
                        <div className="lead-card-name">
                          {lead.firstName || ""} {lead.lastName || ""}
                          {!lead.firstName && !lead.lastName && lead.email}
                        </div>
                        <span
                          className={`owner-dot ${lead.assignedTo ? "" : "none"}`}
                          title={lead.assignedTo ? `Assigné à ${lead.assignedTo.firstName} ${lead.assignedTo.lastName || ""}` : "Non assigné"}
                        >
                          {lead.assignedTo ? initials(lead.assignedTo) : "?"}
                        </span>
                      </div>
                      {lead.company && <div className="lead-card-meta"><strong>{lead.company}</strong></div>}
                      <div className="lead-card-meta">{lead.email}</div>
                      <div className="lead-card-meta">{lead.postalCode || ""} {lead.city || ""}</div>
                      {isSigneCol && lead.signedAt && (
                        <div className="lead-card-meta">Signé le {new Date(lead.signedAt).toLocaleDateString("fr-FR")}</div>
                      )}
                      {lead.status === "EN_ATTENTE" && (lead.onHoldReason || lead.onHoldUntil) && (
                        <div className="lead-card-meta lead-card-onhold">
                          ⏸ {lead.onHoldReason || "En attente"}
                          {lead.onHoldUntil && <> · reprise le {new Date(lead.onHoldUntil).toLocaleDateString("fr-FR")}</>}
                        </div>
                      )}
                      <div className="lead-card-badges">
                        <span className={`badge badge-${lead.source.toLowerCase()}`}>{lead.source}</span>
                        {lead.sourceDetail && <span className="badge">{lead.sourceDetail}</span>}
                        {lead.isProfessional && <span className="badge badge-pro">Pro</span>}
                        {lead.technicalVisitStatus === "PROGRAMMEE" && <span className="badge badge-rappel">Visite prog.</span>}
                        {lead.technicalVisitStatus === "A_PROGRAMMER" && <span className="badge badge-rappel">Visite à prog.</span>}
                        {lead.callbackRequested && (
                          <span className="badge badge-rappel">
                            À rappeler{lead.callbackDate ? ` ${new Date(lead.callbackDate).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                          </span>
                        )}
                        {lead.photosStatus === "EN_ATTENTE" && <span className="badge badge-rappel">Photos</span>}
                        {lead.installationStatus === "PROGRAMMEE" && <span className="badge badge-rappel">Install. prog.</span>}
                        {lead.depositStatus === "PAYE" && <span className="badge badge-payment-paye">Acompte payé</span>}
                        {lead.balanceStatus === "PAYE" && <span className="badge badge-payment-paye">Solde payé</span>}
                      </div>
                      {lead.estimatedPrice != null && (
                        <span className="lead-card-price">{Number(lead.estimatedPrice).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</span>
                      )}
                      {lead.phone && (
                        <div className="lead-card-actions">
                          <button
                            type="button"
                            className="icon-btn icon-btn-call"
                            title={`Appeler ${lead.phone}`}
                            aria-label="Appeler le client"
                            onClick={(e) => callLead(e, lead)}
                          >
                            <PhoneIcon />
                          </button>
                          {waUrl && (
                            <button
                              type="button"
                              className="icon-btn icon-btn-wa"
                              title="Écrire sur WhatsApp"
                              aria-label="Écrire au client sur WhatsApp"
                              onClick={(e) => whatsAppLead(e, lead)}
                            >
                              <WhatsAppIcon />
                            </button>
                          )}
                        </div>
                      )}
                    </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {onHoldLead && (
        <OnHoldModal
          lead={onHoldLead}
          onClose={() => setOnHoldLead(null)}
          onConfirm={async (extra) => {
            const lead = onHoldLead;
            setOnHoldLead(null);
            await moveLead(lead, "EN_ATTENTE", extra);
          }}
        />
      )}

      {toast && (
        <div className="move-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={undoMove}>Annuler</button>
          )}
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
