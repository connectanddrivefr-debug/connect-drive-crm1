import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import Scanner, { beep } from "../components/Scanner";
import { readCodes, splitCodes } from "../lib/labelScan";
import {
  SUPPLIERS,
  ALL_MODELS,
  STATUS_LABELS,
  techName,
  leadLabel,
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
  const [technicians, setTechnicians] = useState([]);
  const [technicianId, setTechnicianId] = useState("");
  const [items, setItems] = useState([]); // { serial, ean, model, level, message, charger }
  const [flash, setFlash] = useState(null); // dernier scan, affiché en grand
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const techRef = useRef(technicianId);
  techRef.current = technicianId;
  const [refs, setRefs] = useState([]);
  const refsRef = useRef([]);
  refsRef.current = refs;
  // Appariement S/N <-> code-barres produit quand ils ne sont pas lus sur la
  // même image (douchette, photo partielle): le code isolé attend son
  // partenaire quelques secondes, puis est oublié. Aucune référence n'est
  // jamais reportée d'un carton sur le suivant.
  const pendingEanRef = useRef(null); // { ean, at }
  const pendingSerialRef = useRef(null); // { serial, at }
  const PAIR_WINDOW_MS = 15000;
  const photoInputRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const usesRefs = mode === "reception" || mode === "classer";

  useEffect(() => {
    if (usesRefs) api.getRefs().then(setRefs).catch(() => {});
  }, [mode]);

  // Libellé d'une référence, depuis l'EAN (code-barres produit) ou le code
  // fabricant lu dans le QR code (ex. TRY32-1-SO-F).
  function refLabel(ean, code) {
    const list = refsRef.current;
    const known = (ean && list.find((r) => r.ean === ean)) || (code && list.find((r) => r.reference === code));
    return known ? known.label : (ean && EAN_MODELS[ean]) || "";
  }

  // Photo de l'étiquette: lit en une fois le S/N ET le code-barres produit.
  async function handleLabelPhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try {
      const codes = await readCodes(file);
      if (!codes.length) {
        beep(false);
        setFlash({ serial: "—", level: "error", message: "Aucun code lu : reprenez la photo de face, bien éclairée, étiquette entière." });
        return;
      }
      await handleCodes(codes);
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

  // Codes lus ensemble (une image caméra, une photo, ou un code tapé/douchette)
  async function handleCodes(rawCodes) {
    const { serials, eans, refCodes } = splitCodes(rawCodes);
    // Un code-barres mal lu donne un EAN inexistant: on préfère un EAN connu.
    const ean = eans.find((e) => refLabel(e)) || eans[0] || null;
    const code = refCodes[0] || null;
    const now = Date.now();

    if (!serials.length) {
      if (!ean) return;
      if (!usesRefs) {
        setFlash({
          serial: ean,
          level: "warn",
          message: "Code-barres produit (référence) : scannez le QR code ou le code-barres « S/N ».",
        });
        return;
      }
      const p = pendingSerialRef.current;
      if (p && now - p.at < PAIR_WINDOW_MS && itemsRef.current.some((it) => it.serial === p.serial && !it.ean)) {
        pendingSerialRef.current = null;
        setItemEan(p.serial, ean);
        return;
      }
      pendingEanRef.current = { ean, at: now };
      const label = refLabel(ean);
      beep(true);
      setFlash({ serial: ean, level: label ? "ok" : "warn", message: `${label || "Référence inconnue"} — scannez maintenant le S/N de ce carton.` });
      return;
    }

    let pairEan = usesRefs ? ean : null;
    if (usesRefs && !pairEan) {
      const p = pendingEanRef.current;
      if (p && now - p.at < PAIR_WINDOW_MS) pairEan = p.ean;
    }
    pendingEanRef.current = null;
    for (const sn of serials) await addSerial(sn, pairEan, code);
  }

  function setItemEan(serial, ean) {
    const item = itemsRef.current.find((it) => it.serial === serial);
    const label = refLabel(ean, item && item.reference);
    setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, ean, model: label || it.model } : it)));
    beep(true);
    setFlash({
      serial,
      level: label ? "ok" : "warn",
      message: label ? `Référence : ${label}` : `Référence inconnue (EAN ${ean}) : indiquez son nom dans la liste.`,
    });
  }

  async function addSerial(serial, ean, code = null) {
    const existing = itemsRef.current.find((it) => it.serial === serial);
    if (existing) {
      // Même carton revu par la caméra: on complète sa référence si besoin
      if (usesRefs && code && !existing.reference) {
        setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, reference: code, model: it.model || refLabel(it.ean, code) } : it)));
      }
      if (usesRefs && ean && !existing.ean) setItemEan(serial, ean);
      return;
    }
    if (!usesRefs) code = null;
    const label = refLabel(ean, code);
    const item = { serial, ean, reference: code, model: label, level: "pending", message: "Vérification…" };
    setItems((prev) => [item, ...prev]);
    itemsRef.current = [item, ...itemsRef.current];
    pendingSerialRef.current = usesRefs && !ean && !label ? { serial, at: Date.now() } : null;
    try {
      const { charger } = await api.lookupSerial(serial);
      const ev = evaluate(mode, charger, techRef.current);
      beep(ev.level !== "error");
      let msg = ev.message;
      if (usesRefs && ev.level !== "error") {
        msg = label
          ? `Référence : ${label}`
          : ean || code
          ? `Référence inconnue (${[code, ean].filter(Boolean).join(" · ")}) : indiquez son nom dans la liste`
          : "Référence non lue : passez le code-barres du milieu";
      }
      setFlash({ serial, level: ev.level === "ok" && usesRefs && !label ? "warn" : ev.level, message: msg });
      setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, ...ev, charger } : it)));
    } catch (e) {
      beep(false);
      setItems((prev) => prev.map((it) => (it.serial === serial ? { ...it, level: "error", message: e.message } : it)));
    }
  }

  function removeItem(serial) {
    setItems((prev) => prev.filter((it) => it.serial !== serial));
  }

  // Choix (ou nom tapé) de la référence d'une borne. Un libellé du catalogue
  // fixe aussi son EAN; un nom tapé pour un EAN inconnu s'applique à toutes
  // les bornes de cet EAN.
  function setItemModel(serial, m) {
    const ref = refs.find((r) => r.label === m);
    const target = items.find((it) => it.serial === serial);
    const unknownEan = target && target.ean && !refLabel(target.ean) ? target.ean : null;
    setItems((prev) =>
      prev.map((it) => {
        if (it.serial === serial) return { ...it, model: m, ean: ref && ref.ean ? ref.ean : it.ean };
        if (!ref && unknownEan && it.ean === unknownEan) return { ...it, model: m };
        return it;
      })
    );
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
          items: valid.map((it) => ({ serialNumber: it.serial, model: it.model, ean: it.ean, reference: it.reference })),
        });
        setDone({ count: r.count, text: `${r.count} borne(s) entrée(s) en stock${blNumber ? ` — BL ${blNumber}` : ""}` });
      } else if (mode === "classer") {
        const withRef = valid.filter((it) => it.ean || it.reference);
        if (!withRef.length) {
          setSaving(false);
          return setError("Aucune référence lue : photographiez l'étiquette complète (S/N + code-barres produit)");
        }
        const r = await api.assignRefs(withRef.map((it) => ({ serialNumber: it.serial, ean: it.ean, reference: it.reference, label: it.model })));
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
              <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
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
          <p className="muted scan-settings-full">
            <strong>📸 Photographiez ou filmez l'étiquette entière</strong> : le numéro de série (QR code) et la référence
            (code-barres du milieu) sont lus ensemble et la borne est classée automatiquement. À la douchette : bipez les
            deux codes de chaque carton.
          </p>
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

      <Scanner onCodes={handleCodes} disabled={saving || (mode === "dotation" && !technicianId)} />

      {flash && (
        <div className={`scan-flash scan-${flash.level}`}>
          <span className="scan-flash-serial">{flash.serial}</span>
          {flash.message && <span>{flash.message}</span>}
        </div>
      )}

      <datalist id="stock-models">
        {[...new Set([...refs.map((r) => r.label), ...ALL_MODELS])].map((m) => <option key={m} value={m} />)}
      </datalist>

      <div className="card scan-list">
        <div className="scan-list-header">
          <strong>{valid.length} borne(s) prête(s)</strong>
          {errors.length > 0 && <span className="scan-count-error">{errors.length} en erreur</span>}
        </div>
        {usesRefs && valid.length > 0 && (
          <ul className="scan-ref-summary">
            {Object.entries(
              valid.reduce((acc, it) => {
                const k = it.model || "⚠ Référence manquante";
                acc[k] = (acc[k] || 0) + 1;
                return acc;
              }, {})
            )
              .sort((x, y) => y[1] - x[1])
              .map(([label, n]) => (
                <li key={label}>
                  <strong>{n}</strong> × {label}
                </li>
              ))}
          </ul>
        )}
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
                    placeholder="Choisir la référence"
                    value={it.model}
                    onChange={(e) => setItemModel(it.serial, e.target.value)}
                  />
                ) : (
                  it.charger && <span className="muted">{it.charger.model}</span>
                )}
                {(it.reference || it.ean) && (
                  <span className="muted mono">{[it.reference, it.ean && `EAN ${it.ean}`].filter(Boolean).join(" · ")}</span>
                )}
                {usesRefs && !it.model && it.level !== "error" && it.level !== "pending" && (
                  <span className="scan-item-msg">Référence non lue : passez le code-barres du milieu ou choisissez-la</span>
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
