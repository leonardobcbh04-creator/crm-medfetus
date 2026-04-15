import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatCard } from "../components/StatCard";
import { api } from "../services/api";
import type { DashboardData, DashboardFilters, Patient } from "../types";
import { getPatientPriorityMeta } from "../utils/patientPriority";

const DEFAULT_FILTERS: DashboardFilters = {
  period: "7d",
  dateFrom: "",
  dateTo: "",
  clinicUnit: "",
  physicianName: ""
};

function formatPercent(value: number) {
  return `${value}%`;
}

function formatDateRangeLabel(filters: DashboardFilters) {
  if (filters.dateFrom && filters.dateTo) {
    return `${filters.dateFrom} ate ${filters.dateTo}`;
  }
  return "Periodo selecionado";
}

function MiniPatientList({ title, patients, emptyMessage }: { title: string; patients: Patient[]; emptyMessage: string }) {
  return (
    <article className="panel-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Lista</p>
          <h3>{title}</h3>
        </div>
      </div>

      <div className="list-grid">
        {patients.length ? patients.map((patient) => {
          const priority = getPatientPriorityMeta(patient);

          return (
            <Link key={patient.id} to={`/pacientes/${patient.id}`} className="dashboard-patient-item">
              <div>
                <strong>{patient.name}</strong>
                <p>{patient.nextExam.name}</p>
              </div>
              <span className={`badge ${priority.badgeClassName}`}>{priority.badgeText}</span>
            </Link>
          );
        }) : <p className="empty-state">{emptyMessage}</p>}
      </div>
    </article>
  );
}

function CompactCountList({
  title,
  eyebrow,
  description,
  items,
  emptyMessage
}: {
  title: string;
  eyebrow: string;
  description: string;
  items: Array<{ label: string; total: number }>;
  emptyMessage: string;
}) {
  return (
    <article className="panel-card dashboard-list-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p className="page-description">{description}</p>
        </div>
      </div>

      <div className="list-grid">
        {items.length ? items.map((item) => (
          <div key={item.label} className="priority-item">
            <strong>{item.label}</strong>
            <span className="badge badge-soft badge-priority-blue">{item.total}</span>
          </div>
        )) : <p className="empty-state">{emptyMessage}</p>}
      </div>
    </article>
  );
}

