import { clearAllPatientData } from "./db.js";

const deleted = clearAllPatientData();

console.log("Pacientes de teste removidos do banco atual.");
console.log(JSON.stringify(deleted, null, 2));
