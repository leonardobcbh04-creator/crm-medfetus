import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePatientExamTimeline,
  calculateDeadlineStatus,
  calculateExamScheduleDates,
  DEADLINE_STATUS,
  GESTATIONAL_BASE_CONFIDENCE,
  GESTATIONAL_BASE_SOURCE,
  resolvePregnancySnapshot
} from "./obstetrics.js";

test("calcula idade gestacional atual e DPP a partir da idade gestacional informada", () => {
  const snapshot = resolvePregnancySnapshot(
    {
      gestationalWeeks: 6,
      gestationalDays: 0,
      gestationalBaseDate: "2026-02-12",
      gestationalBaseSource: GESTATIONAL_BASE_SOURCE.MANUAL_REPORTED
    },
    "2026-02-26"
  );

  assert.equal(snapshot.dum, "2026-01-01");
  assert.equal(snapshot.currentGestationalWeeks, 8);
  assert.equal(snapshot.currentGestationalDays, 0);
  assert.equal(snapshot.dpp, "2026-10-08");
  assert.equal(snapshot.gestationalBaseSource, GESTATIONAL_BASE_SOURCE.MANUAL_REPORTED);
  assert.equal(snapshot.gestationalBaseConfidence, GESTATIONAL_BASE_CONFIDENCE.HIGH);
  assert.equal(snapshot.gestationalBaseIsEstimated, false);
});

test("usa dados estruturados do Shosp quando nao existe idade gestacional informada", () => {
  const snapshot = resolvePregnancySnapshot(
    {
      dum: null,
      gestationalWeeks: 12,
      gestationalDays: 3,
      gestationalBaseDate: "2026-03-01",
      importedFromShosp: true
    },
    "2026-03-15"
  );

  assert.equal(snapshot.gestationalBaseSource, GESTATIONAL_BASE_SOURCE.SHOSP_STRUCTURED);
  assert.equal(snapshot.gestationalBaseConfidence, GESTATIONAL_BASE_CONFIDENCE.MEDIUM);
  assert.equal(snapshot.gestationalBaseIsEstimated, true);
  assert.equal(snapshot.currentGestationalWeeks, 14);
  assert.equal(snapshot.currentGestationalDays, 3);
});

test("usa o ultimo exame da clinica como base estimada quando nao ha idade gestacional informada nem dados estruturados", () => {
  const snapshot = resolvePregnancySnapshot(
    {
      dum: null,
      gestationalWeeks: null,
      gestationalDays: null,
      gestationalBaseDate: null
    },
    "2026-03-20",
    {
      patientExams: [
        {
          examModelId: 7,
          code: "morfologico_1_trimestre",
          name: "Morfologico 1o trimestre",
          completedDate: "2026-03-10",
          completedOutsideClinic: false,
          status: "realizado",
          inferenceReferenceWeek: 12,
          inferenceUncertaintyMarginWeeks: 1,
          allowAutomaticInference: true,
          inferenceRuleActive: true
        }
      ]
    }
  );

  assert.equal(snapshot.gestationalBaseSource, GESTATIONAL_BASE_SOURCE.CLINIC_EXAM_ESTIMATE);
  assert.equal(snapshot.gestationalBaseConfidence, GESTATIONAL_BASE_CONFIDENCE.MEDIUM);
  assert.equal(snapshot.gestationalBaseIsEstimated, true);
  assert.equal(snapshot.dum, "2025-12-16");
  assert.equal(snapshot.currentGestationalWeeks, 13);
  assert.equal(snapshot.currentGestationalDays, 3);
});

test("marca revisao manual quando a regra do ultimo exame deixa a estimativa com baixa confianca", () => {
  const snapshot = resolvePregnancySnapshot(
    {
      dum: null,
      gestationalWeeks: null,
      gestationalDays: null,
      gestationalBaseDate: null
    },
    "2026-03-20",
    {
      patientExams: [
        {
          examModelId: 8,
          code: "doppler_obstetrico",
          name: "Doppler obstetrico",
          completedDate: "2026-03-10",
          completedOutsideClinic: false,
          status: "realizado",
          inferenceReferenceWeek: 28,
          inferenceUncertaintyMarginWeeks: 2,
          allowAutomaticInference: true,
          inferenceRuleActive: true
        }
      ]
    }
  );

  assert.equal(snapshot.gestationalBaseSource, GESTATIONAL_BASE_SOURCE.CLINIC_EXAM_ESTIMATE);
  assert.equal(snapshot.gestationalBaseConfidence, GESTATIONAL_BASE_CONFIDENCE.LOW);
  assert.equal(snapshot.gestationalBaseRequiresManualReview, true);
  assert.equal(snapshot.dum, "2025-08-26");
});

test("marca revisao manual quando nao encontra base gestacional segura", () => {
  const snapshot = resolvePregnancySnapshot(
    {
      dum: null,
      gestationalWeeks: null,
      gestationalDays: null,
      gestationalBaseDate: null,
      importedFromShosp: false
    },
    "2026-03-20"
  );

  assert.equal(snapshot.gestationalBaseSource, GESTATIONAL_BASE_SOURCE.MANUAL_REVIEW);
  assert.equal(snapshot.gestationalBaseConfidence, GESTATIONAL_BASE_CONFIDENCE.INSUFFICIENT);
  assert.equal(snapshot.gestationalBaseRequiresManualReview, true);
  assert.equal(snapshot.dum, null);
  assert.equal(snapshot.dpp, null);
});

