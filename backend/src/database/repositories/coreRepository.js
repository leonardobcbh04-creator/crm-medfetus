import { getDatabaseRuntime } from "../runtime.js";


export async function getActiveUserByEmail(email) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT id, name, email, role, password
    FROM users
    WHERE email = $1 AND active = TRUE
    LIMIT 1
  `, [email]);
  return result.rows[0] || null;
}

export async function updateUserPasswordHash(userId, passwordHash, updatedAt) {
  const runtime = await getDatabaseRuntime();
  await runtime.query("UPDATE users SET password = $1, updated_at = $2 WHERE id = $3", [passwordHash, updatedAt, userId]);
}

export async function createUserSession(userId, tokenHash, expiresAt, createdAt) {
  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, tokenHash, expiresAt, createdAt, createdAt]);
}

export async function getActiveSessionByTokenHash(tokenHash, nowIso) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      user_sessions.id,
      user_sessions.user_id AS "userId",
      user_sessions.expires_at AS "expiresAt",
      users.name,
      users.email,
      users.role
    FROM user_sessions
    INNER JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = $1
      AND user_sessions.revoked_at IS NULL
      AND user_sessions.expires_at >= $2
      AND users.active = TRUE
    LIMIT 1
  `, [tokenHash, nowIso]);
  return result.rows[0] || null;
}

export async function touchSessionLastSeen(sessionId, lastSeenAt) {
  const runtime = await getDatabaseRuntime();
  await runtime.query("UPDATE user_sessions SET last_seen_at = $1 WHERE id = $2", [lastSeenAt, sessionId]);
}

export async function listPatientsBaseRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      name,
      phone,
      birth_date AS "birthDate",
      dum,
      dpp,
      current_gestational_weeks AS "gestationalWeeks",
      current_gestational_days AS "gestationalDays",
      gestational_base_date AS "gestationalBaseDate",
      gestational_base_source AS "gestationalBaseSource",
      gestational_base_confidence AS "gestationalBaseConfidence",
      gestational_base_is_estimated AS "gestationalBaseIsEstimated",
      gestational_review_required AS "gestationalReviewRequired",
      gestational_base_conflict AS "gestationalBaseConflict",
      gestational_base_conflict_note AS "gestationalBaseConflictNote",
      physician_name AS "physicianName",
      clinic_unit AS "clinicUnit",
      pregnancy_type AS "pregnancyType",
      high_risk AS "highRisk",
      shosp_patient_id AS "shospPatientId",
      imported_from_shosp AS "importedFromShosp",
      sync_status AS "syncStatus",
      notes,
      status,
      stage,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM patients
    ORDER BY created_at DESC, id DESC
  `);
  return result.rows;
}

export async function listPatientExamRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      ep.id,
      ep.patient_id AS "patientId",
      ep.exam_model_id AS "examModelId",
      ep.predicted_date AS "predictedDate",
      ep.reminder_date_1 AS "reminderDate1",
      ep.reminder_date_2 AS "reminderDate2",
      ep.scheduled_date AS "scheduledDate",
      ep.scheduled_time AS "scheduledTime",
      ep.scheduling_notes AS "schedulingNotes",
      ep.scheduled_by_user_id AS "scheduledByUserId",
      ep.last_contacted_at AS "lastContactedAt",
      ep.reminder_snoozed_until AS "reminderSnoozedUntil",
      ep.completed_date AS "completedDate",
      ep.completed_by_user_id AS "completedByUserId",
      ep.completed_outside_clinic AS "completedOutsideClinic",
      ep.shosp_exam_id AS "shospExamId",
      ep.imported_from_shosp AS "importedFromShosp",
      ep.status,
      em.code,
      em.name,
      em.required,
      em.flow_type AS "flowType",
      em.sort_order AS "sortOrder",
      em.start_week AS "startWeek",
      em.end_week AS "endWeek",
      em.target_week AS "targetWeek",
      em.default_message AS "defaultMessage",
      rule.reference_week AS "inferenceReferenceWeek",
      rule.uncertainty_margin_weeks AS "inferenceUncertaintyMarginWeeks",
      rule.allow_automatic_inference AS "allowAutomaticInference",
      rule.active AS "inferenceRuleActive",
      scheduled_user.name AS "scheduledByName",
      completed_user.name AS "completedByName"
    FROM exames_paciente ep
    INNER JOIN exames_modelo em ON em.id = ep.exam_model_id
    LEFT JOIN regras_inferencia_gestacional rule ON rule.exam_model_id = ep.exam_model_id
    LEFT JOIN users scheduled_user ON scheduled_user.id = ep.scheduled_by_user_id
    LEFT JOIN users completed_user ON completed_user.id = ep.completed_by_user_id
    ORDER BY ep.patient_id, em.sort_order
  `);
  return result.rows;
}

