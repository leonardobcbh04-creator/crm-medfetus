import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePatientExamTimeline,
  calculateDeadlineStatus,
  calculateExamScheduleDates,
  DEADLINE_STATUS,
  resolvePregnancySnapshot
} from "./obstetrics.js";

test("calcula idade gestacional atual e DPP a partir da DUM", () => {
  const snapshot = resolvePregnancySnapshot({ dum: "2026-01-01" }, "2026-02-26");

  assert.equal(snapshot.dum, "2026-01-01");
  assert.equal(snapshot.currentGestationalWeeks, 8);
  assert.equal(snapshot.currentGestationalDays, 0);
  assert.equal(snapshot.dpp, "2026-10-08");
});

test("calcula datas do exame e lembretes a partir da configuracao", () => {
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
