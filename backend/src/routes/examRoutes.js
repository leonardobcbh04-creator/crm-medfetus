import { Router } from "express";
import { applyExamProtocolPreset, updateExamConfig } from "../services/clinicService.js";
import { listExamConfigsCore } from "../services/coreMigrationService.js";

export const examRoutes = Router();

examRoutes.get("/", async (_request, response) => {
  try {
    response.json(await listExamConfigsCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar os exames.");
  }
});

examRoutes.put("/:id", (request, response) => {
  const examConfig = updateExamConfig(Number(request.params.id), request.body);
  response.json({ examConfig });
});

examRoutes.post("/apply-preset", (request, response) => {
  try {
    const result = applyExamProtocolPreset(String(request.body.presetId || ""));
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel aplicar o protocolo sugerido.");
  }
});
