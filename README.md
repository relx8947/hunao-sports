# 胡闹运动会（线上版）

桌游《胡闹运动会》（Magical Athlete）的多人实时网页版：2 轮蛇形选秀组队，4 场赛跑，36 名技能各异的运动员互相使坏。房间码联机、AI 补位、断线自动托管，手机竖屏自动切换方格赛道。

当前是可玩的联机试玩版，按 3-6 名选手（含 AI）开赛。两位真人玩家可以加 1 名 AI；实体版的双人双运动员变体尚未实现。狂野赛道布局和递增计分采用本试玩版设置，具体差异见文末。

## 访问

**http://dev-host:18160/**

## 部署（本机统一 nginx）

接入本机系统 nginx 的统一站点管理（见 `/home/dev/project/site/NGINX-MANAGEMENT.md`）：

```
浏览器 ──► nginx :18160（站点 hunao-sports）
             ├─ /              静态托管 public/（Cache-Control: no-cache，改前端刷新即生效）
             ├─ /ws            WebSocket 反代 ─┐
             ├─ /racers-data.js                ├─► Node 127.0.0.1:18161（用户级 hunao-sports.service）
             └─ /healthz                      ─┘
```

| 文件 | 部署位置 |
| --- | --- |
| `deploy/hunao-sports.nginx.conf` | `/etc/nginx/sites-available/hunao-sports.conf`，登记在 `/etc/nginx/local-sites.json` |
| `deploy/hunao-sports.service` | `~/.config/systemd/user/hunao-sports.service` |

常用命令（`scripts/start.sh` / `stop.sh` / `reload.sh` 已封装以下步骤，统一走 `local-nginx-sites`）：

```bash
systemctl --user restart hunao-sports      # 改了 game/ 或 server/ 后重启后端（房间在内存里，重启会清空）
systemctl --user status hunao-sports
journalctl --user -u hunao-sports -f
# 改了 nginx 配置：
sudo install -m 644 deploy/hunao-sports.nginx.conf /etc/nginx/sites-available/hunao-sports.conf
sudo local-nginx-sites reload
sudo local-nginx-sites disable hunao-sports   # 下线站点
```

只改 `public/` 下的前端文件时不用重启，浏览器刷新即可。注意本机 umask 是 077：`public/` 里**新建**的文件要 `chmod 644`，否则 nginx（www-data）读不到。

**挂到其他域名 / 子路径**：前端的静态资源和 WebSocket 都用相对路径，可以直接挂在任意 path 下。例如在别的 server 块里加：

```nginx
location = /hunao { return 301 /hunao/; }
location = /hunao/ws {
    proxy_pass http://127.0.0.1:18161/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
location = /hunao/racers-data.js { proxy_pass http://127.0.0.1:18161/racers-data.js; }
location /hunao/ {
    alias /home/dev/project/playgroud/hunao-sports/public/;
    try_files $uri $uri/ /hunao/index.html;
    add_header Cache-Control "no-cache";
}
```

## 本地开发

```bash
npm install
PORT=8096 npm start  # 直接用 Node 同时托管静态资源和 WebSocket，默认 0.0.0.0:8096
npm test             # 规则语义、1000 局模拟、房间生命周期、HTTP/WebSocket 回归
npx playwright install chromium  # 首次运行浏览器测试前安装
npm run test:frontend # 假 WebSocket 驱动的前端异常路径回归
npm run test:browser-helper # 真实握手、提交确认、重定向防护及资源清理
npm run test:browser  # 单人四场完赛，必须显示总冠军
npm run test:multi    # 桌面 + 手机联机、重连、横竖屏、四场同步与重开
npm run test:all      # 完整验收
```

零前端构建，服务端只依赖 `ws`，所有状态在内存里（重启服务会清空房间）。Playwright 仅为开发测试依赖。

