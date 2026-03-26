import { Router } from "express";
import { getRemindersCenterData, getRemindersCount, updateReminderStatus } from "../services/clinicService.js";

export const reminderRoutes = Router();

reminderRoutes.get("/", (request, response) => {
  response.json(getRemindersCenterData(request.query));
});

reminderRoutes.get("/count", (_request, response) => {
  response.json(getRemindersCount());
});

reminderRoutes.patch("/:patientId/exams/:examPatientId", (request, response) => {
  try {
    const data = updateReminderStatus(
      Number(request.params.patientId),
      Number(request.params.examPatientId),
      request.body.action
    );
    response.json(data);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o lembrete.");
  }
});
