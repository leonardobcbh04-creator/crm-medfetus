import { daysBetween, formatDatePtBr, todayIso } from "../utils/date.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

const COLUMN_ALIASES = {
  name: ["nome", "nome da paciente", "paciente"],
  phone: ["telefone", "telefone whatsapp", "telefone com whatsapp", "celular", "whatsapp"],
  clinicPatientId: ["id da clinica", "id da clínica", "id clinica", "codigo da clinica", "codigo interno"],
  physicianName: ["medico", "médico", "medico solicitante", "médico solicitante"],
  clinicUnit: ["unidade", "unidade da clinica", "unidade da clínica", "clinica", "clínica"],
  birthDate: ["data de nascimento", "nascimento", "birthdate"],
  gestationalAge: ["idade gestacional", "ig"],
  gestationalWeeks: ["idade gestacional semanas", "semanas ig", "ig semanas", "semanas"],
  gestationalDays: ["idade gestacional dias", "dias ig", "ig dias", "dias"],
  dum: ["dum", "data da dum", "data da ultima menstruacao", "data da última menstruação"],
  notes: ["observacoes", "observações", "obs", "anotacoes", "anotações"],
  pregnancyType: ["tipo de gestacao", "tipo de gestação"],
  highRisk: ["alto risco", "gestacao de alto risco", "gestação de alto risco"],
  lastCompletedExamCode: ["ultimo exame realizado", "último exame realizado"]
};

const REQUIRED_LABELS = [
  "nome",
  "telefone",
  "data de nascimento",
  "medico",
  "unidade",
  "observacoes",
  "idade gestacional ou DUM"
];

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function decodeBase64File(fileBase64) {
  const normalized = String(fileBase64 || "");
  const cleanBase64 = normalized.includes(",") ? normalized.split(",").pop() || "" : normalized;
  return Buffer.from(cleanBase64, "base64");
}

async function parseWorkbookRows(fileName, fileBase64) {
  const extension = ACCEPTED_EXTENSIONS.find((item) => String(fileName || "").toLowerCase().endsWith(item));
  if (!extension) {
    throw new Error("Formato nao suportado. Envie uma planilha .xlsx, .xls ou .csv.");
  }

  const XLSX = await import("xlsx");
  const workbook = XLSX.read(decodeBase64File(fileBase64), {
    type: "buffer",
    cellDates: true,
    raw: true
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Nao foi encontrada nenhuma aba na planilha.");
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    defval: "",
    raw: true
  });

  return rows;
}

function buildColumnMap(sampleRow) {
  const map = new Map();
  const keys = Object.keys(sampleRow || {});

  Object.entries(COLUMN_ALIASES).forEach(([targetKey, aliases]) => {
    const match = keys.find((key) => aliases.includes(normalizeText(key)));
    if (match) {
      map.set(targetKey, match);
    }
  });

  return map;
}

function getCell(row, columnMap, key) {
  const column = columnMap.get(key);
  if (!column) {
    return null;
  }
  return row?.[column] ?? null;
}

function parseExcelSerialDate(serialNumber) {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(excelEpoch.getTime() + Number(serialNumber) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return parseExcelSerialDate(value);
  }

  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function parseHighRisk(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  return ["sim", "s", "true", "alto risco", "alto"].includes(normalized);
}

function parsePregnancyType(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "Unica";
  }
  if (normalized.includes("gemelar")) {
    return "Gemelar";
  }
  if (normalized.includes("multipla") || normalized.includes("multiple")) {
    return "Multipla";
  }
  return "Unica";
}

function parseGestationalAgeText(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const compactMatch = normalized.match(/^(\d{1,2})\s*[sS]?\s*(?:\+|e)?\s*(\d)\s*[dD]?$/);
  if (compactMatch) {
    return {
      gestationalWeeks: Number(compactMatch[1]),
      gestationalDays: Number(compactMatch[2])
    };
  }

  const fullMatch = normalized.match(/(\d{1,2})\D+(\d)\b/);
  if (fullMatch) {
    return {
      gestationalWeeks: Number(fullMatch[1]),
      gestationalDays: Number(fullMatch[2])
    };
  }

  const simpleMatch = normalized.match(/^(\d{1,2})$/);
  if (simpleMatch) {
    return {
      gestationalWeeks: Number(simpleMatch[1]),
      gestationalDays: 0
    };
  }

  const combinedMatch = normalized.match(/^(\d{1,2})\s*[s+]\s*(\d)[d]?$/i);
  if (combinedMatch) {
    return {
      gestationalWeeks: Number(combinedMatch[1]),
      gestationalDays: Number(combinedMatch[2])
    };
  }

  return null;
}

