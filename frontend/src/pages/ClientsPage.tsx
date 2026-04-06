import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import { getStoredUser } from "../services/auth";
import type { Patient } from "../types";
import { getPatientPriorityMeta, type PriorityFilter } from "../utils/patientPriority";
import { formatBrazilPhone } from "../utils/phone";

export function ClientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingPatientId, setDeletingPatientId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "dpp">("name");
  const [highRiskFilter, setHighRiskFilter] = useState<"todas" | "alto_risco" | "habitual">("todas");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("todas");
  const [statusFilter, setStatusFilter] = useState("");
  const storedUser = getStoredUser();
  const isAdmin = storedUser?.role === "admin";

  useEffect(() => {
    let cancelled = false;

    async function loadPatients() {
      try {
        const response = await api.getPatients();
        if (!cancelled) {
          setPatients(response.patients);
          setErrorMessage(null);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel carregar os clientes.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPatients();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDeletePatient(patient: Patient) {
    const confirmed = window.confirm(`Excluir a paciente ${patient.name}? Essa acao nao pode ser desfeita.`);
    if (!confirmed) {
      return;
    }

    setDeletingPatientId(patient.id);
    setFeedback(null);
    setErrorMessage(null);

    try {
      await api.deletePatient(patient.id);
      setPatients((currentPatients) => currentPatients.filter((item) => item.id !== patient.id));
      setFeedback(`Paciente ${patient.name} excluida com sucesso.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Nao foi possivel excluir a paciente.");
    } finally {
      setDeletingPatientId(null);
    }
  }

  const filteredPatients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const matchingPatients = patients.filter((patient) => {
      const matchesSearch =
        !normalizedSearch ||
        `${patient.name} ${patient.phone}`.toLowerCase().includes(normalizedSearch);

      const matchesHighRisk =
        highRiskFilter === "todas" ||
        (highRiskFilter === "alto_risco" ? Boolean(patient.highRisk) : !patient.highRisk);

      const matchesUnit = !unitFilter || patient.clinicUnit === unitFilter;
      const matchesPhysician = !physicianFilter || patient.physicianName === physicianFilter;
      const matchesPriority =
        priorityFilter === "todas" || getPatientPriorityMeta(patient).color === priorityFilter;
      const matchesStatus = !statusFilter || patient.stage === statusFilter;

      return (
        matchesSearch &&
        matchesHighRisk &&
        matchesUnit &&
        matchesPhysician &&
        matchesPriority &&
        matchesStatus
      );
    });

    return [...matchingPatients].sort((left, right) => {
      if (sortBy === "dpp") {
        const leftDate = left.dpp || "";
        const rightDate = right.dpp || "";

        if (leftDate && rightDate && leftDate !== rightDate) {
          return leftDate.localeCompare(rightDate);
        }

        if (leftDate && !rightDate) return -1;
        if (!leftDate && rightDate) return 1;
      }

      return left.name.localeCompare(right.name, "pt-BR");
    });
  }, [patients, physicianFilter, priorityFilter, search, sortBy, statusFilter, unitFilter, highRiskFilter]);

  const unitOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.clinicUnit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );

  const physicianOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.physicianName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );

  const statusOptions = useMemo(() => {
    const stages = new Map<string, string>();
    patients.forEach((patient) => {
      if (patient.stage) {
        stages.set(patient.stage, patient.stageTitle ?? patient.stage);
      }
    });
    return [...stages.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [patients]);

  if (loading) {
    return <p className="loading-text">Carregando clientes...</p>;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h2>Clientes</h2>
          <p className="page-description">
            Lista operacional das pacientes cadastradas, com acesso rapido aos dados principais e aos detalhes.
          </p>
        </div>
        <Link to="/pacientes/novo" className="secondary-button">
          Novo cliente
        </Link>
      </div>

      {feedback ? <div className="form-alert form-alert-success"><span>{feedback}</span></div> : null}
      {errorMessage ? <div className="form-alert form-alert-error"><span>{errorMessage}</span></div> : null}

      <div className="toolbar-row">
        <input
          type="search"
          placeholder="Buscar por nome ou telefone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={highRiskFilter} onChange={(event) => setHighRiskFilter(event.target.value as "todas" | "alto_risco" | "habitual")}>
          <option value="todas">Todas as pacientes</option>
          <option value="alto_risco">Somente alto risco</option>
          <option value="habitual">Somente risco habitual</option>
        </select>
        <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
          <option value="">Todas as unidades</option>
          {unitOptions.map((unit) => (
            <option key={String(unit)} value={String(unit)}>{String(unit)}</option>
          ))}
        </select>
        <select value={physicianFilter} onChange={(event) => setPhysicianFilter(event.target.value)}>
          <option value="">Todos os medicos</option>
          {physicianOptions.map((physician) => (
            <option key={String(physician)} value={String(physician)}>{String(physician)}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}>
          <option value="todas">Todas as prioridades</option>
          <option value="vermelho">Vermelho</option>
          <option value="laranja">Laranja</option>
          <option value="amarelo">Amarelo</option>
          <option value="verde">Verde</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Todas as etapas</option>
          {statusOptions.map(([stage, label]) => (
            <option key={stage} value={stage}>{label}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "name" | "dpp")}>
          <option value="name">Ordenar por nome</option>
          <option value="dpp">Ordenar por DPP</option>
        </select>
      </div>

      <article className="panel-card clients-list-card">
        {filteredPatients.length ? (
          <div className="clients-table-wrapper">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>DPP</th>
                  <th>Telefone</th>
                  <th aria-label="Acoes" />
                </tr>
              </thead>
              <tbody>
                {filteredPatients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <div className="clients-primary-cell">
                        <strong>{patient.name}</strong>
                        <div className="clients-badge-row">
                          {patient.gestationalBaseIsEstimated ? (
                            <span className="badge badge-soft badge-priority-blue clients-status-badge">Base estimada</span>
                          ) : null}
                          {patient.gestationalReviewRequired ? (
                            <span className="badge badge-soft badge-priority-red clients-status-badge">Revisao da base</span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>{patient.estimatedDueDate || "Nao informada"}</td>
                    <td>{formatBrazilPhone(patient.phone) || "Nao informado"}</td>
                    <td className="clients-actions-cell">
                      <div className="clients-actions-group">
                        <Link to={`/pacientes/${patient.id}`} className="secondary-button">
                          Ver detalhes
                        </Link>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="ghost-button danger-button"
                            onClick={() => handleDeletePatient(patient)}
                            disabled={deletingPatientId === patient.id}
                          >
                            {deletingPatientId === patient.id ? "Excluindo..." : "Excluir"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="clients-empty-state">
            <p className="empty-state">
              {patients.length
                ? "Nenhum cliente encontrado com essa busca."
                : "Nenhum cliente cadastrado ainda."}
            </p>
            {!patients.length ? (
              <Link to="/pacientes/novo" className="secondary-button">
                Cadastrar paciente
              </Link>
            ) : null}
          </div>
        )}
      </article>
    </section>
  );
}