export async function listLatestMessageRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      m.id,
      m.patient_id AS "patientId",
      m.exam_model_id AS "examModelId",
      m.content,
      m.delivery_status AS "deliveryStatus",
      m.sent_at AS "sentAt",
      m.response_status AS "responseStatus",
      m.response_text AS "responseText",
      m.response_at AS "responseAt"
    FROM mensagens m
    ORDER BY m.created_at DESC, m.id DESC
  `);
  return result.rows;
}

export async function listMessageHistoryRowsByPatient(patientId) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      patient_id AS "patientId",
      exam_model_id AS "examModelId",
      content,
      delivery_status AS "deliveryStatus",
      sent_at AS "sentAt",
      response_status AS "responseStatus",
      response_text AS "responseText",
      response_at AS "responseAt"
    FROM mensagens
    WHERE patient_id = $1
    ORDER BY created_at DESC, id DESC
  `, [patientId]);
  return result.rows;
}

export async function listMovementRowsByPatient(patientId) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      patient_id AS "patientId",
      from_stage AS "fromStage",
      to_stage AS "toStage",
      action_type AS "actionType",
      description,
      metadata_json AS "metadataJson",
      created_at AS "createdAt"
    FROM historico_de_movimentacoes
    WHERE patient_id = $1
    ORDER BY created_at DESC, id DESC
  `, [patientId]);
  return result.rows;
}

export async function listAutomaticExamModels() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      code,
      name,
      target_week AS "targetWeek",
      reminder_days_before_1 AS "reminderDaysBefore1",
      reminder_days_before_2 AS "reminderDaysBefore2",
      sort_order AS "sortOrder",
      start_week AS "startWeek",
      end_week AS "endWeek",
      required,
      flow_type AS "flowType",
      default_message AS "defaultMessage"
    FROM exames_modelo
    WHERE active = TRUE AND flow_type = 'automatico'
    ORDER BY sort_order
  `);
  return result.rows;
}

export async function listClinicUnitsRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      name,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM clinic_units
    ORDER BY name
  `);
  return result.rows;
}

export async function listPhysiciansRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      physicians.id,
      physicians.name,
      physicians.clinic_unit_id AS "clinicUnitId",
      clinic_units.name AS "clinicUnitName",
      physicians.active,
      physicians.created_at AS "createdAt",
      physicians.updated_at AS "updatedAt"
    FROM physicians
    LEFT JOIN clinic_units ON clinic_units.id = physicians.clinic_unit_id
    ORDER BY physicians.name
  `);
  return result.rows;
}

export async function listExamConfigRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      code,
      name,
      start_week AS "startWeek",
      end_week AS "endWeek",
      target_week AS "targetWeek",
      reminder_days_before_1 AS "reminderDaysBefore1",
      reminder_days_before_2 AS "reminderDaysBefore2",
      default_message AS "defaultMessage",
      required,
      flow_type AS "flowType",
      active,
      sort_order AS "sortOrder"
    FROM exames_modelo
    ORDER BY sort_order
  `);
  return result.rows;
}

export async function listKanbanColumnsRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      title,
      description,
      sort_order AS "sortOrder",
      is_system AS "isSystem",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM kanban_columns
    ORDER BY sort_order, title
  `);
  return result.rows;
}

export async function listMessageRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      m.id,
      m.patient_id AS "patientId",
      m.exam_model_id AS "examModelId",
      m.content,
      m.delivery_status AS "deliveryStatus",
      m.sent_at AS "sentAt",
      m.response_status AS "responseStatus",
      m.response_text AS "responseText",
      m.response_at AS "responseAt",
      m.created_at AS "createdAt",
      m.created_by_user_id AS "createdByUserId",
      users.name AS "createdByUserName"
    FROM mensagens m
    LEFT JOIN users ON users.id = m.created_by_user_id
    ORDER BY m.created_at DESC, m.id DESC
  `);
  return result.rows;
}

export async function listMovementRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      hm.id,
      hm.patient_id AS "patientId",
      hm.from_stage AS "fromStage",
      hm.to_stage AS "toStage",
      hm.action_type AS "actionType",
      hm.description,
      hm.created_at AS "createdAt",
      hm.created_by_user_id AS "createdByUserId",
      users.name AS "createdByUserName"
    FROM historico_de_movimentacoes hm
    LEFT JOIN users ON users.id = hm.created_by_user_id
    ORDER BY hm.created_at DESC, hm.id DESC
  `);
  return result.rows;
}

