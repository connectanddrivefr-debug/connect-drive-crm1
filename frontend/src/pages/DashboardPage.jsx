import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.getStats().then(setStats);
  }, []);

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportLeadsCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-connect-drive-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Erreur export: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  if (!stats) return <p>Chargement…</p>;

  // Seuils demandés: >=35% vert, 20-35% orange, <20% rouge
  function rateColor(rate) {
    if (rate == null) return "#94a3b8"; // gris: pas encore de devis
    if (rate >= 35) return "#16a34a";
    if (rate >= 20) return "#f59e0b";
    return "#dc2626";
  }

  return (
    <div className="dashboard-page">
      <div className="kanban-header">
        <h1>Tableau de bord</h1>
        <button className="btn-primary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Export…" : "Exporter les leads (CSV)"}
        </button>
      </div>

      {stats.revenueByCommercial && stats.revenueByCommercial.length > 0 && (
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          {stats.revenueByCommercial.map((r) => (
            <div key={r.key} className="stat-card" style={{ borderTop: `4px solid ${rateColor(r.rate)}` }}>
              <div className="stat-value" style={{ color: rateColor(r.rate) }}>
                {r.rate != null ? `${r.rate.toFixed(0)}%` : "—"}
              </div>
              <div className="stat-label">{r.name}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {r.signedAmount.toLocaleString("fr-FR")} € signés / {r.totalAmount.toLocaleString("fr-FR")} € devisés
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Leads au total</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {stats.conversionRate != null ? `${stats.conversionRate.toFixed(1)}%` : "—"}
          </div>
          <div className="stat-label">Taux de conversion (signé / clos)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {stats.avgDaysToSign != null ? `${stats.avgDaysToSign.toFixed(1)} j` : "—"}
          </div>
          <div className="stat-label">Délai moyen de signature</div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <h3>Répartition par statut</h3>
          {stats.byStatus.map((s) => (
            <div key={s.status} className="bar-row">
              <span>{s.status}</span>
              <span>{s._count}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Répartition par source</h3>
          {stats.bySource.map((s) => (
            <div key={s.source} className="bar-row">
              <span>{s.source}</span>
              <span>{s._count}</span>
            </div>
          ))}
        </div>
      </div>

      {stats.staleLeads && stats.staleLeads.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>⚠️ Leads non traités depuis plus de 48h ({stats.staleLeads.length})</h3>
          <ul className="timeline">
            {stats.staleLeads.map((l) => (
              <li key={l.id}>
                <Link to={`/leads/${l.id}`}>
                  {l.firstName || ""} {l.lastName || ""} {!l.firstName && !l.lastName && l.email}
                </Link>
                {" — "}{l.status} — {l.source}
                {l.assignedTo && ` — assigné à ${l.assignedTo.firstName}`}
                {" — reçu le "}{new Date(l.createdAt).toLocaleDateString("fr-FR")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
