#!/usr/bin/env python3
"""Create a focused visual study from already decoded MagicalAthlete assets."""
from pathlib import Path
from collections import Counter
from functools import lru_cache
import json
import re
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageChops, ImageFilter
import os
ROOT=Path(__file__).resolve().parents[1]

OUT=ROOT
PREVIEWS=OUT/'previews'
def find_cjk_font():
    requested=os.environ.get('ANALYSIS_CJK_FONT')
    if requested:
        if Path(requested).is_file():return requested
        raise SystemExit('ANALYSIS_CJK_FONT does not point to an existing font')
    candidates=[
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
        '/System/Library/Fonts/PingFang.ttc',
        '/Library/Fonts/NotoSansCJK-Regular.ttc',
        'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/simhei.ttf',
    ]
    for candidate in candidates:
        if Path(candidate).is_file():return candidate
    raise SystemExit('Set ANALYSIS_CJK_FONT to a local Chinese font; see README.md')
FONT=find_cjk_font()
PREFABS=json.loads((OUT/'data/prefab-layouts.json').read_text())
SPRITES=json.loads((OUT/'data/sprite-catalog.json').read_text())
ALL_SPRITES=json.loads((ROOT/'data/shared-sprite-catalog.json').read_text())
BY_NAME={r['name']:r for r in SPRITES}
BY_UUID={r['uuid']:r for r in ALL_SPRITES}
BY_UUID.update({r['uuid']:r for r in SPRITES})
ENTRY=next(p for p in PREFABS if p['path']=='Entry')
ROLES=[n['_name'] for n in ENTRY['nodes'] if n['hierarchy_path'].startswith('Entry/RefKit/')]

def font(size):return ImageFont.truetype(FONT,size)

@lru_cache(maxsize=300)
def sprite(uuid):
    record=BY_UUID.get(uuid)
    if not record:return None
    preview=record.get('preview')
    if not preview:return None
    path=OUT/preview
    if not path.is_file():raise FileNotFoundError(path)
    return Image.open(path).convert('RGBA')

def named(name):return sprite(BY_NAME[name]['uuid']).copy()

