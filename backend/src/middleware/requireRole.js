export function requireRole(allowedRoles) {
  const normalizedRoles = new Set(allowedRoles.map((role) => String(role).trim().toLowerCase()));

  return function enforceRole(request, response, next) {
    const role = String(request.authUser?.role || "").trim().toLowerCase();
    if (!normalizedRoles.has(role)) {
      response.status(403).send("Voce nao possui permissao para acessar este recurso.");
      return;
    }

    next();
  };
}
