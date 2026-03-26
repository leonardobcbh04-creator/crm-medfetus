import { runMariaGertrudesOperationalTest } from "../backend/src/services/operationalTestService.js";

try {
  const result = runMariaGertrudesOperationalTest();

  console.log("Teste concluido com sucesso.");
  console.log(`Paciente: ${result.patientName} (ID ${result.patientId})`);
  console.log(`Etapa final: ${result.finalStage}`);
  console.log(`Exames realizados no teste: ${result.realizedCount}/${result.totalExams}`);
  console.log("Resumo do fluxo:");

  result.timeline.forEach((item, index) => {
    console.log(
      `${index + 1}. ${item.examName} | Previsto: ${item.predictedDate} | Mensagem: ${item.afterMessageStage} | Agendamento: ${item.afterScheduleStage} | Realizacao: ${item.afterCompletionStage}`
    );
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha inesperada no teste da Maria Gertrudes.");
  process.exitCode = 1;
}
