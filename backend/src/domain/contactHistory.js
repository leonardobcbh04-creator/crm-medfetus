import { addDays, todayIsoInTimeZone } from "../utils/date.js";

// Historico de quem marcou "Contatada" nos quadros da tela Vacinas (gestantes dTpa
// e bebes). A fonte e o audit_logs: as marcas em vacinas_contato e
// vacinas_bebe_contato sao apagadas quando a paciente sai da tela.
export const CONTACT_HISTORY_ACTIONS = {
  vacina_contatada: { board: "dtpa", action: "contatada" },
  vacina_contato_desfeito: { board: "dtpa", action: "desfeita" },
  vacina_bebe_contatada: { board: "bebe", action: "contatada" },
  vacina_bebe_contato_desfeito: { board: "bebe", action: "desfeita" }
};

export const ACTION_TYPES_BY_BOARD = {
  dtpa: ["vacina_contatada", "vacina_contato_desfeito"],
  bebe: ["vacina_bebe_contatada", "vacina_bebe_contato_desfeito"]
};

const SECTION_LABELS = {
  A: "Entram na janela nos proximos 15 dias",
  B: "Ja podem vacinar"
};

export const DEFAULT_PERIOD_DAYS = 30;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 10000;
export const CONTACT_HISTORY_TIME_ZONE = "America/Sao_Paulo";

function parseDetails(detailsJson) {
  if (!detailsJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(detailsJson);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Registros antigos (antes do details_json) trazem a idade so no texto:
// "Mae contatada sobre as vacinas do bebe (2 meses)."
export function extractBabyAgeFromDescription(description) {
  const match = /\((\d+)\s*mes(?:es)?\)/i.exec(String(description || ""));
  return match ? Number(match[1]) : null;
}

function formatBabyBoardLabel(ageMonths) {
  if (ageMonths === null || ageMonths === undefined || Number.isNaN(Number(ageMonths))) {
    return "Bebê";
  }
  const months = Number(ageMonths);
  return `Bebê ${months === 1 ? "1 mês" : `${months} meses`}`;
}

// raw: linha do SQL (audit_logs + nome da funcionaria + nome atual da paciente).
export function normalizeContactHistoryRow(raw) {
  const meta = CONTACT_HISTORY_ACTIONS[raw.actionType] || { board: "dtpa", action: "contatada" };
  const details = parseDetails(raw.detailsJson);
  const ageMonths = meta.board === "bebe"
    ? (details.ageMonths ?? extractBabyAgeFromDescription(raw.description))
    : null;
  const patientName = details.patientName || raw.currentPatientName || "Paciente excluida";

  return {
    id: raw.id,
    createdAt: raw.createdAt,
    createdAtLabel: raw.createdAtLabel,
    actorUserId: raw.actorUserId ?? null,
    actorName: raw.actorName || "Usuario removido",
    patientId: raw.patientId ?? null,
    patientName,
    board: meta.board,
    boardLabel: meta.board === "bebe" ? formatBabyBoardLabel(ageMonths) : "Gestante dTpa",
    ageMonths: ageMonths === null || ageMonths === undefined ? null : Number(ageMonths),
    action: meta.action,
    actionLabel: meta.action === "contatada" ? "Contatada" : "Marca desfeita",
    gestationalAgeLabel: details.gestationalAgeLabel ?? null,
    section: details.section ?? null,
    sectionLabel: details.section ? SECTION_LABELS[details.section] ?? null : null
  };
}

// Resumo por funcionaria: contatadas menos desfeitas (nunca abaixo de zero),
// separado em gestantes (dTpa) e bebes.
export function summarizeContactHistory(rows) {
  const byActor = new Map();
  for (const row of rows) {
    const key = row.actorUserId ?? `nome:${row.actorName}`;
    const current = byActor.get(key) ?? {
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      counts: { dtpa: 0, bebe: 0 }
    };
    current.counts[row.board] += row.action === "contatada" ? 1 : -1;
    byActor.set(key, current);
  }
  return [...byActor.values()]
    .map(({ actorUserId, actorName, counts }) => {
      const dtpa = Math.max(0, counts.dtpa);
      const bebe = Math.max(0, counts.bebe);
      return { actorUserId, actorName, dtpa, bebe, total: dtpa + bebe };
    })
    .sort((left, right) => right.total - left.total || String(left.actorName).localeCompare(String(right.actorName), "pt-BR"));
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function normalizeContactHistoryFilters(query = {}, today = todayIsoInTimeZone(CONTACT_HISTORY_TIME_ZONE)) {
  const to = isIsoDate(query.to) ? String(query.to) : today;
  const from = isIsoDate(query.from) ? String(query.from) : addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  if (from > to) {
    throw new Error("A data inicial nao pode ser depois da data final.");
  }
  const actorUserId = query.actorUserId === undefined || query.actorUserId === "" ? null : Number(query.actorUserId);
  if (actorUserId !== null && !Number.isInteger(actorUserId)) {
    throw new Error("Funcionaria invalida.");
  }
  const type = query.type === "dtpa" || query.type === "bebe" ? query.type : null;
  const exportAll = query.all === "1" || query.all === "true" || query.all === true;
  const pageSize = exportAll
    ? MAX_EXPORT_ROWS
    : Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const page = exportAll ? 1 : Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { from, to, actorUserId, type, page, pageSize, exportAll };
}

