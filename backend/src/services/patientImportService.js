import { daysBetween, formatDatePtBr, todayIso } from "../utils/date.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

const COLUMN_ALIASES = {
  name: ["nome", "nome da paciente", "paciente"],
  phone: ["telefone", "telefone whatsapp", "telefone com whatsapp", "celular", "whatsapp"],
  clinicPatientId: ["id da clinica", "id clinica", "id clinica paciente", "codigo da clinica", "codigo interno"],
  physicianName: ["medico", "medico solicitante"],
  clinicUnit: ["unidade", "unidade da clinica", "clinica"],
  birthDate: ["data de nascimento", "data nascimento", "nascimento", "birthdate"],
  gestationalAge: ["idade gestacional", "ig"],
  gestationalWeeks: ["idade gestacional semanas", "semanas ig", "ig semanas", "semanas"],
  gestationalDays: ["idade gestacional dias", "dias ig", "ig dias", "dias"],
  dum: ["dum", "data da dum", "data da ultima menstruacao"],
  notes: ["observacoes", "obs", "anotacoes"],
  pregnancyType: ["tipo de gestacao"],
  highRisk: ["alto risco", "gestacao de alto risco"],
  lastCompletedExamCode: ["ultimo exame realizado", "ultimo exame"]
};

const REQUIRED_LABELS = [
  "nome",
  "telefone",
  "id_clinica",
  "data_nascimento",
  "idade_gestacional",
  "ultimo_exame",
  "medico",
  "unidade"
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
  return XLSX.utils.sheet_to_json(firstSheet, {
    defval: "",
    raw: true
  });
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

function isValidIsoDateParts(year, month, day) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);

  if (
    !Number.isInteger(normalizedYear) ||
    !Number.isInteger(normalizedMonth) ||
    !Number.isInteger(normalizedDay) ||
    normalizedMonth < 1 ||
    normalizedMonth > 12 ||
    normalizedDay < 1 ||
    normalizedDay > 31
  ) {
    return false;
  }

  const date = new Date(Date.UTC(normalizedYear, normalizedMonth - 1, normalizedDay));
  return (
    date.getUTCFullYear() === normalizedYear &&
    date.getUTCMonth() === normalizedMonth - 1 &&
    date.getUTCDate() === normalizedDay
  );
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

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return isValidIsoDateParts(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const normalizedDay = day.padStart(2, "0");
    const normalizedMonth = month.padStart(2, "0");
    return isValidIsoDateParts(year, normalizedMonth, normalizedDay)
      ? `${year}-${normalizedMonth}-${normalizedDay}`
      : null;
  }

  const dashMatch = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw);
  if (dashMatch) {
    const [, day, month, year] = dashMatch;
    const normalizedDay = day.padStart(2, "0");
    const normalizedMonth = month.padStart(2, "0");
    return isValidIsoDateParts(year, normalizedMonth, normalizedDay)
      ? `${year}-${normalizedMonth}-${normalizedDay}`
      : null;
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

  const verboseMatch = normalized.match(/(\d{1,2})\D+(\d)\b/);
  if (verboseMatch) {
    return {
      gestationalWeeks: Number(verboseMatch[1]),
      gestationalDays: Number(verboseMatch[2])
    };
  }

  const simpleMatch = normalized.match(/^(\d{1,2})$/);
  if (simpleMatch) {
    return {
      gestationalWeeks: Number(simpleMatch[1]),
      gestationalDays: 0
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
    if (
      Number.isInteger(gestationalWeeks) &&
      gestationalWeeks >= 0 &&
      Number.isInteger(gestationalDays) &&
      gestationalDays >= 0 &&
      gestationalDays <= 6
    ) {
      return { gestationalWeeks, gestationalDays };
    }
    errors.push("Idade gestacional invalida. Use formatos como 12s3d, 12+3 ou apenas 12.");
    return null;
  }

  const dumIso = parseDateValue(getCell(row, columnMap, "dum"));
  if (dumIso) {
    const totalDays = daysBetween(dumIso, todayIso());
    if (totalDays < 0) {
      errors.push("DUM invalida. A data informada esta no futuro.");
      return null;
    }
    return {
      gestationalWeeks: Math.floor(totalDays / 7),
      gestationalDays: totalDays % 7
    };
  }

  errors.push("Idade gestacional invalida. Use um valor como 12s3d ou informe a DUM.");
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
  patients,
  automaticExamModels = []
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
  const automaticExamByCode = buildLookupMap(automaticExamModels, (item) => item.code);
  const automaticExamByName = buildLookupMap(automaticExamModels, (item) => item.name);

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
    const duplicateMessages = [];

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
    if (!clinicPatientId) {
      errors.push("ID da clinica obrigatorio.");
    }
    if (!birthDate) {
      errors.push("Data de nascimento invalida. Use DD-MM-YYYY, DD/MM/YYYY ou YYYY-MM-DD.");
    }
    if (!physicianNameInput) {
      errors.push("Medico nao informado.");
    }
    if (!clinicUnitInput) {
      errors.push("Unidade nao informada.");
    }

    const matchedUnit = clinicUnitInput ? unitsByName.get(normalizeText(clinicUnitInput)) : null;
    if (clinicUnitInput && !matchedUnit) {
      errors.push("Unidade nao encontrada.");
    }

    const matchedPhysician = physicianNameInput ? physiciansByName.get(normalizeText(physicianNameInput)) : null;
    if (physicianNameInput && !matchedPhysician) {
      errors.push("Medico nao encontrado.");
    }

    if (matchedUnit && matchedPhysician && matchedPhysician.clinicUnitName && matchedPhysician.clinicUnitName !== matchedUnit.name) {
      errors.push("O medico informado nao pertence a unidade selecionada.");
    }

    const gestationalAge = resolveGestationalAgeFromRow(row, columnMap, errors);
    const pregnancyType = parsePregnancyType(getCell(row, columnMap, "pregnancyType"));
    const highRisk = parseHighRisk(getCell(row, columnMap, "highRisk"));

    const lastCompletedExamRaw = sanitizeString(getCell(row, columnMap, "lastCompletedExamCode"));
    const matchedLastCompletedExam =
      (lastCompletedExamRaw && automaticExamByCode.get(normalizeText(lastCompletedExamRaw))) ||
      (lastCompletedExamRaw && automaticExamByName.get(normalizeText(lastCompletedExamRaw))) ||
      null;

    if (lastCompletedExamRaw && !matchedLastCompletedExam) {
      errors.push("Ultimo exame invalido. Informe o nome ou codigo de um exame automatico cadastrado.");
    }

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
      notes: notes || "Cadastro importado por planilha.",
      lastCompletedExamCode: matchedLastCompletedExam?.code || undefined
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
