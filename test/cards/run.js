'use strict';
// 卡牌测试运行器：执行 test/cards/*.test.js
//   node test/cards/run.js            全部
//   node test/cards/run.js v2-a       只跑文件名含 v2-a 的
//   node test/cards/run.js --quiet    只打印失败、疑似 bug 和汇总
const fs = require('fs');
const path = require('path');
const { setFile, registry } = require('./helpers');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const filter = args.find((a) => !a.startsWith('--'));
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort();
for (const f of files) { setFile(f); require(path.join(__dirname, f)); }

let pass = 0, fail = 0, bugs = 0, fixed = 0;
let lastFile = null;
for (const t of registry) {
  if (t.file !== lastFile && !quiet) { console.log(`\n== ${t.file}`); lastFile = t.file; }
  let err = null;
  try { t.fn(); } catch (e) { err = e; }
  if (t.kind === 'bug') {
    if (err) { bugs++; console.log(`  ? [疑似 bug] ${t.file} · ${t.name}\n      ${t.note || ''}\n      ${String(err.message).split('\n')[0]}`); }
    else { fixed++; console.log(`  ! [已修复] ${t.file} · ${t.name}：断言已通过，请改成 test()`); }
  } else if (err) {
    fail++;
    console.log(`  ✗ ${t.file} · ${t.name}\n      ${err.stack.split('\n').slice(0, 3).join('\n      ')}`);
  } else {
    pass++;
    if (!quiet) console.log(`  ✓ ${t.name}`);
  }
}
console.log(`\n卡牌测试：${files.length} 个文件，通过 ${pass}，失败 ${fail}，疑似 bug ${bugs}${fixed ? `，已修复待转正 ${fixed}` : ''}`);
process.exit(fail || fixed ? 1 : 0);
