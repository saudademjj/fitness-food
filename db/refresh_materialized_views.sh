#!/usr/bin/env bash
set -euo pipefail

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  . ".env.local"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" && -z "${PGDATABASE:-}" ]]; then
  echo "DATABASE_URL or PGDATABASE is required."
  exit 1
fi

if [[ "${PG_REFRESH_AS_POSTGRES:-0}" == "1" ]] && ! sudo -n -u postgres true >/dev/null 2>&1; then
  echo "PG_REFRESH_AS_POSTGRES=1 requires passwordless sudo access to postgres."
  exit 1
fi

get_database_name() {
  if [[ -n "${PGDATABASE:-}" ]]; then
    printf '%s\n' "$PGDATABASE"
    return
  fi

  local database_name="${DATABASE_URL##*/}"
  printf '%s\n' "${database_name%%\?*}"
}

run_psql() {
  if [[ "${PG_REFRESH_AS_POSTGRES:-0}" == "1" ]]; then
    sudo -n -u postgres psql -d "$(get_database_name)" "$@"
  elif [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" "$@"
  else
    psql "$@"
  fi
}

refresh_if_materialized() {
  local schema_name="$1"
  local view_name="$2"

  local exists
  exists="$(run_psql -Atqc "SELECT 1 FROM pg_matviews WHERE schemaname = '${schema_name}' AND matviewname = '${view_name}'")"

  if [[ "$exists" == "1" ]]; then
    run_psql -c "REFRESH MATERIALIZED VIEW ${schema_name}.${view_name};"
  else
    echo "Skipping ${schema_name}.${view_name}: not a materialized view."
  fi
}

refresh_if_materialized core app_food_profile_23
refresh_if_materialized core app_recipe_profile_23
refresh_if_materialized core app_catalog_profile_23
