import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { extractBlText, classifyFromBl } from "../lib/blParse";
import { STATUS_LABELS } from "../lib/stock";

// Classement des bornes déjà scannées par référence, à partir du bon de
// livraison fournisseur (PDF ou photo). Lecture faite dans le navigateur
// (gratuit), puis aperçu à valider avant toute modification.
export default function StockBlPage() {
  const fileRef = useRef(null);
  const [known, setKnown] = useState([]);
  const [refs, setRefs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { groups, found }
  const [labels, setLabels] = useState({}); // key -> libellé saisi
  const [rawText, setRawText] = useState("");
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAllSerials().then(setKnown).catch((e) => setError(e.message));
    api.getRefs().then(setRefs).catch(() => {});
  }, []);

  function refLabel(g) {
    const r = refs.find((x) => (g.reference && x.reference === g.reference) || (g.ean && x.ean === g.ean));
    return r ? r.label : "";
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    setDone(null);
    setProgress(0);
    try {
      const text = await extractBlText(file, (p) => setProgress(Math.round(p * 100)));
      setRawText(text);
      const r = classifyFromBl(text, known);
      setResult(r);
      const l = {};
      for (const g of r.groups) l[g.key] = refLabel(g);
      setLabels(l);
      if (!r.found) setError("Aucun numéro de série du stock n'a été retrouvé dans ce BL. Vérifiez que les bornes ont bien été scannées, ou essayez une photo plus nette / le PDF.");
    } catch (err) {
      setError("Lecture du BL impossible : " + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setSaving(true);
    setError("");
    try {
      const items = result.groups.flatMap((g) =>
        g.serials.map((s) => ({ serialNumber: s, reference: g.reference, ean: g.ean, label: labels[g.key] || undefined, source: "BL" }))
      );
      const r = await api.assignRefs(items);
      setDone(r.updated);
      api.getAllSerials().then(setKnown).catch(() => {});
      api.getRefs().then(setRefs).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const bySerial = Object.fromEntries(known.map((k) => [k.serialNumber, k]));

  return (
    <div className="stock-scan stock-bl">
      <Link to="/stock" className="back-link">← Stock</Link>
      <h1>Classer avec un bon de livraison</h1>
      <p className="muted">
        Importez le BL fournisseur (PDF ou photo). Les numéros de série déjà scannés au dépôt sont retrouvés dans le BL et
        classés automatiquement par référence (7,4 kW, 22 kW, longueur de câble…). Rien n'est modifié avant votre validation.
      </p>

      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={onFile} />
      <button className="btn-primary scan-photo-btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
        {busy ? `Lecture du BL… ${progress ? progress + " %" : ""}` : "📄 Importer le BL (PDF ou photo)"}
      </button>

      {error && <p className="error">{error}</p>}
      {done !== null && <p className="kraaft-ok">✓ {done} borne(s) classée(s). Le stock par modèle est à jour.</p>}

      {result && result.groups.length > 0 && (
        <>
          <p>
            <strong>{result.found}</strong> numéro(s) de série retrouvé(s) dans le BL, répartis en{" "}
            <strong>{result.groups.length}</strong> référence(s) :
          </p>
          {result.groups.map((g) => (
            <div key={g.key} className="card bl-group">
              <div className="bl-group-head">
                <span className="mono">{g.reference || `EAN ${g.ean}`}</span>
                {g.reference && g.ean && <span className="muted mono"> · EAN {g.ean}</span>}
                <span className="count">{g.serials.length} borne(s)</span>
              </div>
              <label className="bl-label">
                Nom de la référence
                <input
                  value={labels[g.key] || ""}
                  placeholder="ex. V2C Trydan 22 kW câble 5 m"
                  onChange={(e) => setLabels({ ...labels, [g.key]: e.target.value })}
                />
              </label>
              <div className="bl-serials">
                {g.serials.map((s) => (
                  <span key={s} className="bl-serial">
                    <span className="mono">{s}</span>
                    {bySerial[s] && <span className="muted"> · {bySerial[s].model} · {STATUS_LABELS[bySerial[s].status]}</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="scan-submit">
            <button className="btn-primary" disabled={saving} onClick={apply}>
              {saving ? "Classement…" : `Valider le classement (${result.found} bornes)`}
            </button>
          </div>
        </>
      )}

      {rawText && (
        <p>
          <button className="btn-link" onClick={() => setShowText(!showText)}>
            {showText ? "Masquer" : "Voir"} le texte lu sur le BL
          </button>
        </p>
      )}
      {showText && <pre className="bl-raw">{rawText}</pre>}
    </div>
  );
}
