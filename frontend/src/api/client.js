const BASE_URL = "/api";

function getToken() {
  return localStorage.getItem("cdcrm_token");
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
    throw new Error(err.error || "Erreur inconnue");
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
  updateLeadStatus: (id, status) => request(`/leads/${id}/status`, { method: "PATCH", body: { status } }),
  addNote: (id, content) => request(`/leads/${id}/notes`, { method: "POST", body: { content } }),
  addCall: (id, summary) => request(`/leads/${id}/calls`, { method: "POST", body: { summary } }),

  createQuote: (data) => request("/quotes", { method: "POST", body: data }),
  updateQuote: (id, data) => request(`/quotes/${id}`, { method: "PATCH", body: data }),

  getStats: () => request("/dashboard/stats"),
};

export { getToken };
