import { Routes, Route, Navigate, Link, useNavigate } from "react-router-dom";
import { getToken } from "./api/client";
import LoginPage from "./pages/LoginPage";
import KanbanPage from "./pages/KanbanPage";
import ContactDetailPage from "./pages/ContactDetailPage";
import DashboardPage from "./pages/DashboardPage";

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
  );
}
