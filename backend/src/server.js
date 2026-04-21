import express from "express";
import { CORS_ALLOWED_ORIGINS, PORT, RUN_BACKGROUND_WORKERS_IN_API, SHOSP_ENABLED } from "./config.js";
import { getDatabaseRuntime } from "./database/runtime.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { adminRoutes } from "./routes/adminRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { catalogRoutes } from "./routes/catalogRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { examRoutes } from "./routes/examRoutes.js";
import { kanbanRoutes } from "./routes/kanbanRoutes.js";
import { messageRoutes } from "./routes/messageRoutes.js";
import { patientRoutes } from "./routes/patientRoutes.js";
import { reportRoutes } from "./routes/reportRoutes.js";
import { reminderRoutes } from "./routes/reminderRoutes.js";
import { shospRoutes } from "./routes/shospRoutes.js";
import { startLogRetentionWorker, stopLogRetentionWorker } from "./services/logRetentionService.js";
import { startShospSyncWorker, stopShospSyncWorker } from "./services/shospIntegration/shospSyncWorker.js";

await getDatabaseRuntime();

const app = express();

const allowedOrigins = [
  "https://crm-medfetus-frontend.onrender.com",
  "http://localhost:5173",
  "http://localhost:3000",
  ...CORS_ALLOWED_ORIGINS
].filter((origin, index, list) => Boolean(origin) && list.indexOf(origin) === index);

const allowedOriginSet = new Set(allowedOrigins);
const allowedMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const allowedHeaders = "Content-Type, Authorization";

app.use((request, response, next) => {
  const origin = request.headers.origin;

  if (origin && allowedOriginSet.has(origin)) {
    response.header("Access-Control-Allow-Origin", origin);
    response.header("Vary", "Origin");
    response.header("Access-Control-Allow-Methods", allowedMethods);
    response.header("Access-Control-Allow-Headers", allowedHeaders);
  } else if (origin) {
    console.warn(`[cors] Origin bloqueada: ${origin}`);
  }

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/catalogs", requireAuth, catalogRoutes);
app.use("/api/admin", requireAuth, requireAdmin, adminRoutes);
if (SHOSP_ENABLED) {
  app.use("/api/admin/integrations/shosp", requireAuth, requireAdmin, shospRoutes);
}
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/kanban", requireAuth, kanbanRoutes);
app.use("/api/patients", requireAuth, patientRoutes);
app.use("/api/reports", requireAuth, reportRoutes);
app.use("/api/exam-configs", requireAuth, examRoutes);
app.use("/api/messages", requireAuth, messageRoutes);
app.use("/api/reminders", requireAuth, reminderRoutes);

if (RUN_BACKGROUND_WORKERS_IN_API && SHOSP_ENABLED) {
  startShospSyncWorker();
}

if (RUN_BACKGROUND_WORKERS_IN_API) {
  startLogRetentionWorker();
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

function shutdown() {
  if (RUN_BACKGROUND_WORKERS_IN_API && SHOSP_ENABLED) {
    stopShospSyncWorker();
  }
  if (RUN_BACKGROUND_WORKERS_IN_API) {
    stopLogRetentionWorker();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
