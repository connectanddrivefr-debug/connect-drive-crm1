import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Scanner, { beep } from "../components/Scanner";
import {
  SUPPLIERS,
  MODELS_BY_SUPPLIER,
  ALL_MODELS,
  STATUS_LABELS,
  techName,
  leadLabel,
  looksLikeProductCode,
} from "../lib/stock";

// Écran de scan (pensé pour le téléphone) — 3 modes:
// - reception: entrée au dépôt de toutes les bornes reçues (BL fournisseur)
// - dotation: remise de bornes à un technicien ("borne livrée à Kevin")
// - retour: le technicien rapporte des bornes au dépôt
const TITLES = {
  reception: "Nouvelle réception",
  dotation: "Remise à un technicien",
  retour: "Retour au dépôt",
};

// Vérifie l'état d'une borne scannée selon le mode, à partir de la réponse
// de /api/stock/lookup. Renvoie { level: ok|warn|error, message }.
function evaluate(mode, charger, technicianId) {
  if (mode === "reception") {
    if (charger) return { level: "error", message: `Déjà enregistrée (${STATUS_LABELS[charger.status]})` };
    return { level: "ok", message: "" };
  }
  if (!charger) return { level: "error", message: "Inconnue du stock — faire d'abord la réception" };
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

  async function handleScan(serial) {
    if (itemsRef.current.some((it) => it.serial === serial)) {
      beep(false);
      setFlash({ serial, level: "error", message: "Déjà scannée" });
      return;
    }
    const item = { serial, model: modelRef.current, level: "pending", message: "Vérification…" };
    setItems((prev) => [item, ...prev]);
    try {
      const { charger } = await api.lookupSerial(serial);
      const ev = evaluate(mode, charger, techRef.current);
      if (mode === "reception" && ev.level === "ok" && looksLikeProductCode(serial)) {
        ev.level = "warn";
        ev.message = "Ressemble au code-barres produit (EAN), pas au n° de série — vérifier";
      }
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

  const valid = items.filter((it) => it.level === "ok" || it.level === "warn");
  const errors = items.filter((it) => it.level === "error");
  const pending = items.some((it) => it.level === "pending");

  async function submit() {
    setError("");
    if (mode === "dotation" && !technicianId) return setError("Choisissez le technicien");
    if (mode === "reception" && valid.some((it) => !it.model)) return setError("Indiquez le modèle de chaque borne");
    setSaving(true);
    try {
      const serials = valid.map((it) => it.serial);
      if (mode === "reception") {
        const r = await api.createReception({
          supplier,
          blNumber,
          items: valid.map((it) => ({ serialNumber: it.serial, model: it.model })),
        });
        setDone({ count: r.count, text: `${r.count} borne(s) entrée(s) en stock${blNumber ? ` — BL ${blNumber}` : ""}` });
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
            <label className="scan-settings-full">
              Modèle des bornes scannées
              <input list="stock-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="ex. V2C Trydan" />
              <datalist id="stock-models">
                {ALL_MODELS.map((m) => <option key={m} value={m} />)}
              </datalist>
              <span className="muted">Changez-le en cours de route si le BL contient plusieurs modèles.</span>
            </label>
          </>
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
                {mode === "reception" ? (
                  <input
                    className="scan-item-model"
                    list="stock-models"
                    value={it.model}
                    onChange={(e) => setItemModel(it.serial, e.target.value)}
                  />
                ) : (
                  it.charger && <span className="muted">{it.charger.model}</span>
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
