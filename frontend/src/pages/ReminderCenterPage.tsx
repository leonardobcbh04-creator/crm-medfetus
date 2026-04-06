import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { ReminderCenterData } from "../types";
import { formatBrazilPhone } from "../utils/phone";

type ReminderFilters = {
  clinicUnit: string;
  physicianName: string;
  examCode: string;
};

type PriorityFilterValue = "todas" | "alta" | "media" | "baixa";
type MessageTypeFilterValue = "todos" | "atraso" | "janela_ideal" | "janela_proxima" | "acompanhamento";

const DEFAULT_FILTERS: ReminderFilters = {
  clinicUnit: "",
  physicianName: "",
  examCode: ""
};

function getUrgencyBadgeClass(status: string) {
  if (status === "atrasado") return "badge-priority-red";
  if (status === "pendente") return "badge-priority-orange";
  if (status === "aproximando") return "badge-priority-yellow";
  return "badge-priority-green";
}

function getGestationalAlertClass(level: "ok" | "warning" | "blocked") {
  if (level === "blocked") return "form-alert form-alert-error";
  if (level === "warning") return "form-alert form-alert-warning";
  return "form-alert form-alert-success";
}

function getOperationalPriorityBadgeClass(level?: "alta" | "media" | "baixa") {
  if (level === "alta") return "badge-priority-red";
  if (level === "media") return "badge-priority-yellow";
  return "badge-priority-green";
}

