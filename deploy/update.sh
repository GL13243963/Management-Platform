#!/usr/bin/env bash
set -euo pipefail

update_dir=/var/lib/innovation-center/updates
incoming="${update_dir}/incoming.zip"
status="${update_dir}/status.json"
archive_dir="${update_dir}/archive"
work_dir="$(mktemp -d /var/lib/innovation-center/update-work.XXXXXX)"

write_status() {
  local state="$1" message="$2" target="${3:-}"
  printf '{"state":"%s","message":"%s","targetVersion":"%s","updatedAt":"%s"}\n' \
    "$state" "$message" "$target" "$(date --iso-8601=seconds)" > "${status}.tmp"
  chown innovation-center:innovation-center "${status}.tmp"
  chmod 0640 "${status}.tmp"
  mv -f "${status}.tmp" "$status"
}

cleanup() { rm -rf -- "$work_dir"; }
fail() {
  local code=$?
  write_status failed "更新失败，服务器已保留原版本；请联系管理员查看日志" "${target_version:-}"
  cleanup
  exit "$code"
}
trap fail ERR

sleep 2
write_status validating "正在校验更新包"
test -f "$incoming"
unzip -tqq "$incoming"
entry_count="$(unzip -Z1 "$incoming" | wc -l)"
uncompressed_bytes="$(unzip -l "$incoming" | awk 'END {print $1}')"
if [[ "$entry_count" -gt 5000 || "$uncompressed_bytes" -gt 314572800 ]]; then
  echo "更新包解压规模超过安全限制" >&2
  exit 1
fi
if unzip -Z1 "$incoming" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "更新包包含不安全路径" >&2
  exit 1
fi
if zipinfo -l "$incoming" | grep -Eq '^l'; then
  echo "更新包不能包含符号链接" >&2
  exit 1
fi
unzip -q "$incoming" -d "$work_dir"
test -f "$work_dir/VERSION"
test -f "$work_dir/deploy/install.sh"
test -f "$work_dir/backend/package.json"
test -f "$work_dir/frontend/dist/index.html"
target_version="$(tr -cd 'A-Za-z0-9._-' < "$work_dir/VERSION")"
test -n "$target_version"

mkdir -p "$archive_dir"
/usr/local/sbin/innovation-center-backup
write_status installing "备份完成，正在安装新版本" "$target_version"
bash "$work_dir/deploy/install.sh"
mv -f "$incoming" "$archive_dir/innovation-center-${target_version}-$(date +%Y%m%d%H%M%S).zip"
write_status success "系统更新完成" "$target_version"
cleanup
trap - ERR
