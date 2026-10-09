const jwt = require("jsonwebtoken");

// Auth JWT simple. Phase 1: un seul rôle utilisé (ADMIN) mais le middleware
// requireRole() est déjà prêt pour la Phase 2 (COMMERCIAL / TECHNICIEN).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé pour ce rôle" });
    }
    next();
  };
}

// Les comptes LOGISTIQUE (gestion du stock au dépôt) n'ont accès qu'à
// l'onglet Stock: on bloque toutes les autres routes métier (leads, devis,
// rappels, tableau de bord, utilisateurs) avant même le routeur concerné.
function denyLogistique(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(); // le routeur renverra 401 lui-même
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role === "LOGISTIQUE") {
      return res.status(403).json({ error: "Accès réservé à l'onglet Stock" });
    }
  } catch {
    /* token invalide: le routeur renverra 401 */
  }
  next();
}

module.exports = { requireAuth, requireRole, denyLogistique };
