import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { PatientImportConfirmResult, PatientImportPreview } from "../types";
import { formatBrazilPhone } from "../utils/phone";

async function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler a planilha."));
    reader.readAsDataURL(file);
  });
}

function getStatusBadgeMeta(status: PatientImportPreview["rows"][number]["status"]) {
  if (status === "pronta") {
    return { label: "Pronta para importar", className: "badge-priority-green" };
  }
  if (status === "duplicada") {
    return { label: "Duplicada", className: "badge-priority-yellow" };
  }
  return { label: "Com erro", className: "badge-priority-red" };
}

export function PatientImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePayload, setFilePayload] = useState<{ fileName: string; fileBase64: string } | null>(null);
  const [preview, setPreview] = useState<PatientImportPreview | null>(null);
  const [result, setResult] = useState<PatientImportConfirmResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("success");

  const visibleRows = useMemo(() => preview?.rows ?? result?.preview.rows ?? [], [preview, result]);

  async function handlePreview() {
    if (!selectedFile) {
      setFeedbackType("error");
      setFeedback("Selecione uma planilha para validar.");
      return;
    }

    setLoadingPreview(true);
    setFeedback(null);
    setResult(null);

    try {
      const payload = {
        fileName: selectedFile.name,
        fileBase64: await readFileAsBase64(selectedFile)
      };
      setFilePayload(payload);
      const response = await api.previewPatientImport(payload);
      setPreview(response);
      setFeedbackType("success");
      setFeedback("Planilha validada com sucesso. Revise o resumo antes de confirmar.");
    } catch (error) {
      setPreview(null);
      setFilePayload(null);
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel validar a planilha.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleConfirmImport() {
    if (!filePayload) {
      setFeedbackType("error");
      setFeedback("Valide a planilha antes de confirmar a importacao.");
      return;
    }

    setConfirmingImport(true);
    setFeedback(null);

    try {
      const response = await api.confirmPatientImport(filePayload);
      setResult(response);
      setPreview(response.preview);
      setFeedbackType("success");
      setFeedback(`${response.summary.importedRows} paciente(s) importada(s) com sucesso.`);
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel concluir a importacao.");
    } finally {
      setConfirmingImport(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastro em lote</p>
          <h2>Importar pacientes por planilha</h2>
          <p className="page-description">
            Envie uma planilha simples para validar os dados antes de criar varios cadastros de uma vez.
          </p>
        </div>
        <Link to="/clientes" className="secondary-button">Voltar aos clientes</Link>
      </div>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <span>{feedback}</span>
        </div>
      ) : null}

      <div className="detail-layout patient-form-layout">
        <article className="panel-card stack-form">
          <div className="form-section-header">
            <p className="muted-label">Arquivo</p>
            <p className="field-hint">Formatos aceitos: .xlsx, .xls e .csv.</p>
          </div>

          <label>
            Planilha de cadastro
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
            <span className="field-hint">
              Colunas esperadas: nome, telefone, ID da clinica, medico, unidade, data de nascimento, idade gestacional ou DUM e observacoes.
            </span>
          </label>

          <button
            type="button"
            className="primary-button"
            onClick={handlePreview}
            disabled={loadingPreview}
          >
            {loadingPreview ? "Validando planilha..." : "Validar planilha"}
          </button>
        </article>

        <div className="stack-form">
          <article className="panel-card">
            <p className="muted-label">Resumo da importacao</p>
            {preview ? (
              <div className="message-metadata">
                <span><strong>Total de linhas:</strong> {preview.summary.totalRows}</span>
                <span><strong>Prontas para importar:</strong> {preview.summary.readyRows}</span>
                <span><strong>Duplicadas:</strong> {preview.summary.duplicateRows}</span>
                <span><strong>Com erro:</strong> {preview.summary.errorRows}</span>
              </div>
            ) : (
              <p className="empty-state">Valide uma planilha para ver o resumo antes da importacao.</p>
            )}
            {preview?.summary.readyRows ? (
              <button
                type="button"
                className="secondary-button"
                onClick={handleConfirmImport}
                disabled={confirmingImport}
              >
                {confirmingImport ? "Importando..." : "Confirmar importacao"}
              </button>
            ) : null}
          </article>

          <article className="panel-card">
            <p className="muted-label">Colunas aceitas</p>
            {preview ? (
              <div className="message-history-list">
                {preview.expectedColumns.map((column) => (
                  <div key={column} className="message-history-item">
                    <span><strong>{column}</strong></span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">As colunas esperadas aparecerao aqui depois da validacao.</p>
            )}
          </article>
        </div>
      </div>

      <article className="panel-card clients-list-card">
        <p className="muted-label">Linhas analisadas</p>
        {visibleRows.length ? (
          <div className="clients-table-wrapper">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Paciente</th>
                  <th>Telefone</th>
                  <th>Status</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const badge = getStatusBadgeMeta(row.status);
                  return (
                    <tr key={`${row.lineNumber}-${row.patientName}`}>
                      <td>{row.lineNumber}</td>
                      <td>
                        <div className="clients-primary-cell">
                          <strong>{row.patientName || "Linha sem nome"}</strong>
                          {row.clinicPatientId ? <span className="field-hint">ID da clinica: {row.clinicPatientId}</span> : null}
                        </div>
                      </td>
                      <td>{formatBrazilPhone(row.phone) || "-"}</td>
                      <td><span className={`badge ${badge.className}`}>{badge.label}</span></td>
                      <td>
                        <div className="message-history-list">
                          <span><strong>Medico:</strong> {row.physicianName || "-"}</span>
                          <span><strong>Unidade:</strong> {row.clinicUnit || "-"}</span>
                          <span><strong>Nascimento:</strong> {row.birthDateLabel}</span>
                          <span><strong>Idade gestacional:</strong> {row.gestationalAgeLabel}</span>
                          {row.messages.length ? row.messages.map((message) => (
                            <span key={message} className="exam-warning-text">{message}</span>
                          )) : <span>Sem pendencias de validacao.</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Envie uma planilha e valide os dados para ver o resumo linha a linha antes de importar.
          </p>
        )}
      </article>
    </section>
  );
}
