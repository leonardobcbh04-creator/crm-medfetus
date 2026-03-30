import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { MessageRecord, MessagingItem } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";
import { getWhatsAppUrl } from "../utils/phone";

type FilterValue = "todos" | "hoje" | "atrasadas" | "respondidas" | "sem_resposta";

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

export function MessagesPage() {
  const [items, setItems] = useState<MessagingItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterValue>("todos");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getMessagingItems()
      .then((response) => {
        setItems(response.items);
        setDrafts(
          response.items.reduce<Record<number, string>>((accumulator, item) => {
            accumulator[item.patientId] = item.suggestedMessage;
            return accumulator;
          }, {})
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleRegisterSend(item: MessagingItem) {
    const content = drafts[item.patientId] || item.suggestedMessage;
    try {
      const response = await api.createMessage({
        patientId: item.patientId,
        examModelId: item.examModelId,
        content
      });

      syncPatientMessage(item.patientId, response.message);
      setFeedback(`Mensagem registrada para ${item.patientName}.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel registrar a mensagem.");
    }
  }

  async function handleUpdateResponse(item: MessagingItem, responseStatus: "respondida" | "sem_resposta") {
    if (!item.latestMessage) {
      return;
    }

    const response = await api.updateMessage(item.latestMessage.id, {
      responseStatus,
      responseText: responseStatus === "respondida" ? "Paciente respondeu pelo WhatsApp." : null
    });

    syncPatientMessage(item.patientId, response.message);
    setFeedback(`Status da mensagem atualizado para ${item.patientName}.`);
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

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        `${item.patientName} ${item.phone} ${item.nextExam.name}`.toLowerCase().includes(normalizedSearch);

      if (!matchesSearch) {
        return false;
      }

      if (filter === "todos") return true;
      if (filter === "hoje") return item.nextExam.alertLevel === "hoje";
      if (filter === "atrasadas") return item.nextExam.alertLevel === "urgente";
      if (filter === "respondidas") return item.latestMessage?.responseStatus === "respondida";
      return item.latestMessage?.responseStatus === "sem_resposta";
    });
  }, [filter, items, search]);

  if (loading) {
    return <p className="loading-text">Carregando mensagens automaticas...</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Comunicacao</p>
          <h2>Mensagens automaticas por paciente</h2>
          <p className="page-description">
            Filtre os acompanhamentos, revise a mensagem sugerida e mantenha o historico completo de cada paciente.
          </p>
        </div>
      </div>

      <div className="toolbar-row">
        <input
          type="search"
          placeholder="Buscar por nome, telefone ou exame"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="message-filter-bar">
        <button className={filter === "todos" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("todos")}>Todos</button>
        <button className={filter === "hoje" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("hoje")}>Hoje</button>
        <button className={filter === "atrasadas" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("atrasadas")}>Atrasadas</button>
        <button className={filter === "respondidas" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("respondidas")}>Respondidas</button>
        <button className={filter === "sem_resposta" ? "menu-link active" : "menu-link"} type="button" onClick={() => setFilter("sem_resposta")}>Sem resposta</button>
      </div>

      {feedback ? <p className={feedback.includes("Nao foi") || feedback.includes("baixa confianca") ? "form-error" : "form-success"}>{feedback}</p> : null}

      <div className="messages-grid">
        {filteredItems.map((item) => {
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
              className={`panel-card message-card ${priority.cardClassName} ${priority.needsImmediateAction ? "patient-card-immediate" : ""}`}
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
                <span className={`badge badge-soft ${getOperationalPriorityBadgeClass(item.priorityLevel)}`}>{item.priorityLabel || "Prioridade operacional"}</span>
                <span className={`badge badge-soft ${priority.badgeClassName}`}>{item.reminderLabel}</span>
                <span className="badge badge-soft badge-priority-blue">{item.messageTypeLabel || "Mensagem operacional"}</span>
                {priority.needsImmediateAction ? <span className="badge badge-attention">Acao imediata</span> : null}
              </div>

              <div className="message-metadata">
                <span><strong>Proximo exame:</strong> {item.nextExam.name}</span>
                <span><strong>Previsao:</strong> {item.nextExam.dateLabel}</span>
                <span><strong>Origem da mensagem:</strong> {item.messageOriginLabel || "Timeline operacional"}</span>
                <span><strong>Base do proximo exame:</strong> {item.gestationalBaseSourceLabel}</span>
                <span><strong>Confianca:</strong> {item.gestationalBaseConfidenceLabel}</span>
                <span><strong>Medico:</strong> {item.physicianName || "Nao informado"}</span>
                <span><strong>Unidade:</strong> {item.clinicUnit || "Nao informada"}</span>
                {item.nextExam.overdueExam ? (
                  <span className="exam-warning-text"><strong>Exame atrasado:</strong> {item.nextExam.overdueExam.name}</span>
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

              <div className="message-actions list-action-bar">
                <a className="whatsapp-link" href={whatsappUrl} target="_blank" rel="noreferrer">
                  Abrir WhatsApp
                </a>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={item.gestationalMessagingAlertLevel === "blocked"}
                  onClick={() => handleRegisterSend(item)}
                >
                  Registrar envio
                </button>
                <button className="secondary-button" type="button" onClick={() => handleUpdateResponse(item, "respondida")}>
                  Marcar respondida
                </button>
                <button className="secondary-button" type="button" onClick={() => handleUpdateResponse(item, "sem_resposta")}>
                  Marcar sem resposta
                </button>
                <Link className="secondary-button" to={`/pacientes/${item.patientId}`}>
                  Ver detalhes
                </Link>
              </div>

              <div className="message-history-box">
                <p className="muted-label">Historico completo</p>
                {item.messageHistory.length ? (
                  <div className="message-history-list">
                    {item.messageHistory.map((history) => (
                      <div key={history.id} className="message-history-item">
                        <span><strong>Envio:</strong> {history.deliveryStatus}</span>
                        <span><strong>Resposta:</strong> {history.responseStatus}</span>
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
        })}
      </div>
    </section>
  );
}
