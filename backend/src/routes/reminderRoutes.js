import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import { getRemindersCenterDataCore, getRemindersCountCore, updateReminderStatusCore } from "../services/coreMigrationService.js";
import { recordAuditEvent } from "../services/auditService.js";

export const reminderRoutes = Router();

reminderRoutes.get("/", asyncRoute(async (request, response) => {
  recordAuditEvent({
    actorUserId: request.authUser?.id || null,
    actionType: "visualizacao_central_lembretes",
    entityType: "reminder_queue",
    description: "Central de lembretes visualizada."
  });
  response.json(await getRemindersCenterDataCore(request.query));
}, "Nao foi possivel carregar a central de lembretes."));

reminderRoutes.get("/count", asyncRoute(async (_request, response) => {
  response.json(await getRemindersCountCore());
}, "Nao foi possivel carregar a contagem de lembretes."));

reminderRoutes.patch("/:patientId/exams/:examPatientId", asyncRoute(async (request, response) => {
  try {
    const patientId = Number(request.params.patientId);
    const data = await updateReminderStatusCore(
      patientId,
      Number(request.params.examPatientId),
      request.body.action
    );
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "acao_central_lembretes",
      entityType: "patient_exam",
      entityId: Number(request.params.examPatientId),
      patientId,
      description: "Acao executada na central de lembretes.",
      details: { action: request.body.action }
    });
    response.json(data);
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o lembrete.");
  }
}, "Nao foi possivel atualizar o lembrete."));
