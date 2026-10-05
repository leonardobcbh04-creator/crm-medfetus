import test from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../utils/date.js";
import { buildVsrCampaign, buildVsrWhatsAppMessage } from "./vsrCampaign.js";

const TODAY = "2026-09-30";
const W = (weeks, days = 0) => weeks * 7 + days;

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

function campaign(patients, { vaccines = {}, contacts = {} } = {}) {
  return buildVsrCampaign({
    patients,
    vaccineRowsMap: new Map(Object.entries(vaccines).map(([id, rows]) => [Number(id), rows])),
    contactsMap: new Map(Object.entries(contacts).map(([id, row]) => [Number(id), row])),
    todayIso: TODAY
  });
}

test("VSR: janela de 28s0d a 36s6d, ordenada por quem sai primeiro", () => {
  const result = campaign([
    patient(1, W(27, 6)), // ainda nao
    patient(2, W(28)), // primeiro dia
    patient(3, W(36, 6)), // ultimo dia
    patient(4, W(37)), // saiu
    patient(5, W(32, 3))
  ]);
  assert.deepEqual(result.items.map((item) => item.patientId), [3, 5, 2]);
  assert.equal(result.items[0].daysUntilWindowEnd, 0);
  assert.equal(result.items[0].gestationalAgeLabel, "36s6d");
  assert.equal(result.items[2].windowEndDate, addDays(TODAY, W(8, 6)));
});

test("VSR: so ativas, VSR pendente e sem revisao da base gestacional", () => {
  const result = campaign(
    [
      patient(1, W(30)),
      patient(2, W(30), { gestationalReviewRequired: true }),
      patient(3, W(30), { status: "encerrada", closedAt: "2026-09-01" }),
      patient(4, W(30)),
      patient(5, W(30)),
      patient(6, W(30), { dum: null }),
      patient(7, W(30))
    ],
    {
      vaccines: {
        4: [{ vaccineCode: "vsr", status: "tomada" }],
        5: [{ vaccineCode: "vsr", status: "nao_se_aplica" }],
        7: [{ vaccineCode: "dtpa", status: "tomada" }]
      }
    }
  );
  assert.deepEqual(result.items.map((item) => item.patientId), [1, 7]);
});

test("VSR: marca de contato aparece no item", () => {
  const result = campaign([patient(1, W(30)), patient(2, W(30))], {
    contacts: { 1: { contactedAt: "2026-09-30T12:00:00.000Z", contactedByName: "Eliana" } }
  });
  assert.equal(result.items[0].contacted, true);
  assert.equal(result.items[0].contactedByName, "Eliana");
  assert.equal(result.items[1].contacted, false);
});

test("VSR: mensagem informativa sobre o SUS, sem semana e sem exame", () => {
  const message = buildVsrWhatsAppMessage();
  assert.ok(message.startsWith("Oi! Tudo bem? 😊\nEu sou a Eliana"));
  assert.match(message, /VSR/);
  assert.match(message, /gratuitamente pelo SUS/);
  assert.match(message, /posto de saúde/);
  assert.doesNotMatch(message, /semana|exame/i);
  assert.doesNotMatch(message, /aplicamos|horário/, "A MedFetus nao aplica a VSR: nada de convite para agendar.");
});
