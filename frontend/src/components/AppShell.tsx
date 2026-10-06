import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { clearToken, getStoredUser } from "../services/auth";
import { confirmDiscardChanges } from "../utils/formGuard";
import {
  AdminIcon,
  ContactsIcon,
  FlowIcon,
  PatientsIcon,
  VaccineIcon
} from "./NavIcons";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [remindersCount, setRemindersCount] = useState(0);
  const [vaccinesCount, setVaccinesCount] = useState(0);
  const storedUser = getStoredUser();
  const menuItems = [
    { to: "/clientes", label: "Pacientes", icon: PatientsIcon },
    { to: "/kanban", label: "Fluxo de atendimento", icon: FlowIcon },
    { to: "/contatos", label: "Central de contatos", badgeKey: "reminders", icon: ContactsIcon },
    { to: "/vacinas", label: "Vacinas", badgeKey: "vaccines", icon: VaccineIcon },
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

    async function loadVaccinesCount() {
      try {
        const data = await api.getVaccinesMenuCount();
        if (!cancelled) {
          setVaccinesCount(data.count);
        }
      } catch {
        if (!cancelled) {
          setVaccinesCount(0);
        }
      }
    }

    function loadCounts() {
      loadRemindersCount();
      loadVaccinesCount();
    }

    loadCounts();
    const intervalId = window.setInterval(loadCounts, 60000);
    window.addEventListener("vacinas:changed", loadVaccinesCount);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("vacinas:changed", loadVaccinesCount);
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
                {item.badgeKey === "vaccines" && vaccinesCount > 0 ? (
                  <span className="menu-badge" title="Gestantes (dTpa) e maes (vacinas do bebe) ainda nao contatadas">{vaccinesCount}</span>
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
