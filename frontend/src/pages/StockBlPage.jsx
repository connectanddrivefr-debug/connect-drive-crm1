import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { extractBlText, classifyFromBl, parseV2cBl } from "../lib/blParse";
import { STATUS_LABELS } from "../lib/stock";

// Import d'un bon de livraison fournisseur (PDF ou photo), lu dans le
// navigateur (gratuit). Aperçu à valider avant toute modification.
// - BL V2C (albarán): chaque référence et ses numéros de série sont lus; les
//   bornes nouvelles entrent en stock (réception), celles déjà en stock sont
//   classées / corrigées. Le scan des cartons n'est plus nécessaire.
// - Autre BL: classement des bornes déjà scannées par référence.
export default function StockBlPage() {
  const fileRef = useRef(null);
  const [known, setKnown] = useState([]);
  const [refs, setRefs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPhoto, setIsPhoto] = useState(false);
  const [v2c, setV2c] = useState(null); // { blNumber, groups }
  const [choice, setChoice] = useState({}); // reference -> libellé choisi
  const [result, setResult] = useState(null); // BL générique { groups, found }
  const [labels, setLabels] = useState({});
  const [rawText, setRawText] = useState("");
  const [showText, setShowText] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAllSerials().then(setKnown).catch((e) => setError(e.message));
    api.getRefs().then(setRefs).catch(() => {});
  }, []);

  function findRef(reference, ean) {
    return refs.find((x) => (reference && x.reference === reference) || (ean && x.ean === ean)) || null;
  }

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    setV2c(null);
    setDone(null);
    setProgress(0);
    const photo = !(file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    setIsPhoto(photo);
    try {
      const text = await extractBlText(file, (p) => setProgress(Math.round(p * 100)));
      setRawText(text);
      const parsed = parseV2cBl(text);
      if (parsed.groups.length) {
        setV2c(parsed);
        const c = {};
        for (const g of parsed.groups) {
          const r = findRef(g.reference);
          c[g.reference] = r ? r.label : "";
        }
        setChoice(c);
        return;
      }
      const r = classifyFromBl(text, known);
      setResult(r);
      const l = {};
      for (const g of r.groups) {
        const ref = findRef(g.reference, g.ean);
        l[g.key] = ref ? ref.label : "";
      }
      setLabels(l);
      if (!r.found) setError("Aucun numéro de série reconnu dans ce BL. Essayez le PDF reçu par e-mail plutôt qu'une photo.");
    } catch (err) {
      setError("Lecture du BL impossible : " + err.message);
    } finally {
      setBusy(false);
    }
  }

  const bySerial = Object.fromEntries(known.map((k) => [k.serialNumber, k]));

  // --- BL V2C -------------------------------------------------------------
  async function applyV2c() {
    setSaving(true);
    setError("");
    try {
      const fresh = [];
      const existing = [];
      for (const g of v2c.groups) {
        const label = (choice[g.reference] || "").trim();
        if (!label) throw new Error(`Choisissez la référence pour ${g.reference}`);
        const ref = refs.find((r) => r.label === label);
        const base = { model: label, label, ean: ref ? ref.ean : null, reference: g.reference };
        for (const s of g.serials) {
          if (bySerial[s]) existing.push({ serialNumber: s, ...base, source: "BL" });
          else fresh.push({ serialNumber: s, ...base });
        }
      }
      let received = 0;
      let classed = 0;
      if (fresh.length) {
        const r = await api.createReception({ supplier: "V2C", blNumber: v2c.blNumber, items: fresh });
        received = r.count;
      }
      if (existing.length) {
        const r = await api.assignRefs(existing);
        classed = r.updated;
      }
      setDone({ received, classed, already: existing.length - classed });
      setV2c(null);
      api.getAllSerials().then(setKnown).catch(() => {});
      api.getRefs().then(setRefs).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // --- BL générique (classement des bornes déjà scannées) -----------------
  async function applyGeneric() {
    setSaving(true);
    setError("");
    try {
      const items = result.groups.flatMap((g) =>
        g.serials.map((s) => ({ serialNumber: s, reference: g.reference, ean: g.ean, label: labels[g.key] || undefined, source: "BL" }))
      );
      const r = await api.assignRefs(items);
      setDone({ received: 0, classed: r.updated, already: 0 });
      setResult(null);
      api.getAllSerials().then(setKnown).catch(() => {});
      api.getRefs().then(setRefs).catch(() => {});
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const catalogLabels = [...new Set(refs.map((r) => r.label))].sort((a, b) => a.localeCompare(b, "fr"));
  const v2cTotal = v2c ? v2c.groups.reduce((n, g) => n + g.serials.length, 0) : 0;
  const v2cNew = v2c ? v2c.groups.reduce((n, g) => n + g.serials.filter((s) => !bySerial[s]).length, 0) : 0;

  return (
    <div className="stock-scan stock-bl">
      <Link to="/stock" className="back-link">← Stock</Link>
      <h1>Importer un bon de livraison</h1>
      <p className="muted">
        Déposez le BL fournisseur (le PDF reçu par e-mail de préférence, sinon une photo nette). Les bornes sont lues avec
        leur référence et classées automatiquement. Rien n'est enregistré avant votre validation.
      </p>

      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={onFile} />
      <button className="btn-primary scan-photo-btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
        {busy ? `Lecture du BL… ${progress ? progress + " %" : ""}` : "📄 Importer le BL (PDF ou photo)"}
      </button>

      {error && <p className="error">{error}</p>}
      {done && (
        <p className="kraaft-ok">
          ✓ {done.received > 0 && `${done.received} borne(s) entrée(s) en stock. `}
          {done.classed > 0 && `${done.classed} borne(s) déjà en stock reclassée(s). `}
          {done.already > 0 && `${done.already} borne(s) déjà à jour.`}
        </p>
      )}

      {v2c && (
        <>
          <p>
            BL <strong className="mono">{v2c.blNumber || "V2C"}</strong> : <strong>{v2cTotal}</strong> borne(s) en{" "}
            <strong>{v2c.groups.length}</strong> référence(s) — <strong>{v2cNew}</strong> nouvelle(s) à entrer en stock.
          </p>
          {isPhoto && (
            <p className="error">
              Lu depuis une photo : vérifiez les numéros de série avant de valider (une lettre peut être mal lue).
            </p>
          )}
          {v2c.groups.map((g) => {
            const mismatch = g.qty !== null && g.qty !== g.serials.length;
            return (
              <div key={g.reference} className="card bl-group">
                <div className="bl-group-head">
                  <span className="mono">{g.reference}</span>
                  <span className="count">
                    {g.serials.length} borne(s){mismatch && ` — le BL en annonce ${g.qty} !`}
                  </span>
                </div>
                <p className="muted">{g.description}</p>
                <label className="bl-label">
                  Référence dans le stock
                  <select value={choice[g.reference] || ""} onChange={(e) => setChoice({ ...choice, [g.reference]: e.target.value })}>
                    <option value="">— Choisir (une seule fois, elle sera retenue) —</option>
                    {catalogLabels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <div className="bl-serials">
                  {g.serials.map((s) => (
                    <span key={s} className="bl-serial">
                      <span className="mono">{s}</span>
                      {bySerial[s] ? (
                        <span className="muted"> · déjà en stock ({STATUS_LABELS[bySerial[s].status]})</span>
                      ) : (
                        <span className="muted"> · nouvelle</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="scan-submit">
            <button className="btn-primary" disabled={saving} onClick={applyV2c}>
              {saving ? "Enregistrement…" : `Valider le BL (${v2cTotal} bornes)`}
            </button>
          </div>
        </>
      )}

      {result && result.groups.length > 0 && (
        <>
          <p>
            <strong>{result.found}</strong> borne(s) du stock retrouvée(s) dans le BL, réparties en{" "}
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
                  list="bl-catalog"
                  value={labels[g.key] || ""}
                  placeholder="Choisir dans la liste"
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
          <datalist id="bl-catalog">
            {catalogLabels.map((l) => <option key={l} value={l} />)}
          </datalist>
          <div className="scan-submit">
            <button className="btn-primary" disabled={saving} onClick={applyGeneric}>
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
