import { addDays, daysBetween } from "../utils/date.js";
import { VACCINE_STATUS } from "./vaccines.js";

// Tela "Vacinas": campanha ativa da dTpa. Todas as contas sao feitas em dias, a
// partir da DUM que o sistema ja calcula para a paciente (a mesma base da IG
// exibida no resto do sistema), com "hoje" no fuso America/Sao_Paulo.
export const DTPA_WINDOW_START_DAYS = 20 * 7; // 20s0d
export const DTPA_WINDOW_END_DAYS = 36 * 7 + 6; // 36s6d
export const DTPA_LOOKAHEAD_DAYS = 15;

function formatShortDate(isoDate) {
  const [, month, day] = String(isoDate).split("-");
  return `${day}/${month}`;
}

function formatGestationalAge(totalDays) {
  return `${Math.floor(totalDays / 7)}s${totalDays % 7}d`;
}

function vaccineStatus(vaccineRows, code) {
  return vaccineRows.find((row) => row.vaccineCode === code)?.status || VACCINE_STATUS.PENDING;
}

// Proximo exame FUTURO agendado (data de hoje em diante), o mais proximo.
export function findNextScheduledExam(patientExams, todayIso) {
  return [...patientExams]
    .filter((exam) => exam.status === "agendado" && exam.scheduledDate && exam.scheduledDate >= todayIso)
    .sort((left, right) =>
      String(left.scheduledDate).localeCompare(String(right.scheduledDate)) ||
      String(left.scheduledTime || "").localeCompare(String(right.scheduledTime || ""))
    )[0] ?? null;
}

export function buildDtpaWhatsAppMessage({ nextExam, fluPending }) {
  const paragraphs = [
    "Oi! Tudo bem? 😊\nEu sou a Eliana, faço parte da equipe de vacinas da MedFetus.",
    "Estou te enviando essa informação sobre a vacina dTpa na gestação, uma vacina importante para ajudar a proteger o bebê nos primeiros meses de vida. 💚",
    nextExam
      ? `Vi que você vai fazer o exame ${nextExam.name} no dia ${formatShortDate(nextExam.scheduledDate)}. Que tal aproveitar a ida à MedFetus e já agendar a vacina para você e, se precisar, para a família também?`
      : "Que tal agendar seu próximo exame e já aproveitar para tomar a vacina? Se precisar, a família também pode se vacinar."
  ];
  if (fluPending) {
    paragraphs.push("Aproveitando: se você ainda não tomou a vacina da gripe, ela pode ser aplicada em qualquer fase da gestação, e dá para fazer as duas no mesmo dia.");
  }
  return paragraphs.join("\n\n");
}

function isActivePatient(patient) {
  return (patient.status || "ativa") === "ativa" && !patient.closedAt;
}

// patients: pacientes ja enriquecidas (listPatientsCore), com dum e
// gestationalReviewRequired calculados. Devolve as duas secoes da tela.
export function buildDtpaCampaign({ patients, patientExamsMap, vaccineRowsMap, contactsMap, todayIso }) {
  const entering = [];
  const eligible = [];

  for (const patient of patients) {
    if (!isActivePatient(patient) || patient.gestationalReviewRequired || !patient.dum) {
      continue;
    }
    const vaccineRows = vaccineRowsMap.get(patient.id) ?? [];
    if (vaccineStatus(vaccineRows, "dtpa") !== VACCINE_STATUS.PENDING) {
      continue;
    }

    const gestationalDaysToday = daysBetween(patient.dum, todayIso);
    const inLookahead = gestationalDaysToday < DTPA_WINDOW_START_DAYS &&
      gestationalDaysToday + DTPA_LOOKAHEAD_DAYS >= DTPA_WINDOW_START_DAYS;
    const inWindow = gestationalDaysToday >= DTPA_WINDOW_START_DAYS && gestationalDaysToday <= DTPA_WINDOW_END_DAYS;
    if (!inLookahead && !inWindow) {
      continue;
    }

    const fluPending = vaccineStatus(vaccineRows, "gripe") === VACCINE_STATUS.PENDING;
    const nextExamRow = findNextScheduledExam(patientExamsMap.get(patient.id) ?? [], todayIso);
    const nextExam = nextExamRow
      ? { id: nextExamRow.id, name: nextExamRow.name, scheduledDate: nextExamRow.scheduledDate, scheduledTime: nextExamRow.scheduledTime ?? null }
      : null;
    const contact = contactsMap.get(patient.id) ?? null;

    const item = {
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      gestationalDaysToday,
      gestationalAgeLabel: formatGestationalAge(gestationalDaysToday),
      fluPending,
      nextExam,
      contacted: Boolean(contact),
      contactedAt: contact?.contactedAt ?? null,
      contactedByName: contact?.contactedByName ?? null,
      whatsappMessage: buildDtpaWhatsAppMessage({ nextExam, fluPending })
    };

    if (inLookahead) {
      const daysUntilWindow = DTPA_WINDOW_START_DAYS - gestationalDaysToday;
      entering.push({ ...item, section: "entrando", daysUntilWindow, windowStartDate: addDays(patient.dum, DTPA_WINDOW_START_DAYS) });
    } else {
      const daysUntilWindowEnd = DTPA_WINDOW_END_DAYS - gestationalDaysToday;
      eligible.push({ ...item, section: "janela", daysUntilWindowEnd, windowEndDate: addDays(patient.dum, DTPA_WINDOW_END_DAYS) });
    }
  }

  const byName = (left, right) => String(left.patientName).localeCompare(String(right.patientName), "pt-BR");
  entering.sort((left, right) => left.daysUntilWindow - right.daysUntilWindow || byName(left, right));
  eligible.sort((left, right) => left.daysUntilWindowEnd - right.daysUntilWindowEnd || byName(left, right));

  return { today: todayIso, entering, eligible };
}
