export const VACCINE_STATUS = {
  PENDING: "pendente",
  DONE: "tomada",
  NOT_APPLICABLE: "nao_se_aplica"
};

const VACCINE_STATUS_LABELS = {
  [VACCINE_STATUS.PENDING]: "Pendente",
  [VACCINE_STATUS.DONE]: "Tomada",
  [VACCINE_STATUS.NOT_APPLICABLE]: "Nao se aplica"
};

// Regras clinicas (ver conversa com a clinica):
// - Gripe: sem janela especifica, vale a gestacao inteira.
// - dTpa: janela ideal da 20a a 36a semana (mas ainda vale a pena depois disso se a
//   paciente perdeu a janela ideal, ate o parto).
// - VSR (Abrysvo): janela da 28a a 36a semana. E so um AVISO — o SUS oferece a
//   vacina, entao a clinica nao tenta agendar/aplicar, so orienta a gestante.
export const VACCINE_DEFINITIONS = [
  {
    code: "gripe",
    name: "Vacina da gripe (influenza)",
    startWeek: 0,
    endWeek: null,
    idealStartWeek: null,
    idealEndWeek: null,
    actionable: true,
    reminderPhrase: "a vacina da gripe (pode tomar em qualquer fase da gestacao)"
  },
  {
    code: "dtpa",
    name: "Vacina dTpa (difteria, tetano e coqueluche)",
    startWeek: 20,
    endWeek: null,
    idealStartWeek: 20,
    idealEndWeek: 36,
    actionable: true,
    reminderPhrase: "a vacina dTpa (a partir da 20ª semana de gestação)"
  },
  {
    code: "vsr",
    name: "Vacina VSR (Abrysvo)",
    startWeek: 28,
    endWeek: 36,
    idealStartWeek: 28,
    idealEndWeek: 36,
    actionable: false,
    reminderPhrase: "a vacina do VSR, disponivel pelo SUS (a clinica nao aplica, apenas orienta)"
  }
];

export function getVaccineDefinition(vaccineCode) {
  return VACCINE_DEFINITIONS.find((definition) => definition.code === vaccineCode) || null;
}

export function getVaccineStatusLabel(status) {
  return VACCINE_STATUS_LABELS[status] || VACCINE_STATUS_LABELS[VACCINE_STATUS.PENDING];
}

function resolveCurrentGestationalWeeksDecimal(patient) {
  if (patient.gestationalWeeks == null) {
    return null;
  }
  return Number(patient.gestationalWeeks) + Number(patient.gestationalDays || 0) / 7;
}

function isWindowOpen(definition, currentWeeksDecimal) {
  if (currentWeeksDecimal == null) {
    return false;
  }
  if (currentWeeksDecimal < definition.startWeek) {
    return false;
  }
  if (definition.endWeek != null && currentWeeksDecimal > definition.endWeek) {
    return false;
  }
  return true;
}

function isWithinIdealWindow(definition, currentWeeksDecimal) {
  if (definition.idealStartWeek == null || definition.idealEndWeek == null) {
    return isWindowOpen(definition, currentWeeksDecimal);
  }
  if (currentWeeksDecimal == null) {
    return false;
  }
  return currentWeeksDecimal >= definition.idealStartWeek && currentWeeksDecimal <= definition.idealEndWeek;
}

// Recebe a paciente ja enriquecida (com gestationalWeeks/gestationalDays atuais) e as
// linhas de status de vacina salvas no banco, e devolve a situacao de cada vacina.
export function resolvePatientVaccineNeeds(patient, vaccineStatusRows = []) {
  const statusByCode = new Map(vaccineStatusRows.map((row) => [row.vaccineCode, row.status]));
  const currentWeeksDecimal = resolveCurrentGestationalWeeksDecimal(patient);
  const gestationalBaseBlocked = Boolean(patient.gestationalReviewRequired);

  return VACCINE_DEFINITIONS.map((definition) => {
    const status = statusByCode.get(definition.code) || VACCINE_STATUS.PENDING;
    const windowOpen = !gestationalBaseBlocked && isWindowOpen(definition, currentWeeksDecimal);
    const isInIdealWindow = !gestationalBaseBlocked && isWithinIdealWindow(definition, currentWeeksDecimal);
    const needsAttention = status === VACCINE_STATUS.PENDING && windowOpen;

    return {
      code: definition.code,
      name: definition.name,
      status,
      statusLabel: getVaccineStatusLabel(status),
      actionable: definition.actionable,
      windowOpen,
      isInIdealWindow,
      needsAttention,
      reminderPhrase: definition.reminderPhrase
    };
  });
}

// Monta o trecho a acrescentar na mensagem de lembrete do proximo exame, juntando
// gripe/dTpa quando a clinica pode oferecer, e um aviso a parte para o VSR (SUS).
export function buildVaccineReminderBlurb(vaccineNeeds) {
  const pendingActionable = vaccineNeeds.filter((item) => item.needsAttention && item.actionable);
  const pendingInformational = vaccineNeeds.filter((item) => item.needsAttention && !item.actionable);

  const parts = [];
  if (pendingActionable.length) {
    const phrases = pendingActionable.map((item) => item.reminderPhrase);
    const joined = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} e ${phrases.at(-1)}` : phrases[0];
    parts.push(`Aproveite tambem para colocar em dia ${joined}.`);
  }
  if (pendingInformational.length) {
    const phrases = pendingInformational.map((item) => item.reminderPhrase);
    parts.push(`Lembrete: oriente a gestante sobre ${phrases.join(" e ")}.`);
  }

  return parts.join(" ");
}
