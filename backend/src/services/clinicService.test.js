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
  getRemindersCenterData,
  updatePatientExamStatus
} from "./clinicService.js";
import {
  applyExamProtocolPresetCore,
  confirmGestationalBaseEstimateCore,
  createAdminUserCore,
  createClinicUnitCore,
  createExamConfigCore,
  createKanbanColumnCore,
  createPhysicianCore,
  deletePatientsByCreatedRangeCore,
  discardGestationalBaseEstimateCore,
  editGestationalBaseManuallyCore,
  getAdminPanelDataCore,
  getDashboardDataCore,
  getMessagingOverviewCore,
  getPatientDetailsCore,
  getRemindersCenterDataCore,
  getReportsDataCore,
  updateReminderStatusCore,
  updateExamConfigCore
} from "./coreMigrationService.js";
import {
  getShospIntegrationStatus,
  lookupFutureScheduledExamInShosp,
  listShospExamMappings,
  resetShospReminderLookupCache,
  runShospIncrementalSync,
  updateShospExamMapping,
  updateShospIntegrationSettings
} from "./shospIntegration/shospIntegrationService.js";
import { getShospMockMetrics, resetShospMockMetrics } from "./shospIntegration/shospMockProvider.js";
import { runMariaGertrudesOperationalTest } from "./operationalTestService.js";

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

test("com Shosp desligado a central de lembretes nao depende de agenda externa para funcionar", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const reminderData = await getRemindersCenterData();
  assert.ok(Array.isArray(reminderData.items));
  assert.deepEqual(reminderData.autoScheduledItems, []);
});

test("com Shosp desligado a consulta de agenda futura retorna null de forma controlada", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();
  resetShospReminderLookupCache();
  resetShospMockMetrics();

  const firstLookup = await lookupFutureScheduledExamInShosp({
    externalPatientId: "shosp-p-1004",
    examCode: "morfologico_2_trimestre"
  });
  const secondLookup = await lookupFutureScheduledExamInShosp({
    externalPatientId: "shosp-p-1004",
    examCode: "morfologico_2_trimestre"
  });

  assert.equal(firstLookup, null);
  assert.equal(secondLookup, null);
  assert.equal(getShospMockMetrics().futureScheduleLookupCount, 0);
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

test("mensagens automaticas e central de lembretes refletem prioridade alta e origem de atraso", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Mensagem Prioritaria",
    phone: "31974443333",
    birthDate: "1991-05-20",
    gestationalWeeks: 36,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Usada para validar prioridade operacional de mensagens.",
    actorUserId: 1
  });

  const messagingItems = getMessagingOverview();
  const messagingItem = messagingItems.find((item) => item.patientId === created.patient.id);
  assert.ok(messagingItem);
  assert.equal(messagingItem?.priorityLevel, "alta");
  assert.equal(messagingItem?.messageType, "atraso");
  assert.equal(messagingItem?.messageOrigin, "timeline_atraso");
  assert.ok(messagingItem?.examPatientId);
  assert.match(messagingItem?.whatsappUrl || "", /^https:\/\/wa\.me\//);
  assert.match(messagingItem?.suggestedMessage || "", /prioridade no agendamento/i);

  const reminders = await getRemindersCenterData();
  const reminderItem = reminders.items.find((item) => item.patientId === created.patient.id);
  assert.ok(reminderItem);
  assert.equal(reminderItem?.priorityLevel, "alta");
  assert.equal(reminderItem?.messageType, "atraso");
  assert.equal(reminderItem?.messageOrigin, "timeline_atraso");
  assert.match(reminderItem?.suggestedMessage || "", /prioridade no agendamento/i);
});

test("marcar paciente como ja agendada remove da central de lembretes e da fila de mensagens", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Agendada Pela Central",
    phone: "31971112222",
    birthDate: "1991-03-10",
    gestationalWeeks: 22,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Usada para validar saida da fila de lembretes.",
    actorUserId: 1
  });

  const remindersBefore = await getRemindersCenterDataCore();
  const reminderItem = remindersBefore.items.find((item) => item.patientId === created.patient.id);
  assert.ok(reminderItem?.examPatientId, "Paciente deveria entrar na fila inicial de lembretes.");

  const remindersAfter = await updateReminderStatusCore(created.patient.id, reminderItem.examPatientId, "scheduled");
  assert.equal(remindersAfter.items.some((item) => item.patientId === created.patient.id), false);

  const messagingAfter = await getMessagingOverviewCore();
  assert.equal(messagingAfter.some((item) => item.patientId === created.patient.id), false);

  const patientDetails = await getPatientDetailsCore(created.patient.id);
  assert.equal(patientDetails?.patient.stage, "agendada");
});

