import { KANBAN_STAGES } from "../config.js";
import { db } from "../db.js";
import {
  analyzePatientExamTimeline,
  calculateExamScheduleDates,
  resolvePregnancySnapshot,
  DEADLINE_STATUS
} from "../domain/obstetrics.js";
import {
  getMessagingRuntimeConfig,
  listMessageTemplates,
  registerManualMessageDispatch,
  registerMessageStatusChange
} from "./messaging/messagingService.js";
import { recordAuditEvent } from "./auditService.js";
import { lookupFutureScheduledExamInShosp } from "./shospIntegration/shospIntegrationService.js";
import {
  buildSessionExpiry,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isPasswordHashed,
  verifyPassword
} from "../security/auth.js";
import { addDays, formatDatePtBr, todayIso } from "../utils/date.js";
import { normalizeBrazilPhone, toWhatsAppPhone } from "../utils/phone.js";

const EXAM_PROTOCOL_PRESETS = {
  unica_padrao: {
    id: "unica_padrao",
    name: "Gestacao unica padrao",
    description: "Protocolo inicial mais conservador para a rotina obstetrica geral.",
    overrides: {}
  },
  gemelar: {
    id: "gemelar",
    name: "Gestacao gemelar",
    description: "Antecipa algumas janelas e lembretes para acompanhamento mais proximo.",
    overrides: {
      morfologico_2_trimestre: { targetWeek: 20, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { startWeek: 22, endWeek: 27, targetWeek: 24, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { startWeek: 30, endWeek: 34, targetWeek: 31, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      doppler_obstetrico: { startWeek: 32, endWeek: 35, targetWeek: 33, reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { startWeek: 34, endWeek: 38, targetWeek: 35, reminderDaysBefore1: 10, reminderDaysBefore2: 4 }
    }
  },
  alto_risco: {
    id: "alto_risco",
    name: "Ajuste para alto risco",
    description: "Mantem os exames e reforca os lembretes para casos que exigem maior atencao.",
    overrides: {
      exame_obstetrico_inicial: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_1_trimestre: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_2_trimestre: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      doppler_obstetrico: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 }
    }
  },
  gemelar_alto_risco: {
    id: "gemelar_alto_risco",
    name: "Gestacao gemelar com alto risco",
    description: "Combina antecipacao de janelas com lembretes mais fortes para acompanhamento intensivo.",
    overrides: {
      exame_obstetrico_inicial: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_1_trimestre: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_2_trimestre: { startWeek: 19, endWeek: 23, targetWeek: 20, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { startWeek: 22, endWeek: 26, targetWeek: 23, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { startWeek: 30, endWeek: 33, targetWeek: 31, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      doppler_obstetrico: { startWeek: 32, endWeek: 35, targetWeek: 33, reminderDaysBefore1: 12, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { startWeek: 34, endWeek: 37, targetWeek: 35, reminderDaysBefore1: 12, reminderDaysBefore2: 4 }
    }
  }
};

function listKanbanColumns() {
  return db.prepare(`
    SELECT
      id,
      title,
      description,
      sort_order AS sortOrder,
      is_system AS isSystem,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM kanban_columns
    ORDER BY sort_order, title
  `).all().map((column) => ({
    ...column,
    isSystem: Boolean(column.isSystem)
  }));
}

function getKanbanStageIds() {
  return new Set(listKanbanColumns().map((column) => column.id));
}

function normalizePipelineStage(stageId) {
  const validIds = getKanbanStageIds();
  if (stageId && validIds.has(stageId)) {
    return stageId;
  }
  if (validIds.has("contato_pendente")) {
    return "contato_pendente";
  }
  return listKanbanColumns()[0]?.id || "contato_pendente";
}

function slugifyKanbanTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function sanitizePhone(phone) {
  return normalizeBrazilPhone(phone);
}

function fillMessageVariables(template, variables) {
  return String(template || "").replace(/\[([A-Z_]+)\]|\{\{([a-z_]+)\}\}/gi, (match, bracketToken, moustacheToken) => {
    const token = String(bracketToken || moustacheToken || "")
      .trim()
      .toLowerCase();
    return variables[token] ?? match;
  });
}

function buildExamMessageVariables(patient, exam) {
  const idealDate = exam?.idealWindowStartDate ? formatDatePtBr(exam.idealWindowStartDate) : patient?.nextExam?.idealDate || "";

  return {
    nome: patient?.name || "Paciente",
    exame: exam?.name || patient?.nextExam?.name || "seu exame",
    medico: patient?.physicianName || "sua medica",
    unidade: patient?.clinicUnit || "a clinica",
    idade_gestacional: patient?.gestationalAgeLabel || "",
    dpp: patient?.estimatedDueDate || "",
    data_ideal: idealDate
  };
}

function renderExamReminderMessage(template, patient, exam, fallbackMessage) {
  const baseTemplate = String(template || "").trim() || fallbackMessage;
  return fillMessageVariables(baseTemplate, buildExamMessageVariables(patient, exam));
}

function formatGestationalWeekValue(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "-";
  }

  const weeks = Math.floor(numeric);
  const days = Math.round((numeric - weeks) * 7);
  if (!days) {
    return `${weeks}`;
  }
  return `${weeks}s${days}d`;
}

function formatGestationalWeekRange(startWeek, endWeek) {
  return `${formatGestationalWeekValue(startWeek)} a ${formatGestationalWeekValue(endWeek)}`;
}

function normalizeExamCode(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function validatePatientInput(input) {
  if (!input.name?.trim()) {
    throw new Error("Informe o nome completo da paciente.");
  }
  if (!sanitizePhone(input.phone)) {
    throw new Error("Informe o telefone com WhatsApp.");
  }
  if (!input.birthDate) {
    throw new Error("Informe a data de nascimento.");
  }
  const gestationalWeeks = Number(input.gestationalWeeks);
  const gestationalDays = Number(input.gestationalDays);
  if (!Number.isInteger(gestationalWeeks) || gestationalWeeks < 0) {
    throw new Error("Informe a idade gestacional em semanas.");
  }
  if (!Number.isInteger(gestationalDays) || gestationalDays < 0 || gestationalDays > 6) {
    throw new Error("Informe a idade gestacional em dias entre 0 e 6.");
  }
  if (!input.physicianName?.trim()) {
    throw new Error("Informe o medico solicitante.");
  }
  if (!input.clinicUnit?.trim()) {
    throw new Error("Informe a unidade.");
  }
  if (!input.pregnancyType?.trim()) {
    throw new Error("Informe o tipo de gestacao.");
  }
  if (!input.notes?.trim()) {
    throw new Error("Preencha as observacoes.");
  }
  if (input.lastCompletedExamCode != null && String(input.lastCompletedExamCode).trim()) {
    const examCode = String(input.lastCompletedExamCode).trim();
    const validAutomaticExam = db.prepare(`
      SELECT id
      FROM exames_modelo
      WHERE code = ? AND active = 1 AND flow_type = 'automatico'
    `).get(examCode);

    if (!validAutomaticExam) {
      throw new Error("Selecione um ultimo exame realizado valido da esteira automatica.");
    }
  }
}

function validateExamConfigInput(input) {
  if (!String(input.code || "").trim()) {
    throw new Error("Informe o codigo do exame.");
  }

  if (!String(input.name || "").trim()) {
    throw new Error("Informe o nome do exame.");
  }

  const startWeek = Number(input.startWeek);
  const endWeek = Number(input.endWeek);
  const targetWeek = Number(input.targetWeek);
  const reminderDaysBefore1 = Number(input.reminderDaysBefore1 ?? 0);
  const reminderDaysBefore2 = Number(input.reminderDaysBefore2 ?? 0);

  if (Number.isNaN(startWeek) || Number.isNaN(endWeek) || Number.isNaN(targetWeek)) {
    throw new Error("Semanas do exame invalidas.");
  }

  if (startWeek < 0 || endWeek < startWeek) {
    throw new Error("A janela recomendada do exame esta invalida.");
  }

  if (targetWeek < startWeek || targetWeek > endWeek) {
    throw new Error("A semana alvo precisa estar dentro da janela do exame.");
  }

  if (Number.isNaN(reminderDaysBefore1) || Number.isNaN(reminderDaysBefore2) || reminderDaysBefore1 < 0 || reminderDaysBefore2 < 0) {
    throw new Error("Os dias de antecedencia dos lembretes precisam ser validos.");
  }

  if (reminderDaysBefore1 < reminderDaysBefore2) {
    throw new Error("O lembrete 1 precisa acontecer antes do lembrete 2.");
  }

  if (!String(input.defaultMessage || "").trim()) {
    throw new Error("Informe a mensagem padrao do lembrete.");
  }
}

function createAutomaticExamForEligiblePatients(examConfig, createdAt = todayIso()) {
  if (examConfig.flowType !== "automatico" || !examConfig.active) {
    return;
  }

  const existingExamByPatient = new Set(
    db.prepare("SELECT patient_id AS patientId FROM exames_paciente WHERE exam_model_id = ?").all(examConfig.id).map((row) => row.patientId)
  );
  const patients = getPatientsBase();
  const insertExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?)
  `);

  patients.forEach((patient) => {
    if (existingExamByPatient.has(patient.id)) {
      return;
    }

    const snapshot = resolvePregnancySnapshot(patient, createdAt);
    if (!snapshot.dum) {
      return;
    }

    const schedule = calculateExamScheduleDates({
      dum: snapshot.dum,
      targetWeek: examConfig.targetWeek,
      reminderDaysBefore1: examConfig.reminderDaysBefore1,
      reminderDaysBefore2: examConfig.reminderDaysBefore2
    });

    insertExam.run(
      patient.id,
      examConfig.id,
      schedule.predictedDate,
      schedule.reminderDate1,
      schedule.reminderDate2,
      createdAt,
      createdAt
    );
  });
}

function validateExamInferenceRuleInput(input) {
  const typicalStartWeek = Number(input.typicalStartWeek);
  const typicalEndWeek = Number(input.typicalEndWeek);
  const referenceWeek = Number(input.referenceWeek);
  const uncertaintyMarginWeeks = Number(input.uncertaintyMarginWeeks);

  if (
    Number.isNaN(typicalStartWeek) ||
    Number.isNaN(typicalEndWeek) ||
    Number.isNaN(referenceWeek) ||
    Number.isNaN(uncertaintyMarginWeeks)
  ) {
    throw new Error("Preencha semanas e margem de incerteza com valores validos.");
  }

  if (typicalStartWeek < 0 || typicalEndWeek < typicalStartWeek) {
    throw new Error("A faixa gestacional tipica do exame esta invalida.");
  }

  if (referenceWeek < typicalStartWeek || referenceWeek > typicalEndWeek) {
    throw new Error("A semana de referencia precisa ficar dentro da faixa tipica.");
  }

  if (uncertaintyMarginWeeks < 0) {
    throw new Error("A margem de incerteza nao pode ser negativa.");
  }
}

function getAlertPriority(alertLevel) {
  if (alertLevel === "urgente") return 0;
  if (alertLevel === "hoje") return 1;
  if (alertLevel === "proximo") return 2;
  return 3;
}

function formatGestationalAgeLabel(snapshot) {
  if (snapshot.gestationalBaseRequiresManualReview || snapshot.currentGestationalWeeks == null) {
    return "Base gestacional em revisao manual";
  }

  return `${snapshot.currentGestationalWeeks} semanas e ${snapshot.currentGestationalDays} dias`;
}

function getGestationalStoragePayload(snapshot, referenceDate = todayIso()) {
  return {
    dum: null,
    dpp: snapshot.dpp,
    currentGestationalWeeks: snapshot.currentGestationalWeeks,
    currentGestationalDays: snapshot.currentGestationalDays,
    gestationalBaseDate: referenceDate,
    gestationalBaseSource: snapshot.gestationalBaseSource,
    gestationalBaseConfidence: snapshot.gestationalBaseConfidence,
    gestationalBaseIsEstimated: snapshot.gestationalBaseIsEstimated ? 1 : 0,
    gestationalReviewRequired: snapshot.gestationalBaseRequiresManualReview ? 1 : 0,
    gestationalBaseConflict: snapshot.gestationalBaseHasConflict ? 1 : 0,
    gestationalBaseConflictNote: snapshot.gestationalBaseConflictNote || null
  };
}

function getPatientExamsByPatient() {
  const rows = db.prepare(`
    SELECT
      ep.id,
      ep.patient_id AS patientId,
      ep.exam_model_id AS examModelId,
      ep.predicted_date AS predictedDate,
      ep.reminder_date_1 AS reminderDate1,
      ep.reminder_date_2 AS reminderDate2,
      ep.scheduled_date AS scheduledDate,
      ep.scheduled_time AS scheduledTime,
      ep.scheduling_notes AS schedulingNotes,
      ep.scheduled_by_user_id AS scheduledByUserId,
      ep.last_contacted_at AS lastContactedAt,
      ep.reminder_snoozed_until AS reminderSnoozedUntil,
      ep.completed_date AS completedDate,
      ep.completed_by_user_id AS completedByUserId,
      ep.completed_outside_clinic AS completedOutsideClinic,
      ep.shosp_exam_id AS shospExamId,
      ep.imported_from_shosp AS importedFromShosp,
      ep.status,
      p.dum AS patientDum,
      em.code,
      em.name,
      em.required,
      em.flow_type AS flowType,
      em.sort_order AS sortOrder,
      em.start_week AS startWeek,
      em.end_week AS endWeek,
      em.target_week AS targetWeek,
      em.default_message AS defaultMessage,
      rule.reference_week AS inferenceReferenceWeek,
      rule.uncertainty_margin_weeks AS inferenceUncertaintyMarginWeeks,
      rule.allow_automatic_inference AS allowAutomaticInference,
      rule.active AS inferenceRuleActive,
      scheduled_user.name AS scheduledByName,
      completed_user.name AS completedByName
    FROM exames_paciente ep
    INNER JOIN exames_modelo em ON em.id = ep.exam_model_id
    INNER JOIN patients p ON p.id = ep.patient_id
    LEFT JOIN regras_inferencia_gestacional rule ON rule.exam_model_id = ep.exam_model_id
    LEFT JOIN users scheduled_user ON scheduled_user.id = ep.scheduled_by_user_id
    LEFT JOIN users completed_user ON completed_user.id = ep.completed_by_user_id
    ORDER BY em.sort_order
  `).all();

  return rows.reduce((map, row) => {
    const current = map.get(row.patientId) ?? [];
    current.push({
      ...row,
      completedOutsideClinic: Boolean(row.completedOutsideClinic),
      importedFromShosp: Boolean(row.importedFromShosp),
      allowAutomaticInference: Boolean(row.allowAutomaticInference),
      inferenceRuleActive: Boolean(row.inferenceRuleActive),
      idealWindowStartDate: row.predictedDate ? addDays(row.predictedDate, (Number(row.startWeek) - Number(row.targetWeek)) * 7) : null
    });
    map.set(row.patientId, current);
    return map;
  }, new Map());
}

function getLatestMessagesByPatient() {
  const rows = db.prepare(`
    SELECT
      m.id,
      m.patient_id AS patientId,
      m.exam_model_id AS examModelId,
      m.content,
      m.delivery_status AS deliveryStatus,
      m.sent_at AS sentAt,
      m.response_status AS responseStatus,
      m.response_text AS responseText,
      m.response_at AS responseAt
    FROM mensagens m
    ORDER BY m.created_at DESC, m.id DESC
  `).all();

  const latestByPatient = new Map();
  rows.forEach((row) => {
    if (!latestByPatient.has(row.patientId)) {
      latestByPatient.set(row.patientId, row);
    }
  });
  return latestByPatient;
}

function getMessageHistoryByPatient() {
  const rows = db.prepare(`
    SELECT
      m.id,
      m.patient_id AS patientId,
      m.exam_model_id AS examModelId,
      m.content,
      m.delivery_status AS deliveryStatus,
      m.sent_at AS sentAt,
      m.response_status AS responseStatus,
      m.response_text AS responseText,
      m.response_at AS responseAt
    FROM mensagens m
    ORDER BY m.created_at DESC, m.id DESC
  `).all();

  return rows.reduce((map, row) => {
    const current = map.get(row.patientId) ?? [];
    current.push(row);
    map.set(row.patientId, current);
    return map;
  }, new Map());
}

function getMovementHistoryByPatient() {
  const rows = db.prepare(`
    SELECT
      id,
      patient_id AS patientId,
      from_stage AS fromStage,
      to_stage AS toStage,
      action_type AS actionType,
      description,
      metadata_json AS metadataJson,
      created_at AS createdAt
    FROM historico_de_movimentacoes
    ORDER BY created_at DESC, id DESC
  `).all();

  return rows.reduce((map, row) => {
    const current = map.get(row.patientId) ?? [];
    current.push({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null
    });
    map.set(row.patientId, current);
    return map;
  }, new Map());
}

function buildCompletedDateLabel(exam) {
  if (exam.completedDate) {
    return formatDatePtBr(exam.completedDate);
  }

  if (exam.status === "realizado") {
    return exam.completedOutsideClinic ? "Ja realizado (data nao informada)" : "Realizado (data nao informada)";
  }

  return null;
}

function buildNextExam(patientExamRows) {
  const timeline = analyzePatientExamTimeline(patientExamRows);
  const pendingExam = timeline.nextExam;

  if (!pendingExam) {
    return {
      name: "Fluxo de exames finalizado",
      date: null,
      dateLabel: "Sem pendencia no protocolo padrao",
      alertLevel: "ok",
      alertLabel: "Sem pendencia",
      deadlineStatus: DEADLINE_STATUS.COMPLETED,
      deadlineStatusLabel: "Realizado",
      idealDate: null,
      required: false,
      flowType: "automatico",
      code: null,
      overdueExam: timeline.overdueExam
    };
  }

  return {
    id: pendingExam.examModelId,
    code: pendingExam.code,
    name: pendingExam.name,
    required: Boolean(pendingExam.required),
    flowType: pendingExam.flowType,
    status: pendingExam.status,
    date: pendingExam.predictedDate,
    scheduledDate: pendingExam.scheduledDate || null,
    scheduledDateLabel: pendingExam.scheduledDate ? formatDatePtBr(pendingExam.scheduledDate) : null,
    importedFromShosp: Boolean(pendingExam.importedFromShosp),
    detectedInShosp: Boolean(pendingExam.importedFromShosp && pendingExam.status === "agendado"),
    dateLabel: `${formatDatePtBr(pendingExam.predictedDate)} • janela ${formatGestationalWeekRange(pendingExam.startWeek, pendingExam.endWeek)} semanas`,
    alertLevel: pendingExam.alertLevel,
    alertLabel: pendingExam.alertLabel,
    deadlineStatus: pendingExam.deadlineStatus,
    deadlineStatusLabel: pendingExam.deadlineStatusLabel,
    idealDate: pendingExam.idealDateLabel,
    overdueExam: timeline.overdueExam
      ? {
          id: timeline.overdueExam.examModelId,
          code: timeline.overdueExam.code,
          name: timeline.overdueExam.name
        }
      : null
  };
}

function buildManualReviewNextExam() {
  return {
    name: "Revisao manual da base gestacional",
    date: null,
    dateLabel: "Nao foi possivel estimar a base gestacional com seguranca.",
    alertLevel: "urgente",
    alertLabel: "Revisao manual",
    deadlineStatus: "revisao_manual",
    deadlineStatusLabel: "Revisao manual",
    idealDate: null,
    required: false,
    flowType: "manual",
    code: null,
    overdueExam: null
  };
}

function inferStage(patient, patientExams, latestMessage) {
  const currentStage = normalizePipelineStage(patient.stage);

  if (patient.status === "encerrada") {
    return currentStage;
  }

  if (patient.gestationalReviewRequired) {
    return "revisao_base_gestacional";
  }

  const nextExam = buildNextExam(patientExams);
  if (!nextExam.code) {
    return ["contato_pendente", "mensagem_enviada", "follow_up", "agendada"].includes(currentStage)
      ? "contato_pendente"
      : currentStage;
  }

  if (patientExams.some((exam) => exam.status === "agendado" && exam.completedDate == null)) {
    return "agendada";
  }

  if (!["contato_pendente", "mensagem_enviada", "follow_up", "agendada"].includes(currentStage)) {
    return currentStage;
  }

  const latestMessageNeedsFollowUp =
    latestMessage?.deliveryStatus === "enviada" &&
    latestMessage?.responseStatus !== "respondida" &&
    latestMessage?.sentAt &&
    addDays(latestMessage.sentAt, 2) <= todayIso();

  if (latestMessageNeedsFollowUp) {
    return "follow_up";
  }

  if (
    ["mensagem_enviada", "follow_up"].includes(currentStage) &&
    latestMessage?.deliveryStatus === "enviada" &&
    latestMessage?.responseStatus !== "respondida"
  ) {
    return "mensagem_enviada";
  }

  return "contato_pendente";
}

function enrichPatient(patient, patientExamsMap, latestMessagesMap) {
  const patientExams = patientExamsMap.get(patient.id) ?? [];
  const snapshot = resolvePregnancySnapshot(patient, todayIso(), { patientExams });
  const latestMessage = latestMessagesMap.get(patient.id) ?? null;
  const nextExam = snapshot.gestationalBaseRequiresManualReview
    ? buildManualReviewNextExam()
    : buildNextExam(patientExams);
  const nextPendingExamRow = patientExams.find((row) => row.status !== "realizado");
  const nextExamSuggestedMessage = snapshot.gestationalBaseRequiresManualReview
    ? null
    : renderExamReminderMessage(
        nextPendingExamRow?.defaultMessage,
        {
          ...patient,
          gestationalAgeLabel: formatGestationalAgeLabel(snapshot),
          estimatedDueDate: snapshot.dpp ? formatDatePtBr(snapshot.dpp) : ""
        },
        nextPendingExamRow,
        `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`
      );
  const stageMap = new Map(listKanbanColumns().map((column) => [column.id, column.title]));
  const normalizedStage = inferStage(
    {
      ...patient,
      gestationalWeeks: snapshot.currentGestationalWeeks,
      gestationalReviewRequired: snapshot.gestationalBaseRequiresManualReview
    },
    patientExams,
    latestMessage
  );

  return {
    ...patient,
    highRisk: Boolean(patient.highRisk),
    importedFromShosp: Boolean(patient.importedFromShosp),
    gestationalBaseIsEstimated: Boolean(patient.gestationalBaseIsEstimated) || snapshot.gestationalBaseIsEstimated,
    gestationalReviewRequired: Boolean(patient.gestationalReviewRequired) || snapshot.gestationalBaseRequiresManualReview,
    gestationalBaseHasConflict: Boolean(patient.gestationalBaseConflict) || snapshot.gestationalBaseHasConflict,
    stage: normalizedStage,
    dum: snapshot.dum,
    dpp: snapshot.dpp,
    estimatedDueDate: snapshot.dpp ? formatDatePtBr(snapshot.dpp) : "Revisao manual necessaria",
    gestationalWeeks: snapshot.currentGestationalWeeks,
    gestationalDays: snapshot.currentGestationalDays,
    gestationalAgeLabel: formatGestationalAgeLabel(snapshot),
    gestationalBaseSource: snapshot.gestationalBaseSource,
    gestationalBaseSourceLabel: snapshot.gestationalBaseSourceLabel,
    gestationalBaseConfidence: snapshot.gestationalBaseConfidence,
    gestationalBaseConfidenceLabel: snapshot.gestationalBaseConfidenceLabel,
    gestationalBaseExplanation: snapshot.gestationalBaseExplanation,
    gestationalBaseConflictNote: patient.gestationalBaseConflictNote || snapshot.gestationalBaseConflictNote,
    nextExam: {
      ...nextExam,
      suggestedMessage: nextExamSuggestedMessage
    },
    priorityScore: getAlertPriority(nextExam.alertLevel),
    latestMessage,
    stageTitle: stageMap.get(normalizedStage) || normalizedStage
  };
}

function resolvePatientStage(patient, patientExams, latestMessage) {
  const snapshot = resolvePregnancySnapshot(patient, todayIso(), { patientExams });
  return inferStage(
    {
      ...patient,
      gestationalWeeks: snapshot.currentGestationalWeeks,
      gestationalReviewRequired: snapshot.gestationalBaseRequiresManualReview
    },
    patientExams,
    latestMessage
  );
}

function getPatientsBase() {
  return db.prepare(`
    SELECT
      id,
      name,
      phone,
      birth_date AS birthDate,
      dum,
      dpp,
      current_gestational_weeks AS gestationalWeeks,
      current_gestational_days AS gestationalDays,
      gestational_base_date AS gestationalBaseDate,
      gestational_base_source AS gestationalBaseSource,
      gestational_base_confidence AS gestationalBaseConfidence,
      gestational_base_is_estimated AS gestationalBaseIsEstimated,
      gestational_review_required AS gestationalReviewRequired,
      gestational_base_conflict AS gestationalBaseConflict,
      gestational_base_conflict_note AS gestationalBaseConflictNote,
      physician_name AS physicianName,
      clinic_unit AS clinicUnit,
      pregnancy_type AS pregnancyType,
      high_risk AS highRisk,
      shosp_patient_id AS shospPatientId,
      imported_from_shosp AS importedFromShosp,
      sync_status AS syncStatus,
      notes,
      status,
      stage,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM patients
    ORDER BY created_at DESC, id DESC
  `).all();
}

export function listPatients() {
  const patientExamsMap = getPatientExamsByPatient();
  const latestMessagesMap = getLatestMessagesByPatient();

  return getPatientsBase().map((patient) => enrichPatient(patient, patientExamsMap, latestMessagesMap));
}

function sortPatientsByPriority(patients) {
  return [...patients].sort((left, right) => {
    if (left.priorityScore !== right.priorityScore) {
      return left.priorityScore - right.priorityScore;
    }

    if (left.nextExam.date && right.nextExam.date) {
      return left.nextExam.date.localeCompare(right.nextExam.date);
    }

    return left.name.localeCompare(right.name, "pt-BR");
  });
}

function getMessageRows() {
  return db.prepare(`
    SELECT
      m.id,
      patient_id AS patientId,
      exam_model_id AS examModelId,
      content,
      delivery_status AS deliveryStatus,
      sent_at AS sentAt,
      response_status AS responseStatus,
      response_text AS responseText,
      response_at AS responseAt,
      m.created_at AS createdAt,
      m.created_by_user_id AS createdByUserId,
      users.name AS createdByUserName
    FROM mensagens m
    LEFT JOIN users ON users.id = m.created_by_user_id
    ORDER BY m.created_at DESC, m.id DESC
  `).all();
}

function getMovementRows() {
  return db.prepare(`
    SELECT
      hm.id,
      hm.patient_id AS patientId,
      hm.from_stage AS fromStage,
      hm.to_stage AS toStage,
      hm.action_type AS actionType,
      hm.description,
      hm.created_at AS createdAt,
      hm.created_by_user_id AS createdByUserId,
      users.name AS createdByUserName
    FROM historico_de_movimentacoes hm
    LEFT JOIN users ON users.id = hm.created_by_user_id
    ORDER BY hm.created_at DESC, hm.id DESC
  `).all();
}

function normalizeDashboardFilters(input = {}) {
  const today = todayIso();
  const period = String(input.period || "7d");

  let dateFrom = input.dateFrom || addDays(today, -29);
  let dateTo = input.dateTo || today;

  if (!input.dateFrom && !input.dateTo) {
    if (period === "7d") {
      dateFrom = addDays(today, -6);
    }
    if (period === "15d") {
      dateFrom = addDays(today, -14);
    }
    if (period === "90d") {
      dateFrom = addDays(today, -89);
    }
  }

  return {
    period,
    dateFrom,
    dateTo,
    clinicUnit: input.clinicUnit ? String(input.clinicUnit) : "",
    physicianName: input.physicianName ? String(input.physicianName) : ""
  };
}

function isDateWithinRange(date, filters) {
  if (!date) {
    return false;
  }

  return date >= filters.dateFrom && date <= filters.dateTo;
}

function buildDashboardBuckets(filters) {
  const buckets = [];
  let cursor = filters.dateFrom;

  while (cursor <= filters.dateTo) {
    buckets.push({
      date: cursor,
      label: formatDatePtBr(cursor),
      messages: 0,
      scheduled: 0,
      completed: 0
    });
    cursor = addDays(cursor, 1);
  }

  return buckets;
}

function applyPatientFilters(patients, filters) {
  return patients.filter((patient) => {
    if (filters.clinicUnit && patient.clinicUnit !== filters.clinicUnit) {
      return false;
    }
    if (filters.physicianName && patient.physicianName !== filters.physicianName) {
      return false;
    }
    return true;
  });
}

export function getDashboardData(inputFilters = {}) {
  const filters = normalizeDashboardFilters(inputFilters);
  const allPatients = listPatients();
  const filterOptions = {
    clinicUnits: [...new Set(allPatients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(allPatients.map((patient) => patient.physicianName).filter(Boolean))].sort()
  };
  const patients = applyPatientFilters(allPatients, filters);
  const patientIds = new Set(patients.map((patient) => patient.id));
  const patientExamsMap = getPatientExamsByPatient();
  const examRows = [...patientExamsMap.values()].flat().filter((exam) => patientIds.has(exam.patientId));
  const messageRows = getMessageRows().filter((message) => patientIds.has(message.patientId));
  const movementRows = getMovementRows().filter((movement) => patientIds.has(movement.patientId));
  const today = todayIso();
  const endOfWeek = addDays(today, 6);
  const pendingExamCounts = new Map();
  const patientsToContactToday = sortPatientsByPriority(
    patients.filter((patient) => {
      const nextExamRow = (patientExamsMap.get(patient.id) ?? []).find((exam) => exam.code === patient.nextExam.code);
      return shouldPatientEnterReminderQueue(patient, nextExamRow, today);
    })
  );

  examRows
    .filter((exam) => exam.status !== "realizado")
    .forEach((exam) => {
      pendingExamCounts.set(exam.name, (pendingExamCounts.get(exam.name) || 0) + 1);
    });

  const examsMostPending = [...pendingExamCounts.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "pt-BR"))
    .slice(0, 5);

  const messagesInPeriod = messageRows.filter((message) => isDateWithinRange(message.sentAt || message.createdAt, filters));
  const scheduledMovementsInPeriod = movementRows.filter(
    (movement) => movement.actionType === "exame_agendado" && isDateWithinRange(movement.createdAt, filters)
  );
  const completedExamsInPeriod = examRows.filter((exam) => isDateWithinRange(exam.completedDate, filters));

  const chartBuckets = buildDashboardBuckets(filters);
  const bucketsByDate = new Map(chartBuckets.map((bucket) => [bucket.date, bucket]));

  messagesInPeriod.forEach((message) => {
    const bucket = bucketsByDate.get(message.sentAt || message.createdAt);
    if (bucket) {
      bucket.messages += 1;
    }
  });

  examRows.filter((exam) => isDateWithinRange(exam.scheduledDate, filters)).forEach((exam) => {
    const bucket = bucketsByDate.get(exam.scheduledDate);
    if (bucket) {
      bucket.scheduled += 1;
    }
  });

  completedExamsInPeriod.forEach((exam) => {
    const bucket = bucketsByDate.get(exam.completedDate);
    if (bucket) {
      bucket.completed += 1;
    }
  });

  return {
    filters,
    filterOptions,
    summary: {
      remindersDueToday: patientsToContactToday.length,
      gestationalBaseManualReview: patients.filter((patient) => isMessagingBlockedByGestationalBase(patient)).length,
      patientsToContactToday: patientsToContactToday.length,
      overduePatients: patients.filter((patient) => patient.nextExam.deadlineStatus === DEADLINE_STATUS.OVERDUE).length,
      scheduledThisWeek: new Set(
        examRows
          .filter((exam) => exam.scheduledDate && exam.scheduledDate >= today && exam.scheduledDate <= endOfWeek)
          .map((exam) => exam.patientId)
      ).size,
      conversionRate: messagesInPeriod.length
        ? Math.round((scheduledMovementsInPeriod.length / messagesInPeriod.length) * 100)
        : 0,
      totalMessagesSent: messagesInPeriod.length,
      totalExamsCompleted: completedExamsInPeriod.length
    },
    lists: {
      patientsToContactToday: patientsToContactToday.slice(0, 8),
      overduePatients: sortPatientsByPriority(
        patients.filter((patient) => patient.nextExam.deadlineStatus === DEADLINE_STATUS.OVERDUE)
      ).slice(0, 8),
      scheduledThisWeek: sortPatientsByPriority(
        patients.filter((patient) =>
          examRows.some(
            (exam) => exam.patientId === patient.id && exam.scheduledDate && exam.scheduledDate >= today && exam.scheduledDate <= endOfWeek
          )
        )
      ).slice(0, 8),
      examsMostPending
    },
    charts: {
      activityByDay: chartBuckets,
      completedExamsByPeriod: chartBuckets.map((bucket) => ({
        date: bucket.date,
        label: bucket.label,
        total: bucket.completed
      }))
    }
  };
}

export function getReportsData(inputFilters = {}) {
  const filters = normalizeDashboardFilters(inputFilters);
  const allPatients = listPatients();
  const filterOptions = {
    clinicUnits: [...new Set(allPatients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(allPatients.map((patient) => patient.physicianName).filter(Boolean))].sort()
  };
  const patients = applyPatientFilters(allPatients, filters);
  const patientIds = new Set(patients.map((patient) => patient.id));
  const examRows = [...getPatientExamsByPatient().values()].flat().filter((exam) => patientIds.has(exam.patientId));
  const messageRows = getMessageRows().filter((message) => patientIds.has(message.patientId));
  const movementRows = getMovementRows().filter((movement) => patientIds.has(movement.patientId));
  const stageMap = new Map(listKanbanColumns().map((column) => [column.id, column.title]));

  const pendingExams = examRows
    .filter((exam) => exam.status !== "realizado")
    .map((exam) => {
      const patient = patients.find((item) => item.id === exam.patientId);
      return {
        patientId: exam.patientId,
        patientName: patient?.name || "Paciente",
        examName: exam.name,
        examCode: exam.code,
        predictedDate: exam.predictedDate,
        predictedDateLabel: exam.predictedDate ? formatDatePtBr(exam.predictedDate) : "Nao definida",
        deadlineStatusLabel: analyzePatientExamTimeline([exam]).assessedExams[0]?.deadlineStatusLabel || "Pendente",
        physicianName: patient?.physicianName || null,
        clinicUnit: patient?.clinicUnit || null
      };
    })
    .sort((left, right) => {
      if (left.predictedDate && right.predictedDate && left.predictedDate !== right.predictedDate) {
        return left.predictedDate.localeCompare(right.predictedDate);
      }
      return left.patientName.localeCompare(right.patientName, "pt-BR");
    });

  const overdueExams = pendingExams.filter((exam) => exam.deadlineStatusLabel === "Atrasado");

  const contactsMade = [
    ...messageRows
      .filter((message) => isDateWithinRange(message.sentAt || message.createdAt, filters))
      .map((message) => {
        const patient = patients.find((item) => item.id === message.patientId);
        const date = message.sentAt || message.createdAt;
        return {
          patientId: message.patientId,
          patientName: patient?.name || "Paciente",
          contactType: "Mensagem",
          status: message.responseStatus === "respondida" ? "Respondida" : "Enviada",
          date,
          dateLabel: formatDatePtBr(date),
          userName: message.createdByUserName || null,
          physicianName: patient?.physicianName || null,
          clinicUnit: patient?.clinicUnit || null
        };
      }),
    ...movementRows
      .filter((movement) => movement.actionType === "contato_realizado" && isDateWithinRange(movement.createdAt, filters))
      .map((movement) => {
        const patient = patients.find((item) => item.id === movement.patientId);
        return {
          patientId: movement.patientId,
          patientName: patient?.name || "Paciente",
          contactType: "Contato manual",
          status: "Realizado",
          date: movement.createdAt,
          dateLabel: formatDatePtBr(movement.createdAt),
          userName: movement.createdByUserName || null,
          physicianName: patient?.physicianName || null,
          clinicUnit: patient?.clinicUnit || null
        };
      })
  ].sort((left, right) => right.date.localeCompare(left.date));

  const scheduledByPeriod = examRows
    .filter((exam) => isDateWithinRange(exam.scheduledDate, filters))
    .map((exam) => {
      const patient = patients.find((item) => item.id === exam.patientId);
      return {
        patientId: exam.patientId,
        patientName: patient?.name || "Paciente",
        examName: exam.name,
        scheduledDate: exam.scheduledDate,
        scheduledDateLabel: exam.scheduledDate ? formatDatePtBr(exam.scheduledDate) : "Nao informado",
        scheduledTime: exam.scheduledTime || null,
        userName: exam.scheduledByName || null,
        physicianName: patient?.physicianName || null,
        clinicUnit: patient?.clinicUnit || null
      };
    })
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate));

  const completedExamsInPeriod = examRows.filter((exam) => isDateWithinRange(exam.completedDate, filters));
  const scheduledMovementsInPeriod = movementRows.filter(
    (movement) => movement.actionType === "exame_agendado" && isDateWithinRange(movement.createdAt, filters)
  );

  const productivityMap = new Map();
  const trackedActions = movementRows.filter((movement) =>
    ["mensagem_enviada", "contato_realizado", "exame_agendado", "exame_realizado", "movimentacao_kanban"].includes(movement.actionType) &&
    isDateWithinRange(movement.createdAt, filters)
  );

  trackedActions.forEach((movement) => {
    const userId = movement.createdByUserId || 0;
    const userName = movement.createdByUserName || "Nao identificado";
    const current = productivityMap.get(userId) || {
      userId,
      userName,
      contacts: 0,
      scheduled: 0,
      completed: 0,
      totalActions: 0
    };

    if (["mensagem_enviada", "contato_realizado"].includes(movement.actionType)) {
      current.contacts += 1;
    }
    if (movement.actionType === "exame_agendado") {
      current.scheduled += 1;
    }
    if (movement.actionType === "exame_realizado") {
      current.completed += 1;
    }
    current.totalActions += 1;
    productivityMap.set(userId, current);
  });

  const productivityByUser = [...productivityMap.values()].sort((left, right) => {
    if (right.totalActions !== left.totalActions) {
      return right.totalActions - left.totalActions;
    }
    return left.userName.localeCompare(right.userName, "pt-BR");
  });

  const patientsByStage = listKanbanColumns().map((column) => ({
    stage: column.id,
    stageTitle: column.title,
    total: patients.filter((patient) => patient.stage === column.id).length
  }));

  const contactsCount = contactsMade.length;

  return {
    filters,
    filterOptions,
    summary: {
      pendingExams: pendingExams.length,
      overdueExams: overdueExams.length,
      contactsMade: contactsCount,
      scheduledCount: scheduledByPeriod.length,
      conversionRate: contactsCount ? Math.round((scheduledMovementsInPeriod.length / contactsCount) * 100) : 0
    },
    reports: {
      patientsByStage,
      pendingExams,
      overdueExams,
      contactsMade,
      scheduledByPeriod,
      productivityByUser
    }
  };
}

export function getKanbanData() {
  const patients = listPatients();
  return listKanbanColumns().map((stage) => ({
    ...stage,
    patients: sortPatientsByPriority(patients.filter((patient) => patient.stage === stage.id))
  }));
}

function buildReminderLabel(examRow) {
  const timeline = analyzePatientExamTimeline([examRow]);
  const assessedExam = timeline.assessedExams[0];

  if (!assessedExam) {
    return "Aguardando janela de lembrete";
  }

  if (assessedExam.deadlineStatus === DEADLINE_STATUS.OVERDUE) {
    return "Exame atrasado";
  }
  if (assessedExam.deadlineStatus === DEADLINE_STATUS.PENDING) {
    return "Acao imediata";
  }
  if (assessedExam.deadlineStatus === DEADLINE_STATUS.APPROACHING) {
    return "Aproximando";
  }
  return "Dentro da janela ideal";
}

function getOperationalMessagePriority(deadlineStatus) {
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) {
    return { level: "alta", label: "Alta prioridade", score: 0 };
  }
  if ([DEADLINE_STATUS.PENDING, DEADLINE_STATUS.APPROACHING].includes(deadlineStatus)) {
    return { level: "media", label: "Media prioridade", score: 1 };
  }
  return { level: "baixa", label: "Baixa prioridade", score: 2 };
}

function getOperationalMessageType(deadlineStatus) {
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) {
    return { type: "atraso", label: "Exame em atraso", origin: "timeline_atraso", originLabel: "Timeline - atraso operacional" };
  }
  if (deadlineStatus === DEADLINE_STATUS.PENDING) {
    return { type: "janela_ideal", label: "Janela ideal ativa", origin: "timeline_janela_ideal", originLabel: "Timeline - janela ideal" };
  }
  if (deadlineStatus === DEADLINE_STATUS.APPROACHING) {
    return { type: "janela_proxima", label: "Janela se aproximando", origin: "timeline_proximidade", originLabel: "Timeline - proximidade da janela" };
  }
  return { type: "acompanhamento", label: "Acompanhamento normal", origin: "timeline_acompanhamento", originLabel: "Timeline - acompanhamento" };
}

function buildOperationalSuggestedMessage(template, patient, exam, fallbackMessage, deadlineStatus) {
  const baseMessage = renderExamReminderMessage(template, patient, exam, fallbackMessage).trim();
  const examName = exam?.examName || exam?.name || patient?.nextExam?.name || "seu exame";
  const examContext = exam?.required
    ? "Esse exame faz parte do protocolo principal desta fase."
    : "Esse exame e recomendado conforme a evolucao da gestacao.";

  let operationalContext = `Contexto atual: ${patient?.gestationalAgeLabel || "fase atual da gestacao"}.`;
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) {
    operationalContext = `Observacao da equipe: o ${examName} esta atrasado e precisa de prioridade no agendamento.`;
  } else if (deadlineStatus === DEADLINE_STATUS.PENDING) {
    operationalContext = `Observacao da equipe: este e o momento ideal para organizar o ${examName}.`;
  } else if (deadlineStatus === DEADLINE_STATUS.APPROACHING) {
    operationalContext = `Observacao da equipe: a janela ideal do ${examName} esta se aproximando.`;
  } else {
    operationalContext = `Observacao da equipe: seguimos acompanhando o melhor momento para o ${examName}.`;
  }

  return `${baseMessage}\n\n${operationalContext}\n${examContext}`.trim();
}

function findOperationalExamRow(patientExams, patient) {
  return patientExams.find((row) => row.code && row.code === patient?.nextExam?.code)
    || patientExams.find((row) => row.status !== "realizado")
    || null;
}

export function getMessagingOverview() {
  const patients = listPatients();
  const patientExamsMap = getPatientExamsByPatient();
  const latestMessages = getLatestMessagesByPatient();
  const messageHistoryByPatient = getMessageHistoryByPatient();

  return sortPatientsByPriority(
    patients
      .filter((patient) => !isMessagingBlockedByGestationalBase(patient))
      .map((patient) => {
      const nextPendingExam = findOperationalExamRow(patientExamsMap.get(patient.id) ?? [], patient);
      const latestMessage = latestMessages.get(patient.id) ?? null;
      const messagePriority = getOperationalMessagePriority(patient.nextExam.deadlineStatus);
      const messageType = getOperationalMessageType(patient.nextExam.deadlineStatus);
      const suggestedMessage = buildOperationalSuggestedMessage(
        nextPendingExam?.defaultMessage,
        patient,
        nextPendingExam,
        `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com seu acompanhamento?`,
        patient.nextExam.deadlineStatus
      );
      const gestationalMessagingAlert = buildGestationalMessagingAlert(patient);

      return {
        patientId: patient.id,
        patientName: patient.name,
        phone: patient.phone,
        physicianName: patient.physicianName,
        clinicUnit: patient.clinicUnit,
        stage: patient.stage,
        gestationalAgeLabel: patient.gestationalAgeLabel,
        nextExam: patient.nextExam,
        priorityScore: messagePriority.score,
        priorityLevel: messagePriority.level,
        priorityLabel: messagePriority.label,
        messageType: messageType.type,
        messageTypeLabel: messageType.label,
        messageOrigin: messageType.origin,
        messageOriginLabel: messageType.originLabel,
        suggestedMessage,
        reminderLabel: nextPendingExam ? buildReminderLabel(nextPendingExam) : "Sem mensagem pendente",
        examModelId: nextPendingExam?.examModelId ?? null,
        latestMessage,
        messageHistory: messageHistoryByPatient.get(patient.id) ?? [],
        gestationalBaseSourceLabel: patient.gestationalBaseSourceLabel || "Base nao definida",
        gestationalBaseConfidenceLabel: patient.gestationalBaseConfidenceLabel || "Nao avaliada",
        gestationalBaseIsEstimated: Boolean(patient.gestationalBaseIsEstimated),
        gestationalReviewRequired: Boolean(patient.gestationalReviewRequired),
        gestationalBaseExplanation: patient.gestationalBaseExplanation || null,
        gestationalMessagingAlertLevel: gestationalMessagingAlert.level,
        gestationalMessagingAlertMessage: gestationalMessagingAlert.message
      };
    })
  );
}

function normalizeReminderFilters(input = {}) {
  return {
    clinicUnit: input.clinicUnit ? String(input.clinicUnit) : "",
    physicianName: input.physicianName ? String(input.physicianName) : "",
    examCode: input.examCode ? String(input.examCode) : ""
  };
}

function shouldPatientEnterReminderQueue(patient, nextExamRow, today, filters = null) {
  if (isMessagingBlockedByGestationalBase(patient) || !nextExamRow) {
    return false;
  }

  const needsContactToday = ["atrasado", "pendente", "aproximando"].includes(patient.nextExam.deadlineStatus || "");
  const snoozed = nextExamRow.reminderSnoozedUntil && nextExamRow.reminderSnoozedUntil > today;
  const alreadyContactedToday = nextExamRow.lastContactedAt === today;

  if (!needsContactToday || snoozed || alreadyContactedToday) {
    return false;
  }
  if (filters?.clinicUnit && patient.clinicUnit !== filters.clinicUnit) {
    return false;
  }
  if (filters?.physicianName && patient.physicianName !== filters.physicianName) {
    return false;
  }
  if (filters?.examCode && patient.nextExam.code !== filters.examCode) {
    return false;
  }

  return true;
}

function registerAutomaticShospScheduleDetection({ patient, examPatientId, shospSchedule }) {
  const now = todayIso();
  const shospExamId = shospSchedule.externalExamItemId || shospSchedule.externalExamRequestId || null;
  const currentExam = db.prepare(`
    SELECT
      id,
      status,
      scheduled_date AS scheduledDate,
      scheduled_time AS scheduledTime
    FROM exames_paciente
    WHERE id = ? AND patient_id = ?
  `).get(examPatientId, patient.id);

  if (!currentExam) {
    return;
  }

  const existingShospExam = shospExamId
    ? db.prepare(`
        SELECT
          id,
          patient_id AS patientId,
          status,
          scheduled_date AS scheduledDate,
          scheduled_time AS scheduledTime
        FROM exames_paciente
        WHERE shosp_exam_id = ?
        LIMIT 1
      `).get(shospExamId)
    : null;

  const hasSameSchedule =
    currentExam.status === "agendado" &&
    currentExam.scheduledDate === (shospSchedule.scheduledDate || null) &&
    currentExam.scheduledTime === (shospSchedule.scheduledTime || null);

  if (hasSameSchedule || (existingShospExam && existingShospExam.id !== examPatientId)) {
    if (patient.stage !== "agendada") {
      db.prepare(`
        UPDATE patients
        SET stage = 'agendada', updated_at = ?
        WHERE id = ?
      `).run(now, patient.id);
    }
    return;
  }

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE exames_paciente
      SET
        status = 'agendado',
        scheduled_date = @scheduledDate,
        scheduled_time = @scheduledTime,
        scheduling_notes = @schedulingNotes,
        shosp_exam_id = COALESCE(@shospExamId, shosp_exam_id),
        shosp_last_sync_at = @shospLastSyncAt,
        imported_from_shosp = 1,
        sync_status = 'sincronizado',
        sync_error = NULL,
        external_source = 'shosp',
        external_exam_request_id = COALESCE(@externalExamRequestId, external_exam_request_id),
        external_attendance_id = COALESCE(@externalAttendanceId, external_attendance_id),
        external_exam_item_id = COALESCE(@externalExamItemId, external_exam_item_id),
        updated_at = @updatedAt
      WHERE id = @id AND patient_id = @patientId
    `).run({
      id: examPatientId,
      patientId: patient.id,
      scheduledDate: shospSchedule.scheduledDate || null,
      scheduledTime: shospSchedule.scheduledTime || null,
      schedulingNotes: "Agendamento futuro detectado automaticamente no Shosp.",
      shospExamId,
      shospLastSyncAt: shospSchedule.updatedAt || now,
      externalExamRequestId: shospSchedule.externalExamRequestId || null,
      externalAttendanceId: shospSchedule.externalAttendanceId || null,
      externalExamItemId: shospSchedule.externalExamItemId || null,
      updatedAt: now
    });

    db.prepare(`
      UPDATE patients
      SET stage = 'agendada', updated_at = ?
      WHERE id = ?
    `).run(now, patient.id);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, 'agendada', 'agendamento_detectado_shosp', ?, ?, 1, ?)
    `).run(
      patient.id,
      patient.stage,
      `Agendamento do exame ${patient.nextExam.name} detectado automaticamente no Shosp.`,
      JSON.stringify({
        examPatientId,
        examCode: patient.nextExam.code || null,
        scheduledDate: shospSchedule.scheduledDate || null,
        scheduledTime: shospSchedule.scheduledTime || null,
        source: "shosp"
      }),
      now
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function getRemindersCenterData(inputFilters = {}) {
  const filters = normalizeReminderFilters(inputFilters);
  const patients = listPatients();
  const patientExamsMap = getPatientExamsByPatient();
  const today = todayIso();
  const filterOptions = {
    clinicUnits: [...new Set(patients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(patients.map((patient) => patient.physicianName).filter(Boolean))].sort(),
    exams: [...new Set(
      patients
        .map((patient) => patient.nextExam)
        .filter((exam) => exam.code)
        .map((exam) => ({ code: exam.code, name: exam.name }))
        .map((exam) => JSON.stringify(exam))
    )].map((item) => JSON.parse(item)).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
  };

  const reminderCandidates = sortPatientsByPriority(
    patients.filter((patient) => {
      const nextExamRow = (patientExamsMap.get(patient.id) ?? []).find((exam) => exam.status === "pendente");
      return shouldPatientEnterReminderQueue(patient, nextExamRow, today, filters);
    })
  );

  const detectionResults = await Promise.all(reminderCandidates.map(async (patient) => {
    const nextExamRow = (patientExamsMap.get(patient.id) ?? []).find((exam) => exam.code === patient.nextExam.code);
    const shospSchedule = await lookupFutureScheduledExamInShosp({
      externalPatientId: patient.shospPatientId || null,
      examCode: patient.nextExam.code || null
    });

    if (nextExamRow && shospSchedule?.scheduledDate) {
      registerAutomaticShospScheduleDetection({
        patient,
        examPatientId: nextExamRow.id,
        shospSchedule
      });
    }

    return {
      patient,
      nextExamRow,
      shospSchedule
    };
  }));

  const items = detectionResults.filter((result) => !result.shospSchedule?.scheduledDate).map(({ patient, nextExamRow }) => {
    const messagePriority = getOperationalMessagePriority(patient.nextExam.deadlineStatus);
    const messageType = getOperationalMessageType(patient.nextExam.deadlineStatus);
    const suggestedMessage = buildOperationalSuggestedMessage(
      nextExamRow?.defaultMessage,
      patient,
      nextExamRow,
      `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`,
      patient.nextExam.deadlineStatus
    );
    const gestationalMessagingAlert = buildGestationalMessagingAlert(patient);

    return {
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      gestationalAgeLabel: patient.gestationalAgeLabel,
      physicianName: patient.physicianName || null,
      clinicUnit: patient.clinicUnit || null,
      examPatientId: nextExamRow?.id ?? null,
      examCode: patient.nextExam.code || null,
      examName: patient.nextExam.name,
      idealWindowStartDate: nextExamRow?.idealWindowStartDate || null,
      idealWindowStartDateLabel: nextExamRow?.idealWindowStartDate ? formatDatePtBr(nextExamRow.idealWindowStartDate) : null,
      urgencyStatus: patient.nextExam.deadlineStatus || "dentro_do_prazo",
      urgencyLabel: patient.nextExam.deadlineStatusLabel || patient.nextExam.alertLabel,
      priorityScore: messagePriority.score,
      priorityLevel: messagePriority.level,
      priorityLabel: messagePriority.label,
      messageType: messageType.type,
      messageTypeLabel: messageType.label,
      messageOrigin: messageType.origin,
      messageOriginLabel: messageType.originLabel,
      suggestedMessage,
      gestationalBaseSourceLabel: patient.gestationalBaseSourceLabel || "Base nao definida",
      gestationalBaseConfidenceLabel: patient.gestationalBaseConfidenceLabel || "Nao avaliada",
      gestationalBaseIsEstimated: Boolean(patient.gestationalBaseIsEstimated),
      gestationalReviewRequired: Boolean(patient.gestationalReviewRequired),
      gestationalBaseExplanation: patient.gestationalBaseExplanation || null,
      gestationalMessagingAlertLevel: gestationalMessagingAlert.level,
      gestationalMessagingAlertMessage: gestationalMessagingAlert.message,
      whatsappUrl: `https://wa.me/${toWhatsAppPhone(patient.phone)}?text=${encodeURIComponent(suggestedMessage)}`
    };
  });

  const autoScheduledItems = detectionResults
    .filter((result) => Boolean(result.shospSchedule?.scheduledDate))
    .map(({ patient, shospSchedule }) => ({
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      examName: patient.nextExam.name,
      scheduledDate: shospSchedule?.scheduledDate || null,
      scheduledDateLabel: shospSchedule?.scheduledDate ? formatDatePtBr(shospSchedule.scheduledDate) : "Nao informado",
      scheduledTime: shospSchedule?.scheduledTime || null,
      sourceLabel: "Agendamento detectado automaticamente no Shosp"
    }));

  return {
    filters,
    filterOptions,
    items,
    autoScheduledItems
  };
}

export function updateReminderStatus(patientId, examPatientId, action) {
  const exam = db.prepare(`
    SELECT
      ep.id,
      ep.patient_id AS patientId,
      ep.exam_model_id AS examModelId,
      ep.status,
      ep.scheduled_date AS scheduledDate
    FROM exames_paciente ep
    WHERE ep.id = ? AND ep.patient_id = ?
  `).get(examPatientId, patientId);

  if (!exam) {
    throw new Error("Lembrete da paciente nao encontrado.");
  }

  const now = todayIso();
  const normalizedAction = String(action || "");
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }
  if (isMessagingBlockedByGestationalBase(patient)) {
    throw new Error("A paciente precisa passar pela revisao manual da base gestacional antes de qualquer acao na central de lembretes.");
  }

  db.exec("BEGIN");
  try {
    if (normalizedAction === "contacted") {
      db.prepare(`
        UPDATE exames_paciente
        SET last_contacted_at = ?, updated_at = ?
        WHERE id = ? AND patient_id = ?
      `).run(now, now, examPatientId, patientId);
    } else if (normalizedAction === "snooze") {
      db.prepare(`
        UPDATE exames_paciente
        SET reminder_snoozed_until = ?, updated_at = ?
        WHERE id = ? AND patient_id = ?
      `).run(addDays(now, 1), now, examPatientId, patientId);
    } else if (normalizedAction === "scheduled") {
      db.prepare(`
        UPDATE exames_paciente
        SET
          status = 'agendado',
          scheduled_date = COALESCE(scheduled_date, ?),
          scheduled_by_user_id = COALESCE(scheduled_by_user_id, 1),
          updated_at = ?
        WHERE id = ? AND patient_id = ?
      `).run(now, now, examPatientId, patientId);

      db.prepare(`
        UPDATE patients
        SET stage = 'agendada', updated_at = ?
        WHERE id = ?
      `).run(now, patientId);
    } else {
      throw new Error("Acao de lembrete invalida.");
    }

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      patientId,
      patient.stage,
      normalizedAction === "scheduled" ? "agendada" : patient.stage,
      normalizedAction === "contacted" ? "contato_realizado" : normalizedAction === "snooze" ? "lembrete_adiado" : "exame_agendado",
      normalizedAction === "contacted"
        ? "Paciente marcada como contatada na central de lembretes."
        : normalizedAction === "snooze"
          ? "Lembrete adiado para o proximo dia."
          : "Paciente marcada como agendada na central de lembretes.",
      JSON.stringify({ examPatientId, action: normalizedAction }),
      now
    );

    db.exec("COMMIT");
    return getRemindersCenterData();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function getRemindersCount() {
  return {
    count: (await getRemindersCenterData()).items.length
  };
}

function createExamScheduleForPatient(patientId, dum, createdAt) {
  const examModels = db.prepare(`
    SELECT
      id,
      code,
      target_week AS targetWeek,
      reminder_days_before_1 AS reminderDaysBefore1,
      reminder_days_before_2 AS reminderDaysBefore2
    FROM exames_modelo
    WHERE active = 1 AND flow_type = 'automatico'
    ORDER BY sort_order
  `).all();

  const insertPatientExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      scheduled_date,
      scheduled_time,
      scheduling_notes,
      scheduled_by_user_id,
      last_contacted_at,
      reminder_snoozed_until,
      completed_date,
      completed_by_user_id,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  examModels.forEach((examModel) => {
    const { predictedDate, reminderDate1, reminderDate2 } = calculateExamScheduleDates({
      dum,
      targetWeek: examModel.targetWeek,
      reminderDaysBefore1: examModel.reminderDaysBefore1,
      reminderDaysBefore2: examModel.reminderDaysBefore2
    });
    insertPatientExam.run(
      patientId,
      examModel.id,
      predictedDate,
      reminderDate1,
      reminderDate2,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "pendente",
      createdAt,
      createdAt
    );
  });
}

function markHistoricalCompletedExamsUntil(patientId, lastCompletedExamCode, updatedAt) {
  const normalizedExamCode = String(lastCompletedExamCode || "").trim();
  if (!normalizedExamCode) {
    return [];
  }

  const automaticExamModels = db.prepare(`
    SELECT
      id,
      code,
      name,
      sort_order AS sortOrder
    FROM exames_modelo
    WHERE active = 1 AND flow_type = 'automatico'
    ORDER BY sort_order
  `).all();

  const selectedExamIndex = automaticExamModels.findIndex((exam) => exam.code === normalizedExamCode);
  if (selectedExamIndex === -1) {
    throw new Error("Selecione um ultimo exame realizado valido da esteira automatica.");
  }

  const examIdsToMark = automaticExamModels.slice(0, selectedExamIndex + 1).map((exam) => exam.id);
  const updatePatientExam = db.prepare(`
    UPDATE exames_paciente
    SET
      status = 'realizado',
      scheduled_date = NULL,
      scheduled_time = NULL,
      scheduling_notes = NULL,
      scheduled_by_user_id = NULL,
      last_contacted_at = NULL,
      reminder_snoozed_until = NULL,
      completed_date = NULL,
      completed_by_user_id = NULL,
      completed_outside_clinic = 1,
      updated_at = ?
    WHERE patient_id = ? AND exam_model_id = ?
  `);

  examIdsToMark.forEach((examModelId) => {
    updatePatientExam.run(updatedAt, patientId, examModelId);
  });

  return automaticExamModels.slice(0, selectedExamIndex + 1);
}

function recreateExamScheduleForPatient(patientId, dum, updatedAt) {
  const existingExamStatuses = db.prepare(`
    SELECT
      exam_model_id AS examModelId,
      scheduled_date AS scheduledDate,
      scheduled_time AS scheduledTime,
      scheduling_notes AS schedulingNotes,
      scheduled_by_user_id AS scheduledByUserId,
      last_contacted_at AS lastContactedAt,
      reminder_snoozed_until AS reminderSnoozedUntil,
      completed_date AS completedDate,
      completed_by_user_id AS completedByUserId,
      status
    FROM exames_paciente
    WHERE patient_id = ?
  `).all(patientId);

  const examStateByModelId = new Map(
    existingExamStatuses.map((exam) => [exam.examModelId, exam])
  );

  db.prepare("DELETE FROM exames_paciente WHERE patient_id = ?").run(patientId);

  const examModels = db.prepare(`
    SELECT
      id,
      target_week AS targetWeek,
      reminder_days_before_1 AS reminderDaysBefore1,
      reminder_days_before_2 AS reminderDaysBefore2
    FROM exames_modelo
    WHERE active = 1 AND flow_type = 'automatico'
    ORDER BY sort_order
  `).all();

  const insertPatientExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      scheduled_date,
      scheduled_time,
      scheduling_notes,
      scheduled_by_user_id,
      last_contacted_at,
      reminder_snoozed_until,
      completed_date,
      completed_by_user_id,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  examModels.forEach((examModel) => {
    const { predictedDate, reminderDate1, reminderDate2 } = calculateExamScheduleDates({
      dum,
      targetWeek: examModel.targetWeek,
      reminderDaysBefore1: examModel.reminderDaysBefore1,
      reminderDaysBefore2: examModel.reminderDaysBefore2
    });
    const savedExamState = examStateByModelId.get(examModel.id);

    insertPatientExam.run(
      patientId,
      examModel.id,
      predictedDate,
      reminderDate1,
      reminderDate2,
      savedExamState?.scheduledDate ?? null,
      savedExamState?.scheduledTime ?? null,
      savedExamState?.schedulingNotes ?? null,
      savedExamState?.scheduledByUserId ?? null,
      savedExamState?.lastContactedAt ?? null,
      savedExamState?.reminderSnoozedUntil ?? null,
      savedExamState?.completedDate ?? null,
      savedExamState?.completedByUserId ?? null,
      savedExamState?.status ?? "pendente",
      updatedAt,
      updatedAt
    );
  });
}

export function createPatient(input) {
  validatePatientInput(input);

  const now = todayIso();
  const actorUserId = Number(input.actorUserId || 1);
  const snapshot = resolvePregnancySnapshot({
    dum: null,
    gestationalWeeks: Number(input.gestationalWeeks),
    gestationalDays: Number(input.gestationalDays),
    gestationalBaseDate: now,
    gestationalBaseSource: "idade_gestacional_informada"
  });
  const gestationalPayload = getGestationalStoragePayload(snapshot, now);

  db.exec("BEGIN");
  try {
    const result = db.prepare(`
      INSERT INTO patients (
        name,
        phone,
        birth_date,
        dum,
        dpp,
        current_gestational_weeks,
        current_gestational_days,
        gestational_base_date,
        gestational_base_source,
        gestational_base_confidence,
        gestational_base_is_estimated,
        gestational_review_required,
        gestational_base_conflict,
        gestational_base_conflict_note,
        physician_name,
        clinic_unit,
        pregnancy_type,
        high_risk,
        notes,
        status,
        stage,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        @name,
        @phone,
        @birthDate,
        @dum,
        @dpp,
        @currentGestationalWeeks,
        @currentGestationalDays,
        @gestationalBaseDate,
        @gestationalBaseSource,
        @gestationalBaseConfidence,
        @gestationalBaseIsEstimated,
        @gestationalReviewRequired,
        @gestationalBaseConflict,
        @gestationalBaseConflictNote,
        @physicianName,
        @clinicUnit,
        @pregnancyType,
        @highRisk,
        @notes,
        @status,
        @stage,
        @createdByUserId,
        @createdAt,
        @updatedAt
      )
      `).run({
      name: input.name,
      phone: sanitizePhone(input.phone),
      birthDate: input.birthDate,
      dum: gestationalPayload.dum,
      dpp: gestationalPayload.dpp,
      currentGestationalWeeks: gestationalPayload.currentGestationalWeeks,
      currentGestationalDays: gestationalPayload.currentGestationalDays,
      gestationalBaseDate: gestationalPayload.gestationalBaseDate,
      gestationalBaseSource: gestationalPayload.gestationalBaseSource,
      gestationalBaseConfidence: gestationalPayload.gestationalBaseConfidence,
      gestationalBaseIsEstimated: gestationalPayload.gestationalBaseIsEstimated,
      gestationalReviewRequired: gestationalPayload.gestationalReviewRequired,
      gestationalBaseConflict: gestationalPayload.gestationalBaseConflict,
      gestationalBaseConflictNote: gestationalPayload.gestationalBaseConflictNote,
      physicianName: input.physicianName,
      clinicUnit: input.clinicUnit,
      pregnancyType: input.pregnancyType,
      highRisk: input.highRisk ? 1 : 0,
      notes: input.notes,
      status: input.status || "ativa",
      stage: normalizePipelineStage(input.stage || "contato_pendente"),
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now
    });

    const patientId = Number(result.lastInsertRowid);
    createExamScheduleForPatient(patientId, snapshot.dum, now);
    const historicalCompletedExams = markHistoricalCompletedExamsUntil(patientId, input.lastCompletedExamCode, now);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, NULL, ?, 'cadastro', ?, ?, ?, ?)
    `).run(
      patientId,
      normalizePipelineStage(input.stage || "contato_pendente"),
      "Paciente cadastrada no CRM.",
      JSON.stringify({
        origem: "cadastro_manual",
        lastCompletedExamCode: input.lastCompletedExamCode || null,
        historicalCompletedExamCodes: historicalCompletedExams.map((exam) => exam.code)
      }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updatePatient(patientId, input) {
  validatePatientInput(input);

  const currentPatient = getPatientsBase().find((patient) => patient.id === patientId);
  if (!currentPatient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  const actorUserId = Number(input.actorUserId || 1);
  const snapshot = resolvePregnancySnapshot({
    dum: null,
    gestationalWeeks: Number(input.gestationalWeeks),
    gestationalDays: Number(input.gestationalDays),
    gestationalBaseDate: now,
    gestationalBaseSource: "idade_gestacional_informada"
  });
  const gestationalPayload = getGestationalStoragePayload(snapshot, now);

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET
        name = @name,
        phone = @phone,
        birth_date = @birthDate,
        dum = @dum,
        dpp = @dpp,
        current_gestational_weeks = @currentGestationalWeeks,
        current_gestational_days = @currentGestationalDays,
        gestational_base_date = @gestationalBaseDate,
        gestational_base_source = @gestationalBaseSource,
        gestational_base_confidence = @gestationalBaseConfidence,
        gestational_base_is_estimated = @gestationalBaseIsEstimated,
        gestational_review_required = @gestationalReviewRequired,
        gestational_base_conflict = @gestationalBaseConflict,
        gestational_base_conflict_note = @gestationalBaseConflictNote,
        physician_name = @physicianName,
        clinic_unit = @clinicUnit,
        pregnancy_type = @pregnancyType,
        high_risk = @highRisk,
        notes = @notes,
        status = @status,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: patientId,
      name: input.name,
      phone: sanitizePhone(input.phone),
      birthDate: input.birthDate,
      dum: gestationalPayload.dum,
      dpp: gestationalPayload.dpp,
      currentGestationalWeeks: gestationalPayload.currentGestationalWeeks,
      currentGestationalDays: gestationalPayload.currentGestationalDays,
      gestationalBaseDate: gestationalPayload.gestationalBaseDate,
      gestationalBaseSource: gestationalPayload.gestationalBaseSource,
      gestationalBaseConfidence: gestationalPayload.gestationalBaseConfidence,
      gestationalBaseIsEstimated: gestationalPayload.gestationalBaseIsEstimated,
      gestationalReviewRequired: gestationalPayload.gestationalReviewRequired,
      gestationalBaseConflict: gestationalPayload.gestationalBaseConflict,
      gestationalBaseConflictNote: gestationalPayload.gestationalBaseConflictNote,
      physicianName: input.physicianName,
      clinicUnit: input.clinicUnit,
      pregnancyType: input.pregnancyType,
      highRisk: input.highRisk ? 1 : 0,
      notes: input.notes,
      status: input.status || currentPatient.status || "ativa",
      updatedAt: now
    });

    recreateExamScheduleForPatient(patientId, snapshot.dum, now);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'edicao_paciente', ?, ?, ?, ?)
    `).run(
      patientId,
      currentPatient.stage,
      currentPatient.stage,
      "Cadastro da paciente atualizado com recalculo automatico da gestacao e dos exames.",
      JSON.stringify({ origem: "edicao_manual" }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deletePatient(patientId) {
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM patients WHERE id = ?").run(patientId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    success: true,
    deletedPatient: {
      id: patient.id,
      name: patient.name,
      phone: patient.phone
    }
  };
}

function resolvePatientCleanupRange(input = {}) {
  const preset = String(input.preset || "today").trim().toLowerCase();
  const today = todayIso();

  if (preset === "all") {
    return {
      preset,
      dateFrom: null,
      dateTo: null,
      label: "Todos os pacientes"
    };
  }

  if (preset === "today") {
    return {
      preset,
      dateFrom: today,
      dateTo: today,
      label: "Pacientes criados hoje"
    };
  }

  if (preset === "last_7_days") {
    return {
      preset,
      dateFrom: addDays(today, -6),
      dateTo: today,
      label: "Pacientes criados nos ultimos 7 dias"
    };
  }

  if (preset === "last_30_days") {
    return {
      preset,
      dateFrom: addDays(today, -29),
      dateTo: today,
      label: "Pacientes criados nos ultimos 30 dias"
    };
  }

  if (preset === "custom") {
    const dateFrom = String(input.dateFrom || "").trim();
    const dateTo = String(input.dateTo || "").trim();

    if (!dateFrom || !dateTo) {
      throw new Error("Informe a data inicial e a data final para a faixa personalizada.");
    }

    if (dateFrom > dateTo) {
      throw new Error("A data inicial nao pode ser maior que a data final.");
    }

    return {
      preset,
      dateFrom,
      dateTo,
      label: `Pacientes criados de ${formatDatePtBr(dateFrom)} ate ${formatDatePtBr(dateTo)}`
    };
  }

  throw new Error("Faixa de exclusao invalida.");
}

export function deletePatientsByCreatedRange(input = {}) {
  const range = resolvePatientCleanupRange(input);
  const actorUserId = input.actorUserId ? Number(input.actorUserId) : null;
  const patientRows = range.dateFrom && range.dateTo
    ? db.prepare(`
        SELECT id, name
        FROM patients
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY created_at, id
      `).all(range.dateFrom, range.dateTo)
    : db.prepare(`
        SELECT id, name
        FROM patients
        ORDER BY created_at, id
      `).all();

  if (!patientRows.length) {
    return {
      success: true,
      range,
      deleted: {
        patients: 0,
        exams: 0,
        messages: 0,
        movements: 0,
        messageLogs: 0
      }
    };
  }

  const patientIds = patientRows.map((patient) => patient.id);
  const placeholders = patientIds.map(() => "?").join(", ");
  const countForIds = (table) =>
    Number(
      db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE patient_id IN (${placeholders})`).get(...patientIds).count
    );

  const deleted = {
    patients: patientRows.length,
    exams: countForIds("exames_paciente"),
    messages: countForIds("mensagens"),
    movements: countForIds("historico_de_movimentacoes"),
    messageLogs: countForIds("message_delivery_logs")
  };

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM patients WHERE id IN (${placeholders})`).run(...patientIds);

    if (actorUserId) {
      recordAuditEvent({
        actorUserId,
        actionType: "bulk_delete_patients",
        entityType: "patient",
        entityId: null,
        patientId: null,
        description: `Limpeza administrativa de pacientes executada: ${range.label}.`,
        details: {
          preset: range.preset,
          dateFrom: range.dateFrom,
          dateTo: range.dateTo,
          deleted,
          samplePatients: patientRows.slice(0, 10).map((patient) => ({ id: patient.id, name: patient.name }))
        }
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    success: true,
    range,
    deleted
  };
}

export function updatePatientExamStatus(patientId, examId, input) {
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const exam = db.prepare(`
    SELECT
      exames_paciente.id,
      exames_paciente.patient_id AS patientId,
      exames_paciente.exam_model_id AS examModelId,
      em.name AS examName,
      em.code AS examCode,
      em.flow_type AS flowType,
      em.sort_order AS sortOrder,
      exames_paciente.status,
      exames_paciente.scheduled_date AS scheduledDate,
      exames_paciente.scheduled_time AS scheduledTime,
      exames_paciente.scheduling_notes AS schedulingNotes,
      exames_paciente.scheduled_by_user_id AS scheduledByUserId,
      exames_paciente.completed_date AS completedDate,
      exames_paciente.completed_by_user_id AS completedByUserId
      ,
      exames_paciente.completed_outside_clinic AS completedOutsideClinic
    FROM exames_paciente
    INNER JOIN exames_modelo em ON em.id = exames_paciente.exam_model_id
    WHERE exames_paciente.id = ? AND exames_paciente.patient_id = ?
  `).get(examId, patientId);

  if (!exam) {
    throw new Error("Exame da paciente nao encontrado.");
  }

  const nextStatus = String(input.status || "").trim();
  if (!["agendado", "realizado", "pendente"].includes(nextStatus)) {
    throw new Error("Status do exame invalido.");
  }

  const now = todayIso();
  const actorUserId = Number(input.actorUserId || 1);
  const completedOutsideClinic = nextStatus === "realizado" && Boolean(input.completedOutsideClinic);
  const scheduledDate =
    nextStatus === "agendado"
      ? String(input.scheduledDate || exam.scheduledDate || now)
      : nextStatus === "realizado"
        ? String(input.scheduledDate || exam.scheduledDate || "")
        : "";
  const scheduledTime =
    nextStatus === "agendado"
      ? String(input.scheduledTime || exam.scheduledTime || "")
      : nextStatus === "realizado"
        ? String(input.scheduledTime || exam.scheduledTime || "")
        : "";
  const schedulingNotes =
    nextStatus === "agendado"
      ? String(input.schedulingNotes || exam.schedulingNotes || "").trim()
      : nextStatus === "realizado"
        ? String(input.schedulingNotes || exam.schedulingNotes || "").trim()
        : "";
  const completedDate = nextStatus === "realizado"
    ? completedOutsideClinic
      ? null
      : String(input.completedDate || exam.completedDate || now)
    : null;

  if (nextStatus === "agendado" && !scheduledDate) {
    throw new Error("Informe a data do agendamento.");
  }

  if (nextStatus === "agendado" && !scheduledTime) {
    throw new Error("Informe o horario do agendamento.");
  }

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE exames_paciente
      SET
        status = @status,
        scheduled_date = @scheduledDate,
        scheduled_time = @scheduledTime,
        scheduling_notes = @schedulingNotes,
        scheduled_by_user_id = @scheduledByUserId,
        completed_date = @completedDate,
        completed_by_user_id = @completedByUserId,
        completed_outside_clinic = @completedOutsideClinic,
        updated_at = @updatedAt
      WHERE id = @id AND patient_id = @patientId
    `).run({
      id: examId,
      patientId,
      status: nextStatus,
      scheduledDate: scheduledDate || null,
      scheduledTime: scheduledTime || null,
      schedulingNotes: schedulingNotes || null,
      scheduledByUserId: nextStatus === "agendado" ? actorUserId : nextStatus === "realizado" ? exam.scheduledByUserId : null,
      completedDate,
      completedByUserId: nextStatus === "realizado" && !completedOutsideClinic ? actorUserId : null,
      completedOutsideClinic: nextStatus === "realizado" && completedOutsideClinic ? 1 : 0,
      updatedAt: now
    });

    const refreshedExamsForBase = getPatientExamsByPatient().get(patientId) ?? [];
    const refreshedSnapshot = resolvePregnancySnapshot(patient, now, { patientExams: refreshedExamsForBase });
    const refreshedGestationalPayload = getGestationalStoragePayload(refreshedSnapshot, now);

    db.prepare(`
      UPDATE patients
      SET
        dum = @dum,
        dpp = @dpp,
        current_gestational_weeks = @currentGestationalWeeks,
        current_gestational_days = @currentGestationalDays,
        gestational_base_date = @gestationalBaseDate,
        gestational_base_source = @gestationalBaseSource,
        gestational_base_confidence = @gestationalBaseConfidence,
        gestational_base_is_estimated = @gestationalBaseIsEstimated,
        gestational_review_required = @gestationalReviewRequired,
        gestational_base_conflict = @gestationalBaseConflict,
        gestational_base_conflict_note = @gestationalBaseConflictNote,
        updated_at = @updatedAt
      WHERE id = @patientId
    `).run({
      patientId,
      dum: refreshedGestationalPayload.dum,
      dpp: refreshedGestationalPayload.dpp,
      currentGestationalWeeks: refreshedGestationalPayload.currentGestationalWeeks,
      currentGestationalDays: refreshedGestationalPayload.currentGestationalDays,
      gestationalBaseDate: refreshedGestationalPayload.gestationalBaseDate,
      gestationalBaseSource: refreshedGestationalPayload.gestationalBaseSource,
      gestationalBaseConfidence: refreshedGestationalPayload.gestationalBaseConfidence,
      gestationalBaseIsEstimated: refreshedGestationalPayload.gestationalBaseIsEstimated,
      gestationalReviewRequired: refreshedGestationalPayload.gestationalReviewRequired,
      gestationalBaseConflict: refreshedGestationalPayload.gestationalBaseConflict,
      gestationalBaseConflictNote: refreshedGestationalPayload.gestationalBaseConflictNote,
      updatedAt: now
    });

    const refreshedPatient = getPatientsBase().find((item) => item.id === patientId);
    const refreshedPatientExams = getPatientExamsByPatient().get(patientId) ?? [];
    const latestMessage = getLatestMessagesByPatient().get(patientId) ?? null;
    const nextStage =
      patient.status === "encerrada"
        ? normalizePipelineStage(patient.stage)
        : nextStatus === "agendado"
          ? "agendada"
          : refreshedPatient
            ? resolvePatientStage(refreshedPatient, refreshedPatientExams, latestMessage)
            : "contato_pendente";

    db.prepare(`
      UPDATE patients
      SET stage = @stage, updated_at = @updatedAt
      WHERE id = @patientId
    `).run({
      patientId,
      stage: nextStage,
      updatedAt: now
    });

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      patientId,
      patient.stage,
      nextStage,
      nextStatus === "realizado"
        ? (completedOutsideClinic ? "exame_realizado_externo" : "exame_realizado")
        : nextStatus === "agendado"
          ? "exame_agendado"
          : "exame_reaberto",
      nextStatus === "realizado"
        ? completedOutsideClinic
          ? `Exame ${exam.examName} marcado como ja realizado.`
          : `Exame ${exam.examName} marcado como realizado.`
        : nextStatus === "agendado"
          ? `Exame ${exam.examName} agendado para ${scheduledDate}${scheduledTime ? ` as ${scheduledTime}` : ""}.`
          : "Exame retornou para acompanhamento pendente.",
      JSON.stringify({
        examId,
        examModelId: exam.examModelId,
        examName: exam.examName,
        previousStatus: exam.status,
        newStatus: nextStatus,
        scheduledDate: scheduledDate || null,
        scheduledTime: scheduledTime || null,
        schedulingNotes: schedulingNotes || null,
        completedOutsideClinic,
        actorUserId
      }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function movePatientStage(patientId, nextStage) {
  if (!getKanbanStageIds().has(nextStage)) {
    throw new Error("Coluna de kanban invalida.");
  }

  const currentPatient = listPatients().find((patient) => patient.id === patientId);
  if (!currentPatient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET stage = ?, updated_at = ?
      WHERE id = ?
    `).run(nextStage, now, patientId);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'movimentacao_kanban', ?, ?, 1, ?)
    `).run(
      patientId,
      currentPatient.stage,
      nextStage,
      "Paciente movida manualmente no kanban.",
      JSON.stringify({ origem: "drag_and_drop" }),
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createKanbanColumn(input) {
  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("Informe o nome da coluna.");
  }

  const baseId = slugifyKanbanTitle(title);
  if (!baseId) {
    throw new Error("Nao foi possivel gerar o identificador da coluna.");
  }

  let id = baseId;
  let suffix = 2;
  while (db.prepare("SELECT id FROM kanban_columns WHERE id = ?").get(id)) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  const now = todayIso();
  const lastSortOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS value FROM kanban_columns").get().value;

  db.prepare(`
    INSERT INTO kanban_columns (id, title, description, sort_order, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(id, title, "Coluna personalizada", Number(lastSortOrder) + 1, now, now);

  return getKanbanData();
}

export function updateKanbanColumn(columnId, input) {
  const currentColumn = db.prepare("SELECT id, title, is_system AS isSystem FROM kanban_columns WHERE id = ?").get(columnId);
  if (!currentColumn) {
    throw new Error("Coluna nao encontrada.");
  }

  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("Informe o nome da coluna.");
  }

  db.prepare(`
    UPDATE kanban_columns
    SET title = ?, updated_at = ?
    WHERE id = ?
  `).run(title, todayIso(), columnId);

  return getKanbanData();
}

export function deleteKanbanColumn(columnId) {
  const currentColumn = db.prepare(`
    SELECT id, title, is_system AS isSystem
    FROM kanban_columns
    WHERE id = ?
  `).get(columnId);

  if (!currentColumn) {
    throw new Error("Coluna nao encontrada.");
  }

  if (currentColumn.isSystem) {
    throw new Error("As colunas padrao do pipeline nao podem ser excluidas.");
  }

  const patientCount = db.prepare("SELECT COUNT(*) AS count FROM patients WHERE stage = ?").get(columnId).count;
  if (patientCount > 0) {
    throw new Error("Esvazie a coluna antes de exclui-la.");
  }

  db.prepare("DELETE FROM kanban_columns WHERE id = ?").run(columnId);
  return getKanbanData();
}

export function getPatientDetails(patientId) {
  const patient = listPatients().find((item) => item.id === patientId);
  if (!patient) {
    return null;
  }

  const exams = (getPatientExamsByPatient().get(patientId) ?? []).map((exam) => ({
    id: exam.id,
    examModelId: exam.examModelId,
    code: exam.code,
    name: exam.name,
    sortOrder: exam.sortOrder,
    startWeek: exam.startWeek,
    endWeek: exam.endWeek,
    targetWeek: exam.targetWeek,
    suggestedMessage: renderExamReminderMessage(
      exam.defaultMessage,
      patient,
      exam,
      `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`
    ),
    required: Boolean(exam.required),
    flowType: exam.flowType,
    importedFromShosp: Boolean(exam.importedFromShosp),
    shospExamId: exam.shospExamId || null,
    predictedDate: exam.predictedDate,
    predictedDateLabel: formatDatePtBr(exam.predictedDate),
    reminderDate1: exam.reminderDate1,
    reminderDate2: exam.reminderDate2,
    scheduledDate: exam.scheduledDate,
    scheduledTime: exam.scheduledTime || null,
    scheduledDateLabel: exam.scheduledDate ? formatDatePtBr(exam.scheduledDate) : null,
    schedulingNotes: exam.schedulingNotes || null,
    scheduledByName: exam.scheduledByName || null,
    completedDate: exam.completedDate,
    completedDateLabel: buildCompletedDateLabel(exam),
    completedByName: exam.completedByName || null,
    completedOutsideClinic: Boolean(exam.completedOutsideClinic),
    status: exam.status
  }));
  const assessedExams = analyzePatientExamTimeline(exams).assessedExams;

  const messages = getMessageHistoryByPatient().get(patientId) ?? [];
  const movements = getMovementHistoryByPatient().get(patientId) ?? [];

  return {
    patient,
    exams: assessedExams,
    messages,
    movements
  };
}

function getLastCompletedClinicExamForReview(patientExams) {
  return [...patientExams]
    .filter((exam) => exam.completedDate && exam.status === "realizado" && !exam.completedOutsideClinic)
    .sort((left, right) => right.completedDate.localeCompare(left.completedDate))[0] ?? null;
}

export function listGestationalBaseReviews() {
  const patientExamsMap = getPatientExamsByPatient();
  const latestMessagesMap = getLatestMessagesByPatient();

  return getPatientsBase()
    .map((patient) => enrichPatient(patient, patientExamsMap, latestMessagesMap))
    .filter((patient) => patient.gestationalReviewRequired || patient.stage === "revisao_base_gestacional")
    .map((patient) => {
      const patientExams = patientExamsMap.get(patient.id) ?? [];
      const lastExam = getLastCompletedClinicExamForReview(patientExams);

      return {
        patientId: patient.id,
        patientName: patient.name,
        phone: patient.phone,
        lastExamName: lastExam?.name || "Nenhum exame encontrado",
        lastExamDate: lastExam?.completedDate || null,
        lastExamDateLabel: lastExam?.completedDate ? formatDatePtBr(lastExam.completedDate) : "Nao informado",
        suggestedEstimate: patient.dpp
          ? `Idade gestacional sugerida: ${patient.gestationalAgeLabel} • DPP estimada: ${formatDatePtBr(patient.dpp)}`
          : "Sem estimativa sugerida segura",
        confidence: patient.gestationalBaseConfidence || "insuficiente",
        confidenceLabel: patient.gestationalBaseConfidenceLabel || "Sem confianca suficiente",
        sourceLabel: patient.gestationalBaseSourceLabel || "Nao definida",
        explanation: patient.gestationalBaseConflictNote || patient.gestationalBaseExplanation || "",
        hasConflict: Boolean(patient.gestationalBaseHasConflict),
        canConfirm: Boolean(patient.dpp && patient.gestationalBaseSource !== "revisao_manual")
      };
    });
}

export function confirmGestationalBaseEstimate(patientId, actorUserId = 1) {
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const patientExams = getPatientExamsByPatient().get(patientId) ?? [];
  const snapshot = resolvePregnancySnapshot(patient, todayIso(), { patientExams });
  if (!snapshot.dpp || snapshot.gestationalBaseSource === "revisao_manual") {
    throw new Error("Nao existe estimativa segura para confirmar.");
  }

  const now = todayIso();
  const payload = getGestationalStoragePayload(
    {
      ...snapshot,
      gestationalBaseRequiresManualReview: false
    },
    now
  );

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET
        dum = @dum,
        dpp = @dpp,
        current_gestational_weeks = @currentGestationalWeeks,
        current_gestational_days = @currentGestationalDays,
        gestational_base_date = @gestationalBaseDate,
        gestational_base_source = @gestationalBaseSource,
        gestational_base_confidence = @gestationalBaseConfidence,
        gestational_base_is_estimated = @gestationalBaseIsEstimated,
        gestational_review_required = 0,
        gestational_base_conflict = @gestationalBaseConflict,
        gestational_base_conflict_note = @gestationalBaseConflictNote,
        stage = 'contato_pendente',
        updated_at = @updatedAt
      WHERE id = @patientId
    `).run({
      patientId,
      ...payload,
      updatedAt: now
    });

    if (snapshot.dum) {
      recreateExamScheduleForPatient(patientId, snapshot.dum, now);
    }

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'confirmacao_base_gestacional', ?, ?, ?, ?)
    `).run(
      patientId,
      patient.stage,
      "contato_pendente",
      "Estimativa da base gestacional confirmada manualmente pela equipe.",
      JSON.stringify({ source: snapshot.gestationalBaseSource, confidence: snapshot.gestationalBaseConfidence }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function editGestationalBaseManually(patientId, input) {
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const gestationalWeeks = Number(input.gestationalWeeks);
  const gestationalDays = Number(input.gestationalDays);
  if (!Number.isInteger(gestationalWeeks) || gestationalWeeks < 0) {
    throw new Error("Informe as semanas da idade gestacional.");
  }
  if (!Number.isInteger(gestationalDays) || gestationalDays < 0 || gestationalDays > 6) {
    throw new Error("Informe os dias da idade gestacional entre 0 e 6.");
  }

  const now = todayIso();
  const actorUserId = Number(input.actorUserId || 1);
  const snapshot = resolvePregnancySnapshot({
    dum: null,
    gestationalWeeks,
    gestationalDays,
    gestationalBaseDate: now,
    gestationalBaseSource: "idade_gestacional_informada"
  }, now);
  const payload = getGestationalStoragePayload(snapshot, now);

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET
        dum = @dum,
        dpp = @dpp,
        current_gestational_weeks = @currentGestationalWeeks,
        current_gestational_days = @currentGestationalDays,
        gestational_base_date = @gestationalBaseDate,
        gestational_base_source = @gestationalBaseSource,
        gestational_base_confidence = @gestationalBaseConfidence,
        gestational_base_is_estimated = @gestationalBaseIsEstimated,
        gestational_review_required = 0,
        gestational_base_conflict = 0,
        gestational_base_conflict_note = NULL,
        stage = 'contato_pendente',
        updated_at = @updatedAt
      WHERE id = @patientId
    `).run({
      patientId,
      ...payload,
      updatedAt: now
    });

    recreateExamScheduleForPatient(patientId, snapshot.dum, now);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'edicao_base_gestacional', ?, ?, ?, ?)
    `).run(
      patientId,
      patient.stage,
      "contato_pendente",
      "Base gestacional ajustada manualmente pela equipe.",
      JSON.stringify({ gestationalWeeks, gestationalDays }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function discardGestationalBaseEstimate(patientId, actorUserId = 1) {
  const patient = getPatientsBase().find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET
        dum = NULL,
        dpp = NULL,
        current_gestational_weeks = NULL,
        current_gestational_days = NULL,
        gestational_base_date = NULL,
        gestational_base_source = 'revisao_manual',
        gestational_base_confidence = 'insuficiente',
        gestational_base_is_estimated = 1,
        gestational_review_required = 1,
        stage = 'revisao_base_gestacional',
        updated_at = @updatedAt
      WHERE id = @patientId
    `).run({
      patientId,
      updatedAt: now
    });

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'descarte_estimativa_gestacional', ?, ?, ?, ?)
    `).run(
      patientId,
      patient.stage,
      "revisao_base_gestacional",
      "Estimativa da base gestacional descartada. Paciente mantida em revisao manual.",
      JSON.stringify({ previousSource: patient.gestationalBaseSource || null }),
      actorUserId,
      now
    );

    db.exec("COMMIT");
    return getPatientDetails(patientId);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createMessage(input) {
  const now = todayIso();
  const patient = getPatientsBase().find((item) => item.id === Number(input.patientId));
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }
  if (isMessagingBlockedByGestationalBase(patient)) {
    throw new Error("A base gestacional desta paciente esta com baixa confianca. Faça a revisao manual antes de registrar qualquer mensagem.");
  }

  db.exec("BEGIN");
  let info;
  try {
    info = db.prepare(`
      INSERT INTO mensagens (
        patient_id,
        exam_model_id,
        content,
        delivery_status,
        sent_at,
        response_status,
        response_text,
        response_at,
        channel,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'enviada', ?, 'sem_resposta', NULL, NULL, 'whatsapp', 1, ?, ?)
    `).run(input.patientId, input.examModelId ?? null, input.content, now, now, now);

    registerManualMessageDispatch({
      patientId: Number(input.patientId),
      messageId: Number(info.lastInsertRowid),
      templateCode: input.templateCode ?? null,
      content: input.content
    });

    db.prepare(`
      UPDATE patients
      SET stage = 'mensagem_enviada', updated_at = ?
      WHERE id = ?
    `).run(now, input.patientId);

    db.prepare(`
      INSERT INTO historico_de_movimentacoes (
        patient_id,
        from_stage,
        to_stage,
        action_type,
        description,
        metadata_json,
        created_by_user_id,
        created_at
      )
      VALUES (?, ?, ?, 'mensagem_enviada', ?, ?, 1, ?)
    `).run(
      input.patientId,
      patient.stage,
      "mensagem_enviada",
      "Mensagem registrada para acompanhamento da paciente.",
      JSON.stringify({ examModelId: input.examModelId ?? null }),
      now
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return db.prepare(`
    SELECT
      id,
      patient_id AS patientId,
      exam_model_id AS examModelId,
      content,
      delivery_status AS deliveryStatus,
      sent_at AS sentAt,
      response_status AS responseStatus,
      response_text AS responseText,
      response_at AS responseAt
    FROM mensagens
    WHERE id = ?
  `).get(Number(info.lastInsertRowid));
}

function isMessagingBlockedByGestationalBase(patient) {
  return Boolean(patient.gestationalReviewRequired) || (
    Boolean(patient.gestationalBaseIsEstimated) && patient.gestationalBaseConfidence === "baixa"
  );
}

function buildGestationalMessagingAlert(patient) {
  if (isMessagingBlockedByGestationalBase(patient)) {
    return {
      level: "blocked",
      message: "Base gestacional com baixa confianca. Encaminhe para revisao manual antes de qualquer contato."
    };
  }

  if (patient.gestationalBaseIsEstimated && patient.gestationalBaseConfidence === "media") {
    return {
      level: "warning",
      message: `Base estimada a partir de ${patient.gestationalBaseSourceLabel || "origem nao definida"}. Revise com atencao antes de seguir com a mensagem.`
    };
  }

  return {
    level: "ok",
    message: null
  };
}

export function updateMessageStatus(messageId, input) {
  const now = todayIso();
  const currentMessage = db.prepare(`
    SELECT id, patient_id AS patientId, delivery_status AS deliveryStatus
    FROM mensagens
    WHERE id = ?
  `).get(messageId);
  if (!currentMessage) {
    throw new Error("Mensagem nao encontrada.");
  }

  const nextDeliveryStatus =
    input.deliveryStatus ??
    (input.responseStatus === "respondida" ? "respondida" : currentMessage.deliveryStatus);

  db.prepare(`
    UPDATE mensagens
    SET
      delivery_status = @deliveryStatus,
      response_status = COALESCE(@responseStatus, response_status),
      response_text = @responseText,
      response_at = @responseAt,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: messageId,
    deliveryStatus: nextDeliveryStatus,
    responseStatus: input.responseStatus ?? null,
    responseText: input.responseText ?? null,
    responseAt: input.responseStatus ? now : null,
    updatedAt: now
  });

  registerMessageStatusChange({
    patientId: currentMessage.patientId,
    messageId,
    status: nextDeliveryStatus,
    responseText: input.responseText ?? null
  });

  return db.prepare(`
    SELECT
      id,
      patient_id AS patientId,
      exam_model_id AS examModelId,
      content,
      delivery_status AS deliveryStatus,
      sent_at AS sentAt,
      response_status AS responseStatus,
      response_text AS responseText,
      response_at AS responseAt
    FROM mensagens
    WHERE id = ?
  `).get(messageId);
}

export function authenticate(email, password) {
  const user = db.prepare(`
    SELECT id, name, email, role, password
    FROM users
    WHERE email = ? AND active = 1
    LIMIT 1
  `).get(String(email || "").trim().toLowerCase());

  if (!user || !verifyPassword(password, user.password)) {
    return null;
  }

  if (!isPasswordHashed(user.password)) {
    db.prepare("UPDATE users SET password = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), todayIso(), user.id);
  }

  const token = createSessionToken();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(user.id, hashSessionToken(token), buildSessionExpiry(), now, now);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: String(user.role || "").trim().toLowerCase() === "atendente" ? "recepcao" : user.role
    }
  };
}

export function getAuthenticatedUserByToken(token) {
  const session = db.prepare(`
    SELECT
      user_sessions.id,
      user_sessions.user_id AS userId,
      user_sessions.expires_at AS expiresAt,
      users.name,
      users.email,
      users.role
    FROM user_sessions
    INNER JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = ?
      AND user_sessions.revoked_at IS NULL
      AND user_sessions.expires_at >= ?
      AND users.active = 1
    LIMIT 1
  `).get(hashSessionToken(token), new Date().toISOString());

  if (!session) {
    return null;
  }

  db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);

  return {
    session: {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt
    },
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: String(session.role || "").trim().toLowerCase() === "atendente" ? "recepcao" : session.role
    }
  };
}

export function listAdminUsers() {
  return db.prepare(`
    SELECT
      id,
      name,
      email,
      role,
      active,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
    ORDER BY name COLLATE NOCASE
  `).all().map((user) => ({
    ...user,
    role: String(user.role || "").trim().toLowerCase() === "atendente" ? "recepcao" : user.role,
    active: Boolean(user.active)
  }));
}

export function listClinicUnits() {
  return db.prepare(`
    SELECT
      id,
      name,
      active,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM clinic_units
    ORDER BY name COLLATE NOCASE
  `).all().map((unit) => ({ ...unit, active: Boolean(unit.active) }));
}

export function listPhysicians() {
  return db.prepare(`
    SELECT
      physicians.id,
      physicians.name,
      physicians.clinic_unit_id AS clinicUnitId,
      clinic_units.name AS clinicUnitName,
      physicians.active,
      physicians.created_at AS createdAt,
      physicians.updated_at AS updatedAt
    FROM physicians
    LEFT JOIN clinic_units ON clinic_units.id = physicians.clinic_unit_id
    ORDER BY physicians.name COLLATE NOCASE
  `).all().map((physician) => ({ ...physician, active: Boolean(physician.active) }));
}

export function getPatientFormCatalogs() {
  return {
    units: listClinicUnits().filter((unit) => unit.active),
    physicians: listPhysicians().filter((physician) => physician.active)
  };
}

export function getAdminPanelData() {
  return {
    users: listAdminUsers(),
    units: listClinicUnits(),
    physicians: listPhysicians(),
    examConfigs: listExamConfigs(),
    examInferenceRules: listExamInferenceRules(),
    messageTemplates: listMessageTemplates(),
    messageDeliveryLogs: listMessageDeliveryLogs(),
    messagingConfig: getMessagingRuntimeConfig()
  };
}

export function listMessageDeliveryLogs() {
  return db.prepare(`
    SELECT
      logs.id,
      logs.message_id AS messageId,
      logs.patient_id AS patientId,
      patients.name AS patientName,
      logs.template_id AS templateId,
      templates.name AS templateName,
      logs.provider,
      logs.status,
      logs.external_message_id AS externalMessageId,
      logs.error_message AS errorMessage,
      logs.sent_at AS sentAt,
      logs.delivered_at AS deliveredAt,
      logs.responded_at AS respondedAt,
      logs.created_at AS createdAt
    FROM message_delivery_logs logs
    LEFT JOIN patients ON patients.id = logs.patient_id
    LEFT JOIN message_templates templates ON templates.id = logs.template_id
    ORDER BY logs.created_at DESC, logs.id DESC
    LIMIT 50
  `).all();
}

export function updateMessageTemplate(templateId, input) {
  const currentTemplate = db.prepare("SELECT id FROM message_templates WHERE id = ?").get(templateId);
  if (!currentTemplate) {
    throw new Error("Template nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const content = String(input.content || "").trim();
  const language = String(input.language || "pt_BR").trim();
  const active = input.active !== false;

  if (!name) {
    throw new Error("Informe o nome do template.");
  }

  if (!content) {
    throw new Error("Informe o conteudo do template.");
  }

  if (!language) {
    throw new Error("Informe o idioma do template.");
  }

  const now = todayIso();
  db.prepare(`
    UPDATE message_templates
    SET
      name = @name,
      language = @language,
      content = @content,
      active = @active,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: templateId,
    name,
    language,
    content,
    active: active ? 1 : 0,
    updatedAt: now
  });

  return listMessageTemplates().find((template) => template.id === templateId);
}

export function createAdminUser(input) {
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const role = String(input.role || "recepcao").trim().toLowerCase();
  const active = input.active !== false;

  if (!name) {
    throw new Error("Informe o nome do usuario.");
  }
  if (!email || !email.includes("@")) {
    throw new Error("Informe um e-mail valido.");
  }
  if (password.length < 4) {
    throw new Error("A senha precisa ter pelo menos 4 caracteres.");
  }
  if (!["admin", "recepcao", "atendimento"].includes(role)) {
    throw new Error("Perfil de usuario invalido.");
  }

  const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existingUser) {
    throw new Error("Ja existe um usuario com este e-mail.");
  }

  const now = todayIso();
  const info = db.prepare(`
    INSERT INTO users (name, email, password, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, email, hashPassword(password), role, active ? 1 : 0, now, now);

  return listAdminUsers().find((user) => user.id === Number(info.lastInsertRowid));
}

export function updateAdminUser(userId, input) {
  const currentUser = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId);
  if (!currentUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "recepcao").trim().toLowerCase();
  const active = Boolean(input.active);
  const password = String(input.password || "");

  if (!name) {
    throw new Error("Informe o nome do usuario.");
  }
  if (!email || !email.includes("@")) {
    throw new Error("Informe um e-mail valido.");
  }
  if (!["admin", "recepcao", "atendimento"].includes(role)) {
    throw new Error("Perfil de usuario invalido.");
  }

  const duplicateUser = db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(email, userId);
  if (duplicateUser) {
    throw new Error("Ja existe outro usuario com este e-mail.");
  }

  const now = todayIso();
  db.prepare(`
    UPDATE users
    SET
      name = @name,
      email = @email,
      password = COALESCE(@password, password),
      role = @role,
      active = @active,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: userId,
    name,
    email,
    password: password ? hashPassword(password) : null,
    role,
    active: active ? 1 : 0,
    updatedAt: now
  });

  return listAdminUsers().find((user) => user.id === userId);
}

export function deleteAdminUser(userId) {
  const currentUser = db.prepare(`
    SELECT id, role
    FROM users
    WHERE id = ?
  `).get(userId);

  if (!currentUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count;
  if (currentUser.role === "admin" && adminCount <= 1) {
    throw new Error("Nao e possivel excluir o ultimo administrador ativo.");
  }

  const usageCount = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM patients WHERE created_by_user_id = @userId) +
      (SELECT COUNT(*) FROM mensagens WHERE created_by_user_id = @userId) +
      (SELECT COUNT(*) FROM historico_de_movimentacoes WHERE created_by_user_id = @userId) +
      (SELECT COUNT(*) FROM exames_paciente WHERE scheduled_by_user_id = @userId OR completed_by_user_id = @userId)
      AS count
  `).get({ userId }).count;

  if (usageCount > 0) {
    throw new Error("Este usuario ja possui historico no sistema. Desative o usuario em vez de excluir.");
  }

  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return { success: true };
}

export function createClinicUnit(input) {
  const name = String(input.name || "").trim();
  const active = input.active !== false;

  if (!name) {
    throw new Error("Informe o nome da unidade.");
  }

  const duplicate = db.prepare("SELECT id FROM clinic_units WHERE lower(name) = lower(?)").get(name);
  if (duplicate) {
    throw new Error("Ja existe uma unidade com este nome.");
  }

  const now = todayIso();
  const info = db.prepare(`
    INSERT INTO clinic_units (name, active, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(name, active ? 1 : 0, now, now);

  return listClinicUnits().find((unit) => unit.id === Number(info.lastInsertRowid));
}

export function updateClinicUnit(unitId, input) {
  const currentUnit = db.prepare("SELECT id, name FROM clinic_units WHERE id = ?").get(unitId);
  if (!currentUnit) {
    throw new Error("Unidade nao encontrada.");
  }

  const name = String(input.name || "").trim();
  const active = Boolean(input.active);

  if (!name) {
    throw new Error("Informe o nome da unidade.");
  }

  const duplicate = db.prepare("SELECT id FROM clinic_units WHERE lower(name) = lower(?) AND id <> ?").get(name, unitId);
  if (duplicate) {
    throw new Error("Ja existe outra unidade com este nome.");
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE clinic_units
      SET name = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, active ? 1 : 0, now, unitId);

    db.prepare(`
      UPDATE patients
      SET clinic_unit = ?, updated_at = ?
      WHERE clinic_unit = ?
    `).run(name, now, currentUnit.name);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listClinicUnits().find((unit) => unit.id === unitId);
}

export function deleteClinicUnit(unitId) {
  const currentUnit = db.prepare("SELECT id, name FROM clinic_units WHERE id = ?").get(unitId);
  if (!currentUnit) {
    throw new Error("Unidade nao encontrada.");
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE physicians
      SET clinic_unit_id = NULL, updated_at = ?
      WHERE clinic_unit_id = ?
    `).run(now, unitId);

    db.prepare(`
      UPDATE patients
      SET clinic_unit = NULL, updated_at = ?
      WHERE clinic_unit = ?
    `).run(now, currentUnit.name);

    db.prepare("DELETE FROM clinic_units WHERE id = ?").run(unitId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { success: true };
}

export function createPhysician(input) {
  const name = String(input.name || "").trim();
  const clinicUnitId = input.clinicUnitId ? Number(input.clinicUnitId) : null;
  const active = input.active !== false;

  if (!name) {
    throw new Error("Informe o nome do medico.");
  }

  const duplicate = db.prepare("SELECT id FROM physicians WHERE lower(name) = lower(?)").get(name);
  if (duplicate) {
    throw new Error("Ja existe um medico com este nome.");
  }

  if (clinicUnitId) {
    const unit = db.prepare("SELECT id FROM clinic_units WHERE id = ?").get(clinicUnitId);
    if (!unit) {
      throw new Error("Selecione uma unidade valida para o medico.");
    }
  }

  const now = todayIso();
  const info = db.prepare(`
    INSERT INTO physicians (name, clinic_unit_id, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, clinicUnitId, active ? 1 : 0, now, now);

  return listPhysicians().find((physician) => physician.id === Number(info.lastInsertRowid));
}

export function updatePhysician(physicianId, input) {
  const currentPhysician = db.prepare("SELECT id, name FROM physicians WHERE id = ?").get(physicianId);
  if (!currentPhysician) {
    throw new Error("Medico nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const clinicUnitId = input.clinicUnitId ? Number(input.clinicUnitId) : null;
  const active = Boolean(input.active);

  if (!name) {
    throw new Error("Informe o nome do medico.");
  }

  const duplicate = db.prepare("SELECT id FROM physicians WHERE lower(name) = lower(?) AND id <> ?").get(name, physicianId);
  if (duplicate) {
    throw new Error("Ja existe outro medico com este nome.");
  }

  if (clinicUnitId) {
    const unit = db.prepare("SELECT id FROM clinic_units WHERE id = ?").get(clinicUnitId);
    if (!unit) {
      throw new Error("Selecione uma unidade valida para o medico.");
    }
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE physicians
      SET name = ?, clinic_unit_id = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, clinicUnitId, active ? 1 : 0, now, physicianId);

    db.prepare(`
      UPDATE patients
      SET physician_name = ?, updated_at = ?
      WHERE physician_name = ?
    `).run(name, now, currentPhysician.name);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return listPhysicians().find((physician) => physician.id === physicianId);
}

export function deletePhysician(physicianId) {
  const currentPhysician = db.prepare("SELECT id, name FROM physicians WHERE id = ?").get(physicianId);
  if (!currentPhysician) {
    throw new Error("Medico nao encontrado.");
  }

  const now = todayIso();
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE patients
      SET physician_name = NULL, updated_at = ?
      WHERE physician_name = ?
    `).run(now, currentPhysician.name);

    db.prepare("DELETE FROM physicians WHERE id = ?").run(physicianId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { success: true };
}

export function listExamConfigs() {
  return db.prepare(`
    SELECT
      id,
      code,
      name,
      start_week AS startWeek,
      end_week AS endWeek,
      target_week AS targetWeek,
      reminder_days_before_1 AS reminderDaysBefore1,
      reminder_days_before_2 AS reminderDaysBefore2,
      default_message AS defaultMessage,
      required,
      flow_type AS flowType,
      active,
      sort_order AS sortOrder
    FROM exames_modelo
    ORDER BY sort_order
  `).all().map((item) => ({ ...item, active: Boolean(item.active), required: Boolean(item.required) }));
}

export function listExamInferenceRules() {
  return db.prepare(`
    SELECT
      rule.id,
      rule.exam_model_id AS examModelId,
      exam.name AS examName,
      exam.code AS examCode,
      rule.typical_start_week AS typicalStartWeek,
      rule.typical_end_week AS typicalEndWeek,
      rule.reference_week AS referenceWeek,
      rule.uncertainty_margin_weeks AS uncertaintyMarginWeeks,
      rule.allow_automatic_inference AS allowAutomaticInference,
      rule.active,
      rule.created_at AS createdAt,
      rule.updated_at AS updatedAt
    FROM regras_inferencia_gestacional rule
    INNER JOIN exames_modelo exam ON exam.id = rule.exam_model_id
    ORDER BY exam.sort_order, exam.name COLLATE NOCASE
  `).all().map((item) => ({
    ...item,
    active: Boolean(item.active),
    allowAutomaticInference: Boolean(item.allowAutomaticInference)
  }));
}

export function listExamProtocolPresets() {
  return Object.values(EXAM_PROTOCOL_PRESETS);
}

export function createExamConfig(input) {
  const code = normalizeExamCode(input.code || input.name);
  validateExamConfigInput({ ...input, code });

  const duplicate = db.prepare("SELECT id FROM exames_modelo WHERE code = ?").get(code);
  if (duplicate) {
    throw new Error("Ja existe um exame com este codigo.");
  }

  const now = todayIso();
  const result = db.prepare(`
    INSERT INTO exames_modelo (
      code,
      name,
      start_week,
      end_week,
      target_week,
      reminder_days_before_1,
      reminder_days_before_2,
      default_message,
      required,
      flow_type,
      active,
      sort_order,
      created_at,
      updated_at
    )
    VALUES (
      @code,
      @name,
      @startWeek,
      @endWeek,
      @targetWeek,
      @reminderDaysBefore1,
      @reminderDaysBefore2,
      @defaultMessage,
      @required,
      @flowType,
      @active,
      @sortOrder,
      @createdAt,
      @updatedAt
    )
  `).run({
    code,
    name: String(input.name || "").trim(),
    startWeek: Number(input.startWeek),
    endWeek: Number(input.endWeek),
    targetWeek: Number(input.targetWeek),
    reminderDaysBefore1: Number(input.reminderDaysBefore1 ?? 7),
    reminderDaysBefore2: Number(input.reminderDaysBefore2 ?? 2),
    defaultMessage: String(input.defaultMessage || "").trim(),
    required: input.required ? 1 : 0,
    flowType: input.flowType ?? "automatico",
    active: input.active ? 1 : 0,
    sortOrder: Number(input.sortOrder || (listExamConfigs().length + 1)),
    createdAt: now,
    updatedAt: now
  });

  const examId = Number(result.lastInsertRowid);
  const inferenceRuleDefaults = {
    examModelId: examId,
    typicalStartWeek: Number(input.startWeek),
    typicalEndWeek: Number(input.endWeek),
    referenceWeek: Number(input.targetWeek),
    uncertaintyMarginWeeks: input.flowType === "avulso" ? 2 : 1,
    allowAutomaticInference: input.flowType !== "avulso" ? 1 : 0,
    active: input.flowType !== "avulso" ? 1 : 0
  };

  db.prepare(`
    INSERT INTO regras_inferencia_gestacional (
      exam_model_id,
      typical_start_week,
      typical_end_week,
      reference_week,
      uncertainty_margin_weeks,
      allow_automatic_inference,
      active,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    inferenceRuleDefaults.examModelId,
    inferenceRuleDefaults.typicalStartWeek,
    inferenceRuleDefaults.typicalEndWeek,
    inferenceRuleDefaults.referenceWeek,
    inferenceRuleDefaults.uncertaintyMarginWeeks,
    inferenceRuleDefaults.allowAutomaticInference,
    inferenceRuleDefaults.active,
    now,
    now
  );

  createAutomaticExamForEligiblePatients(
    {
      id: examId,
      code,
      name: String(input.name || "").trim(),
      startWeek: Number(input.startWeek),
      endWeek: Number(input.endWeek),
      targetWeek: Number(input.targetWeek),
      reminderDaysBefore1: Number(input.reminderDaysBefore1 ?? 7),
      reminderDaysBefore2: Number(input.reminderDaysBefore2 ?? 2),
      defaultMessage: String(input.defaultMessage || "").trim(),
      required: Boolean(input.required),
      flowType: input.flowType ?? "automatico",
      active: Boolean(input.active),
      sortOrder: Number(input.sortOrder || (listExamConfigs().length + 1))
    },
    now
  );

  return listExamConfigs().find((item) => item.id === examId);
}

export function updateExamConfig(id, input) {
  const currentExam = db.prepare("SELECT id, code FROM exames_modelo WHERE id = ?").get(id);
  if (!currentExam) {
    throw new Error("Exame nao encontrado.");
  }

  const code = normalizeExamCode(input.code || currentExam.code);
  validateExamConfigInput({ ...input, code });

  const duplicate = db.prepare("SELECT id FROM exames_modelo WHERE code = ? AND id <> ?").get(code, id);
  if (duplicate) {
    throw new Error("Ja existe outro exame com este codigo.");
  }

  db.prepare(`
    UPDATE exames_modelo
    SET
      code = @code,
      name = @name,
      start_week = @startWeek,
      end_week = @endWeek,
      target_week = @targetWeek,
      reminder_days_before_1 = @reminderDaysBefore1,
      reminder_days_before_2 = @reminderDaysBefore2,
      default_message = @defaultMessage,
      required = @required,
      flow_type = @flowType,
      active = @active,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id,
    code,
    name: input.name,
    startWeek: input.startWeek,
    endWeek: input.endWeek,
    targetWeek: input.targetWeek,
    reminderDaysBefore1: input.reminderDaysBefore1 ?? 7,
    reminderDaysBefore2: input.reminderDaysBefore2 ?? 2,
    defaultMessage: input.defaultMessage ?? "",
    required: input.required ? 1 : 0,
    flowType: input.flowType ?? "automatico",
    active: input.active ? 1 : 0,
    updatedAt: todayIso()
  });

  return listExamConfigs().find((item) => item.id === id);
}

export function deleteExamConfig(id) {
  const currentExam = db.prepare("SELECT id, name FROM exames_modelo WHERE id = ?").get(id);
  if (!currentExam) {
    throw new Error("Exame nao encontrado.");
  }

  const usage = db.prepare("SELECT COUNT(*) AS count FROM exames_paciente WHERE exam_model_id = ?").get(id);
  if (usage.count > 0) {
    throw new Error("Este exame ja foi usado em pacientes e nao pode ser excluido. Se preferir, deixe-o como avulso ou inativo.");
  }

  db.prepare("DELETE FROM exames_modelo WHERE id = ?").run(id);
  return {
    success: true,
    deletedExam: {
      id: currentExam.id,
      name: currentExam.name
    }
  };
}

export function updateExamInferenceRule(id, input) {
  validateExamInferenceRuleInput(input);

  const currentRule = db.prepare(`
    SELECT id
    FROM regras_inferencia_gestacional
    WHERE id = ?
  `).get(id);

  if (!currentRule) {
    throw new Error("Regra de inferencia nao encontrada.");
  }

  db.prepare(`
    UPDATE regras_inferencia_gestacional
    SET
      typical_start_week = @typicalStartWeek,
      typical_end_week = @typicalEndWeek,
      reference_week = @referenceWeek,
      uncertainty_margin_weeks = @uncertaintyMarginWeeks,
      allow_automatic_inference = @allowAutomaticInference,
      active = @active,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id,
    typicalStartWeek: Number(input.typicalStartWeek),
    typicalEndWeek: Number(input.typicalEndWeek),
    referenceWeek: Number(input.referenceWeek),
    uncertaintyMarginWeeks: Number(input.uncertaintyMarginWeeks),
    allowAutomaticInference: input.allowAutomaticInference ? 1 : 0,
    active: input.active ? 1 : 0,
    updatedAt: todayIso()
  });

  return listExamInferenceRules().find((item) => item.id === id);
}

export function applyExamProtocolPreset(presetId) {
  const preset = EXAM_PROTOCOL_PRESETS[presetId];
  if (!preset) {
    throw new Error("Protocolo sugerido nao encontrado.");
  }

  const now = todayIso();
  const examConfigs = listExamConfigs();
  const updateStatement = db.prepare(`
    UPDATE exames_modelo
    SET
      start_week = @startWeek,
      end_week = @endWeek,
      target_week = @targetWeek,
      reminder_days_before_1 = @reminderDaysBefore1,
      reminder_days_before_2 = @reminderDaysBefore2,
      updated_at = @updatedAt
    WHERE id = @id
  `);

  db.exec("BEGIN");
  try {
    examConfigs.forEach((examConfig) => {
      const override = preset.overrides[examConfig.code] ?? {};

      updateStatement.run({
        id: examConfig.id,
        startWeek: override.startWeek ?? examConfig.startWeek,
        endWeek: override.endWeek ?? examConfig.endWeek,
        targetWeek: override.targetWeek ?? examConfig.targetWeek,
        reminderDaysBefore1: override.reminderDaysBefore1 ?? examConfig.reminderDaysBefore1,
        reminderDaysBefore2: override.reminderDaysBefore2 ?? examConfig.reminderDaysBefore2,
        updatedAt: now
      });
    });

    db.exec("COMMIT");
    return {
      preset,
      examConfigs: listExamConfigs()
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
