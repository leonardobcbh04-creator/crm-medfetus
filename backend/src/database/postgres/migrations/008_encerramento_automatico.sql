-- Encerramento automatico do acompanhamento quando a DPP + 14 dias ja passou
-- (considera-se que o parto aconteceu). closure_is_automatic marca que foi o
-- sistema que encerrou (e nao a equipe). auto_close_disabled impede que o sistema
-- encerre de novo uma paciente que a equipe reabriu manualmente.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS closure_is_automatic BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS auto_close_disabled BOOLEAN NOT NULL DEFAULT FALSE;
