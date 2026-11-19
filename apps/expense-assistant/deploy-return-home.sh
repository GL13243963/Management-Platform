#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请用 sudo bash 运行。' >&2; exit 1; }
bundle="$(cd "$(dirname "$0")" && pwd)"
release="$(readlink -f /opt/innovation-center/current)"
[[ "$release" == /opt/innovation-center/releases/expense-fill-* ]]
dist="$release/backend/expense-assistant/dist"
home="$release/frontend/dist"
state=/var/backups/innovation-center/expense-page-update
if [[ ${1:-} == guide || ${1:-} == rollback-guide ]]; then
  state=/var/backups/innovation-center/expense-guide-update
fi
has_home=false
if [[ -f "$bundle/home-overlay/index.html" ]]; then has_home=true; fi

replace_index() {
  local source="$1" target="$2"
  install -m 0644 "$source" "$target/.expense-index.next"
  mv -fT -- "$target/.expense-index.next" "$target/index.html"
}

if [[ ${1:-} == rollback || ${1:-} == rollback-guide ]]; then
  test "$(cat "$state/release")" = "$release"
  if [[ -f "$state/home.html" ]]; then replace_index "$state/home.html" "$home"; fi
  replace_index "$state/index.html" "$dist"
  mv -- "$state" "$state-rolled-back-$(date +%s)"
  echo '已恢复更新前的首页卡片和填单助手页面。'
  exit
fi

test ! -e "$state"
(cd "$dist" && sha256sum -c "$bundle/base-index.sha256")
if "$has_home"; then (cd "$home" && sha256sum -c "$bundle/home-base-index.sha256"); fi
copy_assets() {
  local source="$1" target="$2" mode="$3" asset dest
  for asset in "$source"/assets/*; do
    test -f "$asset"
    dest="$target/assets/${asset##*/}"
    if [[ -e "$dest" ]]; then
      cmp -s -- "$asset" "$dest"
    elif [[ "$mode" == install ]]; then
      install -m 0644 "$asset" "$dest"
    fi
  done
}
copy_assets "$bundle/overlay" "$dist" check
if "$has_home"; then copy_assets "$bundle/home-overlay" "$home" check; fi
install -d -m 0700 "$state"
printf '%s\n' "$release" >"$state/release"
cp -p -- "$dist/index.html" "$state/index.html"
if "$has_home"; then cp -p -- "$home/index.html" "$state/home.html"; fi
copy_assets "$bundle/overlay" "$dist" install
if "$has_home"; then copy_assets "$bundle/home-overlay" "$home" install; fi
trap 'status=$?; replace_index "$state/index.html" "$dist"; if "$has_home"; then replace_index "$state/home.html" "$home"; fi; exit "$status"' ERR
replace_index "$bundle/overlay/index.html" "$dist"
if "$has_home"; then replace_index "$bundle/home-overlay/index.html" "$home"; fi
trap - ERR
echo '填单助手页面更新已发布。'
