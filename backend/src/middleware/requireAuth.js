import { getAuthenticatedUserByToken } from "../services/clinicService.js";

export function requireAuth(request, response, next) {
  const authorization = String(request.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    response.status(401).send("Autenticacao obrigatoria.");
    return;
  }

  const token = authorization.slice(7).trim();
  const session = getAuthenticatedUserByToken(token);
  if (!session) {
    response.status(401).send("Sessao invalida ou expirada.");
    return;
  }

  request.authUser = session.user;
  request.authSession = session.session;
  next();
}
