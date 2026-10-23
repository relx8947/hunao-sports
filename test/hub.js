'use strict';
const assert = require('node:assert/strict');
const { createHub } = require('../server/hub');
const { decide } = require('../game/ai');
let count = 0;
function fixture(options = {}) {
  let time = 1000000, next = 0;
  const timers = new Map(), intervals = new Map();
  const hub = createHub({ now: () => time, random: options.random || (() => 0.3),
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++next; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  const socket = name => {
    const ws = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
    assert.equal(hub.handle(ws, { type: 'hello', name }), null);
    return ws;
  };
  const command = (ws, type, data = {}) => hub.handle(ws, {
    type, ...(type === 'act' ? { gameId: hub.rooms.get(ws.room)?.gameId } : {}), ...data,
  });
  const last = (ws, type) => ws.messages.filter(m => m.type === type).at(-1);
  const tick = ms => { time += ms; };
  const runNext = () => {
    const [id, task] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    if (!task) return false;
    timers.delete(id); time = Math.max(time, task.at); task.fn(); return true;
  };
  return { hub, socket, command, last, tick, timers, intervals, runNext, now: () => time };
}
function test(name, fn, options) {
  const f = fixture(options);
  try { fn(f); count++; console.log(`✓ ${name}`); } finally { f.hub.dispose(); }
}
function roomWithHumans(f) {
  const A = f.socket('房主'), B = f.socket('朋友');
  f.command(A, 'create');
  const room = f.hub.rooms.get(A.room);
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  f.command(A, 'addAI');
  assert.equal(f.command(A, 'start'), null);
  return { A, B, room };
}

test('房主主动离开和断线均移交，离开席位由托管继续', f => {
  const { A, B, room } = roomWithHumans(f);
  const oldHost = A.player.id;
  f.hub.disconnect(A);
  assert.equal(room.host, B.player.id);
  assert.equal(f.command(B, 'speed'), null);
  f.command(A, 'hello', { token: f.last(A, 'hello').token });
  assert.notEqual(room.host, oldHost, '重连不能抢走新房主权限');
  f.command(B, 'leave');
  assert.equal(room.host, A.player.id);
  assert.equal(f.last(B, 'left').reason, 'leave');
});

test('手动托管不因其他玩家断线/重连被取消', f => {
  const { A, B, room } = roomWithHumans(f);
  f.command(A, 'auto', { on: true });
  const token = B.player.token;
  f.hub.disconnect(B);
  assert.equal(room.seats[0].autoMode, 'manual');
  f.command(B, 'hello', { token });
  assert.equal(room.seats[0].autoMode, 'manual');
  assert.equal(f.last(A, 'auto').auto[0], true);
});

test('同身份多标签加入和离开同步，身份切换不泄漏旧绑定', f => {
  const A = f.socket('A'), B = f.socket('B'), other = f.socket('另一个身份');
  f.command(A, 'create');
  const room = f.hub.rooms.get(A.room);
  f.command(B, 'join', { code: room.code });
  const tab = f.socket('临时身份');
  f.command(tab, 'hello', { token: A.player.token });
  assert.equal(tab.room, room.code);
  const old = tab.player;
  f.command(tab, 'hello', { token: other.player.token });
  assert(!old.sockets.has(tab));
  assert(!room.clients.has(tab));
  assert.equal(tab.room, null);
  f.command(tab, 'hello', { token: A.player.token });
  f.command(A, 'leave');
  assert.equal(tab.room, null);
  assert.equal(f.last(tab, 'left').reason, 'leave');
  assert.equal(room.host, B.player.id);
});

test('房间过期清除身份room，旧token恢复不会成为幽灵', f => {
  const A = f.socket('A');
  f.command(A, 'quick', { ai: 2 });
  const token = A.player.token, code = A.room;
  f.hub.disconnect(A);
  f.tick(30 * 60 * 1000 + 1); f.hub.cleanup();
  assert(!f.hub.rooms.has(code));
  f.command(A, 'hello', { token });
  assert.equal(f.last(A, 'hello').room, null);
  assert.equal(A.room, null);
});

test('待决策时间不会被其他人的重新hello或调速延长', f => {
  const { A, B, room } = roomWithHumans(f);
  while (room.game.pending && room.game.pending.seat !== 0) assert(f.runNext());
  f.command(A, 'hello', { token: A.player.token });
  const deadline = f.hub.getDeadlineIn(A);
  assert(deadline > 0);
  f.tick(1000);
  f.command(B, 'hello', { token: B.player.token });
  f.command(A, 'speed');
  assert.equal(f.hub.getDeadlineIn(A), deadline - 1000);
  const d = room.game.pending;
  const before = d.id;
  assert.match(f.command(A, 'act', { value: d.options[0].v }), /过期/);
  assert.equal(room.game.pending.id, before);
  f.hub.recover(A);
  assert.equal(f.last(A, 'game').full, true);
  assert.equal(f.hub.errorContext(A, 'act').decisionId, before);
});

test('四场完赛→结算闸门→回大厅→旧离线席清理→重开', f => {
  const { A, B, room } = roomWithHumans(f);
  const token = B.player.token;
  f.command(A, 'auto', { on: true });
  f.command(B, 'auto', { on: true });
  let actions = 0;
  while (room.game.pending && actions++ < 3000) assert(f.runNext(), '托管必须有下一步调度');
  assert.equal(room.game.phase, 'over');
  assert.equal(room.game.results.length, 4);
  assert.equal(room.status, 'over');
  room.busyUntil = f.now() + 500;
  assert.match(f.command(A, 'start'), /大厅/);
  assert.match(f.command(A, 'lobby'), /动画/);
  assert.equal(f.hub.errorContext(A, 'lobby').retryIn, 500);
  f.hub.disconnect(B); f.tick(501);
  assert.equal(f.command(A, 'lobby'), null);
  assert.equal(room.seats.length, 2);
  f.command(B, 'hello', { token });
  assert.equal(f.last(B, 'hello').room, null);
  f.command(B, 'join', { code: room.code });
  assert.equal(f.command(A, 'start'), null);
  assert.equal(room.game.phase, 'draft');
  assert.equal(room.game.results.length, 0);
});

test('非法quick/auto/seat输入拒绝且不改状态', f => {
  const A = f.socket('A');
  assert.match(f.command(A, 'quick', { ai: 2.5 }), /整数/);
  assert.equal(f.hub.rooms.size, 0);
  f.command(A, 'quick', { ai: 2 });
  assert.match(f.command(A, 'auto', { on: 'true' }), /布尔/);
  assert.equal(f.hub.rooms.get(A.room).seats[0].autoMode, null);
});
test('成功 act 只确认请求标签，过期恢复快照不确认动作', f => {
  const { A, B, room } = roomWithHumans(f);
  while (room.game.pending.seat !== 0) assert(f.runNext());
  const d = room.game.pending, value = d.options[0].v;
  const tab = f.socket('新标签');
  f.command(tab, 'hello', { token: A.player.token });
  assert.equal(f.command(A, 'act', { id: d.id, value }), null);
  assert.deepEqual(f.last(A, 'ack'), { type: 'ack', for: 'act', gameId: room.gameId, id: d.id, value });
  assert.equal(f.last(B, 'ack'), undefined);
  assert.equal(f.last(tab, 'ack'), undefined);
  const confirmations = A.messages.filter(m => m.type === 'ack').length;
  assert.match(f.command(A, 'act', { id: d.id, value }), /过期/);
  f.hub.recover(A);
  assert.equal(f.last(A, 'game').full, true);
  assert.equal(A.messages.filter(m => m.type === 'ack').length, confirmations);
});
test('缺失或错误 gameId 拒绝，不回退到仅匹配决策 id', f => {
  const A = f.socket('A');
  f.command(A, 'quick', { ai: 2 });
  const room = f.hub.rooms.get(A.room);
  while (room.game.pending.seat !== 0) assert(f.runNext());
  const d = room.game.pending, value = d.options[0].v;
  f.command(A, 'auto', { on: true });
  const before = JSON.stringify(room.game.snapshot(0));
  const ackCount = A.messages.filter(m => m.type === 'ack').length;
  // 绕开 helper 的正常动作自动补字段，确实发送没有 gameId 的网络动作。
  assert.match(f.hub.handle(A, { type: 'act', id: d.id, value }), /过期/);
  for (const gameId of [undefined, null, '', 1, {}, `${room.gameId}x`]) {
    assert.match(f.command(A, 'act', { gameId, id: d.id, value }), /过期/);
    assert.equal(JSON.stringify(room.game.snapshot(0)), before);
    assert.equal(room.seats[0].autoMode, 'manual');
  }
  assert.equal(A.messages.filter(m => m.type === 'ack').length, ackCount);
  assert.equal(f.last(A, 'game').gameId, room.gameId);
  assert.equal(f.last(A, 'auto').gameId, room.gameId);
  assert.equal(f.hub.errorContext(A, 'act').gameId, room.gameId);
});

test('跨房间同决策 id 的旧标签动作不能操作新局', f => {
  const { A, room: oldRoom } = roomWithHumans(f);
  while (oldRoom.game.pending.seat !== 0) assert(f.runNext());
  const oldDecision = oldRoom.game.pending;
  const oldAct = { gameId: oldRoom.gameId, id: oldDecision.id, value: oldDecision.options[0].v };
  const tab = f.socket('旧标签');
  f.command(tab, 'hello', { token: A.player.token });
  f.command(A, 'quick', { ai: 2 });
  const room = f.hub.rooms.get(A.room);
  while (room.game.pending.seat !== 0) assert(f.runNext());
  assert.notEqual(room, oldRoom);
  assert.notEqual(room.code, oldRoom.code);
  assert.equal(f.hub.rooms.get(oldRoom.code), oldRoom, '另一位真人使原房间继续存在');
  assert.notEqual(room.gameId, oldAct.gameId);
  assert.equal(room.game.pending.id, oldAct.id, '明确制造跨局决策 id 重用');
  assert(room.game.pending.options.some(o => o.v === oldAct.value));
  const before = JSON.stringify(room.game.snapshot(0));
  f.command(A, 'auto', { on: true });
  assert.match(f.command(tab, 'act', oldAct), /过期/);
  assert.equal(JSON.stringify(room.game.snapshot(0)), before);
  assert.equal(room.seats[0].autoMode, 'manual');
  assert.equal(f.last(tab, 'ack'), undefined);
  f.hub.recover(tab);
  assert.equal(f.last(tab, 'game').gameId, room.gameId);
  assert.equal(f.hub.errorContext(tab, 'act').gameId, room.gameId);
  const d = room.game.pending;
  assert.equal(f.command(tab, 'act', { gameId: room.gameId, id: d.id, value: d.options[0].v }), null);
  assert.equal(f.last(tab, 'ack').gameId, room.gameId);
});

test('同房间完赛重开也隔离旧标签保存的动作', f => {
  const A = f.socket('A');
  f.command(A, 'quick', { ai: 2 });
  const room = f.hub.rooms.get(A.room);
  while (room.game.pending.seat !== 0) assert(f.runNext());
  const d = room.game.pending;
  const oldAct = { gameId: room.gameId, id: d.id, value: d.options[0].v };
  const tab = f.socket('旧标签');
  f.command(tab, 'hello', { token: A.player.token });
  f.command(A, 'auto', { on: true });
  let actions = 0;
  while (room.game.pending && actions++ < 3000) assert(f.runNext());
  assert.equal(room.status, 'over');
  f.tick(Math.max(0, room.busyUntil - f.now()));
  assert.equal(f.command(A, 'lobby'), null);
  assert.equal(room.gameId, null);
  assert.equal(f.hub.errorContext(tab, 'act').gameId, null);
  assert.equal(f.command(A, 'start'), null);
  while (room.game.pending.seat !== 0) assert(f.runNext());
  assert.equal(f.hub.rooms.get(A.room), room);
  assert.notEqual(room.gameId, oldAct.gameId);
  assert.equal(room.game.pending.id, oldAct.id, '明确制造同房间重开的决策 id 重用');
  assert(room.game.pending.options.some(o => o.v === oldAct.value));
  const before = JSON.stringify(room.game.snapshot(0));
  assert.match(f.command(tab, 'act', oldAct), /过期/);
  assert.equal(JSON.stringify(room.game.snapshot(0)), before);
  assert.equal(f.last(tab, 'ack'), undefined);
  assert.equal(f.hub.errorContext(tab, 'act').gameId, room.gameId);
});

test('dispose 同步清所有身份与计时器，重复调用及迟到 hello/quick 不复活', f => {
  const { A, B, room } = roomWithHumans(f);
  const idle = f.socket('大厅身份'), tab = f.socket('另一个标签');
  f.command(tab, 'hello', { token: A.player.token });
  const players = [A.player, B.player, idle.player];
  const token = A.player.token;
  const staleTimers = [...f.timers.values(), ...f.intervals.values()];
  assert(f.timers.size > 0);
  assert.equal(f.intervals.size, 1);
  f.hub.dispose();
  assert.equal(f.hub.rooms.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(room.timer, null);
  assert.equal(room.timing, null);
  assert.equal(room.clients.size, 0);
  for (const p of players) { assert.equal(p.sockets.size, 0); assert.equal(p.room, null); }
  for (const ws of [A, B, idle, tab]) { assert.equal(ws.player, null); assert.equal(ws.room, null); }
  const messages = [A, B, idle, tab].map(ws => ws.messages.length);
  f.hub.dispose();
  assert.deepEqual([A, B, idle, tab].map(ws => ws.messages.length), messages, '重复 dispose 不能再发送 left');
  const fresh = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  for (const ws of [A, fresh]) {
    for (const msg of [{ type: 'hello', token }, { type: 'quick', ai: 2 }, { type: 'create' }, null]) {
      assert.equal(f.hub.handle(ws, msg), '服务已关闭');
    }
    assert(!ws.player && !ws.room);
  }
  for (const task of staleTimers) task.fn();
  f.hub.cleanup(); f.hub.recover(A); f.hub.disconnect(A);
  assert.equal(f.hub.rooms.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(fresh.messages.length, 0);
});
function assertSpectatorGame(message, n) {
  assert.equal(message.mode, 'spectator');
  assert.equal(message.you, -1);
  assert.equal(message.deadlineIn, null);
  assert.equal(message.snap.players.length, n);
  assert(message.snap.players.every(p => p.ai));
  const d = message.snap.pending;
  if (d) {
    assert(!Object.hasOwn(d, 'answers'), '暗选不能公开答案');
    if (d.simul) assert.deepEqual(d.optionsBySeat, {});
    else assert.deepEqual(d.options, [], '观众不是决策者，不需要个人选择');
  }
}

for (const n of [3, 4, 6]) test(`${n} 名全 AI 仅由调度自动四场完赛，结算后同房间再看一局`, f => {
  const A = f.socket('观战房主');
  assert.equal(f.command(A, 'watch', n === 4 ? {} : { ai: n }), null);
  const room = f.hub.rooms.get(A.room), game = room.game, gameId = room.gameId;
  const seats = structuredClone(room.seats);
  assert.equal(room.mode, 'spectator');
  assert.equal(room.host, A.player.id);
  assert.deepEqual([...room.spectators], [A.player.id]);
  assert.equal(room.seats.length, n);
  assert(room.seats.every(s => s.ai && s.pid === null && s.autoMode === null));
  assert.equal(f.last(A, 'game').snap.phase, 'draft');
  assert.equal(f.hub.getDeadlineIn(A), null);
  assert.match(f.command(A, 'replay'), /没结束/);
  let actions = 0, partialPicks = 0;
  const phases = new Set(), kinds = new Set();
  // 观察真实 schedule 调用后的中间暗选，不手动代替计时器提交答案。
  const answer = game.answer.bind(game);
  game.answer = (...args) => {
    const d = game.pending;
    const result = answer(...args);
    if (d.simul && game.pending === d) {
      partialPicks++;
      const snap = game.snapshot(-1);
      assert(!Object.hasOwn(snap.pending, 'answers'));
      assert.deepEqual(snap.pending.optionsBySeat, {});
      assert.equal(snap.pending.done.length, Object.keys(d.answers).length);
      assert(!game.events.some(e => e.t === 'reveal'), '所有人暗选完成前不能发 reveal');
    }
    return result;
  };
  while (room.game.pending && actions++ < 3000) {
    phases.add(room.game.phase); kinds.add(room.game.pending.kind);
    assert(f.runNext(), '必须有真正的 AI 调度，而不是要求观众操作');
    assertSpectatorGame(f.last(A, 'game'), n);
  }
  assert.equal(room.status, 'over');
  assert.equal(room.game.phase, 'over');
  assert.equal(room.game.results.length, 4);
  assert(room.game.snapshot(-1).players.some(p => p.score > 0));
  assert(partialPicks >= 4 * (n - 1), '四场都验证了中间暗选状态');
  assert.deepEqual([...phases].sort(), ['draft', 'pick', 'race']);
  assert(kinds.has('draft') && kinds.has('pickRacer') && kinds.has('roll'));
  assert([...kinds].some(k => !['draft', 'pickRacer', 'roll'].includes(k)), '技能决策也必须由 AI 推进');
  assert.equal(A.messages.filter(m => m.type === 'ack').length, 0);
  const events = A.messages.flatMap(m => m.events || []);
  assert.equal(events.filter(e => e.t === 'reveal').length, 4);
  assertSpectatorGame(f.last(A, 'game'), n);
  assert.equal(f.last(A, 'game').snap.pending, null);
  assert(room.busyUntil > f.now(), '最终结算必须保留动画闸门');
  const before = JSON.stringify(room.game.snapshot(-1));
  assert.match(f.command(A, 'replay'), /动画/);
  assert.equal(JSON.stringify(room.game.snapshot(-1)), before);
  assert.equal(room.gameId, gameId);
  assert.equal(f.hub.errorContext(A, 'replay').retryIn, Math.ceil(room.busyUntil - f.now()));
  f.tick(room.busyUntil - f.now());
  assert.equal(f.command(A, 'replay'), null);
  assert.equal(f.hub.rooms.get(A.room), room);
  assert.notEqual(room.game, game);
  assert.notEqual(room.gameId, gameId);
  assert.deepEqual(room.seats, seats);
  assert.equal(room.game.phase, 'draft');
  assert.equal(room.game.results.length, 0);
  assert(room.game.snapshot(-1).players.every(p => p.score === 0 && p.used.length === 0 && p.chips.length === 0 && p.hand.length === 0));
  assertSpectatorGame(f.last(A, 'game'), n);
  assert(f.runNext(), '重开后的 AI 必须继续选秀');
  assert(room.game.players.some(p => p.hand.length > 0));
  console.log(`  实际调度 ${actions} 步，${partialPicks} 次中间暗选，技能 ${[...kinds].filter(k => !['draft', 'pickRacer', 'roll'].includes(k)).join('/')}，比分 ${JSON.parse(before).players.map(p => p.score).join('/')}`);
});

let spectatorDraw = 0;
test('不同 AI 思考时间下真实广播中间暗选，新观众加入与 recover 都不泄漏答案', f => {
  const A = f.socket('房主'), B = f.socket('暗选途中加入');
  f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room);
  let steps = 0;
  while (!room.game.pending.simul && steps++ < 100) assert(f.runNext());
  const d = room.game.pending;
  assert(d.simul);
  assert(f.runNext());
  assert.equal(room.game.pending, d, '不同思考时间应只推进一名 AI 的暗选');
  assert.equal(Object.keys(d.answers).length, 1);
  const partial = f.last(A, 'game');
  assertSpectatorGame(partial, 4);
  assert.equal(partial.snap.pending.done.length, 1);
  assert(partial.events.some(e => e.t === 'picked'));
  assert(!partial.events.some(e => e.t === 'reveal'));
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  assertSpectatorGame(f.last(B, 'game'), 4);
  assert.equal(f.last(B, 'game').full, true);
  assert.equal(f.last(B, 'game').snap.pending.done.length, 1);
  f.hub.recover(A);
  assertSpectatorGame(f.last(A, 'game'), 4);
  const timers = [...f.timers.values()];
  f.hub.disconnect(A); f.hub.disconnect(B);
  assert.equal(f.timers.size, 0);
  const before = JSON.stringify(room.game.snapshot(-1));
  for (const task of timers) task.fn();
  assert.equal(JSON.stringify(room.game.snapshot(-1)), before, '已暂停调度的迟到回调不能提交暗选');
  f.tick(5000);
  f.command(A, 'hello', { token: A.messages.find(m => m.type === 'hello').token });
  assertSpectatorGame(f.last(A, 'game'), 4);
  assert(f.runNext());
  assert.equal(f.last(A, 'game').snap.pending.done.length, 2);
}, { random: () => ((++spectatorDraw * 17) % 97) / 97 });

test('watch 非法人数不退旧房间，普通房间及 quick/start/replay 语义不变', f => {
  const { A, B, room } = roomWithHumans(f);
  const seats = JSON.stringify(room.seats), before = JSON.stringify(room.game.snapshot(0));
  const messages = A.messages.length, touched = room.touched, playerTouched = A.player.touched;
  f.tick(1000);
  for (const ai of [null, 2, 7, 3.5, '4', false, [], {}, NaN, Infinity]) {
    assert.match(f.command(A, 'watch', { ai }), /3–6.*整数/);
    assert.equal(A.room, room.code);
    assert.equal(A.player.room, room.code);
    assert.equal(f.hub.rooms.size, 1);
    assert.equal(JSON.stringify(room.seats), seats);
    assert.equal(JSON.stringify(room.game.snapshot(0)), before);
    assert.equal(A.messages.length, messages);
    assert.equal(room.touched, touched);
    assert.equal(A.player.touched, playerTouched);
  }
  assert.match(f.command(A, 'replay'), /只有观战/);
  const stranger = f.socket('陌生人');
  assert.match(f.command(stranger, 'join', { code: room.code }), /已经开始/);
  assert.equal(stranger.room, null);
  assert(!room.clients.has(stranger));
  assert.equal(f.command(A, 'watch', { ai: 3 }), null);
  const watched = f.hub.rooms.get(A.room);
  assert.notEqual(watched, room);
  assert.equal(room.host, B.player.id);
  assert(!room.clients.has(A));
  assert(room.seats.some(s => s.pid === A.player.id), '原真人局仍保留离席托管位');
  assert.equal(watched.seats.length, 3);
  assert.equal(f.command(A, 'quick', { ai: 2 }), null);
  assert.notEqual(f.hub.rooms.get(watched.code), watched, '最后一名观众切换房间会清理旧观战房，即使编号随后复用');
  assert.equal(watched.spectators.size, 0);
  assert.equal(watched.clients.size, 0);
  const quick = f.hub.rooms.get(A.room);
  assert.equal(quick.mode, undefined);
  assert.equal(quick.seats.length, 3);
  assert.equal(f.last(A, 'game').you, 0);
  assert.equal(f.last(A, 'game').mode, undefined);
});

test('观众 act/auto/emote 与席位/大厅指令拒绝，不修改游戏或确认动作', f => {
  const A = f.socket('观众');
  f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room), d = room.game.pending;
  const before = JSON.stringify(room.game.snapshot(-1)), seats = structuredClone(room.seats);
  const timer = room.timer, version = room.scheduleVersion;
  for (const [type, data] of [
    ['act', { gameId: room.gameId, id: d.id, value: d.options[0].v }],
    ['act', { gameId: 'stale', id: d.id, value: d.options[0].v }],
    ['auto', { on: true }], ['auto', { on: false }], ['emote', { key: '好耶' }],
    ['addAI', {}], ['removeAI', { seat: 0 }], ['start', {}], ['lobby', {}],
  ]) {
    assert.match(f.command(A, type, data), /观众|观战/);
    assert.equal(JSON.stringify(room.game.snapshot(-1)), before);
    assert.deepEqual(room.seats, seats);
    assert.equal(room.timer, timer);
    assert.equal(room.scheduleVersion, version);
    assert.equal(A.messages.filter(m => m.type === 'ack').length, 0);
  }
  f.hub.recover(A);
  assert.equal(f.last(A, 'game').full, true);
  assertSpectatorGame(f.last(A, 'game'), 4);
  assert.equal(A.player.lastEmote, undefined);
  assert.equal(f.hub.errorContext(A, 'act').decisionId, d.id);
});

test('观众断线全停，重连与同 token 标签保持 you=-1 和成员，恢复剩余调度时间', f => {
  const A = f.socket('房主'), B = f.socket('其他观众');
  f.command(A, 'watch', { ai: 6 });
  const room = f.hub.rooms.get(A.room), token = A.player.token, gameId = room.gameId;
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  assert.equal(room.seats.length, 6);
  const initial = JSON.stringify(room.game.snapshot(-1)), dueAt = [...f.timers.values()][0].at;
  const tab = f.socket('刷新标签');
  f.command(tab, 'hello', { token });
  assert.equal(tab.room, room.code);
  assertSpectatorGame(f.last(tab, 'game'), 6);
  assert.equal(room.spectators.size, 2, '同 token 不重复增加成员');
  assert.equal([...f.timers.values()][0].at, dueAt, '重连不重新发放时间');
  f.hub.disconnect(A);
  assert.equal(room.host, tab.player.id, '同身份另一个标签仍在线');
  assert.equal(f.timers.size, 1);
  f.hub.disconnect(tab);
  assert.equal(room.host, B.player.id);
  assert.equal(f.last(B, 'room').room.spectators.find(p => p.id === f.last(A, 'hello').id).online, false);
  assert(f.runNext(), '还有观众时正常推进 AI');
  assert.notEqual(JSON.stringify(room.game.snapshot(-1)), initial);
  const before = JSON.stringify(room.game.snapshot(-1));
  const savedDue = [...f.timers.values()][0].at - f.now();
  f.hub.disconnect(B);
  assert.equal(room.clients.size, 0);
  assert.equal(room.spectators.size, 2, '断线保留成员资格');
  assert.equal(f.timers.size, 0);
  assert.equal(room.timer, null);
  assert.notEqual(room.timing.pausedAt, null);
  f.tick(60000);
  assert.equal(f.runNext(), false);
  assert.equal(JSON.stringify(room.game.snapshot(-1)), before);
  assert.equal(f.command(A, 'hello', { token }), null);
  assert.equal(room.gameId, gameId);
  assert.equal(A.room, room.code);
  assert.equal(room.host, A.player.id, '在线观众接任房主');
  assert.equal(room.timing.pausedAt, null);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].at - f.now(), savedDue);
  assertSpectatorGame(f.last(A, 'game'), 6);
  assert.equal(f.last(A, 'game').full, true);
  assert(f.runNext());
  assert.notEqual(JSON.stringify(room.game.snapshot(-1)), before);
});

