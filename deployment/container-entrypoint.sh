#!/bin/sh

set -eu

fail() {
  printf '%s\n' "exercise-app entrypoint: $1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "must start as root to prepare file-backed secrets"
[ "$#" -gt 0 ] || fail "application command is missing"

runtime_secret_directory=/tmp/exercise-app-secrets
[ ! -L "$runtime_secret_directory" ] || fail "runtime secret directory cannot be a symbolic link"
rm -rf -- "$runtime_secret_directory"
mkdir -p -- "$runtime_secret_directory"
chown root:node "$runtime_secret_directory"
chmod 0750 "$runtime_secret_directory"

for variable_name in \
  DATABASE_URL_FILE \
  DATABASE_PASSWORD_FILE \
  SESSION_SECRET_FILE \
  ADMIN_INITIAL_PASSWORD_FILE \
  API_DATABASE_PASSWORD_FILE \
  DEEPSEEK_API_KEY_FILE; do
  eval "source_path=\${$variable_name:-}"
  [ -n "$source_path" ] || continue

  case "$source_path" in
    /run/secrets/*) ;;
    *) fail "$variable_name must refer to /run/secrets" ;;
  esac

  [ -f "$source_path" ] || fail "$variable_name does not refer to a regular file"
  [ ! -L "$source_path" ] || fail "$variable_name cannot refer to a symbolic link"

  target_name=$(printf '%s' "$variable_name" | tr '[:upper:]' '[:lower:]')
  target_path="$runtime_secret_directory/$target_name"
  cp -- "$source_path" "$target_path"
  chown root:node "$target_path"
  chmod 0440 "$target_path"
  eval "$variable_name=\$target_path"
  export "$variable_name"
done

exec /usr/local/bin/gosu node:node "$@"
