import { Router } from "express";
import { authenticate } from "../services/clinicService.js";

export const authRoutes = Router();

authRoutes.post("/login", (request, response) => {
  const { email, password } = request.body;
  const user = authenticate(email, password);

  if (!user) {
    response.status(401).send("E-mail ou senha inválidos.");
    return;
  }

  response.json({
    token: "token-local-de-teste",
    user
  });
});
