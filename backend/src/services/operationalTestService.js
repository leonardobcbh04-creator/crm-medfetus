import { getConfiguredDatabaseKind, getDatabaseRuntime } from "../database/runtime.js";
import { listAdminUsersRows } from "../database/repositories/coreRepository.js";
import {
  createMessageCore,
  createPatientCore,
  getPatientDetailsCore,
  getPatientFormCatalogsCore,
  listPatientsCore,
  updatePatientExamStatusCore
} from "./coreMigrationService.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const TEST_PATIENT_NAME = "Maria Gertrudes";
const TEST_PATIENT_PHONE = "31 97521-5445";
const TEST_PATIENT_PHONE_DIGITS = normalizeBrazilPhone(TEST_PATIENT_PHONE);
const TEST_PATIENT_NOTES = "Paciente de teste criada para validacao operacional do fluxo completo.";

async function ensureActiveReferenceData() {
  const catalogs = await getPatientFormCatalogsCore();
  const unit = catalogs.units.find((item) => item.active);
  const physician = catalogs.physicians.find((item) => item.active);

  if (!unit || !physician) {
    throw new Error("Nao foi possivel encontrar unidade e medico ativos para o teste operacional.");
  }

  return { unit, physician };
}

function buildMessage(patientName, examName, predictedDateLabel) {
  return `Ola, ${patientName}. Estamos acompanhando sua gestacao e o proximo exame indicado e ${examName}. A data ideal prevista e ${predictedDateLabel}. Podemos confirmar esse agendamento com voce?`;
}

async function resolveOperationalActorUserId() {
  const users = await listAdminUsersRows();
  const activeUsers = users.filter((user) => Boolean(user.active));

  if (!activeUsers.length) {
    return null;
  }

  return activeUsers.find((user) => String(user.role || "").trim().toLowerCase() === "admin")?.id
    ?? activeUsers[0]?.id
    ?? null;
}

async function assertStage(patientId, expectedStage, context) {
  const patient = (await listPatientsCore()).find((item) => item.id === patientId);
  if (!patient) {
    throw new Error(`Paciente nao encontrada durante a validacao: ${context}.`);
  }

  if (patient.stage !== expectedStage) {
    throw new Error(`Falha no teste em "${context}". Etapa esperada: ${expectedStage}. Etapa atual: ${patient.stage}.`);
  }

  return patient;
}

async function nextPlannedExam(patientId) {
  const details = await getPatientDetailsCore(patientId);
  return details.exams.find((exam) => exam.status !== "realizado" && exam.flowType !== "avulso") || null;
}

async function cleanupPreviousTestPatients() {
  const previousPatients = (await listPatientsCore()).filter(
    (patient) =>
      patient.name === TEST_PATIENT_NAME &&
      normalizeBrazilPhone(patient.phone) === TEST_PATIENT_PHONE_DIGITS &&
      patient.notes === TEST_PATIENT_NOTES
  );

  if (!previousPatients.length) {
    return;
  }

  if (getConfiguredDatabaseKind() === "sqlite") {
    const runtime = await getDatabaseRuntime();
    const db = runtime.raw;
    previousPatients.forEach((patient) => {
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM message_delivery_logs WHERE patient_id = ?").run(patient.id);
        db.prepare("DELETE FROM mensagens WHERE patient_id = ?").run(patient.id);
        db.prepare("DELETE FROM historico_de_movimentacoes WHERE patient_id = ?").run(patient.id);
        db.prepare("DELETE FROM exames_paciente WHERE patient_id = ?").run(patient.id);
        db.prepare("DELETE FROM patients WHERE id = ?").run(patient.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    return;
  }

  const runtime = await getDatabaseRuntime();
  const ids = previousPatients.map((patient) => patient.id);
  await runtime.query("DELETE FROM patients WHERE id = ANY($1::int[])", [ids]);
}

export async function runMariaGertrudesOperationalTest() {
  try {
    await cleanupPreviousTestPatients();

    const actorUserId = await resolveOperationalActorUserId();
    if (!actorUserId) {
      throw new Error("Nao existe usuario ativo disponivel para registrar as acoes do teste operacional.");
    }

    const { unit, physician } = await ensureActiveReferenceData();
    const patientDetails = await createPatientCore({
      name: TEST_PATIENT_NAME,
      phone: TEST_PATIENT_PHONE,
      birthDate: "1991-04-18",
      gestationalWeeks: 8,
      gestationalDays: 2,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "unica",
      highRisk: false,
      notes: TEST_PATIENT_NOTES,
      stage: "contato_pendente",
      actorUserId
    });

    const patientId = patientDetails.patient.id;
    const timeline = [];

    await assertStage(patientId, "contato_pendente", "cadastro inicial");

    while (true) {
      const exam = await nextPlannedExam(patientId);
      if (!exam) {
        break;
      }

      await createMessageCore({
        patientId,
        examModelId: exam.examModelId,
        content: buildMessage(patientDetails.patient.name, exam.name, exam.predictedDateLabel),
        actorUserId
      });

      const afterMessage = await assertStage(patientId, "mensagem_enviada", `mensagem enviada para ${exam.name}`);

      await updatePatientExamStatusCore(patientId, exam.id, {
        status: "agendado",
        scheduledDate: exam.predictedDate,
        scheduledTime: "09:00",
        schedulingNotes: `Agendamento de teste para ${exam.name}.`,
        actorUserId
      });

      const afterSchedule = await assertStage(patientId, "agendada", `agendamento do exame ${exam.name}`);

      await updatePatientExamStatusCore(patientId, exam.id, {
        status: "realizado",
        scheduledDate: exam.predictedDate,
        scheduledTime: "09:00",
        schedulingNotes: `Exame ${exam.name} realizado na clinica durante teste completo.`,
        completedDate: exam.predictedDate,
        actorUserId
      });

      const afterCompletion = await assertStage(patientId, "contato_pendente", `realizacao do exame ${exam.name}`);

      timeline.push({
        examName: exam.name,
        predictedDate: exam.predictedDateLabel,
        afterMessageStage: afterMessage.stageTitle || afterMessage.stage,
        afterScheduleStage: afterSchedule.stageTitle || afterSchedule.stage,
        afterCompletionStage: afterCompletion.stageTitle || afterCompletion.stage
      });
    }

    const finalDetails = await getPatientDetailsCore(patientId);
    const realizedCount = finalDetails.exams.filter((exam) => exam.status === "realizado").length;

    return {
      ok: true,
      patientId: finalDetails.patient.id,
      patientName: finalDetails.patient.name,
      finalStage: finalDetails.patient.stageTitle || finalDetails.patient.stage,
      totalExams: finalDetails.exams.length,
      realizedCount,
      timeline,
      message: "Teste operacional concluido com sucesso."
    };
  } catch (error) {
    console.error("[operational-test] Falha ao executar teste Maria Gertrudes.", error);
    return {
      ok: false,
      patientId: 0,
      patientName: TEST_PATIENT_NAME,
      finalStage: "indisponivel",
      totalExams: 0,
      realizedCount: 0,
      timeline: [],
      message: error instanceof Error ? error.message : "O teste operacional nao pode ser executado neste ambiente."
    };
  }
}
