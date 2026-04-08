import { getDatabaseRuntime } from "../database/runtime.js";

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length <= 4) {
    return digits;
  }

  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function sanitizeDetails(details) {
  if (!details || typeof details !== "object") {
    return details ?? null;
  }

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key.toLowerCase().includes("phone") || key.toLowerCase().includes("telefone")) {
        return [key, maskPhone(value)];
      }

      return [key, value];
    })
  );
}

export async function recordAuditEvent({
  actorUserId = null,
  actionType,
  entityType,
  entityId = null,
  patientId = null,
  description,
  details = null
}) {
  const createdAt = new Date().toISOString();
  const detailsJson = details ? JSON.stringify(sanitizeDetails(details)) : null;

  try {
    const runtime = await getDatabaseRuntime();
    await runtime.query(`
      INSERT INTO audit_logs (
        actor_user_id,
        action_type,
        entity_type,
        entity_id,
        patient_id,
        description,
        details_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      actorUserId,
      actionType,
      entityType,
      entityId,
      patientId,
      description,
      detailsJson,
      createdAt
    ]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Falha ao registrar auditoria.");
  }
}
