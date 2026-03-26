import { SHOSP_CONFIG } from "../../config.js";
import { db } from "../../db.js";
import { calculateExamScheduleDates, resolvePregnancySnapshot } from "../../domain/obstetrics.js";
import { todayIso } from "../../utils/date.js";
import { normalizeBrazilPhone } from "../../utils/phone.js";
import {
  createShospApiClient,
  getEffectiveShospRuntimeConfig,
  getShospApiRuntimeMetrics,
  resetShospApiRuntimeMetrics
} from "./shospApiClient.js";
import { createShospMockProvider } from "./shospMockProvider.js";
import { getShospSyncWorkerStatus } from "./shospSyncWorker.js";

const SHOSP_SOURCE = "shosp";
const SHOSP_REMINDER_CACHE_TTL_MS = 5 * 60 * 1000;
const shospFutureScheduleCache = new Map();

function timestampIso() {
  return new Date().toISOString();
}

function getShospProvider() {
  return getEffectiveShospRuntimeConfig().mode === "mock" ? createShospMockProvider() : createShospApiClient();
}

function buildReminderCacheKey(externalPatientId, examCode) {
  return `${externalPatientId || "no-patient"}::${examCode || "no-exam"}`;
}

function readReminderCache(externalPatientId, examCode) {
  const key = buildReminderCacheKey(externalPatientId, examCode);
  const cached = shospFutureScheduleCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    shospFutureScheduleCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeReminderCache(externalPatientId, examCode, value) {
  const key = buildReminderCacheKey(externalPatientId, examCode);
  shospFutureScheduleCache.set(key, {
    value,
    expiresAt: Date.now() + SHOSP_REMINDER_CACHE_TTL_MS
  });
}

function getSyncCursor(syncKey) {
  const config = db.prepare(`
    SELECT
      last_patients_cursor AS lastPatientsCursor,
      last_attendances_cursor AS lastAttendancesCursor
    FROM configuracoes_de_integracao
    WHERE integration_key = 'shosp'
  `).get();

  if (!config) {
    return db.prepare("SELECT last_cursor AS lastCursor FROM shosp_sync_state WHERE sync_key = ?").get(syncKey)?.lastCursor || null;
  }

  return syncKey === "patients" ? config.lastPatientsCursor || null : config.lastAttendancesCursor || null;
}

function setSyncCursor(syncKey, cursor) {
  const now = timestampIso();
  db.prepare(`
    UPDATE configuracoes_de_integracao
    SET
      last_patients_cursor = CASE WHEN @syncKey = 'patients' THEN @cursor ELSE last_patients_cursor END,
      last_attendances_cursor = CASE WHEN @syncKey = 'attendances' THEN @cursor ELSE last_attendances_cursor END,
      last_success_at = @lastSuccessAt,
      updated_at = @updatedAt
    WHERE integration_key = 'shosp'
  `).run({
    syncKey,
    cursor,
    lastSuccessAt: now,
    updatedAt: now
  });

  db.prepare(`
    INSERT INTO shosp_sync_state (sync_key, last_cursor, last_success_at, updated_at)
    VALUES (@syncKey, @cursor, @lastSuccessAt, @updatedAt)
    ON CONFLICT(sync_key) DO UPDATE SET
      last_cursor = excluded.last_cursor,
      last_success_at = excluded.last_success_at,
      updated_at = excluded.updated_at
  `).run({
    syncKey,
    cursor,
    lastSuccessAt: now,
    updatedAt: now
  });
}

function startSyncLog(scope, mode) {
  const now = timestampIso();
  const result = db.prepare(`
    INSERT INTO logs_de_sincronizacao (
      integration_key,
      scope,
      mode,
      status,
      started_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run("shosp", scope, mode, now, now, now);

  return result.lastInsertRowid;
}

function finishSyncLog(logId, payload) {
  const now = timestampIso();
  db.prepare(`
    UPDATE logs_de_sincronizacao
    SET
      status = @status,
      finished_at = @finishedAt,
      records_received = @recordsReceived,
      records_processed = @recordsProcessed,
      records_created = @recordsCreated,
      records_updated = @recordsUpdated,
      sync_error = @errorMessage,
      payload_json = @detailsJson,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: logId,
    status: payload.status,
    finishedAt: now,
    recordsReceived: payload.recordsReceived || 0,
    recordsProcessed: payload.recordsProcessed || 0,
    recordsCreated: payload.recordsCreated || 0,
    recordsUpdated: payload.recordsUpdated || 0,
    errorMessage: payload.errorMessage || null,
    detailsJson: payload.details ? JSON.stringify(payload.details) : null,
    updatedAt: now
  });
}

function listExamModels() {
  return db.prepare(`
    SELECT
      id,
      code,
      name,
      target_week AS targetWeek,
      reminder_days_before_1 AS reminderDaysBefore1,
      reminder_days_before_2 AS reminderDaysBefore2,
      flow_type AS flowType
    FROM exames_modelo
    WHERE active = 1
    ORDER BY sort_order, id
  `).all();
}

function normalizePhone(phone) {
  return normalizeBrazilPhone(phone);
}

