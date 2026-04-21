import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ExcelJS from "exceljs";
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
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const visibleRows = useMemo(() => preview?.rows ?? result?.preview.rows ?? [], [preview, result]);

  async function downloadExcelTemplate() {
    setDownloadingTemplate(true);
    setFeedback(null);

    try {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Importacao de pacientes");

  worksheet.columns = [
    { header: "nome", key: "nome", width: 26 },
    { header: "telefone", key: "telefone", width: 18 },
    { header: "id_clinica", key: "idClinica", width: 16 },
    { header: "data_nascimento", key: "dataNascimento", width: 18 },
    { header: "idade_gestacional", key: "idadeGestacional", width: 18 },
    { header: "ultimo_exame", key: "ultimoExame", width: 24 },
    { header: "medico", key: "medico", width: 24 },
    { header: "unidade", key: "unidade", width: 20 }
  ];

  worksheet.addRow({
    nome: "Maria Aparecida",
    telefone: "31999999999",
    idClinica: "MF-1001",
    dataNascimento: "20-04-1992",
    idadeGestacional: "12s3d",
    ultimoExame: "",
    medico: "Dra. Helena Castro",
    unidade: "Unidade Centro"
  });

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF203047" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEAF2FB" }
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.border = {
    bottom: { style: "thin", color: { argb: "FFD6E2EE" } }
  };

  worksheet.getRow(2).alignment = { vertical: "middle" };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo-importacao-pacientes.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
      setFeedbackType("success");
      setFeedback("Modelo Excel baixado com sucesso.");
    } catch (error) {
      setFeedbackType("error");
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel gerar o modelo Excel.");
    } finally {
      setDownloadingTemplate(false);
    }
  }

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
        <div className="inline-actions list-action-bar">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void downloadExcelTemplate()}
            disabled={downloadingTemplate}
          >
            Baixar modelo de planilha (Excel)
          </button>
          <Link to="/clientes" className="secondary-button">Voltar aos clientes</Link>
        </div>
      </div>

      {feedback ? (
        <div className={feedbackType === "error" ? "form-alert form-alert-error" : "form-alert form-alert-success"}>
          <span>{feedback}</span>
        </div>
      ) : null}

      <article className="panel-card">
        <div className="card-row">
          <div>
            <p className="muted-label">Modelo padrao</p>
            <p className="page-description">
              Use o arquivo de exemplo para preencher a planilha no formato esperado pela recepcao.
            </p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => void downloadExcelTemplate()}
            disabled={downloadingTemplate}
          >
            {downloadingTemplate ? "Gerando modelo Excel..." : "Baixar modelo de planilha (Excel)"}
          </button>
        </div>
      </article>

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
              Modelo padrao: nome, telefone, id_clinica, data_nascimento, idade_gestacional, ultimo_exame, medico e unidade.
            </span>
          </label>

          <article className="panel-card">
            <p className="muted-label">Orientacao rapida</p>
            <div className="message-metadata">
              <span><strong>data_nascimento:</strong> prefira DD-MM-YYYY. Tambem aceitamos DD/MM/YYYY e YYYY-MM-DD.</span>
              <span><strong>idade_gestacional:</strong> use formatos como 12s3d, 12+3 ou apenas 12.</span>
              <span><strong>ultimo_exame:</strong> pode ser o nome do exame ou o codigo cadastrado.</span>
              <span><strong>Seguranca:</strong> linhas duplicadas ou invalidas nao sao importadas sem revisao.</span>
            </div>
          </article>

          <button
            type="button"
            className="primary-button patient-import-primary-action"
            onClick={handlePreview}
            disabled={loadingPreview}
          >
            {loadingPreview ? "Validando planilha..." : "Validar planilha"}
          </button>
        </article>

        <div className="stack-form">
          <article className="panel-card patient-import-summary-card">
            <p className="muted-label">Resumo da importacao</p>
            {preview ? (
              <div className="message-metadata patient-import-summary-metadata">
                <span><strong>Total de linhas:</strong> {preview.summary.totalRows}</span>
                <span><strong>Prontas para importar:</strong> {preview.summary.readyRows}</span>
                <span><strong>Duplicadas:</strong> {preview.summary.duplicateRows}</span>
                <span><strong>Com erro:</strong> {preview.summary.errorRows}</span>
              </div>
            ) : (
              <p className="empty-state">Valide uma planilha para ver o resumo antes da importacao.</p>
            )}
            {preview?.summary.readyRows ? (
              <div className="patient-import-confirm-box">
                <div className="patient-import-confirm-copy">
                  <strong>{preview.summary.readyRows} linha(s) pronta(s) para cadastro</strong>
                  <span>
                    Revise os erros e duplicidades, depois conclua a importacao para criar apenas as linhas validadas.
                  </span>
                </div>
                <button
                  type="button"
                  className="primary-button patient-import-primary-action patient-import-confirm-button"
                  onClick={handleConfirmImport}
                  disabled={confirmingImport}
                >
                  {confirmingImport ? "Importando..." : "Confirmar importacao"}
                </button>
              </div>
            ) : null}
          </article>

          <article className="panel-card">
            <p className="muted-label">Colunas do modelo</p>
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
