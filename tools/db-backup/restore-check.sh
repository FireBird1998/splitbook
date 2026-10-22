#!/usr/bin/env bash
# Prove a dump restores: load it into a throwaway local MongoDB (Docker), count every collection,
# compare with the dump's manifest, then remove the throwaway database. Nothing touches Atlas.
#
#   tools/db-backup/restore-check.sh [dump folder]   # default: the newest dump
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="${SPLITBOOK_BACKUP_DIR:-$HOME/SplitbookBackups}"
ENV_FILE="${SPLITBOOK_BACKUP_ENV:-$ROOT/backup.env}"
# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"
: "${SPLITBOOK_BACKUP_DB:?set it in $ENV_FILE, e.g. splitbook}"

DUMP="${1:-$(find "$ROOT/dumps" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | tail -n 1)}"
[[ -n "$DUMP" && -f "$DUMP/manifest.tsv" ]] || { echo "No dump with a manifest.tsv found." >&2; exit 1; }

IMAGE="${SPLITBOOK_RESTORE_IMAGE:-mongo:8.0}"
CONTAINER="splitbook-restore-check-$$"
trap 'docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true' EXIT

echo "Restoring $DUMP into a throwaway $IMAGE container"
docker run -d --name "$CONTAINER" -v "$DUMP:/dump:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" mongorestore --quiet --gzip --drop --nsInclude="$SPLITBOOK_BACKUP_DB.*" /dump

restored="$(docker exec "$CONTAINER" mongosh --quiet "$SPLITBOOK_BACKUP_DB" --eval '
  db.getCollectionNames().sort().forEach((name) => print(name + "\t" + db.getCollection(name).countDocuments()))
')"

if diff <(sort "$DUMP/manifest.tsv") <(printf '%s\n' "$restored" | sort); then
  echo "OK: every collection restored with the dumped number of documents"
  awk -F'\t' '{ printf "  %-24s %s\n", $1, $2 }' "$DUMP/manifest.tsv"
else
  echo "MISMATCH between the manifest (<) and the restored database (>)" >&2
  exit 1
fi
