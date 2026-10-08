import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { PageSkeleton } from "../components/PageSkeleton";
import { getStoredUser } from "../services/auth";
import type { Patient } from "../types";
import { getPatientPriorityMeta, type PriorityFilter } from "../utils/patientPriority";
import { formatBrazilPhone } from "../utils/phone";

// Tela "Pacientes": abas Ativas / Encerradas / Todas, busca, filtros recolhidos e
// uma linha por paciente (prazo, IG, DPP, proximo exame, situacao e telefone).

type StatusTab = "ativas" | "encerradas" | "todas";
type SortKey = "name" | "dpp" | "ig";

const CLOSURE_SHORT_LABELS: Record<string, string> = {
  parto_realizado: "parto",
  perda_gestacional: "perda",
  transferencia: "transferencia",
  desistencia: "desistencia"
};

function isClosed(patient: Patient) {
  return patient.status === "encerrada";
}

function gestationalDays(patient: Patient) {
  if (patient.gestationalWeeks === null || patient.gestationalWeeks === undefined) return null;
  return patient.gestationalWeeks * 7 + (patient.gestationalDays ?? 0);
}

function formatGestationalAge(patient: Patient) {
  if (isClosed(patient)) return "-";
  if (patient.gestationalWeeks === null || patient.gestationalWeeks === undefined) return "-";
  return `${patient.gestationalWeeks}s${patient.gestationalDays ?? 0}d`;
}

function describeNextExam(patient: Patient) {
  if (isClosed(patient) || !patient.nextExam?.code) return "-";
  return patient.nextExam.scheduledDateLabel
    ? `${patient.nextExam.name} · ${patient.nextExam.scheduledDateLabel}`
    : patient.nextExam.name;
}

function describeSituation(patient: Patient) {
  if (isClosed(patient)) {
    const short = patient.closureReason ? CLOSURE_SHORT_LABELS[patient.closureReason] : null;
    return { label: short ? `Encerrada · ${short}` : "Encerrada", className: "clients-chip-closed" };
  }
  if (patient.gestationalReviewRequired) {
    return { label: "Revisao da base", className: "clients-chip-review" };
  }
  return { label: patient.stageTitle || patient.stage, className: `funnel-stage-chip-${patient.stage}` };
}