function getGestationalStoragePayload(snapshot, referenceDate = todayIso()) {
  return {
    dum: null,
    dpp: snapshot.dpp,
    currentGestationalWeeks: snapshot.currentGestationalWeeks,
    currentGestationalDays: snapshot.currentGestationalDays,
    gestationalBaseDate: referenceDate,
    gestationalBaseSource: snapshot.gestationalBaseSource,
    gestationalBaseConfidence: snapshot.gestationalBaseConfidence,
    gestationalBaseIsEstimated: snapshot.gestationalBaseIsEstimated ? 1 : 0,
    gestationalReviewRequired: snapshot.gestationalBaseRequiresManualReview ? 1 : 0,
    gestationalBaseConflict: snapshot.gestationalBaseHasConflict ? 1 : 0,
    gestationalBaseConflictNote: snapshot.gestationalBaseConflictNote || null
  };
}

function findPatientByExternalId(externalPatientId) {
  return db.prepare(`
    SELECT
      id,
      dum,
      stage,
      notes,
      current_gestational_weeks AS gestationalWeeks,
      current_gestational_days AS gestationalDays,
      gestational_base_date AS gestationalBaseDate,
      gestational_base_source AS gestationalBaseSource,
      imported_from_shosp AS importedFromShosp,
      shosp_patient_id AS shospPatientId
    FROM patients
    WHERE shosp_patient_id = ?
       OR (external_source = ? AND external_patient_id = ?)
  `).get(externalPatientId, SHOSP_SOURCE, externalPatientId);
}

function findPatientFallback(patient) {
  if (patient.phone) {
    return db.prepare(`
      SELECT
        id,
        dum,
        stage,
        notes,
        current_gestational_weeks AS gestationalWeeks,
        current_gestational_days AS gestationalDays,
        gestational_base_date AS gestationalBaseDate,
        gestational_base_source AS gestationalBaseSource,
        imported_from_shosp AS importedFromShosp,
        shosp_patient_id AS shospPatientId
      FROM patients
      WHERE phone = ?
    `).get(normalizePhone(patient.phone));
  }

  return db.prepare(`
    SELECT
      id,
      dum,
      stage,
      notes,
      current_gestational_weeks AS gestationalWeeks,
      current_gestational_days AS gestationalDays,
      gestational_base_date AS gestationalBaseDate,
      gestational_base_source AS gestationalBaseSource,
      imported_from_shosp AS importedFromShosp,
      shosp_patient_id AS shospPatientId
    FROM patients
    WHERE name = ? AND (birth_date = ? OR ? IS NULL)
  `).get(patient.name, patient.birthDate || null, patient.birthDate || null);
}

