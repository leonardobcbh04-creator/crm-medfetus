import { Router } from "express";
import { createKanbanColumn, deleteKanbanColumn, getKanbanData, movePatientStage, updateKanbanColumn } from "../services/clinicService.js";

export const kanbanRoutes = Router();

kanbanRoutes.get("/", (_request, response) => {
  response.json({ columns: getKanbanData() });
});

kanbanRoutes.patch("/move", (request, response) => {
  try {
    const patient = movePatientStage(Number(request.body.patientId), String(request.body.stage));
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel mover a paciente.");
  }
});

kanbanRoutes.post("/columns", (request, response) => {
  try {
    const columns = createKanbanColumn(request.body);
    response.status(201).json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel criar a coluna.");
  }
});

kanbanRoutes.put("/columns/:id", (request, response) => {
  try {
    const columns = updateKanbanColumn(String(request.params.id), request.body);
    response.json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a coluna.");
  }
});

kanbanRoutes.delete("/columns/:id", (request, response) => {
  try {
    const columns = deleteKanbanColumn(String(request.params.id));
    response.json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir a coluna.");
  }
});
