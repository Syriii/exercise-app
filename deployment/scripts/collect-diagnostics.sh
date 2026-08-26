#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIRECTORY/common.sh"

require_compose

case "${DIAGNOSTIC_LOG_LINES:-200}" in
  *[!0-9]*|'') fail "DIAGNOSTIC_LOG_LINES must be a positive integer" ;;
esac

report_directory=${DIAGNOSTIC_DIRECTORY:-"$DEPLOYMENT_DIRECTORY/diagnostics"}
mkdir -p "$report_directory"
chmod 700 "$report_directory"
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
report_path="$report_directory/exercise-app-diagnostics-$timestamp.log"
umask 077

published_api=$(compose port api 3000 2>/dev/null | sed -n '1p' || true)
published_port=${published_api##*:}
case "$published_port" in
  *[!0-9]*|'') base_url="" ;;
  *) base_url="http://127.0.0.1:$published_port" ;;
esac

{
  printf 'EXERCISE APP DEPLOYMENT DIAGNOSTICS\n'
  printf 'Generated at (UTC): %s\n' "$timestamp"
  printf 'Privacy: no .env, secret files, database rows, photos, exports, or volume contents are collected.\n'
  printf 'Review before sharing: container logs can still contain IP addresses, request paths, IDs, and error context.\n'

  printf '\n[HOST]\n'
  uname -a
  docker version --format 'Docker client={{.Client.Version}} server={{.Server.Version}}' 2>&1 || true
  docker compose version 2>&1 || true
  df -h "$DEPLOYMENT_DIRECTORY" 2>&1 || true

  printf '\n[COMPOSE STATUS]\n'
  compose ps 2>&1 || true

  printf '\n[PUBLIC HEALTH]\n'
  if [ -n "$base_url" ] && command -v curl >/dev/null 2>&1; then
    printf 'Live: '
    curl --silent --show-error --max-time 5 --write-out ' HTTP %{http_code}\n' "$base_url/api/v1/health/live" 2>&1 || true
    printf 'Ready: '
    curl --silent --show-error --max-time 5 --write-out ' HTTP %{http_code}\n' "$base_url/api/v1/health/ready" 2>&1 || true
  else
    printf 'Health check skipped: API port is not published or curl is unavailable.\n'
  fi

  printf '\n[CONTAINER HEALTH]\n'
  for service in postgres api worker; do
    container_id=$(compose ps -q "$service" 2>/dev/null || true)
    if [ -n "$container_id" ]; then
      docker inspect --format "$service status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} restartCount={{.RestartCount}}" "$container_id" 2>&1 || true
    else
      printf '%s container not found\n' "$service"
    fi
  done

  printf '\n[RECENT LOGS — LAST %s LINES PER SERVICE]\n' "${DIAGNOSTIC_LOG_LINES:-200}"
  for service in setup api worker postgres; do
    printf '\n--- %s ---\n' "$service"
    compose logs --no-color --timestamps --tail "${DIAGNOSTIC_LOG_LINES:-200}" "$service" 2>&1 || true
  done
} >"$report_path" 2>&1

chmod 600 "$report_path"
printf '[exercise-app] diagnostic report written to %s\n' "$report_path"
printf '[exercise-app] review the file before attaching or pasting it into a support conversation\n'
