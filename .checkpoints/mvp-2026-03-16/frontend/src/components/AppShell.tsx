import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { clearToken, getStoredUser } from "../services/auth";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [remindersCount, setRemindersCount] = useState(0);
  const storedUser = getStoredUser();
  const menuItems = [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/relatorios", label: "Relatorios" },
    { to: "/clientes", label: "Clientes" },
    { to: "/lembretes", label: "Central de lembretes", badgeKey: "reminders" },
    { to: "/kanban", label: "Pipeline" },
    { to: "/pacientes/novo", label: "Cadastrar paciente" },
    ...(storedUser?.role === "admin" ? [{ to: "/admin", label: "Area administrativa" }] : []),
    { to: "/mensagens", label: "Mensagens automaticas" }
  ];

  useEffect(() => {
    let cancelled = false;

    async function loadRemindersCount() {
      try {
        const data = await api.getRemindersCount();
        if (!cancelled) {
          setRemindersCount(data.count);
        }
      } catch {
        if (!cancelled) {
          setRemindersCount(0);
        }
      }
    }

    loadRemindersCount();
    const intervalId = window.setInterval(loadRemindersCount, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [location.pathname]);

  function handleLogout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="sidebar-kicker">Plataforma clinica</p>
          <h1>Medfetus</h1>
          <p className="sidebar-text">
            Organize pacientes, exames e alertas com uma base simples, limpa e pronta para crescer.
          </p>
        </div>

        <nav className="menu sidebar-nav">
          {menuItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? "menu-link active" : "menu-link")}
            >
              <span>{item.label}</span>
              {item.badgeKey === "reminders" && remindersCount > 0 ? (
                <span className="menu-badge">{remindersCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <strong>{storedUser?.name || "Usuario local"}</strong>
            <span>{storedUser?.role === "admin" ? "Administrador" : "Equipe da recepcao"}</span>
          </div>
          <button className="ghost-button" type="button" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="content-area">
        <Outlet />
      </main>
    </div>
  );
}
