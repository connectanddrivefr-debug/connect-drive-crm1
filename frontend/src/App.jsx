import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { getToken, getCurrentUser } from "./api/client";

// Chaque page dans son propre chunk: évite de charger tout le CRM en un
// seul gros bundle JS au premier écran (temps de chargement initial réduit).
const LoginPage = lazy(() => import("./pages/LoginPage"));
const KanbanPage = lazy(() => import("./pages/KanbanPage"));
const ContactDetailPage = lazy(() => import("./pages/ContactDetailPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RemindersPage = lazy(() => import("./pages/RemindersPage"));
const StockPage = lazy(() => import("./pages/StockPage"));
const StockScanPage = lazy(() => import("./pages/StockScanPage"));

function PageFallback() {
  return <p className="muted">Chargement…</p>;
}

// Compte LOGISTIQUE (Fatima): uniquement l'onglet Stock.
// Onglet Stock: uniquement ADMIN (Julien) et LOGISTIQUE.
function RequireAuth({ children, stock = false }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  const role = getCurrentUser()?.role;
  if (stock && role !== "ADMIN" && role !== "LOGISTIQUE") return <Navigate to="/" replace />;
  if (!stock && role === "LOGISTIQUE") return <Navigate to="/stock" replace />;
  return children;
}

function Layout({ children }) {
  const navigate = useNavigate();
  const role = getCurrentUser()?.role;
  const logout = () => {
    localStorage.removeItem("cdcrm_token");
    localStorage.removeItem("cdcrm_user");
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to={role === "LOGISTIQUE" ? "/stock" : "/"} className="brand">
          <img src="/logo.png" alt="Connect & Drive" className="brand-logo" />
        </Link>
        <nav>
          {role !== "LOGISTIQUE" && <Link to="/">Pipeline</Link>}
          {role !== "LOGISTIQUE" && <Link to="/rappels">Rappels</Link>}
          {(role === "ADMIN" || role === "LOGISTIQUE") && <Link to="/stock">Stock</Link>}
          {role !== "LOGISTIQUE" && <Link to="/dashboard">Tableau de bord</Link>}
        </nav>
        {getToken() && (
          <button className="btn-ghost" onClick={logout}>
            Déconnexion
          </button>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Layout>
                <KanbanPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/leads/:id"
          element={
            <RequireAuth>
              <Layout>
                <ContactDetailPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/rappels"
          element={
            <RequireAuth>
              <Layout>
                <RemindersPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Layout>
                <DashboardPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/stock"
          element={
            <RequireAuth stock>
              <Layout>
                <StockPage />
              </Layout>
            </RequireAuth>
          }
        />
        {["reception", "dotation", "retour"].map((mode) => (
          <Route
            key={mode}
            path={`/stock/${mode}`}
            element={
              <RequireAuth stock>
                <Layout>
                  <StockScanPage key={mode} mode={mode} />
                </Layout>
              </RequireAuth>
            }
          />
        ))}
      </Routes>
    </Suspense>
  );
}
