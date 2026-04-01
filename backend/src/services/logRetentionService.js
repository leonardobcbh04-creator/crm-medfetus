import { LOG_RETENTION_CONFIG } from "../config.js";
import { getConfiguredDatabaseKind, getDatabaseRuntime } from "../database/runtime.js";

let cleanupIntervalId = null;
let running = false;
let lastRunAt = null;
let lastResult = null;
let lastError = null;

function timestampIso() {
  return new Date().toISOString();
}

function cutoffIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - Number(days || 0));
  return date.toISOString();
}

async function deleteBeforeDate(tableName, columnExpression, cutoff) {
  if (getConfiguredDatabaseKind() === "sqlite") {
    const runtime = await getDatabaseRuntime();
    const statement = runtime.raw.prepare(`
      DELETE FROM ${tableName}
      WHERE ${columnExpression} < ?
    `);
    return statement.run(cutoff).changes;
  }

  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    DELETE FROM ${tableName}
    WHERE ${columnExpression} < $1
  `, [cutoff]);
  return Number(result.rowCount || 0);
}

export async function runLogRetentionCleanup(trigger = "manual") {
  if (running) {
    return {
      ok: false,
      skipped: true,
      message: "Limpeza de retencao ja esta em andamento."
    };
  }

  running = true;

  try {
    const auditCutoff = cutoffIso(LOG_RETENTION_CONFIG.auditLogsDays);
    const syncCutoff = cutoffIso(LOG_RETENTION_CONFIG.syncLogsDays);
    const messageCutoff = cutoffIso(LOG_RETENTION_CONFIG.messageLogsDays);

    const deletedAuditLogs = await deleteBeforeDate("audit_logs", "created_at", auditCutoff);
    const deletedSyncLogs = await deleteBeforeDate("logs_de_sincronizacao", "COALESCE(finished_at, started_at)", syncCutoff);
    const deletedLegacySyncLogs = await deleteBeforeDate("shosp_sync_logs", "COALESCE(finished_at, started_at)", syncCutoff);
    const deletedMessageLogs = await deleteBeforeDate("message_delivery_logs", "created_at", messageCutoff);

    lastRunAt = timestampIso();
    lastError = null;
    lastResult = {
      trigger,
      ok: true,
      deletedAuditLogs,
      deletedSyncLogs: deletedSyncLogs + deletedLegacySyncLogs,
      deletedMessageLogs,
      retention: {
        auditLogsDays: LOG_RETENTION_CONFIG.auditLogsDays,
        syncLogsDays: LOG_RETENTION_CONFIG.syncLogsDays,
        messageLogsDays: LOG_RETENTION_CONFIG.messageLogsDays
      }
    };

    return lastResult;
  } catch (error) {
    lastRunAt = timestampIso();
    lastError = error instanceof Error ? error.message : "Falha inesperada na limpeza de logs por retencao.";
    lastResult = {
      trigger,
      ok: false,
      errorMessage: lastError
    };
    return lastResult;
  } finally {
    running = false;
  }
}

export function startLogRetentionWorker() {
  const intervalMs = LOG_RETENTION_CONFIG.cleanupIntervalHours * 60 * 60 * 1000;
  if (cleanupIntervalId || intervalMs <= 0) {
    return;
  }

  cleanupIntervalId = setInterval(() => {
    void runLogRetentionCleanup("interval");
  }, intervalMs);

  if (typeof cleanupIntervalId.unref === "function") {
    cleanupIntervalId.unref();
  }

  setTimeout(() => {
    void runLogRetentionCleanup("startup");
  }, 1200);
}

export function stopLogRetentionWorker() {
  if (!cleanupIntervalId) {
    return;
  }

  clearInterval(cleanupIntervalId);
  cleanupIntervalId = null;
}

export function getLogRetentionWorkerStatus() {
  return {
    enabled: LOG_RETENTION_CONFIG.cleanupIntervalHours > 0,
    running,
    intervalHours: LOG_RETENTION_CONFIG.cleanupIntervalHours,
    lastRunAt,
    lastResult,
    lastError
  };
}
