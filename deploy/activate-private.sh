#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
account=${1:-owner}
export PATH=/opt/lifediary/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin
data_dir=/var/lib/lifediary-vault
source_dir=/opt/lifediary/current
runtime=/opt/lifediary/runtime/bin/node
test -x "$runtime"
owner_status=0
sudo -u lifediary env LIFEDIARY_DATA_DIR="$data_dir" "$runtime" --input-type=module -e '
    import { existsSync } from "node:fs";
    import { DatabaseSync } from "node:sqlite";
    const file=process.env.LIFEDIARY_DATA_DIR+"/lifediary.sqlite";
    if (!existsSync(file)) process.exit(10);
    const db=new DatabaseSync(file,{readOnly:true});
    try {
        if (!db.prepare("SELECT 1 FROM owner").get()) process.exitCode=10;
    } finally { db.close(); }
' || owner_status=$?
case "$owner_status" in
    0|10) ;;
    *) echo "无法读取账号数据库，已停止启用。请查看上面的错误。" >&2; exit 1 ;;
esac
if [[ "${2:-}" == --check-owner ]]; then
    if [[ "$owner_status" == 0 ]]; then echo "已有账号，账号检测通过。"; else echo "需要初始化账号。"; fi
    exit 0
fi
if [[ "${2:-}" == --reset-auth ]]; then
    [[ "$owner_status" == 0 ]] || { echo "账号尚未创建，请使用初始化流程。" >&2; exit 1; }
    sudo -u lifediary env PATH="$PATH" LIFEDIARY_DATA_DIR="$data_dir" bash "$source_dir/scripts/private-owner.sh" reset "$account"
elif [[ "$owner_status" == 10 ]]; then
    sudo -u lifediary env PATH="$PATH" LIFEDIARY_DATA_DIR="$data_dir" bash "$source_dir/scripts/private-owner.sh" init "$account"
fi
printf '\n请先将上面的密钥添加到自己的验证器中。\n'
read -rp "添加完成后按回车启用网站，或按 Ctrl-C 稍后继续: " _ </dev/tty
web_release=$(cat /opt/lifediary/web-release)
test -s "$web_release/index.html"
test -s /opt/lifediary/nginx-private.conf
backup=$(mktemp -d /var/backups/lifediary-private-activation.XXXXXXXX)
cp -a /etc/nginx/sites-available/lifediary "$backup/nginx-lifediary"
readlink /var/www/lifediary/current > "$backup/previous-web"
rollback() {
    cp -a "$backup/nginx-lifediary" /etc/nginx/sites-available/lifediary
    ln -s "$(cat "$backup/previous-web")" /var/www/lifediary/.rollback-private
    mv -Tf /var/www/lifediary/.rollback-private /var/www/lifediary/current
    nginx -t && systemctl reload nginx
    systemctl stop lifediary-vault.service
}
trap rollback EXIT
systemctl enable --now lifediary-vault.service
ready=false
for attempt in {1..12}; do
    if curl -fsS --max-time 3 http://127.0.0.1:8787/api/vault/session | grep -q '"authenticated":false'; then ready=true; break; fi
    sleep 1
done
"$ready"
install -m 644 /opt/lifediary/nginx-private.conf /etc/nginx/sites-available/lifediary
nginx -t
ln -s "$web_release" /var/www/lifediary/.activate-private
mv -Tf /var/www/lifediary/.activate-private /var/www/lifediary/current
systemctl reload nginx
verified=false
for attempt in {1..10}; do
    if curl -fsS --max-time 5 --resolve 129.211.50.155:8080:127.0.0.1 https://129.211.50.155:8080/api/vault/session | grep -q '"authenticated":false'; then verified=true; break; fi
    sleep 1
done
"$verified"
expected=$(sha256sum < "$web_release/index.html")
actual=$(curl -fsS --max-time 10 --resolve 129.211.50.155:8080:127.0.0.1 https://129.211.50.155:8080/ | sha256sum)
test "$expected" = "$actual"
trap - EXIT
printf '\n私有模式已启用：https://129.211.50.155:8080/\n回滚配置备份：%s\n' "$backup"
