import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  getBabyVaccineRemindersCore,
  getVaccinesMenuCountCore,
  listBabyVaccineCatalogCore,
  setBabyVaccineContactCore,
  updateBabyVaccineCatalogCore,
  getDtpaCampaignCore,
  getDtpaCampaignCountCore,
  setVaccineContactCore
} from "../services/coreMigrationService.js";
import { recordAuditEvent } from "../services/auditService.js";

// Tela "Vacinas" (campanha dTpa). Visivel para todos os perfis autenticados.
export const vaccineRoutes = Router();

vaccineRoutes.get("/dtpa", async (_request, response) => {
  try {
    response.json(await getDtpaCampaignCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar a tela de vacinas.");
  }
});

vaccineRoutes.get("/dtpa/count", async (_request, response) => {
  try {
    response.json(await getDtpaCampaignCountCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel contar as pacientes.");
  }
});

vaccineRoutes.put("/dtpa/:patientId/contact", async (request, response) => {
  try {
    const patientId = Number(request.params.patientId);
    const contacted = Boolean(request.body?.contacted);
    const data = await setVaccineContactCore(patientId, contacted, request.authUser?.id);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: contacted ? "vacina_contatada" : "vacina_contato_desfeito",
      entityType: "patient_vaccine",
      entityId: patientId,
      patientId,
      description: contacted ? "Paciente marcada como contatada na tela Vacinas." : "Marca de contatada removida na tela Vacinas."
    });
    response.json(data);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o contato.");
  }
});

vaccineRoutes.get("/count", async (_request, response) => {
  try {
    response.json(await getVaccinesMenuCountCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel contar as pacientes.");
  }
});

vaccineRoutes.get("/baby", async (_request, response) => {
  try {
    response.json(await getBabyVaccineRemindersCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar os avisos de vacina do bebe.");
  }
});

vaccineRoutes.put("/baby/:patientId/:ageMonths/contact", async (request, response) => {
  try {
    const patientId = Number(request.params.patientId);
    const ageMonths = Number(request.params.ageMonths);
    const contacted = Boolean(request.body?.contacted);
    const data = await setBabyVaccineContactCore(patientId, ageMonths, contacted, request.authUser?.id);
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: contacted ? "vacina_bebe_contatada" : "vacina_bebe_contato_desfeito",
      entityType: "patient_vaccine",
      entityId: patientId,
      patientId,
      description: contacted
        ? `Mae contatada sobre as vacinas do bebe (${ageMonths} meses).`
        : `Marca de contato das vacinas do bebe (${ageMonths} meses) removida.`
    });
    response.json(data);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o contato.");
  }
});

vaccineRoutes.get("/baby/catalog", async (_request, response) => {
  try {
    response.json(await listBabyVaccineCatalogCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar a lista de vacinas do bebe.");
  }
});

vaccineRoutes.patch("/baby/catalog/:id", requireAdmin, async (request, response) => {
  try {
    const data = await updateBabyVaccineCatalogCore(Number(request.params.id), request.body || {});
    await recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "vacina_bebe_lista_atualizada",
      entityType: "baby_vaccine_catalog",
      entityId: Number(request.params.id),
      description: "Lista de vacinas do bebe atualizada.",
      details: request.body || {}
    });
    response.json(data);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a vacina.");
  }
});
