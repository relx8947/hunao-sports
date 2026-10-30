#!/usr/bin/env bash
# 启动胡闹运动会：用户级后端服务 + 启用中央 nginx 站点
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -m 644 "$DIR/deploy/hunao-sports.service" "$HOME/.config/systemd/user/hunao-sports.service"
systemctl --user daemon-reload
systemctl --user enable --now hunao-sports.service
sudo install -m 644 -o root -g root "$DIR/deploy/hunao-sports.nginx.conf" /etc/nginx/sites-available/hunao-sports.conf
if local-nginx-sites list | grep -q '^hunao-sports[[:space:]]enabled'; then sudo local-nginx-sites reload; else sudo local-nginx-sites enable hunao-sports; fi
sleep 1
curl -fsS http://127.0.0.1:18160/healthz && echo && echo "已启动：http://$(hostname -f):18160/"
