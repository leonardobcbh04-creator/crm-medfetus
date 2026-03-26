import { Router } from "express";
import { getDashboardData } from "../services/clinicService.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", (request, response) => {
  response.json(getDashboardData(request.query));
});
