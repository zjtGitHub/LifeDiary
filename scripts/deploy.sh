#!/usr/bin/env bash
set -eo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

case "${1:-}" in
  ""|--publish-only) ;;
  *) echo "用法：bash scripts/deploy.sh [--publish-only]" >&2; exit 1 ;;
esac
sudo true
exec 9>"$(git rev-parse --git-dir)/lifediary-deploy.lock"
flock -n 9 || { echo "另一个部署正在运行。" >&2; exit 1; }

if [[ "${1:-}" != --publish-only ]]; then
  # Non-interactive SSH shells do not normally load nvm.
  if ! command -v node >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    . "$HOME/.nvm/nvm.sh"
  fi
  npm ci --no-audit --no-fund
  npm run build
fi
set -u
test -s dist/index.html

site_dir=/var/www/lifediary
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)-$$"
release_dir="$site_dir/releases/$release_id"

if sudo test -e "$site_dir/current" && ! sudo test -L "$site_dir/current"; then
  echo "$site_dir/current 必须是符号链接，已停止部署。" >&2
  exit 1
fi

sudo install -d -m 755 "$release_dir"
sudo cp -R dist/. "$release_dir/"
sudo chmod -R a+rX "$release_dir"

if sudo test -L "$site_dir/current"; then
  previous_target="$(sudo readlink "$site_dir/current")"
  sudo ln -s "$previous_target" "$site_dir/.previous-$release_id"
  sudo mv -Tf "$site_dir/.previous-$release_id" "$site_dir/previous"
fi
sudo ln -s "$release_dir" "$site_dir/.current-$release_id"
sudo mv -Tf "$site_dir/.current-$release_id" "$site_dir/current"
printf '已发布：%s\n访问：http://129.211.50.155:8080\n' "$release_dir"
