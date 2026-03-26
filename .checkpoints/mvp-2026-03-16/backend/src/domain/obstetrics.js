import { addDays, daysBetween, formatDatePtBr, todayIso } from "../utils/date.js";

export const DEADLINE_STATUS = {
  WITHIN_WINDOW: "dentro_do_prazo",
  APPROACHING: "aproximando",
  PENDING: "pendente",
  OVERDUE: "atrasado",
  COMPLETED: "realizado"
};

const DEADLINE_LABELS = {
  [DEADLINE_STATUS.WITHIN_WINDOW]: "Dentro do prazo",
  [DEADLINE_STATUS.APPROACHING]: "Aproximando",
  [DEADLINE_STATUS.PENDING]: "Pendente",
  [DEADLINE_STATUS.OVERDUE]: "Atrasado",
  [DEADLINE_STATUS.COMPLETED]: "Realizado"
};

function normalizeReferenceDate(referenceDate) {
  return referenceDate || todayIso();
}

// Resolve a base gestacional da paciente e retorna idade gestacional atual
// no formato usado pelo sistema: semanas completas, dias restantes e DPP.
export function resolvePregnancySnapshot(
  { dum, gestationalWeeks, gestationalDays, gestationalBaseDate },
  referenceDate = todayIso()
) {
  const baseDate = normalizeReferenceDate(referenceDate);
  const resolvedDum =
    dum ??
    addDays(
      gestationalBaseDate || baseDate,
      ((gestationalWeeks ?? 0) * 7 + (gestationalDays ?? 0)) * -1
    );
  const totalDays = Math.max(0, daysBetween(resolvedDum, baseDate));

  return {
    dum: resolvedDum,
    dpp: addDays(resolvedDum, 280),
    totalGestationalDays: totalDays,
    currentGestationalWeeks: Math.floor(totalDays / 7),
    currentGestationalDays: totalDays % 7
  };
}

// Converte a configuracao do exame em datas concretas para a paciente a partir da DUM.
export function calculateExamScheduleDates(
  { dum, targetWeek, reminderDaysBefore1 = 7, reminderDaysBefore2 = 2 },
  referenceDate = todayIso()
) {
  const snapshot = resolvePregnancySnapshot({ dum }, referenceDate);
  const predictedDate = addDays(snapshot.dum, targetWeek * 7);

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
  { predictedDate, reminderDate1, reminderDate2, completedDate },
  referenceDate = todayIso()
) {
  const baseDate = normalizeReferenceDate(referenceDate);

  if (completedDate) {
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
  return "Dentro do prazo";
}

// Analisa todos os exames previstos de uma paciente e devolve:
// - quais ja deveriam ter sido feitos
// - qual e o proximo exame
// - o status operacional do prazo de cada um
export function analyzePatientExamTimeline(patientExamRows, referenceDate = todayIso()) {
  const assessedExams = [...patientExamRows]
    .sort((left, right) => left.predictedDate.localeCompare(right.predictedDate))
    .map((exam) => {
      const deadline = calculateDeadlineStatus(exam, referenceDate);

      return {
        ...exam,
        deadlineStatus: deadline.key,
        deadlineStatusLabel: deadline.label,
        daysUntilIdealDate: deadline.daysUntilIdealDate,
        shouldHaveBeenDone: deadline.key === DEADLINE_STATUS.OVERDUE,
        alertLevel: buildAlertLevel(deadline.key, deadline.daysUntilIdealDate),
        alertLabel: buildAlertLabel(deadline.key),
        idealDateLabel: formatDatePtBr(exam.predictedDate)
      };
    });

  const overdueExam = assessedExams.find(
    (exam) => exam.status !== "realizado" && exam.deadlineStatus === DEADLINE_STATUS.OVERDUE
  ) ?? null;

  const nextExam = assessedExams.find((exam) => exam.status !== "realizado") ?? null;

  return {
    assessedExams,
    overdueExam,
    nextExam
  };
}