function resolveGestationalAgeFromRow(row, columnMap, errors) {
  const directGestationalAge = parseGestationalAgeText(getCell(row, columnMap, "gestationalAge"));
  if (directGestationalAge) {
    return directGestationalAge;
  }

  const weeksValue = sanitizeString(getCell(row, columnMap, "gestationalWeeks"));
  const daysValue = sanitizeString(getCell(row, columnMap, "gestationalDays"));

  if (weeksValue) {
    const gestationalWeeks = Number(String(weeksValue).replace(/\D/g, ""));
    const gestationalDays = Number(String(daysValue || "0").replace(/\D/g, ""));
    if (Number.isInteger(gestationalWeeks) && gestationalWeeks >= 0 && Number.isInteger(gestationalDays) && gestationalDays >= 0 && gestationalDays <= 6) {
      return { gestationalWeeks, gestationalDays };
    }
    errors.push("Idade gestacional invalida. Informe semanas e dias entre 0 e 6.");
    return null;
  }

  const dumIso = parseDateValue(getCell(row, columnMap, "dum"));
  if (dumIso) {
    const totalDays = daysBetween(dumIso, todayIso());
    if (totalDays < 0) {
      errors.push("A DUM informada esta no futuro.");
      return null;
    }
    return {
      gestationalWeeks: Math.floor(totalDays / 7),
      gestationalDays: totalDays % 7
    };
  }

  errors.push("Informe a idade gestacional ou a DUM.");
  return null;
}

function buildLookupMap(items, keySelector) {
  return items.reduce((map, item) => {
    map.set(normalizeText(keySelector(item)), item);
    return map;
  }, new Map());
}

