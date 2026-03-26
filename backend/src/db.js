import { DATABASE_KIND, KANBAN_STAGES } from "./config.js";
import { clinicUnits, examModels, messageTemplates, patients, physicians, users } from "./data/seedData.js";
import { getDatabaseRuntime, getSqliteFilePath } from "./database/runtime.js";
import { calculateExamScheduleDates, resolvePregnancySnapshot } from "./domain/obstetrics.js";
import { hashPassword, isPasswordHashed } from "./security/auth.js";
import { addDays, todayIso } from "./utils/date.js";
import { normalizeBrazilPhone } from "./utils/phone.js";

const sqliteGuard = new Proxy({}, {
  get() {
    throw new Error("Este fluxo ainda depende da camada legada de SQLite e ainda nao foi migrado para PostgreSQL.");
  }
});

const sqliteRuntime = DATABASE_KIND === "sqlite" ? await getDatabaseRuntime() : null;
export const db = DATABASE_KIND === "sqlite" ? sqliteRuntime.raw : sqliteGuard;
export const SQLITE_DB_FILE = DATABASE_KIND === "sqlite" ? getSqliteFilePath() : null;

export function initializeDatabase() {
  if (DATABASE_KIND !== "sqlite") {
    throw new Error("initializeDatabase legado ainda nao pode ser usado em PostgreSQL.");
  }

  db.exec("PRAGMA foreign_keys = ON");

  createTables();

  const counts = {
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    units: db.prepare("SELECT COUNT(*) AS count FROM clinic_units").get().count,
    physicians: db.prepare("SELECT COUNT(*) AS count FROM physicians").get().count,
    patients: db.prepare("SELECT COUNT(*) AS count FROM patients").get().count,
    examModels: db.prepare("SELECT COUNT(*) AS count FROM exames_modelo").get().count
  };

  // Seed inicial apenas para banco realmente vazio.
  // Isso evita que usuarios, unidades, medicos e demais configuracoes
  // operacionais do ambiente real sejam recriados em subidas normais.
  if (!counts.users && !counts.units && !counts.physicians && !counts.patients && !counts.examModels) {
    seedDatabase();
  } else {
    syncKanbanColumns();
    const kanbanColumnCount = db.prepare("SELECT COUNT(*) AS count FROM kanban_columns").get().count;
    if (!kanbanColumnCount) {
      seedKanbanColumns();
    }
  }

  const kanbanColumnCount = db.prepare("SELECT COUNT(*) AS count FROM kanban_columns").get().count;
  if (!kanbanColumnCount) {
    seedKanbanColumns();
  }

  syncExamCatalog();
  ensureExamInferenceRules();
  normalizeStoredPatientPhones();
  syncPendingAutomaticExamSchedules();
}

