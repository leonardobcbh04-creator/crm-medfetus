import { Router } from "express";
import { createMessage, getMessagingOverview, updateMessageStatus } from "../services/clinicService.js";

export const messageRoutes = Router();

messageRoutes.get("/", (_request, response) => {
  response.json({ items: getMessagingOverview() });
});

messageRoutes.post("/", (request, response) => {
  try {
    const message = createMessage(request.body);
    response.status(201).json({ message });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel registrar a mensagem.");
  }
});

messageRoutes.patch("/:id", (request, response) => {
  try {
    const message = updateMessageStatus(Number(request.params.id), request.body);
    response.json({ message });
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Nao foi possivel atualizar a mensagem.");
  }
});
