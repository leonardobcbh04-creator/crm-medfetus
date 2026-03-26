import type {
  AdminPanelData,
  AppUser,
  ClinicPhysician,
  ClinicUnit,
  DashboardData,
  ExamConfig,
  ExamProtocolPreset,
  KanbanColumn,
  LoginResponse,
  MessagingItem,
  MessageRecord,
  Patient,
  PatientDetails,
  PatientFormCatalogs,
  ReportsData,
  ReminderCenterData
} from "../types";
import { getStoredUser } from "./auth";

const API_BASE_URL = "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const storedUser = getStoredUser();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(storedUser?.id ? { "x-user-id": String(storedUser.id) } : {}),
      ...(storedUser?.role ? { "x-user-role": String(storedUser.role) } : {}),
      ...(options?.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Erro na comunicacao com a API.");
  }

  return response.json() as Promise<T>;
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  getDashboard(params?: Record<string, string>) {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).filter(([, value]) => value != null && value !== "")
        ).toString()}`
      : "";
    return request<DashboardData>(`/dashboard${query}`);
  },
  getReports(params?: Record<string, string>) {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).filter(([, value]) => value != null && value !== "")
        ).toString()}`
      : "";
    return request<ReportsData>(`/reports${query}`);
  },
  getAdminPanel() {
    return request<AdminPanelData>("/admin");
  },
  getPatientFormCatalogs() {
    return request<PatientFormCatalogs>("/catalogs");
  },
  createAdminUser(payload: Record<string, unknown>) {
    return request<{ user: AppUser }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateAdminUser(id: number, payload: Record<string, unknown>) {
    return request<{ user: AppUser }>(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  deleteAdminUser(id: number) {
    return request<{ success: boolean }>(`/admin/users/${id}`, {
      method: "DELETE"
    });
  },
  createClinicUnit(payload: Record<string, unknown>) {
    return request<{ unit: ClinicUnit }>("/admin/units", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateClinicUnit(id: number, payload: Record<string, unknown>) {
    return request<{ unit: ClinicUnit }>(`/admin/units/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  deleteClinicUnit(id: number) {
    return request<{ success: boolean }>(`/admin/units/${id}`, {
      method: "DELETE"
    });
  },
  createPhysician(payload: Record<string, unknown>) {
    return request<{ physician: ClinicPhysician }>("/admin/physicians", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updatePhysician(id: number, payload: Record<string, unknown>) {
    return request<{ physician: ClinicPhysician }>(`/admin/physicians/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  deletePhysician(id: number) {
    return request<{ success: boolean }>(`/admin/physicians/${id}`, {
      method: "DELETE"
    });
  },
  updateAdminExamConfig(id: number, payload: Partial<ExamConfig>) {
    return request<{ examConfig: ExamConfig }>(`/admin/exams/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  updateMessageTemplate(id: number, payload: Record<string, unknown>) {
    return request<{ template: import("../types").MessageTemplate }>(`/admin/message-templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  getKanban() {
    return request<{ columns: KanbanColumn[] }>("/kanban");
  },
  createKanbanColumn(title: string) {
    return request<{ columns: KanbanColumn[] }>("/kanban/columns", {
      method: "POST",
      body: JSON.stringify({ title })
    });
  },
  updateKanbanColumn(id: string, title: string) {
    return request<{ columns: KanbanColumn[] }>(`/kanban/columns/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title })
    });
  },
  deleteKanbanColumn(id: string) {
    return request<{ columns: KanbanColumn[] }>(`/kanban/columns/${id}`, {
      method: "DELETE"
    });
  },
  moveKanbanPatient(patientId: number, stage: string) {
    return request<{ patient: PatientDetails }>("/kanban/move", {
      method: "PATCH",
      body: JSON.stringify({ patientId, stage })
    });
  },
  createPatient(payload: Record<string, unknown>) {
    return request<{ patient: PatientDetails }>("/patients", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  getPatients() {
    return request<{ patients: Patient[] }>("/patients");
  },
  updatePatient(id: number, payload: Record<string, unknown>) {
    return request<{ patient: PatientDetails }>(`/patients/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  getPatientDetails(id: number) {
    return request<PatientDetails>(`/patients/${id}`);
  },
  updatePatientExamStatus(
    patientId: number,
    examId: number,
    payload: {
      status: string;
      scheduledDate?: string | null;
      scheduledTime?: string | null;
      schedulingNotes?: string | null;
      completedDate?: string | null;
      actorUserId?: number | null;
    }
  ) {
    return request<{ patient: PatientDetails }>(`/patients/${patientId}/exams/${examId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  getExamConfigs() {
    return request<{ examConfigs: ExamConfig[]; presets: ExamProtocolPreset[] }>("/exam-configs");
  },
  updateExamConfig(id: number, payload: Partial<ExamConfig>) {
    return request<{ examConfig: ExamConfig }>(`/exam-configs/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  applyExamPreset(presetId: string) {
    return request<{ examConfigs: ExamConfig[]; preset: ExamProtocolPreset }>("/exam-configs/apply-preset", {
      method: "POST",
      body: JSON.stringify({ presetId })
    });
  },
  getMessagingItems() {
    return request<{ items: MessagingItem[] }>("/messages");
  },
  getReminders(params?: Record<string, string>) {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params).filter(([, value]) => value != null && value !== "")
        ).toString()}`
      : "";
    return request<ReminderCenterData>(`/reminders${query}`);
  },
  getRemindersCount() {
    return request<{ count: number }>("/reminders/count");
  },
  updateReminder(patientId: number, examPatientId: number, action: string) {
    return request<ReminderCenterData>(`/reminders/${patientId}/exams/${examPatientId}`, {
      method: "PATCH",
      body: JSON.stringify({ action })
    });
  },
  createMessage(payload: Record<string, unknown>) {
    return request<{ message: MessageRecord }>("/messages", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateMessage(id: number, payload: Record<string, unknown>) {
    return request<{ message: MessageRecord }>(`/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }
};
