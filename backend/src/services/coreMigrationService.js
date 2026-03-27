import { KANBAN_STAGES } from "../config.js";
import { getConfiguredDatabaseKind } from "../database/runtime.js";
import {
  createUserSession,
  getActiveSessionByTokenHash,
  getActiveUserByEmail,
  getPatientExamRow,
  getMessageRow,
  getMessageTemplateByCode,
  insertMovementRecord,
  insertMessageDeliveryLog,
  insertMessageRecord,
  insertPatientRecord,
  listAdminUsersRows,
  listAutomaticExamModels,
  listClinicUnitsRows,
  listExamConfigRows,
  listExamInferenceRuleRows,
  listKanbanColumnsRows,
  listLatestMessageRows,
  listMessageDeliveryLogRows,
  listMessageRows,
  listMessageHistoryRowsByPatient,
  listMessageTemplateRows,
  listMovementRows,
  listMovementRowsByPatient,
  listPatientExamRows,
  listPatientsBaseRows,
  listPhysiciansRows,
  replacePatientExams,
  touchSessionLastSeen,
  updateMessageRecord,
  updatePatientExamRecord,
  updatePatientRecord,
  updatePatientStage,
  updateUserPasswordHash
} from "../database/repositories/coreRepository.js";
import { analyzePatientExamTimeline, calculateExamScheduleDates, resolvePregnancySnapshot, DEADLINE_STATUS } from "../domain/obstetrics.js";
import {
  authenticate as authenticateLegacy,
  createMessage as createMessageLegacy,
  createPatient as createPatientLegacy,
  getAuthenticatedUserByToken as getAuthenticatedUserByTokenLegacy,
  getAdminPanelData as getAdminPanelDataLegacy,
  getDashboardData as getDashboardDataLegacy,
  getKanbanData as getKanbanDataLegacy,
  getMessagingOverview as getMessagingOverviewLegacy,
  getPatientDetails as getPatientDetailsLegacy,
  getRemindersCenterData as getRemindersCenterDataLegacy,
  getRemindersCount as getRemindersCountLegacy,
  getReportsData as getReportsDataLegacy,
  listPatients as listPatientsLegacy,
  listExamConfigs as listExamConfigsLegacy,
  listExamProtocolPresets,
  getPatientFormCatalogs as getPatientFormCatalogsLegacy,
  movePatientStage as movePatientStageLegacy,
  updatePatient as updatePatientLegacy,
  updatePatientExamStatus as updatePatientExamStatusLegacy,
  updateMessageStatus as updateMessageStatusLegacy,
  updateReminderStatus as updateReminderStatusLegacy
} from "./clinicService.js";
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
import { getMessagingRuntimeConfig } from "./messaging/messagingService.js";
import { lookupFutureScheduledExamInShosp } from "./shospIntegration/shospIntegrationService.js";

function isSqliteMode() {
  return getConfiguredDatabaseKind() === "sqlite";
}

function sanitizePhone(phone) {
  return normalizeBrazilPhone(phone);
}

