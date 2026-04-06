import { getDatabaseRuntime } from "../../database/runtime.js";
import { MESSAGING_CONFIG } from "../../config.js";
import {
  getMessageTemplateByCode,
  insertMessageDeliveryLog,
  listMessageTemplateRows
} from "../../database/repositories/coreRepository.js";
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
  return insertMessageDeliveryLog({
    messageId,
    patientId,
    templateId,
    provider,
    status,
    externalMessageId,
    requestPayload: requestPayload ? JSON.stringify(requestPayload) : null,
    responsePayload: responsePayload ? JSON.stringify(responsePayload) : null,
    errorMessage,
    sentAt,
    deliveredAt,
    respondedAt,
    createdAt: now,
    updatedAt: now
  });
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
  return listMessageTemplateRows().then((rows) => rows.map((template) => ({
    ...template,
    active: Boolean(template.active)
  })));
}

export async function registerManualMessageDispatch({ patientId, messageId, templateCode = null, content }) {
  const template = templateCode ? await getMessageTemplateByCode(templateCode) : null;

  await createDeliveryLog({
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

export async function registerMessageStatusChange({ patientId, messageId, status, responseText = null }) {
  await createDeliveryLog({
    patientId,
    messageId,
    provider: "manual_stub",
    status,
    responsePayload: responseText ? { responseText } : null,
    respondedAt: status === "respondida" ? todayIso() : null
  });
}
