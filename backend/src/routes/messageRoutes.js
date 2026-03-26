import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import { createMessageCore, getMessagingOverviewCore, updateMessageStatusCore } from "../services/coreMigrationService.js";
import { recordAuditEvent } from "../services/auditService.js";

export const messageRoutes = Router();

messageRoutes.get("/", asyncRoute(async (request, response) => {
  recordAuditEvent({
    actorUserId: request.authUser?.id || null,
    actionType: "visualizacao_mensagens",
    entityType: "messaging_queue",
    description: "Fila de mensagens automaticas visualizada."
  });
  response.json({ items: await getMessagingOverviewCore() });
}, "Nao foi possivel carregar a fila de mensagens."));

messageRoutes.post("/", asyncRoute(async (request, response) => {
  try {
    const message = await createMessageCore(request.body);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "registro_mensagem",
      entityType: "message",
      entityId: message.id,
      patientId: message.patientId,
      description: "Mensagem registrada para a paciente."
    });
    response.status(201).json({ message });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel registrar a mensagem.");
  }
}, "Nao foi possivel registrar a mensagem."));

messageRoutes.patch("/:id", asyncRoute(async (request, response) => {
  try {
    const message = await updateMessageStatusCore(Number(request.params.id), request.body);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "atualizacao_mensagem",
      entityType: "message",
      entityId: message.id,
      patientId: message.patientId,
      description: "Status da mensagem atualizado."
    });
    response.json({ message });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar a mensagem.");
  }
}, "Nao foi possivel atualizar a mensagem."));