function ensurePatientExamSchedule(patientId, patientDum, createdAt) {
  if (!patientDum) {
    return;
  }

  const examModels = listExamModels().filter((examModel) => examModel.flowType !== "avulso");
  const existingExamIds = new Set(
    db.prepare("SELECT exam_model_id AS examModelId FROM exames_paciente WHERE patient_id = ?").all(patientId).map((row) => row.examModelId)
  );
    const insertExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      status,
      imported_from_shosp,
      sync_status,
      created_at,
      updated_at,
      external_source
    )
    VALUES (?, ?, ?, ?, ?, 'pendente', 1, 'sincronizado', ?, ?, ?)
  `);

  examModels.forEach((examModel) => {
    if (existingExamIds.has(examModel.id)) {
      return;
    }

    const schedule = calculateExamScheduleDates({
      dum: patientDum,
      targetWeek: examModel.targetWeek,
      reminderDaysBefore1: examModel.reminderDaysBefore1,
      reminderDaysBefore2: examModel.reminderDaysBefore2
    });

    insertExam.run(
      patientId,
      examModel.id,
      schedule.predictedDate,
      schedule.reminderDate1,
      schedule.reminderDate2,
      createdAt,
      createdAt,
      SHOSP_SOURCE
    );
  });
}

function upsertPatientFromShosp(patient) {
  const now = todayIso();
  const existing = findPatientByExternalId(patient.externalPatientId) || findPatientFallback(patient);
  const snapshot = resolvePregnancySnapshot({
    dum: null,
    gestationalWeeks: patient.gestationalWeeks ?? existing?.gestationalWeeks ?? null,
    gestationalDays: patient.gestationalDays ?? existing?.gestationalDays ?? null,
    gestationalBaseDate: patient.gestationalBaseDate || existing?.gestationalBaseDate || null,
    gestationalBaseSource: patient.gestationalBaseDate
      ? "shosp_estruturado"
      : existing?.gestationalBaseSource || null,
    importedFromShosp: true
  });
  const gestationalPayload = getGestationalStoragePayload(snapshot, now);

  if (existing) {
    db.prepare(`
      UPDATE patients
      SET
        name = @name,
        phone = @phone,
        birth_date = @birthDate,
        dum = @dum,
        dpp = @dpp,
        current_gestational_weeks = @currentGestationalWeeks,
        current_gestational_days = @currentGestationalDays,
        gestational_base_date = @gestationalBaseDate,
        gestational_base_source = @gestationalBaseSource,
        gestational_base_confidence = @gestationalBaseConfidence,
        gestational_base_is_estimated = @gestationalBaseIsEstimated,
        gestational_review_required = @gestationalReviewRequired,
        gestational_base_conflict = @gestationalBaseConflict,
        gestational_base_conflict_note = @gestationalBaseConflictNote,
        physician_name = @physicianName,
        clinic_unit = @clinicUnit,
        pregnancy_type = @pregnancyType,
        high_risk = @highRisk,
        notes = @notes,
        shosp_patient_id = @shospPatientId,
        shosp_last_sync_at = @shospLastSyncAt,
        imported_from_shosp = 1,
        sync_status = 'sincronizado',
        sync_error = NULL,
        external_source = @externalSource,
        external_patient_id = @externalPatientId,
        external_updated_at = @externalUpdatedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: existing.id,
      name: patient.name,
      phone: normalizePhone(patient.phone),
      birthDate: patient.birthDate || null,
      dum: gestationalPayload.dum,
      dpp: patient.dpp || gestationalPayload.dpp,
      currentGestationalWeeks: gestationalPayload.currentGestationalWeeks,
      currentGestationalDays: gestationalPayload.currentGestationalDays,
      gestationalBaseDate: gestationalPayload.gestationalBaseDate,
      gestationalBaseSource: gestationalPayload.gestationalBaseSource,
      gestationalBaseConfidence: gestationalPayload.gestationalBaseConfidence,
      gestationalBaseIsEstimated: gestationalPayload.gestationalBaseIsEstimated,
      gestationalReviewRequired: gestationalPayload.gestationalReviewRequired,
      gestationalBaseConflict: gestationalPayload.gestationalBaseConflict,
      gestationalBaseConflictNote: gestationalPayload.gestationalBaseConflictNote,
      physicianName: patient.physicianName || null,
      clinicUnit: patient.clinicUnit || null,
      pregnancyType: patient.pregnancyType || null,
      highRisk: patient.highRisk ? 1 : 0,
      notes: patient.notes || existing.notes || "Sincronizado do Shosp.",
      shospPatientId: patient.externalPatientId,
      shospLastSyncAt: patient.updatedAt || now,
      externalSource: SHOSP_SOURCE,
      externalPatientId: patient.externalPatientId,
      externalUpdatedAt: patient.updatedAt || now,
      updatedAt: now
    });

    ensurePatientExamSchedule(existing.id, snapshot.dum, now);
    return { type: "updated", patientId: existing.id };
  }

  const result = db.prepare(`
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
      gestational_base_conflict,
      gestational_base_conflict_note,
      physician_name,
      clinic_unit,
      pregnancy_type,
      high_risk,
      shosp_patient_id,
      shosp_last_sync_at,
      imported_from_shosp,
      sync_status,
      sync_error,
      external_source,
      external_patient_id,
      external_updated_at,
      notes,
      status,
      stage,
      created_at,
      updated_at
    )
    VALUES (
      @name,
      @phone,
      @birthDate,
      @dum,
      @dpp,
      @currentGestationalWeeks,
      @currentGestationalDays,
      @gestationalBaseDate,
      @gestationalBaseSource,
      @gestationalBaseConfidence,
      @gestationalBaseIsEstimated,
      @gestationalReviewRequired,
      @gestationalBaseConflict,
      @gestationalBaseConflictNote,
      @physicianName,
      @clinicUnit,
      @pregnancyType,
      @highRisk,
      @shospPatientId,
      @shospLastSyncAt,
      1,
      'sincronizado',
      NULL,
      @externalSource,
      @externalPatientId,
      @externalUpdatedAt,
      @notes,
      'ativa',
      'contato_pendente',
      @createdAt,
      @updatedAt
    )
  `).run({
    name: patient.name,
    phone: normalizePhone(patient.phone),
    birthDate: patient.birthDate || null,
    dum: gestationalPayload.dum,
    dpp: patient.dpp || gestationalPayload.dpp,
    currentGestationalWeeks: gestationalPayload.currentGestationalWeeks,
    currentGestationalDays: gestationalPayload.currentGestationalDays,
    gestationalBaseDate: gestationalPayload.gestationalBaseDate,
    gestationalBaseSource: gestationalPayload.gestationalBaseSource,
    gestationalBaseConfidence: gestationalPayload.gestationalBaseConfidence,
    gestationalBaseIsEstimated: gestationalPayload.gestationalBaseIsEstimated,
    gestationalReviewRequired: gestationalPayload.gestationalReviewRequired,
    gestationalBaseConflict: gestationalPayload.gestationalBaseConflict,
    gestationalBaseConflictNote: gestationalPayload.gestationalBaseConflictNote,
    physicianName: patient.physicianName || null,
    clinicUnit: patient.clinicUnit || null,
    pregnancyType: patient.pregnancyType || null,
    highRisk: patient.highRisk ? 1 : 0,
    shospPatientId: patient.externalPatientId,
    shospLastSyncAt: patient.updatedAt || now,
    externalSource: SHOSP_SOURCE,
    externalPatientId: patient.externalPatientId,
    externalUpdatedAt: patient.updatedAt || now,
    notes: patient.notes || "Paciente sincronizada do Shosp.",
    createdAt: now,
    updatedAt: now
  });

  ensurePatientExamSchedule(result.lastInsertRowid, snapshot.dum, now);
  return { type: "created", patientId: result.lastInsertRowid };
}

