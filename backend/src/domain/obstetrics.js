import { addDays, daysBetween, formatDatePtBr, todayIso } from "../utils/date.js";

export const DEADLINE_STATUS = {
  WITHIN_WINDOW: "dentro_do_prazo",
  APPROACHING: "aproximando",
  PENDING: "pendente",
  OVERDUE: "atrasado",
  COMPLETED: "realizado",
  SUPERSEDED: "superado"
};

const DEADLINE_LABELS = {
  [DEADLINE_STATUS.WITHIN_WINDOW]: "Dentro do prazo",
  [DEADLINE_STATUS.APPROACHING]: "Aproximando",
  [DEADLINE_STATUS.PENDING]: "Pendente",
  [DEADLINE_STATUS.OVERDUE]: "Atrasado",
  [DEADLINE_STATUS.COMPLETED]: "Realizado",
  [DEADLINE_STATUS.SUPERSEDED]: "Superado"
};

export const GESTATIONAL_BASE_SOURCE = {
  MANUAL_REPORTED: "idade_gestacional_informada",
  SHOSP_STRUCTURED: "shosp_estruturado",
  CLINIC_EXAM_ESTIMATE: "exame_clinica_estimado",
  MANUAL_REVIEW: "revisao_manual"
};

export const GESTATIONAL_BASE_CONFIDENCE = {
  HIGH: "alta",
  MEDIUM: "media",
  LOW: "baixa",
  INSUFFICIENT: "insuficiente"
};

const GESTATIONAL_BASE_SOURCE_LABELS = {
  [GESTATIONAL_BASE_SOURCE.MANUAL_REPORTED]: "Idade gestacional informada",
  [GESTATIONAL_BASE_SOURCE.SHOSP_STRUCTURED]: "Dados estruturados do Shosp",
  [GESTATIONAL_BASE_SOURCE.CLINIC_EXAM_ESTIMATE]: "Estimativa por exame da clinica",
  [GESTATIONAL_BASE_SOURCE.MANUAL_REVIEW]: "Revisao manual necessaria"
};

const GESTATIONAL_BASE_CONFIDENCE_LABELS = {
  [GESTATIONAL_BASE_CONFIDENCE.HIGH]: "Alta confianca",
  [GESTATIONAL_BASE_CONFIDENCE.MEDIUM]: "Confianca moderada",
  [GESTATIONAL_BASE_CONFIDENCE.LOW]: "Baixa confianca",
  [GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT]: "Sem confianca suficiente"
};

function normalizeReferenceDate(referenceDate) {
  return referenceDate || todayIso();
}

function buildGestationalMeta(base) {
  return {
    gestationalBaseSource: base.source,
    gestationalBaseSourceLabel: GESTATIONAL_BASE_SOURCE_LABELS[base.source],
    gestationalBaseConfidence: base.confidence,
    gestationalBaseConfidenceLabel: GESTATIONAL_BASE_CONFIDENCE_LABELS[base.confidence],
    gestationalBaseIsEstimated: base.isEstimated,
    gestationalBaseRequiresManualReview: base.requiresManualReview,
    gestationalBaseExplanation: base.explanation,
    gestationalBaseHasConflict: Boolean(base.hasConflict),
    gestationalBaseConflictNote: base.conflictNote || null,
    gestationalBaseResolvedByExam: base.exam
      ? {
          examModelId: base.exam.examModelId,
          code: base.exam.code,
          name: base.exam.name,
          completedDate: base.exam.completedDate
        }
      : null
  };
}

function findLastCompletedClinicExam(patientExams = []) {
  return [...patientExams]
    .filter(
      (exam) =>
        exam.completedDate &&
        exam.status === "realizado" &&
        !exam.completedOutsideClinic &&
        Boolean(exam.allowAutomaticInference) &&
        Boolean(exam.inferenceRuleActive) &&
        exam.inferenceReferenceWeek != null
    )
    .sort((left, right) => right.completedDate.localeCompare(left.completedDate))[0] ?? null;
}

