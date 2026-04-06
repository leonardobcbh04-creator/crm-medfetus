import { useEffect, useState } from "react";
import type { ReportsData, ReportsFilters } from "../types";
import { api } from "../services/api";

const DEFAULT_FILTERS: ReportsFilters = {
  period: "7d",
  dateFrom: "",
  dateTo: "",
  clinicUnit: "",
  physicianName: ""
};

function buildCsv(filename: string, columns: string[], rows: Array<Array<string | number | null | undefined>>) {
  const escapeValue = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const csvContent = [columns.map(escapeValue).join(","), ...rows.map((row) => row.map(escapeValue).join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildCombinedCsv(
  filename: string,
  metadata: Array<[string, string | number | null | undefined]>,
  sections: Array<{
    title: string;
    headers: string[];
    rows: Array<Array<string | number | null | undefined>>;
  }>
) {
  const escapeValue = (value: string | number | null | undefined) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const metadataLines = metadata.map(([label, value]) => `${escapeValue(label)},${escapeValue(value)}`);
  const sectionLines = sections.flatMap((section, index) => {
    const sectionLines = [
      escapeValue(section.title),
      section.headers.map(escapeValue).join(","),
      ...section.rows.map((row) => row.map(escapeValue).join(","))
    ];

    if (index < sections.length - 1) {
      sectionLines.push("");
    }

    return sectionLines;
  });

  const allLines = [...metadataLines, "", ...sectionLines];
  const blob = new Blob([allLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReportTable({
  title,
  description,
  headers,
  rows,
  onExport
}: {
  title: string;
  description: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  onExport: () => void;
}) {
  return (
    <article className="panel-card reports-card">
      <div className="page-header">
        <div>
          <p className="muted-label">{title}</p>
          <p className="page-description">{description}</p>
        </div>
        <button type="button" className="secondary-button" onClick={onExport}>
          Exportar CSV
        </button>
      </div>

      <div className="clients-table-wrapper">
        <table className="clients-table reports-table">
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${title}-${index}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${title}-${index}-${cellIndex}`}>{cell || "-"}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={headers.length}>
                  <p className="empty-state">Nenhum dado encontrado para este relatorio.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export function ReportsPage() {
  const [filters, setFilters] = useState<ReportsFilters>(DEFAULT_FILTERS);
  const [reports, setReports] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadReports(DEFAULT_FILTERS);
  }, []);

  async function loadReports(currentFilters: ReportsFilters) {
    setLoading(true);
    try {
      const response = await api.getReports(currentFilters);
      setReports(response);
    } finally {
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof ReportsFilters>(field: K, value: ReportsFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function handleExportAll() {
    if (!reports) {
      return;
    }

    buildCombinedCsv("relatorios-operacionais.csv", [
      ["Exportado em", new Date().toLocaleString("pt-BR")],
      ["Periodo", reports.filters.period],
      ["Data inicial", reports.filters.dateFrom || "Nao informada"],
      ["Data final", reports.filters.dateTo || "Nao informada"],
      ["Unidade", reports.filters.clinicUnit || "Todas"],
      ["Medico", reports.filters.physicianName || "Todos"]
    ], [
      {
        title: "Pacientes por etapa",
        headers: ["Etapa", "Total"],
        rows: reports.reports.patientsByStage.map((row) => [row.stageTitle, row.total])
      },
      {
        title: "Exames pendentes",
        headers: ["Paciente", "Exame", "Previsao", "Status", "Unidade", "Medico"],
        rows: reports.reports.pendingExams.map((row) => [
          row.patientName,
          row.examName,
          row.predictedDateLabel,
          row.deadlineStatusLabel,
          row.clinicUnit,
          row.physicianName
        ])
      },
      {
        title: "Exames atrasados",
        headers: ["Paciente", "Exame", "Previsao", "Unidade", "Medico"],
        rows: reports.reports.overdueExams.map((row) => [
          row.patientName,
          row.examName,
          row.predictedDateLabel,
          row.clinicUnit,
          row.physicianName
        ])
      },
      {
        title: "Contatos realizados",
        headers: ["Paciente", "Tipo", "Status", "Data", "Usuario", "Unidade", "Medico"],
        rows: reports.reports.contactsMade.map((row) => [
          row.patientName,
          row.contactType,
          row.status,
          row.dateLabel,
          row.userName,
          row.clinicUnit,
          row.physicianName
        ])
      },
      {
        title: "Agendamentos por periodo",
        headers: ["Paciente", "Exame", "Data", "Horario", "Usuario", "Unidade", "Medico"],
        rows: reports.reports.scheduledByPeriod.map((row) => [
          row.patientName,
          row.examName,
          row.scheduledDateLabel,
          row.scheduledTime,
          row.userName,
          row.clinicUnit,
          row.physicianName
        ])
      },
      {
        title: "Produtividade por usuario",
        headers: ["Usuario", "Contatos", "Agendamentos", "Concluidos", "Acoes totais"],
        rows: reports.reports.productivityByUser.map((row) => [
          row.userName,
          row.contacts,
          row.scheduled,
          row.completed,
          row.totalActions
        ])
      }
    ]);
  }

  if (loading && !reports) {
    return <p className="loading-text">Carregando relatorios...</p>;
  }

  if (!reports) {
    return <p className="loading-text">Nao foi possivel carregar os relatorios.</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operacao</p>
          <h2>Relatorios</h2>
          <p className="page-description">
            Acompanhe os principais indicadores da operacao e exporte os dados em CSV quando precisar.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={handleExportAll}>
          Exportar consolidado em CSV
        </button>
      </div>

      <article className="panel-card stack-form filter-panel">
        <div className="three-columns">
          <label>
            Periodo
            <select value={filters.period} onChange={(event) => updateFilter("period", event.target.value)}>
              <option value="7d">Ultimos 7 dias</option>
              <option value="15d">Ultimos 15 dias</option>
              <option value="30d">Ultimos 30 dias</option>
              <option value="90d">Ultimos 90 dias</option>
            </select>
          </label>

          <label>
            Unidade
            <select value={filters.clinicUnit} onChange={(event) => updateFilter("clinicUnit", event.target.value)}>
              <option value="">Todas</option>
              {reports.filterOptions.clinicUnits.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </label>

          <label>
            Medico
            <select value={filters.physicianName} onChange={(event) => updateFilter("physicianName", event.target.value)}>
              <option value="">Todos</option>
              {reports.filterOptions.physicians.map((physician) => (
                <option key={physician} value={physician}>{physician}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="two-columns">
          <label>
            Data inicial
            <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} />
          </label>
          <label>
            Data final
            <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} />
          </label>
        </div>

        <div className="inline-actions">
          <button type="button" className="primary-button" onClick={() => void loadReports(filters)}>
            Aplicar filtros
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setFilters(DEFAULT_FILTERS);
              void loadReports(DEFAULT_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        </div>
      </article>

      <div className="stats-grid reports-stats-grid">
        <article className="stat-card">
          <span className="stat-label">Exames pendentes</span>
          <strong>{reports.summary.pendingExams}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Exames atrasados</span>
          <strong>{reports.summary.overdueExams}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Contatos realizados</span>
          <strong>{reports.summary.contactsMade}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Agendamentos</span>
          <strong>{reports.summary.scheduledCount}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Conversao</span>
          <strong>{reports.summary.conversionRate}%</strong>
        </article>
      </div>

      <div className="reports-grid">
        <ReportTable
          title="Pacientes por etapa"
          description="Quantidade atual de pacientes em cada etapa do pipeline."
          headers={["Etapa", "Total"]}
          rows={reports.reports.patientsByStage.map((row) => [row.stageTitle, row.total])}
          onExport={() =>
            buildCsv(
              "pacientes-por-etapa.csv",
              ["Etapa", "Total"],
              reports.reports.patientsByStage.map((row) => [row.stageTitle, row.total])
            )
          }
        />

        <ReportTable
          title="Exames pendentes"
          description="Lista dos exames que ainda aguardam agendamento ou realizacao."
          headers={["Paciente", "Exame", "Previsao", "Status", "Unidade", "Medico"]}
          rows={reports.reports.pendingExams.map((row) => [
            row.patientName,
            row.examName,
            row.predictedDateLabel,
            row.deadlineStatusLabel,
            row.clinicUnit,
            row.physicianName
          ])}
          onExport={() =>
            buildCsv(
              "exames-pendentes.csv",
              ["Paciente", "Exame", "Previsao", "Status", "Unidade", "Medico"],
              reports.reports.pendingExams.map((row) => [
                row.patientName,
                row.examName,
                row.predictedDateLabel,
                row.deadlineStatusLabel,
                row.clinicUnit,
                row.physicianName
              ])
            )
          }
        />

        <ReportTable
          title="Exames atrasados"
          description="Exames fora da janela ideal que precisam de acompanhamento prioritario."
          headers={["Paciente", "Exame", "Previsao", "Unidade", "Medico"]}
          rows={reports.reports.overdueExams.map((row) => [
            row.patientName,
            row.examName,
            row.predictedDateLabel,
            row.clinicUnit,
            row.physicianName
          ])}
          onExport={() =>
            buildCsv(
              "exames-atrasados.csv",
              ["Paciente", "Exame", "Previsao", "Unidade", "Medico"],
              reports.reports.overdueExams.map((row) => [
                row.patientName,
                row.examName,
                row.predictedDateLabel,
                row.clinicUnit,
                row.physicianName
              ])
            )
          }
        />

        <ReportTable
          title="Contatos realizados"
          description="Mensagens enviadas e contatos registrados no periodo filtrado."
          headers={["Paciente", "Tipo", "Status", "Data", "Usuario", "Unidade", "Medico"]}
          rows={reports.reports.contactsMade.map((row) => [
            row.patientName,
            row.contactType,
            row.status,
            row.dateLabel,
            row.userName,
            row.clinicUnit,
            row.physicianName
          ])}
          onExport={() =>
            buildCsv(
              "contatos-realizados.csv",
              ["Paciente", "Tipo", "Status", "Data", "Usuario", "Unidade", "Medico"],
              reports.reports.contactsMade.map((row) => [
                row.patientName,
                row.contactType,
                row.status,
                row.dateLabel,
                row.userName,
                row.clinicUnit,
                row.physicianName
              ])
            )
          }
        />

        <ReportTable
          title="Agendamentos por periodo"
          description="Exames agendados no intervalo selecionado."
          headers={["Paciente", "Exame", "Data", "Horario", "Usuario", "Unidade", "Medico"]}
          rows={reports.reports.scheduledByPeriod.map((row) => [
            row.patientName,
            row.examName,
            row.scheduledDateLabel,
            row.scheduledTime,
            row.userName,
            row.clinicUnit,
            row.physicianName
          ])}
          onExport={() =>
            buildCsv(
              "agendamentos-por-periodo.csv",
              ["Paciente", "Exame", "Data", "Horario", "Usuario", "Unidade", "Medico"],
              reports.reports.scheduledByPeriod.map((row) => [
                row.patientName,
                row.examName,
                row.scheduledDateLabel,
                row.scheduledTime,
                row.userName,
                row.clinicUnit,
                row.physicianName
              ])
            )
          }
        />

        <ReportTable
          title="Produtividade por usuario"
          description="Volume de contatos, agendamentos e exames concluídos por usuario."
          headers={["Usuario", "Contatos", "Agendamentos", "Concluidos", "Acoes totais"]}
          rows={reports.reports.productivityByUser.map((row) => [
            row.userName,
            row.contacts,
            row.scheduled,
            row.completed,
            row.totalActions
          ])}
          onExport={() =>
            buildCsv(
              "produtividade-por-usuario.csv",
              ["Usuario", "Contatos", "Agendamentos", "Concluidos", "Acoes totais"],
              reports.reports.productivityByUser.map((row) => [
                row.userName,
                row.contacts,
                row.scheduled,
                row.completed,
                row.totalActions
              ])
            )
          }
        />
      </div>
    </section>
  );
}