test('最后观众连接已不可写但 close 尚未来到时，AI 回调也必须暂停', f => {
  const A = f.socket('房主');
  f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room), before = JSON.stringify(room.game.snapshot(-1));
  A.readyState = 3;
  assert(f.runNext());
  assert.equal(JSON.stringify(room.game.snapshot(-1)), before);
  assert.equal(f.timers.size, 0);
  assert.notEqual(room.timing.pausedAt, null);
  f.hub.disconnect(A);
  A.readyState = 1;
  f.command(A, 'hello', { token: A.messages.find(m => m.type === 'hello').token });
  assert(f.runNext());
  assert.notEqual(JSON.stringify(room.game.snapshot(-1)), before);
});

test('多人观众的加入、改名、房主权限转移与离开不替换 AI，最后主动离开清房间', f => {
  const A = f.socket('房主'), B = f.socket('观众二'), C = f.socket('观众三');
  f.command(A, 'watch', { ai: 3 });
  const room = f.hub.rooms.get(A.room), seats = structuredClone(room.seats);
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  assert.equal(f.command(C, 'join', { code: room.code }), null);
  assert.equal(room.spectators.size, 3);
  for (const ws of [B, C]) {
    assertSpectatorGame(f.last(ws, 'game'), 3);
    assert.match(f.command(ws, 'speed'), /只有房主/);
    assert.match(f.command(ws, 'replay'), /只有房主/);
  }
  assert.equal(f.command(B, 'setName', { name: '改名观众' }), null);
  const summary = f.last(A, 'room').room;
  assert.deepEqual(summary.spectators, [
    { id: A.player.id, name: '房主', online: true },
    { id: B.player.id, name: '改名观众', online: true },
    { id: C.player.id, name: '观众三', online: true },
  ]);
  for (const ws of [A, B, C]) assert(!JSON.stringify(summary).includes(ws.player.token));
  const tab = f.socket('另一个标签');
  f.command(tab, 'hello', { token: A.player.token, name: '新房主名字' });
  assert.equal(f.last(B, 'room').room.spectators[0].name, '新房主名字');
  assert.equal(f.command(A, 'speed'), null);
  assert.equal(room.speed, 1.5);
  assert.equal(f.last(C, 'speed').deadlineIn, null);
  const oldIdentity = A.player;
  assert.equal(f.command(A, 'leave'), null);
  assert.equal(tab.room, null);
  assert.equal(oldIdentity.room, null);
  assert.equal(f.last(tab, 'left').reason, 'leave');
  assert(!room.spectators.has(oldIdentity.id));
  assert.equal(room.host, B.player.id);
  assert.equal(f.command(B, 'speed'), null);
  f.hub.disconnect(B);
  assert.equal(room.host, C.player.id);
  f.command(B, 'hello', { token: B.messages.find(m => m.type === 'hello').token });
  assert.equal(room.host, C.player.id, '重连不能夺回房主');
  assert.equal(f.command(C, 'leave'), null);
  assert.equal(room.host, B.player.id);
  assert.deepEqual(room.seats, seats);
  const callbacks = [...f.timers.values()];
  assert.equal(f.command(B, 'leave'), null);
  assert(!f.hub.rooms.has(room.code));
  assert.equal(room.clients.size, 0);
  assert.equal(room.spectators.size, 0);
  assert.equal(f.timers.size, 0);
  for (const task of callbacks) task.fn();
  assert.equal(f.timers.size, 0, '被删除房间的迟到计时器不能复活');
});

