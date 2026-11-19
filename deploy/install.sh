#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo bash deploy/install.sh 运行"
  exit 1
fi

package_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(tr -cd 'A-Za-z0-9._-' < "${package_root}/VERSION")"
release_dir="/opt/innovation-center/releases/${version}"

if [[ -z "$version" ]]; then
  echo "VERSION 文件无效"
  exit 1
fi

if ! id innovation-center >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/innovation-center --shell /usr/sbin/nologin innovation-center
fi

install -d -m 0755 /opt/innovation-center/releases
install -d -m 0750 -o innovation-center -g innovation-center /var/lib/innovation-center
install -d -m 0750 -o innovation-center -g innovation-center /var/lib/innovation-center/updates
install -d -m 0750 -o innovation-center -g innovation-center /var/lib/innovation-center/uploads/render-gallery
install -d -m 0750 -o innovation-center -g innovation-center /var/lib/innovation-center/uploads/tool-matrix
install -d -m 0755 /var/cache/innovation-center-npm
install -d -m 0700 /var/backups/innovation-center
install -d -m 0755 "$release_dir"
install -d -m 0755 "${release_dir}/backend" "${release_dir}/frontend/dist"
cp -a "${package_root}/backend/." "${release_dir}/backend/"
cp -a "${package_root}/frontend/dist/." "${release_dir}/frontend/dist/"
install -m 0644 "${package_root}/VERSION" "${release_dir}/VERSION"
mkdir -p "${release_dir}/backend/uploads"

cd "${release_dir}/backend"
export HOME=/var/lib/innovation-center
export npm_config_cache=/var/cache/innovation-center-npm
npm ci --omit=dev
chown -R innovation-center:innovation-center "$release_dir"

if [[ ! -f /var/lib/innovation-center/app.db ]]; then
  install -m 0640 -o innovation-center -g innovation-center "${package_root}/data/app.production.db" /var/lib/innovation-center/app.db
fi

ln -sfn "$release_dir" /opt/innovation-center/current

if [[ ! -f /etc/innovation-center.env ]]; then
  cat > /etc/innovation-center.env <<'EOF'
NODE_ENV=production
PORT=3001
APP_DB_PATH=/var/lib/innovation-center/app.db
COOKIE_SECURE=false
TZ=Asia/Shanghai
EOF
  chmod 0640 /etc/innovation-center.env
fi

install -m 0644 "${package_root}/deploy/innovation-center.service" /etc/systemd/system/innovation-center.service
if [[ -f /etc/letsencrypt/live/cxzx100.top/fullchain.pem && -f /etc/letsencrypt/live/cxzx100.top/privkey.pem ]]; then
  install -m 0644 "${package_root}/deploy/nginx-site-https.conf" /etc/nginx/sites-available/innovation-center
else
  install -m 0644 "${package_root}/deploy/nginx-site.conf" /etc/nginx/sites-available/innovation-center
fi
ln -sfn /etc/nginx/sites-available/innovation-center /etc/nginx/sites-enabled/innovation-center
rm -f /etc/nginx/sites-enabled/default
install -m 0750 "${package_root}/deploy/backup.sh" /usr/local/sbin/innovation-center-backup
install -m 0750 "${package_root}/deploy/update.sh" /usr/local/sbin/.innovation-center-update.new
mv -f /usr/local/sbin/.innovation-center-update.new /usr/local/sbin/innovation-center-update
install -m 0644 "${package_root}/deploy/innovation-center-update.service" /etc/systemd/system/innovation-center-update.service
cat > /etc/sudoers.d/innovation-center-update <<'EOF'
innovation-center ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block innovation-center-update.service
EOF
chmod 0440 /etc/sudoers.d/innovation-center-update
visudo -cf /etc/sudoers.d/innovation-center-update
cat > /etc/cron.d/innovation-center-backup <<'EOF'
17 2 * * * root /usr/local/sbin/innovation-center-backup >/var/log/innovation-center-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/innovation-center-backup

nginx -t
systemctl daemon-reload
systemctl enable innovation-center
systemctl restart innovation-center
systemctl restart nginx
sleep 2
curl --fail --silent http://127.0.0.1:3001/api/health
echo
echo "安装完成：${version}"
