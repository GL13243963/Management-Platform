#!/usr/bin/env bash
set -euo pipefail

[[ $EUID == 0 ]] || { echo '请用 sudo bash 运行。' >&2; exit 1; }
root=/opt/innovation-center
state=/var/backups/innovation-center/expense-pilot
nginx_site=/etc/nginx/sites-available/innovation-center
dropin=/etc/systemd/system/innovation-center.service.d/60-expense-pilot.conf
socket_dir=/run/expense-assistant-pilot
worker_scope=expense-pilot-worker.scope
worker_home="$(getent passwd ubuntu | cut -d: -f6)"
worker_uid="$(id -u ubuntu)"
probe="$worker_home/expense-assistant-browser-test/cloud-probe"
origin=https://cxzx100.top
bundle="$(cd "$(dirname "$0")" && pwd)"

as_worker() {
  runuser -u ubuntu -- env XDG_RUNTIME_DIR="/run/user/$worker_uid" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$worker_uid/bus" "$@"
}

rollback() {
  [[ -f "$state/original-release" ]] || return 0
  set +e
  local failed=0 original
  original="$(cat "$state/original-release")"
  if [[ -e "$state/os-changed" ]]; then
    rm -f -- "$dropin" || failed=1
    ln -sfnT -- "$original" "$root/current" || failed=1
    systemctl daemon-reload && systemctl restart innovation-center || failed=1
  fi
  if [[ -e "$state/nginx-changed" ]]; then
    cp -p -- "$state/nginx.conf" "$nginx_site" || failed=1
    nginx -t && systemctl reload nginx || failed=1
  fi
  if [[ -e "$state/worker-started" ]]; then
    if as_worker systemctl --user is-active --quiet "$worker_scope"; then
      as_worker systemctl --user stop "$worker_scope" || failed=1
    fi
  fi
  if (( failed == 0 )); then
    rm -f -- "$socket_dir/worker.sock"
    rmdir -- "$socket_dir" 2>/dev/null || true
    mv -- "$state" "$state-rolled-back-$(date +%s)"
    echo '已回滚登录试点。'
  else
    echo "回滚有失败项，备份保留在 $state" >&2
  fi
  return "$failed"
}

if [[ ${1:-} == rollback ]]; then rollback; exit $?; fi
[[ ! -e "$state" && ! -e "$socket_dir" && ! -e "$dropin" ]]
node_bin="$(readlink -f "/proc/$(systemctl show innovation-center -p MainPID --value)/exe")"
test -x "$node_bin"
test -x /snap/bin/chromium
test -f /usr/share/novnc/vnc.html
test -f "$probe/node_modules/playwright-core/package.json"
test -f "$bundle/dist-pilot/index.html"
original="$(readlink -f "$root/current")"
[[ "$original" == "$root/releases/"* && -f "$original/backend/src/index.js" ]]
test -f "$nginx_site"
nginx -t
release="$root/releases/expense-pilot-$(date +%Y%m%d%H%M%S)"
test ! -e "$release"
install -d -m 0700 "$state"
printf '%s\n' "$original" > "$state/original-release"
cp -p -- "$nginx_site" "$state/nginx.conf"
trap 'status=$?; echo "试点发布失败，开始回滚。" >&2; rollback || true; exit "$status"' ERR

cp -a --reflink=auto -- "$original" "$release"
module="$release/backend/expense-assistant"
install -d -m 0755 "$module/dist" "$module/cloud-probe"
for file in configure-pilot.cjs mount-login.cjs login-sessions.cjs login-viewer.cjs worker-client.cjs; do
  install -m 0644 "$bundle/$file" "$module/$file"
done
for file in check-login.mjs open-desktop.mjs desktop-worker.mjs; do
  install -m 0644 "$bundle/cloud-probe/$file" "$module/cloud-probe/$file"
done
cp -a -- "$bundle/dist-pilot/." "$module/dist/"

