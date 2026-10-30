'use strict';
// 对局日志：整局写盘、按种子 + 决策重放一致、保留期与总量上限
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHub } = require('../server/hub');
const { createGameLog } = require('../server/gamelog');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunao-log-'));
const DAY = 24 * 60 * 60 * 1000;
let checks = 0;
const ok = (name) => { checks++; console.log(`✓ ${name}`); };

function play(edition, humanActs = true) {
  let time = Date.UTC(2026, 9, 27, 4, 0, 0), next = 0;
  const timers = new Map();
  const dir = path.join(tmp, edition);
  const hub = createHub({ now: () => time, random: () => 0.42, logDir: dir,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++next; }, clearInterval() {},
  });
  const ws = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  hub.handle(ws, { type: 'hello', name: '真人' });
  assert.equal(hub.handle(ws, { type: 'quick', ai: 3, edition }), null);
  const room = hub.rooms.get(ws.room);
  for (let guard = 0; guard < 50000 && room.game.phase !== 'over'; guard++) {
    const d = room.game.pending;
    // 真人席：一半自己点、一半等超时，日志里要能分清
    if (humanActs && d && (d.simul ? d.seats.includes(0) && d.answers[0] === undefined : d.seat === 0) && guard % 2) {
      assert.equal(hub.handle(ws, { type: 'act', gameId: room.gameId, id: d.id, value: (d.simul ? d.optionsBySeat[0] : d.options)[0].v }), null);
      continue;
    }
    const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    assert(task, '对局卡住');
    timers.delete(id); time = Math.max(time, task.at); task.fn();
  }
  assert.equal(room.game.phase, 'over');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1);
  hub.dispose();
  return path.join(dir, files[0]);
}

for (const edition of ['v1', 'mix']) {
  const file = play(edition);
  const recs = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(recs[0].k, 'start');
  assert.equal(recs[0].edition, edition);
  assert.equal(recs[0].mode, 'play');
  assert.match(path.basename(file), /^\d{8}-\d{6}_[A-Z0-9]{4}_[0-9a-f]{8}\.ndjson$/);
  assert.equal(recs.at(-1).k, 'end');
  assert.equal(recs.at(-1).reason, 'over');
  const by = new Set(recs.filter((r) => r.k === 'ans').map((r) => r.by));
  for (const b of ['human', 'ai', 'timeout']) assert(by.has(b), `应记录 ${b} 决策`);
  const events = recs.filter((r) => r.k === 'ev').flatMap((r) => r.events);
  assert(events.some((e) => e.t === 'gameOver'));
  // 结束记录的比分要和终局事件一致（之前读了不存在的 p.score，全是 null）
  const over = events.find((e) => e.t === 'gameOver');
  const endScores = recs.at(-1).scores;
  assert(endScores.every((v) => Number.isInteger(v)), `结束记录比分应为整数：${JSON.stringify(endScores)}`);
  if (Array.isArray(over.scores)) assert.deepEqual(endScores, over.scores.map((x) => (typeof x === 'object' ? x.score : x)));
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'game-log.js'), file, '--verify'], { encoding: 'utf8' });
  assert.match(out, /^重放一致：\d+ 条事件/m, out);
  ok(`${edition}：整局写入 start/ans/ev/end，human/ai/timeout 可区分，按种子重放 ${events.length} 条事件一致`);
}

{
  const dir = path.join(tmp, 'prune');
  fs.mkdirSync(dir);
  const t = Date.now();
  const mk = (name, ageDays, size = 10) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, 'x'.repeat(size));
    const at = (t - ageDays * DAY) / 1000;
    fs.utimesSync(f, at, at);
  };
  mk('old.ndjson', 31); mk('mid.ndjson', 20); mk('new.ndjson', 1); mk('keep.txt', 99);
  createGameLog({ dir, now: () => t, retentionDays: 30 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['keep.txt', 'mid.ndjson', 'new.ndjson']);
  ok('超过 30 天的对局日志在启动时删除，别的文件不动');
  mk('a.ndjson', 3, 600); mk('b.ndjson', 2, 600);
  createGameLog({ dir, now: () => t, retentionDays: 30, maxTotalBytes: 700 });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['b.ndjson', 'keep.txt', 'new.ndjson']);
  ok('总量超上限时从最旧的删起');
}

{
  const dir = path.join(tmp, 'cap');
  const log = createGameLog({ dir, maxFileBytes: 400 });
  const h = log.begin({ gameId: 'abcdef0123', room: 'ABCD', mode: 'play', edition: 'v1', seed: 1, players: [] });
  for (let i = 0; i < 20; i++) h.events([{ t: 'info', text: '一二三四五六七八九十' }]);
  const recs = fs.readFileSync(h.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(recs.at(-1).k, 'truncated');
  assert(fs.statSync(h.file).size < 600);
  ok('单文件超过上限后写一条 truncated 并停止');
}

{
  const log = createGameLog({});
  const h = log.begin({ gameId: 'x', room: 'ABCD' });
  h.events([{ t: 'info' }]); h.answer(0, { id: 1, kind: 'roll' }, 'roll', 'human'); h.end('over');
  assert.equal(h.file, null);
  ok('未配置目录时完全不写盘（测试与 require 默认）');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`对局日志验收通过：${checks} 项`);
