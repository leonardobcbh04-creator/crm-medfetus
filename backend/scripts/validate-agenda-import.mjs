// Validacao de ponta a ponta (PostgreSQL) da importacao da agenda futura:
// agendar -> reenviar igual -> reenviar sem a paciente (remove) -> cancelar ->
// preservar agendamento manual -> importacao do dia marca o exame como realizado.
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { addDays, todayIso, todayIsoInTimeZone } from "../src/utils/date.js";
import {
  authenticateCore,
  confirmFutureScheduleImportCore,
  confirmPatientImportCore,
  createPatientCore,
  deletePatientCore,
  getAdminPanelDataCore,
  getDtpaCampaignCore,
  getPatientDetailsCore,
  previewFutureScheduleImportDataCore,
  updatePatientExamStatusCore
} from "../src/services/coreMigrationService.js";

const futureDate = addDays(todayIsoInTimeZone("America/Sao_Paulo"), 5);
const [year, month, day] = futureDate.split("-");
const sheetName = `${day}-${month}`;
const phone = `3198${Date.now().toString().slice(-7)}`;
const patientName = "Paciente Validacao Agenda Futura";

function agendaFile(rows) {
  const header = Array.from({ length: 22 }, () => "");
  Object.assign(header, {
    0: "DATA", 1: "HORÁRIO", 2: "NOME COMPLETO \nsem abreviações", 4: "OBSERVAÇÃO",
    5: "REGISTRO MEDFETUS", 8: "EXAME", 16: "CELULAR DE CONTATO"
  });
  const grid = [[], [], [], [], [], [], [], header, [], [`MES/${year.slice(2)}`]];
  for (const row of rows) {
    const line = Array.from({ length: 22 }, () => "");
    Object.assign(line, { 0: `${day}/${month}/${year}`, 1: row.time, 2: row.name, 4: row.obs || "", 8: row.exam, 16: row.phone });
    grid.push(line);
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(grid), sheetName);
  return {
    fileName: "AGENDA_VALIDACAO.xlsx",
    fileBase64: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64")
  };
}

async function examByCode(patientId, code) {
  const details = await getPatientDetailsCore(patientId);
  return details.exams.find((exam) => exam.code === code);
}

const morfRow = { time: "09:10", name: patientName.toUpperCase(), exam: "MORF. SEG. TRIM( 20 A 24 sem)", phone: `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}` };
const otherRow = { time: "10:00", name: "OUTRA PESSOA NAO CADASTRADA", exam: "DOPPLER ( em qualquer idade)", phone: "(31) 90000-0001" };
let patientId = null;

