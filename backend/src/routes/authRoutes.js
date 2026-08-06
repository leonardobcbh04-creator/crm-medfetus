import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateCore } from "../services/coreMigrationService.js";

export const authRoutes = Router();

// Limita tentativas de login para dificultar ataques de forca bruta.
// Ate 10 tentativas a cada 15 minutos por IP; nao conta tentativas bem-sucedidas.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: "Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.",
  handler: (_request, response) => {
    response.status(429).send("Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.");
  }
});

authRoutes.post("/login", loginRateLimiter, async (request, response) => {
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
