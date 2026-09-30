-- Origem do agendamento de um exame. 'importacao_agenda' marca os agendamentos
-- criados pela importacao da agenda futura da recepcao: ao reenviar a agenda, so
-- esses sao substituidos (agendamentos feitos manualmente ou vindos do Shosp ficam
-- intactos). NULL = agendamento manual/outra origem.
ALTER TABLE exames_paciente ADD COLUMN IF NOT EXISTS scheduling_source TEXT;
