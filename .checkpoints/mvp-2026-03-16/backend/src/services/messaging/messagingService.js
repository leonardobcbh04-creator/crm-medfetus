import { db } from "../../db.js";
import { MESSAGING_CONFIG } from "../../config.js";
import { todayIso } from "../../utils/date.js";

function createDeliveryLog({
  messageId,
  patientId,
  templateId = null,
  provider = MESSAGING_CONFIG.provider,
  status = "pendente",
  externalMessageId = null,
  requestPayload = null,
  responsePayload = null,
  errorMessage = null,
  sentAt = null,
  deliveredAt = null,
  respondedAt = null
}) {
  const now = todayIso();

  db.prepare(`
    INSERT INTO message_delivery_logs (
      message_id,
      patient_id,
      template_id,
      provider,
      status,
      external_message_id,
      request_payload,
      response_payload,
      error_message,
      sent_at,
      delivered_at,
      responded_at,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId,
    patientId,
    templateId,
    provider,
    status,
    externalMessageId,
    requestPayload ? JSON.stringify(requestPayload) : null,
    responsePayload ? JSON.stringify(responsePayload) : null,
    errorMessage,
    sentAt,
    deliveredAt,
    respondedAt,
    now,
    now
  );
}

export function getMessagingRuntimeConfig() {
  return {
    ...MESSAGING_CONFIG,
    isExternalProviderConfigured: Boolean(
      MESSAGING_CONFIG.externalApiBaseUrl &&
      MESSAGING_CONFIG.externalApiToken &&
      MESSAGING_CONFIG.externalPhoneNumberId
    )
  };
}

export function listMessageTemplates() {
  return db.prepare(`
    SELECT
      id,
      code,
      name,
      channel,
      language,
      content,
      active,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM message_templates
    ORDER BY name COLLATE NOCASE
  `).all().map((template) => ({
    ...template,
    active: Boolean(template.active)
  }));
}

export function registerManualMessageDispatch({ patientId, messageId, templateCode = null, content }) {
  const template = templateCode
    ? db.prepare("SELECT id FROM message_templates WHERE code = ?").get(templateCode)
    : null;

  createDeliveryLog({
    patientId,
    messageId,
    templateId: template?.id ?? null,
    provider: "manual_stub",
    status: "enviada",
    requestPayload: {
      channel: MESSAGING_CONFIG.channel,
      providerMode: "manual_record",
      content
    },
    responsePayload: {
      accepted: true,
      dryRun: MESSAGING_CONFIG.dryRun
    },
    sentAt: todayIso()
  });
}

export function registerMessageStatusChange({ patientId, messageId, status, responseText = null }) {
  createDeliveryLog({
    patientId,
    messageId,
    provider: "manual_stub",
    status,
    responsePayload: responseText ? { responseText } : null,
    respondedAt: status === "respondida" ? todayIso() : null
  });
}
