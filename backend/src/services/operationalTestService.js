import { db } from "../db.js";
import {
  createMessage,
  createPatient,
  getPatientDetails,
  listClinicUnits,
  listPatients,
  listPhysicians,
  updatePatientExamStatus
} from "./clinicService.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const TEST_PATIENT_NAME = "Maria Gertrudes";
const TEST_PATIENT_PHONE = "+55 31 97521-5445";
const TEST_PATIENT_PHONE_DIGITS = normalizeBrazilPhone(TEST_PATIENT_PHONE);
const TEST_PATIENT_NOTES = "Paciente de teste criada para validacao operacional do fluxo completo.";

function ensureActiveReferenceData() {
  const unit = listClinicUnits().find((item) => item.active);
  const physician = listPhysicians().find((item) => item.active);

  if (!unit || !physician) {
    throw new Error("Nao foi possivel encontrar unidade e medico ativos para o teste operacional.");
  }

  return { unit, physician };
}

function buildMessage(patientName, examName, predictedDateLabel) {
  return `Ola, ${patientName}. Estamos acompanhando sua gestacao e o proximo exame indicado e ${examName}. A data ideal prevista e ${predictedDateLabel}. Podemos confirmar esse agendamento com voce?`;
}

function assertStage(patientId, expectedStage, context) {
  const patient = listPatients().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error(`Paciente nao encontrada durante a validacao: ${context}.`);
  }

  if (patient.stage !== expectedStage) {
    throw new Error(
      `Falha no teste em "${context}". Etapa esperada: ${expectedStage}. Etapa atual: ${patient.stage}.`
    );
  }

  return patient;
}

function nextPlannedExam(patientId) {
  const details = getPatientDetails(patientId);
  return details.exams.find((exam) => exam.status !== "realizado" && exam.flowType !== "avulso") || null;
}

function cleanupPreviousTestPatients() {
  const previousPatients = listPatients().filter(
    (patient) =>
      patient.name === TEST_PATIENT_NAME &&
      normalizeBrazilPhone(patient.phone) === TEST_PATIENT_PHONE_DIGITS &&
      patient.notes === TEST_PATIENT_NOTES
  );

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
}

export function runMariaGertrudesOperationalTest() {
  cleanupPreviousTestPatients();

  const { unit, physician } = ensureActiveReferenceData();
  const patientDetails = createPatient({
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
    stage: "contato_pendente"
  });

  const patientId = patientDetails.patient.id;
  const timeline = [];

  assertStage(patientId, "contato_pendente", "cadastro inicial");

  while (true) {
    const exam = nextPlannedExam(patientId);
    if (!exam) {
      break;
    }

    createMessage({
      patientId,
      examModelId: exam.examModelId,
      content: buildMessage(patientDetails.patient.name, exam.name, exam.predictedDateLabel)
    });

    const afterMessage = assertStage(patientId, "mensagem_enviada", `mensagem enviada para ${exam.name}`);

    updatePatientExamStatus(patientId, exam.id, {
      status: "agendado",
      scheduledDate: exam.predictedDate,
      scheduledTime: "09:00",
      schedulingNotes: `Agendamento de teste para ${exam.name}.`,
      actorUserId: 1
    });

    const afterSchedule = assertStage(patientId, "agendada", `agendamento do exame ${exam.name}`);

    updatePatientExamStatus(patientId, exam.id, {
      status: "realizado",
      scheduledDate: exam.predictedDate,
      scheduledTime: "09:00",
      schedulingNotes: `Exame ${exam.name} realizado na clinica durante teste completo.`,
      completedDate: exam.predictedDate,
      actorUserId: 1
    });

    const afterCompletion = assertStage(patientId, "contato_pendente", `realizacao do exame ${exam.name}`);

    timeline.push({
      examName: exam.name,
      predictedDate: exam.predictedDateLabel,
      afterMessageStage: afterMessage.stageTitle || afterMessage.stage,
      afterScheduleStage: afterSchedule.stageTitle || afterSchedule.stage,
      afterCompletionStage: afterCompletion.stageTitle || afterCompletion.stage
    });
  }

  const finalDetails = getPatientDetails(patientId);
  const realizedCount = finalDetails.exams.filter((exam) => exam.status === "realizado").length;

  return {
    ok: true,
    patientId: finalDetails.patient.id,
    patientName: finalDetails.patient.name,
    finalStage: finalDetails.patient.stageTitle || finalDetails.patient.stage,
    totalExams: finalDetails.exams.length,
    realizedCount,
    timeline
  };
}