function findExamModel(externalExam) {
  if (externalExam.examCode) {
    const mapped = db.prepare(`
      SELECT
        exames_modelo.id,
        exames_modelo.code,
        exames_modelo.target_week AS targetWeek,
        exames_modelo.reminder_days_before_1 AS reminderDaysBefore1,
        exames_modelo.reminder_days_before_2 AS reminderDaysBefore2
      FROM mapeamento_de_tipos_de_exame_shosp
      INNER JOIN exames_modelo ON exames_modelo.id = mapeamento_de_tipos_de_exame_shosp.exam_model_id
      WHERE mapeamento_de_tipos_de_exame_shosp.shosp_exam_code = ?
        AND mapeamento_de_tipos_de_exame_shosp.active = 1
        AND exames_modelo.active = 1
      LIMIT 1
    `).get(externalExam.examCode);

    if (mapped) {
      return mapped;
    }

    const byCode = db.prepare(`
      SELECT id, code, target_week AS targetWeek, reminder_days_before_1 AS reminderDaysBefore1, reminder_days_before_2 AS reminderDaysBefore2
      FROM exames_modelo
      WHERE code = ? AND active = 1
    `).get(externalExam.examCode);

    if (byCode) {
      return byCode;
    }
  }

  const mappedByName = db.prepare(`
    SELECT
      exames_modelo.id,
      exames_modelo.code,
      exames_modelo.target_week AS targetWeek,
      exames_modelo.reminder_days_before_1 AS reminderDaysBefore1,
      exames_modelo.reminder_days_before_2 AS reminderDaysBefore2
    FROM mapeamento_de_tipos_de_exame_shosp
    INNER JOIN exames_modelo ON exames_modelo.id = mapeamento_de_tipos_de_exame_shosp.exam_model_id
    WHERE lower(mapeamento_de_tipos_de_exame_shosp.shosp_exam_name) = lower(?)
      AND mapeamento_de_tipos_de_exame_shosp.active = 1
      AND exames_modelo.active = 1
    LIMIT 1
  `).get(externalExam.examName);

  if (mappedByName) {
    return mappedByName;
  }

  return db.prepare(`
    SELECT id, code, target_week AS targetWeek, reminder_days_before_1 AS reminderDaysBefore1, reminder_days_before_2 AS reminderDaysBefore2
    FROM exames_modelo
    WHERE lower(name) = lower(?) AND active = 1
  `).get(externalExam.examName);
}

