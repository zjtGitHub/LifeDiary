#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 || ( "$1" != init && "$1" != reset ) || -z "${LIFEDIARY_DATA_DIR:-}" ]]; then
    echo '用法：设置 LIFEDIARY_DATA_DIR 后运行 bash scripts/private-owner.sh init|reset ACCOUNT' >&2
    exit 2
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
read -rsp "账号密码（至少 16 个字符）: " password </dev/tty
printf '\n'
read -rsp "确认账号密码: " confirmation </dev/tty
printf '\n'
[[ "$password" == "$confirmation" ]] || { echo "两次密码不一致。" >&2; exit 2; }
printf '%s' "$password" | node "$repo/server/owner.mjs" "$@"
