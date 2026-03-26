import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabaseRuntime, getConfiguredDatabaseKind } from "../runtime.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.join(currentDirectory, "migrations");

async function ensureMigrationsTable(runtime) {
  await runtime.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listMigrationFiles() {
  const fileNames = await fs.readdir(migrationsDirectory);
  return fileNames.filter((fileName) => fileName.endsWith(".sql")).sort();
}

async function getAppliedVersions(runtime) {
  const result = await runtime.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => row.version));
}

export async function runPostgresMigrations() {
  const databaseKind = getConfiguredDatabaseKind();
  if (databaseKind !== "postgres") {
    throw new Error("Migracoes PostgreSQL so podem rodar quando DATABASE_URL apontar para postgres.");
  }

  const runtime = await getDatabaseRuntime();
  await ensureMigrationsTable(runtime);

  const [migrationFiles, appliedVersions] = await Promise.all([
    listMigrationFiles(),
    getAppliedVersions(runtime)
  ]);

  for (const fileName of migrationFiles) {
    if (appliedVersions.has(fileName)) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDirectory, fileName), "utf8");
    await runtime.transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [fileName]);
    });
  }

  return {
    ok: true,
    appliedCount: migrationFiles.filter((fileName) => !appliedVersions.has(fileName)).length
  };
}

runPostgresMigrations()
  .then((result) => {
    console.log(`Migracoes PostgreSQL concluidas. Aplicadas: ${result.appliedCount}.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Falha ao rodar migracoes PostgreSQL.");
    process.exit(1);
  });
