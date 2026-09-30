import { daysBetween, formatDatePtBr, todayIso } from "../utils/date.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

// Colunas padrao (aba unica, cabecalho na primeira linha) OU planilha de recepcao
// (varias abas, uma por dia, cabecalho mais abaixo). Ambas usam o mesmo mapa de
// aliases; a deteccao de qual formato esta sendo lido acontece em parseWorkbookRows.
const COLUMN_ALIASES = {
  name: ["nome", "nome da paciente", "paciente", "nome completo"],
  clinicPatientId: [
    "id_clinica",
    "id da clinica",
    "id clinica",
    "id clinica paciente",
    "codigo da clinica",
    "codigo interno",
    "registro medfetus",
    "registro"
  ],
  examName: ["exame", "ultimo_exame", "ultimo exame", "ultimo exame realizado"],
  phone: ["telefone", "telefone whatsapp", "telefone com whatsapp", "celular", "celular de contato", "whatsapp"],
  physicianName: ["medico", "medico solicitante"],
  clinicUnit: ["unidade", "unidade da clinica", "clinica"],
  birthDate: ["data_nascimento", "data de nascimento", "data nascimento", "nascimento", "birthdate"],
  gestationalAge: ["idade gestacional", "ig"],
  gestationalWeeks: ["idade gestacional semanas", "semanas ig", "ig semanas", "semanas"],
  gestationalDays: ["idade gestacional dias", "dias ig", "ig dias", "dias"],
  // "data" (sozinho) casa com a coluna A da planilha de recepcao (data do atendimento do dia).
  // So entra em jogo via match exato, entao nao conflita com "data_agenda"/"data_nascimento".
  scheduleDate: ["data_agenda", "data agenda", "data da agenda", "agenda", "data"],
  dum: ["dum", "data da dum", "data da ultima menstruacao"],
  notes: ["observacoes", "anotacoes"],
  pregnancyType: ["tipo de gestacao"],
  highRisk: ["alto risco", "gestacao de alto risco"],
  lastCompletedExamCode: ["ultimo exame realizado", "ultimo exame"],
  // Usada so na planilha de recepcao, para identificar e ignorar atendimentos cancelados.
  importStatus: ["observacao", "observacoes"],
  // Horario do atendimento (coluna B da planilha de recepcao). Usado na agenda futura.
  scheduleTime: ["horario", "hora"]
};

// Marcadores (na coluna de observacao da planilha de recepcao) que indicam que a
// linha nao deve ser importada.
const CANCELLED_STATUS_PATTERNS = [/cancel/];

const REQUIRED_LABELS = [
  "nome",
  "id_clinica",
  "exame",
  "telefone",
  "data_nascimento",
  "idade_gestacional",
  "medico",
  "unidade",
  "data_agenda"
];

const IGNORED_EXAM_PATTERNS = [
  /endo/,
  /\btv\b/,
  /3d/,
  /mamas?\s*e\s*axilas?/,
  // Procedimento complementar (nao e um exame por si so): quando aparece junto de
  // outro exame na mesma celula, e ignorado e so o outro exame e considerado.
  /medida.*colo/,
  /colo.*medida/
];

