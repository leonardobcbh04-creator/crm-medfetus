export const users = [
  { id: 1, name: "Administrador", email: "admin@clinica.com", password: "123456", role: "admin", active: true },
  { id: 2, name: "Recepcao", email: "recepcao@clinica.com", password: "123456", role: "recepcao", active: true }
];

export const clinicUnits = [
  { id: 1, name: "Unidade Centro", active: true },
  { id: 2, name: "Unidade Jardins", active: true },
  { id: 3, name: "Unidade Zona Sul", active: true },
  { id: 4, name: "Unidade Moema", active: true },
  { id: 5, name: "Unidade Alphaville", active: true }
];

export const physicians = [
  { id: 1, name: "Dra. Helena Castro", clinicUnitId: 1, active: true },
  { id: 2, name: "Dr. Fabio Mendes", clinicUnitId: 2, active: true },
  { id: 3, name: "Dra. Camila Freitas", clinicUnitId: 3, active: true },
  { id: 4, name: "Dra. Renata Moura", clinicUnitId: 4, active: true },
  { id: 5, name: "Dr. Gustavo Pires", clinicUnitId: 5, active: true },
  { id: 6, name: "Dra. Larissa Teixeira", clinicUnitId: 1, active: true }
];

export const examModels = [
  { code: "exame_obstetrico_inicial", name: "Exame obstetrico inicial", startWeek: 5, endWeek: 10.86, targetWeek: 8, reminderDaysBefore1: 10, reminderDaysBefore2: 2, defaultMessage: "Olá, [NOME]! Tudo bem? 😊\n\nVimos que você está no início da gestação — esse é o momento ideal para o seu primeiro ultrassom obstétrico.\n\nEsse exame é importante para confirmar a evolução da gestação e te dar mais segurança nesse começo 🤍\n\nQuer que eu veja um horário pra você?", required: false, flowType: "automatico", active: true, sortOrder: 1 },
  { code: "morfologico_1_trimestre", name: "Morfologico 1o trimestre", startWeek: 11, endWeek: 14, targetWeek: 12, reminderDaysBefore1: 10, reminderDaysBefore2: 2, defaultMessage: "Olá, [NOME]! 😊\n\nVocê está entrando no período ideal para o morfológico do 1º trimestre.\n\nEsse exame é muito importante nessa fase, pois avalia a formação inicial do bebê com bastante detalhe.\n\nSe quiser, posso te ajudar a agendar nos melhores horários 💙", required: true, flowType: "automatico", active: true, sortOrder: 2 },
  { code: "obstetrica_sexo", name: "Obstetrica para sexo", startWeek: 14.43, endWeek: 17, targetWeek: 15, reminderDaysBefore1: 5, reminderDaysBefore2: 2, defaultMessage: "Olá, [NOME]! Tudo bem? 😊\n\nVocê já está na fase em que é possível tentar descobrir o sexo do bebê 💕\n\nÉ um momento muito especial!\n\nSe quiser, posso ver um horário pra você vir fazer esse exame com a gente 🤍", required: false, flowType: "automatico", active: true, sortOrder: 3 },
  { code: "morfologico_2_trimestre", name: "Morfologico 2o trimestre", startWeek: 20, endWeek: 24, targetWeek: 22, reminderDaysBefore1: 10, reminderDaysBefore2: 3, defaultMessage: "Olá, [NOME]! 😊\n\nVocê já está no momento ideal para o morfológico do 2º trimestre.\n\nEsse é um dos exames mais importantes da gestação, pois avalia o desenvolvimento do bebê com mais detalhes.\n\nTemos horários disponíveis — quer que eu veja um pra você? 💙", required: true, flowType: "automatico", active: true, sortOrder: 4 },
  { code: "ecocardiograma_fetal", name: "Ecocardiograma fetal", startWeek: 24, endWeek: 28, targetWeek: 26, reminderDaysBefore1: 10, reminderDaysBefore2: 3, defaultMessage: "Olá, [NOME]! Tudo bem? 😊\n\nPela fase da sua gestação, já é o momento ideal para realizar o ecocardiograma fetal.\n\nEsse exame avalia o coração do bebê com bastante precisão e é muito importante nessa etapa 🤍\n\nSe quiser, posso verificar horários disponíveis pra você.", required: false, flowType: "automatico", active: true, sortOrder: 5 },
  { code: "perfil_biofisico_fetal", name: "Perfil biofisico fetal", startWeek: 28, endWeek: 40, targetWeek: 30, reminderDaysBefore1: 10, reminderDaysBefore2: 2, defaultMessage: "Olá, [NOME]! 😊\n\nVocê está em uma fase em que o perfil biofísico fetal pode ser indicado para acompanhar o bem-estar do bebê.\n\nEsse exame ajuda a avaliar vários aspectos importantes da saúde do bebê nessa fase 💙\n\nQuer que eu veja um horário disponível pra você?", required: false, flowType: "automatico", active: true, sortOrder: 6 },
  { code: "doppler_obstetrico", name: "Doppler obstetrico", startWeek: 32, endWeek: 36, targetWeek: 34, reminderDaysBefore1: 10, reminderDaysBefore2: 2, defaultMessage: "Olá, [NOME]! Tudo bem? 😊\n\nPela fase da sua gestação, o Doppler obstétrico pode ser indicado para avaliar a circulação e o desenvolvimento do bebê.\n\nÉ um exame importante para garantir que está tudo evoluindo bem 🤍\n\nSe quiser, posso verificar um horário pra você.", required: false, flowType: "automatico", active: true, sortOrder: 7 },
  { code: "morfologico_3_trimestre", name: "Morfologico 3o trimestre", startWeek: 32, endWeek: 36, targetWeek: 34, reminderDaysBefore1: 0, reminderDaysBefore2: 0, defaultMessage: "Olá, [NOME]! 😊\n\nVocê já está entrando no período ideal para o morfológico do 3º trimestre.\n\nEsse exame é importante para acompanhar o crescimento do bebê e verificar se está tudo evoluindo bem nessa fase final da gestação 🤍\n\nTemos horários disponíveis — quer que eu veja um pra você?", required: false, flowType: "avulso", active: true, sortOrder: 8 },
  { code: "obstetrico_simples", name: "Obstetrico simples", startWeek: 1, endWeek: 40, targetWeek: 20, reminderDaysBefore1: 0, reminderDaysBefore2: 0, defaultMessage: "Olá, [NOME]! 😊\n\nPela fase da sua gestação, já é um bom momento para realizar um ultrassom obstétrico de acompanhamento.\n\nEsse exame ajuda a verificar se está tudo evoluindo bem com o bebê 🤍\n\nSe quiser, posso ver um horário pra você.", required: false, flowType: "avulso", active: true, sortOrder: 9 }
];