export async function listAuditRowsByPatient(patientId, limit = 50) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      audit_logs.id,
      audit_logs.actor_user_id AS "actorUserId",
      users.name AS "actorUserName",
      audit_logs.action_type AS "actionType",
      audit_logs.entity_type AS "entityType",
      audit_logs.entity_id AS "entityId",
      audit_logs.patient_id AS "patientId",
      audit_logs.description,
      audit_logs.details_json AS "detailsJson",
      audit_logs.created_at AS "createdAt"
    FROM audit_logs
    LEFT JOIN users ON users.id = audit_logs.actor_user_id
    WHERE audit_logs.patient_id = $1
    ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
    LIMIT $2
  `, [patientId, limit]);
  return result.rows;
}

export async function listRecentAuditLogRows(limit = 30) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      audit_logs.id,
      audit_logs.actor_user_id AS "actorUserId",
      users.name AS "actorUserName",
      audit_logs.action_type AS "actionType",
      audit_logs.entity_type AS "entityType",
      audit_logs.entity_id AS "entityId",
      audit_logs.patient_id AS "patientId",
      patients.name AS "patientName",
      audit_logs.description,
      audit_logs.details_json AS "detailsJson",
      audit_logs.created_at AS "createdAt"
    FROM audit_logs
    LEFT JOIN users ON users.id = audit_logs.actor_user_id
    LEFT JOIN patients ON patients.id = audit_logs.patient_id
    ORDER BY audit_logs.created_at DESC, audit_logs.id DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

export async function listAdminUsersRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      name,
      email,
      role,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM users
    ORDER BY name
  `);
  return result.rows;
}

export async function listExamInferenceRuleRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      rule.id,
      rule.exam_model_id AS "examModelId",
      exam.name AS "examName",
      exam.code AS "examCode",
      rule.typical_start_week AS "typicalStartWeek",
      rule.typical_end_week AS "typicalEndWeek",
      rule.reference_week AS "referenceWeek",
      rule.uncertainty_margin_weeks AS "uncertaintyMarginWeeks",
      rule.allow_automatic_inference AS "allowAutomaticInference",
      rule.active,
      rule.created_at AS "createdAt",
      rule.updated_at AS "updatedAt"
    FROM regras_inferencia_gestacional rule
    INNER JOIN exames_modelo exam ON exam.id = rule.exam_model_id
    ORDER BY exam.sort_order, exam.name
  `);
  return result.rows;
}

export async function listMessageTemplateRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      code,
      name,
      channel,
      language,
      content,
      active,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM message_templates
    ORDER BY name
  `);
  return result.rows;
}

export async function listMessageDeliveryLogRows() {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      logs.id,
      logs.message_id AS "messageId",
      logs.patient_id AS "patientId",
      patients.name AS "patientName",
      logs.template_id AS "templateId",
      templates.name AS "templateName",
      logs.provider,
      logs.status,
      logs.external_message_id AS "externalMessageId",
      logs.error_message AS "errorMessage",
      logs.sent_at AS "sentAt",
      logs.delivered_at AS "deliveredAt",
      logs.responded_at AS "respondedAt",
      logs.created_at AS "createdAt"
    FROM message_delivery_logs logs
    LEFT JOIN patients ON patients.id = logs.patient_id
    LEFT JOIN message_templates templates ON templates.id = logs.template_id
    ORDER BY logs.created_at DESC, logs.id DESC
    LIMIT 50
  `);
  return result.rows;
}

export async function insertPatientRecord(payload) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    INSERT INTO patients (
      name, phone, birth_date, dum, dpp, current_gestational_weeks, current_gestational_days,
      gestational_base_date, gestational_base_source, gestational_base_confidence,
      gestational_base_is_estimated, gestational_review_required, gestational_base_conflict,
      gestational_base_conflict_note, physician_name, clinic_unit, pregnancy_type,
      high_risk, notes, status, stage, created_by_user_id, created_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
    )
    RETURNING id
  `, [
    payload.name,
    payload.phone,
    payload.birthDate,
    payload.dum,
    payload.dpp,
    payload.currentGestationalWeeks,
    payload.currentGestationalDays,
    payload.gestationalBaseDate,
    payload.gestationalBaseSource,
    payload.gestationalBaseConfidence,
    Boolean(payload.gestationalBaseIsEstimated),
    Boolean(payload.gestationalReviewRequired),
    Boolean(payload.gestationalBaseConflict),
    payload.gestationalBaseConflictNote,
    payload.physicianName,
    payload.clinicUnit,
    payload.pregnancyType,
    Boolean(payload.highRisk),
    payload.notes,
    payload.status,
    payload.stage,
    payload.createdByUserId,
    payload.createdAt,
    payload.updatedAt
  ]);
  return Number(result.rows[0].id);
}

