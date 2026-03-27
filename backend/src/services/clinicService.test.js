import test from "node:test";
import assert from "node:assert/strict";
import { db, initializeDatabase, resetDatabase } from "../db.js";
import {
  authenticate,
  createPatient,
  getAuthenticatedUserByToken,
  getKanbanData,
  getMessagingOverview,
  getPatientDetails,
  getRemindersCenterData
} from "./clinicService.js";
import {
  lookupFutureScheduledExamInShosp,
  resetShospReminderLookupCache,
  runShospIncrementalSync
} from "./shospIntegration/shospIntegrationService.js";
import { getShospMockMetrics, resetShospMockMetrics } from "./shospIntegration/shospMockProvider.js";

async function withMockFixtures(callback) {
  const previous = process.env.SHOSP_MOCK_FIXTURES;
  process.env.SHOSP_MOCK_FIXTURES = "true";

  try {
    return await callback();
  } finally {
    if (previous == null) {
      delete process.env.SHOSP_MOCK_FIXTURES;
    } else {
      process.env.SHOSP_MOCK_FIXTURES = previous;
    }
  }
}

test("detecta agendamento futuro do Shosp na central de lembretes sem duplicar shosp_exam_id", { concurrency: false }, async () => {
  await withMockFixtures(async () => {
    resetDatabase();
    initializeDatabase();

    await runShospIncrementalSync({ incremental: false });

    const reminderData = await getRemindersCenterData();
    const autoScheduledPatient = reminderData.autoScheduledItems.find((item) => item.patientName === "Patricia Mourao");

    assert.ok(autoScheduledPatient, "Paciente com agendamento futuro no Shosp deveria sair da fila principal.");
    assert.equal(reminderData.items.some((item) => item.patientName === "Patricia Mourao"), false);

    const shospExamRows = db.prepare(`
      SELECT COUNT(*) AS count
      FROM exames_paciente
      WHERE shosp_exam_id = 'shosp-i-7010'
    `).get();
    assert.equal(shospExamRows.count, 1);

    const patientStage = db.prepare(`
      SELECT stage
      FROM patients
      WHERE name = 'Patricia Mourao'
    `).get();
    assert.equal(patientStage.stage, "agendada");

    const movement = db.prepare(`
      SELECT action_type AS actionType
      FROM historico_de_movimentacoes hm
      INNER JOIN patients p ON p.id = hm.patient_id
      WHERE p.name = 'Patricia Mourao'
        AND hm.action_type = 'agendamento_detectado_shosp'
      ORDER BY hm.id DESC
      LIMIT 1
    `).get();
    assert.equal(movement.actionType, "agendamento_detectado_shosp");
  });
});

test("usa cache temporario ao consultar agendamento futuro no Shosp", { concurrency: false }, async () => {
  await withMockFixtures(async () => {
    resetDatabase();
    initializeDatabase();
    resetShospReminderLookupCache();
    resetShospMockMetrics();

    const firstLookup = await lookupFutureScheduledExamInShosp({
      externalPatientId: "shosp-p-1004",
      examCode: "exame_obstetrico_inicial"
    });
    const secondLookup = await lookupFutureScheduledExamInShosp({
      externalPatientId: "shosp-p-1004",
      examCode: "exame_obstetrico_inicial"
    });

    assert.equal(firstLookup?.externalExamItemId, "shosp-i-7010");
    assert.equal(secondLookup?.externalExamItemId, "shosp-i-7010");
    assert.equal(getShospMockMetrics().futureScheduleLookupCount, 1);
  });
});

test("autentica usuario e valida sessao ativa por token", { concurrency: false }, () => {
  resetDatabase();
  initializeDatabase();

  const session = authenticate("admin@clinica.com", "123456");

  assert.ok(session?.token, "Login deveria gerar token de sessao.");
  assert.equal(session?.user.email, "admin@clinica.com");
  assert.equal(session?.user.role, "admin");

  const authenticated = getAuthenticatedUserByToken(session.token);
  assert.ok(authenticated, "Sessao criada deveria ser reconhecida.");
  assert.equal(authenticated?.user.email, "admin@clinica.com");
  assert.equal(authenticated?.user.role, "admin");
});

test("cadastro com ultimo exame realizado marca historico anterior sem data e sugere o proximo exame", { concurrency: false }, () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Fluxo Intermediario",
    phone: "31999998888",
    birthDate: "1992-04-10",
    gestationalWeeks: 24,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente ja iniciou acompanhamento em outro servico.",
    lastCompletedExamCode: "ecocardiograma_fetal",
    actorUserId: 1
  });

  const details = getPatientDetails(created.patient.id);
  assert.ok(details, "Paciente criada deveria estar disponivel na ficha detalhada.");

  const completedCodes = details.exams
    .filter((exam) => exam.status === "realizado")
    .map((exam) => exam.code);

  assert.deepEqual(completedCodes, [
    "exame_obstetrico_inicial",
    "morfologico_1_trimestre",
    "obstetrica_sexo",
    "morfologico_2_trimestre",
    "ecocardiograma_fetal"
  ]);

  const ecocardiograma = details.exams.find((exam) => exam.code === "ecocardiograma_fetal");
  assert.equal(ecocardiograma?.completedDate, null);
  assert.equal(ecocardiograma?.completedOutsideClinic, true);

  assert.equal(details.patient.nextExam.code, "perfil_biofisico_fetal");

  const movement = db.prepare(`
    SELECT metadata_json AS metadataJson
    FROM historico_de_movimentacoes
    WHERE patient_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(created.patient.id);
  const metadata = movement?.metadataJson ? JSON.parse(movement.metadataJson) : null;
  assert.equal(metadata?.lastCompletedExamCode, "ecocardiograma_fetal");
});

test("paciente cadastrada passa a aparecer em clientes operacionais, pipeline, mensagens e lembretes", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Operacional",
    phone: "31988887777",
    birthDate: "1991-09-15",
    gestationalWeeks: 21,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Fluxo para validar telas operacionais.",
    actorUserId: 1
  });

  const patientDetails = getPatientDetails(created.patient.id);
  assert.ok(patientDetails);

  const kanban = getKanbanData();
  const patientInKanban = kanban.flatMap((column) => column.patients).find((patient) => patient.id === created.patient.id);
  assert.ok(patientInKanban, "Paciente deveria aparecer no pipeline.");

  const messagingItems = getMessagingOverview();
  const patientInMessaging = messagingItems.find((item) => item.patientId === created.patient.id);
  assert.ok(patientInMessaging, "Paciente deveria aparecer na fila de mensagens.");

  const reminders = await getRemindersCenterData();
  const patientInReminders = reminders.items.find((item) => item.patientId === created.patient.id);
  assert.ok(patientInReminders, "Paciente deveria aparecer na central de lembretes.");
});
