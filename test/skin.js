'use strict';
// 皮肤素材：纯函数返回合法 SVG、共享 defs 引用都能解析、不含位图、CSS/页面/脚本接线齐全
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Skin = require('../public/skin.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 简单的标签栈检查（SVG/HTML 片段均为我们自己生成，属性里不含 > ）
function wellFormed(str, label) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(str))) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) {
      assert.equal(stack.pop(), name, `${label}: 标签 </${name}> 未正确配对`);
    } else {
      stack.push(name);
    }
  }
  assert.equal(stack.length, 0, `${label}: 有未闭合标签 ${stack.join(',')}`);
}

const defs = Skin.defs();
wellFormed(defs, 'defs');
const defIds = new Set([...defs.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
assert.equal(defIds.size, [...defs.matchAll(/\bid="([^"]+)"/g)].length, 'defs 内 id 不应重复');
assert.ok(defIds.has('sk-paper'), '应有共享纸纹滤镜 sk-paper');
assert.ok(defs.length < 90 * 1024, `defs 体积应受控（当前 ${defs.length}）`);
assert.deepEqual([...Skin.symbolIds()].sort(), [...defIds].filter(i => /^sk-/.test(i) && new RegExp(`<symbol[^>]*id="${i}"`).test(defs)).sort(), 'symbolIds 应与 defs 内 symbol 一致');

const samples = {};
const add = (k, v) => { samples[k] = v; };

Skin.CELL_ORDER.forEach(c => { add('cell ' + c, Skin.cell(c)); add('cell num ' + c, Skin.cell(c, { num: 15, size: 48 })); });
['red', 'yellow', 'green', 'blue', 'purple', 'black', 'white'].forEach(c => assert.ok(Skin.CELL_ORDER.includes(c), `缺少赛道格颜色 ${c}`));
for (let i = 0; i < 7; i++) add('cell idx ' + i, Skin.cell(i));
['score', 'move', 'trip', 'finish', 'start'].forEach(k => { add('cell icon ' + k, Skin.cell('yellow', { icon: k })); add('mark ' + k, Skin.mark(k, { size: 40 })); });
Skin.SEAT_ORDER.forEach(c => add('seat ' + c, Skin.seat(c)));
assert.equal(Skin.SEAT_ORDER.length, 6, '应有六色底座');
for (let i = 0; i < 6; i++) add('seat idx ' + i, Skin.seat(i, { size: 28 }));
for (let n = 1; n <= 6; n++) {
  ['idle', 'rolling', 'win', 'dim', 'flat'].forEach(s => add(`dice ${n} ${s}`, Skin.dice(n, s)));
  add(`dice ${n} tilt`, Skin.dice(n, { tilt: -18, size: 28 }));
}
add('vs', Skin.vs()); add('vs 28', Skin.vs({ size: 28 }));
add('plus 3', Skin.plus(3)); add('plus 12', Skin.plus(12, { size: 48 })); add('plus -2', Skin.plus(-2));
add('star', Skin.star()); add('star empty', Skin.star({ empty: true, size: 20 }));
[1, 2, 3].forEach(r => { add('medal ' + r, Skin.medal(r)); add('medal 32 ' + r, Skin.medal(r, { size: 32 })); });
add('flag', Skin.flag({ color: '#F2553C' })); add('finishFlag', Skin.finishFlag()); add('startFlag', Skin.startFlag());
add('tripMask', Skin.tripMask());
['#F2553C', '#FFC53D', '#4D9DF7'].forEach(c => { add('flash ' + c, Skin.flash(c)); add('burst ' + c, Skin.burst(c)); add('burst small ' + c, Skin.burst(c, { small: true, size: 40 })); });

let total = 0;
for (const [k, svg] of Object.entries(samples)) {
  assert.equal(typeof svg, 'string', `${k} 应返回字符串`);
  assert.ok(svg.startsWith('<svg'), `${k} 应以 <svg 开头`);
  assert.ok(/viewBox="/.test(svg), `${k} 应有 viewBox（可缩放）`);
  assert.ok(!/NaN|undefined|null/.test(svg), `${k} 不应含 NaN/undefined/null`);
  assert.ok(svg.length < 6000, `${k} 体积过大（${svg.length}）：应复用 symbol`);
  wellFormed(svg, k);
  for (const m of svg.matchAll(/(?:href|xlink:href)="#([^"]+)"/g)) assert.ok(defIds.has(m[1]), `${k} 引用了不存在的 #${m[1]}`);
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(defIds.has(m[1]), `${k} 引用了不存在的 url(#${m[1]})`);
  total += svg.length;
}
assert.ok(Object.keys(samples).length >= 100, '样本数量应覆盖所有素材');
assert.ok(total / Object.keys(samples).length < 1500, '实例平均体积应小（共享 defs）');

// 确定性：同样参数输出完全一致
assert.equal(Skin.cell('red', { num: 5 }), Skin.cell('red', { num: 5 }));
assert.equal(Skin.dice(4, 'idle'), Skin.dice(4, 'idle'));
assert.equal(Skin.defs(), Skin.defs());
assert.notEqual(Skin.dice(1), Skin.dice(2), '不同点数应不同');
assert.notEqual(Skin.cell('red'), Skin.cell('blue'));
assert.notEqual(Skin.seat('red'), Skin.seat('blue'));

// standalone 内嵌 defs 后自洽
const alone = Skin.cell('green', { standalone: true });
wellFormed(alone, 'standalone');
assert.ok(alone.includes('id="sk-paper"') || alone.includes('sk-cell-green'), 'standalone 应内嵌 defs');

// 注入防护：非法颜色/文字不能打破属性
const evil = Skin.flash('red" onload="x', {});
assert.ok(!/onload=/.test(evil), '非法颜色应被过滤');
const html = Skin.pcard({ name: '<img src=x onerror=1>', color: '#F2553C', score: 3, avatar: '<svg viewBox="0 0 1 1"></svg>' });
assert.ok(!html.includes('<img'), 'pcard 名字应转义');
assert.ok(!/onerror=1>/.test(html.replace(/&lt;img src=x onerror=1&gt;/g, '')), 'pcard 名字应转义');
const ban = Skin.banner('<b>x</b>', { round: '1/4' });
assert.ok(!ban.includes('<b>x</b>') && ban.includes('sk-banner') && ban.includes('1/4'), 'banner 应转义文字并带回合数');
wellFormed(ban, 'banner');
wellFormed(html, 'pcard');
const btn = Skin.button('投掷骰子', '根据点数前进', 'primary');
assert.ok(/class="sk-btn primary"/.test(btn) && btn.includes('投掷骰子') && btn.includes('根据点数前进'), 'button 应为双行');
assert.ok(/sk-btn secondary/.test(Skin.button('a', 'b', 'secondary')));
wellFormed(btn, 'button');

// 版权红线：源码与产物里不得出现位图、base64 或精灵文件
for (const f of ['public/skin.js', 'public/skin.css', 'public/skin-demo.html']) {
  const src = read(f);
  assert.ok(!/data:image|base64|<image\b|url\(["']?[^)#"']*\.(png|jpe?g|gif|webp)/i.test(src), `${f} 不得含位图/base64`);
  assert.ok(!/sprite|spritesheet/i.test(src.replace(/不得[^\n]*/g, '')), `${f} 不得引用精灵图`);
}
for (const svg of Object.values(samples)) assert.ok(!/<image|data:image|base64/i.test(svg));
assert.ok(!/<image|data:image|base64/i.test(defs));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', '.git', '.claude'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
const bitmaps = walk(root).filter(f => /skin|hunao.*sprite/i.test(path.basename(f)) && /\.(png|jpe?g|gif|webp)$/i.test(f));
assert.deepEqual(bitmaps, [], '仓库内不应有皮肤相关位图');

// CSS 接线
const css = read('public/skin.css');
for (const sel of ['.sk-btn', '.sk-btn.primary', '.sk-btn.secondary', '.sk-pcard', '.sk-banner']) assert.ok(css.includes(sel), `skin.css 缺少 ${sel}`);
assert.ok(/aspect-ratio:\s*700\s*\/\s*90/.test(css), '.sk-banner 应为 700x90 比例');
assert.ok(/prefers-reduced-motion/.test(css), '应尊重减少动效偏好');

// 页面与脚本接线
const idx = read('public/index.html');
assert.ok(/<script src="skin\.js" defer><\/script>/.test(idx), 'index.html 应引入 skin.js');
assert.ok(/<link rel="stylesheet" href="skin\.css">/.test(idx), 'index.html 应引入 skin.css');
assert.ok(fs.existsSync(path.join(root, 'public/skin-demo.html')));
const pkg = JSON.parse(read('package.json'));
assert.equal(pkg.scripts['test:skin'], 'node test/skin.js');
assert.ok(/node test\/skin\.js\s*$/.test(pkg.scripts.test), 'test 链末尾应包含 test/skin.js');

console.log(`skin ok：${Object.keys(samples).length} 个样本，defs ${(defs.length / 1024).toFixed(1)} KB，symbol ${defIds.size} 个 id`);
