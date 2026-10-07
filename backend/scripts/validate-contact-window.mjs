// Validacao de ponta a ponta (PostgreSQL): selo de atraso so depois do fim do
// intervalo do exame e limite do cartao na Central de contatos.
import assert from "node:assert/strict";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import {
  authenticateCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getMessagingOverviewCore,
  getRemindersCenterDataCore
} from "../src/services/coreMigrationService.js";

const createdIds = [];

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  async function create(name, gestationalWeeks, gestationalDays) {
    const created = await createPatientCore({
      name,
      phone: `3195${Date.now().toString().slice(-6)}${createdIds.length}`,
      clinicPatientId: `JANELA-${Date.now()}-${createdIds.length}`,
      gestationalWeeks,
      gestationalDays,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar o limite do cartao.",
      actorUserId: auth.user.id
    });
    createdIds.push(created.patient.id);
    return created.patient.id;
  }

  // Obstetrica para sexo: intervalo 14s3d a 17s0d, semana ideal 15s.
  const insideId = await create("Janela Sexo 16s", 16, 0);
  const pastId = await create("Janela Sexo 17s3d", 17, 3);

  const reminders = await getRemindersCenterDataCore();
  const inside = reminders.items.find((item) => item.patientId === insideId);
  assert.ok(inside, "Com 16s (dentro do intervalo) ela deve aparecer na Central.");
  assert.notEqual(inside.deadlineStatus ?? inside.patient?.nextExam?.deadlineStatus, "atrasado", "Dentro do intervalo nao e atraso.");
  assert.ok(!reminders.items.some((item) => item.patientId === pastId), "Com 17s3d o cartao do Obstetrica para sexo ja saiu.");

  // Tela de contatos: sem cartao de exame. (Se houver vacina pendente, ela pode
  // seguir aparecendo so com o aviso de vacina, como qualquer paciente entre exames.)
  const overview = await getMessagingOverviewCore();
  const overviewItems = Array.isArray(overview) ? overview : overview.items ?? [];
  const pastItems = overviewItems.filter((item) => item.patientId === pastId);
  assert.ok(pastItems.every((item) => item.kind === "vacina"), "Tela de contatos nao pode mostrar o cartao do exame vencido.");
  assert.ok(overviewItems.some((item) => item.patientId === insideId && item.kind !== "vacina"), "Dentro do intervalo o cartao do exame aparece.");

  console.log("Validacao do limite do cartao na Central concluida com sucesso.");
} finally {
  for (const id of createdIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
