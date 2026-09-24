import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { PageSkeleton } from "../components/PageSkeleton";
import type { MessageRecord, MessagingItem } from "../types";
import { getWhatsAppUrl } from "../utils/phone";

type FilterValue = "todos" | "precisa_contato" | "hoje" | "atrasadas" | "respondidas" | "sem_resposta";
type PriorityFilterValue = "todas" | "alta" | "media" | "baixa";
type MessageTypeFilterValue = "todos" | "atraso" | "janela_ideal" | "janela_proxima" | "acompanhamento";

const STATUS_TABS: Array<{ value: FilterValue; label: string }> = [
  { value: "todos", label: "Todas" },
  { value: "precisa_contato", label: "Precisa de contato" },
  { value: "hoje", label: "Prioridade de hoje" },
  { value: "atrasadas", label: "Em atraso" },
  { value: "respondidas", label: "Com resposta" },
  { value: "sem_resposta", label: "Sem resposta" }
];

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

function getMessageTypeBadgeClass(type?: string) {
  if (type === "atraso") return "badge-priority-red";
  if (type === "janela_ideal") return "badge-priority-yellow";
  if (type === "janela_proxima") return "badge-priority-blue";
  return "badge-priority-green";
}

function normalizeBadgeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value: unknown) {
  return String(value || "");
}

function sanitizeSuggestedMessage(message: string) {
  return String(message || "")
    .replace(/\n{2}(Observacao da equipe:|Contexto atual:)[\s\S]*$/i, "")
    .trim();
}

function isOperationallyScheduled(item: MessagingItem) {
  if (item.kind === "vacina") {
    return false;
  }
  return item.stage === "agendada" || item.nextExam?.status === "agendado" || Boolean(item.nextExam?.scheduledDate);
}