浏览器测试默认启动 `127.0.0.1` 随机端口的隔离后端，不使用线上房间，结束后关闭连接与计时器。可用 `W` / `H` 设置单人测试尺寸，`OUT` 设置截图目录，`CHROMIUM_EXECUTABLE_PATH` 指定本机 Chromium 路径。只有明确要测试已有服务时才传 `BASE`；远端地址还需显式设置 `ALLOW_REMOTE=1`。整局验收默认使用 `SEED=9`，可指定其他非负 31 位整数复现不同规则组合；随机覆盖由 `test/sim.js` 单独承担。完整对局可能需要数分钟，`MAX_MS` 超时会判定失败，而不是打印未完成状态后返回成功。动作成功只按带 `gameId/id/value` 的服务端 `ack` 统计；比分按席位、姓名及四场完整成绩核对，不把超时托管完赛等同真人操作通过。

## 玩法流程

1. 首页输入昵称 → 「和 AI 开一局」（可选 2-5 个 AI 对手），或「创建房间」把房间码/邀请链接发给朋友
2. 房主在房间里加 AI、开始比赛（3-6 人）
3. 选秀：两轮蛇形选秀，每人 4 名运动员
4. 每场所有人同时暗选出战运动员 → 亮牌 → 轮流掷骰、触发技能 → 两人冲线即结束
5. 四场结束总分最高者获胜

HTTP 页面无法自动复制时，「复制邀请链接」会显示可全选的链接输入框，使用长按或 Ctrl/Cmd+C 手动复制即可。

## 目录

```
deploy/              nginx 站点配置与 systemd 用户服务
scripts/             start.sh / stop.sh / reload.sh（调用 local-nginx-sites 与 systemctl --user）
server.js            HTTP 静态资源 + WebSocket 入口，/racers-data.js 下发运动员与赛道数据
server/hub.js        房间、座位、AI/超时/离线托管的节奏驱动、速度设置、表情
game/engine.js       规则引擎（生成器驱动：需要决策时 yield，外部 answer 后继续；每个动作产出事件时间轴）
game/racers.js       36 名运动员（中文名、技能、AI 强度）
game/tracks.js       赛道（温和一英里 / 狂野荒原的箭头、石头、星星）与每场奖牌分值
game/ai.js           AI 决策启发式
public/              前端：index.html / style.css / app.js（联机、动画队列、棋盘、选秀、出牌、颁奖）
                     art.js（全部手绘 SVG 角色与图标）/ sound.js（WebAudio 合成音效）/ timing.js（动画时长，前后端共用）
test/rules.js        技能语义单测（含规则书原例：浪漫鳄 + 蹭蹭狗 + 香蕉）
test/sim.js          全 AI 大量自对弈，检查崩溃、死循环、状态不变量
test/hub.js          假时钟与连接隔离：房主移交、托管、身份、截止时间、四场结算与重开
test/server.js       临时端口上的真实 HTTP/WebSocket：静态目录、非法输入、身份切换、错误恢复
test/frontend.js     Chromium + 假 WebSocket：提交确认、断线、计时、旋转、旧动画取消
test/browser-helper.js 隔离后端、浏览器启动、可见按钮操作与完赛强断言
test/browser.js      Playwright 单人四场整局验收（W/H 可切手机尺寸）
test/multi.js        桌面与手机：同步、表情、刷新、横竖屏、四场完赛及重开
```

## 规则实现要点

