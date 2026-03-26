import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { GestationalBaseReviewItem } from "../types";
import { formatBrazilPhone } from "../utils/phone";

export function GestationalBaseReviewPage() {
  const [items, setItems] = useState<GestationalBaseReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [manualGestationalAges, setManualGestationalAges] = useState<Record<number, { weeks: string; days: string }>>({});

  useEffect(() => {
    void loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    try {
      const response = await api.getGestationalBaseReviews();
      setItems(response.items);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar a fila de revisao.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(patientId: number) {
    setSavingKey(`confirm-${patientId}`);
    setFeedback("");
    try {
      await api.confirmGestationalBaseEstimate(patientId);
      setFeedback("Estimativa confirmada com sucesso.");
      await loadItems();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel confirmar a estimativa.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleManualSave(patientId: number) {
    setSavingKey(`manual-${patientId}`);
    setFeedback("");
    try {
      const currentValue = manualGestationalAges[patientId] || { weeks: "", days: "0" };
      await api.editGestationalBaseManually(patientId, {
        gestationalWeeks: Number(currentValue.weeks || "0"),
        gestationalDays: Number(currentValue.days || "0")
      });
      setFeedback("Base gestacional ajustada manualmente.");
      await loadItems();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel salvar a idade gestacional manual.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleDiscard(patientId: number) {
    setSavingKey(`discard-${patientId}`);
    setFeedback("");
    try {
      await api.discardGestationalBaseEstimate(patientId);
      setFeedback("Estimativa descartada. A paciente continua em revisao manual.");
      await loadItems();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel descartar a estimativa.");
    } finally {
      setSavingKey("");
    }
  }

  if (loading) {
    return <p className="loading-text">Carregando fila de revisao manual...</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Revisao manual</p>
          <h2>Revisao manual da base gestacional</h2>
          <p className="page-description">
            Pacientes sem base gestacional segura para seguir automaticamente no fluxo.
          </p>
        </div>
        <Link to="/kanban" className="secondary-button">Voltar ao Pipeline</Link>
      </div>

      {feedback ? <div className="form-alert form-alert-success"><span>{feedback}</span></div> : null}

      <article className="panel-card stack-form">
        {items.length ? (
          <div className="settings-grid">
            {items.map((item) => (
              <div key={item.patientId} className="admin-row-card admin-entity-card stack-form">
                <div className="card-row admin-entity-head">
                  <div>
                    <strong>{item.patientName}</strong>
                    <p className="admin-user-subtitle">{formatBrazilPhone(item.phone) || "Nao informado"}</p>
                  </div>
                  <div className="priority-badge-row">
                    <span className={`badge ${item.hasConflict ? "badge-priority-red" : "badge-priority-yellow"}`}>
                      {item.confidenceLabel}
                    </span>
                  </div>
                </div>

                <div className="message-metadata">
                  <span><strong>Ultimo exame:</strong> {item.lastExamName}</span>
                  <span><strong>Data do exame:</strong> {item.lastExamDateLabel}</span>
                  <span><strong>Estimativa sugerida:</strong> {item.suggestedEstimate}</span>
                  <span><strong>Nivel de confianca:</strong> {item.confidenceLabel}</span>
                  <span><strong>Origem:</strong> {item.sourceLabel}</span>
                  {item.explanation ? <span><strong>Observacao:</strong> {item.explanation}</span> : null}
                </div>

                <div className="two-columns">
                  <label>
                    Semanas informadas manualmente
                    <input
                      type="text"
                      inputMode="numeric"
                      value={manualGestationalAges[item.patientId]?.weeks || ""}
                      onChange={(event) =>
                        setManualGestationalAges((current) => ({
                          ...current,
                          [item.patientId]: {
                            weeks: event.target.value.replace(/\D/g, ""),
                            days: current[item.patientId]?.days || "0"
                          }
                        }))
                      }
                    />
                  </label>
                  <label>
                    Dias informados manualmente
                    <input
                      type="text"
                      inputMode="numeric"
                      value={manualGestationalAges[item.patientId]?.days || "0"}
                      onChange={(event) =>
                        setManualGestationalAges((current) => ({
                          ...current,
                          [item.patientId]: {
                            weeks: current[item.patientId]?.weeks || "",
                            days: event.target.value.replace(/\D/g, "")
                          }
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="inline-actions list-action-bar">
                  {item.canConfirm ? (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={savingKey === `confirm-${item.patientId}`}
                      onClick={() => void handleConfirm(item.patientId)}
                    >
                      {savingKey === `confirm-${item.patientId}` ? "Salvando..." : "Confirmar estimativa"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={savingKey === `manual-${item.patientId}`}
                    onClick={() => void handleManualSave(item.patientId)}
                  >
                    {savingKey === `manual-${item.patientId}` ? "Salvando..." : "Salvar idade gestacional"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={savingKey === `discard-${item.patientId}`}
                    onClick={() => void handleDiscard(item.patientId)}
                  >
                    {savingKey === `discard-${item.patientId}` ? "Salvando..." : "Descartar estimativa"}
                  </button>
                  <Link to={`/pacientes/${item.patientId}`} className="secondary-button">Abrir ficha</Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Nenhuma paciente aguardando revisao manual da base gestacional.</p>
        )}
      </article>
    </section>
  );
}
