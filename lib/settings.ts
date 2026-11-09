import { randomUUID } from "node:crypto";
import { audit, Problem, type Database } from "./db";
import { programmeInput, required, uid, type Actor } from "./model";

export async function saveProgramme(db: Database, actor: Actor, raw: unknown, expected: number) {
  if (actor.role !== "admin") throw new Problem("Administrator access required.", 403);
  const data = programmeInput.parse(raw);
  await db.transaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(518219)");
    const previous = (await tx.query<{ version: number }>("SELECT version FROM settings WHERE key='programme' FOR UPDATE")).rows[0];
    if ((previous?.version ?? 0) !== expected) throw new Problem("Programme settings changed. Reload before saving.", 409);
    const { rows } = await tx.query(
      "INSERT INTO settings(key,data,version) VALUES('programme',$1,1) ON CONFLICT(key) DO UPDATE SET data=excluded.data,version=settings.version+1 WHERE settings.version=$2 RETURNING version",
      [JSON.stringify(data), expected]);
    if (!rows.length) throw new Problem("Programme settings changed. Reload before saving.", 409);
    await tx.query("INSERT INTO settings(key,data,version) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET data=excluded.data,version=excluded.version",
      ["cycle:" + data.name, JSON.stringify(data), expected + 1]);
    await audit(tx, "settings", "programme", actor.id, "Programme settings version saved", { version: expected + 1, data });
  });
}

export async function saveDepartment(db: Database, actor: Actor, rawId: string, rawName: string) {
  if (actor.role !== "admin") throw new Problem("Administrator access required.", 403);
  const id = rawId ? uid.parse(rawId) : randomUUID();
  const name = required.parse(rawName);
  await db.transaction(async tx => {
    const { rows } = rawId ? await tx.query("UPDATE departments SET name=$2 WHERE id=$1 RETURNING id", [id, name]) :
      await tx.query("INSERT INTO departments(id,name) VALUES($1,$2) ON CONFLICT(name) DO NOTHING RETURNING id", [id, name]);
    if (!rows.length) throw new Problem("The department is unavailable or already exists.", 409);
    await audit(tx, "department", id, actor.id, rawId ? "Department renamed" : "Department created", { name });
  });
}

export async function deactivateAccount(db: Database, actor: Actor, raw: string) {
  if (actor.role !== "admin") throw new Problem("Administrator access required.", 403);
  const id = uid.parse(raw);
  if (id === actor.id) throw new Problem("Ask a different administrator to revoke this account.");
  await db.transaction(async tx => {
    await tx.query("UPDATE accounts SET active=false WHERE id=$1", [id]);
    await tx.query("DELETE FROM sessions WHERE account_id=$1", [id]);
    await audit(tx, "account", id, actor.id, "Access revoked", {});
  });
}
