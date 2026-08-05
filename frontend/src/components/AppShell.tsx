import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { clearToken, getStoredUser } from "../services/auth";
import { confirmDiscardChanges } from "../utils/formGuard";
import {
  AdminIcon,
  ContactsIcon,
  DashboardIcon,
  FlowIcon,
  PatientAddIcon,
  PatientsIcon,
  ReportsIcon,
  ReviewIcon
} from "./NavIcons";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [remindersCount, setRemindersCount] = useState(0);
  const storedUser = getStoredUser();
  const menuItems = [
    { to: "/dashboard", label: "Dashboard", icon: DashboardIcon },
    { to: "/pacientes/novo", label: "Cadastrar paciente", icon: PatientAddIcon },
    { to: "/clientes", label: "Pacientes", icon: PatientsIcon },
    { to: "/kanban", label: "Fluxo de atendimento", icon: FlowIcon },
    { to: "/contatos", label: "Central de contatos", badgeKey: "reminders", icon: ContactsIcon },
    { to: "/revisao-base-gestacional", label: "Revisao da base gestacional", icon: ReviewIcon },
    { to: "/relatorios", label: "Relatorios", icon: ReportsIcon },
    ...(storedUser?.role === "admin" ? [{ to: "/admin", label: "Administracao", icon: AdminIcon }] : [])
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
    if (!confirmDiscardChanges()) {
      return;
    }
    clearToken();
    navigate("/login");
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <p className="sidebar-kicker">Plataforma clinica</p>
          <img src="/medfetus-logo.png" alt="Medfetus" className="sidebar-logo" />
          <p className="sidebar-text">
            Organize pacientes, exames e alertas com uma base simples, limpa e pronta para crescer.
          </p>
        </div>

        <nav className="menu sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? "menu-link active" : "menu-link")}
                onClick={(event) => {
                  if (!confirmDiscardChanges()) {
                    event.preventDefault();
                  }
                }}
              >
                <span className="menu-link-content">
                  <Icon className="menu-link-icon" />
                  <span>{item.label}</span>
                </span>
                {item.badgeKey === "reminders" && remindersCount > 0 ? (
                  <span className="menu-badge">{remindersCount}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <strong>{storedUser?.name || "Usuario local"}</strong>
            <span>
              {storedUser?.role === "admin"
                ? "Administrador"
                : storedUser?.role === "atendimento"
                  ? "Equipe de atendimento"
                  : "Equipe da recepcao"}
            </span>
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