export function ReminderCenterPage() {
  const [data, setData] = useState<ReminderCenterData | null>(null);
  const [filters, setFilters] = useState<ReminderFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilterValue>("todas");
  const [messageTypeFilter, setMessageTypeFilter] = useState<MessageTypeFilterValue>("todos");

  useEffect(() => {
    void loadReminders(DEFAULT_FILTERS);
  }, []);

  async function loadReminders(nextFilters: ReminderFilters) {
    setLoading(true);
    try {
      const response = await api.getReminders(nextFilters);
      setData(response);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a central de lembretes.");
    } finally {
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof ReminderFilters>(field: K, value: ReminderFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  async function handleAction(patientId: number, examPatientId: number | null, action: "contacted" | "snooze" | "scheduled") {
    if (!examPatientId) {
      return;
    }

    const key = `${patientId}-${examPatientId}-${action}`;
    setActingKey(key);
    setFeedback("");

    try {
      await api.updateReminder(patientId, examPatientId, action);
      if (action === "scheduled") {
        setData((current) =>
          current
            ? {
                ...current,
                items: current.items.filter((item) => !(item.patientId === patientId && item.examPatientId === examPatientId))
              }
            : current
        );
      }
      await loadReminders(filters);
      setFeedback(
        action === "contacted"
          ? "Contato registrado com sucesso."
          : action === "snooze"
            ? "Lembrete adiado para o proximo dia."
            : "Agendamento registrado com sucesso."
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar o lembrete.");
    } finally {
      setActingKey(null);
    }
  }

  async function handleCopyMessage(message: string, patientName: string) {
    try {
      await navigator.clipboard.writeText(message);
      setFeedback(`Mensagem de ${patientName} copiada.`);
    } catch {
      setFeedback("Nao foi possivel copiar a mensagem.");
    }
  }

  const filteredItems = useMemo(() => {
    if (!data) {
      return [];
    }

    const normalizedSearch = search.trim().toLowerCase();

    return data.items.filter((item) => {
      if (
        normalizedSearch &&
        !`${item.patientName} ${item.phone} ${item.examName}`.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }

      if (priorityFilter !== "todas" && item.priorityLevel !== priorityFilter) {
        return false;
      }

      if (messageTypeFilter !== "todos" && item.messageType !== messageTypeFilter) {
        return false;
      }

      return true;
    });
  }, [data, messageTypeFilter, priorityFilter, search]);

  if (loading && !data) {
    return <p className="loading-text">Carregando central de lembretes...</p>;
  }

  if (!data) {
    return <p className="loading-text">Nao foi possivel carregar a central de lembretes.</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h2>Central de lembretes</h2>
          <p className="page-description">
            Pacientes que precisam de contato hoje, organizadas por prioridade.
          </p>
        </div>
      </div>

      <article className="panel-card stack-form filter-panel operational-filter-panel">
        <div className="operational-filter-grid operational-filter-grid-five">
          <label>
            Buscar paciente
            <input
              type="search"
              placeholder="Nome, telefone ou exame"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label>
            Prioridade
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilterValue)}>
              <option value="todas">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baixa">Baixa</option>
            </select>
          </label>

          <label>
            Tipo
            <select value={messageTypeFilter} onChange={(event) => setMessageTypeFilter(event.target.value as MessageTypeFilterValue)}>
              <option value="todos">Todos</option>
              <option value="atraso">Atraso</option>
              <option value="janela_ideal">Janela ideal</option>
              <option value="janela_proxima">Janela proxima</option>
              <option value="acompanhamento">Acompanhamento</option>
            </select>
          </label>

          <label>
            Unidade
            <select value={filters.clinicUnit} onChange={(event) => updateFilter("clinicUnit", event.target.value)}>
              <option value="">Todas</option>
              {data.filterOptions.clinicUnits.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </label>

          <label>
            Medico
            <select value={filters.physicianName} onChange={(event) => updateFilter("physicianName", event.target.value)}>
              <option value="">Todos</option>
              {data.filterOptions.physicians.map((physician) => (
                <option key={physician} value={physician}>{physician}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="operational-filter-grid operational-filter-grid-three">
          <label>
            Exame
            <select value={filters.examCode} onChange={(event) => updateFilter("examCode", event.target.value)}>
              <option value="">Todos</option>
              {data.filterOptions.exams.map((exam) => (
                <option key={exam.code} value={exam.code}>{exam.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="inline-actions">
          <button className="primary-button" type="button" onClick={() => void loadReminders(filters)}>
            Aplicar filtros
          </button>
          <button className="secondary-button" type="button" onClick={() => {
            setFilters(DEFAULT_FILTERS);
            setSearch("");
            setPriorityFilter("todas");
            setMessageTypeFilter("todos");
            void loadReminders(DEFAULT_FILTERS);
          }}>
            Limpar filtros
          </button>
        </div>
      </article>

      {feedback ? <p className={feedback.includes("Nao foi") ? "form-error" : "form-success"}>{feedback}</p> : null}

      <div className="reminder-grid">
        {filteredItems.length ? filteredItems.map((item) => (
          <article key={`${item.patientId}-${item.examPatientId}`} className={`panel-card reminder-card operational-card ${item.priorityLevel === "alta" ? "operational-priority-high" : ""} reminder-${item.urgencyStatus}`}>
            <div className="card-row">
              <div>
                <h3>{item.patientName}</h3>
                <p>{item.gestationalAgeLabel}</p>
              </div>
              <span className={`badge ${getUrgencyBadgeClass(item.urgencyStatus)}`}>{item.urgencyLabel}</span>
            </div>

            <div className="priority-badge-row">
              <span className={`badge badge-soft ${getOperationalPriorityBadgeClass(item.priorityLevel)}`}>{item.priorityLabel || "Prioridade operacional"}</span>
              <span className="badge badge-soft badge-priority-blue">{item.messageTypeLabel || "Mensagem operacional"}</span>
            </div>

            <div className="message-metadata">
              <span><strong>Telefone:</strong> {formatBrazilPhone(item.phone) || "Nao informado"}</span>
              <span><strong>Exame previsto:</strong> {item.examName}</span>
              <span><strong>Inicio da janela ideal:</strong> {item.idealWindowStartDateLabel || "Nao definido"}</span>
              <span><strong>Motivo do contato:</strong> {item.messageOriginLabel || "Acompanhamento da jornada"}</span>
              <span><strong>Base do calculo:</strong> {item.gestationalBaseSourceLabel}</span>
              <span><strong>Confiabilidade:</strong> {item.gestationalBaseConfidenceLabel}</span>
              <span><strong>Medico:</strong> {item.physicianName || "Nao informado"}</span>
              <span><strong>Unidade:</strong> {item.clinicUnit || "Nao informada"}</span>
            </div>

            {item.gestationalBaseIsEstimated || item.gestationalMessagingAlertLevel !== "ok" ? (
              <div className={getGestationalAlertClass(item.gestationalMessagingAlertLevel)}>
                <strong>
                  {item.gestationalMessagingAlertLevel === "warning" ? "Base estimada" : "Base gestacional"}
                </strong>
                <span>
                  {item.gestationalMessagingAlertMessage ||
                    `Proximo exame definido a partir de ${item.gestationalBaseSourceLabel}.`}
                </span>
              </div>
            ) : null}

            <label>
              Mensagem sugerida
              <textarea rows={4} value={item.suggestedMessage} readOnly />
            </label>

            <div className="inline-actions list-action-bar operational-action-bar">
              <button className="secondary-button" type="button" onClick={() => void handleCopyMessage(item.suggestedMessage, item.patientName)}>
                Copiar mensagem
              </button>
              <a href={item.whatsappUrl} target="_blank" rel="noreferrer" className="whatsapp-link">
                Abrir WhatsApp
              </a>
              <button
                className="secondary-button"
                type="button"
                disabled={actingKey === `${item.patientId}-${item.examPatientId}-contacted`}
                onClick={() => void handleAction(item.patientId, item.examPatientId, "contacted")}
              >
                {actingKey === `${item.patientId}-${item.examPatientId}-contacted` ? "Salvando..." : "Registrar contato"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={actingKey === `${item.patientId}-${item.examPatientId}-snooze`}
                onClick={() => void handleAction(item.patientId, item.examPatientId, "snooze")}
              >
                {actingKey === `${item.patientId}-${item.examPatientId}-snooze` ? "Salvando..." : "Adiar lembrete"}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={actingKey === `${item.patientId}-${item.examPatientId}-scheduled`}
                onClick={() => void handleAction(item.patientId, item.examPatientId, "scheduled")}
              >
                {actingKey === `${item.patientId}-${item.examPatientId}-scheduled` ? "Salvando..." : "Registrar agendamento"}
              </button>
              <Link className="secondary-button" to={`/pacientes/${item.patientId}`}>
                Ver detalhes
              </Link>
            </div>
          </article>
        )) : <p className="empty-state">Nenhuma paciente precisa de contato com os filtros atuais.</p>}
      </div>
    </section>
  );
}
