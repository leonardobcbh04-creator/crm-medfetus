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
import { recordAuditEvent } from "../services/auditService.js";

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
    recentAuditLogs: [],
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
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "cadastro_usuario_admin",
      entityType: "user",
      entityId: user.id,
      description: "Usuario criado na area administrativa.",
      details: { name: user.name, email: user.email, role: user.role }
    });
    response.status(201).json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o usuario.");
  }
}, "Nao foi possivel criar o usuario."));

adminRoutes.put("/users/:id", asyncRoute(async (request, response) => {
  try {
    const user = await updateAdminUserCore(Number(request.params.id), request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_usuario_admin",
      entityType: "user",
      entityId: user.id,
      description: "Usuario atualizado na area administrativa.",
      details: { name: user.name, email: user.email, role: user.role, active: user.active }
    });
    response.json({ user });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o usuario.");
  }
}, "Nao foi possivel atualizar o usuario."));

adminRoutes.delete("/users/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteAdminUserCore(Number(request.params.id));
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "exclusao_usuario_admin",
      entityType: "user",
      entityId: Number(request.params.id),
      description: "Usuario removido na area administrativa."
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o usuario.");
  }
}, "Nao foi possivel excluir o usuario."));

adminRoutes.post("/units", asyncRoute(async (request, response) => {
  try {
    const unit = await createClinicUnitCore(request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "cadastro_unidade_admin",
      entityType: "clinic_unit",
      entityId: unit.id,
      description: "Unidade criada na area administrativa.",
      details: { name: unit.name, active: unit.active }
    });
    response.status(201).json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar a unidade.");
  }
}, "Nao foi possivel criar a unidade."));

adminRoutes.put("/units/:id", asyncRoute(async (request, response) => {
  try {
    const unit = await updateClinicUnitCore(Number(request.params.id), request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_unidade_admin",
      entityType: "clinic_unit",
      entityId: unit.id,
      description: "Unidade atualizada na area administrativa.",
      details: { name: unit.name, active: unit.active }
    });
    response.json({ unit });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a unidade.");
  }
}, "Nao foi possivel atualizar a unidade."));

adminRoutes.delete("/units/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteClinicUnitCore(Number(request.params.id));
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "exclusao_unidade_admin",
      entityType: "clinic_unit",
      entityId: Number(request.params.id),
      description: "Unidade removida na area administrativa."
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir a unidade.");
  }
}, "Nao foi possivel excluir a unidade."));

adminRoutes.post("/physicians", asyncRoute(async (request, response) => {
  try {
    const physician = await createPhysicianCore(request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "cadastro_medico_admin",
      entityType: "physician",
      entityId: physician.id,
      description: "Medico criado na area administrativa.",
      details: { name: physician.name, clinicUnitName: physician.clinicUnitName, active: physician.active }
    });
    response.status(201).json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o medico.");
  }
}, "Nao foi possivel criar o medico."));

adminRoutes.put("/physicians/:id", asyncRoute(async (request, response) => {
  try {
    const physician = await updatePhysicianCore(Number(request.params.id), request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_medico_admin",
      entityType: "physician",
      entityId: physician.id,
      description: "Medico atualizado na area administrativa.",
      details: { name: physician.name, clinicUnitName: physician.clinicUnitName, active: physician.active }
    });
    response.json({ physician });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o medico.");
  }
}, "Nao foi possivel atualizar o medico."));

adminRoutes.delete("/physicians/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deletePhysicianCore(Number(request.params.id));
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "exclusao_medico_admin",
      entityType: "physician",
      entityId: Number(request.params.id),
      description: "Medico removido na area administrativa."
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o medico.");
  }
}, "Nao foi possivel excluir o medico."));

adminRoutes.put("/exams/:id", asyncRoute(async (request, response) => {
  try {
    const examConfig = await updateExamConfigCore(Number(request.params.id), request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_exame_admin",
      entityType: "exam_config",
      entityId: examConfig.id,
      description: "Configuracao de exame atualizada na area administrativa.",
      details: { name: examConfig.name, code: examConfig.code, active: examConfig.active }
    });
    response.json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o exame.");
  }
}, "Nao foi possivel atualizar o exame."));

adminRoutes.post("/exams", asyncRoute(async (request, response) => {
  try {
    const examConfig = await createExamConfigCore(request.body);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "cadastro_exame_admin",
      entityType: "exam_config",
      entityId: examConfig.id,
      description: "Configuracao de exame criada na area administrativa.",
      details: { name: examConfig.name, code: examConfig.code, active: examConfig.active }
    });
    response.status(201).json({ examConfig });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel criar o exame.");
  }
}, "Nao foi possivel criar o exame."));

adminRoutes.delete("/exams/:id", asyncRoute(async (request, response) => {
  try {
    const result = await deleteExamConfigCore(Number(request.params.id));
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "exclusao_exame_admin",
      entityType: "exam_config",
      entityId: Number(request.params.id),
      description: "Configuracao de exame removida na area administrativa.",
      details: { name: result.deletedExam?.name || null }
    });
    response.json(result);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel excluir o exame.");
  }
}, "Nao foi possivel excluir o exame."));

adminRoutes.put("/exam-inference-rules/:id", asyncRoute(async (request, response) => {
  try {
    const rule = await updateExamInferenceRuleCore(Number(request.params.id), request.body);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_regra_inferencia_admin",
      entityType: "exam_inference_rule",
      entityId: rule.id,
      description: "Regra de inferencia gestacional atualizada.",
      details: { examCode: rule.examCode, examName: rule.examName, active: rule.active }
    });
    response.json({ rule });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a regra de inferencia.");
  }
}, "Nao foi possivel atualizar a regra de inferencia."));

adminRoutes.put("/message-templates/:id", asyncRoute(async (request, response) => {
  try {
    const template = await updateMessageTemplateCore(Number(request.params.id), request.body);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_template_mensagem_admin",
      entityType: "message_template",
      entityId: template.id,
      description: "Template de mensagem atualizado na area administrativa.",
      details: { name: template.name, code: template.code, active: template.active }
    });
    response.json({ template });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o template.");
  }
}, "Nao foi possivel atualizar o template."));

adminRoutes.post("/system-tests/maria-gertrudes", asyncRoute(async (_request, response) => {
  try {
    const result = await runMariaGertrudesOperationalTest();
    response.json({ result });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel executar o teste operacional.");
  }
}, "Nao foi possivel executar o teste operacional."));

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
