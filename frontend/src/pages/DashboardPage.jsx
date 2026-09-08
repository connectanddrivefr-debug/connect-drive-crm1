import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { api } from "../api/client";

const STATUS_LABELS = {
  NOUVEAU: "Nouveau",
  CONTACTE: "Contacté",
  DEVIS_ENVOYE: "Devis envoyé",
  SIGNE: "Signé",
  PERDU: "Perdu",
};
const STATUS_COLORS = {
  NOUVEAU: "#5b8fe0",
  CONTACTE: "#f59e0b",
  DEVIS_ENVOYE: "#8b5cf6",
  SIGNE: "#16a34a",
  PERDU: "#dc2626",
};
const SOURCE_LABELS = {
  WEBFLOW: "Webflow",
  META: "Meta Ads",
  MANUEL: "Manuel",
  SIMULATEUR: "Simulateur",
  AUTRE: "Autre",
};
const SOURCE_COLORS = {
  WEBFLOW: "#1d4ed8",
  META: "#6d28d9",
  MANUEL: "#15803d",
  SIMULATEUR: "#b45309",
  AUTRE: "#64748b",
};

function formatEuro(value) {
  return `${Math.round(value || 0).toLocaleString("fr-FR")} €`;
}

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

  // Taux de conversion = leads signés / total des leads (pas seulement
  // parmi les leads clos) — seuils à ajuster si besoin selon ce qui est
  // normal pour l'activité: >=10% vert, 5-10% orange, <5% rouge.
  function rateColor(rate) {
    if (rate == null) return "#94a3b8"; // gris: pas encore de leads
    if (rate >= 10) return "#16a34a";
    if (rate >= 5) return "#f59e0b";
    return "#dc2626";
  }

  const performance = stats.performance || [];
  // Vue "principale" en haut: le Global pour l'admin, ou directement (et
  // seulement) sa propre ligne pour un commercial (le backend ne renvoie
  // que celle-ci dans ce cas, donc performance[0] fonctionne aussi).
  const primary = performance.find((p) => p.key === "global") || performance[0];
  // Classement des commerciaux (hors Global / Non assigné) pour le graphique
  const commercialRows = performance.filter((p) => p.key !== "global" && p.key !== "unassigned");

  const perCommercialChart = commercialRows.map((p) => ({
    name: p.name,
    "Leads signés": p.signedLeads,
    "CA signé": p.revenue,
  }));

  const statusChart = stats.byStatus
    .map((s) => ({
      name: STATUS_LABELS[s.status] || s.status,
      value: s._count,
      color: STATUS_COLORS[s.status] || "#94a3b8",
    }))
    .filter((s) => s.value > 0);

  const sourceChart = stats.bySource
    .map((s) => ({
      name: SOURCE_LABELS[s.source] || s.source,
      value: s._count,
      color: SOURCE_COLORS[s.source] || "#94a3b8",
    }))
    .filter((s) => s.value > 0);

  return (
    <div className="dashboard-page">
      <div className="kanban-header">
        <h1>Tableau de bord</h1>
        <button className="btn-primary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Export…" : "Exporter les leads (CSV)"}
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Leads au total</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{primary ? primary.signedLeads : "—"}</div>
          <div className="stat-label">Leads signés{primary?.key === "global" ? " (global)" : ""}</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{primary ? formatEuro(primary.revenue) : "—"}</div>
          <div className="stat-label">Chiffre d'affaires signé</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: rateColor(stats.conversionRate) }}>
            {stats.conversionRate != null ? `${stats.conversionRate.toFixed(1)}%` : "—"}
          </div>
          <div className="stat-label">Taux de conversion (signé / total leads)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {stats.avgDaysToSign != null ? `${stats.avgDaysToSign.toFixed(1)} j` : "—"}
          </div>
          <div className="stat-label">Délai moyen de signature</div>
        </div>
      </div>

      {performance.length > 0 && (
        <div className="stats-grid" style={{ marginTop: 16 }}>
          {performance.map((r) => (
            <div key={r.key} className="stat-card" style={{ borderTop: `4px solid ${rateColor(r.conversionRate)}` }}>
              <div className="stat-value" style={{ color: rateColor(r.conversionRate) }}>
                {r.conversionRate != null ? `${r.conversionRate.toFixed(0)}%` : "—"}
              </div>
              <div className="stat-label">{r.name}</div>
              <div className="muted" style={{ marginTop: 4 }}>
                {r.signedLeads} signé{r.signedLeads > 1 ? "s" : ""} / {r.totalLeads} lead{r.totalLeads > 1 ? "s" : ""}
                {r.lostLeads > 0 ? ` · ${r.lostLeads} perdu${r.lostLeads > 1 ? "s" : ""}` : ""}
              </div>
              <div className="muted" style={{ marginTop: 2, fontWeight: 700, color: "#1e293b" }}>
                {formatEuro(r.revenue)}
                {r.avgDealSize != null && (
                  <span className="muted" style={{ fontWeight: 400 }}> ({formatEuro(r.avgDealSize)} / vente)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {perCommercialChart.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Chiffre d'affaires &amp; leads signés par commercial</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={perCommercialChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" />
              <YAxis yAxisId="left" orientation="left" tickFormatter={(v) => `${v} €`} width={70} />
              <YAxis yAxisId="right" orientation="right" allowDecimals={false} width={40} />
              <Tooltip formatter={(value, name) => (name === "CA signé" ? formatEuro(value) : value)} />
              <Legend />
              <Bar yAxisId="right" dataKey="Leads signés" fill="#5b8fe0" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="CA signé" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Répartition par statut</h3>
          {statusChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusChart} dataKey="value" nameKey="name" outerRadius={85} label>
                  {statusChart.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">Aucune donnée.</p>
          )}
        </div>
        <div className="card">
          <h3>Répartition par source</h3>
          {sourceChart.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={sourceChart} dataKey="value" nameKey="name" outerRadius={85} label>
                  {sourceChart.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="muted">Aucune donnée.</p>
          )}
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
