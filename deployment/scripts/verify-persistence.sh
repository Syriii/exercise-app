#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/common.sh"

[ "${ALLOW_CONTAINER_RECREATE_TEST:-false}" = "true" ] || fail \
  "set ALLOW_CONTAINER_RECREATE_TEST=true because this check recreates the PostgreSQL container"

require_compose
compose up -d postgres
wait_for_postgres

probe_database="exercise_volume_check_$(date +%s)_$$"
probe_value="volume_probe_$(date +%s)_$$"
case "$probe_database" in
  exercise_volume_check_*) ;;
  *) fail "unsafe persistence probe database name" ;;
esac

cleanup() {
  wait_for_postgres >/dev/null 2>&1 || true
  drop_database "$probe_database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

log "creating isolated persistence probe"
create_database "$probe_database"
compose exec -T postgres sh -eu -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -v probe_value="$2" -c "create table volume_probe(value text not null); insert into volume_probe values (:'\''probe_value'\'');" >/dev/null' \
  sh "$probe_database" "$probe_value"

log "recreating only the PostgreSQL container without deleting volumes"
compose up -d --force-recreate postgres
wait_for_postgres

restored_value=$(compose exec -T postgres sh -eu -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -Atc "select value from volume_probe limit 1"' \
  sh "$probe_database")
[ "$restored_value" = "$probe_value" ] || fail "named volume did not preserve the probe"

log "PostgreSQL named-volume persistence passed"
