import { daysBetween } from "../utils/date.js";

// Depois da DPP + 14 dias (42 semanas), considera-se que o parto aconteceu e o
// acompanhamento da gestante e encerrado automaticamente como "Parto realizado".
export const AUTO_CLOSE_DAYS_AFTER_DPP = 14;

// patient: paciente ja enriquecida (dpp calculada pelo sistema).
export function shouldAutoClosePregnancy(patient, todayIso) {
  if ((patient.status || "ativa") !== "ativa" || patient.closedAt) {
    return false;
  }
  if (patient.autoCloseDisabled || patient.gestationalReviewRequired || !patient.dpp) {
    return false;
  }
  return daysBetween(patient.dpp, todayIso) > AUTO_CLOSE_DAYS_AFTER_DPP;
}

export function hasPassedAutoCloseDate(patient, todayIso) {
  return Boolean(patient.dpp) && daysBetween(patient.dpp, todayIso) > AUTO_CLOSE_DAYS_AFTER_DPP;
}