function findLastCompletedClinicExamForReview(patientExams = []) {
  return [...patientExams]
    .filter((exam) => exam.completedDate && exam.status === "realizado" && !exam.completedOutsideClinic)
    .sort((left, right) => right.completedDate.localeCompare(left.completedDate))[0] ?? null;
}

function hasStructuredShospGestationalData(patient) {
  return (
    Boolean(patient.importedFromShosp || patient.shospPatientId) &&
    Boolean(patient.gestationalBaseDate) &&
    patient.gestationalWeeks != null
  );
}

function hasManualReportedGestationalData(patient) {
  return (
    patient.gestationalBaseSource === GESTATIONAL_BASE_SOURCE.MANUAL_REPORTED &&
    Boolean(patient.gestationalBaseDate) &&
    patient.gestationalWeeks != null
  );
}

// Prioridade da base gestacional:
// 1. Idade gestacional informada pela equipe medica
// 2. Dados estruturados trazidos do Shosp
// 3. Ultimo exame obstetrico realizado na clinica como estimativa
// 4. Revisao manual quando nao houver base segura
//
// As opcoes 2 e 3 continuam sendo tratadas como estimativas operacionais.
// Elas ajudam o CRM a organizar a esteira, mas nao substituem certeza clinica.
export function resolveGestationalBase(patient, referenceDate = todayIso(), patientExams = []) {
  const baseDate = normalizeReferenceDate(referenceDate);
  const validClinicEstimateExam = findLastCompletedClinicExam(patientExams);
  const reviewClinicExam = findLastCompletedClinicExamForReview(patientExams);

  if (hasManualReportedGestationalData(patient)) {
    const gestationalWeeks = Number(patient.gestationalWeeks || 0);
    const gestationalDays = Number(patient.gestationalDays || 0);
    const totalStructuredDays = Math.max(0, gestationalWeeks * 7 + gestationalDays);
    return {
      source: GESTATIONAL_BASE_SOURCE.MANUAL_REPORTED,
      confidence: GESTATIONAL_BASE_CONFIDENCE.HIGH,
      isEstimated: false,
      requiresManualReview: false,
      resolvedDum: addDays(patient.gestationalBaseDate, totalStructuredDays * -1),
      explanation: "Base gestacional definida pela idade gestacional informada pela equipe medica."
    };
  }

  if (patient.dum && !patient.gestationalBaseDate && patient.gestationalWeeks == null) {
    return {
      source: GESTATIONAL_BASE_SOURCE.MANUAL_REVIEW,
      confidence: GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT,
      isEstimated: true,
      requiresManualReview: true,
      resolvedDum: null,
      explanation: "Existe DUM historica cadastrada, mas ela nao e mais considerada base segura. Revisao manual necessaria."
    };
  }

  if (hasStructuredShospGestationalData(patient)) {
    const gestationalWeeks = Number(patient.gestationalWeeks || 0);
    const gestationalDays = Number(patient.gestationalDays || 0);
    const totalStructuredDays = Math.max(0, gestationalWeeks * 7 + gestationalDays);
    const resolvedDum = addDays(patient.gestationalBaseDate, totalStructuredDays * -1);
    let hasConflict = false;
    let conflictNote = null;

    if (validClinicEstimateExam) {
      const clinicEstimatedDum = addDays(
        validClinicEstimateExam.completedDate,
        Number(validClinicEstimateExam.inferenceReferenceWeek) * -7
      );
      const differenceInDays = Math.abs(daysBetween(clinicEstimatedDum, resolvedDum));

      if (differenceInDays >= 7) {
        hasConflict = true;
        conflictNote = "Conflito entre dado estruturado importado e estimativa calculada a partir do ultimo exame da clinica.";
      }
    }

    return {
      source: GESTATIONAL_BASE_SOURCE.SHOSP_STRUCTURED,
      confidence: hasConflict ? GESTATIONAL_BASE_CONFIDENCE.LOW : GESTATIONAL_BASE_CONFIDENCE.MEDIUM,
      isEstimated: true,
      requiresManualReview: hasConflict,
      resolvedDum,
      explanation: hasConflict
        ? "Base sugerida pelo Shosp com conflito em relacao ao calculo local. Revisao manual necessaria."
        : "Base estimada a partir de idade gestacional estruturada vinda do Shosp.",
      hasConflict,
      conflictNote
    };
  }

  if (validClinicEstimateExam) {
    const uncertaintyMarginWeeks = Number(validClinicEstimateExam.inferenceUncertaintyMarginWeeks ?? 0);
    const confidence =
      uncertaintyMarginWeeks <= 1
        ? GESTATIONAL_BASE_CONFIDENCE.MEDIUM
        : uncertaintyMarginWeeks <= 2
          ? GESTATIONAL_BASE_CONFIDENCE.LOW
          : GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT;
    const requiresManualReview = confidence !== GESTATIONAL_BASE_CONFIDENCE.MEDIUM;

    return {
      source: GESTATIONAL_BASE_SOURCE.CLINIC_EXAM_ESTIMATE,
      confidence,
      isEstimated: true,
      requiresManualReview,
      resolvedDum: addDays(
        validClinicEstimateExam.completedDate,
        Number(validClinicEstimateExam.inferenceReferenceWeek) * -7
      ),
      explanation: requiresManualReview
        ? "Base estimada pelo ultimo exame da clinica, mas com baixa confianca. A automacao fica bloqueada ate revisao manual."
        : "Base estimada pelo ultimo exame obstetrico realizado na clinica. Usar apenas como referencia operacional.",
      exam: validClinicEstimateExam
    };
  }

  if (reviewClinicExam) {
    return {
      source: GESTATIONAL_BASE_SOURCE.MANUAL_REVIEW,
      confidence: GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT,
      isEstimated: true,
      requiresManualReview: true,
      resolvedDum: null,
      explanation: "Existe exame realizado na clinica, mas ele nao e compativel com inferencia automatica segura.",
      exam: reviewClinicExam
    };
  }

  return {
    source: GESTATIONAL_BASE_SOURCE.MANUAL_REVIEW,
    confidence: GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT,
    isEstimated: true,
    requiresManualReview: true,
    resolvedDum: null,
    explanation: "Nao foi possivel estimar a base gestacional com seguranca. Revisao manual necessaria."
  };
}

