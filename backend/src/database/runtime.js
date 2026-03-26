import { DATABASE_KIND, DATABASE_URL, DB_FILE } from "../config.js";
import { createPostgresRuntime } from "./postgres/postgresRuntime.js";
import { createSqliteRuntime } from "./sqlite/sqliteRuntime.js";

let runtimePromise = null;

export function getConfiguredDatabaseKind() {
  return DATABASE_KIND;
}

export function isPostgresConfigured() {
  return DATABASE_KIND === "postgres";
}

export function getSqliteFilePath() {
  return DB_FILE;
}

export async function getDatabaseRuntime() {
  if (!runtimePromise) {
    runtimePromise = DATABASE_KIND === "postgres"
      ? createPostgresRuntime(DATABASE_URL)
      : Promise.resolve(createSqliteRuntime(DB_FILE));
  }

  return runtimePromise;
}

export async function closeDatabaseRuntime() {
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise;
  await runtime.close();
  runtimePromise = null;
}
