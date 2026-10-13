import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Scanner, { beep } from "../components/Scanner";
import { readLabel } from "../lib/labelScan";
import {
  SUPPLIERS,
  MODELS_BY_SUPPLIER,
  ALL_MODELS,
  STATUS_LABELS,
  techName,
  leadLabel,
  looksLikeProductCode,
  EAN_MODELS,
} from "../lib/stock";

// Écran de scan (pensé pour le téléphone) — 3 modes:
// - reception: entrée au dépôt de toutes les bornes reçues (BL fournisseur)
// - dotation: remise de bornes à un technicien ("borne livrée à Kevin")
// - retour: le technicien rapporte des bornes au dépôt
// - classer: bornes déjà en stock, on photographie l'étiquette pour
//   enregistrer leur référence exacte (EAN) — corrige un stock scanné sans réf.
const TITLES = {
  reception: "Nouvelle réception",
  dotation: "Remise à un technicien",
  retour: "Retour au dépôt",
  classer: "Classer par référence (étiquettes)",
};

// Vérifie l'état d'une borne scannée selon le mode, à partir de la réponse
// de /api/stock/lookup. Renvoie { level: ok|warn|error, message }.
function evaluate(mode, charger, technicianId) {
  if (mode === "reception") {
    if (charger) return { level: "error", message: `Déjà enregistrée (${STATUS_LABELS[charger.status]})` };
    return { level: "ok", message: "" };
  }
  if (!charger) return { level: "error", message: "Inconnue du stock — faire d'abord la réception" };
  if (mode === "classer") return { level: "ok", message: `Actuellement : ${charger.model}` };
  if (mode === "dotation") {
    if (charger.status === "INSTALLEE") return { level: "error", message: `Déjà installée (${leadLabel(charger.lead)})` };
    if (charger.status === "RETOUR_SAV") return { level: "error", message: "En retour SAV" };
    if (charger.status === "CHEZ_TECHNICIEN") {
      if (charger.technicianId === technicianId) return { level: "warn", message: "Déjà chez ce technicien" };
      return { level: "warn", message: `Transfert depuis ${techName(charger.technician)}` };
    }
    return { level: "ok", message: "" };
  }
  // retour
  if (charger.status !== "CHEZ_TECHNICIEN") return { level: "error", message: `Pas chez un technicien (${STATUS_LABELS[charger.status]})` };
  return { level: "ok", message: `Chez ${techName(charger.technician)}` };
}

