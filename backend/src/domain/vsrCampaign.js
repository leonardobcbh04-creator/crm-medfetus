import { addDays, daysBetween } from "../utils/date.js";
import { VACCINE_STATUS } from "./vaccines.js";

// Aba "Gestantes (VSR)" da tela Vacinas: gestantes com a VSR pendente entre 28s0d
// e 36s6d. A vacina e oferecida pelo SUS (a MedFetus nao aplica): a mensagem so
// avisa a paciente que ela pode tomar no posto de saude.
export const VSR_WINDOW_START_DAYS = 28 * 7; // 28s0d
export const VSR_WINDOW_END_DAYS = 36 * 7 + 6; // 36s6d

function formatGestationalAge(totalDays) {
  return `${Math.floor(totalDays / 7)}s${totalDays % 7}d`;
}

function vaccineStatus(vaccineRows, code) {
  return vaccineRows.find((row) => row.vaccineCode === code)?.status || VACCINE_STATUS.PENDING;
}

function isActivePatient(patient) {
  return (patient.status || "ativa") === "ativa" && !patient.closedAt;
}

// Mensagem informativa (Eliana). Nao cita o numero da semana nem exames.
export function buildVsrWhatsAppMessage() {
  return [
    "Oi! Tudo bem? 😊\nEu sou a Eliana, faço parte da equipe de vacinas da MedFetus.",
    "Vi que você já está no período recomendado para tomar a vacina contra o VSR (vírus sincicial respiratório) na gestação. Ela passa anticorpos para o bebê e o protege contra a bronquiolite nos primeiros meses de vida. 💚",
    "Essa vacina é oferecida gratuitamente pelo SUS: é só procurar o posto de saúde mais perto de você e levar a sua caderneta da gestante.",
    "Qualquer dúvida, é só me chamar por aqui!"
  ].join("\n\n");
}

// patients: pacientes ja enriquecidas (listPatientsCore). Lista unica, ordenada
// por quem esta mais perto de sair da janela.
export function buildVsrCampaign({ patients, vaccineRowsMap, contactsMap, todayIso }) {
  const items = [];

  for (const patient of patients) {
    if (!isActivePatient(patient) || patient.gestationalReviewRequired || !patient.dum) {
      continue;
    }
    if (vaccineStatus(vaccineRowsMap.get(patient.id) ?? [], "vsr") !== VACCINE_STATUS.PENDING) {
      continue;
    }
    const gestationalDaysToday = daysBetween(patient.dum, todayIso);
    if (gestationalDaysToday < VSR_WINDOW_START_DAYS || gestationalDaysToday > VSR_WINDOW_END_DAYS) {
      continue;
    }

    const contact = contactsMap.get(patient.id) ?? null;
    items.push({
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      gestationalDaysToday,
      gestationalAgeLabel: formatGestationalAge(gestationalDaysToday),
      daysUntilWindowEnd: VSR_WINDOW_END_DAYS - gestationalDaysToday,
      windowEndDate: addDays(patient.dum, VSR_WINDOW_END_DAYS),
      contacted: Boolean(contact),
      contactedAt: contact?.contactedAt ?? null,
      contactedByName: contact?.contactedByName ?? null,
      whatsappMessage: buildVsrWhatsAppMessage()
    });
  }

  items.sort((left, right) =>
    left.daysUntilWindowEnd - right.daysUntilWindowEnd ||
    String(left.patientName).localeCompare(String(right.patientName), "pt-BR")
  );

  return { today: todayIso, items };
}
