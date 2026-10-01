// Validacao de ponta a ponta (PostgreSQL): encerramento automatico apos DPP + 14
// dias, saida da Central de contatos a partir de 37 semanas, reabertura sem novo encerramento automatico e encerramento por perda
// gestacional tirando a paciente de todas as mensagens (inclusive vacinas).
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { addDays, todayIsoInTimeZone } from "../src/utils/date.js";
import {
  authenticateCore,
  autoCloseOverduePregnanciesCore,
  closePatientTrackingCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDtpaCampaignCore,
  getMessagingOverviewCore,
  getPatientDetailsCore,
  reopenPatientTrackingCore
} from "../src/services/coreMigrationService.js";

const createdIds = [];

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  async function create(name, gestationalWeeks, gestationalDays = 0) {
    const created = await createPatientCore({
      name,
      phone: `3196${Date.now().toString().slice(-7)}`,
      clinicPatientId: `AUTO-${Date.now()}-${gestationalWeeks}`,
      gestationalWeeks,
      gestationalDays,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar o encerramento automatico.",
      actorUserId: auth.user.id
    });
    createdIds.push(created.patient.id);
    return created.patient.id;
  }

  const today = todayIsoInTimeZone("America/Sao_Paulo");
  const overdueId = await create("Auto Encerramento Vencida", 43, 0); // DPP ha 21 dias
  const almostId = await create("Auto Encerramento No Limite", 42, 0); // DPP ha 14 dias: ainda nao
  const lossId = await create("Perda Gestacional Validacao", 25, 0);

  const result = await autoCloseOverduePregnanciesCore(today);
  const closedIds = result.closed.map((item) => item.patientId);
  assert.ok(closedIds.includes(overdueId), "Paciente com DPP + 21 dias deveria ser encerrada.");
  assert.ok(!closedIds.includes(almostId), "Paciente com DPP + 14 dias ainda nao deveria ser encerrada.");

  let overdue = (await getPatientDetailsCore(overdueId)).patient;
  assert.equal(overdue.status, "encerrada");
  assert.equal(overdue.closureReason, "parto_realizado");
  assert.equal(overdue.closureIsAutomatic, true);
  assert.match(overdue.closureReasonLabel, /automaticamente/);

  // Rodar de novo nao encerra ninguem a mais (idempotente).
  const again = await autoCloseOverduePregnanciesCore(today);
  assert.ok(!again.closed.some((item) => item.patientId === overdueId));

  // Equipe reabre: o sistema nao pode encerrar de novo.
  await reopenPatientTrackingCore(overdueId, { actorUserId: auth.user.id });
  overdue = (await getPatientDetailsCore(overdueId)).patient;
  assert.equal(overdue.status, "ativa");
  assert.equal(overdue.closureIsAutomatic, false);
  assert.equal(overdue.autoCloseDisabled, true);
  const afterReopen = await autoCloseOverduePregnanciesCore(addDays(today, 1));
  assert.ok(!afterReopen.closed.some((item) => item.patientId === overdueId), "Reaberta pela equipe nao deve ser encerrada de novo.");

  // Central de contatos: a partir de 37 semanas a paciente nao aparece mais.
  const weeks36Id = await create("Central Contatos 36 Semanas", 36, 0);
  const weeks37Id = await create("Central Contatos 37 Semanas", 37, 0);
  const contactCenter = await getMessagingOverviewCore();
  assert.ok(contactCenter.some((item) => item.patientId === weeks36Id), "Com 36 semanas a paciente ainda deveria aparecer na Central de contatos.");
  assert.ok(!contactCenter.some((item) => item.patientId === weeks37Id), "Com 37 semanas a paciente nao deveria aparecer na Central de contatos.");
  assert.ok(!contactCenter.some((item) => item.patientId === almostId), "Com 42 semanas a paciente nao deveria aparecer na Central de contatos.");

  // Perda gestacional: some de todas as mensagens, inclusive lembrete de vacina.
  let messaging = await getMessagingOverviewCore();
  assert.ok(messaging.some((item) => item.patientId === lossId), "Gestante de 25 semanas deveria ter algum lembrete antes do encerramento.");
  assert.ok((await getDtpaCampaignCore()).eligible.some((item) => item.patientId === lossId));
  await closePatientTrackingCore(lossId, { reason: "perda_gestacional", actorUserId: auth.user.id });
  messaging = await getMessagingOverviewCore();
  assert.ok(!messaging.some((item) => item.patientId === lossId), "Perda gestacional nao pode receber nenhuma mensagem (exame ou vacina).");
  assert.ok(!(await getDtpaCampaignCore()).eligible.some((item) => item.patientId === lossId), "Perda gestacional nao pode aparecer na tela Vacinas.");
  const loss = (await getPatientDetailsCore(lossId)).patient;
  assert.equal(loss.closureReason, "perda_gestacional");
  assert.equal(loss.closureIsAutomatic, false);

  console.log("Validacao do encerramento automatico e da perda gestacional concluida com sucesso.");
} finally {
  for (const id of createdIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
