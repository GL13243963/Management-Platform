#!/usr/bin/env bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo '请用 sudo bash 运行。' >&2; exit 1; }

root=/opt/innovation-center
state=/var/backups/innovation-center/expense-fill-update
site=/etc/nginx/sites-available/innovation-center
socket=/run/expense-assistant-pilot/worker.sock
scope=expense-pilot-worker.scope
worker_home="$(getent passwd ubuntu | cut -d: -f6)"
worker_uid="$(id -u ubuntu)"
bundle="$(cd "$(dirname "$0")" && pwd)"
original="$(readlink -f "$root/current")"
diagnostics=false
if [[ ${1:-} == diagnostics || ${1:-} == rollback-diagnostics ]]; then
  diagnostics=true
  state=/var/backups/innovation-center/expense-fill-diagnostics
elif [[ ${1:-} == portal-details || ${1:-} == rollback-portal-details ]]; then
  diagnostics=true
  state=/var/backups/innovation-center/expense-fill-portal-details
elif [[ ${1:-} == validation || ${1:-} == rollback-validation ]]; then
  diagnostics=true
  state=/var/backups/innovation-center/expense-fill-validation
elif [[ ${1:-} == auto-save || ${1:-} == rollback-auto-save ]]; then
  diagnostics=true
  state=/var/backups/innovation-center/expense-fill-auto-save
elif [[ ${1:-} == first-release || ${1:-} == rollback-first-release ]]; then
  diagnostics=true
  state=/var/backups/innovation-center/expense-fill-first-release
fi

as_worker() {
  runuser -u ubuntu -- env XDG_RUNTIME_DIR="/run/user/$worker_uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$worker_uid/bus" "$@"
}

start_worker() {
  local release="$1" runtime
  runtime="$(cat "$state/node-bin")" || return 1
  as_worker nohup systemd-run --user --scope --unit="$scope" \
    env EXPENSE_WORKER_SOCKET="$socket" EXPENSE_CHROMIUM_PATH=/snap/bin/chromium \
    TMPDIR="$worker_home/expense-assistant-browser-test" \
    NODE_PATH="$worker_home/expense-assistant-browser-test/cloud-probe/node_modules" \
    "$runtime" "$release/backend/expense-assistant/cloud-probe/desktop-worker.mjs" \
    >>"$state/worker.log" 2>&1 </dev/null &
  for _ in {1..25}; do
    [[ ! -S "$socket" ]] || return 0
    sleep 1
  done
  return 1
}

stop_worker() {
  if as_worker systemctl --user is-active --quiet "$scope"; then
    as_worker systemctl --user stop "$scope" || return 1
  fi
  rm -f -- "$socket"
}

rollback() {
  trap - ERR
  set +e
  local previous failed=0
  previous="$(cat "$state/original-release")" || return 1
  if [[ -f "$state/os-changed" ]]; then
    ln -sfnT -- "$previous" "$root/current" && systemctl restart innovation-center || failed=1
  fi
  if [[ -f "$state/nginx-changed" ]]; then
    cp -p -- "$state/nginx.conf" "$site" && nginx -t && systemctl reload nginx || failed=1
  fi
  if [[ -f "$state/worker-changed" ]]; then
    stop_worker && start_worker "$previous" || failed=1
  fi
  if (( failed == 0 )); then
    mv -- "$state" "$state-rolled-back-$(date +%s)"
    echo '已恢复原登录试点。'
  else
    echo "回滚有失败项，诊断保留在 $state。" >&2
  fi
  return "$failed"
}

case "${1:-}" in
  rollback|rollback-diagnostics|rollback-portal-details|rollback-validation|rollback-auto-save|rollback-first-release) rollback; exit $? ;;
esac
[[ ! -e "$state" ]]
if "$diagnostics"; then
  [[ "$original" == "$root/releases/expense-fill-"* ]]
else
  [[ "$original" == "$root/releases/expense-pilot-"* ]]
fi
test -d "$(dirname "$socket")"
test -f "$bundle/dist-fill/index.html"
test -f "$original/backend/expense-assistant/configure-pilot.cjs"
if [[ -n "$(ss -H -ltn '( sport = :15911 or sport = :16081 )')" ]]; then
  echo '还有登录窗口在使用。请等当前会话结束后重试。' >&2
  exit 1
fi
node_bin="$(readlink -f "/proc/$(systemctl show innovation-center -p MainPID --value)/exe")"
test -x "$node_bin"
nginx -t
release="$root/releases/expense-fill-$(date +%Y%m%d%H%M%S)"
test ! -e "$release"
install -d -m 0700 "$state"
printf '%s\n' "$original" >"$state/original-release"
printf '%s\n' "$node_bin" >"$state/node-bin"
cp -p -- "$site" "$state/nginx.conf"
trap 'status=$?; echo "填报试点发布失败，开始回滚。" >&2; rollback || true; exit "$status"' ERR

cp -a --reflink=auto -- "$original" "$release"
module="$release/backend/expense-assistant"
for file in configure-pilot.cjs mount-login.cjs login-sessions.cjs login-viewer.cjs worker-client.cjs expense-task.cjs pilot-records.cjs; do
  install -m 0644 "$bundle/$file" "$module/$file"
  "$node_bin" --check "$module/$file"
done
for file in check-login.mjs open-desktop.mjs desktop-worker.mjs material-staging.mjs traffic-bundle.mjs; do
  install -m 0644 "$bundle/cloud-probe/$file" "$module/cloud-probe/$file"
  "$node_bin" --check "$module/cloud-probe/$file"
done
cp -a -- "$bundle/dist-fill/." "$module/dist/"
install -d -m 0700 -o innovation-center -g innovation-center \
  /var/lib/innovation-center/expense-assistant /var/log/innovation-center/expense-assistant

if ! "$diagnostics"; then
python3 - "$site" "$state/nginx.next" <<'PY'
import sys
from pathlib import Path
source, target = map(Path, sys.argv[1:])
text = source.read_text()
anchor = "    location ^~ /apps/expense-assistant/login/ {"
if text.count(anchor) != 1 or "/login-sessions/" in text:
    raise SystemExit("试点 Nginx 配置与预期不符，已停止。")
target.write_text(text.replace(anchor, """    location ~ ^/api/os/v1/expense-assistant/login-sessions/[a-f0-9-]+/save$ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 130s;
    }

""" + anchor))
PY
fi
touch "$state/worker-changed"
if [[ ! -S /run/user/$worker_uid/bus ]]; then systemctl start "user@$worker_uid.service"; fi
stop_worker
start_worker "$release"
id="$(cat /proc/sys/kernel/random/uuid)"
runuser -u innovation-center -- curl -fsS --max-time 60 --unix-socket "$socket" -X POST "http://localhost/desktop/$id"
runuser -u innovation-center -- curl -fsS --max-time 20 --unix-socket "$socket" -X DELETE "http://localhost/desktop/$id"
echo

if ! "$diagnostics"; then
  touch "$state/nginx-changed"
  install -m 0644 "$state/nginx.next" "$site"
  nginx -t
fi
touch "$state/os-changed"
ln -sfnT -- "$release" "$root/current"
systemctl restart innovation-center
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:3001/api/health
echo
if ! "$diagnostics"; then systemctl reload nginx; fi
code="$(curl -sS --resolve cxzx100.top:443:127.0.0.1 -o /dev/null -w '%{http_code}' \
  https://cxzx100.top/apps/expense-assistant/)"
[[ "$code" == 401 ]]
trap - ERR
echo '自动填报试点已发布。'
