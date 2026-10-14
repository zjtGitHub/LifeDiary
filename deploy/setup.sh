#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"
available=/etc/nginx/sites-available/lifediary
enabled=/etc/nginx/sites-enabled/lifediary

if [[ -e "$available" || -L "$available" || -e "$enabled" || -L "$enabled" ]]; then
  echo "LifeDiary 的 Nginx 配置已存在，请按部署文档更新。" >&2
  exit 1
fi

sudo true
sudo nginx -t
bash scripts/deploy.sh --publish-only
sudo install -m 644 deploy/nginx.conf "$available"
sudo ln -s "$available" "$enabled"
if ! sudo nginx -t; then
  sudo unlink "$enabled"
  echo "Nginx 检查失败，已取消启用新站点。" >&2
  exit 1
fi
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:8080/ >/dev/null
echo "LifeDiary 已启用：http://129.211.50.155:8080"