export default function StockScanPage({ mode }) {
  const [supplier, setSupplier] = useState("V2C");
  const [blNumber, setBlNumber] = useState("");
  const [model, setModel] = useState(MODELS_BY_SUPPLIER.V2C[0]);
  const [technicians, setTechnicians] = useState([]);
  const [technicianId, setTechnicianId] = useState("");
  const [items, setItems] = useState([]); // { serial, model, level, message, charger }
  const [flash, setFlash] = useState(null); // dernier scan, affiché en grand
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const techRef = useRef(technicianId);
  techRef.current = technicianId;
  const modelRef = useRef(model);
  modelRef.current = model;
  // Référence produit courante (EAN lu sur le carton): appliquée aux S/N
  // scannés ensuite, jusqu'au prochain EAN.
  const [currentEan, setCurrentEan] = useState(null);
  const eanRef = useRef(null);
  eanRef.current = currentEan;
  const [refs, setRefs] = useState([]);
  const refsRef = useRef([]);
  refsRef.current = refs;
  const modelInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const usesRefs = mode === "reception" || mode === "classer";

  useEffect(() => {
    if (usesRefs) api.getRefs().then(setRefs).catch(() => {});
  }, [mode]);

  function applyEan(ean) {
    const known = refsRef.current.find((r) => r.ean === ean);
    const label = known ? known.label : EAN_MODELS[ean];
    setCurrentEan(ean);
    eanRef.current = ean;
    if (label) {
      setModel(label);
      modelRef.current = label;
      setFlash({ serial: ean, level: "ok", message: `Référence : ${label}. Scannez maintenant le S/N.` });
    } else {
      setModel("");
      modelRef.current = "";
      setFlash({
        serial: ean,
        level: "warn",
        message: "Nouvelle référence : tapez son nom dans « Modèle » (ex. Trydan 22 kW câble 5 m) — elle sera retenue pour les prochaines fois.",
      });
      setTimeout(() => modelInputRef.current && modelInputRef.current.focus(), 50);
    }
    beep(true);
  }

  // Photo de l'étiquette: lit en une fois le S/N ET le code-barres produit.
  async function handleLabelPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try {
      const { serials, eans } = await readLabel(file);
      if (eans.length && usesRefs) applyEan(eans[0]);
      if (!serials.length) {
        beep(false);
        setFlash({ serial: "—", level: "error", message: "Aucun numéro de série lu sur la photo : rapprochez-vous de l'étiquette, bien à plat." });
        return;
      }
      for (const sn of serials) await handleScan(sn, sn, { ean: eans[0] || null });
    } catch (err) {
      setFlash({ serial: "—", level: "error", message: "Lecture de la photo impossible : " + err.message });
    } finally {
      setPhotoBusy(false);
    }
  }

  useEffect(() => {
    if (mode === "dotation") {
      api.getTechnicians().then((list) => setTechnicians(list.filter((t) => t.active)));
    }
  }, [mode]);

  // Réévalue la liste si on change de technicien après avoir scanné
  useEffect(() => {
    if (mode !== "dotation") return;
    setItems((prev) => prev.map((it) => (it.charger !== undefined ? { ...it, ...evaluate(mode, it.charger, technicianId) } : it)));
  }, [technicianId]);

  function changeSupplier(s) {
    setSupplier(s);
    setModel(MODELS_BY_SUPPLIER[s][0] || "");
  }

  async function handleScan(serial, raw, opts = {}) {
    // Code-barres produit (EAN) = référence du modèle, pas un numéro de série
    if (looksLikeProductCode(serial)) {
      if (usesRefs) {
        applyEan(serial);
      } else {
        beep(false);
        setFlash({
          serial,
          level: "warn",
          message: "Code-barres produit (référence), pas le numéro de série : scannez le QR code ou le code-barres « S/N ».",
        });
      }
      return;
    }
    if (itemsRef.current.some((it) => it.serial === serial)) {
      beep(false);
      setFlash({ serial, level: "error", message: "Déjà scannée" });
      return;
    }
    const ean = usesRefs ? (opts.ean !== undefined ? opts.ean : eanRef.current) : null;
    const known = ean ? refsRef.current.find((r) => r.ean === ean) : null;
    const item = { serial, ean, model: known ? known.label : modelRef.current, level: "pending", message: "Vérification…" };
    setItems((prev) => [item, ...prev]);
    try {
      const { charger } = await api.lookupSerial(serial);
      const ev = evaluate(mode, charger, techRef.current);
      beep(ev.level !== "error");
      setFlash({ serial, ...ev });
      setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, ...ev, charger } : it)));
    } catch (e) {
      beep(false);
      setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, level: "error", message: e.message } : it)));
    }
  }

  function removeItem(serial) {
    setItems((prev) => prev.filter((it) => it.serial !== serial));
  }

  function setItemModel(serial, m) {
    setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, model: m } : it)));
  }

  // Nom tapé pour une nouvelle référence: appliqué à toutes les bornes de cet EAN
  function changeModel(m) {
    setModel(m);
    modelRef.current = m;
    if (currentEan && !refs.find((r) => r.ean === currentEan)) {
      setItems((prev) => prev.map((it) => (it.ean === currentEan ? { ...it, model: m } : it)));
    }
  }

  const valid = items.filter((it) => it.level === "ok" || it.level === "warn");
  const errors = items.filter((it) => it.level === "error");
  const pending = items.some((it) => it.level === "pending");

  async function submit() {
    setError("");
    if (mode === "dotation" && !technicianId) return setError("Choisissez le technicien");
    if (usesRefs && valid.some((it) => !it.model)) return setError("Indiquez le modèle de chaque borne");
    setSaving(true);
    try {
      const serials = valid.map((it) => it.serial);
      if (mode === "reception") {
        const r = await api.createReception({
          supplier,
          blNumber,
          items: valid.map((it) => ({ serialNumber: it.serial, model: it.model, ean: it.ean })),
        });
        setDone({ count: r.count, text: `${r.count} borne(s) entrée(s) en stock${blNumber ? ` — BL ${blNumber}` : ""}` });
      } else if (mode === "classer") {
        const withRef = valid.filter((it) => it.ean);
        if (!withRef.length) {
          setSaving(false);
          return setError("Aucune référence lue : photographiez l'étiquette complète (S/N + code-barres produit)");
        }
        const r = await api.assignRefs(withRef.map((it) => ({ serialNumber: it.serial, ean: it.ean, label: it.model })));
        setDone({ count: r.updated, text: `${r.updated} borne(s) classée(s) par référence` });
      } else if (mode === "dotation") {
        const r = await api.createDotation(technicianId, serials);
        setDone({ count: r.count, text: `${r.count} borne(s) remise(s) à ${techName(r.technician)}` });
      } else {
        const r = await api.returnToDepot(serials);
        setDone({ count: r.count, text: `${r.count} borne(s) revenue(s) au dépôt` });
      }
    } catch (e) {
      const d = e.details || {};
      if (d.duplicates || d.errors) {
        const bad = new Set(d.duplicates || d.errors.map((x) => x.serialNumber));
        setItems((prev) =>
          prev.map((it) =>
            bad.has(it.serial)
              ? { ...it, level: "error", message: (d.errors || []).find((x) => x.serialNumber === it.serial)?.error || "Déjà enregistrée" }
              : it
          )
        );
      }
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    setItems([]);
    setFlash(null);
    setDone(null);
    setBlNumber("");
    setError("");
    api.getRefs().then(setRefs).catch(() => {});
  }

  if (done) {
    return (
      <div className="stock-scan">
        <Link to="/stock" className="back-link">← Stock</Link>
        <div className="scan-done card">
          <div className="scan-done-icon">✓</div>
          <h2>{done.text}</h2>
          <div className="scan-done-actions">
            <button className="btn-primary" onClick={restart}>{TITLES[mode]} (suivante)</button>
            <Link to="/stock" className="btn-ghost">Retour au stock</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stock-scan">
      <Link to="/stock" className="back-link">← Stock</Link>
      <h1>{TITLES[mode]}</h1>

      <div className="card scan-settings">
        {mode === "reception" && (
          <>
            <label>
              Fournisseur
              <select value={supplier} onChange={(e) => changeSupplier(e.target.value)}>
                {SUPPLIERS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label>
              N° de BL (optionnel)
              <input value={blNumber} onChange={(e) => setBlNumber(e.target.value)} placeholder="ex. BL-2026-0451" />
            </label>
          </>
        )}
        {usesRefs && (
          <label className="scan-settings-full">
            Modèle des bornes scannées{currentEan && <span className="mono"> · EAN {currentEan}</span>}
            <input
              ref={modelInputRef}
              list="stock-models"
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              placeholder="ex. V2C Trydan 22 kW câble 5 m"
            />
            <datalist id="stock-models">
              {[...new Set([...refs.map((r) => r.label), ...ALL_MODELS])].map((m) => <option key={m} value={m} />)}
            </datalist>
            <span className="muted">
              Le plus simple : <strong>📸 photographiez l'étiquette</strong> de chaque carton, le S/N et la référence sont lus
              ensemble. Au scanner, scannez le code-barres produit puis le S/N.
            </span>
          </label>
        )}
        {mode === "dotation" && (
          <label className="scan-settings-full">
            Technicien
            <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">— Choisir —</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{techName(t)}</option>)}
            </select>
            {technicians.length === 0 && (
              <span className="muted">Aucun technicien: ajoutez-les depuis la page <Link to="/stock">Stock</Link>.</span>
            )}
          </label>
        )}
      </div>

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleLabelPhoto}
      />
      <button
        type="button"
        className="btn-primary scan-photo-btn"
        disabled={saving || photoBusy || (mode === "dotation" && !technicianId)}
        onClick={() => photoInputRef.current && photoInputRef.current.click()}
      >
        {photoBusy ? "Lecture de l'étiquette…" : "📸 Photo de l'étiquette (S/N + référence)"}
      </button>

      <Scanner onScan={handleScan} disabled={saving || (mode === "dotation" && !technicianId)} />

      {flash && (
        <div className={`scan-flash scan-${flash.level}`}>
          <span className="scan-flash-serial">{flash.serial}</span>
          {flash.message && <span>{flash.message}</span>}
        </div>
      )}

      <div className="card scan-list">
        <div className="scan-list-header">
          <strong>{valid.length} borne(s) prête(s)</strong>
          {errors.length > 0 && <span className="scan-count-error">{errors.length} en erreur</span>}
        </div>
        {items.length === 0 && <p className="muted">Scannez les cartons un par un: la liste se remplit automatiquement.</p>}
        <ul>
          {items.map((it) => (
            <li key={it.serial} className={`scan-item scan-${it.level}`}>
              <div className="scan-item-main">
                <span className="scan-item-serial">{it.serial}</span>
                {usesRefs ? (
                  <input
                    className="scan-item-model"
                    list="stock-models"
                    value={it.model}
                    onChange={(e) => setItemModel(it.serial, e.target.value)}
                  />
                ) : (
                  it.charger && <span className="muted">{it.charger.model}</span>
                )}
                {it.ean && <span className="muted mono">EAN {it.ean}</span>}
                {mode === "classer" && !it.ean && it.level !== "error" && (
                  <span className="scan-item-msg">Référence non lue : refaites une photo de l'étiquette complète</span>
                )}
                {it.message && <span className="scan-item-msg">{it.message}</span>}
              </div>
              <button className="scan-item-remove" onClick={() => removeItem(it.serial)} aria-label="Retirer">×</button>
            </li>
          ))}
        </ul>
      </div>

      {error && <p className="error">{error}</p>}
      <div className="scan-submit">
        <button className="btn-primary" disabled={saving || pending || valid.length === 0} onClick={submit}>
          {saving ? "Enregistrement…" : `Valider ${valid.length} borne(s)`}
        </button>
      </div>
    </div>
  );
}
