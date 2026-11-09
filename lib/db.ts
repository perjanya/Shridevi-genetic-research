import { Pool } from "pg";

export type Queryable = {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};
export type Database = Queryable & { transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> };
let pool: Pool | undefined;

export function postgres(): Database {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const max = Number(process.env.DATABASE_POOL_MAX || 4);
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10_000 });
  return {
    query: (sql, params) => pool!.query(sql, params),
    async transaction(run) {
      const client = await pool!.connect();
      try {
        await client.query("BEGIN");
        const result = await run(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export async function shutdown() { await pool?.end(); pool = undefined; }

export async function audit(db: Queryable, scope: string, subject: string, actor: string | null, kind: string, data: unknown) {
  await db.query("INSERT INTO events(scope,subject,actor,kind,data) VALUES($1,$2,$3,$4,$5)", [scope, subject, actor, kind, JSON.stringify(data)]);
}

export class Problem extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