export async function updatePatientRecord(patientId, payload) {
  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    UPDATE patients
    SET
      name = $1,
      phone = $2,
      birth_date = $3,
      dum = $4,
      dpp = $5,
      current_gestational_weeks = $6,
      current_gestational_days = $7,
      gestational_base_date = $8,
      gestational_base_source = $9,
      gestational_base_confidence = $10,
      gestational_base_is_estimated = $11,
      gestational_review_required = $12,
      gestational_base_conflict = $13,
      gestational_base_conflict_note = $14,
      physician_name = $15,
      clinic_unit = $16,
      pregnancy_type = $17,
      high_risk = $18,
      notes = $19,
      status = $20,
      updated_at = $21
    WHERE id = $22
  `, [
    payload.name,
    payload.phone,
    payload.birthDate,
    payload.dum,
    payload.dpp,
    payload.currentGestationalWeeks,
    payload.currentGestationalDays,
    payload.gestationalBaseDate,
    payload.gestationalBaseSource,
    payload.gestationalBaseConfidence,
    Boolean(payload.gestationalBaseIsEstimated),
    Boolean(payload.gestationalReviewRequired),
    Boolean(payload.gestationalBaseConflict),
    payload.gestationalBaseConflictNote,
    payload.physicianName,
    payload.clinicUnit,
    payload.pregnancyType,
    Boolean(payload.highRisk),
    payload.notes,
    payload.status,
    payload.updatedAt,
    patientId
  ]);
}

export async function replacePatientExams(patientId, exams, createdAt) {
  const runtime = await getDatabaseRuntime();
  await runtime.transaction(async (client) => {
    await client.query("DELETE FROM exames_paciente WHERE patient_id = $1", [patientId]);
    for (const exam of exams) {
      await client.query(`
        INSERT INTO exames_paciente (
          patient_id, exam_model_id, predicted_date, reminder_date_1, reminder_date_2,
          scheduled_date, scheduled_time, scheduling_notes, scheduled_by_user_id, last_contacted_at,
          reminder_snoozed_until, completed_date, completed_by_user_id, completed_outside_clinic,
          status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        patientId,
        exam.examModelId,
        exam.predictedDate,
        exam.reminderDate1,
        exam.reminderDate2,
        exam.scheduledDate ?? null,
        exam.scheduledTime ?? null,
        exam.schedulingNotes ?? null,
        exam.scheduledByUserId ?? null,
        exam.lastContactedAt ?? null,
        exam.reminderSnoozedUntil ?? null,
        exam.completedDate ?? null,
        exam.completedByUserId ?? null,
        Boolean(exam.completedOutsideClinic),
        exam.status,
        createdAt,
        createdAt
      ]);
    }
  });
}

export async function insertMovementRecord(payload) {
  const metadataJson = payload.metadataJson ?? null;

  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    INSERT INTO historico_de_movimentacoes (
      patient_id, from_stage, to_stage, action_type, description,
      metadata_json, created_by_user_id, created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    payload.patientId,
    payload.fromStage,
    payload.toStage,
    payload.actionType,
    payload.description,
    metadataJson,
    payload.createdByUserId,
    payload.createdAt
  ]);
}

export async function insertMessageRecord(payload) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    INSERT INTO mensagens (
      patient_id,
      exam_model_id,
      content,
      delivery_status,
      sent_at,
      response_status,
      response_text,
      response_at,
      channel,
      created_by_user_id,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `, [
    payload.patientId,
    payload.examModelId ?? null,
    payload.content,
    payload.deliveryStatus,
    payload.sentAt,
    payload.responseStatus,
    payload.responseText ?? null,
    payload.responseAt ?? null,
    payload.channel,
    payload.createdByUserId ?? null,
    payload.createdAt,
    payload.updatedAt
  ]);
  return Number(result.rows[0].id);
}

export async function getMessageRow(messageId) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      id,
      patient_id AS "patientId",
      exam_model_id AS "examModelId",
      content,
      delivery_status AS "deliveryStatus",
      sent_at AS "sentAt",
      response_status AS "responseStatus",
      response_text AS "responseText",
      response_at AS "responseAt"
    FROM mensagens
    WHERE id = $1
  `, [messageId]);
  return result.rows[0] || null;
}

