#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mode=${1:-smoke}

case "$mode" in
  smoke)
    exec "$SCRIPT_DIRECTORY/smoke-check.sh"
    ;;
  database)
    ALLOW_TEST_DATABASE_RESET=true exec "$SCRIPT_DIRECTORY/verify-database.sh"
    ;;
  persistence)
    exec "$SCRIPT_DIRECTORY/verify-persistence.sh"
    ;;
  backup)
    exec "$SCRIPT_DIRECTORY/verify-backup-restore.sh"
    ;;
  full)
    [ "${ALLOW_CONTAINER_RECREATE_TEST:-false}" = "true" ] || {
      printf '%s\n' "Set ALLOW_CONTAINER_RECREATE_TEST=true because full verification recreates PostgreSQL." >&2
      exit 1
    }
    "$SCRIPT_DIRECTORY/smoke-check.sh"
    ALLOW_TEST_DATABASE_RESET=true "$SCRIPT_DIRECTORY/verify-database.sh"
    "$SCRIPT_DIRECTORY/verify-backup-restore.sh"
    "$SCRIPT_DIRECTORY/verify-persistence.sh"
    "$SCRIPT_DIRECTORY/smoke-check.sh"
    ;;
  -h|--help)
    printf '%s\n' \
      "Usage: $0 [smoke|database|backup|persistence|full]" \
      "" \
      "full requires ALLOW_CONTAINER_RECREATE_TEST=true."
    ;;
  *)
    printf '%s\n' "Unknown verification mode: $mode" >&2
    exit 2
    ;;
esac
