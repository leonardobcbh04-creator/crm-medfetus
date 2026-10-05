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

// Mensagem do WhatsApp da campanha dTpa (Eliana). Muda conforme a secao:
// "janela" = ja esta entre 20s0d e 36s6d; "entrando" = completa 20 semanas nos
// proximos 15 dias. Se houver exame agendado, sugere aproveitar a ida a clinica;
// se a gripe estiver pendente, acrescenta o lembrete da gripe.
export function buildDtpaWhatsAppMessage({ nextExam, fluPending, section = "janela" }) {
  const isEntering = section === "entrando";
  const opening = isEntering
    ? "Você está chegando ao período recomendado para tomar a vacina dTpa na gestação, que começa na 20ª semana. Ela protege o bebê contra a coqueluche nos primeiros meses de vida, antes de ele poder receber as próprias vacinas. 💚"
    : "Vi que você entrou no período recomendado para tomar a vacina dTpa na gestação. Ela protege o bebê contra a coqueluche nos primeiros meses de vida, antes de ele poder receber as próprias vacinas. 💚";
  const familyCall = "Aqui na MedFetus aplicamos a dTpa, e vale muito a pena trazer também o pai ou quem vai cuidar do bebê: quando quem convive com ele está vacinado, a proteção fica ainda maior.";
  const examHint = nextExam
    ? ` Se for mais prático, dá para aproveitar a vinda para o exame ${nextExam.name}, no dia ${formatShortDate(nextExam.scheduledDate)}.`
    : "";
  const paragraphs = [
    "Oi! Tudo bem? 😊\nEu sou a Eliana, faço parte da equipe de vacinas da MedFetus.",
    opening,
    `${familyCall}${examHint}`
  ];
  if (fluPending) {
    paragraphs.push("A vacina da gripe também é muito importante na gestação: pode ser tomada em qualquer fase, e dá para fazer as duas no mesmo dia.");
  }
  paragraphs.push(isEntering
    ? "Quer que eu já deixe um horário reservado para vocês?"
    : "Quer que eu veja um horário para vocês?");
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
      whatsappMessage: buildDtpaWhatsAppMessage({ nextExam, fluPending, section: inLookahead ? "entrando" : "janela" })
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
