import { Router } from "express";
import {
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
