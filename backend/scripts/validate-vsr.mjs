// Validacao de ponta a ponta (PostgreSQL) da aba "Gestantes (VSR)" da tela Vacinas.
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { listVaccineContactRows, listVsrContactRows } from "../src/database/repositories/coreRepository.js";
import {
  authenticateCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDtpaCampaignCore,
  getVaccinesMenuCountCore,
  getVsrCampaignCore,
  setVsrContactCore,
  updatePatientVaccineStatusCore
} from "../src/services/coreMigrationService.js";

const createdIds = [];

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  async function create(name, gestationalWeeks) {
    const created = await createPatientCore({
      name,
      phone: `3196${Date.now().toString().slice(-7)}`,
      clinicPatientId: `VSR-${Date.now()}-${gestationalWeeks}`,
      gestationalWeeks,
      gestationalDays: 0,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar a lista da VSR.",
      actorUserId: auth.user.id
    });
    createdIds.push(created.patient.id);
    return created.patient.id;
  }

  const inWindowId = await create("VSR Validacao Janela", 30);
  const beforeId = await create("VSR Validacao Antes", 27);
  const afterId = await create("VSR Validacao Depois", 37);

  let campaign = await getVsrCampaignCore();
  const item = campaign.items.find((entry) => entry.patientId === inWindowId);
  assert.ok(item, "Paciente com 30 semanas deveria estar na lista da VSR.");
  assert.equal(item.gestationalAgeLabel, "30s0d");
  assert.match(item.whatsappMessage, /SUS/);
  assert.ok(!campaign.items.some((entry) => entry.patientId === beforeId), "27 semanas ainda nao entra.");
  assert.ok(!campaign.items.some((entry) => entry.patientId === afterId), "37 semanas ja saiu.");

  // Contato da VSR e independente do contato da dTpa.
  const countBefore = await getVaccinesMenuCountCore();
  campaign = await setVsrContactCore(inWindowId, true, auth.user.id);
  const contacted = campaign.items.find((entry) => entry.patientId === inWindowId);
  assert.equal(contacted.contacted, true);
  assert.ok(contacted.contactedByName, "Deveria registrar quem contatou.");
  const countAfter = await getVaccinesMenuCountCore();
  assert.equal(countAfter.vsr, countBefore.vsr - 1, "Contador da VSR deveria descontar a contatada.");
  assert.equal(countAfter.count, countBefore.count - 1, "Contador do menu deveria descontar a contatada.");
  const dtpaItem = (await getDtpaCampaignCore()).eligible.find((entry) => entry.patientId === inWindowId);
  assert.ok(dtpaItem, "Com 30 semanas ela tambem esta na lista da dTpa.");
  assert.equal(dtpaItem.contacted, false, "Marcar a VSR nao pode marcar a dTpa.");
  assert.ok(!(await listVaccineContactRows()).some((row) => row.patientId === inWindowId));

  campaign = await setVsrContactCore(inWindowId, false, auth.user.id);
  assert.equal(campaign.items.find((entry) => entry.patientId === inWindowId).contacted, false, "Desmarcar contato nao funcionou.");

  // VSR tomada: sai da lista e a marca de contato e apagada.
  await setVsrContactCore(inWindowId, true, auth.user.id);
  await updatePatientVaccineStatusCore(inWindowId, "vsr", "tomada", auth.user.id);
  campaign = await getVsrCampaignCore();
  assert.ok(!campaign.items.some((entry) => entry.patientId === inWindowId), "VSR tomada deveria tirar a paciente da lista.");
  assert.ok(!(await listVsrContactRows()).some((row) => row.patientId === inWindowId), "Marca de contato deveria ser apagada ao sair da lista.");

  console.log("Validacao da lista da VSR concluida com sucesso.");
} finally {
  for (const id of createdIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
