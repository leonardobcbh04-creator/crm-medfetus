import { FormEvent, useEffect, useState } from "react";
import { api } from "../services/api";
import type {
  AdminPanelData,
  AppUser,
  ClinicPhysician,
  ClinicUnit,
  ExamConfig,
  ExamInferenceRule,
  MessageTemplate,
  OperationalTestResult,
  PatientCleanupResult,
  ShospCacheClearResult,
  ShospConnectionTestResult,
  ShospExamMapping,
  ShospIntegrationStatus,
  ShospSyncResult
} from "../types";

type AdminTab = "usuarios" | "cadastros" | "exames" | "auditoria" | "integracoes";
type IntegrationSubTab = "visao" | "mapeamentos";
type PatientCleanupPreset = "today" | "last_7_days" | "last_30_days" | "all" | "custom";
const SHOSP_PRODUCT_VISIBLE = false;

const EMPTY_ADMIN_PANEL: AdminPanelData = {
  users: [],
  units: [],
  physicians: [],
  examConfigs: [],
  examInferenceRules: [],
  messageTemplates: [],
  messageDeliveryLogs: [],
  recentAuditLogs: [],
  messagingConfig: {
    provider: "manual_stub",
    channel: "whatsapp",
    externalApiBaseUrl: "",
    externalApiToken: "",
    externalPhoneNumberId: "",
    templatesEnabled: true,
    dryRun: true,
    isExternalProviderConfigured: false
  }
};

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="form-section-header">
      <p className="muted-label">{eyebrow}</p>
      <h3>{title}</h3>
      <p className="field-hint">{description}</p>
    </div>
  );
}

function QuickActionCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = "default",
  statusLabel
}: {
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  tone?: "default" | "patients" | "agenda" | "complete";
  statusLabel?: string;
}) {
  return (
    <article className={`admin-quick-card admin-quick-card-${tone}`}>
      <div className="admin-quick-card-head">
        <div className={`admin-quick-icon admin-quick-icon-${tone}`} aria-hidden="true">{icon}</div>
        {statusLabel ? <span className={`admin-quick-status admin-quick-status-${tone}`}>{statusLabel}</span> : null}
      </div>
      <strong>{title}</strong>
      <p>{description}</p>
      <button type="button" className="secondary-button" onClick={onAction}>
        {actionLabel}
      </button>
    </article>
  );
}

