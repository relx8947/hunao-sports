# 胡闹运动会 UI 与布局分析

这是一个可直接交接的静态分析项目，范围仅为桌思游想 Android 4.26.2 内的 **胡闹运动会（MagicalAthlete）**。

当前作为 `hunao-sports` 的参考资料，存放于 `hunao-sports/reference/magical-athlete-analysis/`。宿主游戏项目的 README 提供统一入口；此目录仍可独立打包、移动和浏览，内部脚本与资源路径均相对于本目录。

优先打开 [index.html](index.html) 查看界面与素材，再阅读 [REPORT.md](REPORT.md) 和 [HANDOFF.md](HANDOFF.md)。浏览页无需安装依赖或启动服务，可以直接在浏览器打开。

需要直接使用人物插画时，下载 **[36 张人物插画素材包](exports/characters.zip)**。图片统一恢复为原始 256×256 透明画布，文件名使用角色名；索引见 [characters.json](data/characters.json)。

## 已有成果

- APK 内置的对局界面说明图与布局标注。
- 36 名角色、197 个精灵 PNG、6 个界面所需的共用精灵。
- 16 个 Prefab 的层级、尺寸、坐标、颜色和文字数据。
- 角色/控件总览、能力确认与骰子确认的静态复原。
- 原始 APK、胡闹运动会的原始资源包与来源/校验记录。

原始规则图与静态复原分别标注。此项目未安装或执行 APK；运行时布局、动画与交互还需真机或模拟器验证。

## 目录

| 路径 | 内容 |
| --- | --- |
| `index.html` / `REPORT.md` | 可浏览报告 / 完整文字分析 |
| `HANDOFF.md` | 当前任务上下文、结论与后续入口 |
| `previews/` | 原始对局图、标注图、总览及静态复原 |
| `sprites/` | 197 个精灵 PNG |
| `assets/characters/` | 可直接使用的 36 张人物插画，256×256 透明 PNG |
| `exports/characters.zip` | 独立人物插画素材包，附角色索引 |
| `shared-sprites/` | 6 个共用精灵，供本游戏界面复原使用 |
| `data/` | Prefab、精灵和位图字体数据 |
| `source/MagicalAthlete/` | APK 中此模块的原始 JSON、PKM 贴图与音频 |
| `evidence/` | 下载来源、版本、校验和浏览检查结果 |
| `scripts/` | 独立报告生成与验证脚本 |

分析页面只展示胡闹运动会。

## 在游戏仓库中管理

此目录的 PNG、JSON、素材和文档纳入 `hunao-sports` 的 Git。原始 APK、完整交接 ZIP、反编译出的安卓工程配置和编译后的游戏代码（`index.jsc`）有版权风险，已从仓库删除，并由 `.gitignore` 排除。人物插画素材包 `exports/characters.zip` 体积较小，保留为直接使用入口。

没有 APK 也能浏览报告、使用插画、重新导出图片和生成报告；`verify_assets.py` 会跳过来源逐字节校验。需要校验时，按 `evidence/download.json` 自行取得 APK，放到 `apk/zhuosiyouxiang-4.26.2.apk`。

## 重新生成报告

使用 Python 3.10 或以上，安装 Pillow：

```sh
python3 -m pip install -r requirements.txt
python3 scripts/export_characters.py
python3 scripts/build_report.py
python3 scripts/verify_assets.py
```

Windows 可以把 `python3` 替换为 `python`。生成脚本会查找 Linux 的 Noto CJK、macOS 的苹方和 Windows 的微软雅黑/黑体。找不到时，设置 `ANALYSIS_CJK_FONT` 为本机的中文字体文件路径。

界面正文使用已提取的位图字体；本机中文字体用于标注、总览与缺字回退。不同系统生成的标注字形可能略有差异。

生成以 `data/` 和已经裁好的 PNG 为输入。项目保留原始资源供进一步核查，但没有把从 APK 开始的完整反编译流程包装成一键命令。

## 可选浏览验证

Node.js 20 或以上，使用本机 Chrome/Chromium：

```sh
npm install
npm run verify:browser
```

脚本会尝试常见浏览器路径。也可通过 `BROWSER_EXECUTABLE` 指定浏览器，或通过 `PUPPETEER_MODULE` 指定已安装的 puppeteer-core 模块。验证使用临时浏览器目录，结束后自动清理。

验证环境：Linux，Python 3.12 / Pillow 12.3.0，puppeteer-core 25.12.0，本机 Chrome。查看 [资源校验](evidence/assets-check.json) 与 [浏览检查](evidence/browser-check.json)。

## 安装包身份

包名 `com.yrt.game.board`，版本 `4.26.2`，versionCode `42602`；Cocos Creator `3.8.7`；原生 ABI 仅 `arm64-v8a`。

SHA-256：`2935869dda4b5789a03dd4b0b2b721b1ca38c2204852bc4763d56e3f40de10a6`。

素材权利属于原应用及相应权利人；本项目保存的是分析资料。