test('观众身份切换解绑标签，陈旧房间不能恢复，过期清除成员后 token 回大厅', f => {
  const A = f.socket('房主'), outsider = f.socket('其他身份');
  f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room), p = A.player, token = p.token;
  const tab = f.socket('标签');
  f.command(tab, 'hello', { token });
  f.command(tab, 'hello', { token: outsider.player.token });
  assert(!p.sockets.has(tab));
  assert(!room.clients.has(tab));
  assert.equal(tab.room, null);
  // 即使有陈旧指针/连接集合，缺少观众成员资格也不能成为驱动游戏的幽灵。
  outsider.player.room = room.code;
  outsider.room = room.code;
  room.clients.add(outsider);
  f.command(outsider, 'hello', { token: outsider.player.token });
  assert.equal(outsider.room, null);
  assert.equal(outsider.player.room, null);
  assert(!room.clients.has(outsider));
  f.hub.disconnect(A);
  f.tick(30 * 60 * 1000 - 1); f.hub.cleanup();
  assert(f.hub.rooms.has(room.code));
  f.tick(1); f.hub.cleanup();
  assert(!f.hub.rooms.has(room.code));
  assert.equal(p.room, null);
  assert.equal(room.spectators.size, 0);
  assert.equal(room.clients.size, 0);
  assert.equal(room.timer, null);
  assert.equal(f.command(A, 'hello', { token }), null);
  assert.equal(f.last(A, 'hello').room, null);
  assert.equal(A.player, p);
  assert.equal(A.room, null);
  assert.match(f.command(A, 'join', { code: room.code }), /不存在/);
});