function upsertExamFromShosp(attendance) {
  const now = todayIso();
  const patient = db.prepare(`
    SELECT
      id,
      dum,
      current_gestational_weeks AS gestationalWeeks,
      current_gestational_days AS gestationalDays,
      gestational_base_date AS gestationalBaseDate,
      gestational_base_source AS gestationalBaseSource,
      imported_from_shosp AS importedFromShosp,
      shosp_patient_id AS shospPatientId
    FROM patients
    WHERE shosp_patient_id = ?
       OR (external_source = ? AND external_patient_id = ?)
  `).get(attendance.externalPatientId, SHOSP_SOURCE, attendance.externalPatientId);

  if (!patient) {
    return { type: "skipped", reason: "Paciente ainda nao sincronizada." };
  }

  const examModel = findExamModel(attendance);
  if (!examModel) {
    return { type: "skipped", reason: "Exame nao mapeado no protocolo local." };
  }

  const existing = db.prepare(`
    SELECT id
    FROM exames_paciente
    WHERE
      (external_source = ? AND external_exam_item_id = ?)
      OR (patient_id = ? AND exam_model_id = ?)
    LIMIT 1
  `).get(SHOSP_SOURCE, attendance.externalExamItemId, patient.id, examModel.id);

  const patientSnapshot = resolvePregnancySnapshot(patient, now);
  const baseSchedule =
    patientSnapshot.dum
      ? calculateExamScheduleDates({
          dum: patientSnapshot.dum,
          targetWeek: examModel.targetWeek,
          reminderDaysBefore1: examModel.reminderDaysBefore1,
          reminderDaysBefore2: examModel.reminderDaysBefore2
        })
      : null;

  const nextStatus =
    attendance.completedDate || attendance.status === "realizado"
      ? "realizado"
      : attendance.scheduledDate || attendance.status === "agendado"
        ? "agendado"
        : "pendente";

  const payload = {
    patientId: patient.id,
    examModelId: examModel.id,
    predictedDate: attendance.scheduledDate || attendance.completedDate || baseSchedule?.predictedDate || now,
    reminderDate1: baseSchedule?.reminderDate1 || null,
    reminderDate2: baseSchedule?.reminderDate2 || null,
    scheduledDate: attendance.scheduledDate || null,
    scheduledTime: attendance.scheduledTime || null,
    schedulingNotes: attendance.notes || null,
    completedDate: attendance.completedDate || null,
    status: nextStatus,
    shospExamId: attendance.externalExamItemId || attendance.externalExamRequestId || null,
    shospLastSyncAt: attendance.updatedAt || now,
    externalSource: SHOSP_SOURCE,
    externalExamRequestId: attendance.externalExamRequestId || null,
    externalAttendanceId: attendance.externalAttendanceId || null,
    externalExamItemId: attendance.externalExamItemId || null,
    externalUpdatedAt: attendance.updatedAt || now,
    updatedAt: now
  };

  if (existing) {
    db.prepare(`
      UPDATE exames_paciente
      SET
        predicted_date = @predictedDate,
        reminder_date_1 = @reminderDate1,
        reminder_date_2 = @reminderDate2,
        scheduled_date = @scheduledDate,
        scheduled_time = @scheduledTime,
        scheduling_notes = @schedulingNotes,
        completed_date = @completedDate,
        status = @status,
        shosp_exam_id = @shospExamId,
        shosp_last_sync_at = @shospLastSyncAt,
        imported_from_shosp = 1,
        sync_status = 'sincronizado',
        sync_error = NULL,
        external_source = @externalSource,
        external_exam_request_id = @externalExamRequestId,
        external_attendance_id = @externalAttendanceId,
        external_exam_item_id = @externalExamItemId,
        external_updated_at = @externalUpdatedAt,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      predictedDate: payload.predictedDate,
      reminderDate1: payload.reminderDate1,
      reminderDate2: payload.reminderDate2,
      scheduledDate: payload.scheduledDate,
      scheduledTime: payload.scheduledTime,
      schedulingNotes: payload.schedulingNotes,
      completedDate: payload.completedDate,
      status: payload.status,
      shospExamId: payload.shospExamId,
      shospLastSyncAt: payload.shospLastSyncAt,
      externalSource: payload.externalSource,
      externalExamRequestId: payload.externalExamRequestId,
      externalAttendanceId: payload.externalAttendanceId,
      externalExamItemId: payload.externalExamItemId,
      externalUpdatedAt: payload.externalUpdatedAt,
      updatedAt: payload.updatedAt,
      id: existing.id
    });

    return { type: "updated", examId: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      scheduled_date,
      scheduled_time,
      scheduling_notes,
      completed_date,
      status,
      shosp_exam_id,
      shosp_last_sync_at,
      imported_from_shosp,
      sync_status,
      sync_error,
      external_source,
      external_exam_request_id,
      external_attendance_id,
      external_exam_item_id,
      external_updated_at,
      created_at,
      updated_at
    )
    VALUES (
      @patientId,
      @examModelId,
      @predictedDate,
      @reminderDate1,
      @reminderDate2,
      @scheduledDate,
      @scheduledTime,
      @schedulingNotes,
      @completedDate,
      @status,
      @shospExamId,
      @shospLastSyncAt,
      1,
      'sincronizado',
      NULL,
      @externalSource,
      @externalExamRequestId,
      @externalAttendanceId,
      @externalExamItemId,
      @externalUpdatedAt,
      @updatedAt,
      @updatedAt
    )
  `).run(payload);

  return { type: "created", examId: result.lastInsertRowid };
}

function summarizeSyncResults(scope, mode, records, handlerResults, nextCursor, errorMessage = null) {
  const created = handlerResults.filter((item) => item.type === "created").length;
  const updated = handlerResults.filter((item) => item.type === "updated").length;
  const skipped = handlerResults.filter((item) => item.type === "skipped");

  return {
    scope,
    mode,
    ok: !errorMessage,
    nextCursor,
    recordsReceived: records.length,
    recordsProcessed: created + updated,
    recordsCreated: created,
    recordsUpdated: updated,
    skipped,
    errorMessage
  };
}

function parseLogDurationMs(startedAt, finishedAt) {
  if (!startedAt || !finishedAt || !String(startedAt).includes("T") || !String(finishedAt).includes("T")) {
    return null;
  }

  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
}

function getShospSyncSummary() {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM patients WHERE imported_from_shosp = 1) AS patientsSynced,
      (SELECT COUNT(*) FROM exames_paciente WHERE imported_from_shosp = 1) AS examsImported,
      (SELECT COUNT(*) FROM historico_de_movimentacoes WHERE action_type = 'agendamento_detectado_shosp') AS detectedSchedules,
      (SELECT MAX(COALESCE(finished_at, started_at)) FROM logs_de_sincronizacao WHERE integration_key = 'shosp') AS lastSyncAt
  `).get();

  const recentErrors = db.prepare(`
    SELECT
      id,
      scope,
      status,
      sync_error AS errorMessage,
      started_at AS startedAt,
      finished_at AS finishedAt
    FROM logs_de_sincronizacao
    WHERE integration_key = 'shosp'
      AND (status = 'error' OR sync_error IS NOT NULL)
    ORDER BY id DESC
    LIMIT 5
  `).all().map((item) => ({
    ...item,
    durationMs: parseLogDurationMs(item.startedAt, item.finishedAt)
  }));

  return {
    lastSyncAt: totals.lastSyncAt || null,
    patientsSynced: totals.patientsSynced || 0,
    examsImported: totals.examsImported || 0,
    detectedSchedules: totals.detectedSchedules || 0,
    recentErrorsCount: recentErrors.length,
    recentErrors
  };
}

function getConnectionStatus(runtimeConfig, configured, apiMetrics) {
  if (!configured) {
    return {
      connected: false,
      label: "Desconectado",
      detail: "Base URL ou credenciais do Shosp ainda nao foram configuradas."
    };
  }

  if (runtimeConfig.mode === "mock") {
    return {
      connected: true,
      label: "Conectado",
      detail: "Modo mock ativo para testes seguros sem trafego real."
    };
  }

  if (apiMetrics.lastFailureAt && (!apiMetrics.lastSuccessAt || apiMetrics.lastFailureAt > apiMetrics.lastSuccessAt)) {
    return {
      connected: false,
      label: "Desconectado",
      detail: apiMetrics.lastErrorMessage || "A ultima tentativa de contato com o Shosp falhou."
    };
  }

  return {
    connected: true,
    label: "Conectado",
    detail: apiMetrics.lastSuccessAt
      ? "Ultima chamada ao Shosp concluida com sucesso."
      : "Configuracao pronta para uso."
  };
}

async function runScopedSync({ scope, syncKey, fetcher, processor, incremental = true }) {
  const provider = getShospProvider();
  const runtimeConfig = getEffectiveShospRuntimeConfig();
  const logId = startSyncLog(scope, runtimeConfig.mode);
  const updatedSince = incremental ? getSyncCursor(syncKey) : null;

  try {
    await provider.authenticate();
    const response = await fetcher(provider, updatedSince);
    const handlerResults = response.records.map((record) => {
      try {
        return processor(record);
      } catch (error) {
        return {
          type: "skipped",
          reason: error instanceof Error ? error.message : "Falha ao processar registro."
        };
      }
    });

    const summary = summarizeSyncResults(scope, runtimeConfig.mode, response.records, handlerResults, response.nextCursor || todayIso());
    finishSyncLog(logId, {
      status: summary.skipped.length ? "partial" : "success",
      recordsReceived: summary.recordsReceived,
      recordsProcessed: summary.recordsProcessed,
      recordsCreated: summary.recordsCreated,
      recordsUpdated: summary.recordsUpdated,
      details: {
        skipped: summary.skipped
      }
    });
    setSyncCursor(syncKey, summary.nextCursor);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada na sincronizacao com o Shosp.";
    finishSyncLog(logId, {
      status: "error",
      errorMessage: message,
      details: {
        syncKey,
        updatedSince
      }
    });
    return {
      scope,
      mode: runtimeConfig.mode,
      ok: false,
      nextCursor: updatedSince,
      recordsReceived: 0,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      skipped: [],
      errorMessage: message
    };
  }
}

export function getShospIntegrationStatus() {
  const runtimeConfig = getEffectiveShospRuntimeConfig();
  const configured = Boolean(
    runtimeConfig.mode === "mock" ||
    (runtimeConfig.baseUrl && (runtimeConfig.apiToken || runtimeConfig.apiKey || runtimeConfig.username))
  );
  const integrationConfig = db.prepare(`
    SELECT
      use_mock AS useMock,
      api_base_url AS apiBaseUrl,
      api_token AS apiToken,
      api_key AS apiKey,
      username,
      password,
      company_id AS companyId,
      last_patients_cursor AS lastPatientsCursor,
      last_attendances_cursor AS lastAttendancesCursor,
      last_success_at AS lastSuccessAt,
      settings_json AS settingsJson,
      updated_at AS updatedAt
    FROM configuracoes_de_integracao
    WHERE integration_key = 'shosp'
  `).get();

  const lastLogs = db.prepare(`
    SELECT
      id,
      integration_key AS integrationKey,
      scope,
      mode,
      status,
      started_at AS startedAt,
      finished_at AS finishedAt,
      records_received AS recordsReceived,
      records_processed AS recordsProcessed,
      records_created AS recordsCreated,
      records_updated AS recordsUpdated,
      sync_error AS errorMessage,
      payload_json AS detailsJson
    FROM logs_de_sincronizacao
    WHERE integration_key = 'shosp'
    ORDER BY id DESC
    LIMIT 15
  `).all().map((log) => ({
    ...log,
    details: log.detailsJson ? JSON.parse(log.detailsJson) : null,
    durationMs: parseLogDurationMs(log.startedAt, log.finishedAt)
  }));

  const cursors = db.prepare(`
    SELECT
      sync_key AS syncKey,
      last_cursor AS lastCursor,
      last_success_at AS lastSuccessAt,
      updated_at AS updatedAt
    FROM shosp_sync_state
    ORDER BY sync_key
  `).all();

  const apiMetrics = getShospApiRuntimeMetrics();
  const summary = getShospSyncSummary();
  const connection = getConnectionStatus(runtimeConfig, configured, apiMetrics);

  return {
    mode: runtimeConfig.mode,
    configured,
    connection,
    summary,
    apiMetrics,
    worker: getShospSyncWorkerStatus(),
    settings: {
      baseUrl: runtimeConfig.baseUrl,
      patientsPath: runtimeConfig.patientsPath,
      attendancesPath: runtimeConfig.attendancesPath,
      examsPath: runtimeConfig.examsPath,
      timeoutMs: runtimeConfig.timeoutMs
    },
    persistedConfig: integrationConfig
      ? {
          useMock: Boolean(integrationConfig.useMock),
          apiBaseUrl: integrationConfig.apiBaseUrl,
          apiToken: "",
          apiKey: "",
          username: null,
          password: "",
          companyId: null,
          lastPatientsCursor: integrationConfig.lastPatientsCursor,
          lastAttendancesCursor: integrationConfig.lastAttendancesCursor,
          lastSuccessAt: integrationConfig.lastSuccessAt,
          settings: integrationConfig.settingsJson ? JSON.parse(integrationConfig.settingsJson) : {}
        }
      : null,
    cursors,
    logs: lastLogs
  };
}

export function listShospExamMappings() {
  return db.prepare(`
    SELECT
      mapping.id,
      mapping.shosp_exam_code AS shospExamCode,
      mapping.shosp_exam_name AS shospExamName,
      mapping.exam_model_id AS examModelId,
      exam.name AS examModelName,
      exam.code AS examModelCode,
      mapping.active,
      mapping.notes,
      mapping.created_at AS createdAt,
      mapping.updated_at AS updatedAt
    FROM mapeamento_de_tipos_de_exame_shosp mapping
    INNER JOIN exames_modelo exam ON exam.id = mapping.exam_model_id
    ORDER BY mapping.shosp_exam_name COLLATE NOCASE, mapping.id
  `).all().map((item) => ({
    ...item,
    active: Boolean(item.active)
  }));
}

export function updateShospExamMapping(mappingId, input) {
  const current = db.prepare(`
    SELECT id
    FROM mapeamento_de_tipos_de_exame_shosp
    WHERE id = ?
  `).get(mappingId);

  if (!current) {
    throw new Error("Mapeamento do Shosp nao encontrado.");
  }

  const examModelId = Number(input.examModelId || 0);
  const active = input.active !== false;
  const notes = String(input.notes || "").trim();

  if (!examModelId) {
    throw new Error("Selecione um exame local valido para o mapeamento.");
  }

  const examModel = db.prepare(`
    SELECT id
    FROM exames_modelo
    WHERE id = ?
  `).get(examModelId);

  if (!examModel) {
    throw new Error("O exame local informado nao existe.");
  }

  db.prepare(`
    UPDATE mapeamento_de_tipos_de_exame_shosp
    SET
      exam_model_id = @examModelId,
      active = @active,
      notes = @notes,
      updated_at = @updatedAt
    WHERE id = @id
  `).run({
    id: mappingId,
    examModelId,
    active: active ? 1 : 0,
    notes: notes || null,
    updatedAt: todayIso()
  });

  return listShospExamMappings().find((item) => item.id === mappingId);
}

export function updateShospIntegrationSettings(input) {
  const current = db.prepare(`
    SELECT id
    FROM configuracoes_de_integracao
    WHERE integration_key = 'shosp'
  `).get();

  if (!current) {
    throw new Error("Configuracao da integracao com o Shosp nao encontrada.");
  }

  const useMock = input.useMock !== false;
  const apiBaseUrl = String(input.apiBaseUrl || "").trim() || null;
  const companyId = null;
  const patientsPath = String(input.patientsPath || "/patients").trim() || "/patients";
  const attendancesPath = String(input.attendancesPath || "/attendances").trim() || "/attendances";
  const examsPath = String(input.examsPath || "/exams").trim() || "/exams";
  const timeoutMs = Number(input.timeoutMs || 15000);

  if (!useMock && !apiBaseUrl) {
    throw new Error("Informe a Base URL quando a integracao nao estiver em modo mock.");
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Informe um timeout valido para a integracao.");
  }

  db.prepare(`
    UPDATE configuracoes_de_integracao
    SET
      use_mock = @useMock,
      api_base_url = @apiBaseUrl,
      api_token = NULL,
      api_key = NULL,
      username = NULL,
      password = NULL,
      company_id = @companyId,
      settings_json = @settingsJson,
      updated_at = @updatedAt
    WHERE integration_key = 'shosp'
  `).run({
    useMock: useMock ? 1 : 0,
    apiBaseUrl,
    companyId,
    settingsJson: JSON.stringify({
      patientsPath,
      attendancesPath,
      examsPath,
      timeoutMs
    }),
    updatedAt: todayIso()
  });

  return getShospIntegrationStatus();
}

export function testShospConnection() {
  const now = todayIso();
  const status = getShospIntegrationStatus();
  const runtimeConfig = getEffectiveShospRuntimeConfig();

  const effectiveMode = runtimeConfig.mode;
  const effectiveBaseUrl = runtimeConfig.baseUrl || "";
  const effectiveUsername = runtimeConfig.username || "";
  const effectiveHasToken = Boolean(runtimeConfig.apiToken);
  const effectiveHasApiKey = Boolean(runtimeConfig.apiKey);
  const effectiveHasPassword = Boolean(runtimeConfig.password);

  if (effectiveMode === "mock") {
    return {
      ok: true,
      mode: effectiveMode,
      simulated: true,
      message: "Modo mock ativo. Configuracao pronta para testes seguros sem conexao real.",
      checkedAt: now,
      details: {
        source: "mock",
        baseUrl: effectiveBaseUrl || null
      }
    };
  }

  const hasAuth = effectiveHasToken || effectiveHasApiKey || (effectiveUsername && effectiveHasPassword);
  if (!effectiveBaseUrl || !hasAuth) {
    return {
      ok: false,
      mode: effectiveMode,
      simulated: true,
      message: "Configuracao incompleta para conexao live. Revise Base URL e credenciais.",
      checkedAt: now,
      details: {
        baseUrlConfigured: Boolean(effectiveBaseUrl),
        hasToken: effectiveHasToken,
        hasApiKey: effectiveHasApiKey,
        hasUserAndPassword: Boolean(effectiveUsername && effectiveHasPassword)
      }
    };
  }

  return {
    ok: true,
    mode: effectiveMode,
    simulated: true,
    message: "Configuracao live parece valida. O teste foi apenas estrutural e nao executou chamada real.",
    checkedAt: now,
    details: {
      baseUrl: effectiveBaseUrl,
      authMode: effectiveHasToken ? "token" : effectiveHasApiKey ? "api_key" : "usuario_senha"
    }
  };
}

export async function testShospLiveConnection() {
  const now = todayIso();
  const runtimeConfig = getEffectiveShospRuntimeConfig();

  if (runtimeConfig.mode === "mock") {
    return {
      ok: true,
      mode: runtimeConfig.mode,
      simulated: true,
      message: "Modo mock ativo. Nenhuma chamada real foi feita ao Shosp.",
      checkedAt: now,
      details: {
        source: "mock"
      }
    };
  }

  const connectionCheck = testShospConnection();
  if (!connectionCheck.ok) {
    return connectionCheck;
  }

  const authResult = await getShospProvider().authenticate();
  return {
    ok: Boolean(authResult.ok),
    mode: runtimeConfig.mode,
    simulated: true,
    message: authResult.ok
      ? "Estrutura de autenticacao validada. O teste nao executou importacao real."
      : "A configuracao live nao passou na validacao da autenticacao.",
    checkedAt: now,
    details: {
      headersConfigured: Object.keys(authResult.headers || {})
    }
  };
}

export async function syncShospPatients({ incremental = true } = {}) {
  return runScopedSync({
    scope: "patients",
    syncKey: "patients",
    incremental,
    fetcher: (provider, updatedSince) => provider.fetchPatients({ updatedSince }),
    processor: upsertPatientFromShosp
  });
}

export async function syncShospExamsAndAttendances({ incremental = true } = {}) {
  return runScopedSync({
    scope: "attendances",
    syncKey: "attendances",
    incremental,
    fetcher: (provider, updatedSince) => provider.fetchAttendancesAndExams({ updatedSince }),
    processor: upsertExamFromShosp
  });
}

export async function runShospIncrementalSync({ incremental = true } = {}) {
  const patients = await syncShospPatients({ incremental });
  const attendances = await syncShospExamsAndAttendances({ incremental });

  return {
    ok: patients.ok && attendances.ok,
    mode: SHOSP_CONFIG.mode,
    patients,
    attendances
  };
}

export async function reprocessShospData() {
  return runShospIncrementalSync({ incremental: false });
}

export async function lookupFutureScheduledExamInShosp({ externalPatientId, examCode } = {}) {
  if (!externalPatientId || !examCode) {
    return null;
  }

  const cached = readReminderCache(externalPatientId, examCode);
  if (cached !== null) {
    return cached;
  }

  try {
    const provider = getShospProvider();
    await provider.authenticate();
    const schedule = await provider.fetchFutureScheduledExamForPatient({ externalPatientId, examCode });
    const normalized = schedule
      ? {
          externalAttendanceId: schedule.externalAttendanceId || null,
          externalExamRequestId: schedule.externalExamRequestId || null,
          externalExamItemId: schedule.externalExamItemId || null,
          scheduledDate: schedule.scheduledDate || null,
          scheduledTime: schedule.scheduledTime || null,
          examCode: schedule.examCode || examCode,
          examName: schedule.examName || null,
          updatedAt: schedule.updatedAt || todayIso(),
          source: SHOSP_SOURCE
        }
      : null;
    writeReminderCache(externalPatientId, examCode, normalized);
    return normalized;
  } catch {
    writeReminderCache(externalPatientId, examCode, null);
    return null;
  }
}

export function resetShospReminderLookupCache() {
  shospFutureScheduleCache.clear();
}

export function clearShospSynchronizationCache() {
  const clearedReminderEntries = shospFutureScheduleCache.size;
  shospFutureScheduleCache.clear();
  resetShospApiRuntimeMetrics();

  return {
    ok: true,
    clearedReminderEntries,
    clearedAt: timestampIso()
  };
}
