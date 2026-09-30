import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  namesMatch,
  parseTimeValue,
  previewFutureScheduleImportCore,
  previewPatientImportCore
} from "./patientImportService.js";

// Monta uma aba no layout da planilha da recepcao: lixo nas linhas 1-7, cabecalho na
// linha 8, filler nas linhas 9-10 e dados a partir da linha 11. `phoneColumn` permite
// simular abas com o CELULAR em colunas diferentes (P = 15, Q = 16).
function buildReceptionSheet(rows, { phoneColumn = 16, monthLabel = "OUTUBRO/26" } = {}) {
  const header = [];
  header[0] = "DATA";
  header[1] = "HORÁRIO";
  header[2] = "NOME COMPLETO \nsem abreviações";
  header[3] = "ORIGEM DO PACIENTE";
  header[4] = "OBSERVAÇÃO";
  header[5] = "REGISTRO MEDFETUS";
  header[6] = "SENHA";
  header[8] = "EXAME";
  header[9] = "VALOR";
  header[phoneColumn] = "CELULAR DE CONTATO";
  header[19] = "IDADE GESTACIONAL";
  const grid = [
    ["", "D ", 0],
    ["", "P", 0],
    ["", "C", 0],
    ["", "D", 0],
    ["", "TG", 0],
    ["", "TR", 0],
    ["", "ACUMULADO", 0],
    Array.from({ length: 22 }, (_, index) => header[index] ?? ""),
    ["", "", ""],
    [monthLabel, "", ""]
  ];
  for (const row of rows) {
    const line = Array.from({ length: 22 }, () => "");
    line[0] = row.date ?? "";
    line[1] = row.time ?? "";
    line[2] = row.name ?? "";
    line[4] = row.obs ?? "";
    line[5] = row.registro ?? "";
    line[8] = row.exam ?? "";
    line[phoneColumn] = row.phone ?? "";
    line[19] = row.ig ?? "";
    grid.push(line);
    grid.push([row.date ?? ""]);
  }
  return XLSX.utils.aoa_to_sheet(grid);
}

function buildWorkbookBase64(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, sheet] of sheets) {
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64");
}

const automaticExamModels = [
  { id: 1, code: "obst_inicial", name: "Exame obstetrico inicial" },
  { id: 2, code: "morf_1", name: "Morfologico 1o trimestre" },
  { id: 3, code: "morf_2", name: "Morfologico 2o trimestre" },
  { id: 4, code: "eco", name: "Ecocardiograma fetal" },
  { id: 5, code: "doppler", name: "Doppler obstetrico" }
];

const patients = [
  { id: 10, name: "Maria Aparecida da Silva", phone: "31991112222", status: "ativa", closedAt: null },
  { id: 11, name: "Joana Souza", phone: "31993334444", status: "ativa", closedAt: null },
  { id: 12, name: "Carla Mendes", phone: "31995556666", status: "ativa", closedAt: null },
  { id: 13, name: "Paciente Encerrada", phone: "31997778888", status: "encerrada", closedAt: "2026-09-01" }
];

function examsFor(patientId, overrides = {}) {
  return automaticExamModels.map((model, index) => ({
    id: patientId * 100 + index,
    patientId,
    code: model.code,
    name: model.name,
    status: overrides[model.code]?.status ?? "pendente",
    scheduledDate: overrides[model.code]?.scheduledDate ?? null
  }));
}

const patientExams = [
  ...examsFor(10),
  ...examsFor(11),
  ...examsFor(12, { morf_2: { status: "realizado" } }),
  ...examsFor(13)
];

async function previewAgenda(sheets, today = "2026-09-30") {
  return previewFutureScheduleImportCore({
    fileName: "OUTUBRO_26.xlsx",
    fileBase64: buildWorkbookBase64(sheets),
    todayIso: today,
    patients,
    patientExams,
    automaticExamModels
  });
}

test("namesMatch aceita acento/caixa/conectivos e sobrenome do meio omitido", () => {
  assert.equal(namesMatch("MARIA APARECIDA DA SILVA", "Maria Aparecida da Silva"), true);
  assert.equal(namesMatch("MARIA SILVA", "Maria Aparecida da Silva"), true);
  assert.equal(namesMatch("Joána  Souza", "JOANA DE SOUZA"), true);
  assert.equal(namesMatch("MARIANA SILVA", "Maria Aparecida da Silva"), false);
  assert.equal(namesMatch("MARIA", "Maria Aparecida da Silva"), false);
});