test('已结束观战房可加入观众并由新在线房主 replay，全局 dispose 释放观众标签', f => {
  const A = f.socket('房主'), B = f.socket('后来的观众');
  f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room), firstId = room.gameId;
  let actions = 0;
  while (room.game.pending && actions++ < 3000) assert(f.runNext());
  assert.equal(room.status, 'over');
  f.hub.disconnect(A);
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  assert.equal(room.host, B.player.id);
  assertSpectatorGame(f.last(B, 'game'), 4);
  f.tick(Math.max(0, room.busyUntil - f.now()));
  assert.equal(f.command(B, 'replay'), null);
  assert.notEqual(room.gameId, firstId);
  const tab = f.socket('刷新');
  f.command(tab, 'hello', { token: B.player.token });
  const player = B.player;
  f.hub.dispose();
  assert.equal(room.spectators.size, 0);
  assert.equal(room.clients.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.intervals.size, 0);
  assert.equal(player.room, null);
  assert.equal(player.sockets.size, 0);
  for (const ws of [B, tab]) { assert.equal(ws.room, null); assert.equal(ws.player, null); }
  assert.equal(f.command(tab, 'watch'), '服务已关闭');
});
const DIRECTORY_KEYS = ['code', 'mode', 'status', 'hostName', 'playerCount', 'aiCount', 'humanCount', 'onlineCount', 'maxPlayers', 'spectatorCount', 'onlineSpectatorCount', 'canJoin', 'isMember'].sort();
function directory(f, ws) { return f.last(ws, 'roomList').rooms; }
function listed(f, ws, code) { return directory(f, ws).find((room) => room.code === code); }
function listCount(ws) { return ws.messages.filter((msg) => msg.type === 'roomList').length; }
const lifecycleCount = count;

