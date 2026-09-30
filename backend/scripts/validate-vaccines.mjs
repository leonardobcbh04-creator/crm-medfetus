// Validacao de ponta a ponta (PostgreSQL) da tela Vacinas (campanha dTpa).
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { listVaccineContactRows } from "../src/database/repositories/coreRepository.js";
import {
  authenticateCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDtpaCampaignCore,
  getDtpaCampaignCountCore,
  setVaccineContactCore,
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
      phone: `3197${Date.now().toString().slice(-7)}`,
      clinicPatientId: `VAC-${Date.now()}-${gestationalWeeks}`,
      gestationalWeeks,
      gestationalDays: 0,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar a tela Vacinas.",
      actorUserId: auth.user.id
    });
    createdIds.push(created.patient.id);
    return created.patient.id;
  }

  const eligibleId = await create("Vacina Validacao Janela", 25);
  const enteringId = await create("Vacina Validacao Entrando", 19);
  const outsideId = await create("Vacina Validacao Fora", 12);

  let campaign = await getDtpaCampaignCore();
  const eligible = campaign.eligible.find((item) => item.patientId === eligibleId);
  const entering = campaign.entering.find((item) => item.patientId === enteringId);
  assert.ok(eligible, "Paciente com 25 semanas deveria estar em 'Ja podem vacinar'.");
  assert.ok(entering, "Paciente com 19 semanas deveria estar em 'Entram na janela nos proximos 15 dias'.");
  assert.ok(entering.daysUntilWindow >= 6 && entering.daysUntilWindow <= 8);
  assert.equal(eligible.fluPending, true);
  assert.ok(!campaign.eligible.concat(campaign.entering).some((item) => item.patientId === outsideId), "Paciente com 12 semanas nao deveria aparecer.");

  const countBefore = await getDtpaCampaignCountCore();
  campaign = await setVaccineContactCore(eligibleId, true, auth.user.id);
  const contacted = campaign.eligible.find((item) => item.patientId === eligibleId);
  assert.equal(contacted.contacted, true);
  assert.ok(contacted.contactedAt);
  assert.ok(contacted.contactedByName, "Deveria registrar quem contatou.");
  assert.equal((await getDtpaCampaignCountCore()).count, countBefore.count - 1, "Contador deveria descontar a contatada.");

  campaign = await setVaccineContactCore(eligibleId, false, auth.user.id);
  assert.equal(campaign.eligible.find((item) => item.patientId === eligibleId).contacted, false, "Desmarcar contato nao funcionou.");

  // Gripe tomada: continua na tela, sem o selo.
  await updatePatientVaccineStatusCore(eligibleId, "gripe", "tomada", auth.user.id);
  campaign = await getDtpaCampaignCore();
  assert.equal(campaign.eligible.find((item) => item.patientId === eligibleId).fluPending, false);

  // dTpa tomada: sai da tela e a marca de contato e apagada.
  await setVaccineContactCore(eligibleId, true, auth.user.id);
  await updatePatientVaccineStatusCore(eligibleId, "dtpa", "tomada", auth.user.id);
  campaign = await getDtpaCampaignCore();
  assert.ok(!campaign.eligible.some((item) => item.patientId === eligibleId), "dTpa tomada deveria tirar a paciente da tela.");
  assert.ok(!(await listVaccineContactRows()).some((row) => row.patientId === eligibleId), "Marca de contato deveria ser apagada ao sair da tela.");

  console.log("Validacao da tela Vacinas concluida com sucesso.");
} finally {
  for (const id of createdIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