python3 - "$release/backend/src/index.js" "$nginx_site" "$state/nginx.next" <<'PY'
import sys
from pathlib import Path

index, nginx, candidate = map(Path, sys.argv[1:])
code = index.read_text()
anchor = "app.use('/api', (err, req, res, next) => {"
listen = "  app.listen(PORT, '0.0.0.0', () => {"
end = "\n}\n\nmodule.exports = app;"
if any(code.count(item) != 1 for item in (anchor, listen, end)):
    raise SystemExit("生产 OS 入口版本与预期不符，已停止。")
code = code.replace(anchor, """const { configureExpensePilot } = require('../expense-assistant/configure-pilot.cjs');
const expensePilot = configureExpensePilot(app, { express, authenticate, requireChangedPassword });

""" + anchor)
code = code.replace(listen, listen.replace("app.listen", "const server = app.listen"))
code = code.replace(end, """
  if (expensePilot) {
    server.on('upgrade', (req, socket, head) => {
      if (!expensePilot.handleUpgrade(req, socket, head)) socket.destroy();
    });
  }""" + end)
index.write_text(code)

text = nginx.read_text()
marker = "    client_max_body_size 50m;"
if text.count(marker) != 1 or "listen 443 ssl" not in text or "server_name cxzx100.top" not in text:
    raise SystemExit("生产 Nginx HTTPS 配置与预期不符，已停止。")
candidate.write_text(text.replace(marker, marker + """

    location ^~ /apps/expense-assistant/login/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 330s;
    }"""))
PY
"$node_bin" --check "$release/backend/src/index.js"
install -d -m 2750 -o ubuntu -g innovation-center "$socket_dir"
if [[ ! -S /run/user/$worker_uid/bus ]]; then systemctl start "user@$worker_uid.service"; fi
touch "$state/worker-started"
as_worker nohup systemd-run --user --scope --unit="$worker_scope" \
  env EXPENSE_WORKER_SOCKET="$socket_dir/worker.sock" EXPENSE_CHROMIUM_PATH=/snap/bin/chromium \
  TMPDIR="$worker_home/expense-assistant-browser-test" NODE_PATH="$probe/node_modules" \
  "$node_bin" "$module/cloud-probe/desktop-worker.mjs" >"$state/worker.log" 2>&1 </dev/null &
for _ in {1..30}; do
  if [[ -S "$socket_dir/worker.sock" ]]; then break; fi
  sleep 1
done
socket="$socket_dir/worker.sock"
test -S "$socket"
id="$(cat /proc/sys/kernel/random/uuid)"
runuser -u innovation-center -- curl -fsS --max-time 60 --unix-socket "$socket" -X POST "http://localhost/desktop/$id"
runuser -u innovation-center -- curl -fsS --max-time 15 --unix-socket "$socket" -X DELETE "http://localhost/desktop/$id"
echo
echo '通过：OS 服务账号可以启动和回收云端浏览器。'

touch "$state/nginx-changed"
install -m 0644 "$state/nginx.next" "$nginx_site"
nginx -t
touch "$state/os-changed"
install -d -m 0755 "$(dirname "$dropin")"
printf '[Service]\nEnvironment=EXPENSE_PILOT_ENABLED=true\nEnvironment=EXPENSE_PILOT_ORIGIN=%s\nEnvironment=EXPENSE_WORKER_SOCKET=%s\n' \
  "$origin" "$socket" > "$dropin"
ln -sfnT -- "$release" "$root/current"
systemctl daemon-reload
systemctl restart innovation-center
curl -fsS --retry 10 --retry-connrefused --retry-delay 1 --max-time 3 http://127.0.0.1:3001/api/health
echo
systemctl reload nginx
code="$(curl -sS --resolve cxzx100.top:443:127.0.0.1 -o /dev/null -w '%{http_code}' "$origin/apps/expense-assistant/")"
[[ "$code" == 401 ]]
trap - ERR
echo "登录试点已发布：$origin/apps/expense-assistant/"