export function ClientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingPatientId, setDeletingPatientId] = useState<number | null>(null);
  const [menuPatientId, setMenuPatientId] = useState<number | null>(null);
  // Posicao do menu "..." na tela (fica flutuando, sem ser cortado pela tabela).
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>("ativas");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [highRiskFilter, setHighRiskFilter] = useState<"todas" | "alto_risco" | "habitual">("todas");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("todas");
  const [stageFilter, setStageFilter] = useState("");
  const isAdmin = getStoredUser()?.role === "admin";

  useEffect(() => {
    let cancelled = false;
    api.getPatients()
      .then((response) => {
        if (!cancelled) {
          setPatients(response.patients);
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel carregar as pacientes.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (menuPatientId === null) {
      return;
    }
    const close = () => setMenuPatientId(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuPatientId]);

  async function handleDeletePatient(patient: Patient) {
    setMenuPatientId(null);
    if (!window.confirm(`Excluir a paciente ${patient.name}? Essa acao nao pode ser desfeita.`)) {
      return;
    }
    setDeletingPatientId(patient.id);
    setFeedback(null);
    setErrorMessage(null);
    try {
      await api.deletePatient(patient.id);
      setPatients((current) => current.filter((item) => item.id !== patient.id));
      setFeedback(`Paciente ${patient.name} excluida com sucesso.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel excluir a paciente.");
    } finally {
      setDeletingPatientId(null);
    }
  }

  const counts = useMemo(() => {
    const closed = patients.filter(isClosed).length;
    return { ativas: patients.length - closed, encerradas: closed, todas: patients.length };
  }, [patients]);

  const filteredPatients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const matching = patients.filter((patient) => {
      if (statusTab === "ativas" && isClosed(patient)) return false;
      if (statusTab === "encerradas" && !isClosed(patient)) return false;
      if (normalizedSearch && !`${patient.name} ${patient.phone} ${patient.clinicPatientId || ""}`.toLowerCase().includes(normalizedSearch)) return false;
      if (highRiskFilter === "alto_risco" && !patient.highRisk) return false;
      if (highRiskFilter === "habitual" && patient.highRisk) return false;
      if (unitFilter && patient.clinicUnit !== unitFilter) return false;
      if (physicianFilter && patient.physicianName !== physicianFilter) return false;
      if (priorityFilter !== "todas" && getPatientPriorityMeta(patient).color !== priorityFilter) return false;
      if (stageFilter && (isClosed(patient) || patient.stage !== stageFilter)) return false;
      return true;
    });

    return [...matching].sort((left, right) => {
      if (sortBy === "dpp") {
        const leftDate = left.dpp || "";
        const rightDate = right.dpp || "";
        if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
        if (leftDate && !rightDate) return -1;
        if (!leftDate && rightDate) return 1;
      }
      if (sortBy === "ig") {
        // Mais adiantadas primeiro; encerradas e sem IG no fim.
        const leftDays = isClosed(left) ? null : gestationalDays(left);
        const rightDays = isClosed(right) ? null : gestationalDays(right);
        if (leftDays !== null && rightDays !== null && leftDays !== rightDays) return rightDays - leftDays;
        if (leftDays !== null && rightDays === null) return -1;
        if (leftDays === null && rightDays !== null) return 1;
      }
      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [patients, statusTab, search, highRiskFilter, unitFilter, physicianFilter, priorityFilter, stageFilter, sortBy]);

  const unitOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.clinicUnit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );
  const physicianOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.physicianName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );
  const stageOptions = useMemo(() => {
    const stages = new Map<string, string>();
    patients.filter((patient) => !isClosed(patient)).forEach((patient) => {
      if (patient.stage) stages.set(patient.stage, patient.stageTitle ?? patient.stage);
    });
    return [...stages.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [patients]);

  const extraFiltersCount = [highRiskFilter !== "todas", unitFilter, physicianFilter, priorityFilter !== "todas", stageFilter].filter(Boolean).length;
  const hasFilters = Boolean(search || extraFiltersCount);

  function clearFilters() {
    setSearch("");
    setHighRiskFilter("todas");
    setUnitFilter("");
    setPhysicianFilter("");
    setPriorityFilter("todas");
    setStageFilter("");
  }

  if (loading) {
    return <PageSkeleton cards={5} />;
  }

  const tabs: Array<{ id: StatusTab; label: string }> = [
    { id: "ativas", label: `Ativas (${counts.ativas})` },
    { id: "encerradas", label: `Encerradas (${counts.encerradas})` },
    { id: "todas", label: `Todas (${counts.todas})` }
  ];
  const sorts: Array<{ id: SortKey; label: string }> = [
    { id: "name", label: "Nome" },
    { id: "dpp", label: "DPP" },
    { id: "ig", label: "IG" }
  ];

  return (
    <section className="page-section funnel-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h2>Pacientes</h2>
          <p className="page-description">Todas as pacientes cadastradas. Clique no nome para abrir a ficha.</p>
        </div>
        <Link to="/pacientes/importar" className="ficha-outline-button clients-import-button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          Importar planilha
        </Link>
      </div>

      {feedback ? <div className="form-alert form-alert-success"><span>{feedback}</span></div> : null}
      {errorMessage ? <div className="form-alert form-alert-error"><span>{errorMessage}</span></div> : null}

      <article className="funnel-panel">
        <div className="clients-tabs" role="tablist" aria-label="Situacao do acompanhamento">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={statusTab === tab.id}
              className={`clients-tab ${statusTab === tab.id ? "active" : ""}`}
              onClick={() => {
                setStatusTab(tab.id);
                setMenuPatientId(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="funnel-toolbar">
          <label className="funnel-visually-hidden" htmlFor="clients-search">Buscar paciente</label>
          <input
            id="clients-search"
            type="search"
            className="funnel-search"
            placeholder="Buscar por nome, telefone ou ID da clinica"
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
          <div className="clients-sort" role="group" aria-label="Ordenar">
            <span>Ordenar:</span>
            {sorts.map((sort) => (
              <button
                key={sort.id}
                type="button"
                aria-pressed={sortBy === sort.id}
                className={`clients-sort-button ${sortBy === sort.id ? "active" : ""}`}
                onClick={() => setSortBy(sort.id)}
              >
                {sort.label}
              </button>
            ))}
          </div>
        </div>

        {filtersOpen ? (
          <div className="funnel-extra-filters">
            <label>
              Unidade
              <select id="clients-unit" value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                <option value="">Todas as unidades</option>
                {unitOptions.map((unit) => <option key={String(unit)} value={String(unit)}>{String(unit)}</option>)}
              </select>
            </label>
            <label>
              Medico
              <select id="clients-physician" value={physicianFilter} onChange={(event) => setPhysicianFilter(event.target.value)}>
                <option value="">Todos os medicos</option>
                {physicianOptions.map((name) => <option key={String(name)} value={String(name)}>{String(name)}</option>)}
              </select>
            </label>
            <label>
              Risco
              <select id="clients-risk" value={highRiskFilter} onChange={(event) => setHighRiskFilter(event.target.value as "todas" | "alto_risco" | "habitual")}>
                <option value="todas">Todas</option>
                <option value="alto_risco">Alto risco</option>
                <option value="habitual">Risco habitual</option>
              </select>
            </label>
            <label>
              Prazo do exame
              <select id="clients-priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
                <option value="todas">Todos</option>
                <option value="vermelho">Atrasado</option>
                <option value="laranja">Contatar ja</option>
                <option value="amarelo">Janela proxima</option>
                <option value="verde">No prazo</option>
              </select>
            </label>
            <label>
              Etapa
              <select id="clients-stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
                <option value="">Todas as etapas</option>
                {stageOptions.map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        <div className="funnel-summary">
          <span>
            {filteredPatients.length} paciente(s)
            {statusTab === "ativas" ? " em acompanhamento" : statusTab === "encerradas" ? " com acompanhamento encerrado" : ""}
          </span>
          {hasFilters ? <button type="button" className="ghost-button funnel-clear" onClick={clearFilters}>Limpar filtros</button> : null}
        </div>

        <div className="funnel-table-wrapper clients-table-box">
          <table className="funnel-table clients-list-table">
            <thead>
              <tr>
                <th scope="col">Paciente</th>
                <th scope="col">IG</th>
                <th scope="col">DPP</th>
                <th scope="col">Proximo exame</th>
                <th scope="col">Situacao</th>
                <th scope="col">Telefone</th>
                <th scope="col" className="funnel-actions-col">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredPatients.map((patient) => {
                const closed = isClosed(patient);
                const priority = getPatientPriorityMeta(patient);
                const situation = describeSituation(patient);
                const menuOpen = menuPatientId === patient.id;
                return (
                  <tr key={patient.id}>
                    <td>
                      <div className="funnel-patient">
                        <span
                          className={`funnel-dot funnel-dot-${closed ? "cinza" : priority.color}`}
                          title={closed ? "Acompanhamento encerrado" : priority.label}
                          aria-label={closed ? "Acompanhamento encerrado" : priority.label}
                          role="img"
                        />
                        <div className="funnel-patient-text">
                          <Link to={`/pacientes/${patient.id}`} className="funnel-patient-name">{patient.name}</Link>
                          <span className="funnel-muted">
                            {patient.clinicPatientId ? `ID ${patient.clinicPatientId}` : "Sem ID da clinica"}
                            {patient.highRisk ? " · alto risco" : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="funnel-ga">{formatGestationalAge(patient)}</td>
                    <td>{patient.dpp ? patient.estimatedDueDate : "-"}</td>
                    <td>{describeNextExam(patient)}</td>
                    <td><span className={`funnel-stage-chip ${situation.className}`}>{situation.label}</span></td>
                    <td className="funnel-muted">{formatBrazilPhone(patient.phone) || "Sem telefone"}</td>
                    <td className="funnel-actions-col">
                      <div className="funnel-actions clients-actions">
                        <Link className="funnel-open" to={`/pacientes/${patient.id}`}>Ficha</Link>
                        <button
                          type="button"
                          className="clients-more-button"
                          aria-label={`Mais opcoes para ${patient.name}`}
                          aria-expanded={menuOpen}
                          onClick={(event) => {
                            if (menuOpen) {
                              setMenuPatientId(null);
                              return;
                            }
                            const rect = event.currentTarget.getBoundingClientRect();
                            const menuHeight = 120;
                            const top = rect.bottom + 6 + menuHeight > window.innerHeight ? rect.top - 6 - menuHeight : rect.bottom + 6;
                            setMenuPosition({ top: Math.max(8, top), right: Math.max(8, window.innerWidth - rect.right) });
                            setMenuPatientId(patient.id);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="19" cy="12" r="1.8" />
                          </svg>
                        </button>
                        {menuOpen ? (
                          <div
                            className="ficha-menu clients-row-menu"
                            role="menu"
                            style={menuPosition ? { top: menuPosition.top, right: menuPosition.right } : undefined}
                          >
                            <Link role="menuitem" className="ficha-menu-item" to={`/pacientes/${patient.id}/editar`}>Editar dados</Link>
                            {isAdmin ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="ficha-menu-item ficha-menu-danger"
                                disabled={deletingPatientId === patient.id}
                                onClick={() => void handleDeletePatient(patient)}
                              >
                                {deletingPatientId === patient.id ? "Excluindo..." : "Excluir paciente"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredPatients.length ? (
            <div className="funnel-empty clients-empty">
              <p className="empty-state">
                {patients.length ? "Nenhuma paciente encontrada com esses filtros." : "Nenhuma paciente cadastrada ainda."}
              </p>
              {patients.length && hasFilters ? (
                <button type="button" className="ficha-action-button" onClick={clearFilters}>Limpar filtros</button>
              ) : null}
              {!patients.length ? (
                <Link to="/pacientes/importar" className="ficha-action-button clients-empty-link">Importar planilha</Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}
