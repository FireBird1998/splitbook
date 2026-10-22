#!/usr/bin/env bash
# Dump Splitbook's production database with the read-only backup user, check the dump, and keep
# the newest dumps (ADR 0011, docs/runbooks/database-backups.md).
#
# Settings come from backup.env beside the backups (never from this repository): the connection
# string without a password, the database, and the Keychain item holding the password. The
# password reaches mongodump through a private temporary file, never the command line or a log.
set -euo pipefail

# launchd starts jobs with a bare PATH; mongodump and bsondump come from Homebrew.
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="${SPLITBOOK_BACKUP_DIR:-$HOME/SplitbookBackups}"
ENV_FILE="${SPLITBOOK_BACKUP_ENV:-$ROOT/backup.env}"
# shellcheck source=/dev/null
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE"

: "${SPLITBOOK_BACKUP_URI:?set it in $ENV_FILE, e.g. mongodb+srv://splitbook_backup@<host>/?authSource=admin}"
: "${SPLITBOOK_BACKUP_DB:?set it in $ENV_FILE, e.g. splitbook}"
KEYCHAIN_SERVICE="${SPLITBOOK_BACKUP_KEYCHAIN_SERVICE:-splitbook-backup}"
KEYCHAIN_ACCOUNT="${SPLITBOOK_BACKUP_KEYCHAIN_ACCOUNT:-splitbook_backup}"
KEEP="${SPLITBOOK_BACKUP_KEEP:-14}"
DUMPS="$ROOT/dumps"
LOGS="$ROOT/logs"

umask 077
mkdir -p "$DUMPS" "$LOGS"

notify() {
  osascript -e "display notification \"$1\" with title \"Splitbook backup\"" >/dev/null 2>&1 || true
}

fail() {
  echo "FAILED: $1" >&2
  notify "Failed: $1"
  exit 1
}

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
PARTIAL="$DUMPS/.partial-$STAMP"
FINAL="$DUMPS/$STAMP"
SECRETS="$(mktemp -d)"
trap 'rm -rf "$SECRETS"' EXIT

PASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null)" ||
  fail "no Keychain item '$KEYCHAIN_SERVICE' for '$KEYCHAIN_ACCOUNT'"
# mongodump reads the password from a YAML file; single quotes keep any character literal.
printf "password: '%s'\n" "${PASSWORD//\'/\'\'}" >"$SECRETS/mongodump.yaml"
unset PASSWORD

echo "Dumping $SPLITBOOK_BACKUP_DB to $FINAL"
if ! mongodump --uri="$SPLITBOOK_BACKUP_URI" --config="$SECRETS/mongodump.yaml" \
  --db="$SPLITBOOK_BACKUP_DB" --readPreference=secondaryPreferred --gzip --out="$PARTIAL" \
  2>"$PARTIAL.log"; then
  cat "$PARTIAL.log" >&2
  fail "mongodump exited with an error (log: $PARTIAL.log)"
fi
rm -rf "$SECRETS"

# mongodump reports each collection as "done dumping `<db>.<collection>` (<n> documents)"; older
# versions leave out the backticks.
MANIFEST="$PARTIAL/manifest.tsv"
sed -nE "s/.*done dumping \`?${SPLITBOOK_BACKUP_DB}\.([^\` ]+)\`? \(([0-9]+) documents?\).*/\1	\2/p" \
  "$PARTIAL.log" | sort >"$MANIFEST"
[[ -s "$MANIFEST" ]] || fail "mongodump reported no collections (log: $PARTIAL.log)"

# Read every collection back from the dump and compare its documents with what mongodump reported.
problems=0
while IFS=$'\t' read -r collection expected; do
  file="$PARTIAL/$SPLITBOOK_BACKUP_DB/$collection.bson.gz"
  if [[ ! -f "$file" ]]; then
    echo "missing: $collection" >&2
    problems=$((problems + 1))
    continue
  fi
  actual="$(gunzip -c "$file" | bsondump --quiet | wc -l | tr -d ' ')"
  if [[ "$actual" != "$expected" ]]; then
    echo "count mismatch: $collection dumped $expected, read back $actual" >&2
    problems=$((problems + 1))
  fi
done <"$MANIFEST"
((problems == 0)) || fail "$problems collection(s) did not read back (dump kept at $PARTIAL)"

mv "$PARTIAL.log" "$PARTIAL/mongodump.log"
mv "$PARTIAL" "$FINAL"
collections="$(wc -l <"$FINAL/manifest.tsv" | tr -d ' ')"
documents="$(awk -F'\t' '{ n += $2 } END { print n }' "$FINAL/manifest.tsv")"
echo "OK $STAMP: $collections collections, $documents documents, all read back"

# Keep the newest $KEEP complete dumps; a failed run's .partial folder stays until looked at.
find "$DUMPS" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort -r | tail -n "+$((KEEP + 1))" |
  while read -r old; do rm -rf "$old"; done
