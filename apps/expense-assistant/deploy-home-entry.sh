#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请用 sudo bash 运行。' >&2; exit 1; }
bundle="$(cd "$(dirname "$0")" && pwd)"
release="$(readlink -f /opt/innovation-center/current)"
[[ "$release" == /opt/innovation-center/releases/expense-fill-* ]]
dist="$release/frontend/dist"
state=/var/backups/innovation-center/expense-home-entry
index="$dist/index.html"

replace_index() {
  install -m 0644 "$1" "$dist/.expense-home-index.next"
  mv -fT -- "$dist/.expense-home-index.next" "$index"
}

if [[ ${1:-} == rollback ]]; then
  test "$(cat "$state/release")" = "$release"
  replace_index "$state/index.html"
  mv -- "$state" "$state-rolled-back-$(date +%s)"
  echo '已恢复原首页入口。'
  exit
fi
test ! -e "$state"
if ! (cd "$dist" && sha256sum -c "$bundle/base-index.sha256"); then
  echo '当前 OS 首页与已验证版本不符，未改动生产文件。' >&2
  exit 1
fi
code="$(curl -sS --resolve cxzx100.top:443:127.0.0.1 -o /dev/null -w '%{http_code}' \
  https://cxzx100.top/apps/expense-assistant/)"
[[ "$code" == 401 ]] || { echo '填单助手入口未通过发布前检查。' >&2; exit 1; }
for asset in "$bundle"/overlay/assets/*; do
  test -f "$asset"
  target="$dist/assets/${asset##*/}"
  if [[ -e "$target" ]]; then
    cmp -s -- "$asset" "$target" || { echo "首页资源名冲突：${asset##*/}" >&2; exit 1; }
  fi
done
if [[ ${1:-} == check ]]; then exit; fi
install -d -m 0700 "$state"
printf '%s\n' "$release" >"$state/release"
cp -p -- "$index" "$state/index.html"
for asset in "$bundle"/overlay/assets/*; do
  target="$dist/assets/${asset##*/}"
  if [[ ! -e "$target" ]]; then install -m 0644 "$asset" "$target"; fi
done
replace_index "$bundle/overlay/index.html"
if ! cmp -s "$index" "$bundle/overlay/index.html"; then
  replace_index "$state/index.html"
  echo '首页校验失败，已恢复旧入口。' >&2
  exit 1
fi
echo '首页第 2 张卡片已接入填单助手。'
