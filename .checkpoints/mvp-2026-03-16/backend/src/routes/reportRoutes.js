import { Router } from "express";
import { getReportsData } from "../services/clinicService.js";

export const reportRoutes = Router();

reportRoutes.get("/", (request, response) => {
  response.json(getReportsData(request.query));
});
