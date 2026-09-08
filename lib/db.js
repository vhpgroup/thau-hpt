import pg from "pg";
pg.types.setTypeParser(1082, (value) => value);
const globalDb = globalThis;
export function pool() {
  if (!process.env.DATABASE_URL) throw new Error("Chưa cấu hình DATABASE_URL.");
  if (!globalDb.hptPool)
    globalDb.hptPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  return globalDb.hptPool;
}
export async function transaction(fn, database = pool()) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Small-company deployment: one business writer at a time across all Node processes.
    // Readers remain concurrent. Replace with ordered row locks only with concurrency tests.
    await client.query("SELECT pg_advisory_xact_lock(824615)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function one(db, sql, params = []) {
  return (await db.query(sql, params)).rows[0];
}
export async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}
