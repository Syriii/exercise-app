#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/common.sh"

[ "${ALLOW_TEST_DATABASE_RESET:-false}" = "true" ] || fail \
  "set ALLOW_TEST_DATABASE_RESET=true to create and remove the isolated integration database"

require_compose
compose up -d postgres
wait_for_postgres

source_database=$(postgres_database_name)
test_database="${source_database}_test"
case "$test_database" in
  *_test) ;;
  *) fail "integration database name must end with _test" ;;
esac
[ "$test_database" != "$source_database" ] || fail "integration database cannot equal the source database"

cleanup() {
  drop_database "$test_database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

log "resetting isolated integration database $test_database"
drop_database "$test_database"
create_database "$test_database"

log "building the verification-only image target"
compose --profile verification build integration

log "running Drizzle, pg-boss transaction/crash recovery, Argon2id, and heartbeat tests"
compose --profile verification run --rm integration

log "database integration verification passed"
