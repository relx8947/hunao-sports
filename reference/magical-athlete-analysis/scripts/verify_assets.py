#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re
import zipfile
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]

class Links(HTMLParser):
    def __init__(self):super().__init__();self.paths=[]
    def handle_starttag(self,tag,attrs):
        self.paths.extend(v for k,v in attrs if k in ('src','href','data-zoom') and v and not v.startswith(('http:','https:','#','data:')))

def main():
    # The README links to this result; create an honest in-progress record first.
    (ROOT/'evidence/assets-check.json').write_text(json.dumps({'status':'running'},indent=2))
    errors=[];sprites=json.loads((ROOT/'data/sprite-catalog.json').read_text());shared=json.loads((ROOT/'data/shared-sprite-catalog.json').read_text());prefabs=json.loads((ROOT/'data/prefab-layouts.json').read_text())
    for record in sprites+shared:
        if not (ROOT/record['preview']).is_file():errors.append('Missing sprite '+record['preview'])
    for record in prefabs:
        if not (ROOT/record['import_file']).is_file():errors.append('Missing source '+record['import_file'])
    character_manifest=ROOT/'data/characters.json'
    characters=[]
    if character_manifest.exists():
        characters=json.loads(character_manifest.read_text())['characters']
        if len(characters)!=36:errors.append('Unexpected illustration count')
        for character in characters:
            file=ROOT/character['image']
            if not file.is_file():errors.append('Missing illustration '+character['image']);continue
            with Image.open(file) as image:
                if image.size!=(256,256) or image.mode!='RGBA':errors.append('Invalid illustration canvas '+character['name'])
                image.verify()
            if hashlib.sha256(file.read_bytes()).hexdigest()!=character['sha256']:errors.append('Illustration digest differs '+character['name'])
        with zipfile.ZipFile(ROOT/'exports/characters.zip') as archive:
            if archive.testzip():errors.append('Illustration package CRC failure')
    for file in list((ROOT/'sprites').glob('*.png'))+list((ROOT/'shared-sprites').glob('*.png'))+list((ROOT/'previews').glob('*.png')):
        with Image.open(file) as image:image.verify()
    html=(ROOT/'index.html').read_text();parser=Links();parser.feed(html)
    for link in parser.paths:
        if not (ROOT/link).exists():errors.append('Broken HTML link '+link)
    embedded=re.search(r'<script id="data" type="application/json">(.*?)</script>',html,re.S)
    if not embedded:errors.append('Missing browser data')
    else:
        data=json.loads(embedded.group(1))
        for record in data['assets']:
            if not (ROOT/record['src']).is_file():errors.append('Broken browser asset '+record['src'])
        for record in data['pages']:
            if not (ROOT/record['file']).is_file():errors.append('Broken browser source '+record['file'])
    for file in ['README.md','HANDOFF.md','REPORT.md']:
        for link in re.findall(r'\]\(([^)]+)\)',(ROOT/file).read_text()):
            if not link.startswith(('http:','https:','#')) and not (ROOT/link).exists():errors.append('Broken Markdown link '+link)
    provenance=json.loads((ROOT/'evidence/download.json').read_text());apk=ROOT/'apk/zhuosiyouxiang-4.26.2.apk'
    digest=hashlib.sha256()
    with apk.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''):digest.update(chunk)
    sha256=digest.hexdigest()
    if sha256!=provenance['sha256']:errors.append('APK SHA-256 differs from download record')
    sources=0
    with zipfile.ZipFile(apk) as archive:
        for file in sorted((ROOT/'source/MagicalAthlete').rglob('*')):
            if not file.is_file():continue
            member='assets/assets/MagicalAthlete/'+file.relative_to(ROOT/'source/MagicalAthlete').as_posix()
            if archive.read(member)!=file.read_bytes():errors.append('Source differs from APK '+member)
            sources+=1
    if len(sprites)!=197 or len(shared)!=6 or len(prefabs)!=16:errors.append('Unexpected target resource counts')
    result={'scope':'胡闹运动会 / MagicalAthlete','prefabs':len(prefabs),'sprites':len(sprites),'shared_sprites':len(shared),'ready_to_use_character_illustrations':len(characters),'source_files_match_apk':sources,'apk_sha256_matches_download':sha256==provenance['sha256'],'errors':errors,'passed':not errors}
    (ROOT/'evidence/assets-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
    if errors:raise SystemExit(1)

if __name__=='__main__':main()
