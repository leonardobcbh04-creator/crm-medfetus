// Validacao de ponta a ponta (PostgreSQL) do funil da tela "Fluxo de atendimento":
// 4 etapas fixas e a paciente mudando de etapa conforme o contato.
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import {
  authenticateCore,
  createMessageCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getKanbanDataCore,
  getRemindersCenterDataCore,
  updateReminderStatusCore
} from "../src/services/coreMigrationService.js";

let patientId = null;

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  const created = await createPatientCore({
    name: "Funil Validacao",
    phone: `3193${Date.now().toString().slice(-7)}`,
    clinicPatientId: `FUNIL-${Date.now()}`,
    gestationalWeeks: 21,
    gestationalDays: 3,
    physicianName: physician.name,
    clinicUnit: unit.name,
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente criada para validar o funil.",
    actorUserId: auth.user.id
  });
  patientId = created.patient.id;

  const stageOf = async () => {
    const columns = await getKanbanDataCore();
    assert.deepEqual(columns.map((column) => column.id), ["contato_pendente", "mensagem_enviada", "follow_up", "agendada"]);
    const column = columns.find((item) => item.patients.some((patient) => patient.id === patientId));
    return { stage: column?.id ?? null, patient: column?.patients.find((patient) => patient.id === patientId) ?? null };
  };

  let current = await stageOf();
  assert.equal(current.stage, "contato_pendente", "Paciente nova comeca em 'A contatar'.");
  assert.equal(current.patient.lastContactAt, null);

  const reminder = (await getRemindersCenterDataCore()).items.find((item) => item.patientId === patientId);
  assert.ok(reminder?.examPatientId, "Paciente com 21s3d deveria estar na Central (Morfologico 2o trimestre).");

  await createMessageCore({ patientId, content: "Ola, mensagem de validacao.", actorUserId: auth.user.id });
  current = await stageOf();
  assert.equal(current.stage, "mensagem_enviada", "Depois da mensagem, ela vai para 'Aguardando resposta'.");
  assert.ok(current.patient.lastContactAt, "Ultimo contato deveria ser registrado.");

  await updateReminderStatusCore(patientId, reminder.examPatientId, "scheduled");
  current = await stageOf();
  assert.equal(current.stage, "agendada", "Exame agendado leva a paciente para 'Agendada'.");

  console.log("Validacao do funil do Fluxo de atendimento concluida com sucesso.");
} finally {
  if (patientId) {
    await deletePatientCore(patientId).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
