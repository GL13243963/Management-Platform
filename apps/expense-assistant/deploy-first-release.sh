#!/usr/bin/env bash
set -euo pipefail
bundle="$(cd "$(dirname "$0")" && pwd)"
if [[ ${1:-} == rollback ]]; then
  bash "$bundle/deploy-home-entry.sh" rollback
  bash "$bundle/deploy-fill-update.sh" rollback-first-release
  exit
fi
bash "$bundle/deploy-home-entry.sh" check
bash "$bundle/deploy-fill-update.sh" first-release
if ! bash "$bundle/deploy-home-entry.sh"; then
  bash "$bundle/deploy-fill-update.sh" rollback-first-release
  exit 1
fi
echo '填单助手测试版已从 OS 首页开放。'
