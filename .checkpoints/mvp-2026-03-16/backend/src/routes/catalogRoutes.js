import { Router } from "express";
import { getPatientFormCatalogs } from "../services/clinicService.js";

export const catalogRoutes = Router();

catalogRoutes.get("/", (_request, response) => {
  response.json(getPatientFormCatalogs());
});