test('公开房间目录先 hello，空目录立即返回；非法参数不触碰身份或订阅', f => {
  const unknown = { readyState: 1, messages: [], send(raw) { this.messages.push(JSON.parse(raw)); } };
  assert.match(f.command(unknown, 'listRooms'), /先连接/);
  assert.equal(unknown.player, undefined);
  assert.equal(unknown.messages.length, 0);
  const subscriber = f.socket('看房的人'), invalid = f.socket('非法请求者'), host = f.socket('房主');
  const touched = subscriber.player.touched, invalidTouched = invalid.player.touched;
  f.tick(1000);
  assert.equal(f.command(subscriber, 'listRooms'), null);
  assert.deepEqual(f.last(subscriber, 'roomList'), { type: 'roomList', rooms: [] });
  assert.equal(subscriber.player.touched, touched);
  for (const data of [{ payload: null }, { code: 'ABCD' }, { rooms: [] }]) {
    assert.match(f.command(invalid, 'listRooms', data), /参数/);
    assert.equal(invalid.player.touched, invalidTouched);
    assert.equal(invalid.room, null);
    assert.equal(listCount(invalid), 0);
  }
  f.command(host, 'create');
  assert.equal(directory(f, subscriber).length, 1);
  assert.equal(listCount(invalid), 0, '非法参数不创建订阅');
});

