import { readFile } from "node:fs/promises";
export const migrations = ["001-initial.sql", "002-catalog-finance.sql"];
export async function migrate(db) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (let i = 0; i < migrations.length; i++) {
    if (
      (
        await db.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [i + 1],
        )
      ).rows.length
    )
      continue;
    const sql = await readFile(
      new URL("../db/" + migrations[i], import.meta.url),
      "utf8",
    );
    if (db.exec) await db.exec(sql);
    else await db.query(sql);
    await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [
      i + 1,
    ]);
  }
}
