#!/usr/bin/env python3
"""Restore the 36 character illustrations to their original transparent canvas."""
from pathlib import Path
import hashlib
import json
import zipfile
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]

def main():
    prefabs=json.loads((ROOT/'data/prefab-layouts.json').read_text())
    entry=next(p for p in prefabs if p['path']=='Entry')
    names=[n['_name'] for n in entry['nodes'] if n['hierarchy_path'].startswith('Entry/RefKit/')]
    sprites={p['name']:p for p in json.loads((ROOT/'data/sprite-catalog.json').read_text())}
    output=ROOT/'assets/characters';output.mkdir(parents=True,exist_ok=True)
    records=[]
    for index,name in enumerate(names,1):
        record=sprites[name];meta=record['sprite'];image=Image.open(ROOT/record['preview']).convert('RGBA')
        width,height=meta['originalSize']['width'],meta['originalSize']['height']
        left=(width-image.width)/2+meta['offset']['x']
        top=(height-image.height)/2-meta['offset']['y']
        if left!=round(left) or top!=round(top):raise ValueError('Non-integer trim offset: '+name)
        left,top=round(left),round(top)
        if left<0 or top<0 or left+image.width>width or top+image.height>height:raise ValueError('Invalid trim bounds: '+name)
        canvas=Image.new('RGBA',(width,height),(0,0,0,0));canvas.alpha_composite(image,(left,top))
        file=output/(name+'.png');canvas.save(file)
        # Confirm all visible source pixels and alpha survive canvas restoration.
        restored=canvas.crop((left,top,left+image.width,top+image.height))
        original_bytes,restored_bytes=image.tobytes(),restored.tobytes()
        if any(original_bytes[i+3]!=restored_bytes[i+3] or (original_bytes[i+3] and original_bytes[i:i+4]!=restored_bytes[i:i+4]) for i in range(0,len(original_bytes),4)):raise ValueError('Visible pixels changed: '+name)
        records.append({'asset_id':f'athlete_{index:02d}','name':name,'image':str(file.relative_to(ROOT)),
            'width':width,'height':height,'pivot':meta.get('pivot'),
            'trimmed_size':[image.width,image.height],
            'placement':[left,top],'source_uuid':record['uuid'],
            'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
    if len(records)!=36:raise ValueError('Unexpected character count')
    manifest={'schema_version':1,'source':'桌思游想 4.26.2 / MagicalAthlete','count':len(records),
        'format':'PNG RGBA','canvas':[256,256],
        'placement_rule':'left=(originalWidth-trimmedWidth)/2+offset.x; top=(originalHeight-trimmedHeight)/2-offset.y',
        'asset_id_note':'Export identifiers follow the extracted reference order and are not runtime character IDs.',
        'characters':records}
    (ROOT/'data/characters.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    instructions='''# 胡闹运动会人物插画素材

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
'''
    (output/'README.md').write_text(instructions)
    exports=ROOT/'exports';exports.mkdir(exist_ok=True);package=exports/'characters.zip'
    with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        archive.writestr('magical-athlete-characters/README.md',instructions)
        archive.write(ROOT/'data/characters.json','magical-athlete-characters/data/characters.json')
        for record in records:archive.write(ROOT/record['image'],'magical-athlete-characters/'+record['image'])
    with zipfile.ZipFile(package) as archive:
        if archive.testzip():raise ValueError('Character package failed CRC validation')
    for file in list(output.glob('*'))+[ROOT/'data/characters.json',package]:file.chmod(0o644)
    output.chmod(0o755);exports.chmod(0o755);(ROOT/'assets').chmod(0o755)
    result={'characters':len(records),'canvas':[256,256],'visible_pixels_preserved':True,'package':'exports/characters.zip','package_bytes':package.stat().st_size,'passed':True}
    (ROOT/'evidence/characters-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