test('其他人创建、加减 AI、加入、改名与离开自动推送轻量目录', f => {
  const lobby = f.socket('首页'), A = f.socket('原房主'), B = f.socket('朋友');
  f.command(lobby, 'listRooms');
  f.command(A, 'create');
  const room = f.hub.rooms.get(A.room);
  assert.deepEqual(listed(f, lobby, room.code), {
    code: room.code, mode: 'play', status: 'lobby', hostName: '原房主',
    playerCount: 1, aiCount: 0, humanCount: 1, onlineCount: 1, maxPlayers: 6,
    spectatorCount: 0, onlineSpectatorCount: 0, canJoin: true, isMember: false,
  });
  f.command(A, 'addAI'); assert.equal(listed(f, lobby, room.code).aiCount, 1);
  f.command(A, 'removeAI', { seat: 1 }); assert.equal(listed(f, lobby, room.code).aiCount, 0);
  f.command(B, 'join', { code: room.code });
  assert.equal(listed(f, lobby, room.code).humanCount, 2);
  assert.equal(listed(f, lobby, room.code).onlineCount, 2);
  f.command(A, 'setName', { name: '新的房主名' });
  assert.equal(listed(f, lobby, room.code).hostName, '新的房主名');
  f.command(A, 'leave');
  assert.equal(listed(f, lobby, room.code).hostName, '朋友');
  assert.equal(listed(f, lobby, room.code).playerCount, 1);
  f.command(B, 'leave'); assert.deepEqual(directory(f, lobby), []);
});

test('六席含 AI 可以从目录一键加入替 AI，六名真人仅成员可返回', f => {
  const lobby = f.socket('首页'), A = f.socket('房主');
  f.command(lobby, 'listRooms'); f.command(A, 'create');
  const room = f.hub.rooms.get(A.room);
  for (let i = 0; i < 5; i++) f.command(A, 'addAI');
  assert.equal(listed(f, lobby, room.code).playerCount, 6);
  assert.equal(listed(f, lobby, room.code).canJoin, true);
  for (let i = 0; i < 5; i++) {
    const visitor = f.socket(`真人${i}`);
    assert.equal(listed(f, lobby, room.code).canJoin, true);
    assert.equal(f.command(visitor, 'join', { code: room.code }), null);
    assert.equal(room.seats.length, 6);
    assert.equal(listed(f, lobby, room.code).aiCount, 4 - i);
  }
  assert.equal(listed(f, lobby, room.code).humanCount, 6);
  assert.equal(listed(f, lobby, room.code).canJoin, false);
  assert.match(f.command(lobby, 'join', { code: room.code }), /房间已满/);
  assert.equal(lobby.room, null);
  f.command(A, 'listRooms');
  assert.equal(listed(f, A, room.code).canJoin, true);
  assert.equal(listed(f, A, room.code).isMember, true);
  assert.equal(f.command(A, 'join', { code: room.code }), null);
});

test('开赛与结算禁止新成员，已有席位可返回；回大厅与重开及时推目录', f => {
  const { A, B, room } = roomWithHumans(f), lobby = f.socket('首页');
  f.command(lobby, 'listRooms'); f.command(A, 'listRooms');
  assert.equal(listed(f, lobby, room.code).status, 'playing');
  assert.equal(listed(f, lobby, room.code).canJoin, false);
  assert.equal(listed(f, A, room.code).isMember, true);
  assert.equal(listed(f, A, room.code).canJoin, true);
  assert.match(f.command(lobby, 'join', { code: room.code }), /已经开始/);
  // 主动离开的原参赛席也遵循原 join 的成员返回规则，不变成新席位。
  f.command(B, 'leave'); f.command(B, 'listRooms');
  assert.equal(listed(f, B, room.code).isMember, true);
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  f.command(A, 'auto', { on: true }); f.command(B, 'auto', { on: true });
  const beforeEnd = listCount(lobby);
  let steps = 0;
  while (room.game.pending && steps++ < 3000) assert(f.runNext());
  assert.equal(room.status, 'over');
  assert.equal(listCount(lobby), beforeEnd + 1, '每个 AI 动作/动画不重新广播目录，仅结算状态变化广播');
  assert.equal(listed(f, lobby, room.code).status, 'over');
  assert.equal(listed(f, lobby, room.code).canJoin, false);
  assert.match(f.command(lobby, 'join', { code: room.code }), /已经开始/);
  f.tick(room.busyUntil - f.now());
  assert.equal(f.command(A, 'lobby'), null);
  assert.equal(listed(f, lobby, room.code).status, 'lobby');
  assert.equal(listed(f, lobby, room.code).canJoin, true);
  assert.equal(f.command(A, 'start'), null);
  assert.equal(listed(f, lobby, room.code).status, 'playing');
  assert.equal(listed(f, lobby, room.code).canJoin, false);
});

