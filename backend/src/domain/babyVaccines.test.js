import test from "node:test";
import assert from "node:assert/strict";
import {
  addMonthsIso,
  buildBabyVaccineReminders,
  buildBabyWhatsAppMessage,
  formatBabyAgeLabel
} from "./babyVaccines.js";

const catalog = [
  { id: 1, ageMonths: 1, vaccineName: "Hepatite B", doseLabel: "2ª dose", availability: "posto", active: true, sortOrder: 1 },
  { id: 2, ageMonths: 2, vaccineName: "Hexavalente", doseLabel: "1ª dose", availability: "clinica", active: true, sortOrder: 1 },
  { id: 3, ageMonths: 2, vaccineName: "Pneumocócica 20-valente", doseLabel: "1ª dose", availability: "clinica", active: true, sortOrder: 2 },
  { id: 4, ageMonths: 3, vaccineName: "Meningocócica B", doseLabel: "1ª dose", availability: "clinica", active: true, sortOrder: 1 },
  { id: 5, ageMonths: 6, vaccineName: "Covid-19", doseLabel: "Início do esquema", availability: "posto", active: true, sortOrder: 2 },
  { id: 6, ageMonths: 6, vaccineName: "Hexavalente", doseLabel: "3ª dose", availability: "clinica", active: true, sortOrder: 1 },
  { id: 7, ageMonths: 9, vaccineName: "Febre amarela", doseLabel: "1ª dose", availability: "clinica", active: false, sortOrder: 1 },
  { id: 8, ageMonths: 48, vaccineName: "Dengue", doseLabel: "1ª dose", availability: "clinica", active: true, sortOrder: 1 }
];

const mother = (id, dpp, overrides = {}) => ({
  id,
  name: `Mae ${id}`,
  phone: "31999990000",
  status: "encerrada",
  closureReason: "parto_realizado",
  dpp,
  ...overrides
});

function remindersOn(todayIso, patients) {
  return buildBabyVaccineReminders({ patients, catalog, todayIso }).items;
}

test("addMonthsIso respeita o fim do mes", () => {
  assert.equal(addMonthsIso("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsIso("2026-11-15", 2), "2027-01-15");
  assert.equal(addMonthsIso("2026-03-10", 18), "2027-09-10");
});

test("formatBabyAgeLabel", () => {
  assert.equal(formatBabyAgeLabel(1), "1 mês");
  assert.equal(formatBabyAgeLabel(6), "6 meses");
  assert.equal(formatBabyAgeLabel(12), "1 ano");
  assert.equal(formatBabyAgeLabel(15), "1 ano e 3 meses");
  assert.equal(formatBabyAgeLabel(24), "2 anos");
});

test("aviso aparece 15 dias antes da data (DPP + idade) e a idade seguinte substitui a anterior", () => {
  const dpp = "2026-08-01"; // 2 meses = 01/10, 3 meses = 01/11
  assert.equal(remindersOn("2026-09-15", [mother(1, dpp)])[0].ageMonths, 1); // 2 meses ainda nao (aviso a partir de 16/09)
  const at2 = remindersOn("2026-09-16", [mother(1, dpp)])[0];
  assert.equal(at2.ageMonths, 2);
  assert.equal(at2.targetDate, "2026-10-01");
  assert.equal(at2.daysUntilTarget, 15);
  assert.deepEqual(at2.vaccines.map((item) => item.vaccineName), ["Hexavalente", "Pneumocócica 20-valente"]);
  assert.equal(remindersOn("2026-10-17", [mother(1, dpp)])[0].ageMonths, 3); // aviso dos 3 meses comeca 17/10
});

test("aviso some 30 dias depois da data se nao chegou a idade seguinte; vacina inativa e acima de 2 anos nao contam", () => {
  const dpp = "2026-01-01"; // 6 meses = 01/07; 9 meses (inativa) nao existe; 48 meses fora do limite
  assert.equal(remindersOn("2026-07-31", [mother(1, dpp)])[0].ageMonths, 6);
  assert.equal(remindersOn("2026-08-01", [mother(1, dpp)]).length, 0);
  assert.equal(remindersOn("2026-10-01", [mother(1, dpp)]).length, 0); // 9 meses inativa
});

test("so maes encerradas como parto realizado entram", () => {
  const items = remindersOn("2026-09-16", [
    mother(1, "2026-08-01"),
    mother(2, "2026-08-01", { closureReason: "perda_gestacional" }),
    mother(3, "2026-08-01", { status: "ativa", closureReason: null }),
    mother(4, null)
  ]);
  assert.deepEqual(items.map((item) => item.patientId), [1]);
});

test("contato e por mae + idade", () => {
  const contactsMap = new Map([["1:2", { contactedAt: "2026-09-16T12:00:00Z", contactedByName: "Eliana" }]]);
  const [item] = buildBabyVaccineReminders({ patients: [mother(1, "2026-08-01")], catalog, contactsMap, todayIso: "2026-09-20" }).items;
  assert.equal(item.contacted, true);
  assert.equal(item.contactedByName, "Eliana");
  const [next] = buildBabyVaccineReminders({ patients: [mother(1, "2026-08-01")], catalog, contactsMap, todayIso: "2026-10-20" }).items;
  assert.equal(next.ageMonths, 3);
  assert.equal(next.contacted, false);
});

test("mensagem: clinica chama para agendar, posto so informa", () => {
  const mixed = buildBabyWhatsAppMessage({
    ageMonths: 6,
    clinicItems: [{ vaccineName: "Hexavalente", doseLabel: "3ª dose" }],
    publicItems: [{ vaccineName: "Covid-19", doseLabel: "Início do esquema" }]
  });
  assert.match(mixed, /Seu bebê está chegando aos 6 meses/);
  assert.match(mixed, /Aqui na MedFetus aplicamos:\n• Hexavalente – 3ª dose/);
  assert.match(mixed, /E esta você consegue gratuitamente no posto de saúde:\n• Covid-19 – Início do esquema/);
  assert.ok(mixed.endsWith("Quer que eu já veja um horário para vocês?"));

  const onlyPublic = buildBabyWhatsAppMessage({
    ageMonths: 1,
    clinicItems: [],
    publicItems: [{ vaccineName: "Hepatite B", doseLabel: "2ª dose" }]
  });
  assert.match(onlyPublic, /chegando a 1 mês/);
  assert.match(onlyPublic, /Esta vacina você consegue gratuitamente no posto de saúde:/);
  assert.doesNotMatch(onlyPublic, /Aqui na MedFetus aplicamos/);
  assert.ok(onlyPublic.endsWith("Qualquer dúvida, estamos à disposição!"));
});
