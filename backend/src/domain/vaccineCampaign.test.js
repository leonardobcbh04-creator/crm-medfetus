import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../utils/date.js";
import { buildDtpaCampaign, buildDtpaWhatsAppMessage, findNextScheduledExam } from "./vaccineCampaign.js";
import { VACCINE_DEFINITIONS, buildVaccineReminderBlurb, resolvePatientVaccineNeeds } from "./vaccines.js";

const TODAY = "2026-09-30";

// Paciente com IG de hoje = `gestationalDays` dias (DUM = hoje - dias).
function patient(id, gestationalDays, overrides = {}) {
  return {
    id,
    name: `Paciente ${id}`,
    phone: "31999990000",
    status: "ativa",
    closedAt: null,
    gestationalReviewRequired: false,
    dum: addDays(TODAY, -gestationalDays),
    ...overrides
  };
}

function campaign(patients, { vaccines = {}, exams = {}, contacts = {} } = {}) {
  return buildDtpaCampaign({
    patients,
    patientExamsMap: new Map(Object.entries(exams).map(([id, rows]) => [Number(id), rows])),
    vaccineRowsMap: new Map(Object.entries(vaccines).map(([id, rows]) => [Number(id), rows])),
    contactsMap: new Map(Object.entries(contacts).map(([id, row]) => [Number(id), row])),
    todayIso: TODAY
  });
}

const W = (weeks, days = 0) => weeks * 7 + days;

test("dTpa: janela ideal 20 a 36 semanas e frase 'a partir da 20a semana'", () => {
  const dtpa = VACCINE_DEFINITIONS.find((item) => item.code === "dtpa");
  assert.equal(dtpa.idealStartWeek, 20);
  assert.equal(dtpa.idealEndWeek, 36);
  assert.match(dtpa.reminderPhrase, /a partir da 20ª semana/);
  const needs = resolvePatientVaccineNeeds({ gestationalWeeks: 21, gestationalDays: 0 }, []);
  assert.equal(needs.find((item) => item.code === "dtpa").isInIdealWindow, true);
  assert.match(buildVaccineReminderBlurb(needs), /a partir da 20ª semana/);
});

test("secao A: IG hoje < 20s0d e IG em 15 dias >= 20s0d, ordenada por quem entra primeiro", () => {
  const result = campaign([
    patient(1, W(20) - 15), // entra exatamente em 15 dias
    patient(2, W(20) - 16), // fora: entra em 16 dias
    patient(3, W(19, 6)), // entra amanha
    patient(4, W(20)) // ja esta na janela (secao B)
  ]);
  assert.deepEqual(result.entering.map((item) => item.patientId), [3, 1]);
  assert.equal(result.entering[0].daysUntilWindow, 1);
  assert.equal(result.entering[0].windowStartDate, "2026-10-01");
  assert.equal(result.entering[1].daysUntilWindow, 15);
  assert.equal(result.entering[1].windowStartDate, "2026-10-15");
  assert.deepEqual(result.eligible.map((item) => item.patientId), [4]);
});

test("secao B: IG entre 20s0d e 36s6d, ordenada por quem sai da janela primeiro", () => {
  const result = campaign([
    patient(1, W(20)),
    patient(2, W(36, 6)), // ultimo dia
    patient(3, W(37)), // saiu da janela
    patient(4, W(30, 2))
  ]);
  assert.deepEqual(result.eligible.map((item) => item.patientId), [2, 4, 1]);
  assert.equal(result.eligible[0].daysUntilWindowEnd, 0);
  assert.equal(result.eligible[0].gestationalAgeLabel, "36s6d");
  assert.equal(result.eligible[1].gestationalAgeLabel, "30s2d");
});

test("criterios comuns: so ativas, dTpa pendente e sem revisao da base gestacional", () => {
  const result = campaign(
    [
      patient(1, W(25)),
      patient(2, W(25), { gestationalReviewRequired: true }),
      patient(3, W(25), { status: "encerrada", closedAt: "2026-09-01" }),
      patient(4, W(25)),
      patient(5, W(25)),
      patient(6, W(25), { dum: null })
    ],
    {
      vaccines: {
        4: [{ vaccineCode: "dtpa", status: "tomada" }],
        5: [{ vaccineCode: "dtpa", status: "nao_se_aplica" }]
      }
    }
  );
  assert.deepEqual(result.eligible.map((item) => item.patientId), [1]);
});

