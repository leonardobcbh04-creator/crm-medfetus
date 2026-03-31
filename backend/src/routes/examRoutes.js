import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  applyExamProtocolPresetCore,
  listExamConfigsCore,
  updateExamConfigCore
} from "../services/coreMigrationService.js";

export const examRoutes = Router();

examRoutes.get("/", async (_request, response) => {
  try {
    response.json(await listExamConfigsCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar os exames.");
  }
});

examRoutes.put("/:id", requireAdmin, async (request, response) => {
  try {
    const examConfig = await updateExamConfigCore(Number(request.params.id), request.body);
    response.json({ examConfig });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
  }
});

examRoutes.post("/apply-preset", requireAdmin, async (request, response) => {
  try {
    const result = await applyExamProtocolPresetCore(String(request.body.presetId || ""));
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel aplicar o protocolo sugerido.");
  }
});
