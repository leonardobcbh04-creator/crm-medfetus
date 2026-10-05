import test from "node:test";
import assert from "node:assert/strict";
import {
  extractBabyAgeFromDescription,
  normalizeContactHistoryFilters,
  normalizeContactHistoryRow,
  summarizeContactHistory
} from "./contactHistory.js";

const base = { id: 1, createdAt: "2026-10-01T12:00:00.000Z", createdAtLabel: "01/10/2026 09:00", actorUserId: 2, actorName: "Recepcao", patientId: 10, currentPatientName: "Nome Atual" };

test("registro novo usa o contexto gravado no details_json", () => {
  const row = normalizeContactHistoryRow({
    ...base,
    actionType: "vacina_contatada",
    description: "Paciente marcada como contatada na tela Vacinas.",
    detailsJson: JSON.stringify({ board: "dtpa", patientName: "Nome Na Marcacao", gestationalAgeLabel: "25s0d", section: "B" })
  });
  assert.equal(row.patientName, "Nome Na Marcacao");
  assert.equal(row.boardLabel, "Gestante dTpa");
  assert.equal(row.actionLabel, "Contatada");
  assert.equal(row.gestationalAgeLabel, "25s0d");
  assert.equal(row.sectionLabel, "Ja podem vacinar");
});

test("registro antigo: nome atual da paciente e idade do bebe tirada da descricao", () => {
  const row = normalizeContactHistoryRow({
    ...base,
    actionType: "vacina_bebe_contato_desfeito",
    description: "Marca de contato das vacinas do bebe (12 meses) removida.",
    detailsJson: null
  });
  assert.equal(row.patientName, "Nome Atual");
  assert.equal(row.board, "bebe");
  assert.equal(row.ageMonths, 12);
  assert.equal(row.boardLabel, "Bebê 12 meses");
  assert.equal(row.actionLabel, "Marca desfeita");
  assert.equal(extractBabyAgeFromDescription("Mae contatada sobre as vacinas do bebe (1 meses)."), 1);
  assert.equal(normalizeContactHistoryRow({ ...base, currentPatientName: null, actionType: "vacina_contatada", description: "", detailsJson: null }).patientName, "Paciente excluida");
});

test("resumo por funcionaria desconta as marcas desfeitas e separa gestantes e bebes", () => {
  const rows = [
    { actorUserId: 1, actorName: "Ana", board: "dtpa", action: "contatada" },
    { actorUserId: 1, actorName: "Ana", board: "dtpa", action: "contatada" },
    { actorUserId: 1, actorName: "Ana", board: "dtpa", action: "desfeita" },
    { actorUserId: 1, actorName: "Ana", board: "bebe", action: "contatada" },
    { actorUserId: 2, actorName: "Bia", board: "bebe", action: "desfeita" }
  ];
  assert.deepEqual(summarizeContactHistory(rows), [
    { actorUserId: 1, actorName: "Ana", dtpa: 1, bebe: 1, total: 2 },
    { actorUserId: 2, actorName: "Bia", dtpa: 0, bebe: 0, total: 0 }
  ]);
});

test("filtros: padrao ultimos 30 dias, paginacao e exportacao", () => {
  const defaults = normalizeContactHistoryFilters({}, "2026-10-05");
  assert.equal(defaults.to, "2026-10-05");
  assert.equal(defaults.from, "2026-09-06");
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 50);
  const custom = normalizeContactHistoryFilters({ from: "2026-09-01", to: "2026-09-30", actorUserId: "2", type: "bebe", page: "3", pageSize: "500" }, "2026-10-05");
  assert.deepEqual([custom.actorUserId, custom.type, custom.page, custom.pageSize], [2, "bebe", 3, 200]);
  assert.equal(normalizeContactHistoryFilters({ all: "1" }, "2026-10-05").pageSize, 10000);
  assert.equal(normalizeContactHistoryFilters({ type: "outro" }, "2026-10-05").type, null);
  assert.throws(() => normalizeContactHistoryFilters({ from: "2026-10-05", to: "2026-10-01" }), /data inicial/);
  assert.throws(() => normalizeContactHistoryFilters({ actorUserId: "abc" }), /Funcionaria invalida/);
});
