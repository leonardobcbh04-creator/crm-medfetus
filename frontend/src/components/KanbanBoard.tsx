import { Link } from "react-router-dom";
import { useState } from "react";
import type { KanbanColumn } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";
import { getWhatsAppUrl } from "../utils/phone";

type KanbanBoardProps = {
  columns: KanbanColumn[];
  onMove: (patientId: number, fromStage: string, toStage: string) => void;
  onRenameColumn: (columnId: string, title: string) => Promise<void>;
  onDeleteColumn: (column: KanbanColumn) => Promise<void>;
  onRegisterMessage: (patientId: number) => Promise<void>;
};

function getDaysWithoutResponse(sentAt: string | null | undefined) {
  if (!sentAt) {
    return null;
  }

  const sentDate = new Date(sentAt);
  if (Number.isNaN(sentDate.getTime())) {
    return null;
  }

  const now = new Date();
  const sentUtc = Date.UTC(sentDate.getFullYear(), sentDate.getMonth(), sentDate.getDate());
  const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((nowUtc - sentUtc) / (1000 * 60 * 60 * 24)));
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-button-svg">
      <path
        fill="currentColor"
        d="M19.1 4.9A9.86 9.86 0 0 0 12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.4A10 10 0 1 0 19.1 4.9ZM12 20a8 8 0 0 1-4.1-1.1l-.3-.2-3.1.8.8-3-.2-.3A8 8 0 1 1 12 20Zm4.4-5.8c-.2-.1-1.3-.7-1.5-.7s-.3-.1-.5.1-.6.7-.7.8-.2.2-.4.1a6.48 6.48 0 0 1-1.9-1.2 7.24 7.24 0 0 1-1.3-1.7c-.1-.2 0-.3.1-.4l.3-.3c.1-.1.2-.2.2-.3.1-.1.1-.2 0-.4s-.5-1.3-.7-1.7-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3s-.8.8-.8 1.9.8 2.2.9 2.4a9.49 9.49 0 0 0 3.6 3.2c1.7.7 1.7.5 2 .5s1-.4 1.1-.7.1-.7.1-.7-.2 0-.4-.1Z"
      />
    </svg>
  );
}

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-button-svg">
      <path
        fill="currentColor"
        d="M3 6.8A1.8 1.8 0 0 1 4.8 5h14.4A1.8 1.8 0 0 1 21 6.8v10.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.2V6.8Zm1.9.2 7.1 5.1L19.1 7H4.9Zm14.2 2.3-6.6 4.7a.9.9 0 0 1-1 0L4.9 9.3v7.9h14.2V9.3Z"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-button-svg">
      <path
        fill="currentColor"
        d="M12 2.5A9.5 9.5 0 1 0 21.5 12 9.51 9.51 0 0 0 12 2.5Zm0 17A7.5 7.5 0 1 1 19.5 12 7.51 7.51 0 0 1 12 19.5Zm-1-11a1 1 0 1 1 1 1 1 1 0 0 1-1-1Zm2 8h-2v-5h2Z"
      />
    </svg>
  );
}

