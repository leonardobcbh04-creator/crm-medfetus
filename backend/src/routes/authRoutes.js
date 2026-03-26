import { Router } from "express";
import { authenticate } from "../services/clinicService.js";

export const authRoutes = Router();

authRoutes.post("/login", (request, response) => {
  const { email, password } = request.body;
  const session = authenticate(email, password);

  if (!session) {
    response.status(401).send("E-mail ou senha invalidos.");
    return;
  }

  response.json(session);
});
