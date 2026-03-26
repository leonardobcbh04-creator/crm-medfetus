export function requireAdmin(request, response, next) {
  const role = String(request.headers["x-user-role"] || "").trim().toLowerCase();

  if (role !== "admin") {
    response.status(403).send("Acesso restrito ao perfil de administrador.");
    return;
  }

  next();
}
