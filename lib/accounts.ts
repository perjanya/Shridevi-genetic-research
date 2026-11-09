import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { audit, Problem, type Database, type Queryable } from "./db";
import { required, roleNames, optionalId, type Actor } from "./model";

export const emailInput = z.email().trim().toLowerCase().max(254);
export const passwordInput = z.string().min(14).max(256);
export const accountInput = z.object({ email: emailInput, name: required, password: passwordInput, role: z.enum(roleNames), department: optionalId });
export const sessionCookie = "shridevi_session";
const lifetime = 8 * 3600;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

export async function addAccount(db: Queryable, raw: z.infer<typeof accountInput>, actor: Actor | null) {
  const input = accountInput.parse(raw);
  if (actor?.role !== "admin" && (actor || input.role !== "admin")) throw new Problem("Administrator access required.", 403);
  if (input.role === "department" && !input.department) throw new Problem("Assign a department to this account.");
  const id = randomUUID();
  const result = await db.query("INSERT INTO accounts(id,email,name,password_hash,role,department_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING RETURNING id",
    [id, input.email, input.name, passwordHash(input.password), input.role, input.department || null]);
  if (!result.rows.length) throw new Problem("This email already has an account.", 409);
  await audit(db, "account", id, actor?.id ?? id, "Account authorized", { role: input.role, department: input.department });
  return id;
}

export async function authenticate(db: Database, rawEmail: string, password: string) {
  const email = emailInput.parse(rawEmail);
  if (!password || password.length > 256) throw new Problem("Email or password is incorrect.", 401);
  const attempt = await db.query<{ attempts: number }>(
    "INSERT INTO login_limits(email,attempts,since) VALUES($1,1,now()) ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN login_limits.since < now()-interval '15 minutes' THEN 1 ELSE least(login_limits.attempts+1,100) END,since=CASE WHEN login_limits.since < now()-interval '15 minutes' THEN now() ELSE login_limits.since END RETURNING attempts",
    [email]);
  if (attempt.rows[0].attempts > 8) throw new Problem("Too many sign-in attempts. Try again in 15 minutes.", 429);
  const { rows } = await db.query<{ id: string; password_hash: string }>("SELECT id,password_hash FROM accounts WHERE email=$1 AND active", [email]);
  const account = rows[0];
  const expected = account?.password_hash ?? ("0".repeat(32) + ":" + "0".repeat(128));
  const actual = passwordHash(password, expected.split(":")[0]);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) || !account) throw new Problem("Email or password is incorrect.", 401);
  const token = randomBytes(32).toString("base64url");
  await db.transaction(async tx => {
    await tx.query("DELETE FROM sessions WHERE expires_at <= now()");
    await tx.query("DELETE FROM login_limits WHERE email=$1 OR since < now()-interval '1 day'", [email]);
    await tx.query("INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')", [digest(token), account.id, lifetime]);
  });
  return { token, lifetime };
}

export async function sessionActor(db: Queryable, token?: string) {
  if (!token || !/^[\w-]{43}$/.test(token)) return null;
  const { rows } = await db.query<Actor>("SELECT a.id,a.name,a.role,a.department_id FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active", [digest(token)]);
  return rows[0] ?? null;
}

export async function endSession(db: Queryable, token: string) {
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
}
