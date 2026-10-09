const BASE_URL = "/api";

function getToken() {
  return localStorage.getItem("cdcrm_token");
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem("cdcrm_user") || "null");
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || "Erreur inconnue");
    e.details = err; // ex. liste des numéros de série en erreur (stock)
    throw e;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),

  getLeads: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/leads${qs ? `?${qs}` : ""}`);
  },
  getLead: (id) => request(`/leads/${id}`),
  createLead: (data) => request("/leads", { method: "POST", body: data }),
  updateLead: (id, data) => request(`/leads/${id}`, { method: "PATCH", body: data }),
  deleteLead: (id) => request(`/leads/${id}`, { method: "DELETE" }),
  updateLeadStatus: (id, status) => request(`/leads/${id}/status`, { method: "PATCH", body: { status } }),
  addNote: (id, content) => request(`/leads/${id}/notes`, { method: "POST", body: { content } }),
  addCall: (id, summary) => request(`/leads/${id}/calls`, { method: "POST", body: { summary } }),

  // Liens de paiement Revolut (acompte / solde) — voir routes/leads.js.
  createDepositLink: (id, amount) => request(`/leads/${id}/payments/deposit`, { method: "POST", body: { amount } }),
  createBalanceLink: (id, amount) => request(`/leads/${id}/payments/balance`, { method: "POST", body: { amount } }),

  createQuote: (data) => request("/quotes", { method: "POST", body: data }),
  updateQuote: (id, data) => request(`/quotes/${id}`, { method: "PATCH", body: data }),

  getStats: () => request("/dashboard/stats"),

  getUsers: () => request("/users"),

  getReminders: () => request("/reminders"),

  // Gestion de stock des bornes (numéros de série) — voir routes/stock.js.
  getStockSummary: () => request("/stock/summary"),
  getChargers: (params = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
    const qs = new URLSearchParams(clean).toString();
    return request(`/stock/chargers${qs ? `?${qs}` : ""}`);
  },
  getCharger: (id) => request(`/stock/chargers/${id}`),
  updateCharger: (id, data) => request(`/stock/chargers/${id}`, { method: "PATCH", body: data }),
  installCharger: (id, data) => request(`/stock/chargers/${id}/install`, { method: "POST", body: data }),
  lookupSerial: (serial) => request(`/stock/lookup?serial=${encodeURIComponent(serial)}`),
  createReception: (data) => request("/stock/receptions", { method: "POST", body: data }),
  getReception: (id) => request(`/stock/receptions/${id}`),
  createDotation: (technicianId, serials) => request("/stock/dotations", { method: "POST", body: { technicianId, serials } }),
  returnToDepot: (serials) => request("/stock/returns", { method: "POST", body: { serials } }),
  getInstallTechnicians: () => request("/technicians"),
  getKraaftStatus: () => request("/stock/kraaft"),
  syncKraaft: () => request("/stock/kraaft/sync", { method: "POST" }),
  dismissKraaftScan: (id) => request(`/stock/kraaft/scans/${id}`, { method: "PATCH" }),
  searchStockClients: (q) => request(`/stock/clients?q=${encodeURIComponent(q)}`),
  createUser: (data) => request("/users", { method: "POST", body: data }),
  getTechnicians: () => request("/stock/technicians"),
  createTechnician: (data) => request("/stock/technicians", { method: "POST", body: data }),
  updateTechnician: (id, data) => request(`/stock/technicians/${id}`, { method: "PATCH", body: data }),

  // Leads simulateur avec numéro de téléphone non vérifié par SMS (Twilio),
  // suspicion de spam — voir GET /api/leads/unverified (admin uniquement).
  getUnverifiedLeads: () => request("/leads/unverified"),

  exportLeadsCsv: async () => {
    const token = getToken();
    const res = await fetch(`${BASE_URL}/leads/export/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Échec de l'export");
    return res.blob();
  },
};

export { getToken, getCurrentUser };
