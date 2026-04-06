import { SHOSP_CONFIG } from "../../config.js";
import { getDatabaseRuntime } from "../../database/runtime.js";

const shospApiRuntimeMetrics = {
  totalRequests: 0,
  successfulRequests: 0,
  totalResponseMs: 0,
  averageResponseMs: null,
  lastResponseMs: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastErrorMessage: null
};

async function getPersistedConfig() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      use_mock AS "useMock",
      api_base_url AS "apiBaseUrl",
      api_token AS "apiToken",
      api_key AS "apiKey",
      username,
      password,
      company_id AS "companyId",
      settings_json AS "settingsJson"
    FROM configuracoes_de_integracao
    WHERE integration_key = 'shosp'
    LIMIT 1
  `);
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    settings: row.settingsJson ? JSON.parse(row.settingsJson) : {}
  };
}

function envValue(value) {
  return value != null && value !== "";
}

function updateAverageResponse() {
  shospApiRuntimeMetrics.averageResponseMs =
    shospApiRuntimeMetrics.successfulRequests > 0
      ? Math.round(shospApiRuntimeMetrics.totalResponseMs / shospApiRuntimeMetrics.successfulRequests)
      : null;
}

function recordShospApiSuccess(durationMs) {
  shospApiRuntimeMetrics.totalRequests += 1;
  shospApiRuntimeMetrics.successfulRequests += 1;
  shospApiRuntimeMetrics.totalResponseMs += durationMs;
  shospApiRuntimeMetrics.lastResponseMs = durationMs;
  shospApiRuntimeMetrics.lastSuccessAt = new Date().toISOString();
  shospApiRuntimeMetrics.lastErrorMessage = null;
  updateAverageResponse();
}

function recordShospApiFailure(durationMs, error) {
  shospApiRuntimeMetrics.totalRequests += 1;
  shospApiRuntimeMetrics.lastResponseMs = durationMs;
  shospApiRuntimeMetrics.lastFailureAt = new Date().toISOString();
  shospApiRuntimeMetrics.lastErrorMessage =
    error instanceof Error ? error.message : "Falha inesperada na API do Shosp.";
}

export function getShospApiRuntimeMetrics() {
  return { ...shospApiRuntimeMetrics };
}

export function resetShospApiRuntimeMetrics() {
  shospApiRuntimeMetrics.totalRequests = 0;
  shospApiRuntimeMetrics.successfulRequests = 0;
  shospApiRuntimeMetrics.totalResponseMs = 0;
  shospApiRuntimeMetrics.averageResponseMs = null;
  shospApiRuntimeMetrics.lastResponseMs = null;
  shospApiRuntimeMetrics.lastSuccessAt = null;
  shospApiRuntimeMetrics.lastFailureAt = null;
  shospApiRuntimeMetrics.lastErrorMessage = null;
}

export async function getEffectiveShospRuntimeConfig() {
  const persisted = await getPersistedConfig();
  const persistedSettings = persisted?.settings || {};
  const mode = envValue(process.env.SHOSP_USE_MOCK)
    ? SHOSP_CONFIG.mode
    : persisted
      ? (persisted.useMock ? "mock" : "live")
      : SHOSP_CONFIG.mode;

  return {
    mode,
    baseUrl: envValue(SHOSP_CONFIG.baseUrl) ? SHOSP_CONFIG.baseUrl : persisted?.apiBaseUrl || "",
    apiToken: envValue(SHOSP_CONFIG.apiToken) ? SHOSP_CONFIG.apiToken : "",
    apiKey: envValue(SHOSP_CONFIG.apiKey) ? SHOSP_CONFIG.apiKey : "",
    companyId: envValue(SHOSP_CONFIG.companyId) ? SHOSP_CONFIG.companyId : "",
    username: envValue(SHOSP_CONFIG.username) ? SHOSP_CONFIG.username : "",
    password: envValue(SHOSP_CONFIG.password) ? SHOSP_CONFIG.password : "",
    timeoutMs: envValue(process.env.SHOSP_TIMEOUT_MS)
      ? SHOSP_CONFIG.timeoutMs
      : Number(persistedSettings.timeoutMs || SHOSP_CONFIG.timeoutMs),
    patientsPath: envValue(process.env.SHOSP_PATIENTS_PATH) ? SHOSP_CONFIG.patientsPath : String(persistedSettings.patientsPath || SHOSP_CONFIG.patientsPath),
    attendancesPath: envValue(process.env.SHOSP_ATTENDANCES_PATH) ? SHOSP_CONFIG.attendancesPath : String(persistedSettings.attendancesPath || SHOSP_CONFIG.attendancesPath),
    examsPath: envValue(process.env.SHOSP_EXAMS_PATH) ? SHOSP_CONFIG.examsPath : String(persistedSettings.examsPath || SHOSP_CONFIG.examsPath)
  };
}

function buildAuthenticationHeaders(runtimeConfig) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  // Estes headers ficam centralizados aqui para facilitar o ajuste quando a
  // documentacao oficial do Shosp estiver em maos.
  if (runtimeConfig.apiToken) {
    headers.Authorization = `Bearer ${runtimeConfig.apiToken}`;
  }
  if (runtimeConfig.apiKey) {
    headers["x-api-key"] = runtimeConfig.apiKey;
  }
  if (runtimeConfig.companyId) {
    headers["x-shosp-company-id"] = runtimeConfig.companyId;
  }
  if (runtimeConfig.username) {
    headers["x-shosp-username"] = runtimeConfig.username;
  }
  if (runtimeConfig.password) {
    headers["x-shosp-password"] = runtimeConfig.password;
  }

  return headers;
}

async function fetchJson(path, { updatedSince } = {}, extraQuery = {}) {
  const runtimeConfig = await getEffectiveShospRuntimeConfig();
  if (!runtimeConfig.baseUrl) {
    throw new Error("SHOSP_API_URL nao configurada.");
  }

  const url = new URL(path, runtimeConfig.baseUrl);
  if (updatedSince) {
    url.searchParams.set("updated_since", updatedSince);
  }
  Object.entries(extraQuery).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  let lastError = null;

  for (let attempt = 1; attempt <= SHOSP_CONFIG.retryAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), runtimeConfig.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: buildAuthenticationHeaders(runtimeConfig),
        signal: controller.signal
      });

      if (!response.ok) {
        const message = await response.text();
        const error = new Error(message || `Erro ao consultar Shosp em ${url.pathname}.`);
        error.statusCode = response.status;
        error.shospRecorded = true;
        recordShospApiFailure(Date.now() - startedAt, error);

        if (!shouldRetryShospRequest(response.status, attempt)) {
          throw error;
        }

        lastError = error;
      } else {
        recordShospApiSuccess(Date.now() - startedAt);
        return response.json();
      }
    } catch (error) {
      if (!error?.shospRecorded) {
        recordShospApiFailure(Date.now() - startedAt, error);
      }
      lastError = error;
      if (!shouldRetryShospError(error, attempt)) {
        throw error;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    await waitBeforeRetry(attempt);
  }

  throw lastError || new Error(`Falha ao consultar Shosp em ${url.pathname}.`);
}

function shouldRetryShospRequest(statusCode, attempt) {
  if (attempt >= SHOSP_CONFIG.retryAttempts) {
    return false;
  }

  return statusCode === 429 || statusCode >= 500;
}

function shouldRetryShospError(error, attempt) {
  if (attempt >= SHOSP_CONFIG.retryAttempts) {
    return false;
  }

  if (error?.name === "AbortError") {
    return true;
  }

  return !("statusCode" in (error || {}));
}

function waitBeforeRetry(attempt) {
  const delay = SHOSP_CONFIG.retryDelayMs * attempt;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function normalizeCollectionPayload(payload) {
  if (Array.isArray(payload)) {
    return {
      records: payload,
      nextCursor: null
    };
  }

  return {
    records: payload.items || payload.records || payload.data || [],
    nextCursor: payload.nextCursor || payload.next_cursor || payload.updatedUntil || null
  };
}

export function createShospApiClient() {
  return {
    async authenticate() {
      const runtimeConfig = await getEffectiveShospRuntimeConfig();
      const headers = buildAuthenticationHeaders(runtimeConfig);
      return {
        ok: Boolean(runtimeConfig.baseUrl && (headers.Authorization || headers["x-api-key"] || headers["x-shosp-username"])),
        mode: "live",
        headers
      };
    },
    async fetchPatients({ updatedSince } = {}) {
      const runtimeConfig = await getEffectiveShospRuntimeConfig();
      const payload = await fetchJson(runtimeConfig.patientsPath, { updatedSince });
      return normalizeCollectionPayload(payload);
    },
    async fetchAttendancesAndExams({ updatedSince } = {}) {
      const runtimeConfig = await getEffectiveShospRuntimeConfig();
      const payload = await fetchJson(runtimeConfig.attendancesPath, { updatedSince });
      return normalizeCollectionPayload(payload);
    },
    async fetchFutureScheduledExamForPatient({ externalPatientId, examCode } = {}) {
      const runtimeConfig = await getEffectiveShospRuntimeConfig();
      const payload = await fetchJson(runtimeConfig.attendancesPath, {
        updatedSince: null
      }, {
        patientId: externalPatientId,
        examCode,
        status: "agendado",
        futureOnly: "true"
      });

      const normalized = normalizeCollectionPayload(payload);
      return normalized.records.find((item) =>
        item.externalPatientId === externalPatientId &&
        (!examCode || item.examCode === examCode) &&
        item.scheduledDate &&
        item.completedDate == null
      ) || null;
    }
  };
}