export function KanbanBoard({ columns, onMove, onRenameColumn, onDeleteColumn, onRegisterMessage }: KanbanBoardProps) {
  const [draggingPatientId, setDraggingPatientId] = useState<number | null>(null);
  const [draggingFromStage, setDraggingFromStage] = useState<string | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [sendingPatientId, setSendingPatientId] = useState<number | null>(null);
  const [confirmingPatientId, setConfirmingPatientId] = useState<number | null>(null);
  const [confirmingDeleteColumnId, setConfirmingDeleteColumnId] = useState<string | null>(null);

  function startEditingColumn(column: KanbanColumn) {
    setEditingColumnId(column.id);
    setDraftTitle(column.title);
  }

  async function handleSaveColumnTitle(column: KanbanColumn) {
    const normalizedTitle = draftTitle.trim();
    if (!normalizedTitle) {
      return;
    }
    await onRenameColumn(column.id, normalizedTitle);
    setEditingColumnId(null);
    setDraftTitle("");
  }

  return (
    <div className="kanban-grid kanban-grid-wide">
      {columns.map((column) => (
        <section
          key={column.id}
          className="kanban-column"
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (draggingPatientId && draggingFromStage) {
              onMove(draggingPatientId, draggingFromStage, column.id);
            }
            setDraggingPatientId(null);
            setDraggingFromStage(null);
          }}
        >
          <div className="column-heading kanban-column-head">
            <div>
              <p className="column-kicker">{column.description}</p>
              {editingColumnId === column.id ? (
                <div className="kanban-column-title-editor">
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleSaveColumnTitle(column);
                      }
                      if (event.key === "Escape") {
                        setEditingColumnId(null);
                        setDraftTitle("");
                      }
                    }}
                    autoFocus
                    aria-label={`Editar nome da coluna ${column.title}`}
                  />
                  <div className="inline-actions">
                    <button type="button" className="secondary-button kanban-mini-button" onClick={() => void handleSaveColumnTitle(column)}>
                      Salvar
                    </button>
                    <button
                      type="button"
                      className="ghost-button kanban-mini-button"
                      onClick={() => {
                        setEditingColumnId(null);
                        setDraftTitle("");
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="kanban-column-title-row">
                  <h2>{column.title}</h2>
                  <div className="inline-actions">
                    <button type="button" className="ghost-button kanban-edit-column-button" onClick={() => startEditingColumn(column)}>
                      Editar
                    </button>
                    {!column.isSystem ? (
                      confirmingDeleteColumnId === column.id ? (
                        <>
                          <button
                            type="button"
                            className="primary-button kanban-edit-column-button"
                            onClick={async () => {
                              try {
                                await onDeleteColumn(column);
                              } finally {
                                setConfirmingDeleteColumnId(null);
                              }
                            }}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            className="ghost-button kanban-edit-column-button"
                            onClick={() => setConfirmingDeleteColumnId(null)}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="ghost-button kanban-edit-column-button"
                          onClick={() => setConfirmingDeleteColumnId(column.id)}
                        >
                          Excluir
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            <span className="column-counter">{column.patients.length}</span>
          </div>

          <div className="column-cards">
            {column.patients.length === 0 ? (
              <p className="empty-state">Nenhuma paciente nesta etapa.</p>
            ) : (
              column.patients.map((patient) => {
                const priority = getPatientPriorityMeta(patient);
                const isFollowUpColumn = column.id === "follow_up";
                const daysWithoutResponse = isFollowUpColumn ? getDaysWithoutResponse(patient.latestMessage?.sentAt) : null;
                const messageActionLabel = isFollowUpColumn ? "Reenviar mensagem" : "Registrar mensagem";
                const confirmActionLabel = isFollowUpColumn ? "Confirmar reenvio" : "Confirmar envio";
                const whatsappMessage = encodeURIComponent(
                  patient.nextExam.suggestedMessage ||
                  `Ola, ${patient.name}. Tudo bem? Aqui e da clinica obstetrica. ` +
                    `Estamos entrando em contato sobre seu proximo exame: ${patient.nextExam.name}. ` +
                    `${patient.nextExam.idealDate ? `A data ideal e ${patient.nextExam.idealDate}. ` : ""}` +
                    `Se quiser, podemos ajudar com o agendamento.`
                );
                const whatsappUrl = getWhatsAppUrl(patient.phone, whatsappMessage);

                return (
                  <article
                    key={patient.id}
                    className={`patient-card patient-card-draggable ${priority.cardClassName} ${priority.needsImmediateAction ? "patient-card-immediate" : ""}`}
                    draggable
                    onDragStart={() => {
                      setDraggingPatientId(patient.id);
                      setDraggingFromStage(column.id);
                    }}
                  >
                    <div className="card-row patient-card-header">
                      <div>
                        {patient.importedFromShosp ? (
                          <span className="badge badge-soft badge-priority-blue kanban-source-badge">Shosp</span>
                        ) : null}
                        <div className="kanban-patient-badge-row">
                          {patient.gestationalBaseIsEstimated ? (
                            <span className="badge badge-soft badge-priority-blue kanban-status-badge">Base estimada</span>
                          ) : null}
                          {patient.gestationalReviewRequired ? (
                            <span className="badge badge-soft badge-priority-red kanban-status-badge">Revisao manual</span>
                          ) : null}
                        </div>
                        <h3>{patient.name}</h3>
                        <p className="kanban-card-exam-label">{patient.nextExam.name}</p>
                        {patient.nextExam.detectedInShosp ? (
                          <p className="kanban-followup-label">
                            Exame ja agendado no Shosp{patient.nextExam.scheduledDateLabel ? ` • ${patient.nextExam.scheduledDateLabel}` : ""}
                          </p>
                        ) : null}
                        {daysWithoutResponse != null ? (
                          <p className="kanban-followup-label">
                            Sem resposta ha {daysWithoutResponse} {daysWithoutResponse === 1 ? "dia" : "dias"}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="card-meta card-section kanban-card-footer">
                      <span className="kanban-dpp-chip"><strong>DPP:</strong> {patient.estimatedDueDate}</span>
                      <div className="inline-actions kanban-card-actions">
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="whatsapp-link kanban-card-button kanban-icon-button"
                          aria-label={`Abrir WhatsApp de ${patient.name}`}
                          title="Abrir WhatsApp"
                        >
                          <WhatsAppIcon />
                        </a>
                        {confirmingPatientId === patient.id ? (
                          <>
                            <button
                              type="button"
                              className="primary-button kanban-card-button"
                              disabled={sendingPatientId === patient.id}
                              onClick={async () => {
                                setSendingPatientId(patient.id);
                                try {
                                  await onRegisterMessage(patient.id);
                                } finally {
                                  setSendingPatientId(null);
                                  setConfirmingPatientId(null);
                                }
                              }}
                            >
                              {sendingPatientId === patient.id ? "Salvando..." : confirmActionLabel}
                            </button>
                            <button
                              type="button"
                              className="ghost-button kanban-card-button"
                              disabled={sendingPatientId === patient.id}
                              onClick={() => setConfirmingPatientId(null)}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button kanban-card-button kanban-icon-button"
                            disabled={sendingPatientId === patient.id}
                            onClick={() => setConfirmingPatientId(patient.id)}
                            aria-label={messageActionLabel}
                            title={messageActionLabel}
                          >
                            <EnvelopeIcon />
                          </button>
                        )}
                        <Link
                          className="secondary-button kanban-card-button kanban-icon-button"
                          to={`/pacientes/${patient.id}`}
                          aria-label={`Abrir detalhes de ${patient.name}`}
                          title="Detalhes"
                        >
                          <InfoIcon />
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
