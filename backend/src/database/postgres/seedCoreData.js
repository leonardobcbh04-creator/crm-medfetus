import { getConfiguredDatabaseKind, getDatabaseRuntime } from "../runtime.js";
import { clinicUnits, examModels, messageTemplates, physicians, users } from "../../data/seedData.js";
import { hashPassword } from "../../security/auth.js";
import { todayIso } from "../../utils/date.js";
import { KANBAN_STAGES } from "../../config.js";

function buildDefaultInferenceRule(examModelId, examModel) {
  const canInferAutomatically = examModel.flowType !== "avulso";

  return {
    examModelId,
    typicalStartWeek: Number(examModel.startWeek),
    typicalEndWeek: Number(examModel.endWeek),
    referenceWeek: Number(examModel.targetWeek),
    uncertaintyMarginWeeks: canInferAutomatically ? 1 : 2,
    allowAutomaticInference: canInferAutomatically,
    active: canInferAutomatically
  };
}

async function alignSequence(client, tableName) {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence($1, 'id'),
      GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 1), 1),
      TRUE
    )
  `, [tableName]);
}

export async function seedPostgresCoreData() {
  if (getConfiguredDatabaseKind() !== "postgres") {
    throw new Error("O seed PostgreSQL so pode rodar quando DATABASE_URL apontar para postgres.");
  }

  const runtime = await getDatabaseRuntime();
  const now = todayIso();

  await runtime.transaction(async (client) => {
    for (const user of users) {
      await client.query(`
        INSERT INTO users (
          id,
          name,
          email,
          password,
          role,
          active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (email) DO NOTHING
      `, [
        user.id,
        user.name,
        user.email,
        hashPassword(user.password),
        user.role,
        Boolean(user.active),
        now,
        now
      ]);
    }

    for (const unit of clinicUnits) {
      await client.query(`
        INSERT INTO clinic_units (
          id,
          name,
          active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) DO NOTHING
      `, [
        unit.id,
        unit.name,
        Boolean(unit.active),
        now,
        now
      ]);
    }

    await alignSequence(client, "users");
    await alignSequence(client, "clinic_units");

    for (const physician of physicians) {
      await client.query(`
        INSERT INTO physicians (
          id,
          name,
          clinic_unit_id,
          active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (name) DO NOTHING
      `, [
        physician.id,
        physician.name,
        physician.clinicUnitId || null,
        Boolean(physician.active),
        now,
        now
      ]);
    }

    await alignSequence(client, "physicians");

    for (const [index, stage] of KANBAN_STAGES.entries()) {
      await client.query(`
        INSERT INTO kanban_columns (
          id,
          title,
          description,
          sort_order,
          is_system,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `, [
        stage.id,
        stage.title,
        stage.description,
        index + 1,
        true,
        now,
        now
      ]);
    }

    for (const examModel of examModels) {
      await client.query(`
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
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (code) DO NOTHING
      `, [
        examModel.code,
        examModel.name,
        Number(examModel.startWeek),
        Number(examModel.endWeek),
        Number(examModel.targetWeek),
        Number(examModel.reminderDaysBefore1),
        Number(examModel.reminderDaysBefore2),
        examModel.defaultMessage,
        Boolean(examModel.required),
        examModel.flowType,
        Boolean(examModel.active),
        Number(examModel.sortOrder),
        now,
        now
      ]);
    }

    for (const template of messageTemplates) {
      await client.query(`
        INSERT INTO message_templates (
          code,
          name,
          channel,
          language,
          content,
          active,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (code) DO NOTHING
      `, [
        template.code,
        template.name,
        template.channel,
        template.language,
        template.content,
        Boolean(template.active),
        now,
        now
      ]);
    }

    const examRows = await client.query(`
      SELECT id, code
      FROM exames_modelo
    `);
    const examIdByCode = new Map(examRows.rows.map((row) => [row.code, Number(row.id)]));

    for (const examModel of examModels) {
      const examModelId = examIdByCode.get(examModel.code);
      if (!examModelId) {
        continue;
      }

      const rule = buildDefaultInferenceRule(examModelId, examModel);
      await client.query(`
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (exam_model_id) DO NOTHING
      `, [
        rule.examModelId,
        rule.typicalStartWeek,
        rule.typicalEndWeek,
        rule.referenceWeek,
        rule.uncertaintyMarginWeeks,
        rule.allowAutomaticInference,
        rule.active,
        now,
        now
      ]);
    }
  });

  return {
    ok: true,
    users: users.length,
    clinicUnits: clinicUnits.length,
    physicians: physicians.length,
    examModels: examModels.length,
    messageTemplates: messageTemplates.length
  };
}

seedPostgresCoreData()
  .then((result) => {
    console.log(
      `Seed PostgreSQL concluido. Usuarios: ${result.users}, unidades: ${result.clinicUnits}, medicos: ${result.physicians}, exames: ${result.examModels}.`
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Falha ao rodar seed PostgreSQL.");
    process.exit(1);
  });
