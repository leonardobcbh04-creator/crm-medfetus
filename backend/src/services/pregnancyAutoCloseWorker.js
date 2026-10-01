import { autoCloseOverduePregnanciesCore } from "./coreMigrationService.js";

// Encerra sozinho, como "Parto realizado", quem passou da DPP + 14 dias. Roda ao
// iniciar o servidor e a cada 6 horas. E seguro rodar mais de uma vez (ou em mais
// de um processo): quem ja foi encerrada nao e tocada de novo.
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let intervalId = null;
let running = false;

export async function runPregnancyAutoClose(trigger = "manual") {
  if (running) {
    return { ok: false, skipped: true };
  }
  running = true;
  try {
    const result = await autoCloseOverduePregnanciesCore();
    if (result.closed.length) {
      console.info(`[encerramento-automatico] ${result.closed.length} paciente(s) encerrada(s) como parto realizado (${trigger}).`);
    }
    return { ok: true, ...result };
  } catch (error) {
    console.error("[encerramento-automatico] Falha ao encerrar gestacoes vencidas.", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    running = false;
  }
}

export function startPregnancyAutoCloseWorker() {
  if (intervalId) {
    return;
  }
  void runPregnancyAutoClose("inicio");
  intervalId = setInterval(() => void runPregnancyAutoClose("agendado"), INTERVAL_MS);
}

export function stopPregnancyAutoCloseWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
