import { addDays, daysBetween } from "../utils/date.js";

// Avisos de vacina do bebe (calendario SBIm, ate 2 anos). A clinica nao acompanha
// o parto, entao a data de nascimento e estimada pela DPP da mae. O aviso de cada
// idade aparece 15 dias antes da data (DPP + idade) e fica ate 30 dias depois dela;
// quando a idade seguinte chega, ela substitui a anterior.
export const BABY_REMINDER_DAYS_BEFORE = 15;
export const BABY_REMINDER_DAYS_AFTER = 30;
export const BABY_MAX_AGE_MONTHS = 24;

export const BABY_VACCINE_AVAILABILITY = {
  CLINIC: "clinica",
  PUBLIC: "posto"
};

export function addMonthsIso(isoDate, months) {
  const [year, month, day] = String(isoDate).slice(0, 10).split("-").map(Number);
  const targetMonthIndex = month - 1 + Number(months);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Dia 31 num mes de 30 dias (ou fevereiro) vira o ultimo dia do mes.
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, lastDay);
  return `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function formatBabyAgeLabel(months) {
  const value = Number(months);
  if (value < 12) {
    return value === 1 ? "1 mês" : `${value} meses`;
  }
  const years = Math.floor(value / 12);
  const rest = value % 12;
  const yearsLabel = years === 1 ? "1 ano" : `${years} anos`;
  if (!rest) {
    return yearsLabel;
  }
  return `${yearsLabel} e ${rest === 1 ? "1 mês" : `${rest} meses`}`;
}

function formatShortDate(isoDate) {
  const [, month, day] = String(isoDate).split("-");
  return `${day}/${month}`;
}

function formatVaccineLine(item) {
  return `• ${item.vaccineName} – ${item.doseLabel}`;
}

export function buildBabyWhatsAppMessage({ ageMonths, clinicItems, publicItems }) {
  const ageLabel = formatBabyAgeLabel(ageMonths);
  const preposition = ageLabel.startsWith("1 ") ? "a" : "aos";
  const paragraphs = [
    "Oi! Tudo bem? 😊\nEu sou a Eliana, faço parte da equipe de vacinas da MedFetus.",
    `Seu bebê está chegando ${preposition} ${ageLabel}, e pelo calendário da Sociedade Brasileira de Imunizações (SBIm) é hora de algumas vacinas importantes nessa fase. 💚`
  ];
  if (clinicItems.length) {
    paragraphs.push(`Aqui na MedFetus aplicamos:\n${clinicItems.map(formatVaccineLine).join("\n")}`);
  }
  if (publicItems.length) {
    const intro = clinicItems.length
      ? (publicItems.length === 1 ? "E esta você consegue gratuitamente no posto de saúde:" : "E estas você consegue gratuitamente no posto de saúde:")
      : (publicItems.length === 1 ? "Esta vacina você consegue gratuitamente no posto de saúde:" : "Estas vacinas você consegue gratuitamente no posto de saúde:");
    paragraphs.push(`${intro}\n${publicItems.map(formatVaccineLine).join("\n")}`);
  }
  paragraphs.push(clinicItems.length
    ? "Quer que eu já veja um horário para vocês?"
    : "Qualquer dúvida, estamos à disposição!");
  return paragraphs.join("\n\n");
}

// Maes encerradas como "Parto realizado" (automatico ou pela equipe) com DPP.
// Perda gestacional e outros motivos nunca entram.
function isEligibleMother(patient) {
  return patient.status === "encerrada" && patient.closureReason === "parto_realizado" && Boolean(patient.dpp);
}

// patients: pacientes ja enriquecidas (dpp calculada). catalog: linhas ativas e
// inativas de vacinas_bebe_catalogo. contactsMap: "patientId:ageMonths" -> contato.
export function buildBabyVaccineReminders({ patients, catalog, contactsMap = new Map(), todayIso }) {
  const activeCatalog = catalog
    .filter((item) => item.active && Number(item.ageMonths) <= BABY_MAX_AGE_MONTHS)
    .sort((left, right) => left.ageMonths - right.ageMonths || left.sortOrder - right.sortOrder);
  const milestones = [...new Set(activeCatalog.map((item) => Number(item.ageMonths)))];
  const items = [];

  for (const patient of patients) {
    if (!isEligibleMother(patient)) {
      continue;
    }
    // Idade "atual": a ultima cujo aviso ja comecou (15 dias antes da data).
    const current = milestones
      .map((ageMonths) => {
        const targetDate = addMonthsIso(patient.dpp, ageMonths);
        return { ageMonths, targetDate, notifyFrom: addDays(targetDate, -BABY_REMINDER_DAYS_BEFORE) };
      })
      .filter((milestone) => milestone.notifyFrom <= todayIso)
      .at(-1);
    if (!current || daysBetween(current.targetDate, todayIso) > BABY_REMINDER_DAYS_AFTER) {
      continue;
    }

    const vaccines = activeCatalog.filter((item) => Number(item.ageMonths) === current.ageMonths);
    const clinicItems = vaccines.filter((item) => item.availability === BABY_VACCINE_AVAILABILITY.CLINIC);
    const publicItems = vaccines.filter((item) => item.availability !== BABY_VACCINE_AVAILABILITY.CLINIC);
    const contact = contactsMap.get(`${patient.id}:${current.ageMonths}`) ?? null;

    items.push({
      patientId: patient.id,
      patientName: patient.name,
      phone: patient.phone,
      dpp: patient.dpp,
      ageMonths: current.ageMonths,
      ageLabel: formatBabyAgeLabel(current.ageMonths),
      targetDate: current.targetDate,
      targetDateLabel: formatShortDate(current.targetDate),
      daysUntilTarget: daysBetween(todayIso, current.targetDate),
      vaccines: vaccines.map((item) => ({
        id: item.id,
        vaccineName: item.vaccineName,
        doseLabel: item.doseLabel,
        availability: item.availability
      })),
      hasClinicVaccines: clinicItems.length > 0,
      contacted: Boolean(contact),
      contactedAt: contact?.contactedAt ?? null,
      contactedByName: contact?.contactedByName ?? null,
      whatsappMessage: buildBabyWhatsAppMessage({ ageMonths: current.ageMonths, clinicItems, publicItems })
    });
  }

  items.sort((left, right) =>
    String(left.targetDate).localeCompare(String(right.targetDate)) ||
    String(left.patientName).localeCompare(String(right.patientName), "pt-BR")
  );
  return { today: todayIso, items };
}
