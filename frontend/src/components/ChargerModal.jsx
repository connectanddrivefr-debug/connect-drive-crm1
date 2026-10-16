import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getCurrentUser } from "../api/client";
import { ALL_MODELS, STATUS_LABELS, MOVEMENT_LABELS, techName, leadLabel, fmtDate } from "../lib/stock";

// Fiche d'une borne: statut, historique complet des mouvements, et actions
// (rattachement manuel à un client en attendant l'intégration Kraaft,
// correction du modèle / numéro, retour SAV).
export default function ChargerModal({ chargerId, onClose, onChanged }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(null); // "install" | "edit"
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState([]);
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [newMode, setNewMode] = useState(false);
  const [techs, setTechs] = useState([]);
  const emptyClient = { firstName: "", lastName: "", company: "", phone: "", email: "", address: "", postalCode: "", city: "" };
  const [nc, setNc] = useState(emptyClient);
  const [partnerId, setPartnerId] = useState("");

  async function load() {
    const data = await api.getCharger(chargerId);
    setC(data);
    setModel(data.model);
    setSerial(data.serialNumber);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [chargerId]);

  useEffect(() => {
    if (panel !== "install" || q.trim().length < 2) {
      setLeads([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchStockClients(q.trim()).then(setLeads).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, panel]);

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      setPanel(null);
      onChanged && onChanged();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card charger-modal" onClick={(e) => e.stopPropagation()}>
        {!c ? (
          <p className="muted">{error || "Chargement…"}</p>
        ) : (
          <>
            <div className="charger-modal-head">
              <div>
                <div className="charger-serial">{c.serialNumber}</div>
                <div className="muted">{c.model}</div>
                {(c.reference || c.ean) && (
                  <div className="muted mono">{[c.reference, c.ean && `EAN ${c.ean}`].filter(Boolean).join(" · ")}</div>
                )}
              </div>
              <span className={`badge stock-badge-${c.status.toLowerCase()}`}>{STATUS_LABELS[c.status]}</span>
            </div>

            <div className="info-list">
              {c.technician && (
                <div className="info-field">
                  <span className="info-label">{c.status === "INSTALLEE" ? "Installée par" : "Technicien"}</span>
                  <span className="info-value">
                    {techName(c.technician)}
                    {c.status === "CHEZ_TECHNICIEN" && c.assignedAt && ` — depuis le ${fmtDate(c.assignedAt)}`}
                  </span>
                </div>
              )}
              {c.lead && (
                <div className="info-field">
                  <span className="info-label">Client</span>
                  {getCurrentUser()?.role === "ADMIN" ? (
                    <Link className="info-value" to={`/leads/${c.lead.id}`}>{leadLabel(c.lead)}</Link>
                  ) : (
                    <span className="info-value">{leadLabel(c.lead)}</span>
                  )}
                  {c.installedAt && <span className="muted">Installée le {fmtDate(c.installedAt)}</span>}
                </div>
              )}
              {c.reception && (
                <div className="info-field">
                  <span className="info-label">Réception</span>
                  <span className="info-value">
                    {c.reception.supplier}
                    {c.reception.blNumber && ` — BL ${c.reception.blNumber}`} — {fmtDate(c.reception.receivedAt)}
                  </span>
                </div>
              )}
            </div>

            <h3 className="charger-section-title">Historique</h3>
            <ul className="timeline">
              {c.movements.map((m) => (
                <li key={m.id}>
                  <strong>{fmtDate(m.createdAt, true)}</strong> — {MOVEMENT_LABELS[m.type]}
                  {m.technician && ` · ${techName(m.technician)}`}
                  {m.lead && ` · ${leadLabel(m.lead)}`}
                  {m.user && <span className="muted"> (par {m.user.firstName})</span>}
                  {m.notes && <div className="muted">{m.notes}</div>}
                </li>
              ))}
            </ul>

            {panel === "install" && (
              <div className="charger-panel">
                <div className="install-tabs">
                  <button className={!newMode ? "status-pill active" : "status-pill"} onClick={() => setNewMode(false)}>
                    Client existant
                  </button>
                  <button
                    className={newMode ? "status-pill active" : "status-pill"}
                    onClick={() => {
                      setNewMode(true);
                      if (!techs.length) api.getTechnicians().then((l) => setTechs(l.filter((t) => t.active))).catch(() => {});
                    }}
                  >
                    + Nouveau client
                  </button>
                </div>
                {newMode ? (
                  <form
                    className="new-client-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => api.installCharger(c.id, { newClient: nc, partnerTechnicianId: partnerId || null })).then((ok) => {
                        if (!ok) return;
                        setNc(emptyClient);
                        setPartnerId("");
                        setNewMode(false);
                      });
                    }}
                  >
                    <label className="full">
                      Installée chez le client de… (optionnel)
                      <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                        <option value="">— Notre client (pas un client de technicien) —</option>
                        {techs.map((t) => (
                          <option key={t.id} value={t.id}>Client de {t.firstName} {t.lastName || ""}</option>
                        ))}
                      </select>
                    </label>
                    <input placeholder="Prénom" value={nc.firstName} onChange={(e) => setNc({ ...nc, firstName: e.target.value })} />
                    <input placeholder="Nom *" value={nc.lastName} onChange={(e) => setNc({ ...nc, lastName: e.target.value })} />
                    <input className="full" placeholder="Entreprise (si pro)" value={nc.company} onChange={(e) => setNc({ ...nc, company: e.target.value })} />
                    <input placeholder="Téléphone" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
                    <input type="email" placeholder="Email (optionnel)" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
                    <input className="full" placeholder="Adresse" value={nc.address} onChange={(e) => setNc({ ...nc, address: e.target.value })} />
                    <input placeholder="Code postal" value={nc.postalCode} onChange={(e) => setNc({ ...nc, postalCode: e.target.value })} />
                    <input placeholder="Ville" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} />
                    <p className="muted full">🔕 Aucun email ne sera envoyé à ce client. Une fiche client « Signé » est créée dans le CRM.</p>
                    <button
                      type="submit"
                      className="btn-primary full"
                      disabled={busy || (!nc.lastName.trim() && !nc.firstName.trim() && !nc.company.trim())}
                    >
                      Créer la fiche et marquer la borne installée
                    </button>
                  </form>
                ) : (
                <>
                <label>
                  Rechercher le client (nom, entreprise, ville, code postal)
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ex. Dupont" />
                </label>
                <div className="lead-pick-list">
                  {leads.map((l) => (
                    <button
                      key={l.id}
                      className="lead-pick"
                      disabled={busy}
                      onClick={() => run(() => api.installCharger(c.id, { leadId: l.id }))}
                    >
                      {leadLabel(l)}
                    </button>
                  ))}
                  {q.trim().length >= 2 && leads.length === 0 && (
                    <span className="muted">
                      Aucun client trouvé.{" "}
                      <button className="btn-link" onClick={() => { setNewMode(true); setNc({ ...emptyClient, lastName: q.trim() }); api.getTechnicians().then((l) => setTechs(l.filter((t) => t.active))).catch(() => {}); }}>
                        Le créer
                      </button>
                    </span>
                  )}
                </div>
                </>
                )}
              </div>
            )}

            {panel === "edit" && (
              <div className="charger-panel">
                <label>
                  N° de série
                  <input value={serial} onChange={(e) => setSerial(e.target.value)} />
                </label>
                <label>
                  Modèle
                  <input list="charger-models" value={model} onChange={(e) => setModel(e.target.value)} />
                  <datalist id="charger-models">
                    {ALL_MODELS.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </label>
                <div className="modal-actions">
                  <button className="btn-ghost" onClick={() => setPanel(null)}>Annuler</button>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => run(() => api.updateCharger(c.id, { model, serialNumber: serial }))}
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <div className="modal-actions charger-actions">
              {c.status !== "INSTALLEE" && c.status !== "RETOUR_SAV" && panel !== "install" && (
                <button className="btn-primary" onClick={() => setPanel("install")}>Marquer installée chez un client</button>
              )}
              {panel !== "edit" && <button className="btn-ghost" onClick={() => setPanel("edit")}>Corriger</button>}
              {c.status !== "RETOUR_SAV" && c.status !== "INSTALLEE" && (
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Marquer cette borne en retour SAV fournisseur ?")) {
                      run(() => api.updateCharger(c.id, { status: "RETOUR_SAV" }));
                    }
                  }}
                >
                  Retour SAV
                </button>
              )}
              <button className="btn-ghost" onClick={onClose}>Fermer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
