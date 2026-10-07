#!/usr/bin/env bash
# 更新后生效：重启后端（会清空进行中的房间），同步并重载 nginx 站点配置
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
systemctl --user restart hunao-sports.service
sudo install -m 644 -o root -g root "$DIR/deploy/hunao-sports.nginx.conf" /etc/nginx/sites-available/hunao-sports.conf
sudo local-nginx-sites reload
chmod 644 "$DIR"/public/* && chmod 755 "$DIR/public"
sleep 1
curl -fsS http://127.0.0.1:18160/healthz && echo && echo "已重载"
