import type { Pool } from "pg";

export const apiDatabaseRole = "exercise_api";

export interface EnsureApiDatabaseRoleOptions {
  readonly preserveExistingPassword?: boolean;
}

export async function ensureApiDatabaseRole(
  pool: Pool,
  password: string,
  options: EnsureApiDatabaseRoleOptions = {},
): Promise<void> {
  const role = await pool.query<{ exists: boolean }>(
    "select exists(select 1 from pg_roles where rolname = $1) as exists",
    [apiDatabaseRole],
  );
  if (role.rows[0]?.exists !== true) {
    await pool.query(
      `create role ${apiDatabaseRole} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
    );
    await pool.query(`alter role ${apiDatabaseRole} password ${quoteLiteral(password)}`);
    return;
  }
  if (options.preserveExistingPassword !== true) {
    await pool.query(`alter role ${apiDatabaseRole} password ${quoteLiteral(password)}`);
  }
}

export async function grantApiDatabaseRole(pool: Pool): Promise<void> {
  await pool.query(`grant usage on schema public to ${apiDatabaseRole}`);
  await pool.query(
    `grant select, insert, update, delete on all tables in schema public to ${apiDatabaseRole}`,
  );
  await pool.query(
    `grant usage, select, update on all sequences in schema public to ${apiDatabaseRole}`,
  );
  const pgBoss = await pool.query<{ exists: boolean }>(
    "select exists(select 1 from pg_namespace where nspname = 'pgboss') as exists",
  );
  if (pgBoss.rows[0]?.exists === true) {
    await pool.query(`grant usage on schema pgboss to ${apiDatabaseRole}`);
    await pool.query(
      `grant select, insert, update, delete on all tables in schema pgboss to ${apiDatabaseRole}`,
    );
    await pool.query(
      `grant usage, select, update on all sequences in schema pgboss to ${apiDatabaseRole}`,
    );
    await pool.query(`grant execute on all functions in schema pgboss to ${apiDatabaseRole}`);
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
