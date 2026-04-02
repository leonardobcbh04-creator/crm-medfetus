import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import {
  authenticateCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDashboardDataCore,
  getMessagingOverviewCore,
  getPatientDetailsCore,
  getRemindersCenterDataCore,
  getReportsDataCore,
  updateReminderStatusCore
} from "../src/services/coreMigrationService.js";

function uniquePhone() {
  const now = Date.now().toString();
  return `3199${now.slice(-7)}`;
}

let createdPatientId = null;

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  assert.ok(auth?.user?.id, "Falha ao autenticar na camada principal PostgreSQL.");

  const adminPanel = await getAdminPanelDataCore();
  assert.ok(Array.isArray(adminPanel.users) && adminPanel.users.length >= 1, "Painel admin sem usuarios.");
  assert.ok(Array.isArray(adminPanel.units) && adminPanel.units.length >= 1, "Painel admin sem unidades.");
  assert.ok(Array.isArray(adminPanel.physicians) && adminPanel.physicians.length >= 1, "Painel admin sem medicos.");

  const created = await createPatientCore({
    name: "Paciente Validacao Core Postgres",
    phone: uniquePhone(),
    birthDate: "1991-04-10",
    gestationalWeeks: 22,
    gestationalDays: 0,
    physicianName: "Dra. Helena Castro",
    clinicUnit: "Unidade Centro",
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente criada para validar a camada principal PostgreSQL.",
    actorUserId: auth.user.id
  });

  createdPatientId = created?.patient?.id ?? null;
  assert.ok(createdPatientId, "Nao foi possivel criar paciente pela camada principal PostgreSQL.");

  const patientDetails = await getPatientDetailsCore(createdPatientId);
  assert.equal(patientDetails?.patient?.id, createdPatientId, "Detalhes da paciente nao retornaram corretamente.");

  const remindersBefore = await getRemindersCenterDataCore();
  const reminderItem = remindersBefore.items.find((item) => item.patientId === createdPatientId);
  assert.ok(reminderItem?.examPatientId, "Paciente criada nao entrou na fila operacional esperada.");

  const messagingBefore = await getMessagingOverviewCore();
  assert.ok(messagingBefore.some((item) => item.patientId === createdPatientId), "Paciente criada nao entrou em Mensagens automaticas.");

  await updateReminderStatusCore(createdPatientId, reminderItem.examPatientId, "scheduled");

  const remindersAfter = await getRemindersCenterDataCore();
  assert.equal(remindersAfter.items.some((item) => item.patientId === createdPatientId), false, "Paciente agendada continuou na Central de lembretes.");

  const messagingAfter = await getMessagingOverviewCore();
  assert.equal(messagingAfter.some((item) => item.patientId === createdPatientId), false, "Paciente agendada continuou em Mensagens automaticas.");

  const dashboard = await getDashboardDataCore();
  assert.ok(dashboard?.summary, "Dashboard nao retornou summary.");

  const reports = await getReportsDataCore();
  assert.ok(reports?.summary, "Relatorios nao retornaram summary.");

  console.log("Validacao da camada principal PostgreSQL concluida com sucesso.");
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
} finally {
  if (createdPatientId) {
    try {
      await deletePatientCore(createdPatientId);
    } catch (cleanupError) {
      console.error("Falha ao limpar paciente de validacao PostgreSQL.", cleanupError);
    }
  }

  await closeDatabaseRuntime();
}