test('全 AI 房目录可在任意阶段观看，观众按身份而不是标签计数，replay 推送', f => {
  const lobby = f.socket('首页'), A = f.socket('观战房主'), B = f.socket('新观众');
  f.command(lobby, 'listRooms'); f.command(A, 'watch', { ai: 3 });
  const room = f.hub.rooms.get(A.room), seats = structuredClone(room.seats);
  let summary = listed(f, lobby, room.code);
  assert.equal(summary.mode, 'spectator'); assert.equal(summary.status, 'playing');
  assert.equal(summary.canJoin, true); assert.equal(summary.playerCount, 3);
  assert.equal(summary.humanCount, 0); assert.equal(summary.aiCount, 3);
  assert.equal(summary.spectatorCount, 1); assert.equal(summary.onlineSpectatorCount, 1);
  assert.equal(summary.onlineCount, 1);
  assert.equal(f.command(B, 'join', { code: room.code }), null);
  assertSpectatorGame(f.last(B, 'game'), 3);
  const tab = f.socket('观战标签'); f.command(tab, 'hello', { token: B.player.token });
  summary = listed(f, lobby, room.code);
  assert.equal(summary.spectatorCount, 2); assert.equal(summary.onlineSpectatorCount, 2);
  assert.equal(summary.onlineCount, 2); assert.deepEqual(room.seats, seats);
  f.hub.disconnect(B); assert.equal(listed(f, lobby, room.code).onlineSpectatorCount, 2);
  f.hub.disconnect(tab); assert.equal(listed(f, lobby, room.code).onlineSpectatorCount, 1);
  assert.equal(listed(f, lobby, room.code).spectatorCount, 2);
  let steps = 0;
  while (room.game.pending && steps++ < 3000) assert(f.runNext());
  assert.equal(listed(f, lobby, room.code).status, 'over');
  assert.equal(listed(f, lobby, room.code).canJoin, true);
  assert.equal(f.command(lobby, 'join', { code: room.code }), null);
  assertSpectatorGame(f.last(lobby, 'game'), 3);
  assert.deepEqual(room.seats, seats);
  f.tick(room.busyUntil - f.now());
  assert.equal(f.command(A, 'replay'), null);
  assert.equal(listed(f, lobby, room.code).status, 'playing');
});

test('目录仅显示在线活跃房间，全部断线隐藏但保留原身份恢复与 TTL 清理', f => {
  const lobby = f.socket('首页'), A = f.socket('房主');
  f.command(lobby, 'listRooms'); f.command(A, 'quick', { ai: 2 });
  const room = f.hub.rooms.get(A.room), p = A.player, token = p.token;
  const tab = f.socket('同身份标签'); f.command(tab, 'hello', { token });
  assert.equal(listed(f, lobby, room.code).onlineCount, 1);
  f.hub.disconnect(A); assert.equal(directory(f, lobby).length, 1);
  f.hub.disconnect(tab); assert.deepEqual(directory(f, lobby), []);
  assert.equal(f.hub.rooms.get(room.code), room); assert.equal(f.timers.size, 0);
  f.tick(60000); f.command(lobby, 'listRooms');
  assert.deepEqual(directory(f, lobby), []);
  assert.equal(f.command(A, 'hello', { token }), null);
  assert.equal(listed(f, lobby, room.code).onlineCount, 1);
  assert.equal(A.room, room.code);
  f.hub.disconnect(A); const touched = room.touched;
  f.tick(30 * 60 * 1000); f.command(lobby, 'listRooms');
  assert.equal(room.touched, touched);
  f.hub.cleanup();
  assert.deepEqual(directory(f, lobby), []);
  assert(!f.hub.rooms.has(room.code)); assert.equal(p.room, null);
  assert.match(f.command(lobby, 'join', { code: room.code }), /不存在/);
});

test('listRooms 不改变触碰时间、成员、计时器、待决策、游戏事件或当前页面消息', f => {
  const { A, B, room } = roomWithHumans(f);
  const before = {
    touched: room.touched, playerTouched: A.player.touched,
    room: A.room, playerRoom: A.player.room, clients: [...room.clients],
    seats: structuredClone(room.seats), spectators: [...room.spectators],
    timer: room.timer, version: room.scheduleVersion, deadline: room.deadline,
    timing: room.timing, due: JSON.stringify([...room.timing.due]),
    pending: room.game.pending, game: JSON.stringify(room.game), busyUntil: room.busyUntil,
    timers: [...f.timers], intervals: [...f.intervals],
  };
  const messageCount = A.messages.length, otherMessages = B.messages.length;
  f.tick(1000);
  for (let i = 0; i < 5; i++) assert.equal(f.command(A, 'listRooms'), null);
  assert.equal(room.touched, before.touched); assert.equal(A.player.touched, before.playerTouched);
  assert.equal(A.room, before.room); assert.equal(A.player.room, before.playerRoom);
  assert.deepEqual([...room.clients], before.clients); assert.deepEqual(room.seats, before.seats);
  assert.deepEqual([...room.spectators], before.spectators);
  assert.equal(room.timer, before.timer); assert.equal(room.scheduleVersion, before.version);
  assert.equal(room.deadline, before.deadline); assert.equal(room.timing, before.timing);
  assert.equal(JSON.stringify([...room.timing.due]), before.due);
  assert.equal(room.game.pending, before.pending); assert.equal(JSON.stringify(room.game), before.game);
  assert.equal(room.busyUntil, before.busyUntil);
  assert.deepEqual([...f.timers], before.timers); assert.deepEqual([...f.intervals], before.intervals);
  assert(A.messages.slice(messageCount).every((msg) => msg.type === 'roomList'));
  assert.equal(B.messages.length, otherMessages);
});

test('查询自身离线指针不恢复 membership 或暂停调度，不延长房间 TTL', f => {
  const A = f.socket('房主'); f.command(A, 'watch');
  const room = f.hub.rooms.get(A.room), p = A.player, token = p.token;
  f.hub.disconnect(A);
  const pending = room.game.pending, touched = room.touched, timing = room.timing;
  // 仿真经过 hello 后首页仍有陈旧 room 指针；查询不应偷偷调用 enter/schedule。
  const idle = f.socket('大厅标签'); f.command(idle, 'hello', { token });
  room.clients.delete(idle); idle.room = null;
  // 最后一个不可用 viewer 的 AI 回调会按原调度暂停。
  assert(f.runNext()); assert.equal(f.timers.size, 0);
  const pausedAt = timing.pausedAt, playerTouched = p.touched, queryTouched = room.touched;
  f.tick(30 * 60 * 1000);
  assert.equal(f.command(idle, 'listRooms'), null);
  assert.deepEqual(directory(f, idle), []);
  assert.equal(room.touched, queryTouched); assert.equal(p.touched, playerTouched);
  assert.equal(room.game.pending, pending); assert.equal(room.timing.pausedAt, pausedAt);
  assert.equal(f.timers.size, 0); assert(!room.clients.has(idle)); assert.equal(idle.room, null);
  assert(queryTouched >= touched); f.hub.cleanup();
  assert(!f.hub.rooms.has(room.code)); assert.equal(p.room, null);
});

