import { Router } from "express";
import {
  createPatient,
  getPatientDetails,
  listPatients,
  updatePatient,
  updatePatientExamStatus
} from "../services/clinicService.js";

export const patientRoutes = Router();

patientRoutes.get("/", (_request, response) => {
  response.json({ patients: listPatients() });
});

patientRoutes.post("/", (request, response) => {
  try {
    const patient = createPatient(request.body);
    response.status(201).json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel salvar a paciente.");
  }
});

patientRoutes.put("/:id", (request, response) => {
  try {
    const patient = updatePatient(Number(request.params.id), request.body);
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a paciente.");
  }
});

patientRoutes.patch("/:id/exams/:examId", (request, response) => {
  try {
    const patient = updatePatientExamStatus(
      Number(request.params.id),
      Number(request.params.examId),
      request.body
    );
    response.json({ patient });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar o exame.");
  }
});

patientRoutes.get("/:id", (request, response) => {
  const patientDetails = getPatientDetails(Number(request.params.id));
  if (!patientDetails) {
    response.status(404).send("Paciente nao encontrada.");
    return;
  }

  response.json(patientDetails);
});