function formatDateTimeLabel(value?: string | null) {
  if (!value) {
    return "Sem registro";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(parsed);
}

function formatDurationLabel(durationMs?: number | null) {
  if (durationMs == null || !Number.isFinite(durationMs)) {
    return "Sem medicao";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
}

function getIntegrationSeverity(status?: string | null, message?: string | null) {
  const normalizedStatus = String(status || "").toLowerCase();
  const normalizedMessage = String(message || "").toLowerCase();

  if (
    normalizedStatus === "error" ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("500") ||
    normalizedMessage.includes("503") ||
    normalizedMessage.includes("falha")
  ) {
    return {
      tone: "critical",
      label: "Critico"
    };
  }

  if (
    normalizedStatus === "partial" ||
    normalizedMessage.includes("pendente") ||
    normalizedMessage.includes("incompleta") ||
    normalizedMessage.includes("nao mapeado") ||
    normalizedMessage.includes("skipped")
  ) {
    return {
      tone: "warning",
      label: "Atencao"
    };
  }

  return {
    tone: "normal",
    label: "Informativo"
  };
}

function getFeedbackTone(message: string) {
  const normalized = String(message || "").toLowerCase();
  if (
    normalized.includes("nao foi") ||
    normalized.includes("erro") ||
    normalized.includes("incompleta") ||
    normalized.includes("nao respondeu") ||
    normalized.includes("alerta")
  ) {
    return "error";
  }
  return "success";
}

export function AdminPage() {
  const [adminData, setAdminData] = useState<AdminPanelData | null>(null);
  const [shospStatus, setShospStatus] = useState<ShospIntegrationStatus | null>(null);
  const [shospMappings, setShospMappings] = useState<ShospExamMapping[]>([]);
  const [shospConnectionTest, setShospConnectionTest] = useState<ShospConnectionTestResult | null>(null);
  const [latestShospSyncResult, setLatestShospSyncResult] = useState<ShospSyncResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<AdminTab>("usuarios");
  const [activeIntegrationTab, setActiveIntegrationTab] = useState<IntegrationSubTab>("visao");
  const [savingKey, setSavingKey] = useState("");
  const [syncingScope, setSyncingScope] = useState("");
  const [operationalTestResult, setOperationalTestResult] = useState<OperationalTestResult | null>(null);
  const [showAllRecentActivity, setShowAllRecentActivity] = useState(false);
  const [searchUsers, setSearchUsers] = useState("");
  const [searchUnits, setSearchUnits] = useState("");
  const [searchPhysicians, setSearchPhysicians] = useState("");
  const [searchExams, setSearchExams] = useState("");
  const [searchShospMappings, setSearchShospMappings] = useState("");
  const [showCreateExamForm, setShowCreateExamForm] = useState(false);
  const [patientCleanupPreset, setPatientCleanupPreset] = useState<PatientCleanupPreset>("today");
  const [patientCleanupDateFrom, setPatientCleanupDateFrom] = useState("");
  const [patientCleanupDateTo, setPatientCleanupDateTo] = useState("");
  const [lastPatientCleanupResult, setLastPatientCleanupResult] = useState<PatientCleanupResult | null>(null);
  const [shospSettingsForm, setShospSettingsForm] = useState({
    useMock: true,
    apiBaseUrl: "",
    apiToken: "",
    apiKey: "",
    username: "",
    password: "",
    companyId: "",
    patientsPath: "/patients",
    attendancesPath: "/attendances",
    examsPath: "/exams",
    timeoutMs: "15000"
  });

  useEffect(() => {
    loadAdminData();
  }, []);

  async function refreshShospIntegrationData() {
    if (!SHOSP_PRODUCT_VISIBLE) {
      setShospStatus(null);
      setShospMappings([]);
      return { statusResponse: null, mappingsResponse: { mappings: [] } };
    }

    const [statusResult, mappingsResult] = await Promise.allSettled([
      api.getShospIntegrationStatus(),
      api.getShospExamMappings()
    ]);

    const statusResponse = statusResult.status === "fulfilled" ? statusResult.value : null;
    const mappingsResponse = mappingsResult.status === "fulfilled" ? mappingsResult.value : { mappings: [] };

    setShospStatus(statusResponse);
    setShospMappings(mappingsResponse.mappings);
    setShospSettingsForm((current) => ({
      ...current,
      useMock: statusResponse?.persistedConfig?.useMock ?? current.useMock,
      apiBaseUrl: statusResponse?.persistedConfig?.apiBaseUrl || current.apiBaseUrl,
      username: statusResponse?.persistedConfig?.username || current.username,
      companyId: statusResponse?.persistedConfig?.companyId || current.companyId,
      patientsPath: String(statusResponse?.persistedConfig?.settings?.patientsPath || statusResponse?.settings.patientsPath || current.patientsPath),
      attendancesPath: String(statusResponse?.persistedConfig?.settings?.attendancesPath || statusResponse?.settings.attendancesPath || current.attendancesPath),
      examsPath: String(statusResponse?.persistedConfig?.settings?.examsPath || statusResponse?.settings.examsPath || current.examsPath),
      timeoutMs: String(statusResponse?.persistedConfig?.settings?.timeoutMs || statusResponse?.settings.timeoutMs || current.timeoutMs)
    }));

    if (statusResult.status !== "fulfilled" || mappingsResult.status !== "fulfilled") {
      setFeedback("A integracao com o Shosp nao respondeu neste ambiente. A area administrativa segue disponivel em modo reduzido.");
    }

    return { statusResponse, mappingsResponse };
  }

  async function loadAdminData() {
    setLoading(true);
    try {
      const adminResult = await api.getAdminPanel();
      let shospStatusResult: PromiseSettledResult<ShospIntegrationStatus> = { status: "rejected", reason: new Error("hidden") };
      let shospMappingsResult: PromiseSettledResult<{ mappings: ShospExamMapping[] }> = { status: "rejected", reason: new Error("hidden") };

      if (SHOSP_PRODUCT_VISIBLE) {
        [shospStatusResult, shospMappingsResult] = await Promise.allSettled([
          api.getShospIntegrationStatus(),
          api.getShospExamMappings()
        ]);
      }

      setAdminData(adminResult);

      if (SHOSP_PRODUCT_VISIBLE && shospStatusResult.status === "fulfilled") {
        const shospResponse = shospStatusResult.value;
        setShospStatus(shospResponse);
        setShospSettingsForm({
          useMock: shospResponse.persistedConfig?.useMock ?? true,
          apiBaseUrl: shospResponse.persistedConfig?.apiBaseUrl || "",
          apiToken: "",
          apiKey: "",
          username: shospResponse.persistedConfig?.username || "",
          password: "",
          companyId: shospResponse.persistedConfig?.companyId || "",
          patientsPath: String(shospResponse.persistedConfig?.settings?.patientsPath || shospResponse.settings.patientsPath || "/patients"),
          attendancesPath: String(shospResponse.persistedConfig?.settings?.attendancesPath || shospResponse.settings.attendancesPath || "/attendances"),
          examsPath: String(shospResponse.persistedConfig?.settings?.examsPath || shospResponse.settings.examsPath || "/exams"),
          timeoutMs: String(shospResponse.persistedConfig?.settings?.timeoutMs || shospResponse.settings.timeoutMs || 15000)
        });
      } else {
        setShospStatus(null);
      }

      if (SHOSP_PRODUCT_VISIBLE && shospMappingsResult.status === "fulfilled") {
        setShospMappings(shospMappingsResult.value.mappings);
      } else {
        setShospMappings([]);
      }
    } catch (error) {
      setAdminData(EMPTY_ADMIN_PANEL);
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a area administrativa.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunShospSync(scope: "patients" | "attendances" | "full") {
    setSyncingScope(scope);
    setFeedback("");

    try {
      let result: ShospSyncResult;
      if (scope === "patients") {
        result = await api.syncShospPatients({ incremental: true });
      } else if (scope === "attendances") {
        result = await api.syncShospAttendances({ incremental: true });
      } else {
        result = await api.syncShospFull({ incremental: true });
      }

      const successMessage =
        scope === "full"
          ? "Sincronizacao completa executada."
          : scope === "patients"
            ? "Sincronizacao de pacientes executada."
            : "Sincronizacao de atendimentos e exames executada.";

      setFeedback(result.ok ? successMessage : result.errorMessage || "A sincronizacao terminou com alerta.");
      setLatestShospSyncResult(result);
      await refreshShospIntegrationData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel executar a sincronizacao com o Shosp.");
    } finally {
      setSyncingScope("");
    }
  }

  async function handleUpdateShospMapping(event: FormEvent<HTMLFormElement>, mapping: ShospExamMapping) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`shosp-mapping-${mapping.id}`);
    setFeedback("");

    try {
      const response = await api.updateShospExamMapping(mapping.id, {
        examModelId: Number(formData.get("examModelId") || mapping.examModelId),
        active: formData.get("active") === "on",
        notes: String(formData.get("notes") || "")
      });

      setShospMappings((current) =>
        current.map((item) => (item.id === mapping.id ? response.mapping : item))
      );
      setFeedback("Mapeamento do Shosp atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o mapeamento do Shosp.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateShospSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingKey("shosp-settings");
    setFeedback("");

    try {
      const response = await api.updateShospIntegrationSettings({
        useMock: shospSettingsForm.useMock,
        apiBaseUrl: shospSettingsForm.apiBaseUrl,
        patientsPath: shospSettingsForm.patientsPath,
        attendancesPath: shospSettingsForm.attendancesPath,
        examsPath: shospSettingsForm.examsPath,
        timeoutMs: Number(shospSettingsForm.timeoutMs || 15000)
      });

      setShospStatus(response);
      setShospSettingsForm((current) => ({
        ...current,
        useMock: response.persistedConfig?.useMock ?? current.useMock,
        apiBaseUrl: response.persistedConfig?.apiBaseUrl || current.apiBaseUrl,
        apiToken: "",
        apiKey: "",
        username: response.persistedConfig?.username || current.username,
        password: "",
        companyId: response.persistedConfig?.companyId || current.companyId,
        patientsPath: String(response.persistedConfig?.settings?.patientsPath || current.patientsPath),
        attendancesPath: String(response.persistedConfig?.settings?.attendancesPath || current.attendancesPath),
        examsPath: String(response.persistedConfig?.settings?.examsPath || current.examsPath),
        timeoutMs: String(response.persistedConfig?.settings?.timeoutMs || current.timeoutMs)
      }));
      setFeedback("Configuracoes do Shosp atualizadas com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar as configuracoes do Shosp.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleTestShospConnection() {
    setSavingKey("shosp-test-connection");
    setFeedback("");

    try {
      const result = await api.testShospConnection();
      setShospConnectionTest(result);
      setFeedback(result.ok ? "Teste de conexao executado com sucesso." : result.message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel testar a conexao com o Shosp.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleTestShospLiveConnection() {
    setSavingKey("shosp-test-live-connection");
    setFeedback("");

    try {
      const result = await api.testShospLiveConnection();
      setShospConnectionTest(result);
      setFeedback(result.ok ? "Teste live executado com sucesso." : result.message);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel testar a conexao live com o Shosp.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleRunOperationalTest() {
    setSavingKey("operational-test");
    setFeedback("");

    try {
      const response = await api.runMariaGertrudesOperationalTest();
      setOperationalTestResult(response.result);
      setFeedback(response.result.ok ? "Teste operacional executado com sucesso." : response.result.message || "O teste operacional nao pode ser executado neste ambiente.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel executar o teste operacional.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleSyncNow() {
    setSavingKey("shosp-sync-now");
    setFeedback("");

    try {
      const result = await api.syncShospFull({ incremental: true });
      setLatestShospSyncResult(result);
      await refreshShospIntegrationData();
      setFeedback(result.ok ? "Sincronizacao executada agora com sucesso." : result.errorMessage || "A sincronizacao terminou com alerta.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel executar a sincronizacao agora.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleReprocessShospData() {
    setSavingKey("shosp-reprocess");
    setFeedback("");

    try {
      const result = await api.reprocessShospData();
      setLatestShospSyncResult(result);
      await refreshShospIntegrationData();
      setFeedback(result.ok ? "Reprocessamento concluido com sucesso." : result.errorMessage || "O reprocessamento terminou com alerta.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel reprocessar os dados do Shosp.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleClearShospSyncCache() {
    setSavingKey("shosp-clear-cache");
    setFeedback("");

    try {
      const result: ShospCacheClearResult = await api.clearShospSyncCache();
      await refreshShospIntegrationData();
      setFeedback(`Cache de sincronizacao limpo com sucesso. Entradas removidas: ${result.clearedReminderEntries}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel limpar o cache de sincronizacao.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-user");
    setFeedback("");

    try {
      const response = await api.createAdminUser({
        name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || "recepcao"),
        active: formData.get("active") === "on"
      });
      setAdminData((current) => current ? { ...current, users: [...current.users, response.user] } : current);
      form.reset();
      setFeedback("Usuario criado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>, user: AppUser) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`user-${user.id}`);
    setFeedback("");

    try {
      const response = await api.updateAdminUser(user.id, {
        name: String(formData.get("name") || user.name),
        email: String(formData.get("email") || user.email),
        password: String(formData.get("password") || ""),
        role: String(formData.get("role") || user.role),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, users: current.users.map((item) => (item.id === user.id ? response.user : item)) }
          : current
      );
      setFeedback("Usuario atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeleteUser(user: AppUser) {
    const confirmed = window.confirm(`Deseja excluir o usuario ${user.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-user-${user.id}`);
    setFeedback("");
    try {
      await api.deleteAdminUser(user.id);
      setAdminData((current) =>
        current ? { ...current, users: current.users.filter((item) => item.id !== user.id) } : current
      );
      setFeedback("Usuario excluido da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir o usuario.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreateUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-unit");
    setFeedback("");

    try {
      const response = await api.createClinicUnit({
        name: String(formData.get("name") || ""),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current ? { ...current, units: [...current.units, response.unit].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) } : current
      );
      form.reset();
      setFeedback("Unidade criada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateUnit(event: FormEvent<HTMLFormElement>, unit: ClinicUnit) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`unit-${unit.id}`);
    setFeedback("");

    try {
      const response = await api.updateClinicUnit(unit.id, {
        name: String(formData.get("name") || unit.name),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? {
              ...current,
              units: current.units.map((item) => (item.id === unit.id ? response.unit : item)),
              physicians: current.physicians.map((item) =>
                item.clinicUnitId === unit.id ? { ...item, clinicUnitName: response.unit.name } : item
              )
            }
          : current
      );
      setFeedback("Unidade atualizada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeleteUnit(unit: ClinicUnit) {
    const confirmed = window.confirm(
      `Deseja excluir a unidade ${unit.name}?\n\nOs medicos vinculados a ela serao apenas desvinculados da unidade. Nenhum medico sera apagado.`
    );
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-unit-${unit.id}`);
    setFeedback("");
    try {
      await api.deleteClinicUnit(unit.id);
      setAdminData((current) =>
        current
          ? {
              ...current,
              units: current.units.filter((item) => item.id !== unit.id),
              physicians: current.physicians.map((item) =>
                item.clinicUnitId === unit.id ? { ...item, clinicUnitId: null, clinicUnitName: null } : item
              )
            }
          : current
      );
      setFeedback("Unidade excluida da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir a unidade.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreatePhysician(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-physician");
    setFeedback("");

    try {
      const response = await api.createPhysician({
        name: String(formData.get("name") || ""),
        clinicUnitId: Number(formData.get("clinicUnitId") || 0) || null,
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, physicians: [...current.physicians, response.physician].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }
          : current
      );
      form.reset();
      setFeedback("Medico criado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdatePhysician(event: FormEvent<HTMLFormElement>, physician: ClinicPhysician) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`physician-${physician.id}`);
    setFeedback("");

    try {
      const response = await api.updatePhysician(physician.id, {
        name: String(formData.get("name") || physician.name),
        clinicUnitId: Number(formData.get("clinicUnitId") || 0) || null,
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, physicians: current.physicians.map((item) => (item.id === physician.id ? response.physician : item)) }
          : current
      );
      setFeedback("Medico atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeletePhysician(physician: ClinicPhysician) {
    const confirmed = window.confirm(`Deseja excluir o medico ${physician.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-physician-${physician.id}`);
    setFeedback("");
    try {
      await api.deletePhysician(physician.id);
      setAdminData((current) =>
        current ? { ...current, physicians: current.physicians.filter((item) => item.id !== physician.id) } : current
      );
      setFeedback("Medico excluido da lista.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir o medico.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCleanupPatients() {
    const presetLabels: Record<PatientCleanupPreset, string> = {
      today: "todos os pacientes criados hoje",
      last_7_days: "todos os pacientes criados nos ultimos 7 dias",
      last_30_days: "todos os pacientes criados nos ultimos 30 dias",
      all: "todos os pacientes cadastrados no sistema",
      custom: `todos os pacientes criados entre ${patientCleanupDateFrom || "a data inicial"} e ${patientCleanupDateTo || "a data final"}`
    };

    const confirmed = window.confirm(
      `Deseja excluir ${presetLabels[patientCleanupPreset]}?\n\nEssa acao apaga pacientes e seus exames, mensagens e movimentacoes relacionadas.`
    );
    if (!confirmed) {
      return;
    }

    setSavingKey("cleanup-patients");
    setFeedback("");

    try {
      const result = await api.cleanupPatientsByRange({
        preset: patientCleanupPreset,
        dateFrom: patientCleanupPreset === "custom" ? patientCleanupDateFrom : undefined,
        dateTo: patientCleanupPreset === "custom" ? patientCleanupDateTo : undefined
      });

      setLastPatientCleanupResult(result);
      setFeedback(
        result.deleted.patients
          ? `${result.deleted.patients} paciente(s) excluida(s) com sucesso.`
          : "Nenhuma paciente encontrada nessa faixa."
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel limpar os pacientes nessa faixa.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateExam(event: FormEvent<HTMLFormElement>, examConfig: ExamConfig) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`exam-${examConfig.id}`);
    setFeedback("");

    try {
      const response = await api.updateAdminExamConfig(examConfig.id, {
        code: String(formData.get("code") || examConfig.code),
        name: String(formData.get("name") || examConfig.name),
        startWeek: Number(formData.get("startWeek") || examConfig.startWeek),
        endWeek: Number(formData.get("endWeek") || examConfig.endWeek),
        targetWeek: Number(formData.get("targetWeek") || examConfig.targetWeek),
        reminderDaysBefore1: Number(formData.get("reminderDaysBefore1") || examConfig.reminderDaysBefore1),
        reminderDaysBefore2: Number(formData.get("reminderDaysBefore2") || examConfig.reminderDaysBefore2),
        defaultMessage: String(formData.get("defaultMessage") || examConfig.defaultMessage),
        required: formData.get("required") === "on",
        flowType: String(formData.get("flowType") || examConfig.flowType),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? { ...current, examConfigs: current.examConfigs.map((item) => (item.id === examConfig.id ? response.examConfig : item)) }
          : current
      );
      setFeedback("Exame atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleCreateExam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSavingKey("create-exam");
    setFeedback("");

    try {
      const response = await api.createAdminExamConfig({
        code: String(formData.get("code") || ""),
        name: String(formData.get("name") || ""),
        startWeek: Number(formData.get("startWeek") || 0),
        endWeek: Number(formData.get("endWeek") || 0),
        targetWeek: Number(formData.get("targetWeek") || 0),
        reminderDaysBefore1: Number(formData.get("reminderDaysBefore1") || 0),
        reminderDaysBefore2: Number(formData.get("reminderDaysBefore2") || 0),
        defaultMessage: String(formData.get("defaultMessage") || ""),
        required: formData.get("required") === "on",
        flowType: String(formData.get("flowType") || "automatico"),
        active: formData.get("active") === "on",
        sortOrder: Number(formData.get("sortOrder") || adminData?.examConfigs.length || 0)
      });

      setAdminData((current) =>
        current
          ? {
              ...current,
              examConfigs: [...current.examConfigs, response.examConfig].sort((left, right) => left.sortOrder - right.sortOrder)
            }
          : current
      );
      form.reset();
      setShowCreateExamForm(false);
      setFeedback("Exame criado com sucesso.");
      await loadAdminData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel criar o exame.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDeleteExam(examConfig: ExamConfig) {
    const confirmed = window.confirm(`Deseja excluir o exame ${examConfig.name}?`);
    if (!confirmed) {
      return;
    }

    setSavingKey(`delete-exam-${examConfig.id}`);
    setFeedback("");
    try {
      await api.deleteAdminExamConfig(examConfig.id);
      setAdminData((current) =>
        current ? { ...current, examConfigs: current.examConfigs.filter((item) => item.id !== examConfig.id) } : current
      );
      setFeedback("Exame excluido da lista.");
      await loadAdminData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel excluir o exame.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateExamInferenceRule(event: FormEvent<HTMLFormElement>, rule: ExamInferenceRule) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`exam-inference-${rule.id}`);
    setFeedback("");

    try {
      const response = await api.updateExamInferenceRule(rule.id, {
        typicalStartWeek: Number(formData.get("typicalStartWeek") || rule.typicalStartWeek),
        typicalEndWeek: Number(formData.get("typicalEndWeek") || rule.typicalEndWeek),
        referenceWeek: Number(formData.get("referenceWeek") || rule.referenceWeek),
        uncertaintyMarginWeeks: Number(formData.get("uncertaintyMarginWeeks") || rule.uncertaintyMarginWeeks),
        allowAutomaticInference: formData.get("allowAutomaticInference") === "on",
        active: formData.get("active") === "on"
      });

      setAdminData((current) =>
        current
          ? {
              ...current,
              examInferenceRules: current.examInferenceRules.map((item) => (item.id === rule.id ? response.rule : item))
            }
          : current
      );
      setFeedback("Regra de inferencia atualizada com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a regra de inferencia.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleUpdateMessageTemplate(event: FormEvent<HTMLFormElement>, template: MessageTemplate) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSavingKey(`template-${template.id}`);
    setFeedback("");

    try {
      const response = await api.updateMessageTemplate(template.id, {
        name: String(formData.get("name") || template.name),
        language: String(formData.get("language") || template.language),
        content: String(formData.get("content") || template.content),
        active: formData.get("active") === "on"
      });
      setAdminData((current) =>
        current
          ? {
              ...current,
              messageTemplates: current.messageTemplates.map((item) => (item.id === template.id ? response.template : item))
            }
          : current
      );
      setFeedback("Template atualizado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o template.");
    } finally {
      setSavingKey("");
    }
  }

  if (loading && !adminData) {
    return <p className="loading-text">Carregando administracao...</p>;
  }

  if (!adminData) {
    return <p className="loading-text">Nao foi possivel carregar a administracao.</p>;
  }

  const normalizedUserSearch = searchUsers.trim().toLowerCase();
  const normalizedUnitSearch = searchUnits.trim().toLowerCase();
  const normalizedPhysicianSearch = searchPhysicians.trim().toLowerCase();
  const normalizedExamSearch = searchExams.trim().toLowerCase();
  const normalizedShospMappingSearch = searchShospMappings.trim().toLowerCase();

  const filteredUsers = adminData.users.filter((user) =>
    !normalizedUserSearch ||
    user.name.toLowerCase().includes(normalizedUserSearch) ||
    user.email.toLowerCase().includes(normalizedUserSearch)
  );

  const filteredUnits = adminData.units.filter((unit) =>
    !normalizedUnitSearch || unit.name.toLowerCase().includes(normalizedUnitSearch)
  );

  const filteredPhysicians = adminData.physicians.filter((physician) =>
    !normalizedPhysicianSearch ||
    physician.name.toLowerCase().includes(normalizedPhysicianSearch) ||
    String(physician.clinicUnitName || "").toLowerCase().includes(normalizedPhysicianSearch)
  );

  const filteredExams = adminData.examConfigs.filter((examConfig) =>
    !normalizedExamSearch ||
    examConfig.name.toLowerCase().includes(normalizedExamSearch) ||
    examConfig.code.toLowerCase().includes(normalizedExamSearch)
  );

  const filteredShospMappings = shospMappings.filter((mapping) =>
    !normalizedShospMappingSearch ||
    mapping.shospExamName.toLowerCase().includes(normalizedShospMappingSearch) ||
    String(mapping.shospExamCode || "").toLowerCase().includes(normalizedShospMappingSearch) ||
    mapping.examModelName.toLowerCase().includes(normalizedShospMappingSearch) ||
    mapping.examModelCode.toLowerCase().includes(normalizedShospMappingSearch)
  );

  const activeUsersCount = adminData.users.filter((user) => user.active).length;
  const activeUnitsCount = adminData.units.filter((unit) => unit.active).length;
  const activePhysiciansCount = adminData.physicians.filter((physician) => physician.active).length;
  const activeExamsCount = adminData.examConfigs.filter((examConfig) => examConfig.active).length;
  const visibleRecentAuditLogs = showAllRecentActivity
    ? adminData.recentAuditLogs.slice(0, 12)
    : adminData.recentAuditLogs.slice(0, 5);

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administracao</p>
          <h2>Administracao da clinica</h2>
          <p className="page-description">
            Gerencie usuarios, unidades, medicos e os exames padrao do protocolo em uma tela simples.
          </p>
        </div>
      </div>

      {feedback ? (
        <div className={getFeedbackTone(feedback) === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <strong>{getFeedbackTone(feedback) === "error" ? "Atencao" : "Sucesso"}</strong>
          <span>{feedback}</span>
        </div>
      ) : null}

      {false ? (
      <article className="panel-card stack-form admin-activity-panel" id="admin-activity-recent">
        <div className="card-row admin-activity-panel-head">
          <div className="stack-form">
            <SectionHeader
              eyebrow="Auditoria"
              title="Atividade recente da equipe"
              description="Um resumo rapido das movimentacoes mais recentes da equipe."
            />
            <p className="admin-activity-summary">
              {adminData!.recentAuditLogs.length
                ? `${Math.min(visibleRecentAuditLogs.length, adminData!.recentAuditLogs.length)} de ${adminData!.recentAuditLogs.length} registro(s) recente(s) visiveis.`
                : "Nenhuma atividade administrativa foi registrada ainda neste ambiente."}
            </p>
          </div>
          <div className="admin-activity-actions">
            <span className="badge badge-soft badge-priority-blue">
              {adminData!.recentAuditLogs.length} registro{adminData!.recentAuditLogs.length === 1 ? "" : "s"}
            </span>
            {adminData!.recentAuditLogs.length > 5 ? (
              <button
                type="button"
                className="ghost-button admin-activity-toggle"
                onClick={() => setShowAllRecentActivity((current) => !current)}
              >
                {showAllRecentActivity ? "Mostrar menos" : "Ver mais"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="list-grid admin-activity-list">
          {adminData!.recentAuditLogs.length ? visibleRecentAuditLogs.map((log) => (
            <div key={log.id} className="admin-row-card stack-form admin-log-card">
              <div className="card-row admin-entity-head">
                <div>
                  <strong>{log.description}</strong>
                  <p className="admin-user-subtitle">
                    {log.patientName ? `${log.patientName} • ` : ""}{log.actorUserName || "Usuario nao identificado"}
                  </p>
                </div>
                <span className="badge badge-soft badge-priority-blue admin-activity-badge">{log.actionType}</span>
              </div>
              <div className="message-metadata admin-activity-meta">
                <span>{formatDateTimeLabel(log.createdAt)}</span>
                <span>{log.entityType}</span>
              </div>
            </div>
          )) : (
            <div className="empty-state-card">
              <strong>Sem atividade recente por enquanto</strong>
              <p className="field-hint">
                Assim que a equipe cadastrar pacientes, registrar contatos ou fizer ajustes administrativos, esse bloco vai mostrar os eventos mais recentes.
              </p>
            </div>
          )}
        </div>
      </article>
      ) : null}

      <section className="admin-quick-grid">
        <QuickActionCard
          icon="US"
          title="Novo usuario"
          description="Crie um acesso novo e depois ajuste o perfil ou desative quando precisar."
          actionLabel="Abrir usuarios"
          onAction={() => setActiveTab("usuarios")}
        />
        <QuickActionCard
          icon="UN"
          title="Nova unidade"
          description="Cadastre uma nova unidade para aparecer nos filtros e nos cadastros."
          actionLabel="Abrir cadastros"
          onAction={() => setActiveTab("cadastros")}
        />
        <QuickActionCard
          icon="MD"
          title="Novo medico"
          description="Cadastre o medico e vincule a unidade principal dele."
          actionLabel="Abrir cadastros"
          onAction={() => setActiveTab("cadastros")}
        />
        <QuickActionCard
          icon="AT"
          title="Auditoria da equipe"
          description="Consulte os registros mais recentes de acoes operacionais e administrativas."
          actionLabel="Abrir auditoria"
          onAction={() => setActiveTab("auditoria")}
          statusLabel={`${adminData.recentAuditLogs.length} registro${adminData.recentAuditLogs.length === 1 ? "" : "s"}`}
        />
        {SHOSP_PRODUCT_VISIBLE ? (
          <QuickActionCard
            icon="SH"
            title="Integracao Shosp"
            description="Acompanhe o modo mock, revise logs e dispare sincronizacoes quando precisar."
            actionLabel="Abrir integracoes"
            onAction={() => setActiveTab("integracoes")}
          />
        ) : null}
      </section>

      <div className="patient-tabs-bar admin-tabs-bar" role="tablist" aria-label="Abas da area administrativa">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "usuarios"}
          className={`patient-tab-button ${activeTab === "usuarios" ? "active" : ""}`}
          onClick={() => setActiveTab("usuarios")}
        >
          <span>Usuarios</span>
          <span className="patient-tab-count">{filteredUsers.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "cadastros"}
          className={`patient-tab-button ${activeTab === "cadastros" ? "active" : ""}`}
          onClick={() => setActiveTab("cadastros")}
        >
          <span>Unidades e medicos</span>
          <span className="patient-tab-count">{filteredUnits.length + filteredPhysicians.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "exames"}
          className={`patient-tab-button ${activeTab === "exames" ? "active" : ""}`}
          onClick={() => setActiveTab("exames")}
        >
          <span>Exames</span>
          <span className="patient-tab-count">{filteredExams.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "auditoria"}
          className={`patient-tab-button ${activeTab === "auditoria" ? "active" : ""}`}
          onClick={() => setActiveTab("auditoria")}
        >
          <span>Auditoria</span>
          <span className="patient-tab-count">{adminData.recentAuditLogs.length}</span>
        </button>
        {SHOSP_PRODUCT_VISIBLE ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "integracoes"}
            className={`patient-tab-button ${activeTab === "integracoes" ? "active" : ""}`}
            onClick={() => setActiveTab("integracoes")}
          >
            <span>Integracoes</span>
            <span className="patient-tab-count">{shospStatus?.logs.length || 0}</span>
          </button>
        ) : null}
      </div>

      {activeTab === "auditoria" ? (
      <article className="panel-card stack-form admin-activity-panel" id="admin-activity-recent">
        <div className="card-row admin-activity-panel-head">
          <div className="stack-form">
            <SectionHeader
              eyebrow="Auditoria"
              title="Atividade recente da equipe"
              description="Um resumo rapido das movimentacoes mais recentes da equipe."
            />
            <p className="admin-activity-summary">
              {adminData.recentAuditLogs.length
                ? `${Math.min(visibleRecentAuditLogs.length, adminData.recentAuditLogs.length)} de ${adminData.recentAuditLogs.length} registro(s) recente(s) visiveis.`
                : "Nenhuma atividade administrativa foi registrada ainda neste ambiente."}
            </p>
          </div>
          <div className="admin-activity-actions">
            <span className="badge badge-soft badge-priority-blue">
              {adminData.recentAuditLogs.length} registro{adminData.recentAuditLogs.length === 1 ? "" : "s"}
            </span>
            {adminData.recentAuditLogs.length > 5 ? (
              <button
                type="button"
                className="ghost-button admin-activity-toggle"
                onClick={() => setShowAllRecentActivity((current) => !current)}
              >
                {showAllRecentActivity ? "Mostrar menos" : "Ver mais"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="list-grid admin-activity-list">
          {adminData.recentAuditLogs.length ? visibleRecentAuditLogs.map((log) => (
            <div key={log.id} className="admin-row-card stack-form admin-log-card">
              <div className="card-row admin-entity-head">
                <div>
                  <strong>{log.description}</strong>
                  <p className="admin-user-subtitle">
                    {log.patientName ? `${log.patientName} â€¢ ` : ""}{log.actorUserName || "Usuario nao identificado"}
                  </p>
                </div>
                <span className="badge badge-soft badge-priority-blue admin-activity-badge">{log.actionType}</span>
              </div>
              <div className="message-metadata admin-activity-meta">
                <span>{formatDateTimeLabel(log.createdAt)}</span>
                <span>{log.entityType}</span>
              </div>
            </div>
          )) : (
            <div className="empty-state-card">
              <strong>Sem atividade recente por enquanto</strong>
              <p className="field-hint">
                Assim que a equipe cadastrar pacientes, registrar contatos ou fizer ajustes administrativos, esse bloco vai mostrar os eventos mais recentes.
              </p>
            </div>
          )}
        </div>
      </article>
      ) : null}

      {activeTab === "usuarios" ? (
      <>
      <article className="panel-card stack-form" id="admin-users">
        <SectionHeader
          eyebrow="Usuarios"
          title="Gerenciar usuarios"
          description="Apenas administradores podem acessar esta area. Crie perfis e ajuste o tipo de acesso."
        />

        <div className="admin-summary-strip">
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Usuarios ativos</span>
            <strong>{activeUsersCount}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Total de usuarios</span>
            <strong>{adminData.users.length}</strong>
          </div>
        </div>

        <details className="admin-create-box" open>
          <summary>Criar novo usuario</summary>
          <form className="three-columns" onSubmit={handleCreateUser}>
            <label>
              Nome
              <input name="name" placeholder="Nome do usuario" />
            </label>
            <label>
              E-mail
              <input name="email" type="email" placeholder="usuario@clinica.com" />
            </label>
            <label>
              Senha inicial
              <input name="password" type="password" placeholder="Minimo 4 caracteres" />
            </label>
            <label>
              Perfil
              <select name="role" defaultValue="recepcao">
                <option value="recepcao">Recepcao</option>
                <option value="atendimento">Atendimento</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <label className="checkbox-row checkbox-row-compact">
              <input name="active" type="checkbox" defaultChecked />
              Usuario ativo
            </label>
            <div className="inline-actions align-end">
              <button className="primary-button" type="submit" disabled={savingKey === "create-user"}>
                {savingKey === "create-user" ? "Salvando..." : "Criar usuario"}
              </button>
            </div>
          </form>
        </details>

        <label>
          Buscar usuario
          <input
            value={searchUsers}
            onChange={(event) => setSearchUsers(event.target.value)}
            placeholder="Buscar por nome ou e-mail"
          />
        </label>

        <div className="settings-grid">
          {filteredUsers.map((user) => (
            <form key={user.id} className="admin-row-card admin-user-card stack-form" onSubmit={(event) => handleUpdateUser(event, user)}>
              <div className="card-row admin-user-card-head">
                <div className="admin-user-title-block">
                  <div className="admin-user-avatar" aria-hidden="true">
                    {user.role === "admin" ? "AD" : user.role === "atendimento" ? "AT" : "RC"}
                  </div>
                  <div>
                    <strong>{user.name}</strong>
                    <p className="admin-user-subtitle">{user.email}</p>
                  </div>
                </div>
                <div className="priority-badge-row">
                  <span className={`badge ${user.role === "admin" ? "badge-priority-red" : user.role === "atendimento" ? "badge-priority-yellow" : "badge-priority-green"}`}>
                    {user.role === "admin" ? "Administrador" : user.role === "atendimento" ? "Atendimento" : "Recepcao"}
                  </span>
                  <span className={`badge badge-soft ${user.active ? "badge-priority-green" : "badge-priority-red"}`}>
                    {user.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
              <div className="three-columns">
                <label>
                  Nome
                  <input name="name" defaultValue={user.name} />
                </label>
                <label>
                  E-mail
                  <input name="email" type="email" defaultValue={user.email} />
                </label>
                <label>
                  Nova senha
                  <input name="password" type="password" placeholder="Deixe em branco para manter" />
                </label>
              </div>
              <div className="two-columns">
                <label>
                  Perfil
                  <select name="role" defaultValue={user.role}>
                    <option value="recepcao">Recepcao</option>
                    <option value="atendimento">Atendimento</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked={user.active} />
                  Usuario ativo
                </label>
              </div>
              <button className="secondary-button" type="submit" disabled={savingKey === `user-${user.id}`}>
                {savingKey === `user-${user.id}` ? "Salvando..." : "Salvar usuario"}
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={savingKey === `delete-user-${user.id}`}
                onClick={() => handleDeleteUser(user)}
              >
                {savingKey === `delete-user-${user.id}` ? "Excluindo..." : "Excluir usuario"}
              </button>
            </form>
          ))}
        </div>
      </article>
      <article className="panel-card stack-form" id="admin-patient-cleanup">
        <SectionHeader
          eyebrow="Pacientes"
          title="Limpeza administrativa de pacientes"
          description="Use com cuidado para remover pacientes por faixa de criacao. Essa acao tambem remove exames, mensagens e movimentacoes relacionadas."
        />

        <div className="two-columns">
          <label>
            Faixa de exclusao
            <select value={patientCleanupPreset} onChange={(event) => setPatientCleanupPreset(event.target.value as PatientCleanupPreset)}>
              <option value="today">Excluir pacientes criados hoje</option>
              <option value="last_7_days">Excluir pacientes criados nos ultimos 7 dias</option>
              <option value="last_30_days">Excluir pacientes criados nos ultimos 30 dias</option>
              <option value="all">Excluir todos os pacientes</option>
              <option value="custom">Escolher faixa manual</option>
            </select>
          </label>
          <div className="field-hint">
            Essa ferramenta fica liberada apenas para administrador e sempre pede confirmacao antes de excluir.
          </div>
        </div>

        {patientCleanupPreset === "custom" ? (
          <div className="two-columns">
            <label>
              Data inicial
              <input type="date" value={patientCleanupDateFrom} onChange={(event) => setPatientCleanupDateFrom(event.target.value)} />
            </label>
            <label>
              Data final
              <input type="date" value={patientCleanupDateTo} onChange={(event) => setPatientCleanupDateTo(event.target.value)} />
            </label>
          </div>
        ) : null}

        <div className="inline-actions">
          <button className="danger-button" type="button" disabled={savingKey === "cleanup-patients"} onClick={() => void handleCleanupPatients()}>
            {savingKey === "cleanup-patients" ? "Excluindo..." : "Excluir pacientes dessa faixa"}
          </button>
        </div>

        {lastPatientCleanupResult ? (
          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Pacientes removidas</span>
              <strong>{lastPatientCleanupResult.deleted.patients}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Exames removidos</span>
              <strong>{lastPatientCleanupResult.deleted.exams}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Mensagens removidas</span>
              <strong>{lastPatientCleanupResult.deleted.messages}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Movimentacoes removidas</span>
              <strong>{lastPatientCleanupResult.deleted.movements}</strong>
            </div>
          </div>
        ) : null}
      </article>
      </>
      ) : null}

      {activeTab === "cadastros" ? (
      <div className="detail-layout admin-layout">
        <article className="panel-card stack-form" id="admin-units">
          <SectionHeader
            eyebrow="Unidades"
            title="Gerenciar unidades"
            description="Mantenha a lista oficial de unidades para filtros, cadastros e relatorios."
          />

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Unidades ativas</span>
              <strong>{activeUnitsCount}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Total de unidades</span>
              <strong>{adminData.units.length}</strong>
            </div>
          </div>

          <details className="admin-create-box" open>
            <summary>Criar nova unidade</summary>
            <form className="two-columns" onSubmit={handleCreateUnit}>
              <label>
                Nome da unidade
                <input name="name" placeholder="Ex.: Unidade Centro" />
              </label>
              <label className="checkbox-row checkbox-row-compact">
                <input name="active" type="checkbox" defaultChecked />
                Unidade ativa
              </label>
              <div className="inline-actions align-end">
                <button className="primary-button" type="submit" disabled={savingKey === "create-unit"}>
                  {savingKey === "create-unit" ? "Salvando..." : "Criar unidade"}
                </button>
              </div>
            </form>
          </details>

          <label>
            Buscar unidade
            <input
              value={searchUnits}
              onChange={(event) => setSearchUnits(event.target.value)}
              placeholder="Buscar por nome da unidade"
            />
          </label>

          <div className="list-grid">
            {filteredUnits.map((unit) => (
              <form key={unit.id} className="admin-row-card admin-entity-card stack-form" onSubmit={(event) => handleUpdateUnit(event, unit)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">UN</div>
                    <div>
                      <strong>{unit.name}</strong>
                      <p className="admin-user-subtitle">Cadastro de unidade da clinica</p>
                    </div>
                  </div>
                  <label className="checkbox-row checkbox-row-compact admin-inline-toggle">
                    <input name="active" type="checkbox" defaultChecked={unit.active} />
                    {unit.active ? "Ativa" : "Inativa"}
                  </label>
                </div>
                <label>
                  Nome
                  <input name="name" defaultValue={unit.name} />
                </label>
                <button className="secondary-button" type="submit" disabled={savingKey === `unit-${unit.id}`}>
                  {savingKey === `unit-${unit.id}` ? "Salvando..." : "Salvar unidade"}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={savingKey === `delete-unit-${unit.id}`}
                  onClick={() => handleDeleteUnit(unit)}
                >
                  {savingKey === `delete-unit-${unit.id}` ? "Excluindo..." : "Excluir unidade"}
                </button>
              </form>
            ))}
          </div>
        </article>

        <article className="panel-card stack-form" id="admin-physicians">
          <SectionHeader
            eyebrow="Medicos"
            title="Gerenciar medicos"
            description="Associe o medico a uma unidade para facilitar filtros e manter o cadastro organizado."
          />

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Medicos ativos</span>
              <strong>{activePhysiciansCount}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Total de medicos</span>
              <strong>{adminData.physicians.length}</strong>
            </div>
          </div>

          <details className="admin-create-box" open>
            <summary>Criar novo medico</summary>
            <form className="three-columns" onSubmit={handleCreatePhysician}>
              <label>
                Nome do medico
                <input name="name" placeholder="Ex.: Dra. Helena Castro" />
              </label>
              <label>
                Unidade
                <select name="clinicUnitId" defaultValue="">
                  <option value="">Sem unidade fixa</option>
                  {adminData.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row checkbox-row-compact">
                <input name="active" type="checkbox" defaultChecked />
                Medico ativo
              </label>
              <div className="inline-actions align-end">
                <button className="primary-button" type="submit" disabled={savingKey === "create-physician"}>
                  {savingKey === "create-physician" ? "Salvando..." : "Criar medico"}
                </button>
              </div>
            </form>
          </details>

          <label>
            Buscar medico
            <input
              value={searchPhysicians}
              onChange={(event) => setSearchPhysicians(event.target.value)}
              placeholder="Buscar por nome ou unidade"
            />
          </label>

          <div className="list-grid">
            {filteredPhysicians.map((physician) => (
              <form key={physician.id} className="admin-row-card admin-entity-card stack-form" onSubmit={(event) => handleUpdatePhysician(event, physician)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">MD</div>
                    <div>
                      <strong>{physician.name}</strong>
                      <p className="admin-user-subtitle">{physician.clinicUnitName || "Sem unidade vinculada"}</p>
                    </div>
                  </div>
                  <label className="checkbox-row checkbox-row-compact admin-inline-toggle">
                    <input name="active" type="checkbox" defaultChecked={physician.active} />
                    {physician.active ? "Ativo" : "Inativo"}
                  </label>
                </div>
                <label>
                  Nome
                  <input name="name" defaultValue={physician.name} />
                </label>
                <label>
                  Unidade
                  <select name="clinicUnitId" defaultValue={physician.clinicUnitId || ""}>
                    <option value="">Sem unidade fixa</option>
                    {adminData.units.map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.name}</option>
                    ))}
                  </select>
                </label>
                <button className="secondary-button" type="submit" disabled={savingKey === `physician-${physician.id}`}>
                  {savingKey === `physician-${physician.id}` ? "Salvando..." : "Salvar medico"}
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={savingKey === `delete-physician-${physician.id}`}
                  onClick={() => handleDeletePhysician(physician)}
                >
                  {savingKey === `delete-physician-${physician.id}` ? "Excluindo..." : "Excluir medico"}
                </button>
              </form>
            ))}
          </div>
        </article>
      </div>
      ) : null}

      {activeTab === "exames" ? (
      <div className="detail-layout admin-layout">
      <article className="panel-card stack-form">
        <SectionHeader
          eyebrow="Exames"
          title="Gerenciar exames padrao"
          description="Ajuste semanas recomendadas, mensagens, antecedencia dos lembretes e se o exame entra ou nao no protocolo."
        />

        <div className="admin-summary-strip">
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Exames ativos</span>
            <strong>{activeExamsCount}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Total de exames</span>
            <strong>{adminData.examConfigs.length}</strong>
          </div>
        </div>

        <div className="inline-actions admin-exam-toolbar">
          <button
            type="button"
            className="primary-button"
            onClick={() => setShowCreateExamForm((current) => !current)}
          >
            {showCreateExamForm ? "Fechar novo exame" : "Adicionar exame"}
          </button>
        </div>

        {showCreateExamForm ? (
          <form className="admin-row-card admin-exam-card stack-form" onSubmit={handleCreateExam}>
            <div className="card-row admin-entity-head">
              <div className="admin-user-title-block">
                <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">NV</div>
                <div>
                  <strong>Novo exame</strong>
                  <p className="admin-user-subtitle">Crie um exame para entrar no protocolo ou ficar como avulso.</p>
                </div>
              </div>
            </div>

            <div className="two-columns">
              <label>
                Nome do exame
                <input name="name" placeholder="Ex.: Morfologico 3o trimestre" />
              </label>
              <label>
                Codigo do exame
                <input name="code" placeholder="Ex.: morfologico_3_trimestre" />
              </label>
            </div>

            <div className="three-columns">
              <label>
                Semana inicial
                <input name="startWeek" type="number" min="0" step="0.01" defaultValue={0} />
              </label>
              <label>
                Semana final
                <input name="endWeek" type="number" min="0" step="0.01" defaultValue={0} />
              </label>
              <label>
                Semana alvo
                <input name="targetWeek" type="number" min="0" step="0.01" defaultValue={0} />
              </label>
            </div>

            <div className="two-columns">
              <label>
                Lembrete 1
                <input name="reminderDaysBefore1" type="number" min="0" defaultValue={7} />
              </label>
              <label>
                Lembrete 2
                <input name="reminderDaysBefore2" type="number" min="0" defaultValue={2} />
              </label>
            </div>

            <div className="three-columns">
              <label>
                Ordem
                <input name="sortOrder" type="number" min="1" defaultValue={adminData.examConfigs.length + 1} />
              </label>
              <label>
                Tipo de fluxo
                <select name="flowType" defaultValue="automatico">
                  <option value="automatico">Automatico</option>
                  <option value="avulso">Avulso/manual</option>
                </select>
              </label>
              <div className="stack-form">
                <label className="checkbox-row checkbox-row-compact">
                  <input name="required" type="checkbox" />
                  Exame obrigatorio
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked />
                  Exame ativo
                </label>
              </div>
            </div>

            <label>
              Mensagem padrao de lembrete
              <textarea
                name="defaultMessage"
                rows={4}
                defaultValue="Olá, [NOME]! 😊"
              />
              <span className="field-hint">Tags disponiveis: [NOME], [EXAME], [DATA_IDEAL], [MEDICO], [UNIDADE], [IDADE_GESTACIONAL] e [DPP].</span>
            </label>

            <button className="primary-button" type="submit" disabled={savingKey === "create-exam"}>
              {savingKey === "create-exam" ? "Salvando..." : "Criar exame"}
            </button>
          </form>
        ) : null}

        <label>
          Buscar exame
          <input
            value={searchExams}
            onChange={(event) => setSearchExams(event.target.value)}
            placeholder="Buscar por nome ou codigo"
          />
        </label>

        <div className="settings-grid">
          {filteredExams.map((examConfig) => (
            <form key={examConfig.id} className="admin-row-card admin-exam-card stack-form" onSubmit={(event) => handleUpdateExam(event, examConfig)}>
              <div className="card-row admin-entity-head">
                <div className="admin-user-title-block">
                  <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">EX</div>
                  <div>
                    <strong>{examConfig.name}</strong>
                    <p className="admin-user-subtitle">Codigo: {examConfig.code}</p>
                  </div>
                </div>
                <div className="priority-badge-row">
                  <span className={`badge ${examConfig.required ? "badge-priority-red" : "badge-priority-green"}`}>
                    {examConfig.required ? "Obrigatorio" : "Recomendado"}
                  </span>
                  <span className={`badge badge-soft ${examConfig.active ? "badge-priority-green" : "badge-priority-red"}`}>
                    {examConfig.active ? "Ativo" : "Inativo"}
                  </span>
                </div>
              </div>
              <label>
                Codigo do exame
                <input name="code" defaultValue={examConfig.code} />
              </label>

              <label>
                Nome do exame
                <input name="name" defaultValue={examConfig.name} />
              </label>

              <div className="three-columns">
                <label>
                  Semana inicial
                  <input name="startWeek" type="number" min="0" step="0.01" defaultValue={examConfig.startWeek} />
                </label>
                <label>
                  Semana final
                  <input name="endWeek" type="number" min="0" step="0.01" defaultValue={examConfig.endWeek} />
                </label>
                <label>
                  Semana alvo
                  <input name="targetWeek" type="number" min="0" step="0.01" defaultValue={examConfig.targetWeek} />
                </label>
              </div>

              <div className="two-columns">
                <label>
                  Lembrete 1
                  <input name="reminderDaysBefore1" type="number" min="0" defaultValue={examConfig.reminderDaysBefore1} />
                </label>
                <label>
                  Lembrete 2
                  <input name="reminderDaysBefore2" type="number" min="0" defaultValue={examConfig.reminderDaysBefore2} />
                </label>
              </div>

              <div className="three-columns">
                <label className="checkbox-row checkbox-row-compact">
                  <input name="required" type="checkbox" defaultChecked={examConfig.required} />
                  Exame obrigatorio
                </label>
                <label>
                  Tipo de fluxo
                  <select name="flowType" defaultValue={examConfig.flowType}>
                    <option value="automatico">Automatico</option>
                    <option value="avulso">Avulso/manual</option>
                  </select>
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked={examConfig.active} />
                  Exame ativo
                </label>
              </div>

              <label>
                Mensagem padrao de lembrete
                <textarea name="defaultMessage" rows={4} defaultValue={examConfig.defaultMessage} />
                <span className="field-hint">Tags disponiveis: [NOME], [EXAME], [DATA_IDEAL], [MEDICO], [UNIDADE], [IDADE_GESTACIONAL] e [DPP].</span>
              </label>

              <div className="admin-exam-actions">
                <button className="secondary-button admin-exam-save-button" type="submit" disabled={savingKey === `exam-${examConfig.id}`}>
                  {savingKey === `exam-${examConfig.id}` ? "Salvando..." : "Salvar exame"}
                </button>
                <button
                  className="danger-button admin-exam-delete-button"
                  type="button"
                  disabled={savingKey === `delete-exam-${examConfig.id}`}
                  onClick={() => void handleDeleteExam(examConfig)}
                >
                  {savingKey === `delete-exam-${examConfig.id}` ? "Excluindo..." : "Excluir exame"}
                </button>
              </div>
            </form>
          ))}
        </div>
      </article>

      <article className="panel-card stack-form">
          <SectionHeader
            eyebrow="Inferencia"
            title="Regras de idade gestacional por exame"
            description="Defina como cada exame pode ajudar a estimar a base gestacional quando a paciente nao tiver idade gestacional informada nem dado estruturado suficiente."
          />

        <div className="integration-helper-card">
          <strong>Como essa regra funciona</strong>
            <p>
              O sistema olha o ultimo exame obstetrico valido realizado na clinica. Quando a regra estiver ativa, ele usa a
              semana de referencia configurada para estimar a idade gestacional e a DPP. Se a margem de incerteza deixar a confianca baixa,
              a automacao fica bloqueada e a paciente vai para revisao manual.
            </p>
        </div>

        <div className="admin-summary-strip">
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Regras ativas</span>
            <strong>{adminData.examInferenceRules.filter((rule) => rule.active).length}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Inferencia automatica liberada</span>
            <strong>{adminData.examInferenceRules.filter((rule) => rule.active && rule.allowAutomaticInference).length}</strong>
          </div>
          <div className="admin-summary-pill">
            <span className="admin-summary-label">Total de regras</span>
            <strong>{adminData.examInferenceRules.length}</strong>
          </div>
        </div>

        <div className="settings-grid">
          {adminData.examInferenceRules.map((rule) => (
            <form key={rule.id} className="admin-row-card admin-exam-card stack-form" onSubmit={(event) => handleUpdateExamInferenceRule(event, rule)}>
              <div className="card-row admin-entity-head">
                <div className="admin-user-title-block">
                  <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">IG</div>
                  <div>
                    <strong>{rule.examName}</strong>
                    <p className="admin-user-subtitle">Codigo: {rule.examCode}</p>
                  </div>
                </div>
                <div className="priority-badge-row">
                  <span className={`badge ${rule.allowAutomaticInference ? "badge-priority-green" : "badge-priority-yellow"}`}>
                    {rule.allowAutomaticInference ? "Pode inferir" : "So referencia"}
                  </span>
                  <span className={`badge badge-soft ${rule.active ? "badge-priority-green" : "badge-priority-red"}`}>
                    {rule.active ? "Ativa" : "Inativa"}
                  </span>
                </div>
              </div>

              <div className="three-columns">
                <label>
                  Faixa inicial
                  <input name="typicalStartWeek" type="number" min="0" step="0.5" defaultValue={rule.typicalStartWeek} />
                </label>
                <label>
                  Faixa final
                  <input name="typicalEndWeek" type="number" min="0" step="0.5" defaultValue={rule.typicalEndWeek} />
                </label>
                <label>
                  Semana de referencia
                  <input name="referenceWeek" type="number" min="0" step="0.5" defaultValue={rule.referenceWeek} />
                </label>
              </div>

              <div className="three-columns">
                <label>
                  Margem de incerteza
                  <input name="uncertaintyMarginWeeks" type="number" min="0" step="0.5" defaultValue={rule.uncertaintyMarginWeeks} />
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="allowAutomaticInference" type="checkbox" defaultChecked={rule.allowAutomaticInference} />
                  Permitir inferencia automatica
                </label>
                <label className="checkbox-row checkbox-row-compact">
                  <input name="active" type="checkbox" defaultChecked={rule.active} />
                  Regra ativa
                </label>
              </div>

              <button className="secondary-button" type="submit" disabled={savingKey === `exam-inference-${rule.id}`}>
                {savingKey === `exam-inference-${rule.id}` ? "Salvando..." : "Salvar regra"}
              </button>
            </form>
          ))}
        </div>
      </article>
      </div>
      ) : null}

      {SHOSP_PRODUCT_VISIBLE && activeTab === "integracoes" ? (
      <div className="admin-layout integration-layout">
        {activeIntegrationTab === "visao" ? (
        <article className="panel-card stack-form">
          <SectionHeader
            eyebrow="Shosp"
            title="Painel de sincronizacao do Shosp"
            description="Monitore status, resultados, logs e manutencao tecnica da integracao sem perder o acompanhamento operacional."
          />

          <p className="integration-helper-text">
            O Shosp continua como sistema mestre. O Medfetus recebe os dados e transforma isso em acompanhamento operacional da gestacao.
          </p>

          <div className="integration-monitor-grid">
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Status da integracao</span>
              <strong className={shospStatus?.connection.connected ? "integration-good" : "integration-bad"}>
                {shospStatus?.connection.label || "Desconectado"}
              </strong>
              <p>{shospStatus?.connection.detail || "Sem configuracao ativa no momento."}</p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Ultima sincronizacao</span>
              <strong>{formatDateTimeLabel(shospStatus?.summary.lastSyncAt)}</strong>
              <p>Inclui pacientes, atendimentos e exames recebidos do Shosp.</p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Tempo medio da API</span>
              <strong>{shospStatus?.mode === "mock" ? "Simulado" : formatDurationLabel(shospStatus?.apiMetrics.averageResponseMs)}</strong>
              <p>
                {shospStatus?.mode === "mock"
                  ? "Sem chamada externa real enquanto o modo mock estiver ativo."
                  : `${shospStatus?.apiMetrics.successfulRequests || 0} requisicoes bem-sucedidas no ciclo atual.`}
              </p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Worker de sincronizacao</span>
              <strong>{shospStatus?.worker.enabled ? "Ativo" : "Manual"}</strong>
              <p>
                {shospStatus?.worker.lastRunAt
                  ? `Ultima execucao em ${formatDateTimeLabel(shospStatus.worker.lastRunAt)}`
                  : "Ainda sem execucoes registradas no worker."}
              </p>
            </div>
          </div>

          <div className="integration-flow-strip" aria-label="Fluxo resumido da integracao do Shosp">
            <div className="integration-flow-step integration-flow-step-patients">
              <span className="integration-flow-icon">PA</span>
              <div>
                <strong>Pacientes</strong>
                <p>Cadastro mestre vindo do Shosp</p>
              </div>
            </div>
            <span className="integration-flow-arrow" aria-hidden="true">-&gt;</span>
            <div className="integration-flow-step integration-flow-step-agenda">
              <span className="integration-flow-icon">AG</span>
              <div>
                <strong>Agenda</strong>
                <p>Atendimentos, exames e realizados</p>
              </div>
            </div>
            <span className="integration-flow-arrow" aria-hidden="true">-&gt;</span>
            <div className="integration-flow-step integration-flow-step-complete">
              <span className="integration-flow-icon">OK</span>
              <div>
                <strong>Completa</strong>
                <p>Atualizacao consolidada do fluxo</p>
              </div>
            </div>
          </div>

          <div className="integration-monitor-grid integration-metrics-grid">
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Pacientes sincronizadas</span>
              <strong>{shospStatus?.summary.patientsSynced || 0}</strong>
              <p>Total de cadastros locais com origem confirmada no Shosp.</p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Exames importados</span>
              <strong>{shospStatus?.summary.examsImported || 0}</strong>
              <p>Exames e atendimentos que ja entraram no CRM via sincronizacao.</p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Agendamentos detectados</span>
              <strong>{shospStatus?.summary.detectedSchedules || 0}</strong>
              <p>Deteccoes automaticas de agenda futura feitas a partir do Shosp.</p>
            </div>
            <div className="integration-monitor-card">
              <span className="integration-monitor-label">Erros recentes</span>
              <strong>{shospStatus?.summary.recentErrorsCount || 0}</strong>
              <p>Ocorrencias recentes que merecem revisao tecnica ou novo processamento.</p>
            </div>
          </div>

          <div className="integration-tools-bar">
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSyncNow()}
              disabled={savingKey === "shosp-sync-now"}
            >
              {savingKey === "shosp-sync-now" ? "Sincronizando..." : "Sincronizar agora"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => void handleReprocessShospData()}
              disabled={savingKey === "shosp-reprocess"}
            >
              {savingKey === "shosp-reprocess" ? "Reprocessando..." : "Reprocessar dados"}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void handleClearShospSyncCache()}
              disabled={savingKey === "shosp-clear-cache"}
            >
              {savingKey === "shosp-clear-cache" ? "Limpando..." : "Limpar cache de sincronizacao"}
            </button>
          </div>

          <section className="admin-quick-grid shosp-quick-grid">
            <QuickActionCard
              icon="PA"
              title="Sincronizar pacientes"
              description="Importa e atualiza os cadastros vindos do Shosp para iniciar a esteira local."
              actionLabel={syncingScope === "patients" ? "Sincronizando..." : "Rodar agora"}
              tone="patients"
              statusLabel={syncingScope === "patients" ? "Em execucao" : "Pronto"}
              onAction={() => void handleRunShospSync("patients")}
            />
            <QuickActionCard
              icon="AG"
              title="Sincronizar agenda"
              description="Atualiza atendimentos, exames solicitados, agendamentos e exames realizados."
              actionLabel={syncingScope === "attendances" ? "Sincronizando..." : "Rodar agora"}
              tone="agenda"
              statusLabel={syncingScope === "attendances" ? "Em execucao" : shospStatus?.mode === "mock" ? "Mock" : "Pronto"}
              onAction={() => void handleRunShospSync("attendances")}
            />
            <QuickActionCard
              icon="OK"
              title="Sincronizacao completa"
              description="Executa pacientes e agenda de uma vez so para validar o fluxo inteiro."
              actionLabel={syncingScope === "full" ? "Sincronizando..." : "Rodar agora"}
              tone="complete"
              statusLabel={syncingScope === "full" ? "Em execucao" : shospStatus?.configured ? "Pronto" : "Pendente"}
              onAction={() => void handleRunShospSync("full")}
            />
          </section>

          <div className="admin-summary-strip shosp-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Modo atual</span>
              <strong>{shospStatus?.mode === "mock" ? "Mock" : "Live"}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Configuracao</span>
              <strong>{shospStatus?.configured ? "Pronta para uso" : "Credenciais pendentes"}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Ultimo contato com a API</span>
              <strong>{formatDateTimeLabel(shospStatus?.apiMetrics.lastSuccessAt || shospStatus?.apiMetrics.lastFailureAt)}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Erro mais recente</span>
              <strong>{shospStatus?.apiMetrics.lastErrorMessage || "Sem falhas recentes"}</strong>
            </div>
          </div>

          <div className="message-metadata shosp-settings-grid">
            <span><strong>Base URL:</strong> {shospStatus?.settings.baseUrl || "Modo mock ativo"}</span>
            <span><strong>Pacientes:</strong> {shospStatus?.settings.patientsPath || "-"}</span>
            <span><strong>Atendimentos:</strong> {shospStatus?.settings.attendancesPath || "-"}</span>
            <span><strong>Exames:</strong> {shospStatus?.settings.examsPath || "-"}</span>
            <span><strong>Timeout:</strong> {shospStatus?.settings.timeoutMs || 0} ms</span>
          </div>

          {latestShospSyncResult ? (
            <div className="admin-summary-strip shosp-summary-strip">
              {"patients" in latestShospSyncResult && latestShospSyncResult.patients ? (
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Pacientes importados</span>
                  <strong>{latestShospSyncResult.patients.recordsCreated || 0}</strong>
                </div>
              ) : (
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Pacientes importados</span>
                  <strong>{latestShospSyncResult.scope === "patients" ? latestShospSyncResult.recordsCreated || 0 : 0}</strong>
                </div>
              )}
              {"attendances" in latestShospSyncResult && latestShospSyncResult.attendances ? (
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Exames atualizados</span>
                  <strong>{(latestShospSyncResult.attendances.recordsCreated || 0) + (latestShospSyncResult.attendances.recordsUpdated || 0)}</strong>
                </div>
              ) : (
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Exames atualizados</span>
                  <strong>{latestShospSyncResult.scope === "attendances" ? (latestShospSyncResult.recordsCreated || 0) + (latestShospSyncResult.recordsUpdated || 0) : 0}</strong>
                </div>
              )}
              <div className="admin-summary-pill">
                <span className="admin-summary-label">Escopo executado</span>
                <strong>{latestShospSyncResult.scope || "completa"}</strong>
              </div>
            </div>
          ) : null}

          {shospStatus?.summary.recentErrors.length ? (
            <div className="integration-error-list">
              {shospStatus.summary.recentErrors.map((error) => {
                const severity = getIntegrationSeverity(error.status, error.errorMessage);

                return (
                <div key={error.id} className={`integration-error-item integration-error-item-${severity.tone}`}>
                  <div>
                    <div className="priority-badge-row">
                      <strong>{error.scope === "patients" ? "Pacientes" : "Atendimentos e exames"}</strong>
                      <span className={`badge badge-soft integration-severity-badge integration-severity-badge-${severity.tone}`}>
                        {severity.label}
                      </span>
                    </div>
                    <p>{error.errorMessage || "Falha nao detalhada."}</p>
                  </div>
                  <span>{formatDateTimeLabel(error.finishedAt || error.startedAt)}</span>
                </div>
              )})}
            </div>
          ) : null}
        </article>
        ) : null}

        <div className="patient-tabs-bar integration-subtabs" role="tablist" aria-label="Subabas de integracoes">
          <button
            type="button"
            role="tab"
            aria-selected={activeIntegrationTab === "visao"}
            className={`patient-tab-button ${activeIntegrationTab === "visao" ? "active" : ""}`}
            onClick={() => setActiveIntegrationTab("visao")}
          >
            <span>Visao geral</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeIntegrationTab === "mapeamentos"}
            className={`patient-tab-button ${activeIntegrationTab === "mapeamentos" ? "active" : ""}`}
            onClick={() => setActiveIntegrationTab("mapeamentos")}
          >
            <span>Mapeamentos</span>
            <span className="patient-tab-count">{shospMappings.length}</span>
          </button>
        </div>

        {activeIntegrationTab === "visao" ? (
        <>
        <div className="integration-overview-grid">
        <article className="panel-card stack-form integration-panel-primary">
          <SectionHeader
            eyebrow="Teste operacional"
            title="Teste de Fluxo"
            description="Cria a paciente Maria Gertrudes com telefone (31) 97521-5445 no inicio da gravidez e percorre o fluxo completo do acompanhamento."
          />

          <div className="list-action-bar detail-action-bar">
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleRunOperationalTest()}
              disabled={savingKey === "operational-test"}
            >
              {savingKey === "operational-test" ? "Executando..." : "Rodar teste operacional"}
            </button>
          </div>

          {operationalTestResult ? (
            <div className="stack-form">
              {!operationalTestResult.ok ? (
                <p className="field-hint">{operationalTestResult.message || "O teste operacional nao pode ser executado neste ambiente."}</p>
              ) : null}
              <div className="admin-summary-strip">
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Paciente criada</span>
                  <strong>{operationalTestResult.patientName}</strong>
                </div>
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Etapa final</span>
                  <strong>{operationalTestResult.finalStage}</strong>
                </div>
                <div className="admin-summary-pill">
                  <span className="admin-summary-label">Exames realizados</span>
                  <strong>{operationalTestResult.realizedCount}/{operationalTestResult.totalExams}</strong>
                </div>
              </div>

              <div className="list-grid">
                {operationalTestResult.timeline.map((item) => (
                  <div key={`${item.examName}-${item.predictedDate}`} className="admin-row-card stack-form admin-log-card">
                    <div className="card-row admin-entity-head">
                      <div>
                        <strong>{item.examName}</strong>
                        <p className="admin-user-subtitle">Data prevista: {item.predictedDate}</p>
                      </div>
                      <span className="badge badge-priority-green">Fluxo validado</span>
                    </div>
                    <div className="message-metadata">
                      <span><strong>Mensagem:</strong> {item.afterMessageStage}</span>
                      <span><strong>Agendamento:</strong> {item.afterScheduleStage}</span>
                      <span><strong>Realizacao:</strong> {item.afterCompletionStage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-state">Quando voce rodar o teste, o resumo completo vai aparecer aqui.</p>
          )}
        </article>

        <article className="panel-card stack-form integration-panel-secondary">
          <SectionHeader
            eyebrow="Cursores"
            title="Sincronizacao incremental"
            description="Cada cursor guarda de onde a proxima leitura incremental do Shosp vai continuar, evitando leitura repetida."
          />

          <div className="list-grid">
            {shospStatus?.cursors.length ? shospStatus.cursors.map((cursor) => (
              <div key={cursor.syncKey} className="admin-row-card stack-form admin-log-card">
                <div className="card-row admin-entity-head">
                  <div>
                    <strong>{cursor.syncKey}</strong>
                    <p className="admin-user-subtitle">Controle incremental do modulo {cursor.syncKey}</p>
                  </div>
                  <span className="badge badge-priority-blue">Cursor ativo</span>
                </div>
                <div className="message-metadata">
                  <span><strong>Ultimo cursor:</strong> {cursor.lastCursor || "Nenhum ainda"}</span>
                  <span><strong>Ultimo sucesso:</strong> {cursor.lastSuccessAt || "Sem sincronizacao concluida"}</span>
                  <span><strong>Atualizado em:</strong> {cursor.updatedAt}</span>
                </div>
              </div>
            )) : <p className="empty-state">Nenhum cursor registrado ainda. Rode uma sincronizacao para inicializar esse controle.</p>}
          </div>
        </article>

        <article className="panel-card stack-form integration-panel-secondary">
          <SectionHeader
            eyebrow="Configuracoes"
            title="Parametros da integracao"
            description="URLs e caminhos ficam na aplicacao. Credenciais sensiveis do Shosp sao lidas apenas por variaveis de ambiente no servidor."
          />

          <form className="stack-form" onSubmit={handleUpdateShospSettings}>
            <div className="two-columns">
              <label className="checkbox-row checkbox-row-compact">
                <input
                  type="checkbox"
                  checked={shospSettingsForm.useMock}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, useMock: event.target.checked }))}
                />
                Usar modo mock
              </label>
              <label>
                Timeout (ms)
                <input
                  value={shospSettingsForm.timeoutMs}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, timeoutMs: event.target.value }))}
                />
              </label>
            </div>

            <div className="two-columns">
              <label>
                Base URL
                <input
                  value={shospSettingsForm.apiBaseUrl}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, apiBaseUrl: event.target.value }))}
                  placeholder="https://api.shosp.com.br"
                />
              </label>
              <div className="integration-helper-card">
                <strong>Credenciais protegidas</strong>
                <p>
                  Token, API Key, usuario, senha e account ID do Shosp nao sao salvos no banco.
                  Configure esses dados apenas pelas variaveis de ambiente do backend.
                </p>
              </div>
            </div>

            <div className="three-columns">
              <label>
                Caminho de pacientes
                <input
                  value={shospSettingsForm.patientsPath}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, patientsPath: event.target.value }))}
                />
              </label>
              <label>
                Caminho de atendimentos
                <input
                  value={shospSettingsForm.attendancesPath}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, attendancesPath: event.target.value }))}
                />
              </label>
              <label>
                Caminho de exames
                <input
                  value={shospSettingsForm.examsPath}
                  onChange={(event) => setShospSettingsForm((current) => ({ ...current, examsPath: event.target.value }))}
                />
              </label>
            </div>

            <p className="field-hint">
              Dica: para demonstração segura, mantenha o modo mock ativo. Use dados reais só quando tiver certeza das credenciais corretas.
            </p>

            <div className="list-action-bar detail-action-bar">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleTestShospConnection()}
                disabled={savingKey === "shosp-settings" || savingKey === "shosp-test-connection" || savingKey === "shosp-test-live-connection"}
              >
                {savingKey === "shosp-test-connection" ? "Testando..." : "Testar configuracao"}
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleTestShospLiveConnection()}
                disabled={savingKey === "shosp-settings" || savingKey === "shosp-test-connection" || savingKey === "shosp-test-live-connection"}
              >
                {savingKey === "shosp-test-live-connection" ? "Testando..." : "Testar conexao live"}
              </button>
              <button className="primary-button" type="submit" disabled={savingKey === "shosp-settings"}>
                {savingKey === "shosp-settings" ? "Salvando..." : "Salvar configuracoes"}
              </button>
            </div>
          </form>

          {shospConnectionTest ? (
            <div className={`form-alert ${shospConnectionTest.ok ? "form-alert-success" : "form-alert-error"}`}>
              <strong>{shospConnectionTest.ok ? "Conexao validada" : "Configuracao incompleta"}</strong>
              <span>{shospConnectionTest.message}</span>
            </div>
          ) : null}
        </article>

        <article className="panel-card stack-form integration-panel-tertiary integration-mappings-panel">
          <SectionHeader
            eyebrow="Logs"
            title="Historico de sincronizacoes"
            description="Mensagens de erro, tempo de execucao e volumetria das ultimas execucoes do Shosp."
          />

          <div className="list-grid integration-log-grid">
            {shospStatus?.logs.length ? shospStatus.logs.map((log) => (
              <div key={log.id} className={`admin-row-card stack-form admin-log-card integration-log-card integration-log-card-${getIntegrationSeverity(log.status, log.errorMessage).tone}`}>
                <div className="card-row admin-entity-head">
                  <div>
                    <strong>{log.scope === "patients" ? "Pacientes" : "Atendimentos e exames"}</strong>
                    <p className="admin-user-subtitle">Inicio: {log.startedAt}</p>
                  </div>
                  <div className="priority-badge-row">
                    <span className="badge badge-priority-blue">{log.mode}</span>
                    <span className={`badge badge-soft integration-severity-badge integration-severity-badge-${getIntegrationSeverity(log.status, log.errorMessage).tone}`}>
                      {getIntegrationSeverity(log.status, log.errorMessage).label}
                    </span>
                    <span className={`badge badge-soft ${
                      log.status === "error"
                        ? "badge-priority-red"
                        : log.status === "partial"
                          ? "badge-priority-yellow"
                          : log.status === "running"
                            ? "badge-priority-orange"
                            : "badge-priority-green"
                    }`}>
                      {log.status}
                    </span>
                  </div>
                </div>
                <div className="message-metadata">
                  <span><strong>Recebidos:</strong> {log.recordsReceived}</span>
                  <span><strong>Processados:</strong> {log.recordsProcessed}</span>
                  <span><strong>Criados:</strong> {log.recordsCreated}</span>
                  <span><strong>Atualizados:</strong> {log.recordsUpdated}</span>
                  <span><strong>Duracao:</strong> {formatDurationLabel(log.durationMs)}</span>
                  <span><strong>Finalizado em:</strong> {log.finishedAt || "Ainda em execucao"}</span>
                  {log.errorMessage ? <span className="exam-warning-text"><strong>Erro:</strong> {log.errorMessage}</span> : null}
                </div>
              </div>
            )) : <p className="empty-state">Nenhum log de sincronizacao registrado ainda.</p>}
          </div>
        </article>
        </div>
        </>
        ) : null}

        {activeIntegrationTab === "mapeamentos" ? (
        <article className="panel-card stack-form integration-panel-tertiary">
          <SectionHeader
            eyebrow="Mapeamentos"
            title="Tipos de exame do Shosp e do CRM"
            description="Revise e edite o vinculo entre os exames vindos do Shosp e os tipos locais do Medfetus."
          />

          <div className="integration-helper-card">
            <strong>Como usar esta area</strong>
            <p>
              Cada item abaixo representa um tipo de exame que chega do Shosp. Aqui voce escolhe qual exame local do
              Medfetus corresponde a ele, para que a importacao marque o exame certo e avance a esteira correta.
            </p>
            <div className="integration-helper-points">
              <span>1. Confira o nome do exame no Shosp</span>
              <span>2. Escolha o exame equivalente no Medfetus</span>
              <span>3. Salve o mapeamento para evitar duplicidade ou vinculo incorreto</span>
            </div>
          </div>

          <div className="admin-summary-strip">
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Mapeamentos ativos</span>
              <strong>{shospMappings.filter((item) => item.active).length}</strong>
            </div>
            <div className="admin-summary-pill">
              <span className="admin-summary-label">Total de mapeamentos</span>
              <strong>{shospMappings.length}</strong>
            </div>
          </div>

          <label>
            Buscar mapeamento
            <input
              value={searchShospMappings}
              onChange={(event) => setSearchShospMappings(event.target.value)}
              placeholder="Buscar por exame do Shosp, codigo ou exame local"
            />
          </label>

          <div className="list-grid integration-mapping-grid">
            {filteredShospMappings.length ? filteredShospMappings.map((mapping) => (
              <form key={mapping.id} className="admin-row-card stack-form admin-entity-card integration-mapping-card" onSubmit={(event) => handleUpdateShospMapping(event, mapping)}>
                <div className="card-row admin-entity-head">
                  <div className="admin-user-title-block">
                    <div className="admin-user-avatar admin-entity-avatar" aria-hidden="true">SH</div>
                    <div>
                      <strong>{mapping.shospExamName}</strong>
                      <p className="admin-user-subtitle">Codigo Shosp: {mapping.shospExamCode || "Nao informado"}</p>
                    </div>
                  </div>
                  <div className="priority-badge-row">
                    <span className={`badge badge-soft ${mapping.active ? "badge-priority-green" : "badge-priority-red"}`}>
                      {mapping.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                </div>

                <label>
                  Exame local vinculado
                  <select name="examModelId" defaultValue={mapping.examModelId}>
                    {adminData.examConfigs.map((examConfig) => (
                      <option key={examConfig.id} value={examConfig.id}>
                        {examConfig.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="two-columns">
                  <label>
                    Codigo local
                    <input value={mapping.examModelCode} readOnly />
                  </label>
                  <label>
                    Exame local atual
                    <input value={mapping.examModelName} readOnly />
                  </label>
                </div>

                <div className="two-columns">
                  <label className="checkbox-row checkbox-row-compact">
                    <input name="active" type="checkbox" defaultChecked={mapping.active} />
                    Mapeamento ativo
                  </label>
                  <div className="integration-link-card">
                    <span className="integration-link-label">Fluxo da importacao</span>
                    <strong>{mapping.shospExamName}</strong>
                    <span className="integration-link-arrow">→</span>
                    <strong>{mapping.examModelName}</strong>
                  </div>
                </div>

                <label>
                  Observacoes do mapeamento
                  <textarea name="notes" rows={3} defaultValue={mapping.notes || ""} />
                </label>

                <button className="secondary-button" type="submit" disabled={savingKey === `shosp-mapping-${mapping.id}`}>
                  {savingKey === `shosp-mapping-${mapping.id}` ? "Salvando..." : "Salvar mapeamento"}
                </button>
              </form>
            )) : <p className="empty-state">Nenhum mapeamento encontrado com esse filtro.</p>}
          </div>
        </article>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}
