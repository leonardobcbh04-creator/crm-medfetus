UPDATE exames_modelo
SET reminder_days_before_1 = 10,
    updated_at = CURRENT_TIMESTAMP
WHERE flow_type = 'automatico'
  AND reminder_days_before_1 = 7;
