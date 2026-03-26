import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function createSqliteRuntime(dbFile) {
  const dataDirectory = path.dirname(dbFile);
  fs.mkdirSync(dataDirectory, { recursive: true });

  const raw = new DatabaseSync(dbFile);
  raw.exec("PRAGMA busy_timeout = 5000");

  return {
    kind: "sqlite",
    file: dbFile,
    raw,
    async ping() {
      raw.prepare("SELECT 1 AS ok").get();
      return { ok: true };
    },
    async close() {
      raw.close();
    }
  };
}
