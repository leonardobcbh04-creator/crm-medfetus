import { Router } from "express";
import { asyncRoute, handleRouteError } from "../http/routeUtils.js";
import {
  createKanbanColumnCore,
  deleteKanbanColumnCore,
  getKanbanDataCore,
  movePatientStageCore,
  updateKanbanColumnCore
} from "../services/coreMigrationService.js";

export const kanbanRoutes = Router();

kanbanRoutes.get("/", asyncRoute(async (_request, response) => {
  response.json({ columns: await getKanbanDataCore() });
}, "Nao foi possivel carregar o pipeline."));

kanbanRoutes.patch("/move", asyncRoute(async (request, response) => {
  try {
    const patient = await movePatientStageCore(Number(request.body.patientId), String(request.body.stage));
    response.json({ patient });
  } catch (error) {
    handleRouteError(response, error, "Nao foi possivel mover a paciente.");
  }
}, "Nao foi possivel mover a paciente."));

kanbanRoutes.post("/columns", asyncRoute(async (request, response) => {
  try {
    const columns = await createKanbanColumnCore(request.body);
    response.status(201).json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel criar a coluna.");
  }
}, "Nao foi possivel criar a coluna."));

kanbanRoutes.put("/columns/:id", asyncRoute(async (request, response) => {
  try {
    const columns = await updateKanbanColumnCore(String(request.params.id), request.body);
    response.json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a coluna.");
  }
}, "Nao foi possivel atualizar a coluna."));

kanbanRoutes.delete("/columns/:id", asyncRoute(async (request, response) => {
  try {
    const columns = await deleteKanbanColumnCore(String(request.params.id));
    response.json({ columns });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir a coluna.");
  }
}, "Nao foi possivel excluir a coluna."));
