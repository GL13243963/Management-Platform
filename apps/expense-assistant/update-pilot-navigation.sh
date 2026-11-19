#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]]
bundle="$(cd "$(dirname "$0")" && pwd)"
release="$(readlink -f /opt/innovation-center/current)"
[[ "$release" == /opt/innovation-center/releases/expense-pilot-* ]]
module="$release/backend/expense-assistant"
state=/var/backups/innovation-center/expense-pilot
socket=/run/expense-assistant-pilot/worker.sock
scope=expense-pilot-worker.scope
worker_home="$(getent passwd ubuntu | cut -d: -f6)"
worker_uid="$(id -u ubuntu)"
node_bin="$(readlink -f "/proc/$(systemctl show innovation-center -p MainPID --value)/exe")"
test -d "$state"
test -x "$node_bin"
"$node_bin" --check "$bundle/cloud-probe/check-login.mjs"
test -f "$bundle/dist-pilot/index.html"
test -f "$module/cloud-probe/check-login.mjs"

as_worker() {
  runuser -u ubuntu -- env XDG_RUNTIME_DIR="/run/user/$worker_uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$worker_uid/bus" "$@"
}

start_worker() {
  as_worker nohup systemd-run --user --scope --unit="$scope" \
    env EXPENSE_WORKER_SOCKET="$socket" EXPENSE_CHROMIUM_PATH=/snap/bin/chromium \
    TMPDIR="$worker_home/expense-assistant-browser-test" \
    NODE_PATH="$worker_home/expense-assistant-browser-test/cloud-probe/node_modules" \
    "$node_bin" "$module/cloud-probe/desktop-worker.mjs" >>"$backup/worker.log" 2>&1 </dev/null &
  for _ in {1..20}; do
    if [[ -S "$socket" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

if [[ -n "$(ss -H -ltn '( sport = :15911 or sport = :16081 )')" ]]; then
  echo '还有登录窗口在使用。请等当前会话结束后重试。' >&2
  exit 1
fi

backup="$(mktemp -d "$state/navigation.XXXXXX")"
cp -p -- "$module/cloud-probe/check-login.mjs" "$backup/check-login.mjs"
cp -p -- "$module/dist/index.html" "$backup/index.html"

restore() {
  local result=$?
  trap - ERR
  set +e
  as_worker systemctl --user stop "$scope"
  rm -f -- "$socket"
  cp -p -- "$backup/check-login.mjs" "$module/cloud-probe/check-login.mjs"
  cp -p -- "$backup/index.html" "$module/dist/index.html"
  start_worker
  echo "更新失败。已尝试恢复旧版，诊断保留在 $backup" >&2
  exit "$result"
}
trap restore ERR
as_worker systemctl --user stop "$scope"
rm -f -- "$socket"
install -m 0644 "$bundle/cloud-probe/check-login.mjs" "$module/cloud-probe/check-login.mjs"
start_worker
id="$(cat /proc/sys/kernel/random/uuid)"
runuser -u innovation-center -- curl -fsS --max-time 60 --unix-socket "$socket" -X POST "http://localhost/desktop/$id"
runuser -u innovation-center -- curl -fsS --max-time 20 --unix-socket "$socket" -X DELETE "http://localhost/desktop/$id"
cp -a -- "$bundle/dist-pilot/assets/." "$module/dist/assets/"
install -m 0644 "$bundle/dist-pilot/index.html" "$module/dist/index.html.next"
mv -f -- "$module/dist/index.html.next" "$module/dist/index.html"
trap - ERR
echo
echo '扫码后自动打开报销单的试点更新已发布。'
