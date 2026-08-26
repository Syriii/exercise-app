#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deployment_dir=$(dirname "$script_dir")
cd "$deployment_dir"

database_name=${POSTGRES_DB:-exercise}
database_user=${POSTGRES_USER:-exercise}
if ! "$script_dir/verify-increment0.sh" backup; then
  docker compose exec -T postgres psql -U "$database_user" -d "$database_name" -v ON_ERROR_STOP=1 -c "insert into maintenance_events (type, status, details) values ('restore_verification', 'failed', jsonb_build_object('scope', 'isolated temporary database'));" >/dev/null 2>&1 || true
  exit 1
fi
docker compose exec -T postgres psql -U "$database_user" -d "$database_name" -v ON_ERROR_STOP=1 -c "insert into maintenance_events (type, status, details) values ('restore_verification', 'succeeded', jsonb_build_object('scope', 'isolated temporary database'));"
echo "Restore verification completed and recorded."