function SimpleBarChart({
  title,
  subtitle,
  points,
  keys
}: {
  title: string;
  subtitle: string;
  points: Array<{ label: string; messages?: number; scheduled?: number; completed?: number; total?: number }>;
  keys: Array<{ id: "messages" | "scheduled" | "completed" | "total"; label: string; className: string }>;
}) {
  const maxValue = useMemo(
    () =>
      Math.max(
        1,
        ...points.flatMap((point) => keys.map((key) => Number(point[key.id] || 0)))
      ),
    [keys, points]
  );
  const totals = useMemo(
    () =>
      keys.map((key) => ({
        ...key,
        total: points.reduce((accumulator, point) => accumulator + Number(point[key.id] || 0), 0)
      })),
    [keys, points]
  );

  return (
    <article className="panel-card dashboard-chart-card">
      <div className="page-header">
        <div>
          <p className="eyebrow">Grafico</p>
          <h3>{title}</h3>
          <p className="page-description">{subtitle}</p>
        </div>
      </div>

      <div className="chart-legend">
        {keys.map((key) => (
          <span key={key.id} className="chart-legend-item">
            <span className={`chart-dot ${key.className}`} />
            {key.label}
          </span>
        ))}
      </div>

      <div className="chart-summary-row">
        {totals.map((item) => (
          <div key={item.id} className="chart-summary-pill">
            <span className={`chart-dot ${item.className}`} />
            <strong>{item.total}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="chart-list">
        {points.map((point) => (
          <div key={point.label} className="chart-group">
            <div className="chart-group-bars">
              {keys.map((key) => {
                const value = Number(point[key.id] || 0);
                return (
                  <div
                    key={key.id}
                    className={`chart-bar-vertical ${key.className}`}
                    style={{ height: `${Math.max(12, (value / maxValue) * 100)}%` }}
                    title={`${key.label}: ${value}`}
                  >
                    <span className="chart-bar-value">{value}</span>
                  </div>
                );
              })}
            </div>
            <span className="chart-group-label">{point.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard(DEFAULT_FILTERS);
  }, []);

  async function loadDashboard(currentFilters: DashboardFilters) {
    setLoading(true);
    try {
      const response = await api.getDashboard(currentFilters);
      setDashboard(response);
    } finally {
      setLoading(false);
    }
  }

  function updateFilter<K extends keyof DashboardFilters>(field: K, value: DashboardFilters[K]) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  async function handleApplyFilters() {
    await loadDashboard(filters);
  }

  async function handleResetFilters() {
    setFilters(DEFAULT_FILTERS);
    await loadDashboard(DEFAULT_FILTERS);
  }

  if (loading && !dashboard) {
    return <p className="loading-text">Carregando dashboard...</p>;
  }

  if (!dashboard) {
    return <p className="loading-text">Nao foi possivel carregar os dados do dashboard.</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Visao geral</p>
          <h2>Painel da clinica</h2>
          <p className="page-description">
            Indicadores operacionais para acompanhar contato, agendamento e exames realizados.
          </p>
        </div>
      </div>

      <article className="panel-card stack-form filter-panel">
        <div className="form-section-header">
          <p className="muted-label">Filtros</p>
            <p className="field-hint">Use periodo, unidade e medico para refinar a visao da operacao.</p>
        </div>

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
              {dashboard.filterOptions.clinicUnits.map((unit) => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </label>

          <label>
            Medico
            <select value={filters.physicianName} onChange={(event) => updateFilter("physicianName", event.target.value)}>
              <option value="">Todos</option>
              {dashboard.filterOptions.physicians.map((physician) => (
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
          <button className="primary-button" type="button" onClick={handleApplyFilters}>
            Aplicar filtros
          </button>
          <button className="secondary-button" type="button" onClick={handleResetFilters}>
            Limpar filtros
          </button>
          <span className="field-hint">Periodo analisado: {formatDateRangeLabel(dashboard.filters)}</span>
        </div>
      </article>

      <div className="stats-grid dashboard-stats-grid">
        <StatCard
          label="Central de lembretes"
          value={dashboard.summary.remindersDueToday}
          description="Pacientes que precisam de contato hoje"
          to="/lembretes"
        />
        <StatCard
          label="Revisao da base"
          value={dashboard.summary.gestationalBaseManualReview}
          description="Pacientes que precisam revisar a base gestacional"
          to="/revisao-base-gestacional"
        />
        <StatCard label="Exame em atraso" value={dashboard.summary.overduePatients} description="Pacientes com exame fora do prazo" />
        <StatCard label="Aguardando agendamento" value={dashboard.summary.patientsAwaitingScheduling} description="Pacientes em retorno ou follow-up" />
        <StatCard label="Ja agendadas" value={dashboard.summary.scheduledPatients} description="Pacientes na etapa de agendamento" />
        <StatCard label="Exames nesta semana" value={dashboard.summary.examsThisWeek} description="Pacientes com janela ideal nos proximos 7 dias" />
        <StatCard label="Agendadas na semana" value={dashboard.summary.scheduledThisWeek} description="Pacientes com exame marcado ate 7 dias" />
        <StatCard label="Contatos hoje" value={dashboard.summary.contactsRegisteredToday} description="Contatos registrados pela equipe hoje" />
        <StatCard label="Agendamentos hoje" value={dashboard.summary.appointmentsConfirmedToday} description="Agendamentos confirmados hoje" />
        <StatCard label="Conversao" value={dashboard.summary.conversionRate} description="Contato convertido em agendamento" />
        <StatCard label="Mensagens enviadas" value={dashboard.summary.totalMessagesSent} description="Mensagens no periodo filtrado" />
        <StatCard label="Exames realizados" value={dashboard.summary.totalExamsCompleted} description="Realizados no periodo filtrado" />
      </div>

      <div className="dashboard-grid">
        <CompactCountList
          eyebrow="Fluxo"
          title="Pacientes por etapa"
          description="Distribuicao atual do fluxo de atendimento."
          items={dashboard.breakdowns.patientsByStage.map((item) => ({ label: item.stageTitle, total: item.total }))}
            emptyMessage="Nenhuma etapa encontrada com os filtros atuais."
        />

        <CompactCountList
          eyebrow="Prioridade"
          title="Pacientes por prioridade"
          description="Resumo rapido das prioridades operacionais."
          items={dashboard.breakdowns.patientsByPriority.map((item) => ({ label: item.label, total: item.total }))}
            emptyMessage="Nenhuma prioridade encontrada com os filtros atuais."
        />

        <MiniPatientList
          title="Pacientes para contato hoje"
          patients={dashboard.lists.patientsToContactToday}
            emptyMessage="Nenhuma paciente precisa de contato hoje."
        />

        <MiniPatientList
          title="Pacientes atrasadas"
          patients={dashboard.lists.overduePatients}
            emptyMessage="Nenhuma paciente em atraso com os filtros atuais."
        />

        <MiniPatientList
          title="Pacientes agendadas na semana"
          patients={dashboard.lists.scheduledThisWeek}
          emptyMessage="Nenhuma paciente agendada nesta semana."
        />
      </div>
    </section>
  );
}
