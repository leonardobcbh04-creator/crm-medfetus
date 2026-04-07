import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { MessageRecord, MessagingItem } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";
import { getWhatsAppUrl } from "../utils/phone";

type FilterValue = "todos" | "hoje" | "atrasadas" | "respondidas" | "sem_resposta";
type PriorityFilterValue = "todas" | "alta" | "media" | "baixa";
type MessageTypeFilterValue = "todos" | "atraso" | "janela_ideal" | "janela_proxima" | "acompanhamento";

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

function safeText(value: unknown) {
  return String(value || "");
}

function isOperationallyScheduled(item: MessagingItem) {
  return item.stage === "agendada" || item.nextExam?.status === "agendado" || Boolean(item.nextExam?.scheduledDate);
}

export function MessagesPage() {
  const [items, setItems] = useState<MessagingItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterValue>("todos");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilterValue>("todas");
  const [messageTypeFilter, setMessageTypeFilter] = useState<MessageTypeFilterValue>("todos");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");
  const [actingKey, setActingKey] = useState<string | null>(null);

  useEffect(() => {
    void loadMessagingItems();
  }, []);

  async function loadMessagingItems() {
    setLoading(true);
    try {
      const response = await api.getMessagingItems();
      const visibleItems = response.items.filter((item) => !isOperationallyScheduled(item));
      setItems(visibleItems);
      setDrafts((current) => ({
        ...visibleItems.reduce<Record<number, string>>((accumulator, item) => {
          accumulator[item.patientId] = current[item.patientId] ?? item.suggestedMessage;
          return accumulator;
        }, {})
      }));
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a fila de mensagens.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSend(item: MessagingItem) {
    const content = drafts[item.patientId] || item.suggestedMessage;
    try {
      const response = await api.createMessage({
        patientId: item.patientId,
        examModelId: item.examModelId,
        content
      });

      syncPatientMessage(item.patientId, response.message);
      setFeedbackType("success");
      setFeedback(`Mensagem registrada para ${item.patientName}.`);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel registrar a mensagem.");
    }
  }

  async function handleUpdateResponse(item: MessagingItem, responseStatus: "respondida" | "sem_resposta") {
    if (!item.latestMessage) {
      return;
    }

    try {
      const response = await api.updateMessage(item.latestMessage.id, {
        responseStatus,
        responseText: responseStatus === "respondida" ? "Paciente respondeu pelo WhatsApp." : null
      });

      syncPatientMessage(item.patientId, response.message);
      setFeedbackType("success");
      setFeedback(`Status da mensagem atualizado para ${item.patientName}.`);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a mensagem.");
    }
  }

  async function handleReminderAction(item: MessagingItem, action: "contacted" | "snooze" | "scheduled") {
    if (!item.examPatientId) {
      return;
    }

    if (action === "scheduled") {
      const confirmed = window.confirm("Confirmar que esta paciente ja esta com exame agendado? Ela saira da lista operacional.");
      if (!confirmed) {
        return;
      }
    }

    const key = `${item.patientId}-${item.examPatientId}-${action}`;
    setActingKey(key);
    setFeedback("");

    try {
      await api.updateReminder(item.patientId, item.examPatientId, action);
      if (action === "scheduled") {
        setItems((current) => current.filter((currentItem) => currentItem.patientId !== item.patientId));
      }
      await loadMessagingItems();
      setFeedbackType("success");
      setFeedback(
        action === "contacted"
          ? `Contato registrado para ${item.patientName}.`
          : action === "snooze"
            ? `Lembrete de ${item.patientName} adiado para o proximo dia.`
            : `Agendamento registrado para ${item.patientName}.`
      );
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a fila operacional.");
    } finally {
      setActingKey(null);
    }
  }

  async function handleCopyMessage(item: MessagingItem) {
    const content = drafts[item.patientId] || item.suggestedMessage;
    try {
      await navigator.clipboard.writeText(content);
      setFeedbackType("success");
      setFeedback(`Mensagem de ${item.patientName} copiada.`);
    } catch {
      setFeedbackType("error");
      setFeedback("Nao foi possivel copiar a mensagem.");
    }
  }

  function syncPatientMessage(patientId: number, message: MessageRecord) {
    setItems((current) =>
      current.map((item) =>
        item.patientId === patientId
          ? {
              ...item,
              latestMessage: message,
              messageHistory: [message, ...item.messageHistory.filter((history) => history.id !== message.id)]
            }
          : item
      )
    );
  }

  const unitOptions = useMemo(
    () => [...new Set(items.map((item) => item.clinicUnit).filter(Boolean))].sort((a, b) => safeText(a).localeCompare(safeText(b), "pt-BR")),
    [items]
  );
  const physicianOptions = useMemo(
    () => [...new Set(items.map((item) => item.physicianName).filter(Boolean))].sort((a, b) => safeText(a).localeCompare(safeText(b), "pt-BR")),
    [items]
  );

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        `${safeText(item.patientName)} ${safeText(item.phone)} ${safeText(item.nextExam?.name)}`.toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (priorityFilter !== "todas" && item.priorityLevel !== priorityFilter) {
        return false;
      }

      if (messageTypeFilter !== "todos" && item.messageType !== messageTypeFilter) {
        return false;
      }

      if (unitFilter && item.clinicUnit !== unitFilter) {
        return false;
      }

      if (physicianFilter && item.physicianName !== physicianFilter) {
        return false;
      }

      if (filter === "todos") return true;
      if (filter === "hoje") return item.nextExam.alertLevel === "hoje";
      if (filter === "atrasadas") return item.nextExam.alertLevel === "urgente";
      if (filter === "respondidas") return item.latestMessage?.responseStatus === "respondida";
      return item.latestMessage?.responseStatus === "sem_resposta";
    });
  }, [filter, items, messageTypeFilter, physicianFilter, priorityFilter, search, unitFilter]);

  if (loading) {
    return <p className="loading-text">Carregando mensagens automaticas...</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Comunicacao</p>
          <h2>Mensagens automaticas</h2>
          <p className="page-description">
            Revise a mensagem sugerida e conduza os contatos do dia com mais agilidade.
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
            <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
              <option value="">Todas</option>
              {unitOptions.map((unit) => (
                <option key={safeText(unit)} value={safeText(unit)}>{safeText(unit)}</option>
              ))}
            </select>
          </label>

          <label>
            Medico
            <select value={physicianFilter} onChange={(event) => setPhysicianFilter(event.target.value)}>
              <option value="">Todos</option>
              {physicianOptions.map((physician) => (
                <option key={safeText(physician)} value={safeText(physician)}>{safeText(physician)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="message-filter-bar">
          <button className={filter === "todos" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("todos")}>Todos</button>
          <button className={filter === "hoje" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("hoje")}>Hoje</button>
          <button className={filter === "atrasadas" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("atrasadas")}>Em atraso</button>
          <button className={filter === "respondidas" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("respondidas")}>Respondidas</button>
          <button className={filter === "sem_resposta" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("sem_resposta")}>Sem resposta</button>
        </div>
      </article>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <strong>{feedbackType === "error" ? "Atencao" : "Sucesso"}</strong>
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="messages-grid">
        {filteredItems.length ? filteredItems.map((item) => {
          const draftMessage = drafts[item.patientId] || item.suggestedMessage;
          const whatsappUrl = getWhatsAppUrl(item.phone, encodeURIComponent(draftMessage));
          const priority = getPatientPriorityMeta({
            id: item.patientId,
            name: item.patientName,
            phone: item.phone,
            dum: null,
            gestationalWeeks: null,
            gestationalDays: null,
            stage: item.stage,
            notes: "",
            createdAt: "",
            updatedAt: "",
            gestationalAgeLabel: item.gestationalAgeLabel,
            estimatedDueDate: "",
            nextExam: item.nextExam
          });

          return (
            <article
              key={item.patientId}
              className={`panel-card message-card operational-card ${item.priorityLevel === "alta" ? "operational-priority-high" : ""} ${priority.cardClassName} ${priority.needsImmediateAction ? "patient-card-immediate" : ""}`}
            >
              <div className="card-row">
                <div>
                  <h3>{item.patientName}</h3>
                  <p>{item.gestationalAgeLabel}</p>
                </div>
                <span className={`badge ${priority.badgeClassName}`}>{priority.label}</span>
              </div>

              <div className="priority-badge-row">
                <span className={`badge badge-soft ${priority.badgeClassName}`}>{priority.badgeText}</span>
                <span className={`badge badge-soft ${getOperationalPriorityBadgeClass(item.priorityLevel)}`}>{item.priorityLabel || "Prioridade do contato"}</span>
                <span className={`badge badge-soft ${priority.badgeClassName}`}>{item.reminderLabel}</span>
                <span className="badge badge-soft badge-priority-blue">{item.messageTypeLabel || "Mensagem sugerida"}</span>
                {priority.needsImmediateAction ? <span className="badge badge-attention">Prioridade imediata</span> : null}
              </div>

              <div className="message-metadata">
                <span><strong>Proximo exame:</strong> {item.nextExam.name}</span>
                <span><strong>Previsao:</strong> {item.nextExam.dateLabel}</span>
                <span><strong>Motivo da mensagem:</strong> {item.messageOriginLabel || "Acompanhamento da jornada"}</span>
                <span><strong>Base do calculo:</strong> {item.gestationalBaseSourceLabel}</span>
                <span><strong>Confiabilidade:</strong> {item.gestationalBaseConfidenceLabel}</span>
                <span><strong>Medico:</strong> {item.physicianName || "Nao informado"}</span>
                <span><strong>Unidade:</strong> {item.clinicUnit || "Nao informada"}</span>
                {item.nextExam.overdueExam ? (
                  <span className="exam-warning-text"><strong>Exame em atraso:</strong> {item.nextExam.overdueExam.name}</span>
                ) : null}
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
                <textarea
                  rows={4}
                  value={draftMessage}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [item.patientId]: event.target.value }))
                  }
                />
              </label>

              <div className="message-actions list-action-bar operational-action-bar">
                <button className="secondary-button" type="button" onClick={() => void handleCopyMessage(item)}>
                  Copiar mensagem
                </button>
                <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">
                  Abrir WhatsApp
                </a>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={item.gestationalMessagingAlertLevel === "blocked"}
                  onClick={() => void handleRegisterSend(item)}
                >
                  Registrar envio
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!item.examPatientId || actingKey === `${item.patientId}-${item.examPatientId}-contacted`}
                  onClick={() => void handleReminderAction(item, "contacted")}
                >
                  {actingKey === `${item.patientId}-${item.examPatientId}-contacted` ? "Salvando..." : "Registrar contato"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!item.examPatientId || actingKey === `${item.patientId}-${item.examPatientId}-snooze`}
                  onClick={() => void handleReminderAction(item, "snooze")}
                >
                  {actingKey === `${item.patientId}-${item.examPatientId}-snooze` ? "Salvando..." : "Adiar lembrete"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!item.examPatientId || actingKey === `${item.patientId}-${item.examPatientId}-scheduled`}
                  onClick={() => void handleReminderAction(item, "scheduled")}
                >
                  {actingKey === `${item.patientId}-${item.examPatientId}-scheduled` ? "Salvando..." : "Registrar agendamento"}
                </button>
                <button className="secondary-button" type="button" onClick={() => void handleUpdateResponse(item, "respondida")}>
                  Registrar resposta
                </button>
                <button className="secondary-button" type="button" onClick={() => void handleUpdateResponse(item, "sem_resposta")}>
                  Registrar sem resposta
                </button>
                <Link className="secondary-button" to={`/pacientes/${item.patientId}`}>
                  Ver detalhes
                </Link>
              </div>

              <div className="message-history-box">
                <p className="muted-label">Historico de mensagens</p>
                {item.messageHistory.length ? (
                  <div className="message-history-list">
                    {item.messageHistory.map((history) => (
                      <div key={history.id} className="message-history-item">
                        <span><strong>Envio:</strong> {history.deliveryStatus}</span>
                        <span><strong>Retorno:</strong> {history.responseStatus}</span>
                        <span><strong>Data:</strong> {history.sentAt || "Nao registrada"}</span>
                        <p>{history.content}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">Nenhuma mensagem registrada ainda.</p>
                )}
              </div>
            </article>
          );
        }) : (
          <div className="stack-form">
            <p className="empty-state">
              Nenhuma paciente encontrada com os filtros atuais.
            </p>
            {(search || filter !== "todos" || priorityFilter !== "todas" || messageTypeFilter !== "todos" || unitFilter || physicianFilter) ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilter("todos");
                  setPriorityFilter("todas");
                  setMessageTypeFilter("todos");
                  setUnitFilter("");
                  setPhysicianFilter("");
                }}
              >
                Limpar filtros e revisar lista completa
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
