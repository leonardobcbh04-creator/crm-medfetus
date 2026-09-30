import { useMemo, useState } from "react";
import { api } from "../services/api";
import type {
  FutureScheduleImportConfirmResult,
  FutureScheduleImportPreview,
  FutureScheduleImportRowStatus
} from "../types";
import { formatBrazilPhone } from "../utils/phone";

type Props = {
  readFileAsBase64: (file: File) => Promise<string>;
};

function getStatusBadgeMeta(status: FutureScheduleImportRowStatus) {
  switch (status) {
    case "agendamento":
      return { label: "Vai agendar", className: "badge-priority-green" };
    case "confirmar":
      return { label: "Confirmar", className: "badge-priority-yellow" };
    case "cancelamento":
      return { label: "Cancelamento", className: "badge-priority-blue" };
    case "nao_cadastrada":
      return { label: "Nao cadastrada", className: "badge-priority-blue" };
    case "ignorada":
      return { label: "Ignorada", className: "badge-priority-blue" };
    default:
      return { label: "Com erro", className: "badge-priority-red" };
  }
}

// Importacao da agenda futura (mesmo arquivo mensal da recepcao). Cada aba com data
// futura vira agendamento do exame. Nao cria nem altera cadastro de paciente.
export function FutureScheduleImportPanel({ readFileAsBase64 }: Props) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePayload, setFilePayload] = useState<{ fileName: string; fileBase64: string } | null>(null);
  const [preview, setPreview] = useState<FutureScheduleImportPreview | null>(null);
  const [result, setResult] = useState<FutureScheduleImportConfirmResult | null>(null);
  const [confirmedRowKeys, setConfirmedRowKeys] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const rowsToSave = (preview?.summary.scheduleRows ?? 0) + confirmedRowKeys.size + (preview?.summary.cancelRows ?? 0);

  async function handlePreview() {
    if (!selectedFile) {
      setFeedbackType("error");
      setFeedback("Selecione a planilha da agenda para validar.");
      return;
    }
    setLoadingPreview(true);
    setFeedback(null);
    setResult(null);
    try {
      const payload = { fileName: selectedFile.name, fileBase64: await readFileAsBase64(selectedFile) };
      const response = await api.previewFutureScheduleImport(payload);
      setFilePayload(payload);
      setPreview(response);
      setConfirmedRowKeys(new Set());
      setFeedbackType("success");
      setFeedback("Agenda validada. Revise as linhas antes de gravar.");
    } catch (error) {
      setPreview(null);
      setFilePayload(null);
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel validar a agenda.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirm() {
    if (!filePayload) {
      return;
    }
    setConfirming(true);
    setFeedback(null);
    try {
      const response = await api.confirmFutureScheduleImport({
        ...filePayload,
        confirmedRowKeys: [...confirmedRowKeys]
      });
      setResult(response);
      setPreview(response.preview);
      setConfirmedRowKeys(new Set());
      setFeedbackType("success");
      setFeedback(
        `${response.summary.scheduledExams} exame(s) agendado(s), ${response.summary.unchangedExams} sem mudanca, ` +
        `${response.summary.removedSchedules + response.summary.cancelledSchedules} agendamento(s) removido(s)/cancelado(s).`
      );
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel gravar a agenda.");
    } finally {
      setConfirming(false);
    }
  }

  function toggleConfirmed(rowKey: string) {
    setConfirmedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }

  return (
    <>
      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="detail-layout patient-form-layout">
        <article className="panel-card stack-form">
          <div className="form-section-header">
            <p className="muted-label">Agenda futura da recepcao</p>
            <p className="field-hint">Mesmo arquivo mensal da recepcao (.xlsx), com uma aba por dia.</p>
          </div>

          <label>
            Planilha da agenda
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            <span className="field-hint">
              Todas as abas com data depois de hoje sao lidas. Abas de hoje ou de dias passados sao ignoradas.
            </span>
          </label>

          <article className="panel-card">
            <p className="muted-label">Como funciona</p>
            <div className="message-metadata">
              <span><strong>Paciente:</strong> identificada pelo CELULAR, conferindo o nome. Se o nome nao bater com o cadastro, a linha fica como "Confirmar" e so e gravada se voce marcar.</span>
              <span><strong>Cadastro:</strong> a agenda nao altera IG, DUM nem telefone. Paciente nao cadastrada e ignorada.</span>
              <span><strong>CANCELOU:</strong> na observacao, remove o agendamento daquele dia.</span>
              <span><strong>Reenviar:</strong> enviar a agenda de novo substitui os agendamentos importados das datas do arquivo (remarcacoes e cancelamentos). Agendamentos feitos a mao no sistema nao sao apagados.</span>
              <span><strong>Depois do exame:</strong> quando a importacao do dia chegar, o exame passa de agendado para realizado.</span>
            </div>
          </article>

          <button
            type="button"
            className="primary-button patient-import-primary-action"
            onClick={handlePreview}
            disabled={loadingPreview}
          >
            {loadingPreview ? "Validando agenda..." : "Validar agenda"}
          </button>
        </article>

        <div className="stack-form">
          <article className="panel-card patient-import-summary-card">
            <p className="muted-label">Resumo da agenda</p>
            {preview ? (
              <div className="message-metadata patient-import-summary-metadata">
                <span><strong>Datas futuras no arquivo:</strong> {preview.scheduleDates.length}</span>
                <span><strong>Total de linhas:</strong> {preview.summary.totalRows}</span>
                <span><strong>Prontas para agendar:</strong> {preview.summary.scheduleRows}</span>
                <span><strong>Para confirmar:</strong> {preview.summary.confirmRows}</span>
                <span><strong>Cancelamentos:</strong> {preview.summary.cancelRows}</span>
                <span><strong>Nao cadastradas:</strong> {preview.summary.notRegisteredRows}</span>
                <span><strong>Com erro:</strong> {preview.summary.errorRows}</span>
                <span><strong>Ignoradas:</strong> {preview.summary.ignoredRows}</span>
                {preview.ignoredSheets.length ? (
                  <span><strong>Abas nao lidas:</strong> {preview.ignoredSheets.map((sheet) => sheet.sheetName).join(", ")}</span>
                ) : null}
              </div>
            ) : (
              <p className="empty-state">Valide a agenda para ver o resumo antes de gravar.</p>
            )}
            {preview && !result ? (
              <div className="patient-import-confirm-box">
                <div className="patient-import-confirm-copy">
                  <strong>{rowsToSave} linha(s) serao processadas</strong>
                  <span>
                    Os agendamentos importados antes para as datas deste arquivo serao substituidos por esta versao.
                    {preview.summary.confirmRows ? ` Marque as linhas "Confirmar" que devem ser gravadas (${confirmedRowKeys.size} de ${preview.summary.confirmRows} marcada(s)).` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-button patient-import-primary-action patient-import-confirm-button"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? "Gravando..." : "Gravar agenda"}
                </button>
              </div>
            ) : null}
          </article>
        </div>
      </div>

      <article className="panel-card clients-list-card">
        <p className="muted-label">Linhas da agenda</p>
        {rows.length ? (
          <div className="clients-table-wrapper">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Aba / linha</th>
                  <th>Data e horario</th>
                  <th>Paciente</th>
                  <th>Exame</th>
                  <th>Status</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const badge = getStatusBadgeMeta(row.status);
                  return (
                    <tr key={row.rowKey}>
                      <td>{row.sheetName} / {row.lineNumber}</td>
                      <td>{row.scheduleDateLabel}{row.scheduleTime ? ` as ${row.scheduleTime}` : ""}</td>
                      <td>
                        <div className="clients-primary-cell">
                          <strong>{row.patientName}</strong>
                          {row.registeredPatientName ? (
                            <span className="field-hint">Cadastro: {row.registeredPatientName}</span>
                          ) : null}
                          <span className="field-hint">{formatBrazilPhone(row.phone) || "Sem celular"}</span>
                        </div>
                      </td>
                      <td>{row.examName || "-"}</td>
                      <td>
                        <span className={`badge ${badge.className}`}>{badge.label}</span>
                        {row.status === "confirmar" && !result ? (
                          <label className="field-hint">
                            <input
                              type="checkbox"
                              checked={confirmedRowKeys.has(row.rowKey)}
                              onChange={() => toggleConfirmed(row.rowKey)}
                            />{" "}
                            Gravar mesmo assim
                          </label>
                        ) : null}
                      </td>
                      <td>
                        <div className="message-history-list">
                          {row.messages.length ? row.messages.map((message) => (
                            <span key={message} className="exam-warning-text">{message}</span>
                          )) : <span>Sem pendencias.</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">Envie a agenda e valide para ver as linhas antes de gravar.</p>
        )}
      </article>
    </>
  );
}
