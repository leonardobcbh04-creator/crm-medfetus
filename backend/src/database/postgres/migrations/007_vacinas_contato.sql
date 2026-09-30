-- Marca "Contatada" da tela Vacinas (campanha dTpa): quem contatou a paciente e
-- quando. Uma linha por paciente; vale enquanto ela estiver na tela (quando sai
-- da tela — dTpa marcada, saiu da janela etc. — a marca e apagada).
CREATE TABLE IF NOT EXISTS vacinas_contato (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  contacted_at TEXT NOT NULL,
  contacted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
