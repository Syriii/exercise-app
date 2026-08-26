#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(dirname "$script_dir")
cd "$deployment_dir"
umask 077

read_env_value() {
  key=$1
  [ -f .env ] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); value=$0 } END { print value }' .env
}

configured_backup_dir=${BACKUP_DIRECTORY:-$(read_env_value BACKUP_DIRECTORY)}
configured_mirror_dir=${BACKUP_MIRROR_DIRECTORY:-$(read_env_value BACKUP_MIRROR_DIRECTORY)}
configured_retention_days=${BACKUP_RETENTION_DAYS:-$(read_env_value BACKUP_RETENTION_DAYS)}
backup_dir=${configured_backup_dir:-"$deployment_dir/backups"}
retention_days=${configured_retention_days:-14}
case "$retention_days" in 0|*[!0-9]*|"") echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 2;; esac
mkdir -p "$backup_dir"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
database_name=${POSTGRES_DB:-exercise}
database_user=${POSTGRES_USER:-exercise}
partial="$backup_dir/.exercise-$timestamp.dump.partial"
backup="$backup_dir/exercise-$timestamp.dump"
manifest="$backup.manifest.json"

record_failure() {
  exit_code=$?
  trap - EXIT HUP INT TERM
  rm -f "$partial"
  docker compose exec -T postgres psql -U "$database_user" -d "$database_name" -v ON_ERROR_STOP=1 -c "insert into maintenance_events (type, status, details) values ('backup', 'failed', jsonb_build_object('phase', 'backup script'));" >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap 'record_failure' EXIT HUP INT TERM

docker compose exec -T postgres pg_dump -U "$database_user" -d "$database_name" --format=custom > "$partial"
test -s "$partial"
mv "$partial" "$backup"
trap - EXIT HUP INT TERM

if command -v sha256sum >/dev/null 2>&1; then
  checksum=$(sha256sum "$backup" | awk '{print $1}')
else
  checksum=$(shasum -a 256 "$backup" | awk '{print $1}')
fi
byte_size=$(wc -c < "$backup" | tr -d ' ')
filename=$(basename "$backup")
printf '{"schemaVersion":"exercise-app-backup-manifest-v1","createdAt":"%s","database":"%s","file":"%s","byteSize":%s,"sha256":"%s","includesTemporaryPhotos":false}\n' "$timestamp" "$database_name" "$filename" "$byte_size" "$checksum" > "$manifest"

docker compose exec -T postgres psql -U "$database_user" -d "$database_name" -v ON_ERROR_STOP=1 -v artifact_sha="$checksum" -v artifact_file="$filename" -c "insert into maintenance_events (type, status, artifact_sha256, details) values ('backup', 'succeeded', :'artifact_sha', jsonb_build_object('file', :'artifact_file', 'includesTemporaryPhotos', false));"

if [ -n "$configured_mirror_dir" ]; then
  test -d "$configured_mirror_dir"
  cp "$backup" "$manifest" "$configured_mirror_dir/"
fi

find "$backup_dir" -type f \( -name 'exercise-*.dump' -o -name 'exercise-*.dump.manifest.json' \) -mtime "+$retention_days" -delete
trap - EXIT HUP INT TERM
echo "Backup created: $backup"
