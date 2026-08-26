import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema/index.js";
import type { DatabaseUserContext } from "./user-context.js";

export function createDatabase(databaseUrl: string, userContext?: DatabaseUserContext) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  if (userContext !== undefined) installUserContext(pool, userContext);
  const database = drizzle(pool, { schema });

  return {
    database,
    pool,
    async check(): Promise<void> {
      await pool.query("select 1");
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

function installUserContext(pool: Pool, userContext: DatabaseUserContext): void {
  const rawConnect = pool.connect.bind(pool);
  const rawPoolQuery = pool.query.bind(pool);

  pool.query = (async (...args: unknown[]) => {
    const userId = userContext.userId;
    if (userId === null) return Reflect.apply(rawPoolQuery, pool, args);
    const client = await rawConnect();
    try {
      await client.query("begin");
      await client.query("select set_config('exercise.user_id', $1, true)", [userId]);
      const result = await Reflect.apply(client.query.bind(client), client, args);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }) as typeof pool.query;

  pool.connect = (async () => {
    const client = await rawConnect();
    const userId = userContext.userId;
    if (userId === null) return client;
    const rawClientQuery = client.query.bind(client);
    let configured = false;
    client.query = (async (...args: unknown[]) => {
      const result = await Reflect.apply(rawClientQuery, client, args);
      if (!configured && queryText(args[0]).startsWith("begin")) {
        await rawClientQuery("select set_config('exercise.user_id', $1, true)", [userId]);
        configured = true;
      }
      return result;
    }) as typeof client.query;
    return client;
  }) as typeof pool.connect;
}

function queryText(value: unknown): string {
  if (typeof value === "string") return value.trim().toLocaleLowerCase("en");
  if (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string") {
    return value.text.trim().toLocaleLowerCase("en");
  }
  return "";
}

export type Database = ReturnType<typeof createDatabase>["database"];
