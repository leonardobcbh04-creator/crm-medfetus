import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AdminPage } from "./pages/AdminPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExamSettingsPage } from "./pages/ExamSettingsPage";
import { GestationalBaseReviewPage } from "./pages/GestationalBaseReviewPage";
import { KanbanPage } from "./pages/KanbanPage";
import { LoginPage } from "./pages/LoginPage";
import { MessagesPage } from "./pages/MessagesPage";
import { PatientDetailPage } from "./pages/PatientDetailPage";
import { PatientFormPage } from "./pages/PatientFormPage";
import { PatientImportPage } from "./pages/PatientImportPage";
import { ReminderCenterPage } from "./pages/ReminderCenterPage";
import { ReportsPage } from "./pages/ReportsPage";
import { getStoredToken, getStoredUser } from "./services/auth";

function PrivateRoute({ children }: { children: JSX.Element }) {
  const token = getStoredToken();
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: JSX.Element }) {
  const user = getStoredUser();
  return user?.role === "admin" ? children : <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <AppShell />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/relatorios" element={<ReportsPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/revisao-base-gestacional" element={<GestationalBaseReviewPage />} />
        <Route path="/lembretes" element={<ReminderCenterPage />} />
        <Route path="/kanban" element={<KanbanPage />} />
        <Route path="/pacientes/novo" element={<PatientFormPage />} />
        <Route path="/pacientes/importar" element={<PatientImportPage />} />
        <Route path="/pacientes/:id" element={<PatientDetailPage />} />
        <Route path="/pacientes/:id/editar" element={<PatientFormPage />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminPage />
            </AdminRoute>
          }
        />
        <Route
          path="/exames"
          element={
            <AdminRoute>
              <ExamSettingsPage />
            </AdminRoute>
          }
        />
        <Route path="/mensagens" element={<MessagesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
