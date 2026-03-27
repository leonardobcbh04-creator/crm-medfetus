import { Router } from "express";
import { asyncRoute } from "../http/routeUtils.js";
import { getReportsDataCore } from "../services/coreMigrationService.js";

export const reportRoutes = Router();

reportRoutes.get("/", asyncRoute(async (request, response) => {
  response.json(await getReportsDataCore(request.query));
}, "Nao foi possivel carregar os relatorios."));
