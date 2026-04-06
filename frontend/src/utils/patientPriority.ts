import type { Patient } from "../types";

export type PriorityFilter = "todas" | "verde" | "amarelo" | "laranja" | "vermelho";

type PriorityMeta = {
  color: Exclude<PriorityFilter, "todas">;
  label: string;
  badgeText: string;
  cardClassName: string;
  badgeClassName: string;
  needsImmediateAction: boolean;
};

export function getPatientPriorityMeta(patient: Patient): PriorityMeta {
  const status = patient.nextExam.deadlineStatus;
  const isTodayReminder = patient.nextExam.alertLevel === "hoje";

  if (status === "atrasado") {
    return {
      color: "vermelho",
      label: "Atrasado",
      badgeText: "Atrasado",
      cardClassName: "patient-card-red",
      badgeClassName: "badge-priority-red",
      needsImmediateAction: true
    };
  }

  if (status === "pendente") {
    return {
      color: "laranja",
      label: "Precisa de contato",
      badgeText: isTodayReminder ? "Lembrete hoje" : "Precisa de contato",
      cardClassName: "patient-card-orange",
      badgeClassName: "badge-priority-orange",
      needsImmediateAction: true
    };
  }

  if (status === "aproximando") {
    return {
      color: "amarelo",
      label: "Janela proxima",
      badgeText: "Janela proxima",
      cardClassName: "patient-card-yellow",
      badgeClassName: "badge-priority-yellow",
      needsImmediateAction: false
    };
  }

  return {
    color: "verde",
    label: "Dentro do prazo",
    badgeText: "Dentro do prazo",
    cardClassName: "patient-card-green",
    badgeClassName: "badge-priority-green",
    needsImmediateAction: false
  };
}
