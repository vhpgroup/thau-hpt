import { readFile } from "node:fs/promises";
import { pool, transaction, one } from "../lib/db.js";
try {
  await transaction(async (db) => {
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    if (
      !(await one(db, "SELECT version FROM schema_migrations WHERE version=1"))
    ) {
      await db.query(
        await readFile(
          new URL("../db/001-initial.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query("INSERT INTO schema_migrations(version) VALUES(1)");
    }
  });
  console.log("Database đã cập nhật.");
} finally {
  await pool().end();
}
