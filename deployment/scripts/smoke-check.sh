#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/common.sh"

require_compose
require_command curl

log "checking required containers"
running_services=$(compose ps --services --status running)
for service in postgres api worker; do
  printf '%s\n' "$running_services" | grep -Fx "$service" >/dev/null || fail "$service is not running"
done

wait_for_postgres

log "checking public liveness and readiness"
if [ -n "${APP_BASE_URL:-}" ]; then
  base_url=$APP_BASE_URL
else
  published_api=$(compose port api 3000 | sed -n '1p')
  published_port=${published_api##*:}
  case "$published_port" in
    *[!0-9]*|'') fail "could not determine the published API port" ;;
  esac
  base_url="http://127.0.0.1:$published_port"
fi
curl --fail --silent --show-error "$base_url/api/v1/health/live" >/dev/null
curl --fail --silent --show-error "$base_url/api/v1/health/ready" >/dev/null

log "checking database migrations and password constraint"
required_tables=$(postgres_sql \
  "select count(*) from pg_catalog.pg_tables where schemaname = 'public' and tablename in ('users', 'credentials', 'sessions', 'runtime_heartbeats');")
[ "$required_tables" = "4" ] || fail "required business tables are missing"

argon_constraint=$(postgres_sql \
  "select count(*) from pg_catalog.pg_constraint where conname = 'credentials_password_hash_argon2id_ck';")
[ "$argon_constraint" = "1" ] || fail "Argon2id database constraint is missing"

log "checking restricted API database role and row security"
api_role=$(postgres_sql \
  "select count(*) from pg_catalog.pg_roles where rolname = 'exercise_api' and not rolsuper and not rolcreaterole and not rolcreatedb and not rolbypassrls;")
[ "$api_role" = "1" ] || fail "restricted exercise_api role is missing or over-privileged"
rls_tables=$(postgres_sql \
  "select count(*) from pg_catalog.pg_tables where schemaname = 'public' and rowsecurity;")
[ "$rls_tables" = "32" ] || fail "expected 32 account-owned tables with row security, found $rls_tables"
compose exec -T api sh -eu -c \
  'test -r /run/secrets/api_database_password; test ! -e /run/secrets/database_password'
compose exec -T worker sh -eu -c \
  'test -r /run/secrets/database_password; test ! -e /run/secrets/api_database_password'

log "checking worker heartbeat"
worker_age=$(postgres_sql \
  "select floor(extract(epoch from (now() - last_seen_at)))::bigint from runtime_heartbeats where component = 'worker';")
case "$worker_age" in
  ''|*[!0-9-]*) fail "worker heartbeat is missing or invalid" ;;
esac
maximum_worker_age=${VERIFY_WORKER_MAX_AGE_SECONDS:-90}
case "$maximum_worker_age" in
  *[!0-9]*|'') fail "VERIFY_WORKER_MAX_AGE_SECONDS must be a positive integer" ;;
esac
[ "$worker_age" -le "$maximum_worker_age" ] || fail "worker heartbeat is stale (${worker_age}s)"

log "checking private service ports"
postgres_port=$(compose port postgres 5432 2>/dev/null || true)
[ -z "$postgres_port" ] || fail "PostgreSQL is unexpectedly published at $postgres_port"
worker_port=$(compose port worker 3000 2>/dev/null || true)
[ -z "$worker_port" ] || fail "worker is unexpectedly published at $worker_port"

log "checking temporary-media volume write access"
compose exec -T api sh -eu -c \
  'umask 077; probe="/app/.runtime/media/verification-$$"; printf "ok" > "$probe"; test "$(cat "$probe")" = "ok"; rm -f "$probe"'

log "smoke check passed"