export const messageTemplates = [
  { code: "lembrete_exame", name: "Lembrete de exame", channel: "whatsapp", language: "pt_BR", content: "Ola, {{nome}}. Seu exame {{exame}} esta entrando na janela ideal. Podemos ajudar com o agendamento?", active: true },
  { code: "confirmacao_agendamento", name: "Confirmacao de agendamento", channel: "whatsapp", language: "pt_BR", content: "Ola, {{nome}}. Seu exame {{exame}} ficou agendado para {{data}} as {{horario}}.", active: true },
  { code: "followup_resposta", name: "Follow-up sem resposta", channel: "whatsapp", language: "pt_BR", content: "Ola, {{nome}}. Passando para reforcar o acompanhamento do exame {{exame}}. Se quiser, podemos reservar um horario.", active: true }
];

function message(examCode, content, responseStatus = "sem_resposta", sentDaysAgo = 0) {
  return { examCode, content, deliveryStatus: "enviada", responseStatus, sentDaysAgo };
}

function move(fromStage, toStage, actionType, description) {
  return { fromStage, toStage, actionType, description };
}

function scheduledExam(examCode, scheduledDate, scheduledTime, schedulingNotes, scheduledByUserId = 2) {
  return { examCode, scheduledDate, scheduledTime, schedulingNotes, scheduledByUserId };
}

function patient(data) {
  return {
    gestationalWeeks: null,
    gestationalDays: null,
    status: "ativa",
    scheduledExams: [],
    sentMessages: [],
    movementHistory: [],
    ...data
  };
}

export const patients = [];
