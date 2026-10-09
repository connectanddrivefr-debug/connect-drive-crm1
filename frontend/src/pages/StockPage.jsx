import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import ChargerModal from "../components/ChargerModal";
import { STATUS_LABELS, techName, leadLabel, fmtDate } from "../lib/stock";

// Vue d'ensemble du stock de bornes: au dépôt, chez chaque technicien
// (avec alerte au-delà de N jours sans installation), installées.
export default function StockPage() {
  const [summary, setSummary] = useState(null);
  const [chargers, setChargers] = useState([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [techs, setTechs] = useState([]);
  const [showTechs, setShowTechs] = useState(false);
  const [newTech, setNewTech] = useState({ firstName: "", lastName: "", phone: "" });
  const [error, setError] = useState("");

  async function loadSummary() {
    const [s, t] = await Promise.all([api.getStockSummary(), api.getTechnicians()]);
    setSummary(s);
    setTechs(t);
  }

  async function loadChargers() {
    setChargers(await api.getChargers({ status, q: q.trim() }));
  }

  function reloadAll() {
    loadSummary().catch((e) => setError(e.message));
    loadChargers().catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadSummary().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => loadChargers().catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [status, q]);

  async function addTech(e) {
    e.preventDefault();
    if (!newTech.firstName.trim()) return;
    try {
      await api.createTechnician(newTech);
      setNewTech({ firstName: "", lastName: "", phone: "" });
      await loadSummary();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleTech(t) {
    await api.updateTechnician(t.id, { active: !t.active });
    await loadSummary();
  }

  if (!summary) return <p className="muted">{error || "Chargement…"}</p>;

  const overdue = summary.technicians.flatMap((t) => t.chargers.filter((c) => c.overdue).map((c) => ({ ...c, tech: t.technician })));

  return (
    <div className="stock-page">
      <div className="kanban-header stock-header">
        <h1>Stock bornes</h1>
        <div className="stock-actions">
          <Link to="/stock/reception" className="btn-primary">+ Réception</Link>
          <Link to="/stock/dotation" className="btn-primary">Remettre à un technicien</Link>
          <Link to="/stock/retour" className="btn-ghost">Retour au dépôt</Link>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {overdue.length > 0 && (
        <div className="reminder-banner">
          <strong>{overdue.length} borne(s) chez un technicien depuis plus de {summary.alertDays} jours sans installation :</strong>{" "}
          {overdue.map((c) => `${c.serialNumber} (${techName(c.tech)}, ${c.days} j)`).join(", ")}
        </div>
      )}

      <div className="stats-grid stock-stats">
        {["EN_STOCK", "CHEZ_TECHNICIEN", "INSTALLEE"].map((s) => (
          <button key={s} className={`stat-card stat-button ${status === s ? "active" : ""}`} onClick={() => setStatus(status === s ? "" : s)}>
            <div className="stat-value">{summary.totals[s]}</div>
            <div className="stat-label">{STATUS_LABELS[s]}</div>
          </button>
        ))}
      </div>

      <div className="dashboard-grid stock-grid">
        <div className="card">
          <h3>Par modèle</h3>
          {summary.models.length === 0 ? (
            <p className="muted">Aucune borne enregistrée. Commencez par une réception.</p>
          ) : (
            <table className="stock-table">
              <thead>
                <tr><th>Modèle</th><th>Dépôt</th><th>Techniciens</th><th>Installées</th></tr>
              </thead>
              <tbody>
                {summary.models.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}</td>
                    <td><strong>{m.EN_STOCK}</strong></td>
                    <td>{m.CHEZ_TECHNICIEN}</td>
                    <td>{m.INSTALLEE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Bornes chez les techniciens</h3>
          {summary.technicians.filter((t) => t.chargers.length).length === 0 && <p className="muted">Aucune borne en circulation.</p>}
          {summary.technicians
            .filter((t) => t.chargers.length)
            .map((t) => (
              <div key={t.technician.id} className="tech-block">
                <div className="tech-block-head">
                  <strong>{techName(t.technician)}</strong>
                  <span className="count">{t.chargers.length}</span>
                </div>
                {t.chargers.map((c) => (
                  <button key={c.id} className={`tech-charger ${c.overdue ? "overdue" : ""}`} onClick={() => setOpenId(c.id)}>
                    <span className="mono">{c.serialNumber}</span>
                    <span className="muted">{c.model}</span>
                    <span className="tech-charger-days">{c.days} j</span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </div>

      <div className="card stock-list-card">
        <div className="stock-list-head">
          <h3>Toutes les bornes</h3>
          <div className="stock-filters">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="N° de série, modèle ou client" />
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {chargers.length === 0 ? (
          <p className="muted">Aucune borne.</p>
        ) : (
          <div className="stock-rows">
            {chargers.map((c) => (
              <button key={c.id} className="stock-row" onClick={() => setOpenId(c.id)}>
                <span className="mono stock-row-serial">{c.serialNumber}</span>
                <span className="stock-row-model">{c.model}</span>
                <span className={`badge stock-badge-${c.status.toLowerCase()}`}>{STATUS_LABELS[c.status]}</span>
                <span className="stock-row-where muted">
                  {c.status === "INSTALLEE" && leadLabel(c.lead)}
                  {c.status === "CHEZ_TECHNICIEN" && techName(c.technician)}
                  {c.status === "EN_STOCK" && c.reception && `Reçue le ${fmtDate(c.reception.receivedAt)}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="dashboard-grid stock-grid">
        <div className="card">
          <h3>Dernières réceptions</h3>
          {summary.recentReceptions.length === 0 && <p className="muted">Aucune réception.</p>}
          {summary.recentReceptions.map((r) => (
            <div key={r.id} className="bar-row">
              <span>
                {fmtDate(r.receivedAt)} — {r.supplier}
                {r.blNumber && ` — BL ${r.blNumber}`}
              </span>
              <span className="muted">
                {r._count.chargers} borne(s){r.receivedBy && ` · ${r.receivedBy.firstName}`}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="stock-list-head">
            <h3>Techniciens</h3>
            <button className="btn-link" onClick={() => setShowTechs(!showTechs)}>{showTechs ? "Masquer" : "Gérer"}</button>
          </div>
          <p className="muted">Les techniciens n'ont pas de compte CRM: cette liste sert uniquement au suivi des bornes.</p>
          {techs.map((t) => (
            <div key={t.id} className={`bar-row ${t.active ? "" : "tech-inactive"}`}>
              <span>
                {techName(t)}
                {t.phone && <span className="muted"> · {t.phone}</span>}
              </span>
              {showTechs ? (
                <button className="btn-link" onClick={() => toggleTech(t)}>{t.active ? "Désactiver" : "Réactiver"}</button>
              ) : (
                <span className="muted">{t._count.chargers} borne(s)</span>
              )}
            </div>
          ))}
          {showTechs && (
            <form className="tech-form" onSubmit={addTech}>
              <input placeholder="Prénom *" value={newTech.firstName} onChange={(e) => setNewTech({ ...newTech, firstName: e.target.value })} />
              <input placeholder="Nom" value={newTech.lastName} onChange={(e) => setNewTech({ ...newTech, lastName: e.target.value })} />
              <input placeholder="Téléphone" value={newTech.phone} onChange={(e) => setNewTech({ ...newTech, phone: e.target.value })} />
              <button className="btn-primary" type="submit">Ajouter</button>
            </form>
          )}
        </div>
      </div>

      {openId && <ChargerModal chargerId={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
    </div>
  );
}
