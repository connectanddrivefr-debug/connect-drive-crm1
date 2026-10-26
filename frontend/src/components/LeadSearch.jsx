import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

const STATUS_LABELS = {
  NOUVEAU: "Nouveau",
  CONTACTE: "Contacté",
  DEVIS_ENVOYE: "Devis envoyé",
  EN_ATTENTE: "En attente",
  SIGNE: "Signé",
  PERDU: "Perdu",
};

// Barre de recherche globale (en haut de toutes les pages): quand un client
// appelle, on tape son numéro (n'importe quel format: 06 58…, +33 6 58…,
// 0658…) ou son nom / email, et on ouvre directement sa fiche.
// Voir GET /api/leads/search côté backend.
export default function LeadSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const reqId = useRef(0);

  // Recherche avec un léger délai pour ne pas appeler l'API à chaque touche.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(() => {
      api
        .searchLeads(term)
        .then((data) => {
          if (id !== reqId.current) return; // réponse périmée
          setResults(data);
          setActive(0);
        })
        .catch(() => id === reqId.current && setResults([]))
        .finally(() => id === reqId.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Fermer la liste en cliquant ailleurs.
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Raccourci "/" pour placer le curseur dans la recherche.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function openLead(lead) {
    setOpen(false);
    setQ("");
    setResults([]);
    inputRef.current?.blur();
    navigate(`/leads/${lead.id}`);
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      openLead(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showList = open && q.trim().length >= 2;

  return (
    <div className="lead-search" ref={boxRef}>
      <span className="lead-search-icon" aria-hidden="true">⌕</span>
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        placeholder="Rechercher un client (tél., nom, email)…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Rechercher un lead"
      />
      {showList && (
        <div className="lead-search-results" role="listbox">
          {loading && results.length === 0 && <div className="lead-search-empty">Recherche…</div>}
          {!loading && results.length === 0 && (
            <div className="lead-search-empty">Aucun lead trouvé pour « {q.trim()} »</div>
          )}
          {results.map((l, i) => {
            const name = `${l.firstName || ""} ${l.lastName || ""}`.trim() || l.email;
            return (
              <button
                type="button"
                key={l.id}
                role="option"
                aria-selected={i === active}
                className={`lead-search-item ${i === active ? "active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => openLead(l)}
              >
                <div className="lead-search-line">
                  <span className="lead-search-name">{name}</span>
                  <span className={`lead-search-status status-${l.status.toLowerCase()}`}>
                    {STATUS_LABELS[l.status] || l.status}
                  </span>
                </div>
                <div className="lead-search-meta">
                  {[l.phone, l.company, l.city || l.postalCode, l.assignedTo && `Suivi : ${l.assignedTo.firstName}`]
                    .filter(Boolean)
                    .join(" · ")}
                  {l.source === "SIMULATEUR" && !l.phoneVerified && " · numéro non vérifié"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
