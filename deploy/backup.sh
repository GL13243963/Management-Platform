#!/usr/bin/env bash
set -euo pipefail

database="/var/lib/innovation-center/app.db"
backup_dir="/var/backups/innovation-center"
timestamp="$(date +%Y%m%d-%H%M%S)"
target="${backup_dir}/app-${timestamp}.db"

umask 077
mkdir -p "$backup_dir"
sqlite3 "$database" ".backup '${target}'"
gzip "$target"
find "$backup_dir" -type f -name 'app-*.db.gz' -mtime +30 -delete