const EXAM_IMPORT_ALIASES = [
  { matchers: [/obst.*inicial/, /4 a 10 sem/], targetName: "Exame obstetrico inicial" },
  { matchers: [/morf.*precoce/, /11 a ?14 sem/], targetName: "Morfologico 1o trimestre" },
  { matchers: [/obst.*sexo/, /apos 14 sem/], targetName: "Obstetrica para sexo" },
  { matchers: [/morf.*seg.*trim/, /20 a 24 sem/], targetName: "Morfologico 2o trimestre" },
  { matchers: [/ecocardio/, /fetal/], targetName: "Ecocardiograma fetal" },
  { matchers: [/\bpbf\b/, /perfil biofisico/], targetName: "Perfil biofisico fetal" },
  { matchers: [/doppler/], targetName: "Doppler obstetrico" },
  { matchers: [/morf.*terc.*trim/, /30 a 36 sem/], targetName: "Morfologico 3o trimestre" },
  { matchers: [/simples/], targetName: "Obstetrico simples" }
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

// Cabecalho da planilha de recepcao fica mais abaixo (nao na linha 1) e tem varias
// colunas repetidas (ex: "EXAME" aparece duas vezes). Por isso o parser trabalha com
// linhas em formato array (posicao de coluna), nao objetos por nome de cabecalho:
// assim a primeira ocorrencia de cada coluna sempre "ganha" e nunca ha colisao de chave.
function findHeaderRowIndex(grid) {
  const searchLimit = Math.min(grid.length, 30);
  for (let rowIndex = 0; rowIndex < searchLimit; rowIndex += 1) {
    const normalizedCells = (grid[rowIndex] || []).map(normalizeText);
    const hasName = normalizedCells.some((cell) => cell.includes("nome completo"));
    const hasPhone = normalizedCells.some((cell) => cell.includes("celular"));
    if (hasName && hasPhone) {
      return rowIndex;
    }
  }
  return -1;
}

// Aliases curtos (uma palavra, poucas letras) so podem casar por igualdade EXATA com
// o cabecalho — nunca por trecho parcial. Sem essa trava, um alias como "ig" acaba
// batendo por coincidencia dentro de palavras tipo "orIGem", e um alias como "data"
// bate dentro de "data_nascimento" ou "agendamento", roubando a coluna errada.
function isAliasEligibleForPartialMatch(normalizedAlias) {
  return normalizedAlias.includes(" ") || normalizedAlias.length >= 9;
}

function buildColumnMapFromHeaderRow(headerRow) {
  const map = new Map();

  // Uma unica passada, coluna por coluna (esquerda para direita). Para cada coluna,
  // verifica os campos ainda nao definidos e para no primeiro que encontrar. Isso
  // garante que a PRIMEIRA coluna compativel sempre "ganha" — essencial quando a
  // planilha tem colunas repetidas (ex: duas colunas "EXAME" ou "NOME"), situacao
  // comum na planilha de recepcao por causa da area financeira duplicada.
  headerRow.forEach((headerText, columnIndex) => {
    const normalizedHeader = normalizeText(headerText);
    if (!normalizedHeader) {
      return;
    }
    for (const [targetKey, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map.has(targetKey)) {
        continue;
      }
      const matches = aliases.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        if (normalizedHeader === normalizedAlias) {
          return true;
        }
        return isAliasEligibleForPartialMatch(normalizedAlias) && normalizedHeader.includes(normalizedAlias);
      });
      if (matches) {
        map.set(targetKey, columnIndex);
        break;
      }
    }
  });

  return map;
}

function isRowEmpty(row) {
  return !Array.isArray(row) || row.every((cell) => cell === "" || cell === null || cell === undefined);
}

// Le as abas da planilha e devolve, para cada aba, o mapa de colunas DELA. Cada aba
// tem o proprio mapa porque o layout da planilha de recepcao pode variar de um dia
// para outro (ex: na aba 01-10 o CELULAR esta na coluna P e nas demais na Q).
async function readWorkbookSheets(fileName, fileBase64) {
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
  if (!workbook.SheetNames.length) {
    throw new Error("Nao foi encontrada nenhuma aba na planilha.");
  }

  // A planilha da recepcao repete varias colunas mais a frente (area financeira e de
  // endereco), incluindo cabecalhos duplicados como "NOME" e "EXAME". Em vez de tentar
  // resolver essa ambiguidade por prioridade de coluna, simplesmente ignoramos tudo
  // depois da coluna V (onde termina a parte que realmente usamos) quando esse layout
  // e detectado — assim as colunas duplicadas nem chegam a ser consideradas.
  const RECEPTION_LAYOUT_COLUMN_LIMIT = 22; // colunas A (indice 0) a V (indice 21)

  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const rawGrid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
      raw: true,
      blankrows: true
    });
    if (!rawGrid.length) {
      continue;
    }

    const receptionHeaderIndex = findHeaderRowIndex(rawGrid);
    const isReceptionSheet = receptionHeaderIndex >= 0;
    const grid = isReceptionSheet
      ? rawGrid.map((row) => row.slice(0, RECEPTION_LAYOUT_COLUMN_LIMIT))
      : rawGrid;
    const headerIndex = isReceptionSheet ? receptionHeaderIndex : 0;
    // O grid comeca na primeira linha usada da aba (nem sempre a linha 1 do Excel);
    // guardamos o deslocamento para mostrar o numero real da linha na previa.
    const worksheetRef = workbook.Sheets[sheetName]["!ref"];
    const firstRowOffset = worksheetRef ? XLSX.utils.decode_range(worksheetRef).s.r : 0;
    sheets.push({
      sheetName,
      grid,
      firstRowOffset,
      headerIndex,
      isReceptionSheet,
      columnMap: buildColumnMapFromHeaderRow(grid[headerIndex] || [])
    });
  }

  // Se alguma aba segue o layout da recepcao, abas sem esse cabecalho (capa, resumo
  // etc.) nao sao lidas: nao da para saber com seguranca onde estao as colunas.
  const isReceptionLayout = sheets.some((sheet) => sheet.isReceptionSheet);
  const usableSheets = isReceptionLayout ? sheets.filter((sheet) => sheet.isReceptionSheet) : sheets;
  return { sheets: usableSheets, isReceptionLayout };
}

