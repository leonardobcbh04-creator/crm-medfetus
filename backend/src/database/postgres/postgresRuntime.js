function buildSslConfig(connectionString) {
  const enabled = ["1", "true", "yes", "on"].includes(String(process.env.DATABASE_SSL_ENABLED || "").toLowerCase());
  const normalizedConnectionString = String(connectionString || "").toLowerCase();
  const urlRequiresSsl =
    normalizedConnectionString.includes("sslmode=require") ||
    normalizedConnectionString.includes("ssl=true");

  if (!enabled && !urlRequiresSsl) {
    return false;
  }

  if (!enabled) {
    return { rejectUnauthorized: false };
  }

  const rejectUnauthorized = !["0", "false", "no", "off"].includes(
    String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase()
  );

  return { rejectUnauthorized };
}

export async function createPostgresRuntime(connectionString) {
  const { Pool } = await import("pg");

  const pool = new Pool({
    connectionString,
    ssl: buildSslConfig(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 10000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 10000)
  });

  return {
    kind: "postgres",
    connectionString,
    pool,
    async ping() {
      const result = await pool.query("SELECT 1 AS ok");
      return result.rows[0] || { ok: true };
    },
    async query(text, params = []) {
      return pool.query(text, params);
    },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
