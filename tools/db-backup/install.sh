#!/usr/bin/env bash
# Install the nightly production backup on this Mac (ADR 0011, docs/runbooks/database-backups.md).
#
#   tools/db-backup/install.sh <cluster host> [database]
#
# Copies the scripts to ~/SplitbookBackups/bin, writes backup.env there if it doesn't exist, and
# schedules backup.sh at 03:30 local time with launchd. A Mac asleep at 03:30 runs it on waking.
# The password is not handled here: it lives in the Keychain item the runbook creates.
set -euo pipefail

HOST="${1:?usage: install.sh <cluster host, e.g. cluster.xxxxx.mongodb.net> [database]}"
DB="${2:-splitbook}"
ROOT="$HOME/SplitbookBackups"
LABEL="in.splitbook.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"

umask 077
mkdir -p "$ROOT/bin" "$ROOT/dumps" "$ROOT/logs" "$(dirname "$PLIST")"
install -m 700 "$HERE/backup.sh" "$HERE/restore-check.sh" "$ROOT/bin/"

if [[ ! -f "$ROOT/backup.env" ]]; then
  cat >"$ROOT/backup.env" <<EOF
# Read by backup.sh and restore-check.sh. No password here: it is in the Keychain.
SPLITBOOK_BACKUP_URI='mongodb+srv://splitbook_backup@$HOST/?authSource=admin'
SPLITBOOK_BACKUP_DB='$DB'
SPLITBOOK_BACKUP_KEYCHAIN_SERVICE='splitbook-backup'
SPLITBOOK_BACKUP_KEYCHAIN_ACCOUNT='splitbook_backup'
SPLITBOOK_BACKUP_KEEP=14
EOF
fi

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$ROOT/bin/backup.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/logs/backup.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/backup.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: $ROOT/bin, $ROOT/backup.env and $PLIST (03:30 nightly)."