function createTables() {
  db.exec(`
    -- Usuarios do sistema.
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'recepcao',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      gestational_base_source TEXT NOT NULL DEFAULT 'idade_gestacional_informada',
      gestational_base_confidence TEXT NOT NULL DEFAULT 'alta',
      gestational_base_is_estimated INTEGER NOT NULL DEFAULT 0,
      gestational_review_required INTEGER NOT NULL DEFAULT 0,
      gestational_base_conflict INTEGER NOT NULL DEFAULT 0,
      gestational_base_conflict_note TEXT,
      physician_name TEXT,
      clinic_unit TEXT,
      pregnancy_type TEXT,
      high_risk INTEGER NOT NULL DEFAULT 0,
      shosp_patient_id TEXT,
      shosp_last_sync_at TEXT,
      imported_from_shosp INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'nao_sincronizado',
      sync_error TEXT,
      external_source TEXT,
      external_patient_id TEXT,
      external_updated_at TEXT,
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

    -- Regras para inferir idade gestacional a partir do ultimo exame valido.
    CREATE TABLE IF NOT EXISTS regras_inferencia_gestacional (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_model_id INTEGER NOT NULL UNIQUE,
      typical_start_week REAL NOT NULL,
      typical_end_week REAL NOT NULL,
      reference_week REAL NOT NULL,
      uncertainty_margin_weeks REAL NOT NULL DEFAULT 1,
      allow_automatic_inference INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (exam_model_id) REFERENCES exames_modelo(id) ON DELETE CASCADE
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
      completed_outside_clinic INTEGER NOT NULL DEFAULT 0,
      shosp_exam_id TEXT,
      shosp_last_sync_at TEXT,
      imported_from_shosp INTEGER NOT NULL DEFAULT 0,
      sync_status TEXT NOT NULL DEFAULT 'nao_sincronizado',
      sync_error TEXT,
      external_source TEXT,
      external_exam_request_id TEXT,
      external_attendance_id TEXT,
      external_exam_item_id TEXT,
      external_updated_at TEXT,
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

    -- Cursores incrementais para sincronizacao com o sistema mestre.
    CREATE TABLE IF NOT EXISTS shosp_sync_state (
      sync_key TEXT PRIMARY KEY,
      last_cursor TEXT,
      last_success_at TEXT,
      updated_at TEXT NOT NULL
    );

    -- Log resumido de cada execucao de sincronizacao com o Shosp.
    CREATE TABLE IF NOT EXISTS shosp_sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      records_received INTEGER NOT NULL DEFAULT 0,
      records_processed INTEGER NOT NULL DEFAULT 0,
      records_created INTEGER NOT NULL DEFAULT 0,
      records_updated INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Log consolidado e amigavel de sincronizacoes externas.
    CREATE TABLE IF NOT EXISTS logs_de_sincronizacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_key TEXT NOT NULL,
      scope TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      records_received INTEGER NOT NULL DEFAULT 0,
      records_processed INTEGER NOT NULL DEFAULT 0,
      records_created INTEGER NOT NULL DEFAULT 0,
      records_updated INTEGER NOT NULL DEFAULT 0,
      sync_error TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Mapeia codigos/tipos do Shosp com os exames padrao locais.
    CREATE TABLE IF NOT EXISTS mapeamento_de_tipos_de_exame_shosp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shosp_exam_code TEXT,
      shosp_exam_name TEXT NOT NULL,
      exam_model_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (exam_model_id) REFERENCES exames_modelo(id) ON DELETE CASCADE
    );

    -- Configuracao persistida para futuras integracoes externas.
    CREATE TABLE IF NOT EXISTS configuracoes_de_integracao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_key TEXT NOT NULL UNIQUE,
      use_mock INTEGER NOT NULL DEFAULT 1,
      api_base_url TEXT,
      api_token TEXT,
      api_key TEXT,
      username TEXT,
      password TEXT,
      company_id TEXT,
      last_patients_cursor TEXT,
      last_attendances_cursor TEXT,
      last_success_at TEXT,
      settings_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      patient_id INTEGER,
      description TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
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
  if (!patientColumns.has("shosp_patient_id")) {
    db.exec("ALTER TABLE patients ADD COLUMN shosp_patient_id TEXT");
  }
  if (!patientColumns.has("shosp_last_sync_at")) {
    db.exec("ALTER TABLE patients ADD COLUMN shosp_last_sync_at TEXT");
  }
  if (!patientColumns.has("imported_from_shosp")) {
    db.exec("ALTER TABLE patients ADD COLUMN imported_from_shosp INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientColumns.has("sync_status")) {
    db.exec("ALTER TABLE patients ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'nao_sincronizado'");
  }
  if (!patientColumns.has("sync_error")) {
    db.exec("ALTER TABLE patients ADD COLUMN sync_error TEXT");
  }
  if (!patientColumns.has("external_source")) {
    db.exec("ALTER TABLE patients ADD COLUMN external_source TEXT");
  }
  if (!patientColumns.has("external_patient_id")) {
    db.exec("ALTER TABLE patients ADD COLUMN external_patient_id TEXT");
  }
  if (!patientColumns.has("external_updated_at")) {
    db.exec("ALTER TABLE patients ADD COLUMN external_updated_at TEXT");
  }
  if (!patientColumns.has("gestational_base_source")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_base_source TEXT NOT NULL DEFAULT 'idade_gestacional_informada'");
  }
  if (!patientColumns.has("gestational_base_confidence")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_base_confidence TEXT NOT NULL DEFAULT 'alta'");
  }
  if (!patientColumns.has("gestational_base_is_estimated")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_base_is_estimated INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientColumns.has("gestational_review_required")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_review_required INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientColumns.has("gestational_base_conflict")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_base_conflict INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientColumns.has("gestational_base_conflict_note")) {
    db.exec("ALTER TABLE patients ADD COLUMN gestational_base_conflict_note TEXT");
  }

  db.prepare(`
    UPDATE patients
    SET
      gestational_base_source = 'idade_gestacional_informada',
      gestational_base_date = COALESCE(gestational_base_date, updated_at, created_at, @today),
      dum = NULL,
      updated_at = COALESCE(updated_at, @today)
    WHERE gestational_base_source = 'dum'
      AND current_gestational_weeks IS NOT NULL
  `).run({ today: todayIso() });

  db.prepare("UPDATE users SET role = 'recepcao' WHERE role = 'atendente'").run();
  const examModelColumns = new Set(db.prepare("PRAGMA table_info(exames_modelo)").all().map((column) => column.name));
  if (!examModelColumns.has("required")) {
    db.exec("ALTER TABLE exames_modelo ADD COLUMN required INTEGER NOT NULL DEFAULT 0");
  }
  if (!examModelColumns.has("flow_type")) {
    db.exec("ALTER TABLE exames_modelo ADD COLUMN flow_type TEXT NOT NULL DEFAULT 'automatico'");
  }
  const inferenceRuleColumns = new Set(
    db.prepare("PRAGMA table_info(regras_inferencia_gestacional)").all().map((column) => column.name)
  );
  if (inferenceRuleColumns.size) {
    if (!inferenceRuleColumns.has("uncertainty_margin_weeks")) {
      db.exec("ALTER TABLE regras_inferencia_gestacional ADD COLUMN uncertainty_margin_weeks REAL NOT NULL DEFAULT 1");
    }
    if (!inferenceRuleColumns.has("allow_automatic_inference")) {
      db.exec("ALTER TABLE regras_inferencia_gestacional ADD COLUMN allow_automatic_inference INTEGER NOT NULL DEFAULT 1");
    }
    if (!inferenceRuleColumns.has("active")) {
      db.exec("ALTER TABLE regras_inferencia_gestacional ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    }
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
  if (!patientExamColumns.has("completed_outside_clinic")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN completed_outside_clinic INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientExamColumns.has("shosp_exam_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN shosp_exam_id TEXT");
  }
  if (!patientExamColumns.has("shosp_last_sync_at")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN shosp_last_sync_at TEXT");
  }
  if (!patientExamColumns.has("imported_from_shosp")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN imported_from_shosp INTEGER NOT NULL DEFAULT 0");
  }
  if (!patientExamColumns.has("sync_status")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'nao_sincronizado'");
  }
  if (!patientExamColumns.has("sync_error")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN sync_error TEXT");
  }
  if (!patientExamColumns.has("external_source")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN external_source TEXT");
  }
  if (!patientExamColumns.has("external_exam_request_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN external_exam_request_id TEXT");
  }
  if (!patientExamColumns.has("external_attendance_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN external_attendance_id TEXT");
  }
  if (!patientExamColumns.has("external_exam_item_id")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN external_exam_item_id TEXT");
  }
  if (!patientExamColumns.has("external_updated_at")) {
    db.exec("ALTER TABLE exames_paciente ADD COLUMN external_updated_at TEXT");
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_shosp_external_id
    ON patients (external_source, external_patient_id)
    WHERE external_patient_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_shosp_patient_id
    ON patients (shosp_patient_id)
    WHERE shosp_patient_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_shosp_external_item_id
    ON exames_paciente (external_source, external_exam_item_id)
    WHERE external_exam_item_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_exams_shosp_exam_id
    ON exames_paciente (shosp_exam_id)
    WHERE shosp_exam_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_logs_de_sincronizacao_integration_key
    ON logs_de_sincronizacao (integration_key, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id, expires_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_patient
    ON audit_logs (patient_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_patients_stage_status
    ON patients (stage, status);

    CREATE INDEX IF NOT EXISTS idx_exames_paciente_patient_status
    ON exames_paciente (patient_id, status);

    CREATE INDEX IF NOT EXISTS idx_exames_paciente_predicted_status
    ON exames_paciente (predicted_date, status);

    CREATE INDEX IF NOT EXISTS idx_mensagens_patient_created
    ON mensagens (patient_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_movimentacoes_patient_created
    ON historico_de_movimentacoes (patient_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mapeamento_shosp_exam_code
    ON mapeamento_de_tipos_de_exame_shosp (shosp_exam_code)
    WHERE shosp_exam_code IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracoes_de_integracao_key
    ON configuracoes_de_integracao (integration_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_regras_inferencia_exam_model
    ON regras_inferencia_gestacional (exam_model_id);
  `);

  // Default row for persisted Shosp integration settings.
  const now = todayIso();
  db.prepare(`
    INSERT INTO configuracoes_de_integracao (
      integration_key,
      use_mock,
      api_base_url,
      api_token,
      api_key,
      username,
      password,
      company_id,
      settings_json,
      created_at,
      updated_at
    )
    VALUES (@integrationKey, @useMock, @apiBaseUrl, @apiToken, @apiKey, @username, @password, @companyId, @settingsJson, @createdAt, @updatedAt)
    ON CONFLICT(integration_key) DO NOTHING
  `).run({
    integrationKey: "shosp",
    useMock: 1,
    apiBaseUrl: null,
    apiToken: null,
    apiKey: null,
    username: null,
    password: null,
    companyId: null,
    settingsJson: JSON.stringify({}),
    createdAt: now,
    updatedAt: now
  });
}

