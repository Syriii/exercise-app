#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/common.sh"

require_compose
require_command mktemp
compose up -d postgres
wait_for_postgres

source_database=$(postgres_database_name)
restore_database="exercise_restore_check_$(date +%s)_$$"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/exercise-backup-check.XXXXXX")
dump_file="$temporary_directory/exercise.dump"
case "$restore_database" in
  exercise_restore_check_*) ;;
  *) fail "unsafe restore verification database name" ;;
esac
[ "$restore_database" != "$source_database" ] || fail "restore database cannot equal the source database"

cleanup() {
  drop_database "$restore_database" >/dev/null 2>&1 || true
  rm -rf "$temporary_directory"
}
trap cleanup EXIT INT TERM

source_schema=$(postgres_sql "select to_regclass('public.users') is not null;")
[ "$source_schema" = "t" ] || fail "source database has not completed application migrations"

log "creating a temporary private-format backup"
compose exec -T postgres sh -eu -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$dump_file"
[ -s "$dump_file" ] || fail "backup file is empty"

log "restoring backup into isolated database $restore_database"
create_database "$restore_database"
compose exec -T postgres sh -eu -c \
  'pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error' \
  sh "$restore_database" < "$dump_file"

restored_tables=$(compose exec -T postgres sh -eu -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -Atc "select count(*) from pg_catalog.pg_tables where schemaname = '\''public'\'' and tablename in ('\''users'\'', '\''credentials'\'', '\''sessions'\'');"' \
  sh "$restore_database")
[ "$restored_tables" = "3" ] || fail "restored database is missing required tables"

log "backup and isolated restore verification passed"
