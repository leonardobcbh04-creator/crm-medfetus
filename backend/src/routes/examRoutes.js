import { Router } from "express";
import { applyExamProtocolPreset, listExamConfigs, listExamProtocolPresets, updateExamConfig } from "../services/clinicService.js";

export const examRoutes = Router();

examRoutes.get("/", (_request, response) => {
  response.json({
    examConfigs: listExamConfigs(),
    presets: listExamProtocolPresets()
  });
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
