CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'recepcao',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinic_units (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS physicians (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  clinic_unit_id INTEGER REFERENCES clinic_units(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
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
  gestational_base_is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
  gestational_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  gestational_base_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  gestational_base_conflict_note TEXT,
  physician_name TEXT,
  clinic_unit TEXT,
  pregnancy_type TEXT,
  high_risk BOOLEAN NOT NULL DEFAULT FALSE,
  shosp_patient_id TEXT,
  shosp_last_sync_at TEXT,
  imported_from_shosp BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'nao_sincronizado',
  sync_error TEXT,
  external_source TEXT,
  external_patient_id TEXT,
  external_updated_at TEXT,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ativa',
  stage TEXT NOT NULL DEFAULT 'contato_pendente',
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanban_columns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exames_modelo (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  start_week REAL NOT NULL,
  end_week REAL NOT NULL,
  target_week REAL NOT NULL,
  reminder_days_before_1 INTEGER NOT NULL DEFAULT 7,
  reminder_days_before_2 INTEGER NOT NULL DEFAULT 2,
  default_message TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  flow_type TEXT NOT NULL DEFAULT 'automatico',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS regras_inferencia_gestacional (
  id SERIAL PRIMARY KEY,
  exam_model_id INTEGER NOT NULL UNIQUE REFERENCES exames_modelo(id) ON DELETE CASCADE,
  typical_start_week REAL NOT NULL,
  typical_end_week REAL NOT NULL,
  reference_week REAL NOT NULL,
  uncertainty_margin_weeks REAL NOT NULL DEFAULT 1,
  allow_automatic_inference BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exames_paciente (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exam_model_id INTEGER NOT NULL REFERENCES exames_modelo(id) ON DELETE CASCADE,
  predicted_date TEXT NOT NULL,
  reminder_date_1 TEXT,
  reminder_date_2 TEXT,
  scheduled_date TEXT,
  scheduled_time TEXT,
  scheduling_notes TEXT,
  scheduled_by_user_id INTEGER REFERENCES users(id),
  last_contacted_at TEXT,
  reminder_snoozed_until TEXT,
  completed_date TEXT,
  completed_by_user_id INTEGER REFERENCES users(id),
  completed_outside_clinic BOOLEAN NOT NULL DEFAULT FALSE,
  shosp_exam_id TEXT,
  shosp_last_sync_at TEXT,
  imported_from_shosp BOOLEAN NOT NULL DEFAULT FALSE,
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
  UNIQUE (patient_id, exam_model_id)
);

CREATE TABLE IF NOT EXISTS mensagens (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exam_model_id INTEGER REFERENCES exames_modelo(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pendente',
  sent_at TEXT,
  response_status TEXT NOT NULL DEFAULT 'sem_resposta',
  response_text TEXT,
  response_at TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_templates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  language TEXT NOT NULL DEFAULT 'pt_BR',
  content TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_delivery_logs (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES mensagens(id) ON DELETE SET NULL,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
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
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS historico_de_movimentacoes (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata_json TEXT,
  created_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shosp_sync_state (
  sync_key TEXT PRIMARY KEY,
  last_cursor TEXT,
  last_success_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shosp_sync_logs (
  id SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS logs_de_sincronizacao (
  id SERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS mapeamento_de_tipos_de_exame_shosp (
  id SERIAL PRIMARY KEY,
  shosp_exam_code TEXT,
  shosp_exam_name TEXT NOT NULL,
  exam_model_id INTEGER NOT NULL REFERENCES exames_modelo(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configuracoes_de_integracao (
  id SERIAL PRIMARY KEY,
  integration_key TEXT NOT NULL UNIQUE,
  use_mock BOOLEAN NOT NULL DEFAULT TRUE,
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
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_patients_stage ON patients(stage);
CREATE INDEX IF NOT EXISTS idx_patients_shosp_patient_id ON patients(shosp_patient_id);
CREATE INDEX IF NOT EXISTS idx_exames_paciente_patient_id ON exames_paciente(patient_id);
CREATE INDEX IF NOT EXISTS idx_exames_paciente_exam_model_id ON exames_paciente(exam_model_id);
CREATE INDEX IF NOT EXISTS idx_mensagens_patient_id ON mensagens(patient_id);
CREATE INDEX IF NOT EXISTS idx_historico_patient_id ON historico_de_movimentacoes(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_patient_id ON audit_logs(patient_id);
