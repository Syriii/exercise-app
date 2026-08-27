#!/bin/sh

set -eu

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOYMENT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
REPOSITORY_DIRECTORY=$(CDPATH= cd -- "$DEPLOYMENT_DIRECTORY/.." && pwd)

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

require_private_file() {
  file_path=$1
  label=$2

  [ -f "$file_path" ] || fail "$label is missing: $file_path"
  file_mode=$(stat -c '%a' "$file_path")
  case "$file_mode" in
    400|600) ;;
    *) fail "$label must have mode 400 or 600; found $file_mode" ;;
  esac

  file_owner=$(stat -c '%u' "$file_path")
  current_user=$(id -u)
  [ "$file_owner" = "$current_user" ] || fail "$label must be owned by the current user"
}

validate_secret() {
  file_path=$1
  label=$2
  minimum_length=$3

  require_private_file "$file_path" "$label"
  secret_value=$(sed -e 's/\r$//' "$file_path")
  [ -n "$secret_value" ] || fail "$label cannot be empty"
  [ "${#secret_value}" -ge "$minimum_length" ] || fail "$label must contain at least $minimum_length characters"

  normalized_value=$(printf '%s' "$secret_value" | tr '[:upper:]' '[:lower:]')
  case "$normalized_value" in
    *replace-with-*|*changeme*|*change-me*)
      fail "$label still contains a public example placeholder"
      ;;
  esac

  printf '%s' "$secret_value"
}

require_ignored() {
  relative_path=$1
  git -C "$REPOSITORY_DIRECTORY" check-ignore -q -- "$relative_path" ||
    fail "$relative_path is not protected by .gitignore"
}

log "checking host tools"
for command_name in docker git curl awk sed stat tr id uname; do
  require_command "$command_name"
done
docker info >/dev/null 2>&1 || fail "Docker Engine is not available to the current user"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is not available"
git -C "$REPOSITORY_DIRECTORY" rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "deployment directory is not inside a Git worktree"

host_architecture=$(uname -m)
case "$host_architecture" in
  x86_64|amd64|aarch64|arm64) ;;
  *) printf '\n[exercise-app] WARNING: host architecture has not been validated: %s\n' "$host_architecture" >&2 ;;
esac

log "checking local configuration"
environment_file="$DEPLOYMENT_DIRECTORY/.env"
require_private_file "$environment_file" ".env"
require_ignored "deployment/.env"

app_port=$(awk -F= '$1 == "APP_PORT" { value = $2 } END { print value == "" ? "3000" : value }' "$environment_file")
awk -v port="$app_port" 'BEGIN { exit !(port ~ /^[0-9]+$/ && port >= 1 && port <= 65535) }' ||
  fail "APP_PORT must be an integer from 1 to 65535"

secrets_directory="$DEPLOYMENT_DIRECTORY/secrets"
database_password=$(validate_secret "$secrets_directory/database_password" "database_password" 16)
api_database_password=$(validate_secret "$secrets_directory/api_database_password" "api_database_password" 16)
session_secret=$(validate_secret "$secrets_directory/session_secret" "session_secret" 32)
admin_initial_password=$(validate_secret "$secrets_directory/admin_initial_password" "admin_initial_password" 8)

for relative_secret in \
  deployment/secrets/database_password \
  deployment/secrets/api_database_password \
  deployment/secrets/session_secret \
  deployment/secrets/admin_initial_password; do
  require_ignored "$relative_secret"
done

[ "$database_password" != "$api_database_password" ] || fail "database passwords must be different"
[ "$database_password" != "$session_secret" ] || fail "database_password and session_secret must be different"
[ "$database_password" != "$admin_initial_password" ] || fail "database_password and admin_initial_password must be different"
[ "$api_database_password" != "$session_secret" ] || fail "api_database_password and session_secret must be different"
[ "$api_database_password" != "$admin_initial_password" ] || fail "api_database_password and admin_initial_password must be different"
[ "$session_secret" != "$admin_initial_password" ] || fail "session_secret and admin_initial_password must be different"

deepseek_secret="$secrets_directory/deepseek_api_key"
if [ -e "$deepseek_secret" ]; then
  deepseek_api_key=$(validate_secret "$deepseek_secret" "deepseek_api_key" 8)
  require_ignored "deployment/secrets/deepseek_api_key"
  [ "$deepseek_api_key" != "$database_password" ] || fail "deepseek_api_key and database_password must be different"
  [ "$deepseek_api_key" != "$api_database_password" ] || fail "deepseek_api_key and api_database_password must be different"
  [ "$deepseek_api_key" != "$session_secret" ] || fail "deepseek_api_key and session_secret must be different"
  [ "$deepseek_api_key" != "$admin_initial_password" ] || fail "deepseek_api_key and admin_initial_password must be different"
fi

unset database_password api_database_password session_secret admin_initial_password deepseek_api_key 2>/dev/null || true

log "checking Compose configuration"
docker compose --project-directory "$DEPLOYMENT_DIRECTORY" \
  -f "$DEPLOYMENT_DIRECTORY/compose.yaml" config --quiet
if [ -e "$deepseek_secret" ]; then
  docker compose --project-directory "$DEPLOYMENT_DIRECTORY" \
    -f "$DEPLOYMENT_DIRECTORY/compose.yaml" \
    -f "$DEPLOYMENT_DIRECTORY/compose.deepseek.yaml" config --quiet
fi

log "preflight passed; no containers or data were changed"
