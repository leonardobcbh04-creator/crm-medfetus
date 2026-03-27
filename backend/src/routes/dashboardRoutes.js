import { Router } from "express";
import { asyncRoute } from "../http/routeUtils.js";
import { getDashboardDataCore } from "../services/coreMigrationService.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", asyncRoute(async (request, response) => {
  response.json(await getDashboardDataCore(request.query));
}, "Nao foi possivel carregar o dashboard."));
