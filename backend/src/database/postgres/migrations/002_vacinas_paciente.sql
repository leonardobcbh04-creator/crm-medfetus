-- Rastreamento de vacinas da gestante (gripe, dTpa, VSR), independente do
-- fluxo de exames obstetricos. Cada linha guarda o status de uma vacina
-- especifica para uma paciente especifica.
CREATE TABLE IF NOT EXISTS vacinas_paciente (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  vaccine_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  updated_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (patient_id, vaccine_code)
);

CREATE INDEX IF NOT EXISTS idx_vacinas_paciente_patient_id ON vacinas_paciente(patient_id);
