import { SHOSP_CONFIG } from "../../config.js";
import { todayIso } from "../../utils/date.js";
import { getShospApiRuntimeMetrics, resetShospApiRuntimeMetrics } from "./shospApiClient.js";
import { getShospSyncWorkerStatus } from "./shospSyncWorker.js";

function buildUnavailableShospStatus(message = "Shosp integration disabled") {
  return {
    mode: "unavailable",
    configured: false,
    connection: {
      connected: false,
      label: "Indisponivel",
      detail: message
    },
    summary: {
      lastSyncAt: null,
      patientsSynced: 0,
      examsImported: 0,
      detectedSchedules: 0,
      recentErrorsCount: 0,
      recentErrors: []
    },
    apiMetrics: {
      ...getShospApiRuntimeMetrics(),
      lastErrorMessage: message
    },
    worker: {
      ...getShospSyncWorkerStatus(),
      enabled: false,
      lastError: message
    },
    settings: {
      baseUrl: "",
      patientsPath: "",
      attendancesPath: "",
      examsPath: "",
      timeoutMs: 0
    },
    persistedConfig: null,
    cursors: [],
    logs: []
  };
}

function buildDisabledResult(scope = "disabled") {
  return {
    ok: false,
    scope,
    mode: "disabled",
    incremental: true,
    recordsReceived: 0,
    recordsProcessed: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    skipped: [],
    errorMessage: "Shosp integration disabled"
  };
}

export async function getShospIntegrationStatus() {
  return buildUnavailableShospStatus(SHOSP_CONFIG.enabled ? "Shosp integration unavailable" : "Shosp integration disabled");
}

export async function listShospExamMappings() {
  return [];
}

export async function updateShospExamMapping() {
  throw new Error("Shosp integration disabled");
}

export async function updateShospIntegrationSettings() {
  return buildUnavailableShospStatus("Shosp integration disabled");
}

export async function testShospConnection() {
  return {
    ok: false,
    mode: "disabled",
    simulated: true,
    message: "Shosp integration disabled",
    checkedAt: todayIso(),
    details: {
      source: "disabled"
    }
  };
}

export async function testShospLiveConnection() {
  return testShospConnection();
}

export async function syncShospPatients() {
  return buildDisabledResult("patients");
}

export async function syncShospExamsAndAttendances() {
  return buildDisabledResult("attendances");
}

export async function runShospIncrementalSync() {
  return {
    ok: false,
    mode: "disabled",
    patients: null,
    attendances: null,
    errorMessage: "Shosp integration disabled"
  };
}

export async function reprocessShospData() {
  return runShospIncrementalSync();
}

export async function lookupFutureScheduledExamInShosp() {
  return null;
}

export function resetShospReminderLookupCache() {}

export function clearShospSynchronizationCache() {
  resetShospApiRuntimeMetrics();
  return {
    ok: true,
    clearedReminderEntries: 0,
    clearedAt: todayIso()
  };
}
