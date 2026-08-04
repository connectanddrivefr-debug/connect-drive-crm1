import { useEffect, useState } from "react";
import { api } from "../api/client";

export default function DashboardPage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.getStats().then(setStats);
  }, []);

  if (!stats) return <p>Chargement…</p>;

  return (
    <div className="dashboard-page">
      <h1>Tableau de bord</h1>
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
    </div>
  );
}
