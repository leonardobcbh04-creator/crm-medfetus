-- Marca "Contatada" da aba "Gestantes (VSR)" da tela Vacinas. Separada da dTpa
-- (vacinas_contato) porque a mesma paciente pode estar nas duas listas. Uma
-- linha por paciente; apagada quando ela sai da lista.
CREATE TABLE IF NOT EXISTS vacinas_vsr_contato (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  contacted_at TEXT NOT NULL,
  contacted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
