import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "../lib/db";

export async function migrate(db: Database) {
  const folder = resolve("migrations");
  const files = (await readdir(folder)).filter(name => /^\d+.*\.sql$/.test(name)).sort();
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(518216)");
    await tx.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await tx.query<{ name: string }>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map(row => row.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      await tx.query(await readFile(resolve(folder, file), "utf8"));
      await tx.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
    }
  });
}
