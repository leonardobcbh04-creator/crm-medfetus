import { Router } from "express";
import { authenticateCore } from "../services/coreMigrationService.js";

export const authRoutes = Router();

authRoutes.post("/login", async (request, response) => {
  try {
    const { email, password } = request.body;
    const session = await authenticateCore(email, password);

    if (!session) {
      response.status(401).send("E-mail ou senha invalidos.");
      return;
    }

    response.json(session);
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel autenticar.");
  }
});