// Resolve a base gestacional da paciente e retorna idade gestacional atual
// no formato usado pelo sistema: semanas completas, dias restantes e DPP.
export function resolvePregnancySnapshot(
  patient,
  referenceDate = todayIso(),
  options = {}
) {
  const baseDate = normalizeReferenceDate(referenceDate);
  const gestationalBase = resolveGestationalBase(patient, baseDate, options.patientExams || []);
  const metadata = buildGestationalMeta(gestationalBase);

  if (!gestationalBase.resolvedDum) {
    return {
      dum: null,
      dpp: null,
      totalGestationalDays: null,
      currentGestationalWeeks: null,
      currentGestationalDays: null,
      ...metadata
    };
  }

  const resolvedDum = gestationalBase.resolvedDum;
  const totalDays = Math.max(0, daysBetween(resolvedDum, baseDate));

  return {
    dum: resolvedDum,
    dpp: addDays(resolvedDum, 280),
    totalGestationalDays: totalDays,
    currentGestationalWeeks: Math.floor(totalDays / 7),
    currentGestationalDays: totalDays % 7,
    ...metadata
  };
}

// Converte a configuracao do exame em datas concretas a partir da base gestacional resolvida.
export function calculateExamScheduleDates(
  { dum, targetWeek, reminderDaysBefore1 = 10, reminderDaysBefore2 = 2 },
  referenceDate = todayIso()
) {
  const baseDate = dum || null;
  if (!baseDate) {
    return {
      predictedDate: null,
      reminderDate1: null,
      reminderDate2: null
    };
  }
  const predictedDate = addDays(baseDate, targetWeek * 7);

  return {
    predictedDate,
    reminderDate1: addDays(predictedDate, reminderDaysBefore1 * -1),
    reminderDate2: addDays(predictedDate, reminderDaysBefore2 * -1)
  };
}

