import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  confirmGestationalBaseEstimate,
  deletePatient,
  discardGestationalBaseEstimate,
  editGestationalBaseManually,
  listGestationalBaseReviews,
} from "../services/clinicService.js";
import {
  createPatientCore,
  getPatientDetailsCore,
  listPatientsCore,
  updatePatientCore,
  updatePatientExamStatusCore
} from "../services/coreMigrationService.js";
import { recordAuditEvent } from "../services/auditService.js";

export const patientRoutes = Router();

patientRoutes.get("/", async (_request, response) => {
  try {
    response.json({ patients: await listPatientsCore() });
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel listar as pacientes.");
  }
});

patientRoutes.get("/manual-review/gestational-base", (request, response) => {
  recordAuditEvent({
    actorUserId: request.authUser?.id || null,
    actionType: "visualizacao_fila_revisao_gestacional",
    entityType: "patient_review_queue",
    description: "Fila de revisao manual da base gestacional visualizada."
  });
  response.json({ items: listGestationalBaseReviews() });
});

patientRoutes.post("/:id/gestational-base/confirm", (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patient = confirmGestationalBaseEstimate(patientId, request.authUser?.id || 1);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "confirmacao_base_gestacional",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Estimativa da base gestacional confirmada manualmente."
    });
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel confirmar a estimativa.");
  }
});

patientRoutes.patch("/:id/gestational-base/manual", (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patient = editGestationalBaseManually(patientId, {
      ...request.body,
      actorUserId: request.authUser?.id || 1
    });
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_base_gestacional",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Base gestacional ajustada manualmente pela equipe.",
      details: {
        gestationalWeeks: request.body?.gestationalWeeks,
        gestationalDays: request.body?.gestationalDays
      }
    });
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel ajustar a base gestacional.");
  }
});

patientRoutes.post("/:id/gestational-base/discard", (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patient = discardGestationalBaseEstimate(patientId, request.authUser?.id || 1);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "descarte_estimativa_gestacional",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Estimativa da base gestacional descartada e enviada para revisao manual."
    });
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel descartar a estimativa.");
  }
});

patientRoutes.post("/", async (request, response) => {
  try {
    const patient = await createPatientCore({
      ...request.body,
      actorUserId: request.authUser?.id || 1
    });
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "cadastro_paciente",
      entityType: "patient",
      entityId: patient.patient.id,
      patientId: patient.patient.id,
      description: "Cadastro de paciente realizado.",
      details: { phone: request.body?.phone }
    });
    response.status(201).json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel salvar a paciente.");
  }
});

patientRoutes.put("/:id", async (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patient = await updatePatientCore(patientId, {
      ...request.body,
      actorUserId: request.authUser?.id || 1
    });
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_paciente",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Dados da paciente atualizados.",
      details: { phone: request.body?.phone }
    });
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a paciente.");
  }
});

patientRoutes.delete("/:id", requireAdmin, (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const result = deletePatient(patientId);
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "exclusao_paciente",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Paciente excluida do sistema.",
      details: {
        name: result.deletedPatient.name,
        phone: result.deletedPatient.phone
      }
    });
    response.json(result);
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel excluir a paciente.");
  }
});

patientRoutes.patch("/:id/exams/:examId", async (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patient = await updatePatientExamStatusCore(
      patientId,
      Number(request.params.examId),
      {
        ...request.body,
        actorUserId: request.authUser?.id || 1
      }
    );
    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "edicao_exame_paciente",
      entityType: "patient_exam",
      entityId: Number(request.params.examId),
      patientId,
      description: "Status ou agenda do exame da paciente foi atualizado.",
      details: { status: request.body?.status }
    });
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
  }
});

patientRoutes.get("/:id", async (request, response) => {
  try {
    const patientId = Number(request.params.id);
    const patientDetails = await getPatientDetailsCore(patientId);
    if (!patientDetails) {
      response.status(404).send("Paciente nao encontrada.");
      return;
    }

    recordAuditEvent({
      actorUserId: request.authUser?.id || null,
      actionType: "visualizacao_paciente",
      entityType: "patient",
      entityId: patientId,
      patientId,
      description: "Ficha detalhada da paciente visualizada."
    });
    response.json(patientDetails);
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar os detalhes da paciente.");
  }
});
