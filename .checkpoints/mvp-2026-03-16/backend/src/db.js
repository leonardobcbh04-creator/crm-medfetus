import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_FILE, KANBAN_STAGES } from "./config.js";
import { clinicUnits, examModels, messageTemplates, patients, physicians, users } from "./data/seedData.js";
import { calculateExamScheduleDates, resolvePregnancySnapshot } from "./domain/obstetrics.js";
import { addDays, todayIso } from "./utils/date.js";

const dataDirectory = path.dirname(DB_FILE);
fs.mkdirSync(dataDirectory, { recursive: true });

export const db = new DatabaseSync(DB_FILE);

export function initializeDatabase() {
  db.exec("PRAGMA foreign_keys = ON");

  createTables();
  syncKanbanColumns();

  const counts = {
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    units: db.prepare("SELECT COUNT(*) AS count FROM clinic_units").get().count,
    physicians: db.prepare("SELECT COUNT(*) AS count FROM physicians").get().count,
    patients: db.prepare("SELECT COUNT(*) AS count FROM patients").get().count,
    examModels: db.prepare("SELECT COUNT(*) AS count FROM exames_modelo").get().count,
    kanbanColumns: db.prepare("SELECT COUNT(*) AS count FROM kanban_columns").get().count
  };

  if (!counts.users && !counts.units && !counts.physicians && !counts.patients && !counts.examModels && !counts.kanbanColumns) {
    seedDatabase();
  } else if (!counts.kanbanColumns) {
    seedKanbanColumns();
  }
}

