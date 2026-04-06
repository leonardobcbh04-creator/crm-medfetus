const EXAM_PROTOCOL_PRESETS = {
  unica_padrao: {
    id: "unica_padrao",
    name: "Gestacao unica padrao",
    description: "Protocolo inicial mais conservador para a rotina obstetrica geral.",
    overrides: {}
  },
  gemelar: {
    id: "gemelar",
    name: "Gestacao gemelar",
    description: "Antecipa algumas janelas e lembretes para acompanhamento mais proximo.",
    overrides: {
      morfologico_2_trimestre: { targetWeek: 20, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { startWeek: 22, endWeek: 27, targetWeek: 24, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { startWeek: 30, endWeek: 34, targetWeek: 31, reminderDaysBefore1: 12, reminderDaysBefore2: 5 },
      doppler_obstetrico: { startWeek: 32, endWeek: 35, targetWeek: 33, reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { startWeek: 34, endWeek: 38, targetWeek: 35, reminderDaysBefore1: 10, reminderDaysBefore2: 4 }
    }
  },
  alto_risco: {
    id: "alto_risco",
    name: "Ajuste para alto risco",
    description: "Mantem os exames e reforca os lembretes para casos que exigem maior atencao.",
    overrides: {
      exame_obstetrico_inicial: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_1_trimestre: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_2_trimestre: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      doppler_obstetrico: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 }
    }
  },
  gemelar_alto_risco: {
    id: "gemelar_alto_risco",
    name: "Gestacao gemelar com alto risco",
    description: "Combina antecipacao de janelas com lembretes mais fortes para acompanhamento intensivo.",
    overrides: {
      exame_obstetrico_inicial: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_1_trimestre: { reminderDaysBefore1: 10, reminderDaysBefore2: 4 },
      morfologico_2_trimestre: { startWeek: 19, endWeek: 23, targetWeek: 20, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      ecocardiograma_fetal: { startWeek: 22, endWeek: 27, targetWeek: 23, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      morfologico_3_trimestre: { startWeek: 30, endWeek: 34, targetWeek: 31, reminderDaysBefore1: 14, reminderDaysBefore2: 5 },
      doppler_obstetrico: { startWeek: 31, endWeek: 35, targetWeek: 32, reminderDaysBefore1: 12, reminderDaysBefore2: 4 },
      perfil_biofisico_fetal: { startWeek: 33, endWeek: 37, targetWeek: 34, reminderDaysBefore1: 12, reminderDaysBefore2: 4 }
    }
  }
};

export function listExamProtocolPresets() {
  return Object.values(EXAM_PROTOCOL_PRESETS);
}