export async function previewPatientImportCore({
  fileName,
  fileBase64,
  units,
  physicians,
  patients
}) {
  if (!sanitizeString(fileName) || !sanitizeString(fileBase64)) {
    throw new Error("Selecione uma planilha para continuar.");
  }

  const rows = await parseWorkbookRows(fileName, fileBase64);
  if (!rows.length) {
    throw new Error("A planilha esta vazia.");
  }

  const columnMap = buildColumnMap(rows[0]);
  const unitsByName = buildLookupMap(units.filter((item) => item.active), (item) => item.name);
  const physiciansByName = buildLookupMap(physicians.filter((item) => item.active), (item) => item.name);

  const existingPhoneSet = new Set(
    patients
      .map((patient) => normalizeBrazilPhone(patient.phone))
      .filter(Boolean)
  );
  const existingClinicIdSet = new Set(
    patients
      .map((patient) => sanitizeString(patient.clinicPatientId))
      .filter(Boolean)
  );
  const importPhonesSeen = new Set();
  const importClinicIdsSeen = new Set();

  const previewRows = rows.map((row, index) => {
    const lineNumber = index + 2;
    const errors = [];
    const name = sanitizeString(getCell(row, columnMap, "name"));
    const rawPhone = sanitizeString(getCell(row, columnMap, "phone"));
    const phone = normalizeBrazilPhone(rawPhone);
    const clinicPatientId = sanitizeString(getCell(row, columnMap, "clinicPatientId"));
    const birthDate = parseDateValue(getCell(row, columnMap, "birthDate"));
    const physicianNameInput = sanitizeString(getCell(row, columnMap, "physicianName"));
    const clinicUnitInput = sanitizeString(getCell(row, columnMap, "clinicUnit"));
    const notes = sanitizeString(getCell(row, columnMap, "notes"));

    if (!name) {
      errors.push("Nome obrigatorio.");
    }
    if (!phone) {
      errors.push("Telefone obrigatorio.");
    }
    if (!birthDate) {
      errors.push("Data de nascimento invalida ou ausente.");
    }
    if (!physicianNameInput) {
      errors.push("Medico obrigatorio.");
    }
    if (!clinicUnitInput) {
      errors.push("Unidade obrigatoria.");
    }
    if (!notes) {
      errors.push("Observacoes obrigatorias.");
    }

    const matchedUnit = clinicUnitInput ? unitsByName.get(normalizeText(clinicUnitInput)) : null;
    if (clinicUnitInput && !matchedUnit) {
      errors.push("Unidade nao encontrada na area administrativa.");
    }

    const matchedPhysician = physicianNameInput ? physiciansByName.get(normalizeText(physicianNameInput)) : null;
    if (physicianNameInput && !matchedPhysician) {
      errors.push("Medico nao encontrado na area administrativa.");
    }

    if (matchedUnit && matchedPhysician && matchedPhysician.clinicUnitName && matchedPhysician.clinicUnitName !== matchedUnit.name) {
      errors.push("O medico informado nao pertence a unidade selecionada.");
    }

    const gestationalAge = resolveGestationalAgeFromRow(row, columnMap, errors);
    const pregnancyType = parsePregnancyType(getCell(row, columnMap, "pregnancyType"));
    const highRisk = parseHighRisk(getCell(row, columnMap, "highRisk"));
    const lastCompletedExamCode = sanitizeString(getCell(row, columnMap, "lastCompletedExamCode"));

    const duplicateMessages = [];
    if (phone && existingPhoneSet.has(phone)) {
      duplicateMessages.push("Telefone ja cadastrado no sistema.");
    }
    if (clinicPatientId && existingClinicIdSet.has(clinicPatientId)) {
      duplicateMessages.push("ID da clinica ja cadastrado no sistema.");
    }

    if (phone && importPhonesSeen.has(phone)) {
      duplicateMessages.push("Telefone repetido dentro da mesma planilha.");
    } else if (phone) {
      importPhonesSeen.add(phone);
    }

    if (clinicPatientId && importClinicIdsSeen.has(clinicPatientId)) {
      duplicateMessages.push("ID da clinica repetido dentro da mesma planilha.");
    } else if (clinicPatientId) {
      importClinicIdsSeen.add(clinicPatientId);
    }

    const normalizedData = {
      name: name || "",
      phone: rawPhone || "",
      clinicPatientId,
      birthDate,
      gestationalWeeks: gestationalAge?.gestationalWeeks ?? null,
      gestationalDays: gestationalAge?.gestationalDays ?? null,
      physicianName: matchedPhysician?.name || physicianNameInput || null,
      clinicUnit: matchedUnit?.name || clinicUnitInput || null,
      pregnancyType,
      highRisk,
      notes: notes || "",
      lastCompletedExamCode: lastCompletedExamCode || undefined
    };

    const status = errors.length ? "erro" : duplicateMessages.length ? "duplicada" : "pronta";

    return {
      lineNumber,
      status,
      patientName: normalizedData.name,
      phone: normalizedData.phone,
      clinicPatientId: normalizedData.clinicPatientId,
      physicianName: normalizedData.physicianName,
      clinicUnit: normalizedData.clinicUnit,
      gestationalAgeLabel:
        normalizedData.gestationalWeeks == null
          ? "-"
          : `${normalizedData.gestationalWeeks} semanas e ${normalizedData.gestationalDays || 0} dias`,
      birthDateLabel: normalizedData.birthDate ? formatDatePtBr(normalizedData.birthDate) : "-",
      messages: [...errors, ...duplicateMessages],
      normalizedData
    };
  });

  return {
    acceptedFormats: ACCEPTED_EXTENSIONS,
    expectedColumns: REQUIRED_LABELS,
    detectedColumns: Object.fromEntries([...columnMap.entries()]),
    summary: {
      totalRows: previewRows.length,
      readyRows: previewRows.filter((row) => row.status === "pronta").length,
      duplicateRows: previewRows.filter((row) => row.status === "duplicada").length,
      errorRows: previewRows.filter((row) => row.status === "erro").length
    },
    rows: previewRows
  };
}
