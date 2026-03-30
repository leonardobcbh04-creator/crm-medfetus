import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import {
  clearShospSynchronizationCache,
  getShospIntegrationStatus,
  listShospExamMappings,
  reprocessShospData,
  runShospIncrementalSync,
  syncShospExamsAndAttendances,
  syncShospPatients,
  testShospConnection,
  testShospLiveConnection,
  updateShospExamMapping,
  updateShospIntegrationSettings
} from "../services/shospIntegration/shospIntegrationService.js";

export const shospRoutes = Router();

shospRoutes.get("/status", (_request, response) => {
  try {
    response.json(getShospIntegrationStatus());
  } catch (error) {
    console.error("[shosp-route] Falha ao responder status da integracao.", error);
    response.status(200).json({
      mode: "unavailable",
      configured: false,
      connection: {
        connected: false,
        label: "Indisponivel",
        detail: "Shosp integration not configured"
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
        totalRequests: 0,
        successfulRequests: 0,
        totalResponseMs: 0,
        averageResponseMs: null,
        lastResponseMs: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastErrorMessage: "Shosp integration not configured"
      },
      worker: {
        enabled: false,
        running: false,
        intervalMs: 0,
        lastRunAt: null,
        lastResult: null,
        lastError: "Shosp integration not configured"
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
    });
  }
});

shospRoutes.put("/settings", (request, response) => {
  try {
    const status = updateShospIntegrationSettings(request.body);
    response.json(status);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar as configuracoes do Shosp.");
  }
});

shospRoutes.post("/test-connection", (_request, response) => {
  response.json(testShospConnection());
});

shospRoutes.post("/test-live-connection", asyncRoute(async (_request, response) => {
  response.json(await testShospLiveConnection());
}, "Nao foi possivel testar a conexao live com o Shosp."));

shospRoutes.get("/exam-mappings", (_request, response) => {
  try {
    response.json({ mappings: listShospExamMappings() });
  } catch (error) {
    console.error("[shosp-route] Falha ao responder mapeamentos de exame.", error);
    response.status(200).json({ mappings: [] });
  }
});

shospRoutes.put("/exam-mappings/:id", (request, response) => {
  try {
    const mapping = updateShospExamMapping(Number(request.params.id), request.body);
    response.json({ mapping });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o mapeamento do Shosp.");
  }
});

shospRoutes.post("/sync/patients", asyncRoute(async (request, response) => {
  const result = await syncShospPatients({ incremental: request.body?.incremental !== false });
  response.json(result);
}, "Nao foi possivel sincronizar pacientes do Shosp."));

shospRoutes.post("/sync/attendances", asyncRoute(async (request, response) => {
  const result = await syncShospExamsAndAttendances({ incremental: request.body?.incremental !== false });
  response.json(result);
}, "Nao foi possivel sincronizar atendimentos do Shosp."));

shospRoutes.post("/sync/full", asyncRoute(async (request, response) => {
  const result = await runShospIncrementalSync({ incremental: request.body?.incremental !== false });
  response.json(result);
}, "Nao foi possivel executar a sincronizacao completa do Shosp."));

shospRoutes.post("/reprocess", asyncRoute(async (_request, response) => {
  const result = await reprocessShospData();
  response.json(result);
}, "Nao foi possivel reprocessar os dados do Shosp."));

shospRoutes.post("/cache/clear", (_request, response) => {
  response.json(clearShospSynchronizationCache());
});
