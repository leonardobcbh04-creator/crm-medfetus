import { useEffect, useMemo, useState } from "react";
import { KanbanBoard } from "../components/KanbanBoard";
import { api } from "../services/api";
import type { KanbanColumn } from "../types";
import { getPatientPriorityMeta, type PriorityFilter } from "../utils/patientPriority";

export function KanbanPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("todas");
  const [unitFilter, setUnitFilter] = useState("");
  const [physicianFilter, setPhysicianFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    loadKanban();
  }, []);

  async function loadKanban() {
    setLoading(true);
    try {
      const response = await api.getKanban();
      setColumns(response.columns);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateColumn() {
    const title = window.prompt("Digite o nome da nova etapa do fluxo:");
    if (!title?.trim()) {
      return;
    }

    try {
      const response = await api.createKanbanColumn(title.trim());
      setColumns(response.columns);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Nao foi possivel criar a etapa.");
    }
  }

  async function handleRenameColumn(columnId: string, title: string) {
    try {
      const response = await api.updateKanbanColumn(columnId, title);
      setColumns(response.columns);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Nao foi possivel atualizar a etapa.");
    }
  }

  async function handleDeleteColumn(column: KanbanColumn) {
    try {
      const response = await api.deleteKanbanColumn(column.id);
      setColumns(response.columns);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Nao foi possivel excluir a etapa.");
    }
  }

  async function handleMove(patientId: number, fromStage: string, toStage: string) {
    if (fromStage === toStage) {
      return;
    }

    const patientToMove = columns.flatMap((column) => column.patients).find((patient) => patient.id === patientId);
    if (!patientToMove) {
      return;
    }

    setColumns((current) =>
      current.map((column) => {
        if (column.id === fromStage) {
          return { ...column, patients: column.patients.filter((patient) => patient.id !== patientId) };
        }
        if (column.id === toStage) {
          return { ...column, patients: [{ ...patientToMove, stage: toStage }, ...column.patients] };
        }
        return column;
      })
    );

    try {
      await api.moveKanbanPatient(patientId, toStage);
      const response = await api.getKanban();
      setColumns(response.columns);
    } catch (_error) {
      const response = await api.getKanban();
      setColumns(response.columns);
    }
  }

  async function handleRegisterMessage(patientId: number) {
    const patient = columns.flatMap((column) => column.patients).find((currentPatient) => currentPatient.id === patientId);
    if (!patient) {
      return;
    }

    const content =
      `Ola, ${patient.name}. Tudo bem? Aqui e da clinica obstetrica. ` +
      `Estamos entrando em contato sobre seu proximo exame: ${patient.nextExam.name}. ` +
      `${patient.nextExam.idealDate ? `A data ideal e ${patient.nextExam.idealDate}. ` : ""}` +
      "Se quiser, podemos ajudar com o agendamento.";

    try {
      await api.createMessage({
        patientId: patient.id,
        content
      });
      setFeedback(`Mensagem registrada para ${patient.name}.`);
      await loadKanban();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel registrar a mensagem.");
    }
  }

  const filteredColumns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return columns.map((column) => ({
      ...column,
      patients: column.patients.filter((patient) => {
        const matchesPriority =
          priorityFilter === "todas" || getPatientPriorityMeta(patient).color === priorityFilter;

        if (!matchesPriority) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        const haystack = `${patient.name} ${patient.phone} ${patient.nextExam.name}`.toLowerCase();
        const matchesSearch = haystack.includes(normalizedSearch);
        const matchesUnit = !unitFilter || patient.clinicUnit === unitFilter;
        const matchesPhysician = !physicianFilter || patient.physicianName === physicianFilter;
        const matchesStage = !stageFilter || column.id === stageFilter;

        return matchesSearch && matchesUnit && matchesPhysician && matchesStage;
      })
    }));
  }, [columns, physicianFilter, priorityFilter, search, stageFilter, unitFilter]);

  const allPatients = useMemo(() => columns.flatMap((column) => column.patients), [columns]);

  const unitOptions = useMemo(
    () => [...new Set(allPatients.map((patient) => patient.clinicUnit).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [allPatients]
  );

  const physicianOptions = useMemo(
    () => [...new Set(allPatients.map((patient) => patient.physicianName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR")),
    [allPatients]
  );

  return (
    <section className="page-section kanban-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Operacao</p>
          <h2>Fluxo de atendimento</h2>
          <p className="page-description">
            Organize o atendimento por etapa, priorize os casos mais sensiveis e acompanhe o proximo exame em tempo real.
          </p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void handleCreateColumn()}>
          Adicionar etapa
        </button>
      </div>

      <div className="toolbar-row">
        <input
          type="search"
          placeholder="Buscar por nome, telefone ou exame"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="priority-filter-bar">
          <button
            type="button"
            className={`priority-filter-chip ${priorityFilter === "todas" ? "active" : ""}`}
            onClick={() => setPriorityFilter("todas")}
          >
            Todas
          </button>
          <button
            type="button"
            className={`priority-filter-chip priority-filter-green ${priorityFilter === "verde" ? "active" : ""}`}
            onClick={() => setPriorityFilter("verde")}
          >
            Verde
          </button>
          <button
            type="button"
            className={`priority-filter-chip priority-filter-yellow ${priorityFilter === "amarelo" ? "active" : ""}`}
            onClick={() => setPriorityFilter("amarelo")}
          >
            Amarelo
          </button>
          <button
            type="button"
            className={`priority-filter-chip priority-filter-orange ${priorityFilter === "laranja" ? "active" : ""}`}
            onClick={() => setPriorityFilter("laranja")}
          >
            Laranja
          </button>
          <button
            type="button"
            className={`priority-filter-chip priority-filter-red ${priorityFilter === "vermelho" ? "active" : ""}`}
            onClick={() => setPriorityFilter("vermelho")}
          >
            Vermelho
          </button>
        </div>
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
        <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}>
          <option value="">Todas as etapas</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>{column.title}</option>
          ))}
        </select>
      </div>

      <div className="kanban-legend">
        <span className="kanban-legend-item kanban-legend-green">
          <strong>Verde</strong>
          <span>Dentro do prazo</span>
        </span>
        <span className="kanban-legend-item kanban-legend-yellow">
          <strong>Amarelo</strong>
          <span>Janela proxima</span>
        </span>
        <span className="kanban-legend-item kanban-legend-orange">
          <strong>Laranja</strong>
          <span>Precisa de contato</span>
        </span>
        <span className="kanban-legend-item kanban-legend-red">
          <strong>Vermelho</strong>
          <span>Exame em atraso</span>
        </span>
      </div>

      {feedback ? (
        <p className={feedback.includes("Nao foi") ? "form-error" : "form-success"}>{feedback}</p>
      ) : null}

      {loading ? (
        <p className="loading-text">Carregando fluxo de atendimento...</p>
      ) : (
        <KanbanBoard
          columns={filteredColumns}
          onMove={handleMove}
          onRenameColumn={handleRenameColumn}
          onDeleteColumn={handleDeleteColumn}
          onRegisterMessage={handleRegisterMessage}
        />
      )}
    </section>
  );
}