test("dashboard, relatorios e area administrativa carregam dados pela camada core sem quebrar os modulos visiveis", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Modulos Core",
    phone: "31975554444",
    birthDate: "1990-08-22",
    gestationalWeeks: 22,
    gestationalDays: 1,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Usada para validar dashboard, relatorios e admin.",
    actorUserId: 1
  });

  const before = getPatientDetails(created.patient.id);
  const nextExam = before.exams.find((exam) => exam.code === before.patient.nextExam.code);
  assert.ok(nextExam, "A paciente precisa ter proximo exame para aparecer nas telas operacionais.");

  const adminData = await getAdminPanelDataCore();
  assert.ok(adminData.users.length >= 1);
  assert.ok(adminData.units.length >= 1);
  assert.ok(adminData.physicians.length >= 1);
  assert.ok(adminData.examConfigs.length >= 1);

  const dashboardData = await getDashboardDataCore();
  assert.ok(dashboardData.summary.patientsToContactToday >= 1);
  assert.ok(Array.isArray(dashboardData.lists.patientsToContactToday));
  assert.ok(dashboardData.lists.patientsToContactToday.some((patient) => patient.id === created.patient.id));

  const reportsData = await getReportsDataCore();
  assert.ok(reportsData.summary.pendingExams >= 1);
  assert.ok(Array.isArray(reportsData.reports.pendingExams));
  assert.ok(reportsData.reports.pendingExams.some((exam) => exam.patientId === created.patient.id));
  assert.ok(Array.isArray(reportsData.reports.patientsByStage));
});

test("escritas migradas da camada core mantem operacao de admin, paciente, kanban e exames", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const user = await createAdminUserCore({
    name: "Usuaria Operacional",
    email: "operacional@clinica.com",
    password: "123456",
    role: "atendimento",
    active: true
  });
  assert.equal(user?.email, "operacional@clinica.com");

  const unit = await createClinicUnitCore({ name: "Unidade Savassi", active: true });
  assert.equal(unit?.name, "Unidade Savassi");

  const physician = await createPhysicianCore({ name: "Dra. Julia Campos", clinicUnitId: unit.id, active: true });
  assert.equal(physician?.name, "Dra. Julia Campos");

  const exam = await createExamConfigCore({
    code: "teste_operacional_core",
    name: "Exame Operacional Core",
    startWeek: 12,
    endWeek: 14,
    targetWeek: 13,
    reminderDaysBefore1: 7,
    reminderDaysBefore2: 2,
    defaultMessage: "Ola, [NOME]! Esse e um exame operacional de teste.",
    required: true,
    flowType: "automatico",
    active: true
  });
  assert.equal(exam?.code, "teste_operacional_core");

  const updatedExam = await updateExamConfigCore(exam.id, {
    ...exam,
    name: "Exame Operacional Core Atualizado"
  });
  assert.equal(updatedExam?.name, "Exame Operacional Core Atualizado");

  const presetResult = await applyExamProtocolPresetCore("unica_padrao");
  assert.ok(Array.isArray(presetResult.examConfigs));

  const columns = await createKanbanColumnCore({ title: "Retorno ativo" });
  assert.ok(columns.some((column) => column.id === "retorno_ativo"));

  const created = createPatient({
    name: "Paciente Escritas Core",
    phone: "31970001111",
    birthDate: "1990-10-10",
    gestationalWeeks: 18,
    gestationalDays: 2,
    physicianName: "Dra. Julia Campos",
    clinicUnit: "Unidade Savassi",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente criada para validar escritas migradas.",
    actorUserId: 1
  });

  await editGestationalBaseManuallyCore(created.patient.id, {
    gestationalWeeks: 19,
    gestationalDays: 1,
    actorUserId: 1
  });
  const afterManualEdit = await getPatientDetailsCore(created.patient.id);
  assert.equal(afterManualEdit?.patient.gestationalWeeks, 19);
  assert.equal(afterManualEdit?.patient.gestationalDays, 1);

  await discardGestationalBaseEstimateCore(created.patient.id, 1);
  const afterDiscard = await getPatientDetailsCore(created.patient.id);
  assert.equal(afterDiscard?.patient.stage, "revisao_base_gestacional");

  await editGestationalBaseManuallyCore(created.patient.id, {
    gestationalWeeks: 20,
    gestationalDays: 0,
    actorUserId: 1
  });
  await confirmGestationalBaseEstimateCore(created.patient.id, 1);
  const afterConfirm = await getPatientDetailsCore(created.patient.id);
  assert.equal(afterConfirm?.patient.stage, "contato_pendente");

  const cleanupResult = await deletePatientsByCreatedRangeCore({
    preset: "today",
    actorUserId: 1
  });
  assert.ok(cleanupResult.deleted.patients >= 1);
});

