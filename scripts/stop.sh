#!/usr/bin/env bash
# 停止胡闹运动会：只停用本站点的 nginx 配置并停后端，不影响其他站点
set -euo pipefail
sudo local-nginx-sites disable hunao-sports || true
systemctl --user stop hunao-sports.service
echo "已停止 hunao-sports"
