import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";

import { installUserContext } from "./database.js";
import { DatabaseUserContext } from "./user-context.js";

function createPoolDouble() {
  const release = vi.fn();
  const result = { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [{ value: 1 }] } satisfies QueryResult;
  const rawClientQuery = vi.fn((text: unknown, valuesOrCallback?: unknown, maybeCallback?: unknown) => {
      const callback = typeof valuesOrCallback === "function" ? valuesOrCallback : maybeCallback;
      if (typeof callback === "function") {
        callback(undefined, result);
        return undefined;
      }
      return Promise.resolve(result);
    });
  const client = {
    query: rawClientQuery,
    release,
    once: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as PoolClient;

  const rawConnect = vi.fn((callback?: unknown) => {
    if (typeof callback === "function") {
      callback(undefined, client, release);
      return undefined;
    }
    return Promise.resolve(client);
  });

  const poolDouble = {
    connect: rawConnect,
    query(text: unknown, valuesOrCallback?: unknown, maybeCallback?: unknown) {
      const callback = typeof valuesOrCallback === "function" ? valuesOrCallback : maybeCallback;
      const values = typeof valuesOrCallback === "function" ? undefined : valuesOrCallback;
      const promise = new Promise<QueryResult>((resolve, reject) => {
        poolDouble.connect((error: Error | undefined, connectedClient: PoolClient | undefined) => {
          if (error !== undefined || connectedClient === undefined) {
            reject(error ?? new Error("client missing"));
            return;
          }
          connectedClient.query(text as string, values as never, (queryError: Error | undefined, queryResult: QueryResult) => {
            connectedClient.release(queryError);
            if (queryError !== undefined) reject(queryError);
            else resolve(queryResult);
          });
        });
      });
      if (typeof callback === "function") {
        void promise.then((value) => callback(undefined, value), (error: unknown) => callback(error));
        return undefined;
      }
      return promise;
    },
  };
  const pool = poolDouble as unknown as Pool;

  return { pool, rawConnect, release, rawClientQuery };
}

describe("database user context pool wrapping", () => {
  it("preserves pg's callback connect contract for repeated context-free queries", async () => {
    const { pool, rawConnect, release } = createPoolDouble();
    installUserContext(pool, new DatabaseUserContext());

    await expect(Promise.all(Array.from({ length: 12 }, () => pool.query("select 1")))).resolves.toHaveLength(12);
    expect(rawConnect).toHaveBeenCalledTimes(12);
    expect(release).toHaveBeenCalledTimes(12);
  });

  it("still configures transaction-local user context for promise clients", async () => {
    const { pool, rawClientQuery } = createPoolDouble();
    const context = new DatabaseUserContext();
    context.enter("00000000-0000-4000-8000-000000000001");
    installUserContext(pool, context);

    const connectedClient = await pool.connect();
    await connectedClient.query("begin");

    expect(rawClientQuery).toHaveBeenNthCalledWith(1, "begin");
    expect(rawClientQuery).toHaveBeenNthCalledWith(
      2,
      "select set_config('exercise.user_id', $1, true)",
      ["00000000-0000-4000-8000-000000000001"],
    );
  });
});
