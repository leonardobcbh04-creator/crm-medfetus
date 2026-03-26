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
  response.json(getShospIntegrationStatus());
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
  response.json({ mappings: listShospExamMappings() });
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
