# 胡闹运动会人物插画素材

36 张独立透明 PNG，文件名直接使用角色名。每张恢复为原始 256×256 画布，保留插画像素与原始偏移，适合以同一容器尺寸显示角色。

- `assets/characters/`：可直接导入项目的图片。
- `data/characters.json`：角色名、路径、尺寸、锚点、裁切位置及来源 UUID。
- `asset_id` 是此导出包的索引标识，不是游戏逻辑中的角色 ID。

图片来自桌思游想 4.26.2 的 MagicalAthlete 资源。角色名称与所有 36 张插画已核实；此包聚焦图像素材。

在 HTML 中，例如：

```html
<img src="assets/characters/火箭专家.png" width="128" height="128" alt="火箭专家">
```

项目中可运行 `python3 scripts/export_characters.py` 重新导出。
