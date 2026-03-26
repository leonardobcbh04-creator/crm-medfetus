export function handleRouteError(response, error, fallbackMessage, statusCode = 400) {
  response.status(statusCode).send(error instanceof Error ? error.message : fallbackMessage);
}

export function asyncRoute(handler, fallbackMessage = "Nao foi possivel concluir a requisicao.") {
  return (request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => handleRouteError(response, error, fallbackMessage));
  };
}
