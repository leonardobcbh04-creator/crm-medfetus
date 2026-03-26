import { addDays, todayIso } from "../../utils/date.js";

let mockFutureScheduleLookupCount = 0;

function isMockFixtureModeEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.SHOSP_MOCK_FIXTURES || "").toLowerCase());
}

function buildMockPatients() {
  if (!isMockFixtureModeEnabled()) {
    return [];
  }

  const today = todayIso();

  return [
    {
      externalPatientId: "shosp-p-1001",
      name: "Amanda Rocha",
      phone: "5511988800111",
      birthDate: "1991-05-14",
      gestationalWeeks: 16,
      gestationalDays: 0,
      gestationalBaseDate: today,
      physicianName: "Dra. Helena Castro",
      clinicUnit: "Unidade Centro",
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente sincronizada do ambiente mock do Shosp.",
      updatedAt: addDays(today, -1)
    },
    {
      externalPatientId: "shosp-p-1002",
      name: "Tatiane Lopes",
      phone: "5511977700222",
      birthDate: "1988-10-22",
      dum: null,
      gestationalWeeks: 22,
      gestationalDays: 0,
      gestationalBaseDate: today,
      physicianName: "Dr. Fabio Mendes",
      clinicUnit: "Unidade Jardins",
      pregnancyType: "Gemelar",
      highRisk: true,
      notes: "Gestacao gemelar com acompanhamento compartilhado no Shosp.",
      updatedAt: today
    },
    {
      externalPatientId: "shosp-p-1003",
      name: "Vanessa Prado",
      phone: "5511966600333",
      birthDate: "1994-01-09",
      gestationalWeeks: 30,
      gestationalDays: 0,
      gestationalBaseDate: today,
      physicianName: "Dra. Renata Moura",
      clinicUnit: "Unidade Moema",
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente do mock com exames de terceiro trimestre.",
      updatedAt: today
    },
    {
      externalPatientId: "shosp-p-1004",
      name: "Patricia Mourao",
      phone: "5511955500444",
      birthDate: "1990-03-21",
      gestationalWeeks: 21,
      gestationalDays: 3,
      gestationalBaseDate: today,
      physicianName: "Dra. Helena Castro",
      clinicUnit: "Unidade Centro",
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente de demonstracao para checagem pontual de agenda futura no Shosp.",
      updatedAt: today
    }
  ];
}

function buildMockAttendances() {
  if (!isMockFixtureModeEnabled()) {
    return [];
  }

  const today = todayIso();

  return [
    {
      externalAttendanceId: "shosp-a-9001",
      externalExamRequestId: "shosp-r-5001",
      externalExamItemId: "shosp-i-7001",
      externalPatientId: "shosp-p-1001",
      examCode: "morfologico_2_trimestre",
      examName: "Morfologico 2 trimestre",
      scheduledDate: addDays(today, 3),
      scheduledTime: "09:30",
      completedDate: null,
      status: "agendado",
      notes: "Agenda importada do mock do Shosp.",
      updatedAt: today
    },
    {
      externalAttendanceId: "shosp-a-9002",
      externalExamRequestId: "shosp-r-5002",
      externalExamItemId: "shosp-i-7002",
      externalPatientId: "shosp-p-1002",
      examCode: "ecocardiograma_fetal",
      examName: "Ecocardiograma fetal",
      scheduledDate: addDays(today, -2),
      scheduledTime: "14:20",
      completedDate: addDays(today, -1),
      status: "realizado",
      notes: "Exame marcado como realizado no sistema mestre.",
      updatedAt: today
    },
    {
      externalAttendanceId: "shosp-a-9003",
      externalExamRequestId: "shosp-r-5003",
      externalExamItemId: "shosp-i-7003",
      externalPatientId: "shosp-p-1003",
      examCode: "morfologico_3_trimestre",
      examName: "Morfologico 3 trimestre",
      scheduledDate: addDays(today, 5),
      scheduledTime: "11:10",
      completedDate: null,
      status: "agendado",
      notes: "Agenda futura vinda do ambiente de homologacao mock.",
      updatedAt: addDays(today, -1)
    }
  ];
}

function buildMockReminderLookupAttendances() {
  if (!isMockFixtureModeEnabled()) {
    return [];
  }

  const today = todayIso();

  return [
    {
      externalAttendanceId: "shosp-a-9010",
      externalExamRequestId: "shosp-r-5010",
      externalExamItemId: "shosp-i-7010",
      externalPatientId: "shosp-p-1004",
      examCode: "exame_obstetrico_inicial",
      examName: "Exame obstetrico inicial",
      scheduledDate: addDays(today, 4),
      scheduledTime: "15:40",
      completedDate: null,
      status: "agendado",
      notes: "Agendamento futuro visivel apenas na consulta pontual do lembrete.",
      updatedAt: today
    }
  ];
}

function filterIncremental(records, updatedSince) {
  if (!updatedSince) {
    return records;
  }

  return records.filter((record) => String(record.updatedAt || "") > updatedSince);
}

export function createShospMockProvider() {
  return {
    async authenticate() {
      return {
        ok: true,
        mode: "mock",
        headers: {
          "x-shosp-mock": "true"
        }
      };
    },
    async fetchPatients({ updatedSince } = {}) {
      return {
        records: filterIncremental(buildMockPatients(), updatedSince),
        nextCursor: todayIso()
      };
    },
    async fetchAttendancesAndExams({ updatedSince } = {}) {
      return {
        records: filterIncremental(buildMockAttendances(), updatedSince),
        nextCursor: todayIso()
      };
    },
    async fetchFutureScheduledExamForPatient({ externalPatientId, examCode } = {}) {
      mockFutureScheduleLookupCount += 1;
      const match = [...buildMockAttendances(), ...buildMockReminderLookupAttendances()].find(
        (item) =>
          item.externalPatientId === externalPatientId &&
          item.examCode === examCode &&
          item.scheduledDate &&
          item.scheduledDate >= todayIso() &&
          item.completedDate == null
      );

      return match || null;
    }
  };
}

export function resetShospMockMetrics() {
  mockFutureScheduleLookupCount = 0;
}

export function getShospMockMetrics() {
  return {
    futureScheduleLookupCount: mockFutureScheduleLookupCount
  };
}