export function ContactCenterPage() {
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
  const [examFilter, setExamFilter] = useState("");
  const [actingKey, setActingKey] = useState<string | null>(null);

  useEffect(() => {
    void loadContactQueue();
  }, []);

  async function loadContactQueue() {
    setLoading(true);
    try {
      const response = await api.getMessagingItems();
      const visibleItems = response.items
        .filter((item) => !isOperationallyScheduled(item))
        .map((item) => ({
          ...item,
          suggestedMessage: sanitizeSuggestedMessage(item.suggestedMessage)
        }));
      setItems(visibleItems);
      setDrafts((current) => ({
        ...visibleItems.reduce<Record<number, string>>((accumulator, item) => {
          accumulator[item.patientId] = sanitizeSuggestedMessage(current[item.patientId] ?? item.suggestedMessage);
          return accumulator;
        }, {})
      }));
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a central de contatos.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSend(item: MessagingItem) {
    const content = sanitizeSuggestedMessage(drafts[item.patientId] || item.suggestedMessage);
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
      await loadContactQueue();
      setFeedbackType("success");
      setFeedback(
        action === "contacted"
          ? `Contato registrado para ${item.patientName}.`
          : action === "snooze"
            ? `Lembrete de ${item.patientName} adiado para o proximo dia.`
            : `Agendamento confirmado para ${item.patientName}.`
      );
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a lista operacional.");
    } finally {
      setActingKey(null);
    }
  }

  async function handleVaccineAction(item: MessagingItem, vaccineCode: string, status: "tomada" | "nao_se_aplica") {
    const key = `${item.patientId}-vacina-${vaccineCode}-${status}`;
    setActingKey(key);
    setFeedback("");

    try {
      await api.updatePatientVaccineStatus(item.patientId, vaccineCode, status);
      await loadContactQueue();
      setFeedbackType("success");
      setFeedback(
        status === "tomada"
          ? `Vacina marcada como tomada para ${item.patientName}.`
          : `Vacina marcada como nao aplicavel para ${item.patientName}.`
      );
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.");
    } finally {
      setActingKey(null);
    }
  }

  async function handleCopyMessage(item: MessagingItem) {
    const content = sanitizeSuggestedMessage(drafts[item.patientId] || item.suggestedMessage);
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
  const examOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      const code = item.nextExam?.code || item.nextExam?.name;
      if (code) {
        map.set(code, item.nextExam?.name || code);
      }
    });
    return [...map.entries()].sort((a, b) => safeText(a[1]).localeCompare(safeText(b[1]), "pt-BR"));
  }, [items]);

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

      if (examFilter && (item.nextExam?.code || item.nextExam?.name) !== examFilter) {
        return false;
      }

      if (filter === "todos") return true;
      if (filter === "precisa_contato") return !item.latestMessage;
      if (filter === "hoje") return item.nextExam.alertLevel === "hoje";
      if (filter === "atrasadas") return item.nextExam.alertLevel === "urgente";
      if (filter === "respondidas") return item.latestMessage?.responseStatus === "respondida";
      return item.latestMessage?.responseStatus === "sem_resposta";
    });
  }, [examFilter, filter, items, messageTypeFilter, physicianFilter, priorityFilter, search, unitFilter]);

  const pendingContactCount = useMemo(() => items.filter((item) => !item.latestMessage).length, [items]);

  function clearAllFilters() {
    setSearch("");
    setFilter("todos");
    setPriorityFilter("todas");
    setMessageTypeFilter("todos");
    setUnitFilter("");
    setPhysicianFilter("");
    setExamFilter("");
  }

  if (loading) {
    return <PageSkeleton cards={4} />;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Atendimento</p>
          <h2>Central de contatos</h2>
          <p className="page-description">
            Fila unica para triagem, envio e acompanhamento de resposta das pacientes que precisam de contato.
            {pendingContactCount > 0 ? ` ${pendingContactCount} paciente(s) ainda sem nenhuma mensagem enviada.` : ""}
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
            Motivo do contato
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

        <div className="operational-filter-grid operational-filter-grid-three">
          <label>
            Exame
            <select value={examFilter} onChange={(event) => setExamFilter(event.target.value)}>
              <option value="">Todos</option>
              {examOptions.map(([code, name]) => (
                <option key={safeText(code)} value={safeText(code)}>{safeText(name)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="message-filter-bar">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={filter === tab.value ? "menu-link active" : "menu-link"}
              type="button"
              onClick={() => setFilter(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="inline-actions">
          <button className="secondary-button" type="button" onClick={clearAllFilters}>
            Limpar filtros
          </button>
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
          const draftMessage = sanitizeSuggestedMessage(drafts[item.patientId] || item.suggestedMessage);
          const whatsappUrl = getWhatsAppUrl(item.phone, encodeURIComponent(draftMessage));
          const primaryStatusLabel =
            item.messageType === "atraso"
              ? "Exame em atraso"
              : item.messageTypeLabel || item.reminderLabel || "Mensagem sugerida";
          const normalizedPrimaryStatus = normalizeBadgeText(primaryStatusLabel);
          const normalizedPriorityLabel = normalizeBadgeText(item.priorityLabel);
          const normalizedReminderLabel = normalizeBadgeText(item.reminderLabel);
          const isOverdueCard = item.messageType === "atraso";
          const showPriorityBadge = !isOverdueCard && Boolean(item.priorityLabel);
          const showReminderBadge =
            Boolean(item.reminderLabel) &&
            !isOverdueCard &&
            normalizedReminderLabel !== normalizedPrimaryStatus &&
            normalizedReminderLabel !== normalizedPriorityLabel &&
            normalizedReminderLabel !== "alta prioridade" &&
            normalizedReminderLabel !== "media prioridade" &&
            normalizedReminderLabel !== "baixa prioridade";
          const hasMessage = Boolean(item.latestMessage);

          return (
            <article
              key={item.patientId}
              className={`panel-card message-card operational-card ${item.priorityLevel === "alta" ? "operational-priority-high" : ""}`}
            >
              <div className="card-row">
                <div>
                  <h3>{item.patientName}</h3>
                  <p>{item.gestationalAgeLabel}</p>
                </div>
                <div className="card-row-badges">
                  {item.kind === "vacina" ? (
                    <span className="badge badge-soft badge-priority-blue">Vacina</span>
                  ) : null}
                  <span className={`badge ${getMessageTypeBadgeClass(item.messageType)}`}>{primaryStatusLabel}</span>
                  <span className={`badge badge-soft ${hasMessage ? "badge-priority-blue" : "badge-priority-orange"}`}>
                    {hasMessage ? "Mensagem enviada" : "Nunca contatada"}
                  </span>
                </div>
              </div>

              <div className="priority-badge-row">
                {showPriorityBadge ? (
                  <span className={`badge badge-soft ${getOperationalPriorityBadgeClass(item.priorityLevel)}`}>
                    {item.priorityLabel || "Prioridade operacional"}
                  </span>
                ) : null}
                {showReminderBadge ? (
                  <span className="badge badge-soft badge-priority-blue">{item.reminderLabel}</span>
                ) : null}
              </div>

              <div className="message-metadata">
                <span><strong>Telefone:</strong> {item.phone || "Nao informado"}</span>
                {item.kind === "vacina" ? null : (
                  <>
                    <span><strong>Proximo exame:</strong> {item.nextExam.name}</span>
                    <span><strong>Previsao:</strong> {item.nextExam.dateLabel}</span>
                  </>
                )}
                {item.pendingVaccines?.length ? (
                  <span><strong>Vacinas pendentes:</strong> {item.pendingVaccines.map((vaccine) => vaccine.name).join(", ")}</span>
                ) : null}
                <span><strong>Motivo da mensagem:</strong> {item.messageOriginLabel || "Acompanhamento da jornada"}</span>
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
                <textarea
                  rows={4}
                  value={draftMessage}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [item.patientId]: sanitizeSuggestedMessage(event.target.value) }))
                  }
                />
              </label>

              <div className="message-actions list-action-bar operational-action-bar">
                <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">
                  Abrir conversa no WhatsApp
                </a>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={item.gestationalMessagingAlertLevel === "blocked"}
                  onClick={() => void handleRegisterSend(item)}
                >
                  Registrar envio
                </button>
                <Link className="secondary-button" to={`/pacientes/${item.patientId}`}>
                  Ver detalhes
                </Link>
              </div>

              <details className="action-menu">
                <summary className="secondary-button action-menu-trigger">Mais acoes</summary>
                <div className="action-menu-panel">
                  <button className="secondary-button" type="button" onClick={() => void handleCopyMessage(item)}>
                    Copiar mensagem
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
                    {actingKey === `${item.patientId}-${item.examPatientId}-scheduled` ? "Salvando..." : "Confirmar agendamento"}
                  </button>
                  {item.pendingVaccines?.map((vaccine) => (
                    <div key={vaccine.code} className="action-menu-vaccine-group">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={actingKey === `${item.patientId}-vacina-${vaccine.code}-tomada`}
                        onClick={() => void handleVaccineAction(item, vaccine.code, "tomada")}
                      >
                        {actingKey === `${item.patientId}-vacina-${vaccine.code}-tomada`
                          ? "Salvando..."
                          : `Marcar tomada: ${vaccine.name}`}
                      </button>
                      {vaccine.actionable ? (
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={actingKey === `${item.patientId}-vacina-${vaccine.code}-nao_se_aplica`}
                          onClick={() => void handleVaccineAction(item, vaccine.code, "nao_se_aplica")}
                        >
                          {actingKey === `${item.patientId}-vacina-${vaccine.code}-nao_se_aplica`
                            ? "Salvando..."
                            : `Nao se aplica: ${vaccine.name}`}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {hasMessage ? (
                    <>
                      <button className="secondary-button" type="button" onClick={() => void handleUpdateResponse(item, "respondida")}>
                        Registrar resposta
                      </button>
                      <button className="secondary-button" type="button" onClick={() => void handleUpdateResponse(item, "sem_resposta")}>
                        Registrar sem resposta
                      </button>
                    </>
                  ) : null}
                </div>
              </details>

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
                  <p className="empty-state">Nenhuma mensagem registrada para esta paciente ainda.</p>
                )}
              </div>
            </article>
          );
        }) : (
          <div className="stack-form">
            <p className="empty-state">
              Nenhuma paciente encontrada com os filtros atuais.
            </p>
            {(search || filter !== "todos" || priorityFilter !== "todas" || messageTypeFilter !== "todos" || unitFilter || physicianFilter || examFilter) ? (
              <button className="secondary-button" type="button" onClick={clearAllFilters}>
                Limpar filtros e ver lista completa
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
