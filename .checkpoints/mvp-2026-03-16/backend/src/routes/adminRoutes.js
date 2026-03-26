import { Router } from "express";
import {
  createAdminUser,
  createClinicUnit,
  createPhysician,
  deleteAdminUser,
  deleteClinicUnit,
  deletePhysician,
  getAdminPanelData,
  updateMessageTemplate,
  updateAdminUser,
  updateClinicUnit,
  updateExamConfig,
  updatePhysician
} from "../services/clinicService.js";

export const adminRoutes = Router();

adminRoutes.get("/", (_request, response) => {
  response.json(getAdminPanelData());
});

adminRoutes.post("/users", (request, response) => {
  try {
    const user = createAdminUser(request.body);
    response.status(201).json({ user });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel criar o usuario.");
  }
});

adminRoutes.put("/users/:id", (request, response) => {
  try {
    const user = updateAdminUser(Number(request.params.id), request.body);
    response.json({ user });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o usuario.");
  }
});

adminRoutes.delete("/users/:id", (request, response) => {
  try {
    const result = deleteAdminUser(Number(request.params.id));
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir o usuario.");
  }
});

adminRoutes.post("/units", (request, response) => {
  try {
    const unit = createClinicUnit(request.body);
    response.status(201).json({ unit });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel criar a unidade.");
  }
});

adminRoutes.put("/units/:id", (request, response) => {
  try {
    const unit = updateClinicUnit(Number(request.params.id), request.body);
    response.json({ unit });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a unidade.");
  }
});

adminRoutes.delete("/units/:id", (request, response) => {
  try {
    const result = deleteClinicUnit(Number(request.params.id));
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir a unidade.");
  }
});

adminRoutes.post("/physicians", (request, response) => {
  try {
    const physician = createPhysician(request.body);
    response.status(201).json({ physician });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel criar o medico.");
  }
});

adminRoutes.put("/physicians/:id", (request, response) => {
  try {
    const physician = updatePhysician(Number(request.params.id), request.body);
    response.json({ physician });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o medico.");
  }
});

adminRoutes.delete("/physicians/:id", (request, response) => {
  try {
    const result = deletePhysician(Number(request.params.id));
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir o medico.");
  }
});

adminRoutes.put("/exams/:id", (request, response) => {
  try {
    const examConfig = updateExamConfig(Number(request.params.id), request.body);
    response.json({ examConfig });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
  }
});

adminRoutes.put("/message-templates/:id", (request, response) => {
  try {
    const template = updateMessageTemplate(Number(request.params.id), request.body);
    response.json({ template });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o template.");
  }
});