try {
  const auth = await authenticateCore("admin@clinica.com", "123456");
  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];

  const created = await createPatientCore({
    name: patientName,
    phone,
    clinicPatientId: `AGENDA-${Date.now()}`,
    birthDate: "1992-02-02",
    gestationalWeeks: 21,
    gestationalDays: 0,
    physicianName: physician.name,
    clinicUnit: unit.name,
    pregnancyType: "Unica",
    highRisk: false,
    notes: "Paciente criada para validar a agenda futura.",
    actorUserId: auth.user.id
  });
  patientId = created.patient.id;
  const patientBefore = (await getPatientDetailsCore(patientId)).patient;

  // 1) Previa + gravacao.
  const preview = await previewFutureScheduleImportDataCore(agendaFile([morfRow, otherRow]));
  assert.deepEqual(preview.scheduleDates, [futureDate]);
  assert.equal(preview.rows[0].status, "agendamento", "Linha da paciente cadastrada deveria estar pronta para agendar.");
  assert.equal(preview.rows[1].status, "nao_cadastrada", "Celular desconhecido deveria aparecer como nao cadastrada.");

  const first = await confirmFutureScheduleImportCore({ ...agendaFile([morfRow, otherRow]), actorUserId: auth.user.id });
  assert.equal(first.summary.scheduledExams, 1);
  let morf = await examByCode(patientId, "morfologico_2_trimestre");
  assert.equal(morf.status, "agendado");
  assert.equal(morf.scheduledDate, futureDate);
  assert.equal(morf.scheduledTime, "09:10");

  // A agenda nao altera cadastro (IG/DUM/telefone).
  const patientAfter = (await getPatientDetailsCore(patientId)).patient;
  assert.equal(patientAfter.phone, patientBefore.phone);
  assert.equal(patientAfter.dum, patientBefore.dum);

  // 2) Reenviar igual nao duplica nada.
  const again = await confirmFutureScheduleImportCore({ ...agendaFile([morfRow, otherRow]), actorUserId: auth.user.id });
  assert.equal(again.summary.scheduledExams, 0);
  assert.equal(again.summary.unchangedExams, 1);

  // 3) Remarcacao de horario: reenvio atualiza.
  await confirmFutureScheduleImportCore({ ...agendaFile([{ ...morfRow, time: "14:30" }]), actorUserId: auth.user.id });
  morf = await examByCode(patientId, "morfologico_2_trimestre");
  assert.equal(morf.scheduledTime, "14:30");

  // 3b) Tela Vacinas: a mensagem da dTpa convida a aproveitar o horario importado.
  const dtpaItem = async () => (await getDtpaCampaignCore()).eligible.find((item) => item.patientId === patientId);
  let vaccineItem = await dtpaItem();
  assert.equal(vaccineItem.agendaVisit?.scheduledTime, "14:30");
  const [, futureMonth, futureDay] = futureDate.split("-");
  assert.ok(vaccineItem.whatsappMessage.includes(`no dia ${futureDay}/${futureMonth}, às 14:30. Quer aproveitar a vinda`));

  // 4) Agendamento manual de outro exame na mesma data nao e tocado pelo reenvio.
  const eco = await examByCode(patientId, "ecocardiograma_fetal");
  await updatePatientExamStatusCore(patientId, eco.id, { status: "agendado", scheduledDate: futureDate, scheduledTime: "11:00", actorUserId: auth.user.id });

  // 5) Reenvio sem a paciente: o agendamento importado e removido; o manual fica.
  const removed = await confirmFutureScheduleImportCore({ ...agendaFile([otherRow]), actorUserId: auth.user.id });
  assert.equal(removed.summary.removedSchedules, 1);
  morf = await examByCode(patientId, "morfologico_2_trimestre");
  assert.equal(morf.status, "pendente");
  assert.equal(morf.scheduledDate, null);
  assert.equal((await examByCode(patientId, "ecocardiograma_fetal")).status, "agendado", "Agendamento manual nao pode ser removido.");
  vaccineItem = await dtpaItem();
  assert.equal(vaccineItem.agendaVisit, null, "Agendamento manual nao entra na mensagem da vacina.");
  assert.doesNotMatch(vaccineItem.whatsappMessage, /Quer aproveitar a vinda/);

  // 6) CANCELOU remove o agendamento daquela data.
  await confirmFutureScheduleImportCore({ ...agendaFile([morfRow]), actorUserId: auth.user.id });
  const cancelled = await confirmFutureScheduleImportCore({ ...agendaFile([{ ...morfRow, obs: "CANCELOU" }]), actorUserId: auth.user.id });
  assert.equal(cancelled.summary.removedSchedules + cancelled.summary.cancelledSchedules, 1);
  assert.equal((await examByCode(patientId, "morfologico_2_trimestre")).status, "pendente");

  // 7) Nome diferente: so grava quando a linha e confirmada.
  const renamedRow = { ...morfRow, name: "FULANA DE TAL" };
  const notConfirmed = await confirmFutureScheduleImportCore({ ...agendaFile([renamedRow]), actorUserId: auth.user.id });
  assert.equal(notConfirmed.summary.pendingConfirmationRows, 1);
  assert.equal((await examByCode(patientId, "morfologico_2_trimestre")).status, "pendente");
  const confirmed = await confirmFutureScheduleImportCore({
    ...agendaFile([renamedRow]),
    confirmedRowKeys: [`${sheetName}:11`],
    actorUserId: auth.user.id
  });
  assert.equal(confirmed.summary.scheduledExams, 1);
  assert.equal((await examByCode(patientId, "morfologico_2_trimestre")).status, "agendado");

  // 8) Importacao do dia (realizado) transforma o agendado em realizado.
  const dailyFile = {
    fileName: "atendimentos.csv",
    fileBase64: Buffer.from([
      "nome,id_clinica,exame,telefone,data_nascimento,idade_gestacional,medico,unidade,data_agenda",
      `${patientName},${created.patient.clinicPatientId},MORF. SEG. TRIM( 20 A 24 sem),${phone},,21s0d,${physician.name},${unit.name},${todayIso()}`
    ].join("\n")).toString("base64")
  };
  const daily = await confirmPatientImportCore({ ...dailyFile, actorUserId: auth.user.id });
  assert.equal(daily.summary.updatedRows, 1, "Importacao do dia deveria registrar o exame agendado como realizado.");
  morf = await examByCode(patientId, "morfologico_2_trimestre");
  assert.equal(morf.status, "realizado");
  assert.equal(morf.scheduledDate, null);

  console.log("Validacao da agenda futura concluida com sucesso.");
} finally {
  if (patientId) {
    await deletePatientCore(patientId).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  await closeDatabaseRuntime();
}