test("parseTimeValue le horario do Excel (Date/fracao) e texto", () => {
  assert.equal(parseTimeValue(new Date("1899-12-30T08:30:00.000Z")), "08:30");
  assert.equal(parseTimeValue(new Date("1899-12-30T13:49:59.999Z")), "13:50");
  assert.equal(parseTimeValue(14.5 / 24), "14:30");
  assert.equal(parseTimeValue("8:50"), "08:50");
  assert.equal(parseTimeValue("09h10"), "09:10");
  assert.equal(parseTimeValue(""), null);
});

test("agenda futura: identifica pelo celular (coluna P ou Q), grava data da aba e horario", async () => {
  const preview = await previewAgenda([
    ["01-10", buildReceptionSheet([
      { date: "01/10/2026", time: 8.5 / 24, name: "MARIA APARECIDA DA SILVA", exam: "MORF. SEG. TRIM( 20 A 24 sem)", phone: "(31) 99111-2222" }
    ], { phoneColumn: 15 })],
    ["05-10", buildReceptionSheet([
      { date: "05/10/2026", time: "09:10", name: "JOANA SOUZA", exam: "ECOCARDIOGRAMA FETAL924 a 28 sem)", phone: "31 99333-4444" }
    ], { phoneColumn: 16 })]
  ]);

  assert.deepEqual(preview.scheduleDates, ["2026-10-01", "2026-10-05"]);
  assert.equal(preview.rows.length, 2);
  const [first, second] = preview.rows;
  assert.equal(first.status, "agendamento");
  assert.equal(first.registeredPatientId, 10);
  assert.equal(first.scheduleDate, "2026-10-01");
  assert.equal(first.scheduleTime, "08:30");
  assert.deepEqual(first.exams.map((exam) => exam.code), ["morf_2"]);
  assert.equal(first.rowKey, "01-10:11");

  assert.equal(second.status, "agendamento");
  assert.equal(second.registeredPatientId, 11);
  assert.equal(second.scheduleDate, "2026-10-05");
  assert.equal(second.scheduleTime, "09:10");
  assert.deepEqual(second.exams.map((exam) => exam.code), ["eco"]);
});

test("agenda futura: nome diferente vira 'confirmar', celular desconhecido vira 'nao_cadastrada'", async () => {
  const preview = await previewAgenda([
    ["02-10", buildReceptionSheet([
      { date: "02/10/2026", time: "08:30", name: "FERNANDA LIMA", exam: "DOPPLER ( em qualquer idade)", phone: "(31) 99111-2222" },
      { date: "02/10/2026", time: "08:50", name: "BEATRIZ COSTA", exam: "MORF.PRECOCE(11 a14 sem)", phone: "(31) 90000-0000" },
      { date: "02/10/2026", time: "09:10", name: "PACIENTE ENCERRADA", exam: "DOPPLER", phone: "(31) 99777-8888" }
    ])]
  ]);
  const [mismatch, unknown, closed] = preview.rows;
  assert.equal(mismatch.status, "confirmar");
  assert.equal(mismatch.registeredPatientName, "Maria Aparecida da Silva");
  assert.equal(unknown.status, "nao_cadastrada");
  assert.equal(closed.status, "nao_cadastrada");
  assert.equal(preview.summary.confirmRows, 1);
  assert.equal(preview.summary.notRegisteredRows, 2);
});

