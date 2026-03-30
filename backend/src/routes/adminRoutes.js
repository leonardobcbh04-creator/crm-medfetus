import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import {
  createExamConfig,
  createAdminUser,
  createClinicUnit,
  createPhysician,
  deletePatientsByCreatedRange,
  deleteAdminUser,
  deleteClinicUnit,
  deleteExamConfig,
  deletePhysician,
  updateExamInferenceRule,
  updateMessageTemplate,
  updateAdminUser,
  updateClinicUnit,
  updateExamConfig,
  updatePhysician
} from "../services/clinicService.js";
import { getAdminPanelDataCore } from "../services/coreMigrationService.js";
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

adminRoutes.post("/users", (request, response) => {
  try {
    const user = createAdminUser(request.body);
    response.status(201).json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o usuario.");
  }
});

adminRoutes.put("/users/:id", (request, response) => {
  try {
    const user = updateAdminUser(Number(request.params.id), request.body);
    response.json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o usuario.");
  }
});

adminRoutes.delete("/users/:id", (request, response) => {
  try {
    const result = deleteAdminUser(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o usuario.");
  }
});

adminRoutes.post("/units", (request, response) => {
  try {
    const unit = createClinicUnit(request.body);
    response.status(201).json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar a unidade.");
  }
});

adminRoutes.put("/units/:id", (request, response) => {
  try {
    const unit = updateClinicUnit(Number(request.params.id), request.body);
    response.json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a unidade.");
  }
});

adminRoutes.delete("/units/:id", (request, response) => {
  try {
    const result = deleteClinicUnit(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir a unidade.");
  }
});

adminRoutes.post("/physicians", (request, response) => {
  try {
    const physician = createPhysician(request.body);
    response.status(201).json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o medico.");
  }
});

adminRoutes.put("/physicians/:id", (request, response) => {
  try {
    const physician = updatePhysician(Number(request.params.id), request.body);
    response.json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o medico.");
  }
});

adminRoutes.delete("/physicians/:id", (request, response) => {
  try {
    const result = deletePhysician(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o medico.");
  }
});

adminRoutes.put("/exams/:id", (request, response) => {
  try {
    const examConfig = updateExamConfig(Number(request.params.id), request.body);
    response.json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o exame.");
  }
});

adminRoutes.post("/exams", (request, response) => {
  try {
    const examConfig = createExamConfig(request.body);
    response.status(201).json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o exame.");
  }
});

adminRoutes.delete("/exams/:id", (request, response) => {
  try {
    const result = deleteExamConfig(Number(request.params.id));
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o exame.");
  }
});

adminRoutes.put("/exam-inference-rules/:id", (request, response) => {
  try {
    const rule = updateExamInferenceRule(Number(request.params.id), request.body);
    response.json({ rule });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a regra de inferencia.");
  }
});

adminRoutes.put("/message-templates/:id", (request, response) => {
  try {
    const template = updateMessageTemplate(Number(request.params.id), request.body);
    response.json({ template });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o template.");
  }
});

adminRoutes.post("/system-tests/maria-gertrudes", (_request, response) => {
  try {
    const result = runMariaGertrudesOperationalTest();
    response.json({ result });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel executar o teste operacional.");
  }
});

adminRoutes.post("/patients/cleanup", (request, response) => {
  try {
    const result = deletePatientsByCreatedRange({
      ...request.body,
      actorUserId: request.authUser?.id ?? null
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel limpar os pacientes nessa faixa.");
  }
});