// Regras de prazo:
// - atrasado: passou da data ideal e ainda nao foi realizado
// - pendente: chegou no lembrete final ou no dia ideal
// - aproximando: entrou na janela do primeiro lembrete
// - dentro_do_prazo: ainda esta confortavel dentro da janela
export function calculateDeadlineStatus(
  { predictedDate, reminderDate1, reminderDate2, completedDate, completedOutsideClinic, status },
  referenceDate = todayIso()
) {
  const baseDate = normalizeReferenceDate(referenceDate);

  if (status === "realizado" || completedDate || completedOutsideClinic) {
    return {
      key: DEADLINE_STATUS.COMPLETED,
      label: DEADLINE_LABELS[DEADLINE_STATUS.COMPLETED],
      daysUntilIdealDate: daysBetween(baseDate, predictedDate)
    };
  }

  const daysUntilIdealDate = daysBetween(baseDate, predictedDate);

  if (daysUntilIdealDate < 0) {
    return {
      key: DEADLINE_STATUS.OVERDUE,
      label: DEADLINE_LABELS[DEADLINE_STATUS.OVERDUE],
      daysUntilIdealDate
    };
  }

  if (baseDate >= predictedDate || (reminderDate2 && baseDate >= reminderDate2)) {
    return {
      key: DEADLINE_STATUS.PENDING,
      label: DEADLINE_LABELS[DEADLINE_STATUS.PENDING],
      daysUntilIdealDate
    };
  }

  if (reminderDate1 && baseDate >= reminderDate1) {
    return {
      key: DEADLINE_STATUS.APPROACHING,
      label: DEADLINE_LABELS[DEADLINE_STATUS.APPROACHING],
      daysUntilIdealDate
    };
  }

  return {
    key: DEADLINE_STATUS.WITHIN_WINDOW,
    label: DEADLINE_LABELS[DEADLINE_STATUS.WITHIN_WINDOW],
    daysUntilIdealDate
  };
}

function buildAlertLevel(deadlineStatus, daysUntilIdealDate) {
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) return "urgente";
  if (deadlineStatus === DEADLINE_STATUS.PENDING) return daysUntilIdealDate === 0 ? "hoje" : "urgente";
  if (deadlineStatus === DEADLINE_STATUS.APPROACHING) return "proximo";
  return "ok";
}

function buildAlertLabel(deadlineStatus) {
  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) return "Atrasado";
  if (deadlineStatus === DEADLINE_STATUS.PENDING) return "Pendente";
  if (deadlineStatus === DEADLINE_STATUS.APPROACHING) return "Aproximando";
  if (deadlineStatus === DEADLINE_STATUS.COMPLETED) return "Realizado";
  if (deadlineStatus === DEADLINE_STATUS.SUPERSEDED) return "Superado";
  return "Dentro do prazo";
}

function resolveTimelineStatus(exam, deadlineStatus) {
  if (exam.status === "realizado") {
    return exam.completedOutsideClinic ? "historico_anterior_confirmado" : "realizado";
  }

  if (deadlineStatus === DEADLINE_STATUS.SUPERSEDED) {
    return "superado";
  }

  if (deadlineStatus === DEADLINE_STATUS.OVERDUE) {
    return "atrasado";
  }

  return "pendente";
}