- 规则与 36 张技能卡文字依据 CMYK 官方英文规则书（2025 版）逐张翻译实现。
- 同时触发的顺序：赛道格 → 当前玩家 → 其他玩家顺时针；「超过」「瞬移不算移动」「移动 0 不算移动」等术语严格按规则书。
- 无限循环（如蹭蹭狗撞巨婴）：同一技能在完全相同的局面下再次触发即判定为循环，走完一遍就停（规则书第 8 条）。
- 服务端权威：前端只播放事件动画，播完再用快照校正；动画期间不提前显示结果。
- AI 与超时托管按动画时长节奏推进；房主可以把全房动画调到 1.5x / 2.2x。
- 每次开局有独立 `gameId`；网络动作必须同时匹配对局编号、决策编号和合法选项，旧房间或上一局的迟到动作不会影响新局。
- 手动托管、超时托管与在线状态分开记录；其他成员重连不取消托管、不延长已发放的思考时间。房主离线或离场时优先移交给在线成员。
- 前端全量恢复、退房及回大厅会取消旧动画；断线不补发旧动作，重新同步后按权威局面操作。新前端在后端升级前仍兼容没有 `gameId` 的旧协议；新后端严格拒绝缺少对局编号的动作。
- 模仿猫的并列领跑由玩家选择；同回合连锁不重复询问相同领跑组合，后续回合可以重新选择。有效技能同步到行动卡和玩家栏。
- 达到回合／循环保护上限的场次会明确提示并记录 `reason`，保留已有得分进入结算，不冒充自然冲线完赛。

## 与实体版的规则差异

- 试玩版每场金/银牌分值为金 3/4/5/6、银 1/2/3/4。现有实现未完整核实实体版四场奖牌的数值，后续核对后可修改 `game/tracks.js` 的 `GOLD` / `SILVER`。
- 狂野荒原的特殊格布局是自行设计的（规则书没有给出完整赛道图），在 `game/tracks.js` 里调整。
- 2 人变体、3 人双运动员变体暂未实现（2 人可加 1 个 AI 凑成 3 人）。

## 完善与回归（2026-10-23）

- 37 项规则语义回归、12 项房间生命周期回归、35 项 HTTP/WebSocket 回归及独立资源清理测试通过。
- 前端异常回归覆盖握手与断线提交、同时暗选确认、动画取消、失效房间恢复、房主移交、减少动态计时、横竖屏格子点选、孵蛋／双胞胎超时、568×320 点数选择、键盘弹窗隔离、邀请加入重试及新旧协议兼容。
- 10,000 局／40,000 场随机模拟完成，无崩溃；所有技能均有生效记录。44 局／44 场使用保护上限，已明确记录，不算自然冲线完赛。模拟覆盖不等于所有技能组合均已按实体规则书核验。
- 保留现有手绘 SVG、棋子标签防重叠及骰面投影；未加入竞价、双人双运动员变体或服务端存档，未改变试玩版赛道和分值。
- 最终版手机单人真实浏览器四场验收通过：47 次操作，最终比分 14／14／17；按席位、姓名、冠军及四场成绩核对，页面与资源错误为 0。
- 浏览器测试工具的真实握手、动作确认、未授权 HTTP／WebSocket 重定向拦截及资源清理回归通过。
- 最终版桌面与手机双端验收通过：四场成绩一致、刷新恢复、横竖屏切换、表情显示与重开均通过；两端操作数 55／114，页面与资源错误为 0。重开校验新对局编号、分数／筹码清零及新局正常选秀提交。
- 当前处于开发阶段，经用户授权，验证后可直接提交代码及重启 `hunao-sports.service`，无需等房间无人或逐次确认；重启会清空内存房间。此授权不包含远端推送。更新后仍须验证实际 HTTP、静态资源和 WebSocket，不能将源码已修改或本地回归通过等同运行中的后端已升级。

## 历史验收（2026-09-30）

- `npm test`：18 项规则测试及 1,000 局模拟对局（4,000 场比赛）通过，无对局触及回合上限。
- 真实浏览器：桌面单人四场完赛；桌面房主与 390px 手机玩家联机四场完赛，两端最终比分一致；手机刷新恢复、表情同步通过。
- 1440px 与 390px 浏览器：36 人图鉴、玩法说明、邀请链接全选、通过邀请加入和离开房间通过，无横向溢出，无页面或静态资源错误。
- 系统 `nginx.service` 管理 18160 入口；首页、所有脚本/样式、运动员数据和 `/healthz` 均返回 HTTP 200，统一配置校验通过。
