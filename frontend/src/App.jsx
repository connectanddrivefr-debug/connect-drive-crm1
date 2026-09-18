import { Suspense, lazy } from "react";
import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { getToken } from "./api/client";

// Chaque page dans son propre chunk: évite de charger tout le CRM en un
// seul gros bundle JS au premier écran (temps de chargement initial réduit).
const LoginPage = lazy(() => import("./pages/LoginPage"));
const KanbanPage = lazy(() => import("./pages/KanbanPage"));
const ContactDetailPage = lazy(() => import("./pages/ContactDetailPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RemindersPage = lazy(() => import("./pages/RemindersPage"));

function PageFallback() {
  return <p className="muted">Chargement…</p>;
}

function RequireAuth({ children }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

function Layout({ children }) {
  const navigate = useNavigate();
  const logout = () => {
    localStorage.removeItem("cdcrm_token");
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/logo.png" alt="Connect & Drive" className="brand-logo" />
        </Link>
        <nav>
          <Link to="/">Pipeline</Link>
          <Link to="/rappels">Rappels</Link>
          <Link to="/dashboard">Tableau de bord</Link>
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
      </Routes>
    </Suspense>
  );
}