test("servicos residuais de Shosp e mensageria administrativa respondem pela camada atual sem quebrar", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const statusBefore = await getShospIntegrationStatus();
  assert.ok(statusBefore);
  assert.ok(["disabled", "mock", "unavailable", "live"].includes(statusBefore.mode));

  const updatedStatus = await updateShospIntegrationSettings({
    useMock: true,
    apiBaseUrl: "",
    patientsPath: "/patients",
    attendancesPath: "/attendances",
    examsPath: "/exams",
    timeoutMs: 15000
  });
  assert.ok(updatedStatus);

  const mappings = await listShospExamMappings();
  assert.ok(Array.isArray(mappings));
  if (mappings[0] && statusBefore.mode !== "disabled") {
    const updatedMapping = await updateShospExamMapping(mappings[0].id, {
      examModelId: mappings[0].examModelId,
      active: true,
      notes: "Mapeamento validado em teste automatizado."
    });
    assert.equal(updatedMapping?.id, mappings[0].id);
  }
});

test("teste operacional completo roda pela camada core sem depender do legado", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const result = await runMariaGertrudesOperationalTest();
  assert.equal(result.ok, true);
  assert.ok(result.totalExams >= result.realizedCount);
  assert.ok(Array.isArray(result.timeline));
});

test("teste operacional Maria Gertrudes retorna fallback controlado quando o ambiente nao tem usuario ativo", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  db.prepare("UPDATE users SET active = 0").run();

  const result = await runMariaGertrudesOperationalTest();
  assert.equal(result.ok, false);
  assert.equal(result.patientName, "Maria Gertrudes");
  assert.match(result.message || "", /usuario ativo/i);
  assert.deepEqual(result.timeline, []);
});

test("marcar exame posterior como realizado deixa exames anteriores como superados e sem alerta operacional ativo", { concurrency: false }, () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Timeline Coerente",
    phone: "31977776666",
    birthDate: "1990-06-20",
    gestationalWeeks: 25,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Usada para validar reconciliacao da timeline.",
    actorUserId: 1
  });

  const before = getPatientDetails(created.patient.id);
  const morpho2 = before.exams.find((exam) => exam.code === "morfologico_2_trimestre");
  assert.ok(morpho2, "Morfologico do 2o trimestre deveria existir na esteira.");

  const updated = updatePatientExamStatus(created.patient.id, morpho2.id, {
    status: "realizado",
    completedDate: "2026-03-26",
    actorUserId: 1
  });

  const supersededExam = updated.exams.find((exam) => exam.code === "morfologico_1_trimestre");
  assert.equal(supersededExam?.status, "pendente");
  assert.equal(supersededExam?.timelineStatus, "superado");
  assert.equal(supersededExam?.deadlineStatus, "superado");
  assert.equal(supersededExam?.shouldHaveBeenDone, false);
  assert.equal(supersededExam?.showOperationalAlert, false);
  assert.equal(supersededExam?.completedDate, null);

  const currentExam = updated.exams.find((exam) => exam.code === "morfologico_2_trimestre");
  assert.equal(currentExam?.completedOutsideClinic, false);
  assert.equal(currentExam?.completedDate, "2026-03-26");
  assert.equal(currentExam?.deadlineStatus, "realizado");

  assert.equal(updated.patient.nextExam.code, "ecocardiograma_fetal");

  const lastMovement = updated.movements[0];
  assert.equal(lastMovement.actionType, "exame_realizado");
  assert.match(lastMovement.description, /marcado como realizado/i);
});

test("exame marcado como ja realizado usa status concluido sem manter alerta de atraso e preenche exibicao de realizacao", { concurrency: false }, () => {
  resetDatabase();
  initializeDatabase();

  const created = createPatient({
    name: "Paciente Realizado Sem Data",
    phone: "31976665555",
    birthDate: "1991-01-15",
    gestationalWeeks: 14,
    gestationalDays: 4,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Valida a fonte de verdade do status realizado.",
    actorUserId: 1
  });

  const before = getPatientDetails(created.patient.id);
  const exam = before.exams.find((item) => item.code === "obstetrica_sexo");
  assert.ok(exam, "Obstetrica para sexo deveria existir na timeline.");

  const updated = updatePatientExamStatus(created.patient.id, exam.id, {
    status: "realizado",
    completedOutsideClinic: true,
    actorUserId: 1
  });

  const realizedExam = updated.exams.find((item) => item.code === "obstetrica_sexo");
  assert.equal(realizedExam?.status, "realizado");
  assert.equal(realizedExam?.timelineStatus, "historico_anterior_confirmado");
  assert.equal(realizedExam?.deadlineStatus, "realizado");
  assert.equal(realizedExam?.shouldHaveBeenDone, false);
  assert.equal(realizedExam?.showOperationalAlert, false);
  assert.equal(realizedExam?.completedDate, null);
  assert.equal(realizedExam?.completedDateLabel, "Ja realizado (data nao informada)");
});
