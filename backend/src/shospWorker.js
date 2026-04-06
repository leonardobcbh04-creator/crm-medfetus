import { NODE_ENV } from "./config.js";
import { getDatabaseRuntime } from "./database/runtime.js";
import { startLogRetentionWorker, stopLogRetentionWorker } from "./services/logRetentionService.js";
import { getShospSyncWorkerStatus, startShospSyncWorker, stopShospSyncWorker } from "./services/shospIntegration/shospSyncWorker.js";

await getDatabaseRuntime();
startShospSyncWorker();
startLogRetentionWorker();

const workerStatus = getShospSyncWorkerStatus();
console.log(
  `Worker do Shosp iniciado em modo ${NODE_ENV}. ` +
  (workerStatus.enabled
    ? `Sincronizacao periodica a cada ${workerStatus.intervalMs} ms.`
    : "Sincronizacao periodica desativada (SHOSP_SYNC_INTERVAL=0).")
);

function shutdown() {
  stopShospSyncWorker();
  stopLogRetentionWorker();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
