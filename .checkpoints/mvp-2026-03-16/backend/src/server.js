import cors from "cors";
import express from "express";
import { PORT } from "./config.js";
import { initializeDatabase } from "./db.js";
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

initializeDatabase();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/catalogs", catalogRoutes);
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/kanban", kanbanRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/exam-configs", requireAdmin, examRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/reminders", reminderRoutes);

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