function fillMessageVariables(template, variables) {
  return String(template || "").replace(/\[([A-Z_]+)\]|\{\{([a-z_]+)\}\}/gi, (match, bracketToken, moustacheToken) => {
    const token = String(bracketToken || moustacheToken || "").trim().toLowerCase();
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

function validatePatientInput(input, automaticExamCodes = []) {
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
    if (!automaticExamCodes.includes(examCode)) {
      throw new Error("Selecione um ultimo exame realizado valido da esteira automatica.");
    }
  }
}

function buildLatestMessageMap(rows) {
  const latestByPatient = new Map();
  rows.forEach((row) => {
    if (!latestByPatient.has(row.patientId)) {
      latestByPatient.set(row.patientId, row);
    }
  });
  return latestByPatient;
}

function buildMessageHistoryMap(rows) {
  return rows.reduce((map, row) => {
    const current = map.get(row.patientId) ?? [];
    current.push(row);
    map.set(row.patientId, current);
    return map;
  }, new Map());
}

function buildPatientExamsMap(rows) {
  return rows.reduce((map, row) => {
    const current = map.get(row.patientId) ?? [];
    current.push({
      ...row,
      required: Boolean(row.required),
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

function buildCompletedDateLabel(exam) {
  if (exam.completedDate) {
    return formatDatePtBr(exam.completedDate);
  }

  if (exam.status === "realizado") {
    return exam.completedOutsideClinic ? "Ja realizado (data nao informada)" : "Realizado (data nao informada)";
  }

  return null;
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

function normalizeReminderFilters(input = {}) {
  return {
    clinicUnit: input.clinicUnit ? String(input.clinicUnit) : "",
    physicianName: input.physicianName ? String(input.physicianName) : "",
    examCode: input.examCode ? String(input.examCode) : ""
  };
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
    clinicUnit: String(input.clinicUnit || ""),
    physicianName: String(input.physicianName || "")
  };
}

function isDateWithinRange(date, filters) {
  if (!date) {
    return false;
  }

  return date >= filters.dateFrom && date <= filters.dateTo;
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
  const currentStage = patient.stage || "contato_pendente";

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

function getStageTitle(stageId) {
  return KANBAN_STAGES.find((stage) => stage.id === stageId)?.title || stageId;
}

function enrichPatient(patient, patientExamsMap, latestMessagesMap) {
  const patientExams = patientExamsMap.get(patient.id) ?? [];
  const snapshot = resolvePregnancySnapshot(patient, todayIso(), { patientExams });
  const latestMessage = latestMessagesMap.get(patient.id) ?? null;
  const nextExam = snapshot.gestationalBaseRequiresManualReview ? buildManualReviewNextExam() : buildNextExam(patientExams);
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
    stageTitle: getStageTitle(normalizedStage)
  };
}

function buildExamScheduleRows(patientId, automaticExamModels, snapshot, preservedState = new Map(), lastCompletedExamCode = "") {
  const historicalCodes = new Set();
  if (lastCompletedExamCode) {
    const lastIndex = automaticExamModels.findIndex((exam) => exam.code === lastCompletedExamCode);
    if (lastIndex >= 0) {
      automaticExamModels.slice(0, lastIndex + 1).forEach((exam) => historicalCodes.add(exam.code));
    }
  }

  return automaticExamModels.map((examModel) => {
    const { predictedDate, reminderDate1, reminderDate2 } = calculateExamScheduleDates({
      dum: snapshot.dum,
      targetWeek: examModel.targetWeek,
      reminderDaysBefore1: examModel.reminderDaysBefore1,
      reminderDaysBefore2: examModel.reminderDaysBefore2
    });
    const previous = preservedState.get(examModel.id);
    const historicalCompleted = historicalCodes.has(examModel.code);

    return {
      patientId,
      examModelId: examModel.id,
      predictedDate,
      reminderDate1,
      reminderDate2,
      scheduledDate: historicalCompleted ? null : previous?.scheduledDate ?? null,
      scheduledTime: historicalCompleted ? null : previous?.scheduledTime ?? null,
      schedulingNotes: historicalCompleted ? null : previous?.schedulingNotes ?? null,
      scheduledByUserId: historicalCompleted ? null : previous?.scheduledByUserId ?? null,
      lastContactedAt: historicalCompleted ? null : previous?.lastContactedAt ?? null,
      reminderSnoozedUntil: historicalCompleted ? null : previous?.reminderSnoozedUntil ?? null,
      completedDate: historicalCompleted ? null : previous?.completedDate ?? null,
      completedByUserId: historicalCompleted ? null : previous?.completedByUserId ?? null,
      completedOutsideClinic: historicalCompleted ? true : Boolean(previous?.completedOutsideClinic),
      status: historicalCompleted ? "realizado" : previous?.status ?? "pendente"
    };
  });
}

export async function authenticateCore(email, password) {
  if (isSqliteMode()) {
    return authenticateLegacy(email, password);
  }

  const user = await getActiveUserByEmail(String(email || "").trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password)) {
    return null;
  }

  if (!isPasswordHashed(user.password)) {
    await updateUserPasswordHash(user.id, hashPassword(password), todayIso());
  }

  const token = createSessionToken();
  const now = new Date().toISOString();
  await createUserSession(user.id, hashSessionToken(token), buildSessionExpiry(), now);

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

export async function getAuthenticatedUserByTokenCore(token) {
  if (isSqliteMode()) {
    return getAuthenticatedUserByTokenLegacy(token);
  }

  const now = new Date().toISOString();
  const session = await getActiveSessionByTokenHash(hashSessionToken(token), now);
  if (!session) {
    return null;
  }

  await touchSessionLastSeen(session.id, now);
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

export async function listPatientsCore() {
  if (isSqliteMode()) {
    return listPatientsLegacy();
  }

  const [patients, patientExamRows, latestMessageRows] = await Promise.all([
    listPatientsBaseRows(),
    listPatientExamRows(),
    listLatestMessageRows()
  ]);
  const patientExamsMap = buildPatientExamsMap(patientExamRows);
  const latestMessagesMap = buildLatestMessageMap(latestMessageRows);

  return patients.map((patient) => enrichPatient(patient, patientExamsMap, latestMessagesMap));
}

export async function getKanbanDataCore() {
  if (isSqliteMode()) {
    return getKanbanDataLegacy();
  }

  const [columns, patients] = await Promise.all([
    listKanbanColumnsRows(),
    listPatientsCore()
  ]);

  return columns.map((stage) => ({
    ...stage,
    isSystem: Boolean(stage.isSystem),
    patients: sortPatientsByPriority(patients.filter((patient) => patient.stage === stage.id))
  }));
}

export async function getDashboardDataCore(inputFilters = {}) {
  if (isSqliteMode()) {
    return getDashboardDataLegacy(inputFilters);
  }

  const filters = normalizeDashboardFilters(inputFilters);
  const [allPatients, patientExamRows, messageRows, movementRows] = await Promise.all([
    listPatientsCore(),
    listPatientExamRows(),
    listMessageRows(),
    listMovementRows()
  ]);

  const filterOptions = {
    clinicUnits: [...new Set(allPatients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(allPatients.map((patient) => patient.physicianName).filter(Boolean))].sort()
  };
  const patients = applyPatientFilters(allPatients, filters);
  const patientIds = new Set(patients.map((patient) => patient.id));
  const patientExamsMap = buildPatientExamsMap(patientExamRows);
  const examRows = patientExamRows.filter((exam) => patientIds.has(exam.patientId));
  const filteredMessageRows = messageRows.filter((message) => patientIds.has(message.patientId));
  const filteredMovementRows = movementRows.filter((movement) => patientIds.has(movement.patientId));
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

  const messagesInPeriod = filteredMessageRows.filter((message) => isDateWithinRange(message.sentAt || message.createdAt, filters));
  const scheduledMovementsInPeriod = filteredMovementRows.filter(
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
      conversionRate: messagesInPeriod.length ? Math.round((scheduledMovementsInPeriod.length / messagesInPeriod.length) * 100) : 0,
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

export async function getReportsDataCore(inputFilters = {}) {
  if (isSqliteMode()) {
    return getReportsDataLegacy(inputFilters);
  }

  const filters = normalizeDashboardFilters(inputFilters);
  const [allPatients, patientExamRows, messageRows, movementRows, columns] = await Promise.all([
    listPatientsCore(),
    listPatientExamRows(),
    listMessageRows(),
    listMovementRows(),
    listKanbanColumnsRows()
  ]);

  const filterOptions = {
    clinicUnits: [...new Set(allPatients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(allPatients.map((patient) => patient.physicianName).filter(Boolean))].sort()
  };
  const patients = applyPatientFilters(allPatients, filters);
  const patientIds = new Set(patients.map((patient) => patient.id));
  const examRows = patientExamRows.filter((exam) => patientIds.has(exam.patientId));
  const filteredMessageRows = messageRows.filter((message) => patientIds.has(message.patientId));
  const filteredMovementRows = movementRows.filter((movement) => patientIds.has(movement.patientId));

  const pendingExams = examRows
    .filter((exam) => exam.status !== "realizado")
    .map((exam) => {
      const patient = patients.find((item) => item.id === exam.patientId);
      const assessedExam = analyzePatientExamTimeline([exam]).assessedExams[0];
      return {
        patientId: exam.patientId,
        patientName: patient?.name || "Paciente",
        examName: exam.name,
        examCode: exam.code,
        predictedDate: exam.predictedDate,
        predictedDateLabel: exam.predictedDate ? formatDatePtBr(exam.predictedDate) : "Nao definida",
        deadlineStatusLabel: assessedExam?.deadlineStatusLabel || "Pendente",
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
    ...filteredMessageRows
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
    ...filteredMovementRows
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

  const scheduledMovementsInPeriod = filteredMovementRows.filter(
    (movement) => movement.actionType === "exame_agendado" && isDateWithinRange(movement.createdAt, filters)
  );

  const productivityMap = new Map();
  const trackedActions = filteredMovementRows.filter((movement) =>
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

  const patientsByStage = columns.map((column) => ({
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

export async function getAdminPanelDataCore() {
  if (isSqliteMode()) {
    return getAdminPanelDataLegacy();
  }

  const [
    usersResult,
    unitsResult,
    physiciansResult,
    examConfigsResult,
    examInferenceRulesResult,
    messageTemplatesResult,
    messageDeliveryLogsResult
  ] = await Promise.allSettled([
    listAdminUsersRows(),
    listClinicUnitsRows(),
    listPhysiciansRows(),
    listExamConfigsCore(),
    listExamInferenceRuleRows(),
    listMessageTemplateRows(),
    listMessageDeliveryLogRows()
  ]);

  if (usersResult.status === "rejected") {
    console.error("[admin] Falha ao carregar usuarios.", usersResult.reason);
  }
  if (unitsResult.status === "rejected") {
    console.error("[admin] Falha ao carregar unidades.", unitsResult.reason);
  }
  if (physiciansResult.status === "rejected") {
    console.error("[admin] Falha ao carregar medicos.", physiciansResult.reason);
  }
  if (examConfigsResult.status === "rejected") {
    console.error("[admin] Falha ao carregar exames.", examConfigsResult.reason);
  }
  if (examInferenceRulesResult.status === "rejected") {
    console.error("[admin] Falha ao carregar regras de inferencia.", examInferenceRulesResult.reason);
  }
  if (messageTemplatesResult.status === "rejected") {
    console.error("[admin] Falha ao carregar templates de mensagem.", messageTemplatesResult.reason);
  }
  if (messageDeliveryLogsResult.status === "rejected") {
    console.error("[admin] Falha ao carregar logs de mensageria.", messageDeliveryLogsResult.reason);
  }

  const users = usersResult.status === "fulfilled" ? usersResult.value : [];
  const units = unitsResult.status === "fulfilled" ? unitsResult.value : [];
  const physicians = physiciansResult.status === "fulfilled" ? physiciansResult.value : [];
  const examConfigsResponse = examConfigsResult.status === "fulfilled"
    ? examConfigsResult.value
    : { examConfigs: [], presets: [] };
  const examInferenceRules = examInferenceRulesResult.status === "fulfilled" ? examInferenceRulesResult.value : [];
  const messageTemplates = messageTemplatesResult.status === "fulfilled" ? messageTemplatesResult.value : [];
  const messageDeliveryLogs = messageDeliveryLogsResult.status === "fulfilled" ? messageDeliveryLogsResult.value : [];

  return {
    users: users.map((user) => ({
      ...user,
      role: String(user.role || "").trim().toLowerCase() === "atendente" ? "recepcao" : user.role,
      active: Boolean(user.active)
    })),
    units: units.map((unit) => ({ ...unit, active: Boolean(unit.active) })),
    physicians: physicians.map((physician) => ({ ...physician, active: Boolean(physician.active) })),
    examConfigs: examConfigsResponse.examConfigs,
    examInferenceRules: examInferenceRules.map((item) => ({
      ...item,
      active: Boolean(item.active),
      allowAutomaticInference: Boolean(item.allowAutomaticInference)
    })),
    messageTemplates: messageTemplates.map((template) => ({ ...template, active: Boolean(template.active) })),
    messageDeliveryLogs,
    messagingConfig: getMessagingRuntimeConfig()
  };
}

export async function getPatientDetailsCore(patientId) {
  if (isSqliteMode()) {
    return getPatientDetailsLegacy(patientId);
  }

  const patient = (await listPatientsCore()).find((item) => item.id === patientId);
  if (!patient) {
    return null;
  }

  const [allExamRows, messages, movements] = await Promise.all([
    listPatientExamRows(),
    listMessageHistoryRowsByPatient(patientId),
    listMovementRowsByPatient(patientId)
  ]);
  const patientExams = buildPatientExamsMap(allExamRows).get(patientId) ?? [];
  const exams = analyzePatientExamTimeline(patientExams.map((exam) => ({
    ...exam,
    predictedDateLabel: formatDatePtBr(exam.predictedDate),
    scheduledDateLabel: exam.scheduledDate ? formatDatePtBr(exam.scheduledDate) : null,
    completedDateLabel: buildCompletedDateLabel(exam),
    suggestedMessage: renderExamReminderMessage(
      exam.defaultMessage,
      patient,
      exam,
      `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`
    )
  }))).assessedExams;

  return {
    patient,
    exams,
    messages,
    movements: movements.map((movement) => ({
      ...movement,
      metadata: movement.metadataJson ? JSON.parse(movement.metadataJson) : null
    }))
  };
}

export async function createPatientCore(input) {
  if (isSqliteMode()) {
    return createPatientLegacy(input);
  }

  const automaticExamModels = await listAutomaticExamModels();
  validatePatientInput(input, automaticExamModels.map((exam) => exam.code));

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

  const patientId = await insertPatientRecord({
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
    stage: input.stage || "contato_pendente",
    createdByUserId: actorUserId,
    createdAt: now,
    updatedAt: now
  });

  const examRows = buildExamScheduleRows(patientId, automaticExamModels, snapshot, new Map(), String(input.lastCompletedExamCode || ""));
  await replacePatientExams(patientId, examRows, now);
  await insertMovementRecord({
    patientId,
    fromStage: null,
    toStage: input.stage || "contato_pendente",
    actionType: "cadastro",
    description: "Paciente cadastrada no CRM.",
    metadataJson: JSON.stringify({
      origem: "cadastro_manual",
      lastCompletedExamCode: input.lastCompletedExamCode || null
    }),
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

export async function updatePatientCore(patientId, input) {
  if (isSqliteMode()) {
    return updatePatientLegacy(patientId, input);
  }

  const automaticExamModels = await listAutomaticExamModels();
  validatePatientInput(input, automaticExamModels.map((exam) => exam.code));

  const currentPatient = (await listPatientsBaseRows()).find((patient) => patient.id === patientId);
  if (!currentPatient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  const snapshot = resolvePregnancySnapshot({
    dum: null,
    gestationalWeeks: Number(input.gestationalWeeks),
    gestationalDays: Number(input.gestationalDays),
    gestationalBaseDate: now,
    gestationalBaseSource: "idade_gestacional_informada"
  });
  const gestationalPayload = getGestationalStoragePayload(snapshot, now);

  await updatePatientRecord(patientId, {
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

  const currentExamRows = buildPatientExamsMap(await listPatientExamRows()).get(patientId) ?? [];
  const preservedState = new Map(currentExamRows.map((exam) => [exam.examModelId, exam]));
  const rebuiltExamRows = buildExamScheduleRows(patientId, automaticExamModels, snapshot, preservedState, "");
  await replacePatientExams(patientId, rebuiltExamRows, now);

  return getPatientDetailsCore(patientId);
}

export async function updatePatientExamStatusCore(patientId, examId, input) {
  if (isSqliteMode()) {
    return updatePatientExamStatusLegacy(patientId, examId, input);
  }

  const exam = await getPatientExamRow(patientId, examId);
  if (!exam) {
    throw new Error("Exame da paciente nao encontrado.");
  }

  const nextStatus = String(input.status || "").trim();
  const completedOutsideClinic = nextStatus === "realizado" && Boolean(input.completedOutsideClinic);
  const scheduledDate = input.scheduledDate || null;
  const scheduledTime = input.scheduledTime || null;
  const completedDate = completedOutsideClinic ? null : input.completedDate || null;
  const actorUserId = Number(input.actorUserId || 1);
  const now = todayIso();

  if (!["agendado", "realizado", "pendente"].includes(nextStatus)) {
    throw new Error("Status do exame invalido.");
  }
  if (nextStatus === "agendado" && !scheduledDate) {
    throw new Error("Informe a data do agendamento.");
  }
  if (nextStatus === "agendado" && !scheduledTime) {
    throw new Error("Informe o horario do agendamento.");
  }
  if (nextStatus === "realizado" && !completedOutsideClinic && !completedDate) {
    throw new Error("Informe a data de realizacao do exame.");
  }

  await updatePatientExamRecord(patientId, examId, {
    scheduledDate: nextStatus === "agendado" ? scheduledDate : nextStatus === "pendente" ? null : exam.scheduledDate,
    scheduledTime: nextStatus === "agendado" ? scheduledTime : nextStatus === "pendente" ? null : exam.scheduledTime,
    schedulingNotes: nextStatus === "agendado" ? input.schedulingNotes || null : nextStatus === "pendente" ? null : exam.schedulingNotes,
    scheduledByUserId: nextStatus === "agendado" ? actorUserId : nextStatus === "pendente" ? null : exam.scheduledByUserId,
    lastContactedAt: nextStatus === "pendente" ? null : exam.lastContactedAt,
    reminderSnoozedUntil: nextStatus === "pendente" ? null : exam.reminderSnoozedUntil,
    completedDate: nextStatus === "realizado" ? completedDate : null,
    completedByUserId: nextStatus === "realizado" && !completedOutsideClinic ? actorUserId : null,
    completedOutsideClinic: nextStatus === "realizado" && completedOutsideClinic,
    status: nextStatus,
    updatedAt: now
  });

  const patientDetails = await getPatientDetailsCore(patientId);
  const newStage = patientDetails.patient.stage;
  await updatePatientStage(patientId, newStage, now);
  await insertMovementRecord({
    patientId,
    fromStage: exam.patientStage,
    toStage: newStage,
    actionType: nextStatus === "agendado" ? "exame_agendado" : nextStatus === "realizado" ? (completedOutsideClinic ? "exame_realizado_externo" : "exame_realizado") : "exame_pendente",
    description:
      nextStatus === "agendado"
        ? `Exame ${exam.name} marcado como agendado.`
        : nextStatus === "realizado"
          ? completedOutsideClinic
            ? `Exame ${exam.name} marcado como ja realizado.`
            : `Exame ${exam.name} marcado como realizado.`
          : `Exame ${exam.name} voltou para pendente.`,
    metadataJson: JSON.stringify({
      examId,
      examCode: exam.code,
      status: nextStatus,
      completedOutsideClinic
    }),
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

export async function movePatientStageCore(patientId, nextStage) {
  if (isSqliteMode()) {
    return movePatientStageLegacy(patientId, nextStage);
  }

  const validStageIds = new Set((await listKanbanColumnsRows()).map((column) => column.id));
  if (!validStageIds.has(nextStage)) {
    throw new Error("Coluna de kanban invalida.");
  }

  const currentPatient = (await listPatientsCore()).find((patient) => patient.id === patientId);
  if (!currentPatient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  await updatePatientStage(patientId, nextStage, now);
  await insertMovementRecord({
    patientId,
    fromStage: currentPatient.stage,
    toStage: nextStage,
    actionType: "movimentacao_kanban",
    description: "Paciente movida manualmente no kanban.",
    metadataJson: JSON.stringify({ origem: "drag_and_drop" }),
    createdByUserId: 1,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

async function registerAutomaticShospScheduleDetectionCore({ patient, examPatientId, shospSchedule }) {
  const now = todayIso();
  const currentExam = await getPatientExamRow(patient.id, examPatientId);

  if (!currentExam) {
    return;
  }

  const hasSameSchedule =
    currentExam.status === "agendado" &&
    currentExam.scheduledDate === (shospSchedule.scheduledDate || null) &&
    currentExam.scheduledTime === (shospSchedule.scheduledTime || null);

  if (hasSameSchedule) {
    if (patient.stage !== "agendada") {
      await updatePatientStage(patient.id, "agendada", now);
    }
    return;
  }

  await updatePatientExamRecord(patient.id, examPatientId, {
    scheduledDate: shospSchedule.scheduledDate || null,
    scheduledTime: shospSchedule.scheduledTime || null,
    schedulingNotes: "Agendamento futuro detectado automaticamente no Shosp.",
    scheduledByUserId: currentExam.scheduledByUserId ?? null,
    lastContactedAt: currentExam.lastContactedAt ?? null,
    reminderSnoozedUntil: currentExam.reminderSnoozedUntil ?? null,
    completedDate: currentExam.completedDate ?? null,
    completedByUserId: currentExam.completedByUserId ?? null,
    completedOutsideClinic: Boolean(currentExam.completedOutsideClinic),
    status: "agendado",
    updatedAt: now
  });
  await updatePatientStage(patient.id, "agendada", now);
  await insertMovementRecord({
    patientId: patient.id,
    fromStage: patient.stage,
    toStage: "agendada",
    actionType: "agendamento_detectado_shosp",
    description: `Agendamento do exame ${patient.nextExam.name} detectado automaticamente no Shosp.`,
    metadataJson: JSON.stringify({
      examPatientId,
      examCode: patient.nextExam.code || null,
      scheduledDate: shospSchedule.scheduledDate || null,
      scheduledTime: shospSchedule.scheduledTime || null,
      source: "shosp"
    }),
    createdByUserId: 1,
    createdAt: now
  });
}

export async function getRemindersCenterDataCore(inputFilters = {}) {
  if (isSqliteMode()) {
    return getRemindersCenterDataLegacy(inputFilters);
  }

  const filters = normalizeReminderFilters(inputFilters);
  const [patients, patientExamRows] = await Promise.all([
    listPatientsCore(),
    listPatientExamRows()
  ]);
  const patientExamsMap = buildPatientExamsMap(patientExamRows);
  const today = todayIso();
  const filterOptions = {
    clinicUnits: [...new Set(patients.map((patient) => patient.clinicUnit).filter(Boolean))].sort(),
    physicians: [...new Set(patients.map((patient) => patient.physicianName).filter(Boolean))].sort(),
    exams: [...new Set(
      patients
        .map((patient) => patient.nextExam)
        .filter((exam) => exam.code)
        .map((exam) => JSON.stringify({ code: exam.code, name: exam.name }))
    )].map((item) => JSON.parse(item)).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
  };

  const reminderCandidates = sortPatientsByPriority(
    patients.filter((patient) => {
      const nextExamRow = (patientExamsMap.get(patient.id) ?? []).find((exam) => exam.code === patient.nextExam.code);
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
      await registerAutomaticShospScheduleDetectionCore({
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
    const suggestedMessage = renderExamReminderMessage(
      nextExamRow?.defaultMessage,
      patient,
      nextExamRow,
      `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`
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
      priorityScore: patient.priorityScore || 0,
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

export async function getRemindersCountCore() {
  if (isSqliteMode()) {
    return getRemindersCountLegacy();
  }

  return {
    count: (await getRemindersCenterDataCore()).items.length
  };
}

export async function updateReminderStatusCore(patientId, examPatientId, action) {
  if (isSqliteMode()) {
    return updateReminderStatusLegacy(patientId, examPatientId, action);
  }

  const exam = await getPatientExamRow(patientId, examPatientId);
  if (!exam) {
    throw new Error("Lembrete da paciente nao encontrado.");
  }

  const now = todayIso();
  const normalizedAction = String(action || "");
  const patient = (await listPatientsCore()).find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }
  if (isMessagingBlockedByGestationalBase(patient)) {
    throw new Error("A paciente precisa passar pela revisao manual da base gestacional antes de qualquer acao na central de lembretes.");
  }

  if (normalizedAction === "contacted") {
    await updatePatientExamRecord(patientId, examPatientId, {
      scheduledDate: exam.scheduledDate ?? null,
      scheduledTime: exam.scheduledTime ?? null,
      schedulingNotes: exam.schedulingNotes ?? null,
      scheduledByUserId: exam.scheduledByUserId ?? null,
      lastContactedAt: now,
      reminderSnoozedUntil: exam.reminderSnoozedUntil ?? null,
      completedDate: exam.completedDate ?? null,
      completedByUserId: exam.completedByUserId ?? null,
      completedOutsideClinic: Boolean(exam.completedOutsideClinic),
      status: exam.status,
      updatedAt: now
    });
  } else if (normalizedAction === "snooze") {
    await updatePatientExamRecord(patientId, examPatientId, {
      scheduledDate: exam.scheduledDate ?? null,
      scheduledTime: exam.scheduledTime ?? null,
      schedulingNotes: exam.schedulingNotes ?? null,
      scheduledByUserId: exam.scheduledByUserId ?? null,
      lastContactedAt: exam.lastContactedAt ?? null,
      reminderSnoozedUntil: addDays(now, 1),
      completedDate: exam.completedDate ?? null,
      completedByUserId: exam.completedByUserId ?? null,
      completedOutsideClinic: Boolean(exam.completedOutsideClinic),
      status: exam.status,
      updatedAt: now
    });
  } else if (normalizedAction === "scheduled") {
    await updatePatientExamRecord(patientId, examPatientId, {
      scheduledDate: exam.scheduledDate ?? now,
      scheduledTime: exam.scheduledTime ?? null,
      schedulingNotes: exam.schedulingNotes ?? null,
      scheduledByUserId: exam.scheduledByUserId ?? 1,
      lastContactedAt: exam.lastContactedAt ?? null,
      reminderSnoozedUntil: exam.reminderSnoozedUntil ?? null,
      completedDate: exam.completedDate ?? null,
      completedByUserId: exam.completedByUserId ?? null,
      completedOutsideClinic: Boolean(exam.completedOutsideClinic),
      status: "agendado",
      updatedAt: now
    });
    await updatePatientStage(patientId, "agendada", now);
  } else {
    throw new Error("Acao de lembrete invalida.");
  }

  await insertMovementRecord({
    patientId,
    fromStage: patient.stage,
    toStage: normalizedAction === "scheduled" ? "agendada" : patient.stage,
    actionType: normalizedAction === "contacted" ? "contato_realizado" : normalizedAction === "snooze" ? "lembrete_adiado" : "exame_agendado",
    description: normalizedAction === "contacted"
      ? "Paciente marcada como contatada na central de lembretes."
      : normalizedAction === "snooze"
        ? "Lembrete adiado para o proximo dia."
        : "Paciente marcada como agendada na central de lembretes.",
    metadataJson: JSON.stringify({ examPatientId, action: normalizedAction }),
    createdByUserId: 1,
    createdAt: now
  });

  return getRemindersCenterDataCore();
}

export async function getMessagingOverviewCore() {
  if (isSqliteMode()) {
    return getMessagingOverviewLegacy();
  }

  const [patients, patientExamRows, latestMessages, messageRows] = await Promise.all([
    listPatientsCore(),
    listPatientExamRows(),
    listLatestMessageRows(),
    listMessageRows()
  ]);
  const patientExamsMap = buildPatientExamsMap(patientExamRows);
  const latestMessagesMap = buildLatestMessageMap(latestMessages);
  const messageHistoryByPatient = buildMessageHistoryMap(messageRows);

  return sortPatientsByPriority(
    patients
      .filter((patient) => !isMessagingBlockedByGestationalBase(patient))
      .map((patient) => {
        const nextPendingExam = (patientExamsMap.get(patient.id) ?? []).find((row) => row.status !== "realizado");
        const latestMessage = latestMessagesMap.get(patient.id) ?? null;
        const suggestedMessage = renderExamReminderMessage(
          nextPendingExam?.defaultMessage,
          patient,
          nextPendingExam,
          `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com seu acompanhamento?`
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
          priorityScore: patient.priorityScore,
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

export async function createMessageCore(input) {
  if (isSqliteMode()) {
    return createMessageLegacy(input);
  }

  const now = todayIso();
  const patient = (await listPatientsCore()).find((item) => item.id === Number(input.patientId));
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }
  if (isMessagingBlockedByGestationalBase(patient)) {
    throw new Error("A base gestacional desta paciente esta com baixa confianca. Faca a revisao manual antes de registrar qualquer mensagem.");
  }

  const messageId = await insertMessageRecord({
    patientId: Number(input.patientId),
    examModelId: input.examModelId ?? null,
    content: input.content,
    deliveryStatus: "enviada",
    sentAt: now,
    responseStatus: "sem_resposta",
    responseText: null,
    responseAt: null,
    channel: "whatsapp",
    createdByUserId: 1,
    createdAt: now,
    updatedAt: now
  });

  const template = input.templateCode ? await getMessageTemplateByCode(input.templateCode) : null;
  await insertMessageDeliveryLog({
    messageId,
    patientId: Number(input.patientId),
    templateId: template?.id ?? null,
    provider: "manual_stub",
    status: "enviada",
    requestPayload: JSON.stringify({
      channel: "whatsapp",
      providerMode: "manual_record",
      content: input.content
    }),
    responsePayload: JSON.stringify({
      accepted: true,
      dryRun: true
    }),
    sentAt: now,
    createdAt: now,
    updatedAt: now
  });

  await updatePatientStage(Number(input.patientId), "mensagem_enviada", now);
  await insertMovementRecord({
    patientId: Number(input.patientId),
    fromStage: patient.stage,
    toStage: "mensagem_enviada",
    actionType: "mensagem_enviada",
    description: "Mensagem registrada para acompanhamento da paciente.",
    metadataJson: JSON.stringify({ examModelId: input.examModelId ?? null }),
    createdByUserId: 1,
    createdAt: now
  });

  return getMessageRow(messageId);
}

export async function updateMessageStatusCore(messageId, input) {
  if (isSqliteMode()) {
    return updateMessageStatusLegacy(messageId, input);
  }

  const now = todayIso();
  const currentMessage = await getMessageRow(messageId);
  if (!currentMessage) {
    throw new Error("Mensagem nao encontrada.");
  }

  const nextDeliveryStatus =
    input.deliveryStatus ??
    (input.responseStatus === "respondida" ? "respondida" : currentMessage.deliveryStatus);

  await updateMessageRecord(messageId, {
    deliveryStatus: nextDeliveryStatus,
    responseStatus: input.responseStatus ?? null,
    responseText: input.responseText ?? null,
    responseAt: input.responseStatus ? now : null,
    updatedAt: now
  });

  await insertMessageDeliveryLog({
    messageId,
    patientId: currentMessage.patientId,
    provider: "manual_stub",
    status: nextDeliveryStatus,
    responsePayload: input.responseText ? JSON.stringify({ responseText: input.responseText }) : null,
    respondedAt: nextDeliveryStatus === "respondida" ? now : null,
    createdAt: now,
    updatedAt: now
  });

  return getMessageRow(messageId);
}

export async function getPatientFormCatalogsCore() {
  if (isSqliteMode()) {
    return getPatientFormCatalogsLegacy();
  }

  const [units, physicians] = await Promise.all([listClinicUnitsRows(), listPhysiciansRows()]);
  return {
    units: units.filter((unit) => Boolean(unit.active)).map((unit) => ({ ...unit, active: Boolean(unit.active) })),
    physicians: physicians.filter((physician) => Boolean(physician.active)).map((physician) => ({ ...physician, active: Boolean(physician.active) }))
  };
}

export async function listExamConfigsCore() {
  if (isSqliteMode()) {
    return {
      examConfigs: listExamConfigsLegacy(),
      presets: listExamProtocolPresets()
    };
  }

  const examConfigs = (await listExamConfigRows()).map((item) => ({
    ...item,
    active: Boolean(item.active),
    required: Boolean(item.required)
  }));

  return {
    examConfigs,
    presets: listExamProtocolPresets()
  };
}