test("calcula datas do exame e lembretes a partir da base gestacional calculada", () => {
  const schedule = calculateExamScheduleDates(
    {
      dum: "2026-01-01",
      targetWeek: 12,
      reminderDaysBefore1: 7,
      reminderDaysBefore2: 2
    },
    "2026-02-26"
  );

  assert.deepEqual(schedule, {
    predictedDate: "2026-03-26",
    reminderDate1: "2026-03-19",
    reminderDate2: "2026-03-24"
  });
});

test("classifica corretamente os status de prazo do exame", () => {
  const baseExam = {
    predictedDate: "2026-04-01",
    reminderDate1: "2026-03-20",
    reminderDate2: "2026-03-29",
    completedDate: null
  };

  assert.equal(calculateDeadlineStatus(baseExam, "2026-03-10").key, DEADLINE_STATUS.WITHIN_WINDOW);
  assert.equal(calculateDeadlineStatus(baseExam, "2026-03-21").key, DEADLINE_STATUS.APPROACHING);
  assert.equal(calculateDeadlineStatus(baseExam, "2026-03-30").key, DEADLINE_STATUS.PENDING);
  assert.equal(calculateDeadlineStatus(baseExam, "2026-04-02").key, DEADLINE_STATUS.OVERDUE);
});

test("identifica exame atrasado e proximo exame da paciente", () => {
  const timeline = analyzePatientExamTimeline(
    [
      {
        examModelId: 1,
        code: "translucencia_nucal",
        name: "Translucencia nucal",
        predictedDate: "2026-03-01",
        reminderDate1: "2026-02-20",
        reminderDate2: "2026-02-27",
        completedDate: null,
        status: "pendente"
      },
      {
        examModelId: 2,
        code: "morfologico_2_trimestre",
        name: "Morfologico do 2o trimestre",
        predictedDate: "2026-05-01",
        reminderDate1: "2026-04-20",
        reminderDate2: "2026-04-28",
        completedDate: null,
        status: "pendente"
      }
    ],
    "2026-03-10"
  );

  assert.equal(timeline.overdueExam?.code, "translucencia_nucal");
  assert.equal(timeline.nextExam?.code, "translucencia_nucal");
  assert.equal(timeline.assessedExams[0].deadlineStatus, DEADLINE_STATUS.OVERDUE);
  assert.equal(timeline.assessedExams[1].deadlineStatus, DEADLINE_STATUS.WITHIN_WINDOW);
});

test("marca exames anteriores como superados quando a paciente ja avancou para uma etapa posterior", () => {
  const timeline = analyzePatientExamTimeline(
    [
      {
        examModelId: 1,
        code: "exame_obstetrico_inicial",
        name: "Exame obstetrico inicial",
        flowType: "automatico",
        sortOrder: 1,
        startWeek: 5,
        endWeek: 10.86,
        targetWeek: 8,
        predictedDate: "2026-02-12",
        reminderDate1: "2026-02-05",
        reminderDate2: "2026-02-10",
        completedDate: null,
        status: "pendente"
      },
      {
        examModelId: 2,
        code: "morfologico_1_trimestre",
        name: "Morfologico 1o trimestre",
        flowType: "automatico",
        sortOrder: 2,
        startWeek: 11,
        endWeek: 14,
        targetWeek: 12,
        predictedDate: "2026-03-12",
        reminderDate1: "2026-03-05",
        reminderDate2: "2026-03-10",
        completedDate: null,
        status: "pendente"
      },
      {
        examModelId: 4,
        code: "morfologico_2_trimestre",
        name: "Morfologico 2o trimestre",
        flowType: "automatico",
        sortOrder: 4,
        startWeek: 20,
        endWeek: 24,
        targetWeek: 22,
        predictedDate: "2026-05-21",
        reminderDate1: "2026-05-14",
        reminderDate2: "2026-05-19",
        completedDate: "2026-05-21",
        status: "realizado"
      },
      {
        examModelId: 5,
        code: "ecocardiograma_fetal",
        name: "Ecocardiograma fetal",
        flowType: "automatico",
        sortOrder: 5,
        startWeek: 24,
        endWeek: 28,
        targetWeek: 26,
        predictedDate: "2026-06-18",
        reminderDate1: "2026-06-11",
        reminderDate2: "2026-06-16",
        completedDate: null,
        status: "pendente"
      }
    ],
    "2026-05-25"
  );

  assert.equal(timeline.assessedExams[0].deadlineStatus, DEADLINE_STATUS.SUPERSEDED);
  assert.equal(timeline.assessedExams[1].deadlineStatus, DEADLINE_STATUS.SUPERSEDED);
  assert.equal(timeline.assessedExams[0].shouldHaveBeenDone, false);
  assert.equal(timeline.nextExam?.code, "ecocardiograma_fetal");
  assert.equal(timeline.overdueExam, null);
});