function calculateIdealWindowRange(exam) {
  if (!exam?.predictedDate) {
    return { idealWindowStartDate: null, idealWindowEndDate: null };
  }

  const targetWeek = Number(exam.targetWeek);
  const startWeek = Number(exam.startWeek);
  const endWeek = Number(exam.endWeek);

  if (Number.isNaN(targetWeek) || Number.isNaN(startWeek) || Number.isNaN(endWeek)) {
    return { idealWindowStartDate: null, idealWindowEndDate: null };
  }

  return {
    idealWindowStartDate: addDays(exam.predictedDate, (startWeek - targetWeek) * 7),
    idealWindowEndDate: addDays(exam.predictedDate, (endWeek - targetWeek) * 7)
  };
}

// Analisa todos os exames previstos de uma paciente e devolve:
// - quais ja deveriam ter sido feitos
// - qual e o proximo exame
// - o status operacional do prazo de cada um
export function analyzePatientExamTimeline(patientExamRows, referenceDate = todayIso()) {
  const sortedExams = [...patientExamRows]
    .sort((left, right) => {
      const leftSort = Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER);
      const rightSort = Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER);
      if (leftSort !== rightSort) {
        return leftSort - rightSort;
      }

      return String(left.predictedDate || "").localeCompare(String(right.predictedDate || ""));
    })
    .map((exam) => ({
      ...exam,
      ...calculateIdealWindowRange(exam)
    }));

  const highestCompletedAutomaticSortOrder = sortedExams.reduce((highest, exam) => {
    if (exam.flowType !== "automatico" || exam.status !== "realizado") {
      return highest;
    }

    return Math.max(highest, Number(exam.sortOrder ?? -1));
  }, -1);

  const assessedExams = sortedExams.map((exam) => {
      const deadline = calculateDeadlineStatus(exam, referenceDate);
      const examSortOrder = Number(exam.sortOrder ?? Number.MAX_SAFE_INTEGER);
      const hasLaterOperationalStage = sortedExams.some((candidate) => {
        if (candidate.flowType !== "automatico") {
          return false;
        }

        const candidateSortOrder = Number(candidate.sortOrder ?? Number.MAX_SAFE_INTEGER);
        if (candidateSortOrder <= examSortOrder) {
          return false;
        }

        if (candidate.status === "realizado" || candidate.status === "agendado") {
          return true;
        }

        return Boolean(candidate.idealWindowStartDate && referenceDate >= candidate.idealWindowStartDate);
      });

      const isSuperseded = (
        exam.status !== "realizado" &&
        exam.flowType === "automatico" &&
        (
          examSortOrder < highestCompletedAutomaticSortOrder ||
          (deadline.key === DEADLINE_STATUS.OVERDUE && hasLaterOperationalStage)
        )
      );

      const effectiveDeadlineStatus = isSuperseded ? DEADLINE_STATUS.SUPERSEDED : deadline.key;
      const effectiveDeadlineLabel = isSuperseded ? DEADLINE_LABELS[DEADLINE_STATUS.SUPERSEDED] : deadline.label;
      const timelineStatus = resolveTimelineStatus(exam, effectiveDeadlineStatus);

      return {
        ...exam,
        deadlineStatus: effectiveDeadlineStatus,
        deadlineStatusLabel: effectiveDeadlineLabel,
        timelineStatus,
        daysUntilIdealDate: deadline.daysUntilIdealDate,
        shouldHaveBeenDone: timelineStatus === "atrasado",
        showOperationalAlert: timelineStatus === "atrasado",
        alertLevel: buildAlertLevel(effectiveDeadlineStatus, deadline.daysUntilIdealDate),
        alertLabel: buildAlertLabel(effectiveDeadlineStatus),
        isSuperseded,
        idealDateLabel: formatDatePtBr(exam.predictedDate)
      };
    });

  const overdueExam = assessedExams.find(
    (exam) => exam.status !== "realizado" && exam.deadlineStatus === DEADLINE_STATUS.OVERDUE
  ) ?? null;

  const nextExam = assessedExams.find(
    (exam) => exam.status !== "realizado" && exam.deadlineStatus !== DEADLINE_STATUS.SUPERSEDED
  ) ?? null;

  return {
    assessedExams,
    overdueExam,
    nextExam
  };
}
