'use strict';
const assert = require('node:assert/strict');
const { createHub } = require('../server/hub');
const { decide } = require('../game/ai');
let count = 0;
function fixture() {
  let time = 1000000, next = 0;
  const timers = new Map(), intervals = new Map();
  const hub = createHub({ now: () => time, random: () => 0.3,
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
function test(name, fn) {
  const f = fixture();
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
console.log(`房间生命周期回归通过：${count} 项`);
