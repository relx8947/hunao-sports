# 交接说明与当前上下文

## 当前目标

用户最初要求下载“桌思游想”APK 并分析 UI，随后明确重点为 **胡闹运动会**。最新要求是项目仅保留这款游戏的分析，方便交接，并保留当前任务 context。

最新需求澄清：“人物卡片”指 **人物插画**，用户需要这些素材来复刻自己的项目。36 张插画已完整取得，并导出为可直接使用的 256×256 透明 PNG；使用入口为 `assets/characters/` 和 `exports/characters.zip`。

用户的线上游戏源码位于 `hunao-sports/`。按最新要求，本分析目录已移入 `hunao-sports/reference/magical-athlete-analysis/`，游戏 README 与 `reference/README.md` 提供统一入口，方便同一个项目中管理素材与参考结论。

项目正式名称为“胡闹运动会 UI 与布局分析”，目录名为 `magical-athlete-analysis`。当前 TRAE 任务只调整了标题，继续使用同一个任务与对话历史；没有创建新会话或清空上下文。本文件为接手者提供独立于对话的上下文摘要。

## 接手时的入口

1. 打开 [index.html](index.html)，看对局界面、角色和弹窗预览。
2. 阅读 [REPORT.md](REPORT.md)，了解具体设计与数值证据。
3. 需要核查时，查看 `data/`、`source/MagicalAthlete/` 与 `evidence/`。

## 已确认的事实

- 应用准确名称是“桌思游想”，胡闹运动会对应 `MagicalAthlete` 模块。
- 已通过官网 → 官方下载 API → 蒲公英公开分发页下载 Android 4.26.2。
- APK 包名 `com.yrt.game.board`，Cocos Creator 3.8.7，画布 1080×1920，ABI 只有 arm64-v8a。
- 胡闹运动会有 16 个 Prefab、36 个角色和 197 条精灵帧记录。
- `Rule` 的 `rule1` 是 600×1100 的完整对局界面说明图，直接提取为 `previews/game-interface-from-apk.png`。
- 对局设计为奶油色背景、手绘角色、七种彩色/黑白赛道格、六色棋子底座。主按钮金黄，辅助按钮浅紫。
- 已解析角色、玩家卡片、赛道、招募、选角、能力确认、骰子确认、点选目标和赛事记录等界面。
- 原始人物插画的有效像素与透明度已在恢复画布时核对保持一致；`data/characters.json` 提供角色名、路径、尺寸、锚点、原始裁切位置与 UUID。导出索引不是游戏运行时角色 ID。

## 证据与推导的边界

- **原始图片：** 对局界面图、角色、按钮、赛道和骰子来自 APK 资源。
- **元数据：** Prefab 参数来自 Cocos 类表、属性掩码和 UI 引用解析。
- **静态复原：** 能力确认与骰子确认由原素材、位图字体和保存坐标生成。骰子点数 5、2 是示例。
- **尚未验证：** 未运行 App，因此无法确认当前状态、所有界面跳转、Layout/Widget 最终位置、机型适配、动画速度或技能的运行时行为。

角色名和按钮文字可能是模板，运行时会替换。197 条精灵帧也不是 197 个页面。

## 已完成的检查

原始 APK SHA-256 与下载记录一致。胡闹运动会的 69 个原始资源文件可与 APK 内对应成员逐字节校验。197 个精灵、6 个共用精灵及报告链接均检查完整；浏览页已验证角色搜索、图片放大、16 个 Prefab 选择、骰子界面参数及移动宽度。

最终结果以 `evidence/assets-check.json`、`evidence/browser-check.json` 为准。

## 如果继续做下一步

当前静态 UI 分析与交接整理已完成。后续最有价值的是在 ARM 安卓真机或合适的模拟器上核对招募、掷骰、能力确认、多人同格与赛后记录的真实界面；先补运行证据，再调整静态复原。

讨论过环境选择：Linux 适合资源处理与批量分析；真机可直接匹配本包的 ARM64 架构。Windows/Linux x86 模拟器需确认 ARM 转译，Apple Silicon Mac 可使用 ARM 安卓模拟器。这是工作流建议，项目本身可离线浏览，也可在三个系统上生成报告。

## 路径迁移记录

之前的综合分析目录：`/home/dev/project/playgroud/zhuosiyouxiang-analysis`。

之前的专项目录：`zhuosiyouxiang-analysis/magical-athlete/`。

此前独立目录：`/home/dev/project/playgroud/magical-athlete-analysis/`。

当前实体目录：`/home/dev/project/playgroud/hunao-sports/reference/magical-athlete-analysis/`。此前独立目录及其交接 ZIP/校验文件的三个软链接已按用户要求删除，后续统一使用此项目内路径。旧综合报告、其他桌游提取物和临时工具已从交接范围移除；原始 APK、目标模块和必要共用控件在此目录中保存。

历史对话里的旧路径属于迁移前位置，现已失效；当前对话历史保留，接手时使用游戏项目和分析项目 README 中的现有链接。