export function resetDatabase() {
  if (DATABASE_KIND !== "sqlite") {
    throw new Error("resetDatabase legado nao esta disponivel em PostgreSQL.");
  }

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS shosp_sync_logs;
    DROP TABLE IF EXISTS shosp_sync_state;
    DROP TABLE IF EXISTS logs_de_sincronizacao;
    DROP TABLE IF EXISTS audit_logs;
    DROP TABLE IF EXISTS user_sessions;
    DROP TABLE IF EXISTS mapeamento_de_tipos_de_exame_shosp;
    DROP TABLE IF EXISTS configuracoes_de_integracao;
    DROP TABLE IF EXISTS historico_de_movimentacoes;
    DROP TABLE IF EXISTS message_delivery_logs;
    DROP TABLE IF EXISTS message_templates;
    DROP TABLE IF EXISTS mensagens;
    DROP TABLE IF EXISTS exames_paciente;
    DROP TABLE IF EXISTS regras_inferencia_gestacional;
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
  ensureExamInferenceRules();
}

export function clearAllPatientData() {
  const countsBefore = {
    patients: Number(db.prepare("SELECT COUNT(*) AS count FROM patients").get().count),
    exams: Number(db.prepare("SELECT COUNT(*) AS count FROM exames_paciente").get().count),
    messages: Number(db.prepare("SELECT COUNT(*) AS count FROM mensagens").get().count),
    movements: Number(db.prepare("SELECT COUNT(*) AS count FROM historico_de_movimentacoes").get().count),
    auditLogs: Number(
      db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE patient_id IS NOT NULL").get().count
    )
  };

  db.exec("BEGIN");

  try {
    db.prepare("DELETE FROM audit_logs WHERE patient_id IS NOT NULL").run();
    db.prepare("DELETE FROM patients").run();
    db.prepare(`
      DELETE FROM sqlite_sequence
      WHERE name IN ('patients', 'exames_paciente', 'mensagens', 'historico_de_movimentacoes', 'message_delivery_logs', 'audit_logs')
    `).run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return countsBefore;
}

function buildDefaultInferenceRule(examModel) {
  const canInferAutomatically = examModel.flowType !== "avulso";

  return {
    examModelId: examModel.id,
    typicalStartWeek: Number(examModel.startWeek),
    typicalEndWeek: Number(examModel.endWeek),
    referenceWeek: Number(examModel.targetWeek),
    uncertaintyMarginWeeks: canInferAutomatically ? 1 : 2,
    allowAutomaticInference: canInferAutomatically ? 1 : 0,
    active: canInferAutomatically ? 1 : 0
  };
}

function syncExamCatalog() {
  const now = todayIso();
  const existingExamModels = new Map(
    db.prepare("SELECT id, code FROM exames_modelo").all().map((row) => [row.code, row])
  );
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
  const updateExamModel = db.prepare(`
    UPDATE exames_modelo
    SET
      name = @name,
      start_week = @startWeek,
      end_week = @endWeek,
      target_week = @targetWeek,
      reminder_days_before_1 = @reminderDaysBefore1,
      reminder_days_before_2 = @reminderDaysBefore2,
      required = @required,
      flow_type = @flowType,
      active = @active,
      sort_order = @sortOrder,
      updated_at = @updatedAt
    WHERE code = @code
  `);

  examModels.forEach((examModel) => {
    const basePayload = {
      ...examModel,
      required: examModel.required ? 1 : 0,
      active: examModel.active ? 1 : 0
    };

    if (existingExamModels.has(examModel.code)) {
      // Preserva a ultima mensagem configurada pelo administrador.
      // Atualizacoes do sistema nao devem sobrescrever default_message.
      const { defaultMessage, ...updatablePayload } = basePayload;
      updateExamModel.run({
        ...updatablePayload,
        updatedAt: now
      });
      return;
    }

    insertExamModel.run({
      ...basePayload,
      createdAt: now,
      updatedAt: now
    });
  });
}

function ensureExamInferenceRules() {
  const examModelRows = db.prepare(`
    SELECT
      id,
      start_week AS startWeek,
      end_week AS endWeek,
      target_week AS targetWeek,
      flow_type AS flowType
    FROM exames_modelo
  `).all();

  if (!examModelRows.length) {
    return;
  }

  const existingRuleExamIds = new Set(
    db.prepare("SELECT exam_model_id AS examModelId FROM regras_inferencia_gestacional").all().map((row) => row.examModelId)
  );
  const now = todayIso();
  const updateRule = db.prepare(`
    UPDATE regras_inferencia_gestacional
    SET
      typical_start_week = @typicalStartWeek,
      typical_end_week = @typicalEndWeek,
      reference_week = @referenceWeek,
      uncertainty_margin_weeks = @uncertaintyMarginWeeks,
      allow_automatic_inference = @allowAutomaticInference,
      active = @active,
      updated_at = @updatedAt
    WHERE exam_model_id = @examModelId
  `);
  const insertRule = db.prepare(`
    INSERT INTO regras_inferencia_gestacional (
      exam_model_id,
      typical_start_week,
      typical_end_week,
      reference_week,
      uncertainty_margin_weeks,
      allow_automatic_inference,
      active,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  examModelRows.forEach((examModel) => {
    const rule = buildDefaultInferenceRule(examModel);
    if (existingRuleExamIds.has(examModel.id)) {
      updateRule.run({
        ...rule,
        updatedAt: now
      });
      return;
    }

    insertRule.run(
      rule.examModelId,
      rule.typicalStartWeek,
      rule.typicalEndWeek,
      rule.referenceWeek,
      rule.uncertaintyMarginWeeks,
      rule.allowAutomaticInference,
      rule.active,
      now,
      now
    );
  });
}

function syncPendingAutomaticExamSchedules() {
  const now = todayIso();
  const examModelRows = db.prepare(`
    SELECT
      id,
      code,
      target_week AS targetWeek,
      reminder_days_before_1 AS reminderDaysBefore1,
      reminder_days_before_2 AS reminderDaysBefore2,
      flow_type AS flowType
    FROM exames_modelo
    WHERE active = 1
    ORDER BY sort_order, id
  `).all();

  const patientsWithBase = db.prepare(`
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
  `).all();

  const existingExamsStatement = db.prepare(`
    SELECT
      ep.id,
      ep.exam_model_id AS examModelId,
      ep.status,
      ep.scheduled_date AS scheduledDate,
      ep.completed_date AS completedDate
    FROM exames_paciente ep
    WHERE ep.patient_id = ?
  `);
  const insertExam = db.prepare(`
    INSERT INTO exames_paciente (
      patient_id,
      exam_model_id,
      predicted_date,
      reminder_date_1,
      reminder_date_2,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?)
  `);
  const updatePendingExam = db.prepare(`
    UPDATE exames_paciente
    SET
      predicted_date = ?,
      reminder_date_1 = ?,
      reminder_date_2 = ?,
      updated_at = ?
    WHERE id = ?
  `);
  const deletePendingExam = db.prepare("DELETE FROM exames_paciente WHERE id = ?");

  patientsWithBase.forEach((patient) => {
    const snapshot = resolvePregnancySnapshot(patient, now);
    if (!snapshot.dum) {
      return;
    }

    const existingExams = new Map(existingExamsStatement.all(patient.id).map((row) => [row.examModelId, row]));

    examModelRows.forEach((examModel) => {
      const existingExam = existingExams.get(examModel.id);

      if (examModel.flowType !== "automatico") {
        if (existingExam && existingExam.status === "pendente" && !existingExam.scheduledDate && !existingExam.completedDate) {
          deletePendingExam.run(existingExam.id);
        }
        return;
      }

      const schedule = calculateExamScheduleDates({
        dum: snapshot.dum,
        targetWeek: examModel.targetWeek,
        reminderDaysBefore1: examModel.reminderDaysBefore1,
        reminderDaysBefore2: examModel.reminderDaysBefore2
      });

      if (existingExam) {
        if (existingExam.status === "pendente" && !existingExam.scheduledDate && !existingExam.completedDate) {
          updatePendingExam.run(
            schedule.predictedDate,
            schedule.reminderDate1,
            schedule.reminderDate2,
            now,
            existingExam.id
          );
        }
        return;
      }

      insertExam.run(
        patient.id,
        examModel.id,
        schedule.predictedDate,
        schedule.reminderDate1,
        schedule.reminderDate2,
        now,
        now
      );
    });
  });
}

function normalizeStoredPatientPhones() {
  const patientRows = db.prepare(`
    SELECT id, phone
    FROM patients
    WHERE phone IS NOT NULL AND TRIM(phone) <> ''
  `).all();

  const updatePhone = db.prepare(`
    UPDATE patients
    SET phone = ?, updated_at = ?
    WHERE id = ?
  `);

  const now = todayIso();

  patientRows.forEach((patient) => {
    const normalizedPhone = normalizeBrazilPhone(patient.phone);
    if (normalizedPhone && normalizedPhone !== patient.phone) {
      updatePhone.run(normalizedPhone, now, patient.id);
    }
  });
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

  // Dados abaixo servem apenas como base inicial de um banco vazio.
  // Depois do primeiro uso, usuarios, unidades e medicos passam a ser
  // dados operacionais e nao devem voltar ao padrao sem reset explicito.

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

  const insertShospExamMapping = db.prepare(`
    INSERT INTO mapeamento_de_tipos_de_exame_shosp (
      shosp_exam_code,
      shosp_exam_name,
      exam_model_id,
      active,
      notes,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `);

  db.exec("BEGIN");

  try {
    seedKanbanColumns();

    users.forEach((user) => {
      insertUser.run({
        ...user,
        password: isPasswordHashed(user.password) ? user.password : hashPassword(user.password),
        role: user.role === "atendente" ? "recepcao" : user.role,
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

    examModelRows.forEach((row) => {
      insertShospExamMapping.run(
        row.code,
        examModels.find((item) => item.code === row.code)?.name || row.code,
        row.id,
        "Mapeamento inicial criado automaticamente a partir do protocolo local.",
        now,
        now
      );
    });

    patients.forEach((patient) => {
      const pregnancySnapshot = resolvePregnancySnapshot(patient, now);
      const info = insertPatient.run({
        name: patient.name,
        phone: patient.phone,
        birthDate: patient.birthDate || null,
        dum: null,
        dpp: pregnancySnapshot.dpp,
        currentGestationalWeeks: pregnancySnapshot.currentGestationalWeeks,
        currentGestationalDays: pregnancySnapshot.currentGestationalDays,
        gestationalBaseDate: patient.gestationalBaseDate || now,
        gestationalBaseSource: pregnancySnapshot.gestationalBaseSource,
        gestationalBaseConfidence: pregnancySnapshot.gestationalBaseConfidence,
        gestationalBaseIsEstimated: pregnancySnapshot.gestationalBaseIsEstimated ? 1 : 0,
        gestationalReviewRequired: pregnancySnapshot.gestationalBaseRequiresManualReview ? 1 : 0,
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