test('房主名字在比赛中改名也更新，hello 改名、离线移交与无主回退安全', f => {
  const { A, B, room } = roomWithHumans(f), lobby = f.socket('首页');
  f.command(lobby, 'listRooms');
  const oldSeatName = room.seats[0].name;
  f.command(A, 'setName', { name: '比赛中改名' });
  assert.equal(listed(f, lobby, room.code).hostName, '比赛中改名');
  assert.equal(room.seats[0].name, oldSeatName, '比赛参赛名称不改变');
  f.command(A, 'hello', { token: A.player.token, name: 'hello 改名' });
  assert.equal(listed(f, lobby, room.code).hostName, 'hello 改名');
  f.hub.disconnect(A); assert.equal(listed(f, lobby, room.code).hostName, B.player.name);
  room.host = null; f.command(lobby, 'listRooms');
  assert.equal(typeof listed(f, lobby, room.code).hostName, 'string');
  assert(listed(f, lobby, room.code).hostName.length > 0);
});

test('房间目录输出严格隐私白名单，分开统计 AI、真人、观众与在线身份', f => {
  const lobby = f.socket('首页'), player = f.socket('玩家房主'), watcher = f.socket('观战房主');
  f.command(lobby, 'listRooms'); f.command(player, 'quick', { ai: 2 });
  f.command(watcher, 'watch', { ai: 6 });
  for (const summary of directory(f, lobby)) {
    assert.deepEqual(Object.keys(summary).sort(), DIRECTORY_KEYS);
    assert.equal(summary.maxPlayers, 6); assert.equal(summary.playerCount, summary.aiCount + summary.humanCount);
    for (const value of Object.values(summary)) assert(['string', 'number', 'boolean'].includes(typeof value));
    for (const ws of [lobby, player, watcher]) {
      assert(!JSON.stringify(summary).includes(ws.player.token));
      assert(!JSON.stringify(summary).includes(ws.player.id));
    }
    assert(!JSON.stringify(summary).includes(f.hub.rooms.get(summary.code).gameId));
  }
});

test('目录排序：可加入等待房优先、观战其次，再满房及进行中/结束', f => {
  const lobby = f.socket('首页'), playing = f.socket('进行中'), watched = f.socket('观战'), waiting = f.socket('等待'), ended = f.socket('结算');
  f.command(lobby, 'listRooms'); f.command(playing, 'quick', { ai: 2 });
  f.command(watched, 'watch'); f.command(waiting, 'create'); f.command(ended, 'quick', { ai: 2 });
  const over = f.hub.rooms.get(ended.room);
  f.command(ended, 'auto', { on: true });
  let steps = 0;
  while (over.game.pending && steps++ < 3000) assert(f.runNext());
  assert.equal(over.status, 'over');
  assert.deepEqual(directory(f, lobby).map((room) => room.code), [waiting.room, watched.room, playing.room, ended.room]);
});

test('列表订阅仅本标签、重复订阅幂等、断线/换身份清理，其他标签可独立订阅', f => {
  const A = f.socket('订阅人'), tab = f.socket('标签'), host = f.socket('房主'), other = f.socket('另一个身份');
  f.command(tab, 'hello', { token: A.player.token });
  f.command(A, 'listRooms'); f.command(A, 'listRooms');
  const before = listCount(A); f.command(host, 'create');
  const room = f.hub.rooms.get(host.room);
  assert.equal(listCount(A), before + 1); assert.equal(listCount(tab), 0);
  f.command(tab, 'listRooms'); const tabCount = listCount(tab);
  f.hub.disconnect(A); f.command(host, 'addAI');
  assert.equal(listCount(A), before + 1); assert.equal(listCount(tab), tabCount + 1);
  f.command(A, 'hello', { token: f.last(A, 'hello').token });
  f.command(host, 'addAI'); assert.equal(listCount(A), before + 1, '重连后必须再次显式订阅');
  f.command(A, 'listRooms'); const switchedCount = listCount(A);
  f.command(A, 'hello', { token: other.player.token });
  f.command(host, 'addAI'); assert.equal(listCount(A), switchedCount, '换身份不继承旧订阅');
  assert.equal(listed(f, tab, room.code).playerCount, 4);
});

test('关闭中与已失效 hello 的订阅者被清理，send 抛错不阻断其他订阅者', f => {
  const closed = f.socket('关闭中'), invalid = f.socket('失效标签'), throwing = f.socket('坏连接'), healthy = f.socket('正常'), host = f.socket('房主');
  for (const ws of [closed, invalid, throwing, healthy]) f.command(ws, 'listRooms');
  const closedCount = listCount(closed), invalidCount = listCount(invalid);
  closed.readyState = 2; invalid.player.sockets.delete(invalid);
  throwing.send = () => { throw new Error('关闭竞态'); };
  assert.doesNotThrow(() => f.command(host, 'create'));
  assert.equal(directory(f, healthy).length, 1);
  closed.readyState = 1; invalid.player.sockets.add(invalid);
  f.command(host, 'addAI');
  assert.equal(listCount(closed), closedCount); assert.equal(listCount(invalid), invalidCount);
  assert.equal(directory(f, healthy)[0].aiCount, 1);
});

test('dispose 清理目录订阅，迟到 listRooms/cleanup/disconnect 不再发送或复活', f => {
  const lobby = f.socket('首页'), A = f.socket('房主');
  f.command(lobby, 'listRooms'); f.command(A, 'watch');
  const before = listCount(lobby);
  f.hub.dispose(); assert.equal(listCount(lobby), before);
  assert.equal(lobby.player, null); assert.equal(f.hub.rooms.size, 0);
  assert.equal(f.command(lobby, 'listRooms'), '服务已关闭');
  f.hub.dispose(); f.hub.cleanup(); f.hub.disconnect(lobby);
  assert.equal(listCount(lobby), before); assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0);
});
console.log(`房间生命周期回归通过：${lifecycleCount} 项；公开房间目录回归通过：${count - lifecycleCount} 项（合计 ${count} 项）`);
