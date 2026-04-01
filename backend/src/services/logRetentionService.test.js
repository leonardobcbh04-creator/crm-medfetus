import test from "node:test";
import assert from "node:assert/strict";
import { db, initializeDatabase, resetDatabase } from "../db.js";
import { runLogRetentionCleanup } from "./logRetentionService.js";

test("limpa logs antigos conforme a politica de retencao", { concurrency: false }, async () => {
  resetDatabase();
  initializeDatabase();

  const now = new Date().toISOString();
  const patientId = Number(
    db.prepare(`
      INSERT INTO patients (
        name,
        phone,
        birth_date,
        dum,
        dpp,
        current_gestational_weeks,
        current_gestational_days,
        gestational_base_date,
        gestational_base_source,
        gestational_base_confidence,
        gestational_base_is_estimated,
        gestational_review_required,
        physician_name,
        clinic_unit,
        pregnancy_type,
        high_risk,
        notes,
        status,
        stage,
        created_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        'Paciente teste retencao',
        '5511999999999',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'manual_review',
        'insuficiente',
        1,
        1,
        NULL,
        NULL,
        'Unica',
        0,
        '',
        'ativa',
        'revisao_base_gestacional',
        1,
        ?,
        ?
      )
    `).run(now, now).lastInsertRowid
  );

  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, patient_id, description, details_json, created_at)
    VALUES (1, 'teste', 'patient', 1, ?, 'Auditoria antiga', NULL, ?)
  `).run(patientId, "2024-01-01T12:00:00.000Z");

  db.prepare(`
    INSERT INTO logs_de_sincronizacao (
      integration_key, scope, mode, status, started_at, finished_at, records_received, records_processed, records_created, records_updated, sync_error, payload_json, created_at, updated_at
    )
    VALUES ('shosp', 'patients', 'mock', 'success', ?, ?, 0, 0, 0, 0, NULL, NULL, ?, ?)
  `).run("2024-01-01T12:00:00.000Z", "2024-01-01T12:10:00.000Z", "2024-01-01T12:00:00.000Z", "2024-01-01T12:10:00.000Z");

  db.prepare(`
    INSERT INTO message_delivery_logs (
      message_id, patient_id, template_id, provider, status, external_message_id, request_payload, response_payload, error_message, sent_at, delivered_at, responded_at, created_at, updated_at
    )
    VALUES (NULL, ?, NULL, 'manual_stub', 'enviada', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).run(patientId, "2024-01-01T12:00:00.000Z", "2024-01-01T12:00:00.000Z");

  db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action_type, entity_type, entity_id, patient_id, description, details_json, created_at)
    VALUES (1, 'teste', 'patient', 1, ?, 'Auditoria recente', NULL, ?)
  `).run(patientId, new Date().toISOString());

  const result = await runLogRetentionCleanup("test");

  assert.equal(result.ok, true);
  assert.equal(result.deletedAuditLogs >= 1, true);
  assert.equal(result.deletedSyncLogs >= 1, true);
  assert.equal(result.deletedMessageLogs >= 1, true);

  const remainingAuditLogs = db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get().count;
  const remainingSyncLogs = db.prepare("SELECT COUNT(*) AS count FROM logs_de_sincronizacao").get().count;
  const remainingMessageLogs = db.prepare("SELECT COUNT(*) AS count FROM message_delivery_logs").get().count;

  assert.equal(remainingAuditLogs, 1);
  assert.equal(remainingSyncLogs, 0);
  assert.equal(remainingMessageLogs, 0);
});
