import { NODE_ENV, SHOSP_CONFIG } from "../../config.js";
import { runShospIncrementalSync } from "./shospIntegrationService.js";

let intervalId = null;
let running = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;

async function executeScheduledSync(trigger = "manual") {
  if (running) {
    return {
      ok: false,
      skipped: true,
      message: "Sincronizacao com o Shosp ja esta em andamento."
    };
  }

  running = true;

  try {
    const result = await runShospIncrementalSync({ incremental: true });
    lastRunAt = new Date().toISOString();
    lastResult = {
      trigger,
      ok: result.ok,
      patients: result.patients?.recordsProcessed || 0,
      attendances: result.attendances?.recordsProcessed || 0
    };
    lastError = result.ok ? null : result.patients?.errorMessage || result.attendances?.errorMessage || "Falha na sincronizacao incremental.";
    return result;
  } catch (error) {
    lastRunAt = new Date().toISOString();
    lastError = error instanceof Error ? error.message : "Falha inesperada na sincronizacao com o Shosp.";
    return {
      ok: false,
      mode: SHOSP_CONFIG.mode,
      patients: null,
      attendances: null,
      errorMessage: lastError
    };
  } finally {
    running = false;
  }
}

export function startShospSyncWorker() {
  if (!SHOSP_CONFIG.enabled || intervalId || SHOSP_CONFIG.syncIntervalMs <= 0) {
    return;
  }

  intervalId = setInterval(() => {
    void executeScheduledSync("interval");
  }, SHOSP_CONFIG.syncIntervalMs);

  if (typeof intervalId.unref === "function") {
    intervalId.unref();
  }

  if (NODE_ENV === "production") {
    setTimeout(() => {
      void executeScheduledSync("startup");
    }, 1500);
  }
}

export function stopShospSyncWorker() {
  if (!intervalId) {
    return;
  }

  clearInterval(intervalId);
  intervalId = null;
}

export function getShospSyncWorkerStatus() {
  return {
    enabled: SHOSP_CONFIG.enabled && SHOSP_CONFIG.syncIntervalMs > 0,
    running,
    intervalMs: SHOSP_CONFIG.syncIntervalMs,
    lastRunAt,
    lastResult,
    lastError
  };
}

export async function triggerShospSyncWorkerRun() {
  return executeScheduledSync("manual");
}
