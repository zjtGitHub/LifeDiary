#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 1 ]]; then
    echo "用法：sudo /opt/lifediary/rename-account 新账号名" >&2
    exit 2
fi
exec sudo -u lifediary env LIFEDIARY_DATA_DIR=/var/lib/lifediary-vault \
    /opt/lifediary/runtime/bin/node /opt/lifediary/current/server/owner.mjs rename "$1"
