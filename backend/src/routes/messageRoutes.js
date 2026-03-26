import { Router } from "express";
import { handleRouteError } from "../http/routeUtils.js";
import { createMessage, getMessagingOverview, updateMessageStatus } from "../services/clinicService.js";
import { recordAuditEvent } from "../services/auditService.js";

export const messageRoutes = Router();

messageRoutes.get("/", (request, response) => {
  recordAuditEvent({
    actorUserId: request.authUser?.id || null,
    actionType: "visualizacao_mensagens",
    entityType: "messaging_queue",
    description: "Fila de mensagens automaticas visualizada."
  });
  response.json({ items: getMessagingOverview() });
});

messageRoutes.post("/", (request, response) => {
  try {
    const message = createMessage(request.body);
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
});

messageRoutes.patch("/:id", (request, response) => {
  try {
    const message = updateMessageStatus(Number(request.params.id), request.body);
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
});
