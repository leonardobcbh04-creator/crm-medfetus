import { KANBAN_STAGES } from "../config.js";
import { getDatabaseRuntime } from "../database/runtime.js";
import {
  createUserSession,
  getActiveSessionByTokenHash,
  getActiveUserByEmail,
  listAuditRowsByPatient,
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
  listRecentAuditLogRows,
  replacePatientExams,
  touchSessionLastSeen,
  updateMessageRecord,
  updatePatientExamRecord,
  updatePatientRecord,
  updatePatientStage,
  updateUserPasswordHash
} from "../database/repositories/coreRepository.js";
import { analyzePatientExamTimeline, calculateExamScheduleDates, resolvePregnancySnapshot, DEADLINE_STATUS } from "../domain/obstetrics.js";
import { listExamProtocolPresets } from "./examProtocolPresets.js";
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
import { recordAuditEvent } from "./auditService.js";


async function resolveActorUserId(preferredUserId = null) {
  const normalizedPreferredId = Number(preferredUserId);
  const users = await listAdminUsersRows();
  const activeUsers = users.filter((user) => Boolean(user.active));

  if (!activeUsers.length) {
    return null;
  }

  if (!Number.isNaN(normalizedPreferredId) && activeUsers.some((user) => user.id === normalizedPreferredId)) {
    return normalizedPreferredId;
  }

  const activeAdmin = activeUsers.find((user) => String(user.role || "").trim().toLowerCase() === "admin");
  return activeAdmin?.id ?? activeUsers[0]?.id ?? null;
}

function sanitizePhone(phone) {
  return normalizeBrazilPhone(phone);
}

