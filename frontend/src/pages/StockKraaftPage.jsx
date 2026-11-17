import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { STATUS_LABELS, techName, leadLabel, fmtDate } from "../lib/stock";

// Rattrapage du stock depuis Kraaft: on relit les photos de TOUTES les
// conversations (y compris celles créées à la main, sans fiche CRM), puis on
// compare avec le stock. Rien n'est modifié avant validation.
export default function StockKraaftPage() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, found: 0 });
  const [error, setError] = useState("");
  const [sel, setSel] = useState({}); // code -> { checked, leadId }
  const [search, setSearch] = useState({}); // code -> { q, results }
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const stopRef = useRef(false);

  async function load() {
    const r = await api.getKraaftBackfill();
    setReport(r);
    const s = {};
    for (const row of r.rows) {
      const lead = row.roomLead || row.suggestedLead;
      const needs = !row.applied && (!row.charger || row.charger.status !== "INSTALLEE");
      s[row.code] = { checked: needs, leadId: lead ? lead.id : row.charger && row.charger.lead ? row.charger.lead.id : "" };
    }
    setSel(s);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function run(restart = false) {
    setRunning(true);
    setError("");
    setDone(null);
    stopRef.current = false;
    let total = { processed: 0, found: 0 };
    setProgress(total);
    try {
      let first = true;
      for (;;) {
        const r = await api.runKraaftBackfill(first && restart);
        first = false;
        total = { processed: total.processed + (r.processed || 0), found: total.found + (r.found || 0) };
        setProgress(total);
        if (!r.hasMore || stopRef.current) break;
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function findClient(code, q) {
    setSearch((s) => ({ ...s, [code]: { q, results: s[code]?.results || [] } }));
    if (q.trim().length < 2) return;
    const results = await api.searchStockClients(q).catch(() => []);
    setSearch((s) => ({ ...s, [code]: { q, results } }));
  }

  async function apply() {
    setSaving(true);
    setError("");
    try {
      const items = Object.entries(sel)
        .filter(([, v]) => v.checked)
        .map(([code, v]) => ({ code, leadId: v.leadId || null }));
      const r = await api.applyKraaftBackfill(items);
      setDone(r);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!report) return <p className="muted">{error || "Chargement…"}</p>;

  const rows = report.rows;
  const toFix = rows.filter((r) => !r.applied && (!r.charger || r.charger.status !== "INSTALLEE"));
  const checkedCount = Object.values(sel).filter((v) => v.checked).length;

  function clientOptions(row) {
    const opts = new Map();
    for (const l of [row.roomLead, row.suggestedLead, row.charger && row.charger.lead, ...(search[row.code]?.results || [])]) {
      if (l && l.id) opts.set(l.id, l);
    }
    return [...opts.values()];
  }

  return (
    <div className="stock-scan stock-bl">
      <Link to="/stock" className="back-link">← Stock</Link>
      <h1>Rattrapage du stock depuis Kraaft</h1>
      <p className="muted">
        Le CRM relit les photos de toutes les conversations Kraaft, y compris celles créées sans passer par le CRM, et
        retrouve les numéros de série des bornes posées. Vous validez ensuite : les bornes cochées passent en « Installée »
        (date et technicien de la photo). Rien n'est modifié avant votre validation.
      </p>

      <div className="scan-submit" style={{ gap: 8, display: "flex", flexWrap: "wrap" }}>
        <button className="btn-primary" disabled={running} onClick={() => run(false)}>
          {running
            ? `Lecture des conversations… ${progress.processed} messages, ${progress.found} borne(s) trouvée(s)`
            : report.started
            ? "🔄 Continuer / mettre à jour l'analyse Kraaft"
            : "🔍 Analyser toutes les conversations Kraaft"}
        </button>
        {running && (
          <button className="btn-ghost" onClick={() => (stopRef.current = true)}>
            Mettre en pause
          </button>
        )}
        {!running && report.started && (
          <button className="btn-ghost" onClick={() => window.confirm("Relancer l'analyse depuis le début ?") && run(true)}>
            Tout relire depuis le début
          </button>
        )}
      </div>
      {running && <p className="muted">L'analyse peut prendre plusieurs minutes (chaque photo est lue). Gardez cette page ouverte.</p>}
      {report.doneAt && !running && <p className="muted">Dernière analyse complète : {fmtDate(report.doneAt, true)}</p>}

      {error && <p className="error">{error}</p>}
      {done && (
        <p className="kraaft-ok">
          ✓ {done.installed} borne(s) passée(s) en « Installée »{done.created > 0 && ` dont ${done.created} ajoutée(s) au stock`}
          {done.skipped > 0 && ` · ${done.skipped} déjà à jour`}.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <h2>
            {rows.length} borne(s) vue(s) dans Kraaft — <strong>{toFix.length}</strong> à corriger dans le stock
          </h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="stock-table">
              <thead>
                <tr>
                  <th></th>
                  <th>N° de série</th>
                  <th>Référence</th>
                  <th>Conversation Kraaft</th>
                  <th>État actuel du stock</th>
                  <th>Client</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const v = sel[row.code] || { checked: false, leadId: "" };
                  const options = clientOptions(row);
                  return (
                    <tr key={row.code} className={row.applied || (row.charger && row.charger.status === "INSTALLEE") ? "muted" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={v.checked}
                          onChange={(e) => setSel({ ...sel, [row.code]: { ...v, checked: e.target.checked } })}
                        />
                      </td>
                      <td className="mono">{row.code}</td>
                      <td>{row.refLabel || row.refCode || (row.charger && row.charger.model) || "—"}</td>
                      <td>
                        {row.roomName || "Conversation sans nom"}
                        <div className="muted">
                          {fmtDate(row.sentAt)}
                          {row.technician && ` · ${techName(row.technician)}`}
                          {row.rooms.length > 1 && ` · vue dans ${row.rooms.length} conversations`}
                        </div>
                      </td>
                      <td>
                        {row.charger ? (
                          <>
                            {STATUS_LABELS[row.charger.status]}
                            {row.charger.status === "CHEZ_TECHNICIEN" && row.charger.technician && ` (${techName(row.charger.technician)})`}
                            {row.charger.status === "INSTALLEE" && row.charger.lead && ` — ${leadLabel(row.charger.lead)}`}
                          </>
                        ) : (
                          <span className="error">Absente du stock (sera ajoutée)</span>
                        )}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <select value={v.leadId} onChange={(e) => setSel({ ...sel, [row.code]: { ...v, leadId: e.target.value } })}>
                          <option value="">— Sans fiche client —</option>
                          {options.map((l) => (
                            <option key={l.id} value={l.id}>
                              {leadLabel(l)}
                              {row.suggestedLead && row.suggestedLead.id === l.id ? " (proposé)" : ""}
                            </option>
                          ))}
                        </select>
                        <input
                          placeholder="Chercher un client…"
                          value={search[row.code]?.q || ""}
                          onChange={(e) => findClient(row.code, e.target.value)}
                          style={{ marginTop: 4, width: "100%" }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="scan-submit">
            <button className="btn-primary" disabled={saving || running || checkedCount === 0} onClick={apply}>
              {saving ? "Mise à jour du stock…" : `Valider : ${checkedCount} borne(s) en « Installée »`}
            </button>
          </div>
        </>
      )}

      {report.started && (
        <>
          <h2>{report.notSeen.length} borne(s) du stock jamais vue(s) dans Kraaft</h2>
          <p className="muted">
            Sans photo dans aucune conversation : a priori pas encore installées (au dépôt ou chez un technicien). À vérifier
            physiquement si le nombre paraît anormal.
          </p>
          {report.notSeen.length > 0 && (
            <div className="card bl-serials">
              {report.notSeen.map((c) => (
                <span key={c.id} className="bl-serial">
                  <span className="mono">{c.serialNumber}</span>
                  <span className="muted">
                    {" "}
                    · {c.model} · {STATUS_LABELS[c.status]}
                    {c.technician && ` (${techName(c.technician)})`}
                  </span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