def nine_slice(image,size,insets):
    w,h=map(lambda v:max(1,round(v)),size);sw,sh=image.size
    left,top,right,bottom=map(round,insets)
    if not any(insets) or left+right>=sw or top+bottom>=sh:return image.resize((w,h),Image.Resampling.LANCZOS)
    out=Image.new('RGBA',(w,h));sx=[0,left,sw-right,sw];sy=[0,top,sh-bottom,sh]
    dx=[0,min(left,w//2),max(w-right,w//2),w];dy=[0,min(top,h//2),max(h-bottom,h//2),h]
    for row in range(3):
        for col in range(3):
            width,height=dx[col+1]-dx[col],dy[row+1]-dy[row]
            if width>0 and height>0:
                block=image.crop((sx[col],sy[row],sx[col+1],sy[row+1])).resize((width,height),Image.Resampling.LANCZOS)
                out.alpha_composite(block,(dx[col],dy[row]))
    return out

FONT_META=json.loads((OUT/'data/bitmap-font.json').read_text())
FONT_DEFS=FONT_META['fntConfig']['fontDefDictionary']
trimmed=named('myFont');FONT_ATLAS=Image.new('RGBA',(800,915));FONT_ATLAS.alpha_composite(trimmed,(2,2))

def bitmap_text(text,size,color=(255,255,255,255)):
    scale=size/FONT_META['fontSize'];lines=text.split('\n');line_height=FONT_META['fntConfig']['commonHeight']
    widths=[sum(FONT_DEFS.get(str(ord(c)),{}).get('xAdvance',25) for c in line) for line in lines]
    canvas=Image.new('RGBA',(max(1,int(max(widths,default=1)+1)),max(1,line_height*len(lines))))
    for row,line in enumerate(lines):
        x=0
        for c in line:
            g=FONT_DEFS.get(str(ord(c)))
            if not g:
                ImageDraw.Draw(canvas).text((x,row*line_height),c,font=font(44),fill=(255,255,255,255));x+=44;continue
            r=g['rect']
            if r['width'] and r['height']:
                glyph=FONT_ATLAS.crop((r['x'],r['y'],r['x']+r['width'],r['y']+r['height']))
                canvas.alpha_composite(glyph,(round(x+g['xOffset']),round(row*line_height+g['yOffset'])))
            x+=g['xAdvance']
    canvas=canvas.resize((max(1,round(canvas.width*scale)),max(1,round(canvas.height*scale))),Image.Resampling.LANCZOS)
    tint=Image.new('RGBA',canvas.size,color)
    return ImageChops.multiply(canvas,tint)

def paste_center(canvas,image,x,y):
    canvas.alpha_composite(image,(round(x-image.width/2),round(y-image.height/2)))

def sheet(names,path,title,subtitle,columns=6,cell=(190,270)):
    width=columns*cell[0]+60;rows=(len(names)+columns-1)//columns
    canvas=Image.new('RGB',(width,120+rows*cell[1]+30),'#FBF4E6');d=ImageDraw.Draw(canvas)
    d.text((30,22),title,font=font(30),fill='#232323');d.text((30,70),subtitle,font=font(16),fill='#7B7469')
    for i,name in enumerate(names):
        x=30+(i%columns)*cell[0];y=120+(i//columns)*cell[1]
        d.rounded_rectangle((x+4,y+4,x+cell[0]-8,y+cell[1]-8),10,fill='#F4E8D4',outline='#D7CBB6')
        image=named(name);image.thumbnail((cell[0]-38,cell[1]-65),Image.Resampling.LANCZOS)
        canvas.paste(image,(x+(cell[0]-image.width)//2,y+14+(cell[1]-65-image.height)//2),image)
        label=name;box=d.textbbox((0,0),label,font=font(17));d.text((x+(cell[0]-(box[2]-box[0]))//2,y+cell[1]-43),label,font=font(17),fill='#363637')
    canvas.save(path)

def annotate_source():
    source=named('rule1').convert('RGB');source.save(PREVIEWS/'game-interface-from-apk.png')
    canvas=Image.new('RGB',(1350,1240),'#FBF4E6');d=ImageDraw.Draw(canvas)
    d.text((35,22),'胡闹运动会 · 对局界面布局',font=font(34),fill='#232323')
    d.text((35,72),'左图直接提取自 APK 的 Rule 资源；右侧尺寸来自对应 Prefab。',font=font(18),fill='#766D61')
    canvas.paste(source,(35,110))
    zones=[(1,(135,233,635,308),'回合提示与轮次','TopView 1080×100；提示框 700×90', ['提示框占中央，轮次旗帜在右侧。','外层工具栏来自平台公共对局界面。']),
           (2,(35,308,635,453),'玩家信息栏','ViewPlayer 170×290；头像 110×110',['圆形头像、星形积分、角色名分层显示。','6 名玩家通过卡片色与棋子底座关联。']),
           (3,(47,479,623,1063),'中央赛道','LayerMap 1080×1050；单格 150×150',['黑色边框 + 彩色带纹理的方格。','角色立在椭圆底座上，保留桌游棋子感。']),
           (4,(250,1090,440,1193),'底部操作','主/能力按钮各 280×120；间距 50',['金黄强调主要动作，浅紫色承载辅助动作。','按钮标题与小字说明一起解释执行结果。'])]
    for index,rect,title,measure,lines in zones:
        d.rounded_rectangle(rect,8,outline='#B45440',width=3)
        cy=(rect[1]+rect[3])//2;d.line((rect[2],cy,680,cy),fill='#B45440',width=2)
        d.ellipse((655,cy-18,691,cy+18),fill='#B45440');d.text((665,cy-14),str(index),font=font(20),fill='white')
        y=[155,365,640,970][index-1]
        d.text((730,y),f'{index:02d}  {title}',font=font(26),fill='#232323')
        d.text((730,y+50),measure,font=font(18),fill='#9A6538')
        for j,line in enumerate(lines):d.text((730,y+92+j*34),line,font=font(18),fill='#5C584E')
    canvas.save(PREVIEWS/'interface-annotated.png')

def render_dialog(name,path,sample_dice=False):
    prefab=next(p for p in PREFABS if p['path']==name)
    byid={n['instance_index']:n for n in prefab['nodes']}
    background=ImageOps.fit(named('rule1').convert('RGB'),(1080,1920),Image.Resampling.LANCZOS).convert('RGBA')
    positions={}
    def pos(n):
        index=n['instance_index']
        if index in positions:return positions[index]
        parent=byid.get(n.get('_parent'));px,py=pos(parent) if parent else (540,960)
        local=n.get('_lpos',[0,0,0]);positions[index]=(px+local[0],py-local[1]);return positions[index]
    def draw(n):
        if n.get('_active') is False:return
        x,y=pos(n);comps=[c for c in n.get('_components',[]) if c]
        tf=next((c for c in comps if c.get('type')=='cc.UITransform'),{})
        for c in comps:
            if c.get('type')=='cc.Sprite':
                uuid=c.get('_spriteFrame_uuid');r=BY_UUID.get(uuid);img=sprite(uuid);size=tf.get('_contentSize',img.size if img else (100,100));color=c.get('_color',{}).get('rgba',[255,255,255,255])
                if n['hierarchy_path']==prefab['path'].split('/')[-1]+'/Background':
                    background.alpha_composite(Image.new('RGBA',(1080,1920),tuple(color)),(0,0));continue
                if img:
                    img=nine_slice(img,size,r['sprite'].get('capInsets',[0,0,0,0])) if r and c.get('_type')==1 else img.resize(tuple(max(1,round(v)) for v in size),Image.Resampling.LANCZOS)
                    img=ImageChops.multiply(img,Image.new('RGBA',img.size,tuple(color)));paste_center(background,img,x,y)
            elif c.get('type')=='cc.Label' and c.get('_string'):
                color=c.get('_color',{}).get('rgba',[255,255,255,255]);img=bitmap_text(c['_string'],c.get('_fontSize',50),tuple(color));paste_center(background,img,x,y)
        for child in n.get('_children',[]):
            if child in byid:draw(byid[child])
    roots=[n for n in prefab['nodes'] if n.get('_parent') not in byid]
    for n in roots:draw(n)
    if sample_dice:
        for index,value in [(1,5),(2,2)]:
            n=next(n for n in prefab['nodes'] if n['hierarchy_path'].endswith('/Dice'+str(index)))
            x,y=pos(n);image=named(f'dice_result_{value}_0');image.thumbnail((180,265));image=image.resize((180,round(180*image.height/image.width)),Image.Resampling.NEAREST);paste_center(background,image,x,y-10)
    footer=Image.new('RGBA',(1080,2010),'#FBF4E6');footer.alpha_composite(background,(0,0));d=ImageDraw.Draw(footer)
    label='静态复原：原素材 + 保存坐标 + 位图字体；未执行游戏'
    if sample_dice:label+='；骰子点数为示例'
    d.text((32,1950),label,font=font(24),fill='#4F4A43');footer.convert('RGB').save(path)

def write_report():
    prefab_rows='\n'.join(f"| `{p['path']}` | {len(p['nodes'])} | {LABELS.get(p['path'],p['path'])} |" for p in PREFABS)
    text='''# 胡闹运动会：界面设计专项分析

基于桌思游想 Android 4.26.2 的 `MagicalAthlete` 资源包。这里聚焦胡闹运动会的实际界面、赛道、角色与操作反馈。

## 最直接的界面证据

**[对局界面原图](previews/game-interface-from-apk.png)** 是从 APK 的 `Rule` 资源中提取的 `rule1` 图片，尺寸 600×1100。它展示了一场 6 人对局的 UI，不是重新绘制的概念稿。[布局标注图](previews/interface-annotated.png) 在此原图旁连接了相应 Prefab 参数。

原图可以证明这套界面的视觉组合，但它是应用内的规则说明图片，不等同于当前运行截图。`Entry`、`ViewPlayer`、`LayerMap`、`ViewMap` 则分别提供当前安装包里的布局参数。App Store 的 4.26.0/4.26.2 更新记录也明确包含“胡闹运动会”，与该模块的角色和规则相互对应。

## 视觉语言

胡闹运动会采用**奶油纸色底、粗轮廓、彩色方格、手绘人物和带底座的棋子**。界面保留实体桌游摆在桌上的感觉：角色立在赛道上，颜色帮助识别玩家，按钮像可按下的牌块。

- 主背景 `#FBF4E6`；提示框内层 `#FCEFD6`；玩家卡片浅色 `#FCF3E3`。
- 轮廓使用 `#232323`、`#363637` 和黑色。提示框为 700×90，内层 696×86，通过相差 2 的边距形成细描边。
- 赛道有红、黄、绿、蓝、紫与黑、白七种格子素材。色块内有颗粒/纸纹，边界保持黑色。
- 主按钮使用金黄 `btn_confirm`，辅助/取消按钮使用浅紫色 `btn_cancel`。原素材具有粗描边、下方阴影和内部色差。
- 角色形象夸张且轮廓明确：瘦长的“大长腿”、圆胖的“巨婴”、横向的“飞艇”、动物和幻想角色混用。36 名参赛者各有独立贴图。

这套视觉的关键是“能辨认的小棋子与清楚的赛道格”。背景简洁，赛道和角色占据主要画面；低面积的明亮按钮把下一步操作突出出来。

## 主界面布局

规则资源的“UI介绍”逐字说明：顶部显示游戏状态与赛程；玩家区域显示 2～6 名玩家、本轮参赛者和累计积分；中央版图占据最大区域；底部显示当前可执行操作。这与原图和节点结构一致。

| 区域 | APK 中的参数 | 设计作用 |
| --- | --- | --- |
| Entry | 1080×1920 | 全屏画布 |
| Stage | 1080×1770，顶部预留 150 | 承接平台工具栏下方的游戏主体 |
| TopView | 1080×100 | 提示框居中，赛事旗帜与轮次在右 |
| 提示框 | 700×90，内层 696×86 | 深轮廓包住浅底黑字，说明当前轮到谁行动 |
| 玩家信息 | ViewPlayer 170×290；PlayerView 横排间距 9 | 支持多玩家紧凑排列 |
| 头像 | 110×110；外轮廓圆 126×126，内层 120×120 | 用头像圆框、颜色与积分组织身份 |
| 赛道层 | LayerMap 1080×1050 | 场地基础层与角色层分开叠加 |
| 单个格子 | ViewMap 150×150；内层 144×144 | 约 3 单位黑色边缘，格子可重复拼接 |
| 场上角色 | ViewRole 120×140；角色图标 160×160 | 角色可超出容器，制造站立棋子的效果 |
| 底部按钮 | 单个 280×120，主/能力按钮间距 50 | 运行时按当前操作显示一个或两个按钮 |

`Stage` 有纵向 Layout，间距为 20；玩家信息栏使用横向 Layout，间距为 9。这些值比仅从截图估计更可靠。坐标和尺寸是 Cocos 的设计单位，运行时 Layout/Widget 仍可能调整它们。

在规则图片中，赛道以蛇形路线穿过彩色方格，起点和终点位于上方的不同列，5/10/15/20/25 等标记辅助判断进度。角色遮住格子的一部分，彩色底座保持可见。用户同时需要识别：自己的棋子、前进方向、格子效果和其他选手位置。

## 玩家卡片与角色设计

[36 名角色总览](previews/characters-sheet.png) 保留了原始绘画与透明边缘。头像之外，地图棋子用 `seat_1` 到 `seat_6` 六种底座区分玩家；同色玩家卡片和底座提供关联。不能只按角色本身的身体颜色判断属于谁。

ViewPlayer 的内部结构包括 Avatar、Score、FirstRole、SecondRole、Predict 和 Dead。两条角色名称区域各高 50；这对应规则中的 2～3 人局每人操控两名参赛者。单角色与双角色的显示需要运行逻辑切换。

ViewRole 中包含 Seat、Role、Trip、Rank 和 SkillAnimation：绊倒用 `mask_trip` 叠加提示；冠军/亚军用 `rank_1` / `rank_2`；能力触发出现 150×150 的提示区域。状态通过覆盖图层表达，保留角色本体的连续性。

## 操作按钮与决策弹窗

两个主要按钮都是双行布局：标题通常字号 45，说明字号 32；按钮尺寸 280×120。原图里的“投掷骰子 / 根据点数前进”说明了这种做法：主标题给动作，小字给结果。Entry 模板也保存“拉拉队 / 末位选手前进”和“状态恢复 / 解除绊倒状态”。这些是保存时的模板文字，不能认定所有回合都显示它们。浅紫色辅助按钮搭配浅色字，金黄确认按钮搭配黑字，在同一操作组中建立主次。

按钮图片保留 `capInsets`，支持九宫格拉伸。`btn_confirm` 的参数为 `[49,28,48,37]`，`btn_cancel` 为 `[48,31,45,42]`。重现设计时，应保留边框与阴影厚度，伸展中间区域。

弹窗统一使用全屏黑色遮罩，alpha 为 220/255，约 86%。文本、角色、骰子与按钮浮在压暗的棋盘上，中心内容没有统一的浅色大卡片。这让玩家在决策时仍能隐约看到对局背景。

| 决策 | 资源 | 可确认的结构 |
| --- | --- | --- |
| 开局招募 | DialogInitRole | 标题“招募参赛者”；玩家行；950×700 的角色区域；200×200 的选项槽；选中标记与确定按钮 |
| 选择本轮角色 | DialogPickRole | 950×450 的选项区域；提示先选的角色率先行动；放弃/确定按钮 |
| 是否发动能力 | DialogPickConfirm | 角色名 + 能力描述 + 两个按钮；Layout 1080×305 |
| 骰子结果确认 | DialogDiceConfirm | 结果标题、520×350 的骰子区域、技能按钮、确认移动；Layout 1080×905 |
| 点选棋盘目标 | DialogPickMap | 地图区 1080×1030；目标遮罩与黄色焦点；下方角色选择与确认 |
| 改选骰子 | DialogPickDice | 紧凑选择区域 + 两个按钮 |
| 赛事记录 | DialogRecord | 轮次、金银奖牌、各轮分数和参赛者条目 |
| 玩家参赛者 | DialogPlayer | 本轮上场选手与所属参赛者列表 |

[能力确认静态复原](previews/ability-confirm-static.png) 使用原始素材、位图字体与保存坐标重建；[骰子确认静态复原](previews/dice-confirm-static.png) 额外填入示例点数 5 和 2。两张都未运行游戏，不能代替运行态验证。

## 字体与反馈资源

该模块有 `myFont` 位图字体，字体元数据 fontSize=50、commonHeight=60。可以提取每个字形及间距，文字有厚重、紧凑的形态。不能从资源名 `myFont` 确定原始字体家族。

字号样例：弹窗标题 55、动作标题 45、说明 36、按钮副标题/角色名/积分 32，技能动画文字 30。换成宽度 360 的等比画布，32 约为 10.7 个显示单位，双角色的小字可能偏小；这里不是 Android sp。

模块中有 19 张 `dice_0…dice_18` 投骰子姿态图、18 张 `dice_result_点数_状态` 图、51 张 `fireworks_0…fireworks_50` 庆祝帧，以及六种玩家底座。文件索引能说明反馈素材已经准备，但未解析出动画帧率和运行时触发条件。

## 设计上最值得保留的部分

1. **棋子感与归属一致。** 角色保留完整剪影，彩色底座与玩家卡片联动，比单独让角色变色更容易追踪。
2. **格子可读。** 方格尺寸一致、黑边清楚；特殊效果用图标叠加，焦点用独立层，不需要重画整条赛道。
3. **操作有结果说明。** “确认移动 / 前进 5 格”让用户在按下前知道会发生什么。
4. **能力决策覆盖棋盘。** 深色遮罩突出当前选择，同时保留上下文。

需要留意：六人卡片较密、双角色小字更紧；多个角色同格时容易遮挡；彩色棋子最好同时提供序号/图案，降低仅靠颜色区分的负担；提示文案和选中框要足够明确，避免在蛇形赛道上失去移动方向。

## 资源与可浏览内容

本项目仅分析胡闹运动会，包含 16 个 Prefab、197 条精灵帧记录。197 条中有 36 个角色、7 个赛道格、6 个底座、19 个投骰子姿态、18 个骰子结果、51 个庆祝帧，另有按钮、字体、规则图和公共素材；这些分类的资源不应直接当作页面数。

| Prefab | 节点数 | 用途 |
| --- | --- | --- |
__PREFAB_ROWS__

- [专项浏览页](index.html)：原图、静态弹窗复原、分类素材、16 个 Prefab 参数。
- [对局界面原图](previews/game-interface-from-apk.png) / [标注图](previews/interface-annotated.png)
- [角色总览](previews/characters-sheet.png) / [控件总览](previews/controls-sheet.png)
- [精灵目录](data/sprite-catalog.json) / [布局原始数据](data/prefab-layouts.json) / [字体元数据](data/bitmap-font.json)
- `sprites/`：197 个独立 PNG，保留中文角色名称。
- [36 张人物插画素材包](exports/characters.zip)：恢复到原始 256×256 透明画布，可直接使用。
- [人物插画索引](data/characters.json)：名称、路径、锚点、裁切位置与来源。
- [交接说明](HANDOFF.md)：已完成工作、来源、限制与后续入口。
- [项目说明](README.md)：阅读入口、复现命令与目录结构。

原始 `Rule` 文案明确描述了 UI 分区；赛道、角色和骰子由脚本组合。此分析能确认资源与界面设计，不能确认当前运行时状态、适配后的最终坐标、帧时序或各能力的真实交互路径。
'''
    (OUT/'REPORT.md').write_text(text.replace('__PREFAB_ROWS__',prefab_rows))

LABELS={'Entry':'对局主体','Rule':'规则说明','prefab/ViewMap':'赛道格子','prefab/LayerMap':'赛道与棋子分层','prefab/ViewRole':'场上棋子','prefab/ViewPlayer':'玩家卡片','prefab/ViewDice':'骰子','prefab/ViewDescription':'角色能力说明','prefab/DialogInitRole':'开局招募','prefab/DialogPickRole':'选择本轮角色','prefab/DialogPickConfirm':'能力确认','prefab/DialogDiceConfirm':'骰子结果确认','prefab/DialogPickMap':'点选棋盘目标','prefab/DialogPickDice':'选择骰子','prefab/DialogRecord':'赛事记录','prefab/DialogPlayer':'参赛者列表'}

def write_html():
    data=[]
    for r in SPRITES:
        name=r['name']
        group='角色' if name in ROLES else '赛道与棋子' if name.startswith(('brick_','seat_','map_','mask_trip','rank_','focus')) else '骰子' if name.startswith('dice_') else '动画' if name.startswith('fireworks_') else '按钮与其他'
        data.append({'name':name,'src':r['preview'],'group':group,'uuid':r['uuid'],'size':[r['sprite']['rect']['width'],r['sprite']['rect']['height']]})
    pages=[]
    for p in PREFABS:
        nodes=[]
        for n in p['nodes']:
            cs=[c for c in n.get('_components',[]) if c];tf=next((c for c in cs if c.get('type')=='cc.UITransform'),{});label=next((c for c in cs if c.get('type')=='cc.Label'),{})
            nodes.append({'name':n['hierarchy_path'],'size':tf.get('_contentSize'),'position':n.get('_lpos'),'text':label.get('_string'),'font':label.get('_fontSize'),'hidden':n.get('_active') is False})
        pages.append({'path':p['path'],'name':LABELS[p['path']],'file':p['import_file'],'nodes':nodes})
    payload=json.dumps({'assets':data,'pages':pages},ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
    doc='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>胡闹运动会 · 界面设计</title><style>
:root{--paper:#fbf4e6;--ink:#232323;--sub:#746957;--edge:#d7c7ad;--gold:#ffc631;--red:#b45440}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Sans CJK SC",sans-serif;line-height:1.7}a{color:inherit;text-underline-offset:4px}button,input,select{font:inherit}button{cursor:pointer}header{padding:22px 5vw;display:flex;justify-content:space-between;border-bottom:2px solid var(--ink);font-size:12px}header strong{letter-spacing:.18em}main{max-width:1440px;margin:auto;padding:38px 5vw 70px}.kicker{font-size:12px;color:var(--sub);letter-spacing:.15em}h1{font-family:"Noto Serif CJK SC",serif;font-size:clamp(36px,4vw,62px);line-height:1.3;margin:13px 0 18px;letter-spacing:-.03em}.lead{max-width:850px;color:#615946;font-size:16px;margin-bottom:26px}.quick{display:flex;gap:28px;flex-wrap:wrap;font-size:13px}.quick b{font-size:24px;margin-right:6px}.top{display:grid;grid-template-columns:minmax(320px,480px) 1fr;gap:55px;margin-top:35px;align-items:start}.original{border:2px solid #363637;padding:10px;background:#fff8ee;box-shadow:8px 8px 0 #e8d7b5}.original img{width:100%;display:block;cursor:zoom-in}.original figcaption{font-size:11px;color:var(--sub);padding:10px 4px 2px}figure{margin:0}.sections{display:grid;gap:25px;padding-top:8px}.section{border-bottom:1px solid var(--edge);padding-bottom:24px}.section .num{font-family:monospace;font-size:12px;color:var(--red)}h2{font-family:"Noto Serif CJK SC",serif;font-size:27px;margin:5px 0 9px}.section p{font-size:14px;color:#615946;margin:0 0 12px}.measure{display:inline-block;background:#f3e3c7;border:1px solid #dec9a4;font-family:monospace;font-size:12px;padding:4px 10px}.palette{display:flex;gap:9px;flex-wrap:wrap}.palette span{font-size:11px;border:1px solid #d7c7ad;padding:7px 10px;display:flex;align-items:center;gap:7px}.palette i{width:20px;height:20px;display:inline-block}.actions{display:flex;gap:14px;flex-wrap:wrap;margin-top:18px;font-size:13px}.actions a{font-weight:600}.divider{border-top:2px solid var(--ink);padding-top:25px;margin-top:45px}.sublead{font-size:13px;color:var(--sub);max-width:850px}.specimens{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:24px}.specimen{background:#eee0c8;border:1px solid var(--edge);padding:16px}.specimen img{display:block;width:100%;height:460px;object-fit:contain;cursor:zoom-in;background:#252420}.specimen h3{margin:12px 0 5px;font-size:16px}.specimen p{font-size:12px;color:var(--sub);margin:0}.filters{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.filter{background:transparent;border:1px solid #988367;padding:6px 13px;font-size:12px}.filter.active{background:#363637;color:white}.toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:16px 0}.toolbar input{background:#fff9ee;border:1px solid #a99474;padding:10px 13px;width:330px;max-width:100%;font-size:13px}.toolbar small{margin-left:auto;color:var(--sub)}.gallery{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:15px}.asset{padding:8px;border:1px solid var(--edge);background:#f5e9d3;min-width:0}.asset button{display:flex;align-items:center;justify-content:center;width:100%;height:180px;border:0;background:#fdf8ed;padding:15px}.asset img{max-height:100%;max-width:100%;object-fit:contain}.asset figcaption{font-size:12px;text-align:center;padding-top:7px;overflow-wrap:anywhere}.asset small{display:block;font-size:10px;color:var(--sub)}.layout-select{padding:9px 12px;border:1px solid #a99474;background:#fff9ee;font-size:13px}.table-wrap{max-height:550px;overflow:auto;border:1px solid var(--edge);margin-top:18px}table{border-collapse:collapse;width:100%;font-size:11px}th{padding:12px;text-align:left;background:#f1e0c0;position:sticky;top:0;white-space:nowrap}td{padding:10px 12px;border-bottom:1px solid var(--edge);vertical-align:top}td:first-child{font-family:monospace;max-width:360px;overflow-wrap:anywhere;font-size:10px}footer{padding:20px 5vw;border-top:1px solid var(--edge);font-size:11px;color:var(--sub)}dialog{background:#fbf4e6;border:2px solid var(--ink);width:min(1100px,94vw);max-height:92vh;padding:20px}dialog::backdrop{background:#1d1818db}dialog img{display:block;max-width:100%;max-height:74vh;margin:12px auto;object-fit:contain}.dialoghead{display:flex;justify-content:space-between;gap:16px}dialog button{background:none;border:1px solid #97866b;padding:5px 12px}dialog a{font-size:12px}body:has(dialog[open]){overflow:hidden}@media(max-width:950px){.top{grid-template-columns:minmax(250px,350px) 1fr;gap:30px}.gallery{grid-template-columns:repeat(4,1fr)}.asset button{height:150px}}@media(max-width:650px){main{padding:28px 6vw 50px}.top{grid-template-columns:1fr}.original{max-width:480px;margin:auto}.specimens{grid-template-columns:1fr}.specimen img{height:420px}.gallery{grid-template-columns:repeat(3,1fr);gap:8px}.asset button{height:130px;padding:9px}.section{padding-bottom:16px}.quick{gap:16px}.toolbar small{margin-left:0}header{gap:20px}}
</style></head><body><header><strong>胡闹运动会 / UI STUDY</strong><a href="HANDOFF.md">交接说明 ↗</a></header><main><div class="kicker">MAGICAL ATHLETE / APK 4.26.2</div><h1>奶油纸色、彩色赛道，<br>一群不按套路的参赛者。</h1><p class="lead">从 APK 直接提取对局界面说明图，并以 Prefab 核实布局。重点看这款游戏怎样用手绘棋子、彩色底座、清晰格子和双行按钮组织一场混乱竞速。</p><div class="quick"><span><b>16</b>界面组件</span><span><b>36</b>参赛者</span><span><b>197</b>精灵素材</span><a href="exports/characters.zip">下载 36 张人物插画 ↗</a><a href="REPORT.md">完整设计分析 ↗</a></div><section class="top"><figure class="original"><img src="previews/game-interface-from-apk.png" alt="APK Rule 资源中的胡闹运动会对局界面" data-zoom="previews/game-interface-from-apk.png"><figcaption>原图来自 APK / rule1 / 600×1100。应用内规则说明图片，未执行游戏。</figcaption></figure><div class="sections"><article class="section"><span class="num">01 / 当前行动与赛程</span><h2>先告诉玩家轮到谁。</h2><p>提示框居中，旗帜与 1/4 轮次在右。平台工具栏保留在上方，游戏主体从预留的 150 单位之后开始。</p><span class="measure">TopView 1080×100 · 提示框 700×90</span></article><article class="section"><span class="num">02 / 玩家信息</span><h2>卡片和底座，用同一种颜色。</h2><p>头像、星形积分和角色名分成三层。六色玩家卡片与场上棋子底座相互关联；双角色局可显示两行角色名。</p><span class="measure">玩家卡 170×290 · 横向间距 9</span></article><article class="section"><span class="num">03 / 中央赛道</span><h2>让棋子立在方格上。</h2><p>彩色带纹理的方格由黑边隔开。手绘角色配椭圆底座，特殊格子与绊倒、名次等状态由额外图层叠加。</p><span class="measure">赛道层 1080×1050 · 单格 150×150</span></article><article class="section"><span class="num">04 / 下一步操作</span><h2>一个动作，再给一句解释。</h2><p>金黄按钮突出主要操作，浅紫色按钮表示能力或放弃。主标题告诉用户做什么，副标题说明会前进多少或解除什么状态。</p><span class="measure">单按钮 280×120 · 双按钮间距 50</span></article><div class="palette"><span><i style="background:#fbf4e6"></i>#FBF4E6</span><span><i style="background:#fcf3e3"></i>#FCF3E3</span><span><i style="background:#363637"></i>#363637</span><span><i style="background:#ffc631"></i>金黄按钮</span></div><div class="actions"><a href="previews/interface-annotated.png" data-zoom="previews/interface-annotated.png">查看布局标注图</a><a href="previews/characters-sheet.png" data-zoom="previews/characters-sheet.png">36 角色总览</a><a href="previews/controls-sheet.png" data-zoom="previews/controls-sheet.png">控件总览</a></div></div></section>
<section class="divider"><h2>在棋盘上方，完成一次决策。</h2><p class="sublead">弹窗使用约 86% 的黑色遮罩，文字、骰子和按钮直接浮在压暗的棋盘上。以下是依据保存坐标、原素材和位图字体制作的静态复原，未执行游戏；骰子点数额外使用示例值。</p><div class="specimens"><article class="specimen"><img src="previews/ability-confirm-static.png" alt="能力确认弹窗静态复原" data-zoom="previews/ability-confirm-static.png"><h3>能力确认 · DialogPickConfirm</h3><p>角色名 → 能力描述 → 放弃 / 确定。保存的 Layout 为 1080×305。</p></article><article class="specimen"><img src="previews/dice-confirm-static.png" alt="骰子结果弹窗静态复原，点数为示例" data-zoom="previews/dice-confirm-static.png"><h3>骰子结果 · DialogDiceConfirm</h3><p>结果说明 → 骰子 → 技能与确认。骰子区域 520×350，整块 Layout 为 1080×905。</p></article></div></section>
<section class="divider"><h2>查看原始角色和控件。</h2><p class="sublead">图片从解码后的图集中裁出，保留透明背景。选中分类、搜索素材名称，点击即可放大并打开独立 PNG。</p><nav class="filters" aria-label="素材分类"><button class="filter active" data-group="角色">角色</button><button class="filter" data-group="赛道与棋子">赛道与棋子</button><button class="filter" data-group="骰子">骰子</button><button class="filter" data-group="按钮与其他">按钮与其他</button><button class="filter" data-group="动画">动画</button><button class="filter" data-group="全部">全部</button></nav><div class="toolbar"><input id="search" aria-label="搜索素材" placeholder="例如：火箭专家、brick、dice、btn"><small id="count"></small></div><div class="gallery" id="gallery"></div></section>
<section class="divider"><h2>界面保存了哪些布局参数？</h2><p class="sublead">坐标是 Cocos 局部设计坐标，正 Y 向上；空值表示序列化时省略。运行时的 Layout、Widget 和脚本会进一步调整布局与显示状态。</p><div class="toolbar"><select class="layout-select" id="page-select" aria-label="选择界面"></select><a id="page-source" target="_blank" rel="noopener">打开 APK 中的序列化文件 ↗</a></div><div class="table-wrap"><table><thead><tr><th>节点</th><th>尺寸 W×H</th><th>局部坐标 X/Y/Z</th><th>文字与字号</th></tr></thead><tbody id="node-table"></tbody></table></div></section><div class="actions"><a href="REPORT.md">完整分析</a><a href="data/prefab-layouts.json">全部布局 JSON</a><a href="data/sprite-catalog.json">全部精灵元数据</a><a href="data/bitmap-font.json">位图字体参数</a></div></main><footer>来源：桌思游想 APK 4.26.2 · MagicalAthlete · 素材与原图保留来源，静态复原单独标明</footer><dialog id="zoom"><div class="dialoghead"><strong id="zoom-title"></strong><button id="close">关闭 ×</button></div><img id="zoom-image" alt=""><a id="zoom-link" target="_blank" rel="noopener">打开原始文件 ↗</a></dialog><script id="data" type="application/json">__DATA__</script><script>
const D=JSON.parse(document.querySelector('#data').textContent),$=s=>document.querySelector(s);let group='角色';const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const fmt=a=>Array.isArray(a)?a.map(x=>Number(Number(x).toFixed(2))).join(' × '):'—';
function gallery(){const q=$('#search').value.trim().toLowerCase(),rows=D.assets.filter(a=>(group==='全部'||a.group===group)&&a.name.toLowerCase().includes(q));$('#count').textContent=rows.length+' 个素材';$('#gallery').innerHTML=rows.map(a=>`<figure class="asset"><button data-zoom="${esc(a.src)}" data-name="${esc(a.name)}" aria-label="放大 ${esc(a.name)}"><img loading="lazy" src="${esc(a.src)}" alt="${esc(a.name)}"></button><figcaption>${esc(a.name)}<small>${esc(a.group)} · ${fmt(a.size)}</small></figcaption></figure>`).join('')||'<p>没有匹配的素材。</p>'}
document.querySelectorAll('[data-group]').forEach(b=>b.addEventListener('click',()=>{group=b.dataset.group;document.querySelectorAll('[data-group]').forEach(t=>t.classList.toggle('active',t===b));gallery()}));$('#search').addEventListener('input',gallery);
const pages=[...D.pages].sort((a,b)=>a.path==='Entry'?-1:b.path==='Entry'?1:0);for(let i=0;i<pages.length;i++){const o=document.createElement('option');o.value=i;o.textContent=pages[i].name+' / '+pages[i].path;$('#page-select').append(o)}function page(){const p=pages[Number($('#page-select').value)];$('#page-source').href=p.file;$('#node-table').innerHTML=p.nodes.map(n=>`<tr><td>${esc(n.name)}${n.hidden?' ［初始隐藏］':''}</td><td>${esc(fmt(n.size))}</td><td>${esc(fmt(n.position))}</td><td>${esc(n.text??'')}${n.font?' ('+n.font+')':''}</td></tr>`).join('')}$('#page-select').addEventListener('change',page);
document.addEventListener('click',e=>{const b=e.target.closest('[data-zoom]');if(!b)return;e.preventDefault();$('#zoom-title').textContent=b.dataset.name||b.alt||b.textContent;$('#zoom-image').src=b.dataset.zoom;$('#zoom-image').alt=$('#zoom-title').textContent;$('#zoom-link').href=b.dataset.zoom;$('#zoom').showModal()});$('#close').addEventListener('click',()=>$('#zoom').close());$('#zoom').addEventListener('click',e=>{if(e.target===$('#zoom'))$('#zoom').close()});gallery();page();
</script></body></html>'''
    (OUT/'index.html').write_text(doc.replace('__DATA__',payload))

def main():
    PREVIEWS.mkdir(exist_ok=True)
    annotate_source()
    sheet(ROLES,PREVIEWS/'characters-sheet.png','胡闹运动会 · 36 名参赛者','原始角色贴图 / 保留完整轮廓与透明边缘',columns=6)
    names=['brick_1','brick_2','brick_3','brick_4','brick_5','brick_black','brick_white','map_score','map_move','map_trip','map_final','mask_trip','seat_1','seat_2','seat_3','seat_4','seat_5','seat_6','btn_confirm','btn_cancel','rank_1','rank_2','icon_round','icon_vs']
    sheet(names,PREVIEWS/'controls-sheet.png','胡闹运动会 · 赛道、棋子与操作控件','图集裁出的原始素材 / 按钮保留描边、阴影与切片参数',columns=6,cell=(210,175))
    render_dialog('prefab/DialogPickConfirm',PREVIEWS/'ability-confirm-static.png')
    render_dialog('prefab/DialogDiceConfirm',PREVIEWS/'dice-confirm-static.png',sample_dice=True)
    write_report();write_html()
    print(json.dumps({'prefabs':len(PREFABS),'roles':len(ROLES),'sprites':len(SPRITES),'output':str(OUT),'report_chars':len((OUT/'REPORT.md').read_text())},ensure_ascii=False))

if __name__=='__main__':main()
