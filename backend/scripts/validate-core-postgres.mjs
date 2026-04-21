import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { recordAuditEvent } from "../src/services/auditService.js";
import {
  authenticateCore,
  createPatientCore,
  confirmPatientImportCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDashboardDataCore,
  getMessagingOverviewCore,
  getPatientDetailsCore,
  previewPatientImportDataCore,
  getRemindersCenterDataCore,
  getReportsDataCore,
  updatePatientNotesCore,
  updateReminderStatusCore
} from "../src/services/coreMigrationService.js";

function uniquePhone() {
  const now = Date.now().toString();
  return `3199${now.slice(-7)}`;
}

let createdPatientId = null;
const createdImportedPatientIds = [];

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  assert.ok(auth?.user?.id, "Falha ao autenticar na camada principal PostgreSQL.");

  const adminPanel = await getAdminPanelDataCore();
  assert.ok(Array.isArray(adminPanel.users) && adminPanel.users.length >= 1, "Painel admin sem usuarios.");
  assert.ok(Array.isArray(adminPanel.units) && adminPanel.units.length >= 1, "Painel admin sem unidades.");
  assert.ok(Array.isArray(adminPanel.physicians) && adminPanel.physicians.length >= 1, "Painel admin sem medicos.");
  assert.ok(Array.isArray(adminPanel.recentAuditLogs), "Painel admin sem auditoria recente.");
  const validationUnit = adminPanel.units.find((unit) => unit.active) || adminPanel.units[0];
  const validationPhysician = adminPanel.physicians.find((physician) => physician.active && physician.clinicUnitName === validationUnit?.name) || adminPanel.physicians[0];
  assert.ok(validationUnit?.name, "Nenhuma unidade valida disponivel para a validacao.");
  assert.ok(validationPhysician?.name, "Nenhum medico valido disponivel para a validacao.");

  const created = await createPatientCore({
    name: "Paciente Validacao Core Postgres",
    phone: uniquePhone(),
    clinicPatientId: `VAL-${Date.now()}`,
    birthDate: "1991-04-10",
    gestationalWeeks: 22,
    gestationalDays: 0,
    physicianName: validationPhysician.name,
    clinicUnit: validationUnit.name,
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente criada para validar a camada principal PostgreSQL.",
    actorUserId: auth.user.id
  });

  createdPatientId = created?.patient?.id ?? null;
  assert.ok(createdPatientId, "Nao foi possivel criar paciente pela camada principal PostgreSQL.");

  const patientDetails = await getPatientDetailsCore(createdPatientId);
  assert.equal(patientDetails?.patient?.id, createdPatientId, "Detalhes da paciente nao retornaram corretamente.");
  assert.ok(patientDetails?.patient?.clinicPatientId, "ID da clinica nao foi persistido na paciente.");
  assert.ok(Array.isArray(patientDetails?.auditLogs), "Detalhes da paciente vieram sem auditoria.");

  const notesUpdated = await updatePatientNotesCore(createdPatientId, {
    notes: "Observacoes atualizadas pela validacao automatica."
  });
  assert.equal(notesUpdated.patient.notes, "Observacoes atualizadas pela validacao automatica.", "Edicao direta das observacoes nao funcionou.");

  await recordAuditEvent({
    actorUserId: auth.user.id,
    actionType: "teste_auditoria_validacao",
    entityType: "patient",
    entityId: createdPatientId,
    patientId: createdPatientId,
    description: "Evento de auditoria criado pela validacao automatica."
  });

  const patientDetailsWithAudit = await getPatientDetailsCore(createdPatientId);
  assert.ok(
    patientDetailsWithAudit.auditLogs.some((log) => log.actionType === "teste_auditoria_validacao"),
    "Evento de auditoria nao apareceu nos detalhes da paciente."
  );

  const remindersBefore = await getRemindersCenterDataCore();
  const reminderItem = remindersBefore.items.find((item) => item.patientId === createdPatientId);
  assert.ok(reminderItem?.examPatientId, "Paciente criada nao entrou na fila operacional esperada.");

  const messagingBefore = await getMessagingOverviewCore();
  const messagingItem = messagingBefore.find((item) => item.patientId === createdPatientId);
  assert.ok(messagingItem, "Paciente criada nao entrou em Mensagens automaticas.");
  assert.ok(
    !messagingItem.suggestedMessage.includes("Observacao da equipe:"),
    "Mensagem automatica ainda recebeu complemento operacional indevido."
  );
  assert.ok(
    !messagingItem.suggestedMessage.includes("Esse exame e recomendado conforme a evolucao da gestacao."),
    "Mensagem automatica ainda recebeu reforco automatico nao configurado."
  );

  await updateReminderStatusCore(createdPatientId, reminderItem.examPatientId, "scheduled");

  const remindersAfter = await getRemindersCenterDataCore();
  assert.equal(remindersAfter.items.some((item) => item.patientId === createdPatientId), false, "Paciente agendada continuou na Central de lembretes.");

  const messagingAfter = await getMessagingOverviewCore();
  assert.equal(messagingAfter.some((item) => item.patientId === createdPatientId), false, "Paciente agendada continuou em Mensagens automaticas.");

  const dashboard = await getDashboardDataCore();
  assert.ok(dashboard?.summary, "Dashboard nao retornou summary.");

  const reports = await getReportsDataCore();
  assert.ok(reports?.summary, "Relatorios nao retornaram summary.");

  const csvPhone = uniquePhone();
  const preview = await previewPatientImportDataCore({
    fileName: "pacientes-validacao.csv",
    fileBase64: Buffer.from(
      [
        "nome,telefone,id_clinica,data_nascimento,idade_gestacional,ultimo_exame,medico,unidade",
        `Paciente Importada,${csvPhone},IMPORT-${Date.now()},10-04-1993,18s2d,,${validationPhysician.name},${validationUnit.name}`
      ].join("\n")
    ).toString("base64")
  });
  assert.equal(preview.summary.readyRows, 1, "Preview da importacao nao marcou a linha valida como pronta.");

  const imported = await confirmPatientImportCore({
    fileName: "pacientes-validacao.csv",
    fileBase64: Buffer.from(
      [
        "nome,telefone,id_clinica,data_nascimento,idade_gestacional,ultimo_exame,medico,unidade",
        `Paciente Importada,${csvPhone},IMPORT-${Date.now() + 1},10-04-1993,18s2d,,${validationPhysician.name},${validationUnit.name}`
      ].join("\n")
    ).toString("base64"),
    actorUserId: auth.user.id
  });
  assert.equal(imported.summary.importedRows, 1, "Importacao confirmada nao criou a paciente esperada.");
  createdImportedPatientIds.push(...imported.imported.map((item) => item.patientId));

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

  for (const patientId of createdImportedPatientIds) {
    try {
      await deletePatientCore(patientId);
    } catch (cleanupError) {
      console.error("Falha ao limpar paciente importada de validacao PostgreSQL.", cleanupError);
    }
  }

  await closeDatabaseRuntime();
}