function createTables() {
  db.exec(`
    -- Usuarios do sistema.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'atendente',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Unidades da clinica usadas em filtros e cadastros.
    CREATE TABLE IF NOT EXISTS clinic_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Medicos cadastrados para organizacao do atendimento.
    CREATE TABLE IF NOT EXISTS physicians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      clinic_unit_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (clinic_unit_id) REFERENCES clinic_units(id)
    );

    -- Cadastro central de pacientes acompanhadas pela clinica.
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      birth_date TEXT,
      dum TEXT,
      dpp TEXT,
      current_gestational_weeks INTEGER,
      current_gestational_days INTEGER,
      gestational_base_date TEXT,
      physician_name TEXT,
      clinic_unit TEXT,
      pregnancy_type TEXT,
      high_risk INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativa',
      stage TEXT NOT NULL DEFAULT 'contato_pendente',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    -- Colunas configuraveis do pipeline visual.
    CREATE TABLE IF NOT EXISTS kanban_columns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Biblioteca de exames configuraveis para o protocolo obstetrico.
    CREATE TABLE IF NOT EXISTS exames_modelo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      start_week INTEGER NOT NULL,
      end_week INTEGER NOT NULL,
      target_week INTEGER NOT NULL,
      reminder_days_before_1 INTEGER NOT NULL DEFAULT 7,
      reminder_days_before_2 INTEGER NOT NULL DEFAULT 2,
      default_message TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      flow_type TEXT NOT NULL DEFAULT 'automatico',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Agenda de exames por paciente, incluindo previsao e realizacao.
    CREATE TABLE IF NOT EXISTS exames_paciente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      exam_model_id INTEGER NOT NULL,
      predicted_date TEXT NOT NULL,
      reminder_date_1 TEXT,
      reminder_date_2 TEXT,
      scheduled_date TEXT,
      scheduled_time TEXT,
      scheduling_notes TEXT,
      scheduled_by_user_id INTEGER,
      last_contacted_at TEXT,
      reminder_snoozed_until TEXT,
      completed_date TEXT,
      completed_by_user_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pendente',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_model_id) REFERENCES exames_modelo(id) ON DELETE CASCADE,
      FOREIGN KEY (scheduled_by_user_id) REFERENCES users(id),
      FOREIGN KEY (completed_by_user_id) REFERENCES users(id),
      UNIQUE (patient_id, exam_model_id)
    );

    -- Registro de mensagens enviadas para a paciente.
    CREATE TABLE IF NOT EXISTS mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      exam_model_id INTEGER,
      content TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'pendente',
      sent_at TEXT,
      response_status TEXT NOT NULL DEFAULT 'sem_resposta',
      response_text TEXT,
      response_at TEXT,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (exam_model_id) REFERENCES exames_modelo(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    -- Templates reutilizaveis para futuras integracoes com APIs externas de mensageria.
    CREATE TABLE IF NOT EXISTS message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      language TEXT NOT NULL DEFAULT 'pt_BR',
      content TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Logs operacionais de tentativas e retornos de envio por provider externo ou modo manual.
    CREATE TABLE IF NOT EXISTS message_delivery_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      patient_id INTEGER NOT NULL,
      template_id INTEGER,
      provider TEXT NOT NULL DEFAULT 'manual_stub',
      status TEXT NOT NULL DEFAULT 'pendente',
      external_message_id TEXT,
      request_payload TEXT,
      response_payload TEXT,
      error_message TEXT,
      sent_at TEXT,
      delivered_at TEXT,
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES mensagens(id) ON DELETE SET NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES message_templates(id) ON DELETE SET NULL
    );

    -- Historico de movimentacoes no kanban e outras acoes importantes.
    CREATE TABLE IF NOT EXISTS historico_de_movimentacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      from_stage TEXT,
      to_stage TEXT,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      metadata_json TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );
  `);

  // Backward-compatible columns for existing local databases.
  const patientColumns = new Set(db.prepare("PRAGMA table_info(patients)").all().map((column) => column.name));
  if (!patientColumns.has("birth_date")) {
    db.exec("ALTER TABLE patients ADD COLUMN birth_date TEXT");
  }
  if (!patientColumns.has("pregnancy_type")) {
    db.exec("ALTER TABLE patients ADD COLUMN pregnancy_type TEXT");
  }
  if (!patientColumns.has("high_risk")) {
    db.exec("ALTER TABLE patients ADD COLUMN high_risk INTEGER NOT NULL DEFAULT 0");
  }
  const examModelColumns = new Set(db.prepare("PRAGMA table_info(exames_modelo)").all().map((column) => column.name));
  if (!examModelColumns.has("required")) {
    db.exec("ALTER TABLE exames_modelo ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
  }
  if (!examModelColumns.has("flow_type")) {
    db.exec("ALTER TABLE exames_modelo ADD COLUMN flow_type TEXT NOT NULL DEFAULT 'automatico'");
  }
  const patientExamColumns = new Set(db.prepare("PRAGMA table_info(exames_paciente)").all().map((column) => column.name));
  if (!patientExamColumns.has("scheduled_date")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN scheduled_date TEXT");
  }
  if (!patientExamColumns.has("scheduled_time")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN scheduled_time TEXT");
  }
  if (!patientExamColumns.has("scheduling_notes")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN scheduling_notes TEXT");
  }
  if (!patientExamColumns.has("scheduled_by_user_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN scheduled_by_user_id INTEGER");
  }
  if (!patientExamColumns.has("last_contacted_at")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN last_contacted_at TEXT");
  }
  if (!patientExamColumns.has("reminder_snoozed_until")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN reminder_snoozed_until TEXT");
  }
  if (!patientExamColumns.has("completed_by_user_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN completed_by_user_id INTEGER");
  }
}

export function resetDatabase() {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS historico_de_movimentacoes;
    DROP TABLE IF EXISTS message_delivery_logs;
    DROP TABLE IF EXISTS message_templates;
    DROP TABLE IF EXISTS mensagens;
    DROP TABLE IF EXISTS exames_paciente;
    DROP TABLE IF EXISTS exames_modelo;
    DROP TABLE IF EXISTS patients;
    DROP TABLE IF EXISTS physicians;
    DROP TABLE IF EXISTS clinic_units;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS patient_exams;
    DROP TABLE IF EXISTS exam_configs;
    DROP TABLE IF EXISTS kanban_columns;
  `);
  db.exec("PRAGMA foreign_keys = ON");

  createTables();
  seedDatabase();
}

function seedKanbanColumns() {
  const now = todayIso();
  const insertColumn = db.prepare(`
    INSERT INTO kanban_columns (id, title, description, sort_order, is_system, created_at, updated_at)
    VALUES (@id, @title, @description, @sortOrder, 1, @createdAt, @updatedAt)
  `);

  KANBAN_STAGES.forEach((stage, index) => {
    insertColumn.run({
      id: stage.id,
      title: stage.title,
      description: stage.description,
      sortOrder: index + 1,
      createdAt: now,
      updatedAt: now
    });
  });
}

function syncKanbanColumns() {
  const now = todayIso();
  const existingColumns = db.prepare(`
    SELECT id, is_system AS isSystem
    FROM kanban_columns
  `).all();
  const existingSystemIds = new Set(existingColumns.filter((column) => column.isSystem).map((column) => column.id));
  const validSystemIds = new Set(KANBAN_STAGES.map((stage) => stage.id));
  const insertColumn = db.prepare(`
    INSERT INTO kanban_columns (id, title, description, sort_order, is_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  const updateColumn = db.prepare(`
    UPDATE kanban_columns
    SET title = ?, description = ?, sort_order = ?, is_system = 1, updated_at = ?
    WHERE id = ?
  `);

  db.exec("BEGIN");
  try {
    KANBAN_STAGES.forEach((stage, index) => {
      if (existingSystemIds.has(stage.id)) {
        updateColumn.run(stage.title, stage.description, index + 1, now, stage.id);
      } else {
        insertColumn.run(stage.id, stage.title, stage.description, index + 1, now, now);
      }
    });

    const obsoleteSystemIds = [...existingSystemIds].filter((columnId) => !validSystemIds.has(columnId));
    if (obsoleteSystemIds.length) {
      const placeholders = obsoleteSystemIds.map(() => "?").join(", ");
      db.prepare(`UPDATE patients SET stage = 'contato_pendente', updated_at = ? WHERE stage IN (${placeholders})`).run(now, ...obsoleteSystemIds);
      db.prepare(`DELETE FROM kanban_columns WHERE is_system = 1 AND id IN (${placeholders})`).run(...obsoleteSystemIds);
    }

    db.prepare(`
      UPDATE patients
      SET stage = 'contato_pendente', updated_at = ?
      WHERE stage NOT IN (SELECT id FROM kanban_columns)
    `).run(now);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createPatientExamSchedule(patientId, dum, examModelRows, completedExamCodes, scheduledExams, createdAt) {
  const completedCodes = new Set(completedExamCodes);
  const scheduledExamMap = new Map((scheduledExams || []).map((exam) => [exam.examCode, exam]));
  const insertExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      scheduled_date,
      scheduled_time,
      scheduling_notes,
      scheduled_by_user_id,
      last_contacted_at,
      reminder_snoozed_until,
      completed_date,
      completed_by_user_id,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  examModelRows.forEach((examModel) => {
    if (examModel.flowType === "avulso") {
      return;
    }

    const { predictedDate, reminderDate1, reminderDate2 } = calculateExamScheduleDates({
      dum,
      targetWeek: examModel.targetWeek,
      reminderDaysBefore1: examModel.reminderDaysBefore1,
      reminderDaysBefore2: examModel.reminderDaysBefore2
    });
    const isCompleted = completedCodes.has(examModel.code);
    const scheduledExam = scheduledExamMap.get(examModel.code);
    const scheduledDate = scheduledExam?.scheduledDate || null;
    const scheduledTime = scheduledExam?.scheduledTime || null;
    const schedulingNotes = scheduledExam?.schedulingNotes || null;
    const scheduledByUserId = scheduledExam?.scheduledByUserId || null;
    const status = isCompleted ? "realizado" : scheduledExam ? "agendado" : "pendente";

    insertExam.run(
      patientId,
      examModel.id,
      predictedDate,
      reminderDate1,
      reminderDate2,
      scheduledDate,
      scheduledTime,
      schedulingNotes,
      scheduledByUserId,
      null,
      null,
      isCompleted ? predictedDate : null,
      isCompleted ? 1 : null,
      status,
      createdAt,
      createdAt
    );
  });
}

function seedDatabase() {
  const now = todayIso();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password, role, active, created_at, updated_at)
    VALUES (@id, @name, @email, @password, @role, @active, @createdAt, @updatedAt)
  `);

  const insertUnit = db.prepare(`
    INSERT INTO clinic_units (id, name, active, created_at, updated_at)
    VALUES (@id, @name, @active, @createdAt, @updatedAt)
  `);

  const insertPhysician = db.prepare(`
    INSERT INTO physicians (id, name, clinic_unit_id, active, created_at, updated_at)
    VALUES (@id, @name, @clinicUnitId, @active, @createdAt, @updatedAt)
  `);

  const insertExamModel = db.prepare(`
    INSERT INTO exames_modelo (
      code,
      name,
      start_week,
      end_week,
      target_week,
      reminder_days_before_1,
      reminder_days_before_2,
      default_message,
      required,
      flow_type,
      active,
      sort_order,
      created_at,
      updated_at
    )
    VALUES (
      @code,
      @name,
      @startWeek,
      @endWeek,
      @targetWeek,
      @reminderDaysBefore1,
      @reminderDaysBefore2,
      @defaultMessage,
      @required,
      @flowType,
      @active,
      @sortOrder,
      @createdAt,
      @updatedAt
    )
  `);

  const insertPatient = db.prepare(`
    INSERT INTO patients (
      name,
      phone,
      birth_date,
      dum,
      dpp,
      current_gestational_weeks,
      current_gestational_days,
      gestational_base_date,
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
      @name,
      @phone,
      @birthDate,
      @dum,
      @dpp,
      @currentGestationalWeeks,
      @currentGestationalDays,
      @gestationalBaseDate,
      @physicianName,
      @clinicUnit,
      @pregnancyType,
      @highRisk,
      @notes,
      @status,
      @stage,
      @createdByUserId,
      @createdAt,
      @updatedAt
    )
  `);

  const insertMessage = db.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'whatsapp', ?, ?, ?)
  `);

  const insertMessageTemplate = db.prepare(`
    INSERT INTO message_templates (code, name, channel, language, content, active, created_at, updated_at)
    VALUES (@code, @name, @channel, @language, @content, @active, @createdAt, @updatedAt)
  `);

  const insertHistory = db.prepare(`
    INSERT INTO historico_de_movimentacoes (
      patient_id,
      from_stage,
      to_stage,
      action_type,
      description,
      metadata_json,
      created_by_user_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");

  try {
    seedKanbanColumns();

    users.forEach((user) => {
      insertUser.run({
        ...user,
        active: user.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    });

    clinicUnits.forEach((unit) => {
      insertUnit.run({
        ...unit,
        active: unit.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    });

    physicians.forEach((physician) => {
      insertPhysician.run({
        ...physician,
        active: physician.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    });

    examModels.forEach((examModel) => {
      insertExamModel.run({
        ...examModel,
        required: examModel.required ? 1 : 0,
        active: examModel.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    });

    messageTemplates.forEach((template) => {
      insertMessageTemplate.run({
        ...template,
        active: template.active ? 1 : 0,
        createdAt: now,
        updatedAt: now
      });
    });

    const examModelRows = db.prepare(`
      SELECT
        id,
        code,
        start_week AS startWeek,
        end_week AS endWeek,
        target_week AS targetWeek,
        reminder_days_before_1 AS reminderDaysBefore1,
        reminder_days_before_2 AS reminderDaysBefore2,
        flow_type AS flowType
      FROM exames_modelo
      ORDER BY sort_order
    `).all();

    const examModelByCode = new Map(examModelRows.map((row) => [row.code, row]));

    patients.forEach((patient) => {
      const pregnancySnapshot = resolvePregnancySnapshot(patient, now);
      const info = insertPatient.run({
        name: patient.name,
        phone: patient.phone,
        birthDate: patient.birthDate || null,
        dum: pregnancySnapshot.dum,
        dpp: pregnancySnapshot.dpp,
        currentGestationalWeeks: pregnancySnapshot.currentGestationalWeeks,
        currentGestationalDays: pregnancySnapshot.currentGestationalDays,
        gestationalBaseDate: patient.dum ? null : now,
        physicianName: patient.physicianName,
        clinicUnit: patient.clinicUnit,
        pregnancyType: patient.pregnancyType || "singleton",
        highRisk: patient.highRisk ? 1 : 0,
        notes: patient.notes,
        status: patient.status,
        stage: patient.stage,
        createdByUserId: 1,
        createdAt: now,
        updatedAt: now
      });

      const patientId = Number(info.lastInsertRowid);

      createPatientExamSchedule(
        patientId,
        pregnancySnapshot.dum,
        examModelRows,
        patient.completedExamCodes,
        patient.scheduledExams || [],
        now
      );

      patient.sentMessages.forEach((message) => {
        const examModel = examModelByCode.get(message.examCode);
        const sentAt = message.sentDaysAgo ? addDays(now, -Number(message.sentDaysAgo)) : now;
        insertMessage.run(
          patientId,
          examModel?.id ?? null,
          message.content,
          message.deliveryStatus,
          sentAt,
          message.responseStatus,
          message.responseStatus === "respondida" ? "Paciente confirmou interesse." : null,
          message.responseStatus === "respondida" ? sentAt : null,
          1,
          sentAt,
          sentAt
        );
      });

      patient.movementHistory.forEach((movement) => {
        insertHistory.run(
          patientId,
          movement.fromStage,
          movement.toStage,
          movement.actionType,
          movement.description,
          JSON.stringify({ origem: "seed" }),
          1,
          now
        );
      });
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
