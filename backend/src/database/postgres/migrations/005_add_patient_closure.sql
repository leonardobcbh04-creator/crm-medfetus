-- Adiciona campos para encerrar o acompanhamento de uma paciente (perda gestacional,
-- parto realizado, transferencia ou desistencia), permitindo excluir essas pacientes
-- das telas de contato ativo (kanban, central de contatos e lembretes automaticos)
-- sem perder o historico dela no sistema.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS closure_reason TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS closed_at TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS closed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