test("gripe pendente vira selo e paragrafo extra; contato e proximo exame aparecem", () => {
  const result = campaign([patient(1, W(25)), patient(2, W(25))], {
    vaccines: { 2: [{ vaccineCode: "gripe", status: "tomada" }] },
    exams: {
      1: [
        { id: 10, name: "Exame passado", status: "agendado", scheduledDate: "2026-09-29" },
        { id: 11, name: "Ecocardiograma fetal", status: "agendado", scheduledDate: "2026-10-20", scheduledTime: "09:10" },
        { id: 12, name: "Morfologico 3o trimestre", status: "agendado", scheduledDate: "2026-11-20" },
        { id: 13, name: "Realizado", status: "realizado", scheduledDate: null }
      ]
    },
    contacts: { 1: { contactedAt: "2026-09-30T12:00:00.000Z", contactedByName: "Eliana" } }
  });
  const [first, second] = result.eligible;
  assert.equal(first.fluPending, true);
  assert.equal(first.nextExam.name, "Ecocardiograma fetal");
  assert.equal(first.nextExam.scheduledDate, "2026-10-20");
  assert.equal(first.contacted, true);
  assert.equal(first.contactedByName, "Eliana");
  assert.match(first.whatsappMessage, /aproveitar a vinda para o exame Ecocardiograma fetal, no dia 20\/10\./);
  assert.match(first.whatsappMessage, /vacina da gripe/);
  assert.equal(second.fluPending, false);
  assert.equal(second.nextExam, null);
  assert.equal(second.contacted, false);
  assert.doesNotMatch(second.whatsappMessage, /gripe/);
});

test("proximo exame agendado considera so datas de hoje em diante", () => {
  assert.equal(findNextScheduledExam([{ status: "agendado", scheduledDate: "2026-09-29" }], TODAY), null);
  assert.equal(findNextScheduledExam([{ id: 1, status: "agendado", scheduledDate: TODAY }], TODAY).id, 1);
});

test("texto do WhatsApp: secao 'ja podem vacinar' com exame e sem gripe", () => {
  const message = buildDtpaWhatsAppMessage({
    nextExam: { name: "Morfologico 2o trimestre", scheduledDate: "2026-10-05" },
    fluPending: false,
    section: "janela"
  });
  assert.equal(
    message,
    "Oi! Tudo bem? 😊\nEu sou a Eliana, faço parte da equipe de vacinas da MedFetus.\n\n" +
    "Vi que você entrou no período recomendado para tomar a vacina dTpa na gestação. Ela protege o bebê contra a coqueluche nos primeiros meses de vida, antes de ele poder receber as próprias vacinas. 💚\n\n" +
    "Aqui na MedFetus aplicamos a dTpa, e vale muito a pena trazer também o pai ou quem vai cuidar do bebê: quando quem convive com ele está vacinado, a proteção fica ainda maior. " +
    "Se for mais prático, dá para aproveitar a vinda para o exame Morfologico 2o trimestre, no dia 05/10.\n\n" +
    "Quer que eu veja um horário para vocês?"
  );
});

test("texto do WhatsApp: secao 'entrando em 15 dias', sem exame e com gripe pendente", () => {
  const message = buildDtpaWhatsAppMessage({ nextExam: null, fluPending: true, section: "entrando" });
  assert.ok(message.includes("Você está chegando ao período recomendado para tomar a vacina dTpa na gestação, que começa na 20ª semana."));
  assert.doesNotMatch(message, /entrou no período/);
  assert.doesNotMatch(message, /aproveitar a vinda/);
  assert.ok(message.includes("trazer também o pai ou quem vai cuidar do bebê"));
  assert.ok(message.includes("A vacina da gripe também é muito importante na gestação: pode ser tomada em qualquer fase, e dá para fazer as duas no mesmo dia."));
  assert.ok(message.endsWith("Quer que eu já deixe um horário reservado para vocês?"));
});

test("a campanha usa o texto da secao certa", () => {
  const result = campaign([patient(1, W(19, 6)), patient(2, W(25))]);
  assert.match(result.entering[0].whatsappMessage, /chegando ao período recomendado/);
  assert.match(result.eligible[0].whatsappMessage, /entrou no período recomendado/);
});
