import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORT = 4000;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DB_FILE = path.resolve(currentDirectory, "..", "data", "clinic.sqlite");
export const MESSAGING_CONFIG = {
  provider: "manual_stub",
  channel: "whatsapp",
  externalApiBaseUrl: process.env.WHATSAPP_API_BASE_URL || "",
  externalApiToken: process.env.WHATSAPP_API_TOKEN || "",
  externalPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  templatesEnabled: true,
  dryRun: true
};

export const KANBAN_STAGES = [
  {
    id: "contato_pendente",
    title: "Contato pendente",
    description: "Pacientes que ainda precisam de contato da recepcao"
  },
  {
    id: "mensagem_enviada",
    title: "Mensagem enviada",
    description: "Pacientes que ja receberam mensagem e aguardam retorno"
  },
  {
    id: "follow_up",
    title: "Follow up",
    description: "Mensagens sem resposta ha mais de 2 dias para nova tentativa"
  },
  {
    id: "agendada",
    title: "Agendada",
    description: "Pacientes com exame marcado e data ja definida"
  }
];