async function parseWorkbookRows(fileName, fileBase64, referenceDateIso) {
  const { sheets, isReceptionLayout } = await readWorkbookSheets(fileName, fileBase64);
  const rows = [];

  for (const { grid, headerIndex, columnMap } of sheets) {
    for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex];
      if (isRowEmpty(row)) {
        continue;
      }
      const nameValue = getCell(row, columnMap, "name");
      if (!sanitizeString(nameValue)) {
        continue;
      }

      if (isReceptionLayout && referenceDateIso && columnMap.has("scheduleDate")) {
        const rowDateIso = parseDateValue(getCell(row, columnMap, "scheduleDate"));
        // Linha sem data legivel nao pode ser confirmada como pertencente ao dia
        // escolhido, entao e excluida por seguranca (em vez de deixar passar).
        if (rowDateIso !== referenceDateIso) {
          continue;
        }
      }

      rows.push({ cells: row, columnMap });
    }
  }

  return { columnMap: sheets[0]?.columnMap || new Map(), rows, isReceptionLayout };
}

function getCell(row, columnMap, key) {
  const columnIndex = columnMap.get(key);
  if (columnIndex === undefined) {
    return null;
  }
  return Array.isArray(row) ? row[columnIndex] ?? null : null;
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

function formatGestationalAgeLabel(weeks, days) {
  if (!Number.isInteger(weeks) || weeks < 0) {
    return "-";
  }
  return `${weeks} semanas e ${days || 0} dias`;
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

function adjustGestationalAgeByScheduleDate(gestationalAge, scheduleDateIso, errors) {
  if (!gestationalAge) {
    return null;
  }

  if (!scheduleDateIso) {
    return {
      ...gestationalAge,
      adjustmentDays: 0
    };
  }

  const adjustmentDays = daysBetween(scheduleDateIso, todayIso());
  if (adjustmentDays < 0) {
    errors.push("Data da agenda invalida. A data informada esta no futuro. Para agendamentos, use a opcao \"Agenda futura\".");
    return null;
  }

  const totalDays = gestationalAge.gestationalWeeks * 7 + gestationalAge.gestationalDays + adjustmentDays;
  return {
    gestationalWeeks: Math.floor(totalDays / 7),
    gestationalDays: totalDays % 7,
    adjustmentDays
  };
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

function isIgnoredExamImport(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return IGNORED_EXAM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function resolveImportedExam(value, automaticExamByCode, automaticExamByName) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const directMatch = automaticExamByCode.get(normalized) || automaticExamByName.get(normalized);
  if (directMatch) {
    return directMatch;
  }

  const aliasMatch = EXAM_IMPORT_ALIASES.find(({ matchers }) => matchers.some((matcher) => matcher.test(normalized)));
  if (!aliasMatch) {
    return null;
  }

  return automaticExamByName.get(normalizeText(aliasMatch.targetName)) || null;
}

// Nome do exame (do mapeamento EXAM_IMPORT_ALIASES) que corresponde a celula, mesmo
// que esse exame nao esteja entre os modelos automaticos carregados.
function resolveExamAliasTargetName(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return EXAM_IMPORT_ALIASES.find(({ matchers }) => matchers.some((matcher) => matcher.test(normalized)))?.targetName ?? null;
}

function buildLookupMap(items, keySelector) {
  return items.reduce((map, item) => {
    map.set(normalizeText(keySelector(item)), item);
    return map;
  }, new Map());
}

function normalizeExamCellText(value) {
  return String(value ?? "").trim();
}

function splitExamEntries(value) {
  return normalizeExamCellText(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isCancelledStatus(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return CANCELLED_STATUS_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Quando a celula de exame lista mais de um exame (ex: paciente fez dois exames na
// mesma visita), escolhemos o mais avancado no protocolo (ordem de automaticExamModels)
// como "ultimo exame realizado": o sistema ja marca automaticamente como realizados
// todos os exames anteriores a ele, entao os demais exames da celula ficam cobertos.
function pickMostAdvancedExam(matchedExams, automaticExamModels) {
  if (!matchedExams.length) {
    return null;
  }
  return matchedExams.reduce((best, current) => {
    const bestIndex = automaticExamModels.findIndex((exam) => exam.code === best.code);
    const currentIndex = automaticExamModels.findIndex((exam) => exam.code === current.code);
    return currentIndex > bestIndex ? current : best;
  });
}

export async function previewPatientImportCore({
  fileName,
  fileBase64,
  referenceDate,
  units,
  physicians,
  patients,
  patientExams = [],
  automaticExamModels = []
}) {
  if (!sanitizeString(fileName) || !sanitizeString(fileBase64)) {
    throw new Error("Selecione uma planilha para continuar.");
  }

  const referenceDateIso = parseDateValue(referenceDate) || todayIso();
  const { columnMap, rows, isReceptionLayout } = await parseWorkbookRows(fileName, fileBase64, referenceDateIso);
  if (!rows.length) {
    throw new Error(
      isReceptionLayout
        ? `Nenhuma linha encontrada para a data ${formatDatePtBr(referenceDateIso)}. Confira a data selecionada.`
        : "A planilha esta vazia."
    );
  }

  const hasPhysicianColumn = columnMap.has("physicianName");
  const hasClinicUnitColumn = columnMap.has("clinicUnit");
  const activePhysicians = physicians.filter((item) => item.active);
  const activeUnits = units.filter((item) => item.active);
  // Quando a planilha nao tem coluna de medico/unidade (caso da planilha de recepcao),
  // so da pra preencher sozinho se houver exatamente 1 medico/unidade ativo cadastrado
  // no sistema — assim nao dependemos de acertar o nome exato digitado no codigo.
  const soleActivePhysician = activePhysicians.length === 1 ? activePhysicians[0] : null;
  const soleActiveUnit = activeUnits.length === 1 ? activeUnits[0] : null;
  const unitsByName = buildLookupMap(activeUnits, (item) => item.name);
  const physiciansByName = buildLookupMap(activePhysicians, (item) => item.name);
  const automaticExamByCode = buildLookupMap(automaticExamModels, (item) => item.code);
  const automaticExamByName = buildLookupMap(automaticExamModels, (item) => item.name);
  const patientExamsMap = patientExams.reduce((map, exam) => {
    const current = map.get(exam.patientId) ?? [];
    current.push(exam);
    map.set(exam.patientId, current);
    return map;
  }, new Map());

  const patientsByClinicId = new Map(
    patients
      .map((patient) => [sanitizeString(patient.clinicPatientId), patient])
      .filter(([clinicPatientId]) => Boolean(clinicPatientId))
  );
  const patientsByPhone = new Map(
    patients
      .map((patient) => [normalizeBrazilPhone(patient.phone), patient])
      .filter(([phone]) => Boolean(phone))
  );

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

  const previewRows = rows.map(({ cells: row, columnMap }, index) => {
    const lineNumber = index + 2;
    const errors = [];
    const duplicateMessages = [];

    const name = sanitizeString(getCell(row, columnMap, "name"));
    const rawPhone = sanitizeString(getCell(row, columnMap, "phone"));
    const phone = normalizeBrazilPhone(rawPhone);
    const clinicPatientId = sanitizeString(getCell(row, columnMap, "clinicPatientId"));
    const birthDateRaw = sanitizeString(getCell(row, columnMap, "birthDate"));
    const birthDate = parseDateValue(getCell(row, columnMap, "birthDate"));
    const physicianNameInput = sanitizeString(getCell(row, columnMap, "physicianName"));
    const clinicUnitInput = sanitizeString(getCell(row, columnMap, "clinicUnit"));
    const examNameInput = sanitizeString(getCell(row, columnMap, "examName") || getCell(row, columnMap, "lastCompletedExamCode"));
    const scheduleDateRaw = sanitizeString(getCell(row, columnMap, "scheduleDate"));
    const scheduleDate = parseDateValue(getCell(row, columnMap, "scheduleDate"));
    const notes = sanitizeString(getCell(row, columnMap, "notes"));
    const statusRaw = sanitizeString(getCell(row, columnMap, "importStatus"));
    const isCancelled = isCancelledStatus(statusRaw);

    if (!name) {
      errors.push("Nome obrigatorio.");
    }
    if (!phone) {
      errors.push("Telefone obrigatorio.");
    }
    if (!clinicPatientId) {
      errors.push("ID da clinica obrigatorio.");
    }
    if (birthDateRaw && !birthDate) {
      errors.push("Data de nascimento invalida. Use DD-MM-YYYY, DD/MM/YYYY ou YYYY-MM-DD.");
    }

    if (scheduleDateRaw && !scheduleDate) {
      errors.push("Data da agenda invalida. Use DD-MM-YYYY, DD/MM/YYYY ou YYYY-MM-DD.");
    }

    // Unidade: usa a coluna da planilha se existir; senao, so preenche sozinho se
    // houver exatamente 1 unidade ativa cadastrada no sistema.
    let matchedUnit = null;
    if (clinicUnitInput) {
      matchedUnit = unitsByName.get(normalizeText(clinicUnitInput));
      if (!matchedUnit) {
        errors.push("Unidade nao encontrada.");
      }
    } else if (hasClinicUnitColumn) {
      errors.push("Unidade nao informada.");
    } else if (soleActiveUnit) {
      matchedUnit = soleActiveUnit;
    } else {
      errors.push(
        activeUnits.length === 0
          ? "Nenhuma unidade ativa cadastrada no sistema. Cadastre uma unidade antes de importar."
          : "Ha mais de uma unidade ativa cadastrada; inclua a coluna \"unidade\" na planilha para indicar qual usar."
      );
    }

    // Medico: mesma logica da unidade.
    let matchedPhysician = null;
    if (physicianNameInput) {
      matchedPhysician = physiciansByName.get(normalizeText(physicianNameInput));
      if (!matchedPhysician) {
        errors.push("Medico nao encontrado.");
      }
    } else if (hasPhysicianColumn) {
      errors.push("Medico nao informado.");
    } else if (soleActivePhysician) {
      matchedPhysician = soleActivePhysician;
    } else {
      errors.push(
        activePhysicians.length === 0
          ? "Nenhum medico ativo cadastrado no sistema. Cadastre um medico antes de importar."
          : "Ha mais de um medico ativo cadastrado; inclua a coluna \"medico\" na planilha para indicar qual usar."
      );
    }

    if (matchedUnit && matchedPhysician && matchedPhysician.clinicUnitName && matchedPhysician.clinicUnitName !== matchedUnit.name) {
      errors.push("O medico informado nao pertence a unidade selecionada.");
    }

    const originalGestationalAge = resolveGestationalAgeFromRow(row, columnMap, errors);
    const adjustedGestationalAge = adjustGestationalAgeByScheduleDate(originalGestationalAge, scheduleDate, errors);
    const pregnancyType = parsePregnancyType(getCell(row, columnMap, "pregnancyType"));
    const highRisk = parseHighRisk(getCell(row, columnMap, "highRisk"));

    const lastCompletedExamRaw = examNameInput;
    // A celula pode listar mais de um exame (ex: "MORF.PRECOCE(11 a14 sem), OBST.INICIAL(4
    // a 10 sem)") quando a paciente fez os dois na mesma visita. Resolvemos cada um e
    // usamos o mais avancado do protocolo como "ultimo exame realizado" — o sistema ja
    // marca automaticamente os exames anteriores a ele como realizados tambem.
    const examEntries = splitExamEntries(lastCompletedExamRaw);
    const shouldIgnoreExam = examEntries.length > 0 && examEntries.every((entry) => isIgnoredExamImport(entry));
    const resolvedExamEntries = examEntries
      .filter((entry) => !isIgnoredExamImport(entry))
      .map((entry) => resolveImportedExam(entry, automaticExamByCode, automaticExamByName));
    const matchedExams = resolvedExamEntries.filter(Boolean);
    const hasUnresolvedExamEntry = resolvedExamEntries.length > matchedExams.length;
    const matchedLastCompletedExam = shouldIgnoreExam ? null : pickMostAdvancedExam(matchedExams, automaticExamModels);

    if (lastCompletedExamRaw && !shouldIgnoreExam && !matchedLastCompletedExam) {
      errors.push("Exame nao encontrado. Confira o nome informado na planilha.");
    } else if (hasUnresolvedExamEntry && matchedLastCompletedExam) {
      errors.push(`Um dos exames listados nao foi reconhecido: "${lastCompletedExamRaw}". Confira antes de importar.`);
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

    const existingPatient =
      (clinicPatientId ? patientsByClinicId.get(clinicPatientId) : null)
      || (!clinicPatientId && phone ? patientsByPhone.get(phone) : null)
      || null;

    const existingPatientExams = existingPatient ? patientExamsMap.get(existingPatient.id) ?? [] : [];
    const matchingExamRow = existingPatient && matchedLastCompletedExam
      ? existingPatientExams.find((exam) => exam.code === matchedLastCompletedExam.code)
      : null;
    const canUpdateExistingPatient = Boolean(
      existingPatient &&
      matchedLastCompletedExam &&
      matchingExamRow &&
      matchingExamRow.status !== "realizado"
    );

    if (existingPatient && !canUpdateExistingPatient && !shouldIgnoreExam) {
      duplicateMessages.push(
        matchedLastCompletedExam
          ? "Paciente ja cadastrada e esse exame ja consta na jornada dela."
          : "Paciente ja cadastrada no sistema."
      );
    }

    const normalizedData = {
      name: name || "",
      phone: rawPhone || "",
      clinicPatientId,
      birthDate: birthDate || null,
      gestationalWeeks: adjustedGestationalAge?.gestationalWeeks ?? null,
      gestationalDays: adjustedGestationalAge?.gestationalDays ?? null,
      physicianName: matchedPhysician?.name || physicianNameInput || null,
      clinicUnit: matchedUnit?.name || clinicUnitInput || null,
      pregnancyType,
      highRisk,
      notes: notes || "Cadastro importado por planilha.",
      lastCompletedExamCode: matchedLastCompletedExam?.code || undefined,
      importMode: canUpdateExistingPatient ? "atualizacao" : "novo",
      existingPatientId: existingPatient?.id ?? null,
      existingExamPatientId: matchingExamRow?.id ?? null,
      importCompletedDate: scheduleDate || todayIso()
    };

    const status = isCancelled
      ? "ignorada"
      : shouldIgnoreExam
        ? "ignorada"
        : errors.length
          ? "erro"
          : canUpdateExistingPatient
            ? "atualizacao"
            : duplicateMessages.length
              ? "duplicada"
              : "pronta";
    const informationalMessages = shouldIgnoreExam ? ["Exame fora do ciclo operacional. Linha ignorada sem bloquear a importacao."] : [];
    if (canUpdateExistingPatient) {
      informationalMessages.push("Paciente ja existe. O novo exame sera registrado na ficha dela.");
    }
    // Atendimento cancelado: a linha e sempre ignorada, independente de outras
    // pendencias de validacao (que deixam de fazer sentido para uma linha cancelada).
    const rowMessages = isCancelled
      ? ["Atendimento cancelado na planilha da recepcao. Linha ignorada."]
      : [...errors, ...duplicateMessages, ...informationalMessages];

    return {
      lineNumber,
      status,
      patientName: normalizedData.name,
      phone: normalizedData.phone,
      clinicPatientId: normalizedData.clinicPatientId,
      physicianName: normalizedData.physicianName,
      clinicUnit: normalizedData.clinicUnit,
      examName: matchedExams.length ? matchedExams.map((exam) => exam.name).join(" + ") : (lastCompletedExamRaw || null),
      originalExamName: lastCompletedExamRaw || null,
      gestationalAgeOriginalLabel: formatGestationalAgeLabel(originalGestationalAge?.gestationalWeeks ?? null, originalGestationalAge?.gestationalDays ?? 0),
      gestationalAgeAdjustedLabel: formatGestationalAgeLabel(normalizedData.gestationalWeeks, normalizedData.gestationalDays),
      gestationalAgeLabel: formatGestationalAgeLabel(normalizedData.gestationalWeeks, normalizedData.gestationalDays),
      scheduleDateLabel: scheduleDate ? formatDatePtBr(scheduleDate) : "-",
      birthDateLabel: normalizedData.birthDate ? formatDatePtBr(normalizedData.birthDate) : "-",
      messages: rowMessages,
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
      updateRows: previewRows.filter((row) => row.status === "atualizacao").length,
      duplicateRows: previewRows.filter((row) => row.status === "duplicada").length,
      errorRows: previewRows.filter((row) => row.status === "erro").length,
      ignoredRows: previewRows.filter((row) => row.status === "ignorada").length
    },
    rows: previewRows
  };
}

// ---------------------------------------------------------------------------
// Agenda futura
// ---------------------------------------------------------------------------
// O mesmo arquivo mensal da recepcao, mas lido "para frente": cada aba com data
// futura vira agendamento (status "agendado") do exame em exames_paciente. A agenda
// futura nunca cria nem altera o cadastro da paciente — so identifica quem ja esta
// cadastrada (pelo celular, conferindo o nome) e marca o exame como agendado.

export const FUTURE_SCHEDULE_SOURCE = "importacao_agenda";

const NAME_CONNECTOR_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);

function tokenizePersonName(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !NAME_CONNECTOR_WORDS.has(token));
}

// Nome da planilha "bate" com o cadastro quando e igual (sem acento/caixa/conectivos)
// ou quando primeiro nome e ultimo sobrenome sao iguais (a recepcao as vezes omite
// um sobrenome do meio). Qualquer outra diferenca vai para confirmacao manual.
export function namesMatch(spreadsheetName, registeredName) {
  const left = tokenizePersonName(spreadsheetName);
  const right = tokenizePersonName(registeredName);
  if (!left.length || !right.length) {
    return false;
  }
  if (left.join(" ") === right.join(" ")) {
    return true;
  }
  return left.length >= 2 && right.length >= 2 && left[0] === right[0] && left.at(-1) === right.at(-1);
}

// Horario da coluna HORARIO. O Excel guarda horario como fracao do dia; com
// cellDates o xlsx entrega um Date em 30/12/1899. Tambem aceita texto "8:30"/"08h30".
export function parseTimeValue(value) {
  let totalMinutes = null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    totalMinutes = Math.round((value.getTime() - Date.UTC(1899, 11, 30)) / 60000);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    totalMinutes = Math.round((value % 1) * 24 * 60);
  } else {
    const match = /^(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(String(value ?? "").trim());
    if (!match) {
      return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    if (hours > 23 || minutes > 59) {
      return null;
    }
    totalMinutes = hours * 60 + minutes;
  }
  const minutesOfDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(minutesOfDay / 60)).padStart(2, "0");
  const minutes = String(minutesOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// Nome da aba = dia e mes ("01-10" = 01/10). O ano vem da coluna DATA das linhas
// (ou do rotulo "OUTUBRO/26" acima dos dados), ja que o nome da aba nao tem ano.
function resolveSheetDate(sheet) {
  const match = /^\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*$/.exec(sheet.sheetName);
  if (!match) {
    return null;
  }
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");

  let year = null;
  for (let rowIndex = sheet.headerIndex + 1; rowIndex < sheet.grid.length && !year; rowIndex += 1) {
    const cellValue = getCell(sheet.grid[rowIndex], sheet.columnMap, "scheduleDate");
    const iso = parseDateValue(cellValue);
    if (iso && iso.slice(5) === `${month}-${day}`) {
      year = iso.slice(0, 4);
      continue;
    }
    const labelMatch = /\/\s*(\d{2}|\d{4})\s*$/.exec(String(cellValue ?? ""));
    if (labelMatch) {
      year = labelMatch[1].length === 2 ? `20${labelMatch[1]}` : labelMatch[1];
    }
  }
  if (!year || !isValidIsoDateParts(year, month, day)) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function isActivePatient(patient) {
  return (patient.status || "ativa") === "ativa" && !patient.closedAt;
}

export async function previewFutureScheduleImportCore({
  fileName,
  fileBase64,
  todayIso: todayReferenceIso,
  patients,
  patientExams = [],
  automaticExamModels = []
}) {
  if (!sanitizeString(fileName) || !sanitizeString(fileBase64)) {
    throw new Error("Selecione uma planilha para continuar.");
  }
  const referenceToday = todayReferenceIso || todayIso();

  const { sheets, isReceptionLayout } = await readWorkbookSheets(fileName, fileBase64);
  if (!isReceptionLayout) {
    throw new Error("A agenda futura precisa estar no formato da planilha da recepcao (uma aba por dia, com as colunas NOME COMPLETO e CELULAR).");
  }

  const automaticExamByCode = buildLookupMap(automaticExamModels, (item) => item.code);
  const automaticExamByName = buildLookupMap(automaticExamModels, (item) => item.name);
  const patientsByPhone = new Map();
  patients.filter(isActivePatient).forEach((patient) => {
    const phone = normalizeBrazilPhone(patient.phone);
    if (!phone) {
      return;
    }
    const current = patientsByPhone.get(phone) ?? [];
    current.push(patient);
    patientsByPhone.set(phone, current);
  });
  const patientExamsMap = patientExams.reduce((map, exam) => {
    const current = map.get(exam.patientId) ?? [];
    current.push(exam);
    map.set(exam.patientId, current);
    return map;
  }, new Map());

  const ignoredSheets = [];
  const scheduleDates = [];
  const previewRows = [];

  for (const sheet of sheets) {
    const sheetDate = resolveSheetDate(sheet);
    if (!sheetDate) {
      ignoredSheets.push({ sheetName: sheet.sheetName, reason: "Nome da aba nao e uma data (esperado dd-mm) ou ano nao encontrado." });
      continue;
    }
    if (sheetDate <= referenceToday) {
      ignoredSheets.push({ sheetName: sheet.sheetName, reason: "Data de hoje ou passada (use a importacao de atendimentos do dia)." });
      continue;
    }
    scheduleDates.push(sheetDate);

    const { grid, headerIndex, columnMap } = sheet;
    for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex];
      const name = sanitizeString(getCell(row, columnMap, "name"));
      if (isRowEmpty(row) || !name) {
        continue;
      }

      const errors = [];
      const messages = [];
      const rawPhone = sanitizeString(getCell(row, columnMap, "phone"));
      const phone = normalizeBrazilPhone(rawPhone);
      const rowDate = parseDateValue(getCell(row, columnMap, "scheduleDate"));
      const scheduleTime = parseTimeValue(getCell(row, columnMap, "scheduleTime"));
      const examRaw = sanitizeString(getCell(row, columnMap, "examName"));
      const isCancelled = isCancelledStatus(getCell(row, columnMap, "importStatus"));

      if (rowDate && rowDate !== sheetDate) {
        errors.push(`A data da linha (${formatDatePtBr(rowDate)}) e diferente da data da aba (${formatDatePtBr(sheetDate)}).`);
      }

      // Exame: mesmo mapeamento de nomes da importacao do dia. Uma celula pode
      // listar mais de um exame; cada exame reconhecido vira um agendamento.
      const examEntries = splitExamEntries(examRaw);
      const relevantEntries = examEntries.filter((entry) => !isIgnoredExamImport(entry));
      const resolvedEntries = relevantEntries.map((entry) => resolveImportedExam(entry, automaticExamByCode, automaticExamByName));
      const matchedExams = [...new Map(resolvedEntries.filter(Boolean).map((exam) => [exam.code, exam])).values()];
      // Exames reconhecidos pelo nome mas que nao fazem parte da jornada automatica
      // (ex: Obstetrico simples, Morfologico 3o trimestre sao "avulsos"): a paciente
      // nao tem linha desse exame em exames_paciente, entao nao ha o que agendar.
      const standaloneExamNames = relevantEntries
        .filter((entry, index) => !resolvedEntries[index])
        .map(resolveExamAliasTargetName)
        .filter(Boolean);
      const unknownEntries = relevantEntries.filter((entry, index) => !resolvedEntries[index] && !resolveExamAliasTargetName(entry));
      const onlyIgnoredExams = examEntries.length > 0 && relevantEntries.length === 0;
      const onlyStandaloneExams = !onlyIgnoredExams && !matchedExams.length && !unknownEntries.length && standaloneExamNames.length > 0;
      if (!examRaw) {
        errors.push("Exame nao informado.");
      } else if (unknownEntries.length) {
        errors.push(`Exame nao reconhecido: "${examRaw}". Confira a planilha.`);
      }

      // Paciente: pelo celular, conferindo o nome.
      let patient = null;
      let nameConfirmed = false;
      if (!phone) {
        errors.push("Celular nao informado na planilha.");
      } else {
        const candidates = patientsByPhone.get(phone) ?? [];
        patient = candidates.find((candidate) => namesMatch(name, candidate.name)) ?? candidates[0] ?? null;
        nameConfirmed = Boolean(patient) && namesMatch(name, patient.name);
      }

      const existingExams = patient ? patientExamsMap.get(patient.id) ?? [] : [];
      const examTargets = matchedExams.map((exam) => {
        const patientExam = existingExams.find((item) => item.code === exam.code) ?? null;
        return {
          code: exam.code,
          name: exam.name,
          examPatientId: patientExam?.id ?? null,
          currentStatus: patientExam?.status ?? null,
          currentScheduledDate: patientExam?.scheduledDate ?? null
        };
      });

      let status;
      if (errors.length) {
        status = "erro";
      } else if (onlyIgnoredExams) {
        status = "ignorada";
        messages.push("Exame fora do ciclo operacional. Linha ignorada.");
      } else if (onlyStandaloneExams) {
        status = "ignorada";
        messages.push(`Exame avulso (${standaloneExamNames.join(", ")}): nao faz parte da jornada automatica da paciente, entao nao e agendado no sistema.`);
      } else if (!patient) {
        status = "nao_cadastrada";
        messages.push("Nenhuma paciente ativa cadastrada com esse celular. Linha ignorada.");
      } else if (isCancelled) {
        status = "cancelamento";
        messages.push(`Agendamento cancelado na planilha: sera removido do dia ${formatDatePtBr(sheetDate)}.`);
      } else if (examTargets.some((target) => !target.examPatientId)) {
        status = "erro";
        errors.push("Esse exame nao faz parte da jornada da paciente no sistema.");
      } else if (examTargets.every((target) => target.currentStatus === "realizado")) {
        status = "ignorada";
        messages.push("Esse exame ja consta como realizado para a paciente. Linha ignorada.");
      } else {
        status = nameConfirmed ? "agendamento" : "confirmar";
        if (!nameConfirmed) {
          messages.push(`Nome diferente do cadastro ("${patient.name}"). Confira e marque a linha para gravar.`);
        }
        if (examTargets.some((target) => target.currentStatus === "realizado")) {
          messages.push("Um dos exames ja consta como realizado e nao sera agendado.");
        }
        if (standaloneExamNames.length) {
          messages.push(`Exame avulso (${standaloneExamNames.join(", ")}) nao e agendado no sistema; os demais exames da linha sim.`);
        }
      }

      const excelRowNumber = rowIndex + 1 + sheet.firstRowOffset;
      previewRows.push({
        rowKey: `${sheet.sheetName}:${excelRowNumber}`,
        sheetName: sheet.sheetName,
        lineNumber: excelRowNumber,
        status,
        patientName: name,
        phone: rawPhone || "",
        registeredPatientId: patient?.id ?? null,
        registeredPatientName: patient?.name ?? null,
        scheduleDate: sheetDate,
        scheduleDateLabel: formatDatePtBr(sheetDate),
        scheduleTime,
        examName: matchedExams.length ? matchedExams.map((exam) => exam.name).join(" + ") : examRaw,
        originalExamName: examRaw,
        exams: examTargets.filter((target) => target.currentStatus !== "realizado" || status === "cancelamento"),
        messages: [...errors, ...messages]
      });
    }
  }

  const countStatus = (status) => previewRows.filter((row) => row.status === status).length;
  return {
    mode: "agenda_futura",
    today: referenceToday,
    scheduleDates,
    ignoredSheets,
    summary: {
      totalRows: previewRows.length,
      scheduleRows: countStatus("agendamento"),
      confirmRows: countStatus("confirmar"),
      cancelRows: countStatus("cancelamento"),
      notRegisteredRows: countStatus("nao_cadastrada"),
      errorRows: countStatus("erro"),
      ignoredRows: countStatus("ignorada")
    },
    rows: previewRows
  };
}
