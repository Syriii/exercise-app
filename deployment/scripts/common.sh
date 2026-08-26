#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOYMENT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
COMPOSE_FILE="$DEPLOYMENT_DIRECTORY/compose.yaml"

log() {
  printf '\n[exercise-app] %s\n' "$1"
}

fail() {
  printf '\n[exercise-app] ERROR: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

compose() {
  docker compose --project-directory "$DEPLOYMENT_DIRECTORY" -f "$COMPOSE_FILE" "$@"
}

require_compose() {
  require_command docker
  docker info >/dev/null 2>&1 || fail "Docker Engine is not available"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
  compose config --quiet
}

wait_for_postgres() {
  attempts=${VERIFY_POSTGRES_WAIT_ATTEMPTS:-30}
  case "$attempts" in
    *[!0-9]*|'') fail "VERIFY_POSTGRES_WAIT_ATTEMPTS must be a positive integer" ;;
  esac

  current=1
  while [ "$current" -le "$attempts" ]; do
    if compose exec -T postgres sh -eu -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    current=$((current + 1))
  done
  fail "PostgreSQL did not become ready"
}

postgres_sql() {
  query=$1
  compose exec -T postgres sh -eu -c \
    'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' \
    sh "$query"
}

postgres_database_name() {
  compose exec -T postgres sh -eu -c 'printf "%s" "$POSTGRES_DB"'
}

postgres_user_name() {
  compose exec -T postgres sh -eu -c 'printf "%s" "$POSTGRES_USER"'
}

create_database() {
  database_name=$1
  compose exec -T postgres sh -eu -c \
    'createdb -U "$POSTGRES_USER" --maintenance-db=postgres "$1"' \
    sh "$database_name"
}

drop_database() {
  database_name=$1
  compose exec -T postgres sh -eu -c \
    'dropdb -U "$POSTGRES_USER" --maintenance-db=postgres --if-exists --force "$1"' \
    sh "$database_name"
}
