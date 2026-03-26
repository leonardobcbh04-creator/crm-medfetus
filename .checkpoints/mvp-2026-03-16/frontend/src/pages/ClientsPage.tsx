import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../services/api";
import type { Patient } from "../types";

export function ClientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "dpp">("name");
  const [highRiskFilter, setHighRiskFilter] = useState<"todas" | "alto_risco" | "habitual">("todas");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPatients() {
      try {
        const response = await api.getPatients();
        if (!cancelled) {
          setPatients(response.patients);
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

      return matchesSearch && matchesHighRisk && matchesUnit && matchesPhysician;
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
  }, [patients, search, sortBy, highRiskFilter, unitFilter, physicianFilter]);

  const unitOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.clinicUnit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );

  const physicianOptions = useMemo(
    () => [...new Set(patients.map((patient) => patient.physicianName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [patients]
  );

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
                      </div>
                    </td>
                    <td>{patient.estimatedDueDate || "Nao informada"}</td>
                    <td>{patient.phone || "Nao informado"}</td>
                    <td className="clients-actions-cell">
                      <Link to={`/pacientes/${patient.id}`} className="secondary-button">
                        Ver detalhes
                      </Link>
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
