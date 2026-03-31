import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import {
  createAdminUserCore,
  createClinicUnitCore,
  createExamConfigCore,
  createPhysicianCore,
  deleteAdminUserCore,
  deleteClinicUnitCore,
  deleteExamConfigCore,
  deletePatientsByCreatedRangeCore,
  deletePhysicianCore,
  getAdminPanelDataCore,
  updateAdminUserCore,
  updateClinicUnitCore,
  updateExamConfigCore,
  updateExamInferenceRuleCore,
  updateMessageTemplateCore,
  updatePhysicianCore
} from "../services/coreMigrationService.js";
import { runMariaGertrudesOperationalTest } from "../services/operationalTestService.js";
import { getMessagingRuntimeConfig } from "../services/messaging/messagingService.js";

export const adminRoutes = Router();

function buildAdminPanelFallback() {
  let messagingConfig;
  try {
    messagingConfig = getMessagingRuntimeConfig();
  } catch (error) {
    console.error("[admin] Falha ao carregar configuracao de mensageria para fallback.", error);
    messagingConfig = {
      provider: "manual_stub",
      channel: "whatsapp",
      externalApiBaseUrl: "",
      externalApiToken: "",
      externalPhoneNumberId: "",
      templatesEnabled: true,
      dryRun: true,
      isExternalProviderConfigured: false
    };
  }

  return {
    users: [],
    units: [],
    physicians: [],
    examConfigs: [],
    examInferenceRules: [],
    messageTemplates: [],
    messageDeliveryLogs: [],
    messagingConfig
  };
}

adminRoutes.get("/", asyncRoute(async (_request, response) => {
  try {
    response.json(await getAdminPanelDataCore());
  } catch (error) {
    console.error("[admin] Falha ao carregar painel administrativo completo.", error);
    response.status(200).json(buildAdminPanelFallback());
  }
}, "Nao foi possivel carregar a area administrativa."));

adminRoutes.post("/users", asyncRoute(async (request, response) => {
  try {
    const user = await createAdminUserCore(request.body);
    response.status(201).json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o usuario.");
  }
}, "Nao foi possivel criar o usuario."));

adminRoutes.put("/users/:id", asyncRoute(async (request, response) => {
  try {
    const user = await updateAdminUserCore(Number(request.params.id), request.body);
    response.json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o usuario.");
  }
}, "Nao foi possivel atualizar o usuario."));

adminRoutes.delete("/users/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteAdminUserCore(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o usuario.");
  }
}, "Nao foi possivel excluir o usuario."));

adminRoutes.post("/units", asyncRoute(async (request, response) => {
  try {
    const unit = await createClinicUnitCore(request.body);
    response.status(201).json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar a unidade.");
  }
}, "Nao foi possivel criar a unidade."));

adminRoutes.put("/units/:id", asyncRoute(async (request, response) => {
  try {
    const unit = await updateClinicUnitCore(Number(request.params.id), request.body);
    response.json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a unidade.");
  }
}, "Nao foi possivel atualizar a unidade."));

adminRoutes.delete("/units/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteClinicUnitCore(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir a unidade.");
  }
}, "Nao foi possivel excluir a unidade."));

adminRoutes.post("/physicians", asyncRoute(async (request, response) => {
  try {
    const physician = await createPhysicianCore(request.body);
    response.status(201).json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o medico.");
  }
}, "Nao foi possivel criar o medico."));

adminRoutes.put("/physicians/:id", asyncRoute(async (request, response) => {
  try {
    const physician = await updatePhysicianCore(Number(request.params.id), request.body);
    response.json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o medico.");
  }
}, "Nao foi possivel atualizar o medico."));

adminRoutes.delete("/physicians/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deletePhysicianCore(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o medico.");
  }
}, "Nao foi possivel excluir o medico."));

adminRoutes.put("/exams/:id", asyncRoute(async (request, response) => {
  try {
    const examConfig = await updateExamConfigCore(Number(request.params.id), request.body);
    response.json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o exame.");
  }
}, "Nao foi possivel atualizar o exame."));

adminRoutes.post("/exams", asyncRoute(async (request, response) => {
  try {
    const examConfig = await createExamConfigCore(request.body);
    response.status(201).json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o exame.");
  }
}, "Nao foi possivel criar o exame."));

adminRoutes.delete("/exams/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteExamConfigCore(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o exame.");
  }
}, "Nao foi possivel excluir o exame."));

adminRoutes.put("/exam-inference-rules/:id", asyncRoute(async (request, response) => {
  try {
    const rule = await updateExamInferenceRuleCore(Number(request.params.id), request.body);
    response.json({ rule });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a regra de inferencia.");
  }
}, "Nao foi possivel atualizar a regra de inferencia."));

adminRoutes.put("/message-templates/:id", asyncRoute(async (request, response) => {
  try {
    const template = await updateMessageTemplateCore(Number(request.params.id), request.body);
    response.json({ template });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o template.");
  }
}, "Nao foi possivel atualizar o template."));

adminRoutes.post("/system-tests/maria-gertrudes", (_request, response) => {
  try {
    const result = runMariaGertrudesOperationalTest();
    response.json({ result });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel executar o teste operacional.");
  }
});

adminRoutes.post("/patients/cleanup", asyncRoute(async (request, response) => {
  try {
    const result = await deletePatientsByCreatedRangeCore({
      ...request.body,
      actorUserId: request.authUser?.id ?? null
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel limpar os pacientes nessa faixa.");
  }
}, "Nao foi possivel limpar os pacientes nessa faixa."));