export async function updateMessageRecord(messageId, payload) {
  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    UPDATE mensagens
    SET
      delivery_status = $1,
      response_status = COALESCE($2, response_status),
      response_text = $3,
      response_at = $4,
      updated_at = $5
    WHERE id = $6
  `, [
    payload.deliveryStatus,
    payload.responseStatus ?? null,
    payload.responseText ?? null,
    payload.responseAt ?? null,
    payload.updatedAt,
    messageId
  ]);
}

export async function getMessageTemplateByCode(code) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT id, code
    FROM message_templates
    WHERE code = $1
    LIMIT 1
  `, [code]);
  return result.rows[0] || null;
}

export async function insertMessageDeliveryLog(payload) {
  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    INSERT INTO message_delivery_logs (
      message_id,
      patient_id,
      template_id,
      provider,
      status,
      external_message_id,
      request_payload,
      response_payload,
      error_message,
      sent_at,
      delivered_at,
      responded_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    payload.messageId ?? null,
    payload.patientId,
    payload.templateId ?? null,
    payload.provider,
    payload.status,
    payload.externalMessageId ?? null,
    payload.requestPayload ?? null,
    payload.responsePayload ?? null,
    payload.errorMessage ?? null,
    payload.sentAt ?? null,
    payload.deliveredAt ?? null,
    payload.respondedAt ?? null,
    payload.createdAt,
    payload.updatedAt
  ]);
}

export async function getPatientExamRow(patientId, examId) {
  const runtime = await getDatabaseRuntime();
  const result = await runtime.query(`
    SELECT
      ep.id,
      ep.patient_id AS "patientId",
      ep.exam_model_id AS "examModelId",
      ep.predicted_date AS "predictedDate",
      ep.reminder_date_1 AS "reminderDate1",
      ep.reminder_date_2 AS "reminderDate2",
      ep.scheduled_date AS "scheduledDate",
      ep.scheduled_time AS "scheduledTime",
      ep.scheduling_notes AS "schedulingNotes",
      ep.scheduled_by_user_id AS "scheduledByUserId",
      ep.last_contacted_at AS "lastContactedAt",
      ep.reminder_snoozed_until AS "reminderSnoozedUntil",
      ep.completed_date AS "completedDate",
      ep.completed_by_user_id AS "completedByUserId",
      ep.completed_outside_clinic AS "completedOutsideClinic",
      ep.status,
      p.stage AS "patientStage",
      em.code,
      em.name,
      em.flow_type AS "flowType",
      em.sort_order AS "sortOrder"
    FROM exames_paciente ep
    INNER JOIN patients p ON p.id = ep.patient_id
    INNER JOIN exames_modelo em ON em.id = ep.exam_model_id
    WHERE ep.id = $1 AND ep.patient_id = $2
  `, [examId, patientId]);
  return result.rows[0] || null;
}

export async function updatePatientExamRecord(patientId, examId, payload) {
  const runtime = await getDatabaseRuntime();
  await runtime.query(`
    UPDATE exames_paciente
    SET
      scheduled_date = $1,
      scheduled_time = $2,
      scheduling_notes = $3,
      scheduled_by_user_id = $4,
      last_contacted_at = $5,
      reminder_snoozed_until = $6,
      completed_date = $7,
      completed_by_user_id = $8,
      completed_outside_clinic = $9,
      status = $10,
      updated_at = $11
    WHERE id = $12 AND patient_id = $13
  `, [
    payload.scheduledDate,
    payload.scheduledTime,
    payload.schedulingNotes,
    payload.scheduledByUserId,
    payload.lastContactedAt,
    payload.reminderSnoozedUntil,
    payload.completedDate,
    payload.completedByUserId,
    Boolean(payload.completedOutsideClinic),
    payload.status,
    payload.updatedAt,
    examId,
    patientId
  ]);
}

export async function updatePatientStage(patientId, stage, updatedAt) {
  const runtime = await getDatabaseRuntime();
  await runtime.query("UPDATE patients SET stage = $1, updated_at = $2 WHERE id = $3", [stage, updatedAt, patientId]);
}
