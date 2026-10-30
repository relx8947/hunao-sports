#!/usr/bin/env node
'use strict';
// 查看 / 重放对局日志（server/gamelog.js 写的 NDJSON）
//   node scripts/game-log.js <目录>                 列出所有对局（时间、房间、模式、玩家、结束原因）
//   node scripts/game-log.js <文件> [--grep 文字]    按时间线打印事件和每个决策（--grep 只看含该文字的行）
//   node scripts/game-log.js <文件> --verify         用当前引擎按种子 + 决策重放，逐条对比事件是否一致
//   node scripts/game-log.js <文件> --json           原样输出事件 JSON（一行一个），方便再用 grep/jq
//   node scripts/game-log.js <文件> --reports        只看玩家点「反馈问题」的记录，每条附上反馈位置之前的 20 条事件
const fs = require('fs');
const path = require('path');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');
const { engineVersion } = require('../server/gamelog');

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--grep');
const flag = (f) => args.includes(f);
const grep = args.includes('--grep') ? args[args.indexOf('--grep') + 1] : null;
if (!target) { console.error('用法见文件头注释'); process.exit(2); }

function read(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { return { k: 'bad', line: i + 1 }; }
  });
}
const fmtT = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(3)}:${String(s % 60).padStart(2, '0')}`; };

if (fs.statSync(target).isDirectory()) {
  const files = fs.readdirSync(target).filter((f) => f.endsWith('.ndjson')).sort();
  for (const f of files) {
    const recs = read(path.join(target, f));
    const st = recs.find((r) => r.k === 'start') || {};
    const end = recs.find((r) => r.k === 'end');
    const races = recs.filter((r) => r.k === 'ev').reduce((n, r) => n + r.events.filter((e) => e.t === 'raceEnd').length, 0);
    const who = (st.players || []).map((p) => p.ai && !p.name.includes('AI') ? `${p.name}(AI)` : p.name).join('、');
    const reports = recs.filter((r) => r.k === 'report').length;
    console.log(`${f}  ${st.mode || '?'}/${st.edition || '?'}  ${races}/4 场  ${end ? end.reason : '未结束'}  ${who}${reports ? `  ★ 反馈 ${reports} 条` : ''}`);
  }
  process.exit(0);
}

const recs = read(target);
const st = recs.find((r) => r.k === 'start');
if (!st) { console.error('不是对局日志：缺少 start'); process.exit(1); }
const names = st.players.map((p) => p.name);

if (flag('--verify')) {
  const cur = engineVersion();
  if (cur !== st.engine) console.log(`注意：日志引擎版本 ${st.engine}，当前 ${cur}，规则代码改过，对不上是正常的`);
  const g = new Game({ players: st.players, seed: st.seed, edition: st.edition });
  g.start();
  const got = g.drain();
  for (const r of recs) {
    if (r.k !== 'ans') continue;
    // AI / 托管 / 超时代打的决策在服务端由 decide() 算出，它会消耗对局随机数；重放时照样调用一次，随机序列才对得上
    if (r.by !== 'human' && g.pending) decide(g, g.pending, r.seat);
    const err = g.answer(r.seat, r.id, r.value);
    if (err) { console.log(`重放在决策 #${r.id}（${r.kind}，席位 ${r.seat}）失败：${err}`); break; }
    got.push(...g.drain());
  }
  const want = recs.filter((r) => r.k === 'ev').flatMap((r) => r.events);
  const n = Math.min(got.length, want.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(got[i]) !== JSON.stringify(want[i])) {
      console.log(`第 ${i + 1} 条事件起不一致：\n  日志：${JSON.stringify(want[i])}\n  重放：${JSON.stringify(got[i])}`);
      process.exit(1);
    }
  }
  console.log(want.length === got.length ? `重放一致：${n} 条事件` : `前 ${n} 条一致；日志 ${want.length} 条，重放 ${got.length} 条`);
  process.exit(0);
}

if (flag('--reports')) {
  const events = recs.filter((r) => r.k === 'ev').flatMap((r) => r.events);
  const reports = recs.filter((r) => r.k === 'report');
  if (!reports.length) console.log('这局没有反馈');
  for (const r of reports) {
    console.log(`\n★ ${fmtT(r.t)} ${r.name}（席位 ${r.seat}）第 ${r.race} 场：${r.text || '（没写说明）'}`);
    console.log(`  画面播放到第 ${r.seq ?? '?'} 条，服务端最新第 ${r.latest} 条；之前的事件：`);
    const upto = r.seq || r.latest;
    for (const e of events.filter((x) => x.seq <= upto).slice(-20)) console.log(`    ${String(e.seq).padStart(5)} ${e.t}  ${e.text || (e.t === 'move' ? `${e.rid} ${e.from}→${e.to}` : e.t === 'power' ? `技能 ${e.key}` : '')}`);
  }
  process.exit(0);
}

if (flag('--json')) {
  for (const r of recs) if (r.k === 'ev') for (const e of r.events) console.log(JSON.stringify(e));
  process.exit(0);
}

console.log(`${st.at}  房间 ${st.room}  ${st.mode}/${st.edition}  种子 ${st.seed}  引擎 ${st.engine}`);
console.log(`玩家：${st.players.map((p, i) => `${i}:${p.name}${p.ai && !p.name.includes('AI') ? '(AI)' : ''}`).join('  ')}`);
for (const r of recs) {
  let lines = [];
  if (r.k === 'ans') lines = [`  ▶ ${names[r.seat]} [${r.kind} #${r.id}] 选 ${JSON.stringify(r.value)}（${r.by}）`];
  else if (r.k === 'ev') {
    lines = r.events.map((e) => {
      const extra = e.t === 'rolls' ? ` [${e.dice.join(' ')}]` : e.t === 'roll' || e.t === 'voided' ? ` [${e.value}]` : e.t === 'calc' ? ` [${e.raw ?? e.base}→${e.total}]` : '';
      return `    ${String(e.seq).padStart(5)} ${e.t}${extra}  ${e.text || (e.t === 'power' ? `技能 ${e.key}（${e.rid}）` : e.t === 'move' ? `${e.rid} ${e.from}→${e.to}` : '')}`;
    });
  } else if (r.k === 'end') lines = [`■ 结束：${r.reason}${r.scores ? `  比分 ${r.scores.join('/')}` : ''}`];
  else if (r.k === 'truncated') lines = ['■ 日志超过单文件上限，之后的没有记录'];
  else if (r.k === 'report') lines = [`★★ 反馈 ${r.name}（席位 ${r.seat}）看到第 ${r.seq ?? '?'} 条：${r.text || '（没写说明）'}`];
  for (const l of lines) if (!grep || l.includes(grep)) console.log(`${r.t != null ? fmtT(r.t) : '      '} ${l}`);
}
