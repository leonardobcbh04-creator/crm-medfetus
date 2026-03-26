import { Router } from "express";
import { getPatientFormCatalogsCore } from "../services/coreMigrationService.js";

export const catalogRoutes = Router();

catalogRoutes.get("/", async (_request, response) => {
  try {
    response.json(await getPatientFormCatalogsCore());
  } catch (error) {
    response.status(500).send(error instanceof Error ? error.message : "Nao foi possivel carregar os catalogos.");
  }
});
