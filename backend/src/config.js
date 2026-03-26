import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDirectory, "..", "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    const normalizedValue = rawValue.replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = normalizedValue;
    }
  });
}

loadEnvFile(path.join(workspaceRoot, ".env"));
loadEnvFile(path.join(workspaceRoot, ".env.local"));

function readStringEnv(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return "";
}

function readBooleanEnv(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on", "mock"].includes(String(value).toLowerCase());
}

function readNumberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readListEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveDatabaseFile() {
  const configuredValue = readStringEnv(process.env.DATABASE_URL);
  if (!configuredValue) {
    return path.resolve(currentDirectory, "..", "data", "clinic.sqlite");
  }

  if (configuredValue.startsWith("file:")) {
    return fileURLToPath(configuredValue);
  }

  return path.isAbsolute(configuredValue)
    ? configuredValue
    : path.resolve(currentDirectory, "..", configuredValue);
}

export const NODE_ENV = readStringEnv(process.env.NODE_ENV) || "development";
export const PORT = readNumberEnv(process.env.PORT, 4000);
export const DB_FILE = resolveDatabaseFile();
export const CORS_ALLOWED_ORIGINS = readListEnv(process.env.CORS_ALLOWED_ORIGINS);
export const RUN_BACKGROUND_WORKERS_IN_API = readBooleanEnv(process.env.RUN_BACKGROUND_WORKERS_IN_API, false);

export const MESSAGING_CONFIG = {
  provider: "manual_stub",
  channel: "whatsapp",
  externalApiBaseUrl: process.env.WHATSAPP_API_BASE_URL || "",
  externalApiToken: process.env.WHATSAPP_API_TOKEN || "",
  externalPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  templatesEnabled: true,
  dryRun: true
};

export const SHOSP_CONFIG = {
  mode: readBooleanEnv(process.env.SHOSP_USE_MOCK, true) ? "mock" : "live",
  baseUrl: readStringEnv(process.env.SHOSP_API_URL, process.env.SHOSP_API_BASE_URL),
  apiToken: readStringEnv(process.env.SHOSP_API_TOKEN),
  apiKey: readStringEnv(process.env.SHOSP_API_KEY),
  companyId: readStringEnv(process.env.SHOSP_ACCOUNT_ID, process.env.SHOSP_COMPANY_ID),
  username: process.env.SHOSP_USERNAME || "",
  password: process.env.SHOSP_PASSWORD || "",
  timeoutMs: readNumberEnv(process.env.SHOSP_TIMEOUT_MS, 15000),
  patientsPath: process.env.SHOSP_PATIENTS_PATH || "/patients",
  attendancesPath: process.env.SHOSP_ATTENDANCES_PATH || "/attendances",
  examsPath: process.env.SHOSP_EXAMS_PATH || "/exams",
  syncIntervalMs: readNumberEnv(process.env.SHOSP_SYNC_INTERVAL, 0),
  retryAttempts: readNumberEnv(process.env.SHOSP_RETRY_ATTEMPTS, 3),
  retryDelayMs: readNumberEnv(process.env.SHOSP_RETRY_DELAY_MS, 1500)
};

export const LOG_RETENTION_CONFIG = {
  auditLogsDays: readNumberEnv(process.env.AUDIT_LOG_RETENTION_DAYS, 365),
  syncLogsDays: readNumberEnv(process.env.SYNC_LOG_RETENTION_DAYS, 90),
  messageLogsDays: readNumberEnv(process.env.MESSAGE_LOG_RETENTION_DAYS, 30),
  cleanupIntervalHours: readNumberEnv(process.env.LOG_RETENTION_CLEANUP_INTERVAL_HOURS, 24)
};

export const KANBAN_STAGES = [
  {
    id: "revisao_base_gestacional",
    title: "Revisao manual da base gestacional",
    description: "Pacientes que precisam confirmar a base gestacional antes de seguir o fluxo"
  },
  {
    id: "contato_pendente",
    title: "Contato pendente",
    description: "Pacientes que ainda precisam de contato da recepcao"
  },
  {
    id: "mensagem_enviada",
    title: "Mensagem enviada",
    description: "Pacientes que ja receberam mensagem e aguardam retorno"
  },
  {
    id: "follow_up",
    title: "Follow up",
    description: "Mensagens sem resposta ha mais de 2 dias para nova tentativa"
  },
  {
    id: "agendada",
    title: "Agendada",
    description: "Pacientes com exame marcado e data ja definida"
  }
];
