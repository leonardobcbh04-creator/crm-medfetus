import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDirectory, "..");
const testDatabasePath = path.join(backendRoot, "data", "test.sqlite");

try {
  if (fs.existsSync(testDatabasePath)) {
    fs.unlinkSync(testDatabasePath);
  }
} catch (error) {
  console.warn(`Nao foi possivel limpar o banco de testes anterior: ${error.message}`);
}

const result = spawnSync(process.execPath, ["--test", "--test-isolation=none"], {
  cwd: backendRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: testDatabasePath
  }
});

process.exit(result.status ?? 1);
