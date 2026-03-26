import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import { getRemindersCenterData, getRemindersCount, updateReminderStatus } from "../services/clinicService.js";
import { recordAuditEvent } from "../services/auditService.js";

export const reminderRoutes = Router();

reminderRoutes.get("/", asyncRoute(async (request, response) => {
  recordAuditEvent({
    actorUserId: request.authUser?.id || null,
    actionType: "visualizacao_central_lembretes",
    entityType: "reminder_queue",
    description: "Central de lembretes visualizada."
  });
  response.json(await getRemindersCenterData(request.query));
}, "Nao foi possivel carregar a central de lembretes."));

reminderRoutes.get("/count", asyncRoute(async (_request, response) => {
  response.json(await getRemindersCount());
}, "Nao foi possivel carregar a contagem de lembretes."));

reminderRoutes.patch("/:patientId/exams/:examPatientId", (request, response) => {
  try {
    const patientId = Number(request.params.patientId);
    const data = updateReminderStatus(
      patientId,
      Number(request.params.examPatientId),
      request.body.action
    );
    Promise.resolve(data)
      .then((result) => {
        recordAuditEvent({
          actorUserId: request.authUser?.id || null,
          actionType: "acao_central_lembretes",
          entityType: "patient_exam",
          entityId: Number(request.params.examPatientId),
          patientId,
          description: "Acao executada na central de lembretes.",
          details: { action: request.body.action }
        });
        response.json(result);
      })
      .catch((error) => handleRouteError(response, error, "Nao foi possivel atualizar o lembrete."));
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel atualizar o lembrete.");
  }
});
