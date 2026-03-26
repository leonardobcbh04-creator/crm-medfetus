import { getAuthenticatedUserByTokenCore } from "../services/coreMigrationService.js";

export async function requireAuth(request, response, next) {
  try {
    const authorization = String(request.headers.authorization || "").trim();
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      response.status(401).send("Autenticacao obrigatoria.");
      return;
    }

    const token = authorization.slice(7).trim();
    const session = await getAuthenticatedUserByTokenCore(token);
    if (!session) {
      response.status(401).send("Sessao invalida ou expirada.");
      return;
    }

    request.authUser = session.user;
    request.authSession = session.session;
    next();
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel validar a sessao.");
  }
}
