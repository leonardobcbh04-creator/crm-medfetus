// Validacao de ponta a ponta (servidor real + PostgreSQL) do Historico de contatos
// da Administracao: grava contexto nas marcacoes, filtros, paginacao, resumo por
// funcionaria e permissao (so admin).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closeDatabaseRuntime } from "../src/database/runtime.js";
import { recordAuditEvent } from "../src/services/auditService.js";
import { addDays, todayIsoInTimeZone } from "../src/utils/date.js";
import {
  autoCloseOverduePregnanciesCore,
  createAdminUserCore,
  createPatientCore,
  deleteAdminUserCore,
  deletePatientCore,
  getAdminPanelDataCore,
  updateAdminUserCore
} from "../src/services/coreMigrationService.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 10566;
const baseUrl = `http://127.0.0.1:${PORT}/api`;
const createdPatientIds = [];
let staffUser = null;
let server = null;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Servidor de teste nao subiu.");
}

async function login(email, password) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, `Login falhou para ${email}.`);
  return (await response.json()).token;
}

async function call(token, method, url, body) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

try {
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(PORT), RUN_BACKGROUND_WORKERS_IN_API: "false" },
    stdio: "ignore"
  });
  await waitForServer();

  const adminPanel = await getAdminPanelDataCore();
  const unit = adminPanel.units.find((item) => item.active) || adminPanel.units[0];
  const physician = adminPanel.physicians.find((item) => item.active && item.clinicUnitName === unit.name) || adminPanel.physicians[0];
  const stamp = Date.now();
  staffUser = await createAdminUserCore({ name: `Funcionaria Historico ${stamp}`, email: `historico${stamp}@clinica.com`, password: "teste123", role: "recepcao" });

  async function createPatient(name, gestationalWeeks) {
    const created = await createPatientCore({
      name,
      phone: `3194${String(stamp).slice(-6)}${createdPatientIds.length}`,
      clinicPatientId: `HIST-${stamp}-${createdPatientIds.length}`,
      gestationalWeeks,
      gestationalDays: 0,
      physicianName: physician.name,
      clinicUnit: unit.name,
      pregnancyType: "Unica",
      highRisk: false,
      notes: "Paciente criada para validar o historico de contatos.",
      actorUserId: 1
    });
    createdPatientIds.push(created.patient.id);
    return created.patient.id;
  }

  const pregnantId = await createPatient("Gestante Historico Contatos", 25);
  const motherId = await createPatient("Mae Historico Contatos", 50);
  await autoCloseOverduePregnanciesCore(todayIsoInTimeZone("America/Sao_Paulo"));

  const adminToken = await login("admin@clinica.com", "123456");
  const staffToken = await login(staffUser.email, "teste123");

  // Funcionaria: marca dTpa, desfaz, marca de novo; marca o bebe.
  for (const contacted of [true, false, true]) {
    const result = await call(staffToken, "PUT", `/vaccines/dtpa/${pregnantId}/contact`, { contacted });
    assert.equal(result.status, 200, "Marcacao dTpa falhou.");
  }
  const baby = await call(staffToken, "GET", "/vaccines/baby");
  const babyItem = baby.data.items.find((item) => item.patientId === motherId);
  assert.ok(babyItem, "Mae deveria ter aviso de vacina do bebe.");
  assert.equal((await call(staffToken, "PUT", `/vaccines/baby/${motherId}/${babyItem.ageMonths}/contact`, { contacted: true })).status, 200);

  // Registro "antigo" (sem details_json): idade so na descricao, nome da ficha.
  await recordAuditEvent({
    actorUserId: staffUser.id,
    actionType: "vacina_bebe_contatada",
    entityType: "patient_vaccine",
    entityId: motherId,
    patientId: motherId,
    description: "Mae contatada sobre as vacinas do bebe (2 meses)."
  });

  // Permissao: so admin.
  assert.equal((await call(staffToken, "GET", "/admin/contact-history")).status, 403, "Recepcao nao pode ver o historico.");

  const today = todayIsoInTimeZone("America/Sao_Paulo");
  const byStaff = await call(adminToken, "GET", `/admin/contact-history?actorUserId=${staffUser.id}`);
  assert.equal(byStaff.status, 200);
  const { rows, summary, total } = byStaff.data;
  assert.equal(total, 5, "Funcionaria deveria ter 5 registros (3 dTpa + 2 bebe).");
  assert.equal(byStaff.data.filters.to, today);
  assert.equal(byStaff.data.filters.from, addDays(today, -29), "Periodo padrao: ultimos 30 dias.");
  assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].createdAt >= row.createdAt), "Ordem: mais recente primeiro.");
  assert.equal(rows[0].boardLabel, "Bebê 2 meses", "Registro antigo deveria ler a idade da descricao.");
  assert.equal(rows[0].patientName, "Mae Historico Contatos");

  const dtpaRows = rows.filter((row) => row.board === "dtpa");
  assert.deepEqual(dtpaRows.map((row) => row.actionLabel), ["Contatada", "Marca desfeita", "Contatada"]);
  assert.equal(dtpaRows[0].patientName, "Gestante Historico Contatos");
  assert.equal(dtpaRows[0].gestationalAgeLabel, "25s0d");
  assert.equal(dtpaRows[0].sectionLabel, "Ja podem vacinar");
  assert.match(dtpaRows[0].createdAtLabel, /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  const newBabyRow = rows.find((row) => row.board === "bebe" && row.ageMonths === babyItem.ageMonths && row.id !== rows[0].id);
  assert.ok(newBabyRow, "Registro novo do bebe deveria ter a idade gravada.");

  assert.deepEqual(
    summary.map(({ dtpa, bebe, total: sum }) => ({ dtpa, bebe, total: sum })),
    [{ dtpa: 1, bebe: 2, total: 3 }],
    "Resumo deveria descontar a marca desfeita."
  );

  // Filtros: tipo, paginacao e periodo.
  const onlyBaby = await call(adminToken, "GET", `/admin/contact-history?actorUserId=${staffUser.id}&type=bebe`);
  assert.equal(onlyBaby.data.total, 2);
  assert.ok(onlyBaby.data.rows.every((row) => row.board === "bebe"));
  const paged = await call(adminToken, "GET", `/admin/contact-history?actorUserId=${staffUser.id}&pageSize=2&page=2`);
  assert.equal(paged.data.rows.length, 2);
  assert.equal(paged.data.totalPages, 3);
  assert.equal(paged.data.rows[0].id, rows[2].id);
  const exportAll = await call(adminToken, "GET", `/admin/contact-history?actorUserId=${staffUser.id}&all=1`);
  assert.equal(exportAll.data.rows.length, 5);
  const yesterday = addDays(today, -1);
  const pastPeriod = await call(adminToken, "GET", `/admin/contact-history?actorUserId=${staffUser.id}&from=${addDays(today, -10)}&to=${yesterday}`);
  assert.equal(pastPeriod.data.total, 0, "Periodo sem marcacoes deveria vir vazio.");
  assert.equal((await call(adminToken, "GET", `/admin/contact-history?from=${today}&to=${yesterday}`)).status, 400);

  console.log("Validacao do historico de contatos concluida com sucesso.");
} finally {
  server?.kill();
  for (const id of createdPatientIds) {
    await deletePatientCore(id).catch((error) => console.error("Falha ao limpar paciente de validacao.", error));
  }
  if (staffUser) {
    await deleteAdminUserCore(staffUser.id).catch(() => updateAdminUserCore(staffUser.id, { ...staffUser, active: false }).catch(() => {}));
  }
  await closeDatabaseRuntime();
}
