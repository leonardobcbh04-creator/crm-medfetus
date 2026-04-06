import { getDatabaseRuntime } from "./database/runtime.js";

const runtime = await getDatabaseRuntime();

const deleted = await runtime.transaction(async (client) => {
  const summary = {};

  const messageDeliveryLogs = await client.query("DELETE FROM message_delivery_logs");
  summary.messageDeliveryLogs = Number(messageDeliveryLogs.rowCount || 0);

  const messages = await client.query("DELETE FROM mensagens");
  summary.messages = Number(messages.rowCount || 0);

  const movements = await client.query("DELETE FROM historico_de_movimentacoes");
  summary.movements = Number(movements.rowCount || 0);

  const patientExams = await client.query("DELETE FROM exames_paciente");
  summary.patientExams = Number(patientExams.rowCount || 0);

  const patients = await client.query("DELETE FROM patients");
  summary.patients = Number(patients.rowCount || 0);

  return summary;
});

console.log("Pacientes removidos do banco atual.");
console.log(JSON.stringify(deleted, null, 2));
