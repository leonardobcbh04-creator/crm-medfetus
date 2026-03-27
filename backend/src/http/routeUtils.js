export function handleRouteError(response, error, fallbackMessage, statusCode = null) {
  const resolvedStatusCode =
    statusCode ??
    (typeof error?.statusCode === "number" ? error.statusCode : null) ??
    (typeof error?.status === "number" ? error.status : null) ??
    500;

  if (error instanceof Error) {
    console.error(`[api-error] ${fallbackMessage}`, error);
  } else {
    console.error(`[api-error] ${fallbackMessage}`, error);
  }

  response.status(resolvedStatusCode).send(error instanceof Error ? error.message : fallbackMessage);
}

export function asyncRoute(handler, fallbackMessage = "Nao foi possivel concluir a requisicao.") {
  return (request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => handleRouteError(response, error, fallbackMessage));
  };
}