function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function normalizeExamCode(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slugifyKanbanTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function validateExamConfigInput(input) {
  const name = String(input.name || "").trim();
  const code = normalizeExamCode(input.code || input.name);
  const flowType = String(input.flowType || "automatico").trim().toLowerCase();
  const startWeek = Number(input.startWeek);
  const endWeek = Number(input.endWeek);
  const targetWeek = Number(input.targetWeek);
  const reminderDaysBefore1 = Number(input.reminderDaysBefore1 ?? 10);
  const reminderDaysBefore2 = Number(input.reminderDaysBefore2 ?? 2);

  if (!name) {
    throw new Error("Informe o nome do exame.");
  }
  if (!code) {
    throw new Error("Informe um codigo valido para o exame.");
  }
  if (!["automatico", "avulso"].includes(flowType)) {
    throw new Error("Tipo de fluxo invalido.");
  }
  if (Number.isNaN(startWeek) || Number.isNaN(endWeek) || Number.isNaN(targetWeek)) {
    throw new Error("Preencha a janela gestacional com valores validos.");
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

function resolvePatientCleanupRange(input = {}) {
  const preset = String(input.preset || "today").trim().toLowerCase();
  const today = todayIso();

  if (preset === "all") {
    return { preset, dateFrom: null, dateTo: null, label: "Todos os pacientes" };
  }
  if (preset === "today") {
    return { preset, dateFrom: today, dateTo: today, label: "Pacientes criados hoje" };
  }
  if (preset === "last_7_days") {
    return { preset, dateFrom: addDays(today, -6), dateTo: today, label: "Pacientes criados nos ultimos 7 dias" };
  }
  if (preset === "last_30_days") {
    return { preset, dateFrom: addDays(today, -29), dateTo: today, label: "Pacientes criados nos ultimos 30 dias" };
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

function buildPatientUpdatePayload(patient, overrides = {}) {
  return {
    name: overrides.name ?? patient.name,
    phone: overrides.phone ?? patient.phone,
    birthDate: overrides.birthDate ?? patient.birthDate,
    dum: overrides.dum ?? patient.dum ?? null,
    dpp: overrides.dpp ?? patient.dpp ?? null,
    currentGestationalWeeks: overrides.currentGestationalWeeks ?? patient.gestationalWeeks ?? null,
    currentGestationalDays: overrides.currentGestationalDays ?? patient.gestationalDays ?? null,
    gestationalBaseDate: overrides.gestationalBaseDate ?? patient.gestationalBaseDate ?? null,
    gestationalBaseSource: overrides.gestationalBaseSource ?? patient.gestationalBaseSource ?? "idade_gestacional_informada",
    gestationalBaseConfidence: overrides.gestationalBaseConfidence ?? patient.gestationalBaseConfidence ?? "alta",
    gestationalBaseIsEstimated: overrides.gestationalBaseIsEstimated ?? (patient.gestationalBaseIsEstimated ? 1 : 0),
    gestationalReviewRequired: overrides.gestationalReviewRequired ?? (patient.gestationalReviewRequired ? 1 : 0),
    gestationalBaseConflict: overrides.gestationalBaseConflict ?? (patient.gestationalBaseHasConflict ? 1 : 0),
    gestationalBaseConflictNote: overrides.gestationalBaseConflictNote ?? patient.gestationalBaseConflictNote ?? null,
    physicianName: overrides.physicianName ?? patient.physicianName ?? null,
    clinicUnit: overrides.clinicUnit ?? patient.clinicUnit ?? null,
    pregnancyType: overrides.pregnancyType ?? patient.pregnancyType ?? null,
    highRisk: overrides.highRisk ?? (patient.highRisk ? 1 : 0),
    notes: overrides.notes ?? patient.notes ?? "",
    status: overrides.status ?? patient.status ?? "ativa",
    updatedAt: overrides.updatedAt ?? todayIso()
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

function isOperationallyScheduled(patient, nextExamRow) {
  if (patient?.stage === "agendada") {
    return true;
  }

  if (!nextExamRow) {
    return false;
  }

  return nextExamRow.status === "agendado" || Boolean(nextExamRow.scheduledDate);
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
  const examName = exam?.name || patient?.nextExam?.name || "seu exame";
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

    const leftNextExamDate = String(left?.nextExam?.date || "");
    const rightNextExamDate = String(right?.nextExam?.date || "");

    if (leftNextExamDate && rightNextExamDate) {
      return leftNextExamDate.localeCompare(rightNextExamDate);
    }

    return String(left?.name || "").localeCompare(String(right?.name || ""), "pt-BR");
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

function getDashboardPriorityBucket(patient) {
  const deadlineStatus = String(patient?.nextExam?.deadlineStatus || "");
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE || deadlineStatus === DEADLINE_STATUS.PENDING) {
    return "alta";
  }
  if (deadlineStatus === DEADLINE_STATUS.APPROACHING) {
    return "media";
  }
  return "baixa";
}

function shouldPatientEnterReminderQueue(patient, nextExamRow, today, filters = null) {
  if (isMessagingBlockedByGestationalBase(patient) || !nextExamRow) {
    return false;
  }

  if (isOperationallyScheduled(patient, nextExamRow)) {
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

function inferStage(patient, patientExams, latestMessage, nextExamRow) {
  const currentStage = patient.stage || "contato_pendente";

  if (patient.status === "encerrada") {
    return currentStage === "follow_up" ? "follow_up" : "contato_pendente";
  }

  if (patient.gestationalReviewRequired) {
    return "contato_pendente";
  }

  const nextExam = buildNextExam(patientExams);
  if (!nextExam.code) {
    return currentStage === "follow_up" ? "follow_up" : "contato_pendente";
  }

  if (patientExams.some((exam) => exam.status === "agendado" && exam.completedDate == null)) {
    return "agendada";
  }

  const latestMessageDate = latestMessage?.sentAt || latestMessage?.createdAt || null;
  const latestRelevantContactDate = [latestMessageDate, nextExamRow?.lastContactedAt]
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const pendingMessageReply = Boolean(
    latestMessage?.deliveryStatus === "enviada" &&
    latestMessage?.responseStatus !== "respondida" &&
    latestMessageDate
  );
  const pendingManualFollowUp = Boolean(nextExamRow?.lastContactedAt && !pendingMessageReply);

  if ((pendingMessageReply || pendingManualFollowUp) && latestRelevantContactDate && addDays(latestRelevantContactDate, 2) <= todayIso()) {
    return "follow_up";
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
  const nextPendingExamRow = findOperationalExamRow(patientExams, { nextExam });
  const nextExamSuggestedMessage = snapshot.gestationalBaseRequiresManualReview
    ? null
    : buildOperationalSuggestedMessage(
        nextPendingExamRow?.defaultMessage,
        {
          ...patient,
          gestationalAgeLabel: formatGestationalAgeLabel(snapshot),
          estimatedDueDate: snapshot.dpp ? formatDatePtBr(snapshot.dpp) : ""
        },
        nextPendingExamRow,
        `Ola, ${patient.name}. Aqui e da clinica obstetrica. Podemos ajudar com o agendamento do seu exame?`,
        nextExam.deadlineStatus
      );
  const messagePriority = getOperationalMessagePriority(nextExam.deadlineStatus);
  const normalizedStage = inferStage(
    {
      ...patient,
      gestationalWeeks: snapshot.currentGestationalWeeks,
      gestationalReviewRequired: snapshot.gestationalBaseRequiresManualReview
    },
    patientExams,
    latestMessage,
    nextPendingExamRow
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
    priorityScore: messagePriority.score,
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

  const [columns, patients] = await Promise.all([
    listKanbanColumnsRows(),
    listPatientsCore()
  ]);

  const visibleStageIds = new Set(KANBAN_STAGES.map((stage) => stage.id));

  return columns
    .filter((stage) => visibleStageIds.has(stage.id))
    .map((stage) => ({
    ...stage,
    isSystem: Boolean(stage.isSystem),
    patients: sortPatientsByPriority(patients.filter((patient) => patient.stage === stage.id))
  }));
}

export async function getDashboardDataCore(inputFilters = {}) {

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
    const examsWithinWeek = new Set(
      patients
        .filter((patient) => {
          const idealDate = patient.nextExam?.idealDate || null;
          return Boolean(idealDate && idealDate >= today && idealDate <= endOfWeek);
        })
        .map((patient) => patient.id)
    ).size;
    const pendingExamCounts = new Map();
  const contactsRegisteredToday = filteredMovementRows.filter(
    (movement) => movement.actionType === "contato_realizado" && movement.createdAt === today
  ).length;
  const appointmentsConfirmedToday = filteredMovementRows.filter(
    (movement) => movement.actionType === "exame_agendado" && movement.createdAt === today
  ).length;
  const patientsToContactToday = sortPatientsByPriority(
    patients.filter((patient) => {
      const nextExamRow = (patientExamsMap.get(patient.id) ?? []).find((exam) => exam.code === patient.nextExam.code);
      return shouldPatientEnterReminderQueue(patient, nextExamRow, today);
    })
  );
  const patientsAwaitingScheduling = patients.filter((patient) => ["mensagem_enviada", "follow_up"].includes(String(patient.stage || ""))).length;
  const scheduledPatients = patients.filter((patient) => String(patient.stage || "") === "agendada").length;
  const patientsByPriority = [
    { priority: "alta", label: "Alta prioridade", total: 0 },
    { priority: "media", label: "Media prioridade", total: 0 },
    { priority: "baixa", label: "Baixa prioridade", total: 0 }
  ];

  patients.forEach((patient) => {
    const bucket = getDashboardPriorityBucket(patient);
    const priorityItem = patientsByPriority.find((item) => item.priority === bucket);
    if (priorityItem) {
      priorityItem.total += 1;
    }
  });

  const patientsByStage = KANBAN_STAGES.map((stage) => ({
    stage: stage.id,
    stageTitle: stage.title,
    total: patients.filter((patient) => patient.stage === stage.id).length
  }));

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
      patientsAwaitingScheduling,
        scheduledPatients,
        examsThisWeek: examsWithinWeek,
        contactsRegisteredToday,
        appointmentsConfirmedToday,
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
    },
    breakdowns: {
      patientsByStage,
      patientsByPriority
    }
  };
}

export async function getReportsDataCore(inputFilters = {}) {

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

  const [
    usersResult,
    unitsResult,
    physiciansResult,
    examConfigsResult,
    examInferenceRulesResult,
    messageTemplatesResult,
    messageDeliveryLogsResult,
    recentAuditLogsResult
  ] = await Promise.allSettled([
    listAdminUsersRows(),
    listClinicUnitsRows(),
    listPhysiciansRows(),
    listExamConfigsCore(),
    listExamInferenceRuleRows(),
    listMessageTemplateRows(),
    listMessageDeliveryLogRows(),
    listRecentAuditLogRows(40)
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
  if (recentAuditLogsResult.status === "rejected") {
    console.error("[admin] Falha ao carregar auditoria recente.", recentAuditLogsResult.reason);
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
  const recentAuditLogs = recentAuditLogsResult.status === "fulfilled" ? recentAuditLogsResult.value : [];

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
    recentAuditLogs: recentAuditLogs.map((log) => ({
      ...log,
      details: parseJsonOrNull(log.detailsJson)
    })),
    messagingConfig: getMessagingRuntimeConfig()
  };
}

export async function getPatientDetailsCore(patientId) {

  const patient = (await listPatientsCore()).find((item) => item.id === patientId);
  if (!patient) {
    return null;
  }

  const [allExamRows, messages, movements, auditLogs] = await Promise.all([
    listPatientExamRows(),
    listMessageHistoryRowsByPatient(patientId),
    listMovementRowsByPatient(patientId),
    listAuditRowsByPatient(patientId, 50)
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
      metadata: parseJsonOrNull(movement.metadataJson)
    })),
    auditLogs: auditLogs.map((log) => ({
      ...log,
      details: parseJsonOrNull(log.detailsJson)
    }))
  };
}

export async function createPatientCore(input) {

  const automaticExamModels = await listAutomaticExamModels();
  validatePatientInput(input, automaticExamModels.map((exam) => exam.code));

  const now = todayIso();
  const actorUserId = await resolveActorUserId(input.actorUserId);
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

  const exam = await getPatientExamRow(patientId, examId);
  if (!exam) {
    throw new Error("Exame da paciente nao encontrado.");
  }

  const nextStatus = String(input.status || "").trim();
  const completedOutsideClinic = nextStatus === "realizado" && Boolean(input.completedOutsideClinic);
  const scheduledDate = input.scheduledDate || null;
  const scheduledTime = input.scheduledTime || null;
  const completedDate = completedOutsideClinic ? null : input.completedDate || null;
  const actorUserId = await resolveActorUserId(input.actorUserId);
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

  const items = detectionResults
    .filter((result) => !result.shospSchedule?.scheduledDate)
    .filter(({ patient, nextExamRow }) => !isOperationallyScheduled(patient, nextExamRow))
    .map(({ patient, nextExamRow }) => {
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

export async function getRemindersCountCore() {

  return {
    count: (await getRemindersCenterDataCore()).items.length
  };
}

export async function updateReminderStatusCore(patientId, examPatientId, action) {

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
    const actorUserId = await resolveActorUserId(null);
    await updatePatientExamRecord(patientId, examPatientId, {
      scheduledDate: exam.scheduledDate ?? now,
      scheduledTime: exam.scheduledTime ?? "09:00",
      schedulingNotes: exam.schedulingNotes ?? null,
      scheduledByUserId: exam.scheduledByUserId ?? actorUserId,
      lastContactedAt: exam.lastContactedAt ?? null,
      reminderSnoozedUntil: exam.reminderSnoozedUntil ?? null,
      completedDate: exam.completedDate ?? null,
      completedByUserId: exam.completedByUserId ?? null,
      completedOutsideClinic: Boolean(exam.completedOutsideClinic),
      status: "agendado",
      updatedAt: now
    });
    await updatePatientStage(patientId, "agendada", now);
    console.info("[reminders] Paciente marcada como agendada na fila operacional.", {
      patientId,
      examPatientId,
      actorUserId
    });
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
        const nextPendingExam = findOperationalExamRow(patientExamsMap.get(patient.id) ?? [], patient);
        if (!shouldPatientEnterReminderQueue(patient, nextPendingExam, todayIso())) {
          return null;
        }
        const latestMessage = latestMessagesMap.get(patient.id) ?? null;
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
          examPatientId: nextPendingExam?.id ?? null,
          examModelId: nextPendingExam?.examModelId ?? null,
          whatsappUrl: `https://wa.me/${toWhatsAppPhone(patient.phone)}?text=${encodeURIComponent(suggestedMessage)}`,
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
      .filter(Boolean)
  );
}

export async function createMessageCore(input) {

  const now = todayIso();
  const actorUserId = await resolveActorUserId(input.actorUserId);
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
    createdByUserId: actorUserId,
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
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getMessageRow(messageId);
}

export async function updateMessageStatusCore(messageId, input) {

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

  const [units, physicians] = await Promise.all([listClinicUnitsRows(), listPhysiciansRows()]);
  return {
    units: units.filter((unit) => Boolean(unit.active)).map((unit) => ({ ...unit, active: Boolean(unit.active) })),
    physicians: physicians.filter((physician) => Boolean(physician.active)).map((physician) => ({ ...physician, active: Boolean(physician.active) }))
  };
}

export async function listExamConfigsCore() {

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

function getLastCompletedClinicExamForReviewCore(patientExams) {
  return [...patientExams]
    .filter((exam) => exam.completedDate && exam.status === "realizado" && !exam.completedOutsideClinic)
    .sort((left, right) => String(right.completedDate).localeCompare(String(left.completedDate)))[0] ?? null;
}

async function rebuildPatientExamScheduleCore(patientId, snapshot, lastCompletedExamCode = "") {
  const automaticExamModels = await listAutomaticExamModels();
  const currentExamRows = buildPatientExamsMap(await listPatientExamRows()).get(patientId) ?? [];
  const preservedState = new Map(currentExamRows.map((exam) => [exam.examModelId, exam]));
  const rebuiltExamRows = buildExamScheduleRows(patientId, automaticExamModels, snapshot, preservedState, lastCompletedExamCode);
  await replacePatientExams(patientId, rebuiltExamRows, todayIso());
}

export async function listGestationalBaseReviewsCore() {
  const patientExamsMap = buildPatientExamsMap(await listPatientExamRows());

  return (await listPatientsCore())
    .filter((patient) => patient.gestationalReviewRequired || patient.stage === "revisao_base_gestacional")
    .map((patient) => {
      const patientExams = patientExamsMap.get(patient.id) ?? [];
      const lastExam = getLastCompletedClinicExamForReviewCore(patientExams);

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

export async function confirmGestationalBaseEstimateCore(patientId, actorUserId = 1) {
  const patient = (await listPatientsBaseRows()).find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const patientExams = buildPatientExamsMap(await listPatientExamRows()).get(patientId) ?? [];
  const snapshot = resolvePregnancySnapshot(patient, todayIso(), { patientExams });
  if (!snapshot.dpp || snapshot.gestationalBaseSource === "revisao_manual") {
    throw new Error("Nao existe estimativa segura para confirmar.");
  }

  const now = todayIso();
  const payload = getGestationalStoragePayload({ ...snapshot, gestationalBaseRequiresManualReview: false }, now);

  await updatePatientRecord(patientId, buildPatientUpdatePayload(patient, { ...payload, updatedAt: now }));
  await rebuildPatientExamScheduleCore(patientId, { ...snapshot, gestationalBaseRequiresManualReview: false });
  await updatePatientStage(patientId, "contato_pendente", now);
  await insertMovementRecord({
    patientId,
    fromStage: patient.stage,
    toStage: "contato_pendente",
    actionType: "confirmacao_base_gestacional",
    description: "Estimativa da base gestacional confirmada manualmente pela equipe.",
    metadataJson: JSON.stringify({ source: snapshot.gestationalBaseSource, confidence: snapshot.gestationalBaseConfidence }),
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

export async function editGestationalBaseManuallyCore(patientId, input) {
  const patient = (await listPatientsBaseRows()).find((item) => item.id === patientId);
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

  await updatePatientRecord(patientId, buildPatientUpdatePayload(patient, { ...payload, updatedAt: now }));
  await rebuildPatientExamScheduleCore(patientId, snapshot);
  await updatePatientStage(patientId, "contato_pendente", now);
  await insertMovementRecord({
    patientId,
    fromStage: patient.stage,
    toStage: "contato_pendente",
    actionType: "edicao_base_gestacional",
    description: "Base gestacional ajustada manualmente pela equipe.",
    metadataJson: JSON.stringify({ gestationalWeeks, gestationalDays }),
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

export async function discardGestationalBaseEstimateCore(patientId, actorUserId = 1) {
  const patient = (await listPatientsBaseRows()).find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const now = todayIso();
  await updatePatientRecord(patientId, buildPatientUpdatePayload(patient, {
    dum: null,
    dpp: null,
    currentGestationalWeeks: null,
    currentGestationalDays: null,
    gestationalBaseDate: null,
    gestationalBaseSource: "revisao_manual",
    gestationalBaseConfidence: "insuficiente",
    gestationalBaseIsEstimated: 1,
    gestationalReviewRequired: 1,
    updatedAt: now
  }));
  await updatePatientStage(patientId, "revisao_base_gestacional", now);
  await insertMovementRecord({
    patientId,
    fromStage: patient.stage,
    toStage: "revisao_base_gestacional",
    actionType: "descarte_estimativa_gestacional",
    description: "Estimativa da base gestacional descartada. Paciente mantida em revisao manual.",
    metadataJson: JSON.stringify({ previousSource: patient.gestationalBaseSource || null }),
    createdByUserId: actorUserId,
    createdAt: now
  });

  return getPatientDetailsCore(patientId);
}

export async function deletePatientCore(patientId) {

  const patient = (await listPatientsBaseRows()).find((item) => item.id === patientId);
  if (!patient) {
    throw new Error("Paciente nao encontrada.");
  }

  const runtime = await getDatabaseRuntime();
  await runtime.query("DELETE FROM patients WHERE id = $1", [patientId]);
  return {
    success: true,
    deletedPatient: {
      id: patient.id,
      name: patient.name,
      phone: patient.phone
    }
  };
}

export async function deletePatientsByCreatedRangeCore(input = {}) {

  const range = resolvePatientCleanupRange(input);
  const actorUserId = input.actorUserId ? Number(input.actorUserId) : null;
  const runtime = await getDatabaseRuntime();
  const patientRowsResult = range.dateFrom && range.dateTo
    ? await runtime.query(`
        SELECT id, name
        FROM patients
        WHERE created_at >= $1 AND created_at <= $2
        ORDER BY created_at, id
      `, [range.dateFrom, range.dateTo])
    : await runtime.query(`
        SELECT id, name
        FROM patients
        ORDER BY created_at, id
      `);

  const patientRows = patientRowsResult.rows;
  if (!patientRows.length) {
    return {
      success: true,
      range,
      deleted: { patients: 0, exams: 0, messages: 0, movements: 0, messageLogs: 0 }
    };
  }

  const patientIds = patientRows.map((patient) => patient.id);
  const deletedCounts = await runtime.query(`
    SELECT
      (SELECT COUNT(*)::int FROM exames_paciente WHERE patient_id = ANY($1::int[])) AS exams,
      (SELECT COUNT(*)::int FROM mensagens WHERE patient_id = ANY($1::int[])) AS messages,
      (SELECT COUNT(*)::int FROM historico_de_movimentacoes WHERE patient_id = ANY($1::int[])) AS movements,
      (SELECT COUNT(*)::int FROM message_delivery_logs WHERE patient_id = ANY($1::int[])) AS "messageLogs"
  `, [patientIds]);

  const deleted = {
    patients: patientRows.length,
    exams: Number(deletedCounts.rows[0]?.exams || 0),
    messages: Number(deletedCounts.rows[0]?.messages || 0),
    movements: Number(deletedCounts.rows[0]?.movements || 0),
    messageLogs: Number(deletedCounts.rows[0]?.messageLogs || 0)
  };

  await runtime.query("DELETE FROM patients WHERE id = ANY($1::int[])", [patientIds]);

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

  return { success: true, range, deleted };
}

async function getNextUserIdCore(client) {
  const result = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM users");
  return Number(result.rows[0]?.next_id || 1);
}

async function fetchAdminUserCoreById(runtime, userId) {
  const result = await runtime.query(`
    SELECT
      id,
      name,
      email,
      role,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM users
    WHERE id = $1
    LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
}

async function fetchClinicUnitCoreById(runtime, unitId) {
  const result = await runtime.query(`
    SELECT
      id,
      name,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM clinic_units
    WHERE id = $1
    LIMIT 1
  `, [unitId]);
  return result.rows[0] || null;
}

async function fetchPhysicianCoreById(runtime, physicianId) {
  const result = await runtime.query(`
    SELECT
      physicians.id,
      physicians.name,
      physicians.clinic_unit_id AS "clinicUnitId",
      clinic_units.name AS "clinicUnitName",
      physicians.active,
      physicians.created_at AS "createdAt",
      physicians.updated_at AS "updatedAt"
    FROM physicians
    LEFT JOIN clinic_units ON clinic_units.id = physicians.clinic_unit_id
    WHERE physicians.id = $1
    LIMIT 1
  `, [physicianId]);
  return result.rows[0] || null;
}

async function fetchExamConfigCoreById(runtime, examId) {
  const result = await runtime.query(`
    SELECT
      id,
      code,
      name,
      start_week AS "startWeek",
      end_week AS "endWeek",
      target_week AS "targetWeek",
      reminder_days_before_1 AS "reminderDaysBefore1",
      reminder_days_before_2 AS "reminderDaysBefore2",
      default_message AS "defaultMessage",
      required,
      flow_type AS "flowType",
      active,
      sort_order AS "sortOrder"
    FROM exames_modelo
    WHERE id = $1
    LIMIT 1
  `, [examId]);
  return result.rows[0] || null;
}

async function fetchExamInferenceRuleCoreById(runtime, ruleId) {
  const result = await runtime.query(`
    SELECT
      rule.id,
      rule.exam_model_id AS "examModelId",
      exam.name AS "examName",
      exam.code AS "examCode",
      rule.typical_start_week AS "typicalStartWeek",
      rule.typical_end_week AS "typicalEndWeek",
      rule.reference_week AS "referenceWeek",
      rule.uncertainty_margin_weeks AS "uncertaintyMarginWeeks",
      rule.allow_automatic_inference AS "allowAutomaticInference",
      rule.active,
      rule.created_at AS "createdAt",
      rule.updated_at AS "updatedAt"
    FROM regras_inferencia_gestacional rule
    INNER JOIN exames_modelo exam ON exam.id = rule.exam_model_id
    WHERE rule.id = $1
    LIMIT 1
  `, [ruleId]);
  return result.rows[0] || null;
}

async function createAutomaticExamForEligiblePatientsCore(examConfig, createdAt = todayIso()) {
  if (examConfig.flowType !== "automatico" || !examConfig.active) {
    return;
  }

  const runtime = await getDatabaseRuntime();
  const existingExamRows = await runtime.query(
    "SELECT patient_id AS \"patientId\" FROM exames_paciente WHERE exam_model_id = $1",
    [examConfig.id]
  );
  const existingExamByPatient = new Set(existingExamRows.rows.map((row) => row.patientId));
  const patients = await listPatientsBaseRows();

  for (const patient of patients) {
    if (existingExamByPatient.has(patient.id)) {
      continue;
    }

    const snapshot = resolvePregnancySnapshot(patient, createdAt);
    if (!snapshot.dum) {
      continue;
    }

    const schedule = calculateExamScheduleDates({
      dum: snapshot.dum,
      targetWeek: examConfig.targetWeek,
      reminderDaysBefore1: examConfig.reminderDaysBefore1,
      reminderDaysBefore2: examConfig.reminderDaysBefore2
    });

    await runtime.query(`
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
      VALUES ($1, $2, $3, $4, $5, 'pendente', $6, $7)
    `, [
      patient.id,
      examConfig.id,
      schedule.predictedDate,
      schedule.reminderDate1,
      schedule.reminderDate2,
      createdAt,
      createdAt
    ]);
  }
}

export async function createAdminUserCore(input) {

  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const role = String(input.role || "recepcao").trim().toLowerCase();
  const active = input.active !== false;

  if (!name) throw new Error("Informe o nome do usuario.");
  if (!email || !email.includes("@")) throw new Error("Informe um e-mail valido.");
  if (password.length < 4) throw new Error("A senha precisa ter pelo menos 4 caracteres.");
  if (!["admin", "recepcao", "atendimento"].includes(role)) throw new Error("Perfil de usuario invalido.");

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe um usuario com este e-mail.");
  }

  const now = todayIso();
  await runtime.transaction(async (client) => {
    const userId = await getNextUserIdCore(client);
    await client.query(`
      INSERT INTO users (id, name, email, password, role, active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [userId, name, email, hashPassword(password), role, active, now, now]);
  });

  const createdUser = await runtime.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email]);
  return fetchAdminUserCoreById(runtime, Number(createdUser.rows[0]?.id));
}

export async function updateAdminUserCore(userId, input) {

  const currentUser = (await listAdminUsersRows()).find((user) => user.id === userId);
  if (!currentUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const role = String(input.role || "recepcao").trim().toLowerCase();
  const active = Boolean(input.active);
  const password = String(input.password || "");

  if (!name) throw new Error("Informe o nome do usuario.");
  if (!email || !email.includes("@")) throw new Error("Informe um e-mail valido.");
  if (!["admin", "recepcao", "atendimento"].includes(role)) throw new Error("Perfil de usuario invalido.");

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1", [email, userId]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe outro usuario com este e-mail.");
  }

  await runtime.query(`
    UPDATE users
    SET
      name = $1,
      email = $2,
      password = COALESCE($3, password),
      role = $4,
      active = $5,
      updated_at = $6
    WHERE id = $7
  `, [name, email, password ? hashPassword(password) : null, role, active, todayIso(), userId]);

  return fetchAdminUserCoreById(runtime, userId);
}

export async function deleteAdminUserCore(userId) {

  const runtime = await getDatabaseRuntime();
  const currentUserResult = await runtime.query("SELECT id, role FROM users WHERE id = $1 LIMIT 1", [userId]);
  const currentUser = currentUserResult.rows[0];
  if (!currentUser) {
    throw new Error("Usuario nao encontrado.");
  }

  const adminCountResult = await runtime.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND active = TRUE");
  if (currentUser.role === "admin" && Number(adminCountResult.rows[0]?.count || 0) <= 1) {
    throw new Error("Nao e possivel excluir o ultimo administrador ativo.");
  }

  const usageResult = await runtime.query(`
    SELECT
      (
        (SELECT COUNT(*) FROM patients WHERE created_by_user_id = $1) +
        (SELECT COUNT(*) FROM mensagens WHERE created_by_user_id = $1) +
        (SELECT COUNT(*) FROM historico_de_movimentacoes WHERE created_by_user_id = $1) +
        (SELECT COUNT(*) FROM exames_paciente WHERE scheduled_by_user_id = $1 OR completed_by_user_id = $1)
      )::int AS count
  `, [userId]);
  if (Number(usageResult.rows[0]?.count || 0) > 0) {
    throw new Error("Este usuario ja possui historico no sistema. Desative o usuario em vez de excluir.");
  }

  await runtime.query("DELETE FROM users WHERE id = $1", [userId]);
  return { success: true };
}

export async function createClinicUnitCore(input) {

  const name = String(input.name || "").trim();
  const active = input.active !== false;
  if (!name) {
    throw new Error("Informe o nome da unidade.");
  }

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM clinic_units WHERE lower(name) = lower($1) LIMIT 1", [name]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe uma unidade com este nome.");
  }

  const result = await runtime.query(`
    INSERT INTO clinic_units (name, active, created_at, updated_at)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [name, active, todayIso(), todayIso()]);

  return fetchClinicUnitCoreById(runtime, Number(result.rows[0]?.id));
}

export async function updateClinicUnitCore(unitId, input) {

  const currentUnit = (await listClinicUnitsRows()).find((unit) => unit.id === unitId);
  if (!currentUnit) {
    throw new Error("Unidade nao encontrada.");
  }

  const name = String(input.name || "").trim();
  const active = Boolean(input.active);
  if (!name) {
    throw new Error("Informe o nome da unidade.");
  }

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM clinic_units WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1", [name, unitId]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe outra unidade com este nome.");
  }

  const now = todayIso();
  await runtime.transaction(async (client) => {
    await client.query("UPDATE clinic_units SET name = $1, active = $2, updated_at = $3 WHERE id = $4", [name, active, now, unitId]);
    await client.query("UPDATE patients SET clinic_unit = $1, updated_at = $2 WHERE clinic_unit = $3", [name, now, currentUnit.name]);
  });

  return fetchClinicUnitCoreById(runtime, unitId);
}

export async function deleteClinicUnitCore(unitId) {

  const currentUnit = (await listClinicUnitsRows()).find((unit) => unit.id === unitId);
  if (!currentUnit) {
    throw new Error("Unidade nao encontrada.");
  }

  const runtime = await getDatabaseRuntime();
  const now = todayIso();
  await runtime.transaction(async (client) => {
    await client.query("UPDATE physicians SET clinic_unit_id = NULL, updated_at = $1 WHERE clinic_unit_id = $2", [now, unitId]);
    await client.query("UPDATE patients SET clinic_unit = NULL, updated_at = $1 WHERE clinic_unit = $2", [now, currentUnit.name]);
    await client.query("DELETE FROM clinic_units WHERE id = $1", [unitId]);
  });

  return { success: true };
}

export async function createPhysicianCore(input) {

  const name = String(input.name || "").trim();
  const clinicUnitId = input.clinicUnitId ? Number(input.clinicUnitId) : null;
  const active = input.active !== false;
  if (!name) {
    throw new Error("Informe o nome do medico.");
  }

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM physicians WHERE lower(name) = lower($1) LIMIT 1", [name]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe um medico com este nome.");
  }
  if (clinicUnitId) {
    const unit = await runtime.query("SELECT id FROM clinic_units WHERE id = $1 LIMIT 1", [clinicUnitId]);
    if (!unit.rows[0]) {
      throw new Error("Selecione uma unidade valida para o medico.");
    }
  }

  const result = await runtime.query(`
    INSERT INTO physicians (name, clinic_unit_id, active, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [name, clinicUnitId, active, todayIso(), todayIso()]);

  return fetchPhysicianCoreById(runtime, Number(result.rows[0]?.id));
}

export async function updatePhysicianCore(physicianId, input) {

  const currentPhysician = (await listPhysiciansRows()).find((physician) => physician.id === physicianId);
  if (!currentPhysician) {
    throw new Error("Medico nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const clinicUnitId = input.clinicUnitId ? Number(input.clinicUnitId) : null;
  const active = Boolean(input.active);
  if (!name) {
    throw new Error("Informe o nome do medico.");
  }

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM physicians WHERE lower(name) = lower($1) AND id <> $2 LIMIT 1", [name, physicianId]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe outro medico com este nome.");
  }
  if (clinicUnitId) {
    const unit = await runtime.query("SELECT id FROM clinic_units WHERE id = $1 LIMIT 1", [clinicUnitId]);
    if (!unit.rows[0]) {
      throw new Error("Selecione uma unidade valida para o medico.");
    }
  }

  const now = todayIso();
  await runtime.transaction(async (client) => {
    await client.query(
      "UPDATE physicians SET name = $1, clinic_unit_id = $2, active = $3, updated_at = $4 WHERE id = $5",
      [name, clinicUnitId, active, now, physicianId]
    );
    await client.query("UPDATE patients SET physician_name = $1, updated_at = $2 WHERE physician_name = $3", [name, now, currentPhysician.name]);
  });

  return fetchPhysicianCoreById(runtime, physicianId);
}

export async function deletePhysicianCore(physicianId) {

  const currentPhysician = (await listPhysiciansRows()).find((physician) => physician.id === physicianId);
  if (!currentPhysician) {
    throw new Error("Medico nao encontrado.");
  }

  const runtime = await getDatabaseRuntime();
  const now = todayIso();
  await runtime.transaction(async (client) => {
    await client.query("UPDATE patients SET physician_name = NULL, updated_at = $1 WHERE physician_name = $2", [now, currentPhysician.name]);
    await client.query("DELETE FROM physicians WHERE id = $1", [physicianId]);
  });

  return { success: true };
}

export async function createExamConfigCore(input) {

  const code = normalizeExamCode(input.code || input.name);
  validateExamConfigInput({ ...input, code });

  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM exames_modelo WHERE code = $1 LIMIT 1", [code]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe um exame com este codigo.");
  }

  const existingConfigs = await listExamConfigRows();
  const sortOrder = Number(input.sortOrder || (existingConfigs.length + 1));
  const now = todayIso();
  const result = await runtime.query(`
    INSERT INTO exames_modelo (
      code, name, start_week, end_week, target_week, reminder_days_before_1, reminder_days_before_2,
      default_message, required, flow_type, active, sort_order, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id
  `, [
    code,
    String(input.name || "").trim(),
    Number(input.startWeek),
    Number(input.endWeek),
    Number(input.targetWeek),
    Number(input.reminderDaysBefore1 ?? 10),
    Number(input.reminderDaysBefore2 ?? 2),
    String(input.defaultMessage || "").trim(),
    Boolean(input.required),
    input.flowType ?? "automatico",
    Boolean(input.active),
    sortOrder,
    now,
    now
  ]);

  const examId = Number(result.rows[0]?.id);
  await runtime.query(`
    INSERT INTO regras_inferencia_gestacional (
      exam_model_id, typical_start_week, typical_end_week, reference_week,
      uncertainty_margin_weeks, allow_automatic_inference, active, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    examId,
    Number(input.startWeek),
    Number(input.endWeek),
    Number(input.targetWeek),
    input.flowType === "avulso" ? 2 : 1,
    input.flowType !== "avulso",
    input.flowType !== "avulso",
    now,
    now
  ]);

  await createAutomaticExamForEligiblePatientsCore({
    id: examId,
    code,
    name: String(input.name || "").trim(),
    startWeek: Number(input.startWeek),
    endWeek: Number(input.endWeek),
    targetWeek: Number(input.targetWeek),
      reminderDaysBefore1: Number(input.reminderDaysBefore1 ?? 10),
    reminderDaysBefore2: Number(input.reminderDaysBefore2 ?? 2),
    defaultMessage: String(input.defaultMessage || "").trim(),
    required: Boolean(input.required),
    flowType: input.flowType ?? "automatico",
    active: Boolean(input.active),
    sortOrder
  }, now);

  return fetchExamConfigCoreById(runtime, examId);
}

export async function updateExamConfigCore(id, input) {

  const currentExam = (await listExamConfigRows()).find((item) => item.id === id);
  if (!currentExam) {
    throw new Error("Exame nao encontrado.");
  }

  const code = normalizeExamCode(input.code || currentExam.code);
  validateExamConfigInput({ ...currentExam, ...input, code });
  const runtime = await getDatabaseRuntime();
  const duplicate = await runtime.query("SELECT id FROM exames_modelo WHERE code = $1 AND id <> $2 LIMIT 1", [code, id]);
  if (duplicate.rows[0]) {
    throw new Error("Ja existe outro exame com este codigo.");
  }

  await runtime.query(`
    UPDATE exames_modelo
    SET
      code = $1, name = $2, start_week = $3, end_week = $4, target_week = $5,
      reminder_days_before_1 = $6, reminder_days_before_2 = $7, default_message = $8,
      required = $9, flow_type = $10, active = $11, updated_at = $12
    WHERE id = $13
  `, [
    code,
    String(input.name ?? currentExam.name),
    Number(input.startWeek ?? currentExam.startWeek),
    Number(input.endWeek ?? currentExam.endWeek),
    Number(input.targetWeek ?? currentExam.targetWeek),
    Number(input.reminderDaysBefore1 ?? currentExam.reminderDaysBefore1 ?? 10),
    Number(input.reminderDaysBefore2 ?? currentExam.reminderDaysBefore2 ?? 2),
    String(input.defaultMessage ?? currentExam.defaultMessage ?? ""),
    Boolean(input.required ?? currentExam.required),
    input.flowType ?? currentExam.flowType ?? "automatico",
    Boolean(input.active ?? currentExam.active),
    todayIso(),
    id
  ]);

  return fetchExamConfigCoreById(runtime, id);
}

export async function deleteExamConfigCore(id) {

  const currentExam = (await listExamConfigRows()).find((item) => item.id === id);
  if (!currentExam) {
    throw new Error("Exame nao encontrado.");
  }

  const runtime = await getDatabaseRuntime();
  const usage = await runtime.query("SELECT COUNT(*)::int AS count FROM exames_paciente WHERE exam_model_id = $1", [id]);
  const usageCount = Number(usage.rows[0]?.count || 0);
  if (usageCount > 0) {
    throw new Error(
      `Este exame ja foi vinculado a ${usageCount} paciente(s) e nao pode ser excluido. Para tirar do uso, deixe-o como inativo. Se quiser manter apenas para lancamentos manuais, troque o tipo para avulso/manual.`
    );
  }

  await runtime.query("DELETE FROM exames_modelo WHERE id = $1", [id]);
  return { success: true, deletedExam: { id: currentExam.id, name: currentExam.name } };
}

export async function updateExamInferenceRuleCore(id, input) {

  validateExamInferenceRuleInput(input);
  const runtime = await getDatabaseRuntime();
  const currentRule = await runtime.query("SELECT id FROM regras_inferencia_gestacional WHERE id = $1 LIMIT 1", [id]);
  if (!currentRule.rows[0]) {
    throw new Error("Regra de inferencia nao encontrada.");
  }

  await runtime.query(`
    UPDATE regras_inferencia_gestacional
    SET
      typical_start_week = $1,
      typical_end_week = $2,
      reference_week = $3,
      uncertainty_margin_weeks = $4,
      allow_automatic_inference = $5,
      active = $6,
      updated_at = $7
    WHERE id = $8
  `, [
    Number(input.typicalStartWeek),
    Number(input.typicalEndWeek),
    Number(input.referenceWeek),
    Number(input.uncertaintyMarginWeeks),
    Boolean(input.allowAutomaticInference),
    Boolean(input.active),
    todayIso(),
    id
  ]);

  return fetchExamInferenceRuleCoreById(runtime, id);
}

export async function updateMessageTemplateCore(templateId, input) {

  const currentTemplate = (await listMessageTemplateRows()).find((template) => template.id === templateId);
  if (!currentTemplate) {
    throw new Error("Template nao encontrado.");
  }

  const name = String(input.name || "").trim();
  const content = String(input.content || "").trim();
  const language = String(input.language || "pt_BR").trim();
  const active = input.active !== false;
  if (!name) throw new Error("Informe o nome do template.");
  if (!content) throw new Error("Informe o conteudo do template.");
  if (!language) throw new Error("Informe o idioma do template.");

  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    UPDATE message_templates
    SET name = $1, language = $2, content = $3, active = $4, updated_at = $5
    WHERE id = $6
  `, [name, language, content, active, todayIso(), templateId]);

  return (await listMessageTemplateRows()).find((template) => template.id === templateId) ?? null;
}

export async function createKanbanColumnCore(input) {

  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("Informe o nome da coluna.");
  }

  const baseId = slugifyKanbanTitle(title);
  if (!baseId) {
    throw new Error("Nao foi possivel gerar o identificador da coluna.");
  }

  const runtime = await getDatabaseRuntime();
  let id = baseId;
  let suffix = 2;
  while (true) {
    const existing = await runtime.query("SELECT id FROM kanban_columns WHERE id = $1 LIMIT 1", [id]);
    if (!existing.rows[0]) break;
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  const sortOrderResult = await runtime.query("SELECT COALESCE(MAX(sort_order), 0) AS value FROM kanban_columns");
  const now = todayIso();
  await runtime.query(`
    INSERT INTO kanban_columns (id, title, description, sort_order, is_system, created_at, updated_at)
    VALUES ($1, $2, $3, $4, FALSE, $5, $6)
  `, [id, title, "Coluna personalizada", Number(sortOrderResult.rows[0]?.value || 0) + 1, now, now]);

  return getKanbanDataCore();
}

export async function updateKanbanColumnCore(columnId, input) {

  const currentColumn = (await listKanbanColumnsRows()).find((column) => String(column.id) === String(columnId));
  if (!currentColumn) {
    throw new Error("Coluna nao encontrada.");
  }

  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("Informe o nome da coluna.");
  }

  const runtime = await getDatabaseRuntime();
  await runtime.query("UPDATE kanban_columns SET title = $1, updated_at = $2 WHERE id = $3", [title, todayIso(), columnId]);
  return getKanbanDataCore();
}

export async function deleteKanbanColumnCore(columnId) {

  const currentColumn = (await listKanbanColumnsRows()).find((column) => String(column.id) === String(columnId));
  if (!currentColumn) {
    throw new Error("Coluna nao encontrada.");
  }
  if (currentColumn.isSystem) {
    throw new Error("As colunas padrao do pipeline nao podem ser excluidas.");
  }

  const runtime = await getDatabaseRuntime();
  const patientCount = await runtime.query("SELECT COUNT(*)::int AS count FROM patients WHERE stage = $1", [columnId]);
  if (Number(patientCount.rows[0]?.count || 0) > 0) {
    throw new Error("Esvazie a coluna antes de exclui-la.");
  }

  await runtime.query("DELETE FROM kanban_columns WHERE id = $1", [columnId]);
  return getKanbanDataCore();
}

export async function applyExamProtocolPresetCore(presetId) {

  const preset = listExamProtocolPresets().find((item) => item.id === presetId);
  if (!preset) {
    throw new Error("Protocolo sugerido nao encontrado.");
  }

  const runtime = await getDatabaseRuntime();
  const examConfigs = await listExamConfigRows();
  const now = todayIso();

  await runtime.transaction(async (client) => {
    for (const examConfig of examConfigs) {
      const override = preset.overrides?.[examConfig.code] ?? {};
      await client.query(`
        UPDATE exames_modelo
        SET
          start_week = $1,
          end_week = $2,
          target_week = $3,
          reminder_days_before_1 = $4,
          reminder_days_before_2 = $5,
          updated_at = $6
        WHERE id = $7
      `, [
        override.startWeek ?? examConfig.startWeek,
        override.endWeek ?? examConfig.endWeek,
        override.targetWeek ?? examConfig.targetWeek,
        override.reminderDaysBefore1 ?? examConfig.reminderDaysBefore1,
        override.reminderDaysBefore2 ?? examConfig.reminderDaysBefore2,
        now,
        examConfig.id
      ]);
    }
  });

  return {
    preset,
    examConfigs: (await listExamConfigRows()).map((item) => ({
      ...item,
      active: Boolean(item.active),
      required: Boolean(item.required)
    }))
  };
}