test("agenda futura: #ERROR!, exame desconhecido e falta de celular sao erro; CANCELOU vira cancelamento", async () => {
  const preview = await previewAgenda([
    ["08-10", buildReceptionSheet([
      { date: "08/10/2026", time: "08:30", name: "JOANA SOUZA", exam: "#ERROR!", phone: "31993334444" },
      { date: "08/10/2026", time: "08:50", name: "JOANA SOUZA", exam: "RAIO X", phone: "31993334444" },
      { date: "08/10/2026", time: "09:10", name: "JOANA SOUZA", exam: "DOPPLER", phone: "" },
      { date: "08/10/2026", time: "09:30", name: "MARIA SILVA", obs: "CANCELOU", exam: "OBST.INICIAL(4 a 10 sem)", phone: "31991112222" }
    ])]
  ]);
  const statuses = preview.rows.map((row) => row.status);
  assert.deepEqual(statuses, ["erro", "erro", "erro", "cancelamento"]);
  assert.match(preview.rows[2].messages[0], /Celular nao informado/);
  assert.deepEqual(preview.rows[3].exams.map((exam) => exam.code), ["obst_inicial"]);
  assert.equal(preview.rows[3].scheduleDate, "2026-10-08");
});

test("agenda futura: exame ja realizado e ignorado; abas de hoje/passadas nao entram", async () => {
  const preview = await previewAgenda([
    ["29-09", buildReceptionSheet([
      { date: "29/09/2026", time: "08:30", name: "JOANA SOUZA", exam: "DOPPLER", phone: "31993334444" }
    ], { monthLabel: "SETEMBRO/26" })],
    ["30-09", buildReceptionSheet([
      { date: "30/09/2026", time: "08:30", name: "JOANA SOUZA", exam: "DOPPLER", phone: "31993334444" }
    ], { monthLabel: "SETEMBRO/26" })],
    ["01-10", buildReceptionSheet([
      { date: "01/10/2026", time: "08:30", name: "CARLA MENDES", exam: "MORF. SEG. TRIM( 20 A 24 sem)", phone: "31995556666" }
    ])]
  ]);
  assert.deepEqual(preview.scheduleDates, ["2026-10-01"]);
  assert.deepEqual(preview.ignoredSheets.map((sheet) => sheet.sheetName), ["29-09", "30-09"]);
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].status, "ignorada");
});

test("agenda futura: ano vem do rotulo do mes quando a coluna DATA esta vazia", async () => {
  const preview = await previewAgenda([
    ["03-10", buildReceptionSheet([
      { date: "", time: "08:30", name: "JOANA SOUZA", exam: "DOPPLER", phone: "31993334444" }
    ])]
  ]);
  assert.deepEqual(preview.scheduleDates, ["2026-10-03"]);
  assert.equal(preview.rows[0].status, "agendamento");
});

test("importacao do dia le o celular da coluna certa em cada aba (layouts diferentes)", async () => {
  const fileBase64 = buildWorkbookBase64([
    ["01-10", buildReceptionSheet([
      { date: "01/10/2026", name: "OUTRA PACIENTE", exam: "DOPPLER", phone: "(31) 98888-7777", registro: "999", ig: "20s0d" }
    ], { phoneColumn: 15 })],
    ["02-10", buildReceptionSheet([
      { date: "02/10/2026", name: "JOANA SOUZA", exam: "DOPPLER", phone: "(31) 99333-4444", registro: "123", ig: "25s1d" }
    ], { phoneColumn: 16 })]
  ]);
  const preview = await previewPatientImportCore({
    fileName: "OUTUBRO_26.xlsx",
    fileBase64,
    referenceDate: "2026-10-02",
    units: [{ id: 1, name: "Medfetus", active: true }],
    physicians: [{ id: 1, name: "Dr. Teste", active: true, clinicUnitName: "Medfetus" }],
    patients: [],
    patientExams: [],
    automaticExamModels
  });
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].phone, "(31) 99333-4444");
});

test("agenda futura: exame avulso (SIMPLES / MORF. TERC. TRIM) e ignorado com aviso claro", async () => {
  const preview = await previewAgenda([
    ["09-10", buildReceptionSheet([
      { date: "09/10/2026", time: "08:30", name: "JOANA SOUZA", exam: "SIMPLES", phone: "31993334444" },
      { date: "09/10/2026", time: "08:50", name: "JOANA SOUZA", exam: "MORF. TERC. TRIM(30 a 36 sem)", phone: "31993334444" }
    ])]
  ]);
  assert.deepEqual(preview.rows.map((row) => row.status), ["ignorada", "ignorada"]);
  assert.match(preview.rows[0].messages[0], /Exame avulso \(Obstetrico simples\)/);
  assert.match(preview.rows[1].messages[0], /Exame avulso \(Morfologico 3o trimestre\)/);
});
