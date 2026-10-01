// Validacao de ponta a ponta (PostgreSQL) dos avisos de vacina do bebe.
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { todayIsoInTimeZone } from "../src/utils/date.js";
import {
  authenticateCore,
  autoCloseOverduePregnanciesCore,
  closePatientTrackingCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getBabyVaccineRemindersCore,
  getVaccinesMenuCountCore,
  listBabyVaccineCatalogCore,
  setBabyVaccineContactCore,
  updateBabyVaccineCatalogCore
} from "../src/services/coreMigrationService.js";

const createdIds = [];
let changedCatalogRow = null;

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  async function create(name, gestationalWeeks) {
    const created = await createPatientCore({
      name,
      phone: `3195${Date.now().toString().slice(-7)}`,
      clinicPatientId: `BEBE-${Date.now()}-${gestationalWeeks}`,
      gestationalWeeks,
      gestationalDays: 0,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar as vacinas do bebe.",
      actorUserId: auth.user.id
    });
    createdIds.push(created.patient.id);
    return created.patient.id;
  }

  // 50 semanas = DPP ha 70 dias: o bebe esta perto dos 2 meses (aviso ja aberto).
  const motherId = await create("Mae Validacao Vacinas Bebe", 50);
  const lossId = await create("Perda Validacao Vacinas Bebe", 50);
  await closePatientTrackingCore(lossId, { reason: "perda_gestacional", actorUserId: auth.user.id });
  await autoCloseOverduePregnanciesCore(todayIsoInTimeZone("America/Sao_Paulo"));

  let reminders = await getBabyVaccineRemindersCore();
  let item = reminders.items.find((entry) => entry.patientId === motherId);
  assert.ok(item, "Mae encerrada como parto realizado deveria ter aviso de vacina do bebe.");
  assert.ok([2, 3].includes(item.ageMonths), `Idade inesperada: ${item.ageMonths}`);
  assert.ok(item.vaccines.length > 0);
  assert.match(item.whatsappMessage, /Eliana/);
  assert.ok(!reminders.items.some((entry) => entry.patientId === lossId), "Perda gestacional nunca entra nos avisos do bebe.");

  // Contato por idade e contador do menu.
  const countBefore = (await getVaccinesMenuCountCore()).count;
  reminders = await setBabyVaccineContactCore(motherId, item.ageMonths, true, auth.user.id);
  item = reminders.items.find((entry) => entry.patientId === motherId);
  assert.equal(item.contacted, true);
  assert.ok(item.contactedByName);
  assert.equal((await getVaccinesMenuCountCore()).count, countBefore - 1);
  reminders = await setBabyVaccineContactCore(motherId, item.ageMonths, false, auth.user.id);
  assert.equal(reminders.items.find((entry) => entry.patientId === motherId).contacted, false);

  // Editar a lista: mudar uma vacina da idade atual para "posto" muda a mensagem.
  const { catalog } = await listBabyVaccineCatalogCore();
  changedCatalogRow = catalog.find((row) => row.ageMonths === item.ageMonths && row.availability === "clinica");
  await updateBabyVaccineCatalogCore(changedCatalogRow.id, { availability: "posto" });
  item = (await getBabyVaccineRemindersCore()).items.find((entry) => entry.patientId === motherId);
  assert.equal(item.vaccines.find((vaccine) => vaccine.id === changedCatalogRow.id).availability, "posto");
  assert.match(item.whatsappMessage, /posto de saúde/);
  await assert.rejects(() => updateBabyVaccineCatalogCore(changedCatalogRow.id, { availability: "outro" }));

  console.log("Validacao das vacinas do bebe concluida com sucesso.");
} finally {
  if (changedCatalogRow) {
    await updateBabyVaccineCatalogCore(changedCatalogRow.id, { availability: "clinica" }).catch(() => {});
  }
  for (const id of createdIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
