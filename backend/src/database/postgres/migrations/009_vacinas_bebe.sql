-- Avisos de vacina do bebe (calendario SBIm 2026/2027, ate 2 anos, sem as vacinas
-- da maternidade). A data de nascimento e estimada pela DPP da mae. Cada linha e
-- uma dose numa idade; "availability" diz se a MedFetus aplica (chamar para
-- agendar) ou se a mae deve procurar o posto de saude. A clinica edita essa lista
-- pela tela Vacinas > Bebes (somente administrador).
CREATE TABLE IF NOT EXISTS vacinas_bebe_catalogo (
  id SERIAL PRIMARY KEY,
  age_months INTEGER NOT NULL,
  vaccine_name TEXT NOT NULL,
  dose_label TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'clinica',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  UNIQUE (age_months, vaccine_name, dose_label)
);

-- Marca "Contatada" por mae + idade do bebe (cada idade e um aviso separado).
CREATE TABLE IF NOT EXISTS vacinas_bebe_contato (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  age_months INTEGER NOT NULL,
  contacted_at TEXT NOT NULL,
  contacted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (patient_id, age_months)
);

INSERT INTO vacinas_bebe_catalogo (age_months, vaccine_name, dose_label, availability, sort_order) VALUES
  (1,  'Hepatite B', '2ª dose', 'posto', 1),
  (2,  'Hexavalente (difteria, tétano, coqueluche, Hib, pólio e hepatite B)', '1ª dose', 'clinica', 1),
  (2,  'Pneumocócica 20-valente', '1ª dose', 'clinica', 2),
  (2,  'Rotavírus pentavalente', '1ª dose', 'clinica', 3),
  (3,  'Meningocócica ACWY', '1ª dose', 'clinica', 1),
  (3,  'Meningocócica B', '1ª dose', 'clinica', 2),
  (4,  'Hexavalente ou pentavalente acelular', '2ª dose', 'clinica', 1),
  (4,  'Pneumocócica 20-valente', '2ª dose', 'clinica', 2),
  (4,  'Rotavírus pentavalente', '2ª dose', 'clinica', 3),
  (5,  'Meningocócica ACWY', '2ª dose', 'clinica', 1),
  (5,  'Meningocócica B', '2ª dose', 'clinica', 2),
  (6,  'Hexavalente (difteria, tétano, coqueluche, Hib, pólio e hepatite B)', '3ª dose', 'clinica', 1),
  (6,  'Pneumocócica 20-valente', '3ª dose', 'clinica', 2),
  (6,  'Rotavírus pentavalente', '3ª dose', 'clinica', 3),
  (6,  'Gripe (influenza tetravalente)', '1ª dose', 'clinica', 4),
  (6,  'Covid-19', 'Início do esquema', 'posto', 5),
  (7,  'Gripe (influenza tetravalente)', '2ª dose', 'clinica', 1),
  (9,  'Febre amarela', '1ª dose', 'clinica', 1),
  (12, 'Pneumocócica 20-valente', 'Reforço', 'clinica', 1),
  (12, 'Meningocócica ACWY', 'Reforço', 'clinica', 2),
  (12, 'Meningocócica B', 'Reforço', 'clinica', 3),
  (12, 'Tríplice viral (sarampo, caxumba e rubéola)', '1ª dose', 'clinica', 4),
  (12, 'Hepatite A infantil', '1ª dose', 'clinica', 5),
  (15, 'Pentavalente acelular (difteria, tétano, coqueluche, Hib e pólio)', 'Reforço', 'clinica', 1),
  (15, 'Tríplice viral (sarampo, caxumba e rubéola)', '2ª dose', 'clinica', 2),
  (15, 'Varicela (catapora)', '1ª dose', 'posto', 3),
  (18, 'Hepatite A infantil', '2ª dose', 'clinica', 1)
ON CONFLICT (age_months, vaccine_name, dose_label) DO NOTHING;
