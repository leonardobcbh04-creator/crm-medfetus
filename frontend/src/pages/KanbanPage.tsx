import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageSkeleton } from "../components/PageSkeleton";
import { api } from "../services/api";
import type { KanbanColumn, Patient } from "../types";
import { getPatientPriorityMeta, type PriorityFilter } from "../utils/patientPriority";
import { formatBrazilPhone, getWhatsAppUrl } from "../utils/phone";

// Tela "Fluxo de atendimento" em formato de funil simples: 4 etapas clicaveis no
// topo e uma lista compacta (uma linha por paciente). A etapa de cada paciente e
// inferida pelo sistema; as mensagens sao enviadas pela Central de contatos.

const DEADLINE_LEGEND: Array<{ color: Exclude<PriorityFilter, "todas">; label: string; hint: string }> = [
  { color: "verde", label: "No prazo", hint: "Fora das janelas de aviso" },
  { color: "amarelo", label: "Janela proxima", hint: "A partir de ~10 dias antes da data ideal" },
  { color: "laranja", label: "Contatar ja", hint: "Perto da data ideal: precisa de contato" },
  { color: "vermelho", label: "Atrasado", hint: "Passou do fim do intervalo do exame" }
];

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function daysBetweenIso(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T12:00:00Z`);
  const to = Date.parse(`${toIso}T12:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function toSaoPauloDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function describeLastContact(lastContactAt: string | null | undefined, today: string) {
  if (!lastContactAt) {
    return "Nunca contatada";
  }
  const days = daysBetweenIso(toSaoPauloDate(lastContactAt), today);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `ha ${days} dias`;
}

function describeExamDetail(patient: Patient) {
  if (patient.nextExam.scheduledDateLabel) {
    return `agendado ${patient.nextExam.scheduledDateLabel}`;
  }
  const [, windowPart] = patient.nextExam.dateLabel ? patient.nextExam.dateLabel.split(" • ") : [null, null];
  return windowPart || patient.nextExam.dateLabel || "";
}

function formatGestationalAge(patient: Patient) {
  if (patient.gestationalWeeks === null || patient.gestationalWeeks === undefined) {
    return patient.gestationalAgeLabel || "-";
  }
  return `${patient.gestationalWeeks}s${patient.gestationalDays ?? 0}d`;
}

function buildWhatsAppHref(patient: Patient) {
  const message =
    patient.nextExam.suggestedMessage ||
    `Ola, ${patient.name}. Tudo bem? Aqui e da clinica obstetrica. ` +
      `Estamos entrando em contato sobre seu proximo exame: ${patient.nextExam.name}. ` +
      "Se quiser, podemos ajudar com o agendamento.";
  return getWhatsAppUrl(patient.phone, encodeURIComponent(message));
}

export function KanbanPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("todas");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getKanban()
      .then((response) => {
        if (!cancelled) setColumns(response.columns);
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel carregar o fluxo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = todayInSaoPaulo();

  const allRows = useMemo(
    () => columns.flatMap((column) => column.patients.map((patient) => ({ patient, stageId: column.id, stageTitle: column.title }))),
    [columns]
  );

  // Busca e filtros valem para os numeros das etapas e para a lista.
  const matchingRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return allRows.filter(({ patient }) => {
      if (priorityFilter !== "todas" && getPatientPriorityMeta(patient).color !== priorityFilter) return false;
      if (unitFilter && patient.clinicUnit !== unitFilter) return false;
      if (physicianFilter && patient.physicianName !== physicianFilter) return false;
      if (!normalizedSearch) return true;
      return `${patient.name} ${patient.phone} ${patient.nextExam.name}`.toLowerCase().includes(normalizedSearch);
    });
  }, [allRows, physicianFilter, priorityFilter, search, unitFilter]);

  const visibleRows = useMemo(
    () => (stageFilter ? matchingRows.filter((row) => row.stageId === stageFilter) : matchingRows),
    [matchingRows, stageFilter]
  );

  const unitOptions = useMemo(
    () => [...new Set(allRows.map(({ patient }) => patient.clinicUnit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [allRows]
  );
  const physicianOptions = useMemo(
    () => [...new Set(allRows.map(({ patient }) => patient.physicianName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [allRows]
  );

  const extraFiltersCount = [unitFilter, physicianFilter].filter(Boolean).length;
  const hasFilters = Boolean(search || priorityFilter !== "todas" || unitFilter || physicianFilter || stageFilter);
  const selectedStage = columns.find((column) => column.id === stageFilter);

  function clearFilters() {
    setSearch("");
    setPriorityFilter("todas");
    setUnitFilter("");
    setPhysicianFilter("");
    setStageFilter("");
  }

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <section className="page-section funnel-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operacao</p>
          <h2>Fluxo de atendimento</h2>
          <p className="page-description">Em que etapa esta cada paciente. As mensagens sao enviadas pela Central de contatos.</p>
        </div>
      </div>

      {errorMessage ? <div className="form-alert form-alert-error"><span>{errorMessage}</span></div> : null}

      <div className="funnel-stages" role="group" aria-label="Etapas do funil">
        {columns.map((column, index) => {
          const active = stageFilter === column.id;
          const count = matchingRows.filter((row) => row.stageId === column.id).length;
          return (
            <button
              key={column.id}
              type="button"
              className={`funnel-stage ${active ? "active" : ""}`}
              aria-pressed={active}
              onClick={() => setStageFilter(active ? "" : column.id)}
            >
              <span className="funnel-stage-step">{index + 1}. etapa</span>
              <span className="funnel-stage-count">{count}</span>
              <span className="funnel-stage-title">{column.title}</span>
              <span className="funnel-stage-hint">{column.description}</span>
            </button>
          );
        })}
      </div>

      <article className="funnel-panel">
        <div className="funnel-toolbar">
          <label className="funnel-visually-hidden" htmlFor="funnel-search">Buscar paciente</label>
          <input
            id="funnel-search"
            type="search"
            className="funnel-search"
            placeholder="Buscar por nome, telefone ou exame"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className={`funnel-filter-button ${filtersOpen || extraFiltersCount ? "active" : ""}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filtros{extraFiltersCount ? ` (${extraFiltersCount})` : ""}
          </button>
          <div className="funnel-legend" role="group" aria-label="Filtrar por prazo">
            {DEADLINE_LEGEND.map((item) => (
              <button
                key={item.color}
                type="button"
                title={`${item.hint}. Clique para filtrar.`}
                aria-pressed={priorityFilter === item.color}
                className={`funnel-legend-item ${priorityFilter === item.color ? "active" : ""}`}
                onClick={() => setPriorityFilter(priorityFilter === item.color ? "todas" : item.color)}
              >
                <span className={`funnel-dot funnel-dot-${item.color}`} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {filtersOpen ? (
          <div className="funnel-extra-filters">
            <label>
              Unidade
              <select id="funnel-unit" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                <option value="">Todas as unidades</option>
                {unitOptions.map((unit) => <option key={unit} value={unit ?? ""}>{unit}</option>)}
              </select>
            </label>
            <label>
              Medico
              <select id="funnel-physician" value={physicianFilter} onChange={(event) => setPhysicianFilter(event.target.value)}>
                <option value="">Todos os medicos</option>
                {physicianOptions.map((name) => <option key={name} value={name ?? ""}>{name}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        <div className="funnel-summary">
          <span>
            {selectedStage
              ? `${visibleRows.length} paciente(s) em "${selectedStage.title}" · clique de novo na etapa para ver todas`
              : `${visibleRows.length} paciente(s) no fluxo · clique numa etapa acima para filtrar`}
          </span>
          {hasFilters ? <button type="button" className="ghost-button funnel-clear" onClick={clearFilters}>Limpar filtros</button> : null}
        </div>

        <div className="funnel-table-wrapper">
          <table className="funnel-table">
            <thead>
              <tr>
                <th scope="col">Paciente</th>
                <th scope="col">Proximo exame</th>
                <th scope="col">IG</th>
                <th scope="col">Etapa</th>
                <th scope="col">Ultimo contato</th>
                <th scope="col" className="funnel-actions-col">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ patient, stageId, stageTitle }) => {
                const priority = getPatientPriorityMeta(patient);
                return (
                  <tr key={patient.id}>
                    <td>
                      <div className="funnel-patient">
                        <span className={`funnel-dot funnel-dot-${priority.color}`} title={priority.label} aria-label={priority.label} role="img" />
                        <div className="funnel-patient-text">
                          <Link to={`/pacientes/${patient.id}`} className="funnel-patient-name">{patient.name}</Link>
                          <span className="funnel-muted">{formatBrazilPhone(patient.phone) || "Sem telefone"}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="funnel-exam">{patient.nextExam.name}</div>
                      <div className="funnel-muted">{describeExamDetail(patient)}</div>
                    </td>
                    <td className="funnel-ga">{formatGestationalAge(patient)}</td>
                    <td><span className={`funnel-stage-chip funnel-stage-chip-${stageId}`}>{stageTitle}</span></td>
                    <td className="funnel-muted">{describeLastContact(patient.lastContactAt, today)}</td>
                    <td className="funnel-actions-col">
                      <div className="funnel-actions">
                        <a className="funnel-whatsapp" href={buildWhatsAppHref(patient)} target="_blank" rel="noreferrer" aria-label={`Abrir WhatsApp de ${patient.name}`}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20l1.3-5.1A8.4 8.4 0 1 1 21 11.5z" />
                          </svg>
                        </a>
                        <Link className="funnel-open" to={`/pacientes/${patient.id}`}>Ficha</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visibleRows.length ? (
            <p className="empty-state funnel-empty">
              {hasFilters ? "Nenhuma paciente com esses filtros." : "Nenhuma paciente nesta etapa."}
            </p>
          ) : null}
        </div>
      </article>
    </section>
  );
}
