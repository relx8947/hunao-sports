'use strict';
// 头像美术：一代 + 二代 72 名运动员都有专属 SVG 与主色，且页面按顺序加载 art.js → art2.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Art = require('../public/art2.js');
const { RACERS_ALL, RACERS, RACERS2 } = require('../game/racers');

assert.equal(Art, require('../public/art.js'), 'art2.js 应扩展同一个 Art 对象');
assert.equal(RACERS_ALL.length, 72);

const fallback = Art.racer('__no_such_racer__');
const seen = new Map();
for (const { id } of RACERS_ALL) {
  const svg = Art.racer(id);
  assert.equal(typeof svg, 'string', `${id} 应返回字符串`);
  assert.ok(svg.includes('<svg'), `${id} 应返回 <svg>`);
  assert.ok(!/NaN|undefined/.test(svg), `${id} 的 SVG 不应含 NaN/undefined`);
  assert.notEqual(svg, fallback, `${id} 不应回落到占位图`);
  assert.ok(!seen.has(svg), `${id} 与 ${seen.get(svg)} 的头像完全相同`);
  seen.set(svg, id);
}
assert.equal(seen.size, 72);

// 主色：72 名都有专属颜色（不回落灰色），且两两不同
const colors = RACERS_ALL.map(r => Art.color(r.id));
assert.ok(colors.every(c => /^#[0-9A-F]{6}$/i.test(c) && c !== Art.color('__no_such_racer__')), '每名运动员都应有主色');
assert.equal(new Set(colors.map(c => c.toUpperCase())).size, 72, '72 名运动员的主色应互不相同');

// 注册表：一代 36 名 + 二代 36 名都已登记
assert.deepEqual([...Art.ids].sort(), [...RACERS, ...RACERS2].map(r => r.id).sort());

// 页面脚本顺序：art.js 之后、app.js 之前加载 art2.js
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const at = name => order.indexOf(name);
assert.ok(at('art2.js') > at('art.js') && at('art.js') >= 0, 'art2.js 应在 art.js 之后');
assert.ok(at('art2.js') < at('app.js'), 'art2.js 应在 app.js 之前');

console.log('art2 ok: 72 名运动员头像与主色齐全且互不相同');
