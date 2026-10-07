'use strict';
// 房间与对局管理：全部在内存里。WebSocket 推送房间状态与对局事件，AI/超时由服务端按动画节奏驱动。
const crypto = require('crypto');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');
const { batchMs } = require('../public/timing');

const players = new Map(); // token -> { id, token, name, sockets:Set }
const byId = new Map(); // id -> player
const rooms = new Map(); // code -> room

const AI_NAMES = ['阿呆', '小飞', '豆豆', '球球', '闪电', '胖虎', '米粒', '大卫', '可乐', '跳跳'];
const TIMEOUT = { draft: 40000, pickRacer: 45000, roll: 25000, default: 30000 };
const AWAY_DELAY = 2500;

const now = () => Date.now();
const rid = (n) => crypto.randomBytes(n).toString('hex');

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/* ---------- 玩家 ---------- */
function hello(ws, { token, name }) {
  let p = token && players.get(token);
  if (!p) {
    p = { id: rid(6), token: rid(16), name: cleanName(name) || `选手${Math.floor(Math.random() * 900 + 100)}`, sockets: new Set(), room: null };
    players.set(p.token, p);
    byId.set(p.id, p);
  } else if (name) p.name = cleanName(name) || p.name;
  p.sockets.add(ws);
  ws.player = p;
  send(ws, { type: 'hello', token: p.token, id: p.id, name: p.name, room: p.room });
  if (p.room && rooms.has(p.room)) {
    const room = rooms.get(p.room);
    room.clients.add(ws);
    ws.room = room.code;
    markAway(room);
    send(ws, roomMsg(room));
    if (room.game) send(ws, gameMsg(room, p, [], true));
    schedule(room);
  }
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

function disconnect(ws) {
  const p = ws.player;
  if (p) p.sockets.delete(ws);
  const room = ws.room && rooms.get(ws.room);
  if (room) {
    room.clients.delete(ws);
    markAway(room);
    schedule(room);
    broadcastRoom(room);
  }
}

/* ---------- 房间 ---------- */
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

function roomSummary(room) {
  return {
    code: room.code,
    host: room.host,
    status: room.status,
    seats: room.seats.map((s, i) => ({
      seat: i, name: s.name, ai: s.ai, pid: s.pid || null,
      online: s.ai ? true : isOnline(s.pid, room),
    })),
  };
}
function roomMsg(room) { return { type: 'room', room: roomSummary(room) }; }

function isOnline(pid, room) {
  const p = byId.get(pid);
  if (!p) return false;
  for (const ws of p.sockets) if (ws.room === room.code) return true;
  return false;
}

function broadcastRoom(room) {
  const m = roomMsg(room);
  for (const ws of room.clients) send(ws, m);
}

function seatOf(room, pid) { return room.seats.findIndex((s) => s.pid === pid); }

function createRoom(ws) {
  const p = ws.player;
  leaveRoom(ws);
  const room = {
    code: newCode(), host: p.id, status: 'lobby',
    seats: [{ pid: p.id, name: p.name, ai: false }],
    clients: new Set(), game: null, timer: null, busyUntil: 0, touched: now(), speed: 1, deadline: 0,
  };
  rooms.set(room.code, room);
  enter(ws, room);
  return room;
}

function enter(ws, room) {
  const p = ws.player;
  p.room = room.code;
  for (const s of p.sockets) { s.room = room.code; room.clients.add(s); }
  broadcastRoom(room);
  if (room.game) send(ws, gameMsg(room, p, [], true));
}

function joinRoom(ws, code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) return '房间不存在';
  const p = ws.player;
  if (seatOf(room, p.id) >= 0) { enter(ws, room); return null; }
  if (room.status !== 'lobby') return '对局已经开始了';
  if (room.seats.length >= 6) {
    const ai = room.seats.findIndex((s) => s.ai);
    if (ai < 0) return '房间已满（最多 6 人）';
    room.seats.splice(ai, 1);
  }
  leaveRoom(ws);
  room.seats.push({ pid: p.id, name: p.name, ai: false });
  enter(ws, room);
  return null;
}

function leaveRoom(ws) {
  const p = ws.player;
  const room = p.room && rooms.get(p.room);
  p.room = null;
  for (const s of p.sockets) { if (room) room.clients.delete(s); s.room = null; }
  if (!room) return;
  if (room.status === 'lobby') {
    const i = seatOf(room, p.id);
    if (i >= 0) room.seats.splice(i, 1);
  }
  const humans = room.seats.filter((s) => !s.ai && s.pid);
  if (!humans.length || room.clients.size === 0 && room.status === 'lobby') { closeRoom(room); return; }
  if (room.host === p.id) room.host = humans[0].pid;
  markAway(room);
  schedule(room);
  broadcastRoom(room);
}

function closeRoom(room) {
  clearTimeout(room.timer);
  rooms.delete(room.code);
}

function addAI(ws) {
  const room = hostRoom(ws);
  if (typeof room === 'string') return room;
  if (room.status !== 'lobby') return '对局已开始';
  if (room.seats.length >= 6) return '最多 6 人';
  const used = new Set(room.seats.map((s) => s.name));
  const name = AI_NAMES.find((n) => !used.has(`${n}（AI）`)) || '机器人';
  room.seats.push({ pid: null, name: `${name}（AI）`, ai: true });
  broadcastRoom(room);
  return null;
}

function removeAI(ws, seat) {
  const room = hostRoom(ws);
  if (typeof room === 'string') return room;
  if (room.status !== 'lobby') return '对局已开始';
  const s = room.seats[seat];
  if (!s || !s.ai) return '只能移除 AI';
  room.seats.splice(seat, 1);
  broadcastRoom(room);
  return null;
}

function hostRoom(ws) {
  const p = ws.player;
  const room = p.room && rooms.get(p.room);
  if (!room) return '你不在房间里';
  if (room.host !== p.id) return '只有房主可以操作';
  return room;
}

function startGame(ws) {
  const room = hostRoom(ws);
  if (typeof room === 'string') return room;
  if (room.status === 'playing') return '已经开始了';
  if (room.seats.length < 3) return '至少需要 3 名选手（可以加 AI）';
  room.status = 'playing';
  room.game = new Game({ players: room.seats.map((s) => ({ name: s.name, ai: s.ai })), seed: Math.floor(Math.random() * 2 ** 31) });
  room.busyUntil = now();
  room.game.start();
  markAway(room);
  broadcastRoom(room);
  flush(room, true);
  return null;
}

function backToLobby(ws) {
  const room = hostRoom(ws);
  if (typeof room === 'string') return room;
  if (room.status === 'playing' && room.game.phase !== 'over') return '对局还没结束';
  clearTimeout(room.timer);
  room.status = 'lobby';
  room.game = null;
  room.seats = room.seats.filter((s) => s.ai || isOnline(s.pid, room));
  broadcastRoom(room);
  for (const c of room.clients) send(c, { type: 'lobby' });
  return null;
}

/* ---------- 对局 ---------- */
function gameMsg(room, p, events, full) {
  const seat = p ? seatOf(room, p.id) : -1;
  const deadlineIn = room.deadline ? Math.max(0, room.deadline - now()) : null;
  return { type: 'game', you: seat, events, snap: room.game.snapshot(), full: !!full, auto: room.seats.map((s) => !!s.away), speed: room.speed, deadlineIn };
}

function flush(room, full) {
  const g = room.game;
  const events = g.drain();
  const t = now();
  room.busyUntil = Math.max(room.busyUntil, t) + batchMs(events) / room.speed;
  room.touched = t;
  if (g.phase === 'over') room.status = 'over';
  schedule(room);
  for (const ws of room.clients) send(ws, gameMsg(room, ws.player, events, full));
}

function act(ws, { id, value }) {
  const room = ws.room && rooms.get(ws.room);
  if (!room || !room.game) return '没有进行中的对局';
  const seat = seatOf(room, ws.player.id);
  if (seat < 0) return '你是观众';
  const err = room.game.answer(seat, id, value);
  if (err) return err;
  room.seats[seat].away = false;
  flush(room);
  return null;
}

function markAway(room) {
  for (const s of room.seats) if (!s.ai) s.away = !isOnline(s.pid, room);
}

// 按动画节奏驱动 AI、离线托管与超时
function schedule(room) {
  clearTimeout(room.timer);
  room.deadline = 0;
  const g = room.game;
  if (!g || !g.pending || room.clients.size === 0) return; // 没人在看就暂停
  const d = g.pending;
  const t = now();
  const ready = Math.max(room.busyUntil, t);
  const seats = d.simul ? d.seats.filter((s) => d.answers[s] === undefined) : [d.seat];
  let soonest = Infinity;
  let who = [];
  for (const s of seats) {
    const st = room.seats[s];
    let at;
    if (st.ai) at = ready + 350 + Math.floor(Math.random() * 450);
    else if (st.away) at = ready + AWAY_DELAY;
    else at = ready + (TIMEOUT[d.kind] || TIMEOUT.default);
    if (at < soonest) { soonest = at; who = [s]; } else if (at === soonest) who.push(s);
  }
  // 只把真人的倒计时告诉前端
  room.deadline = who.some((s) => !room.seats[s].ai && !room.seats[s].away) ? soonest : 0;
  room.timer = setTimeout(() => {
    if (room.game !== g || g.pending !== d) return;
    for (const s of who) {
      if (!room.seats[s].ai && !room.seats[s].away) room.seats[s].away = true; // 超时 → 托管
      if (d.simul && d.answers[s] !== undefined) continue;
      if (!d.simul && d.seat !== s) continue;
      g.answer(s, d.id, decide(g, d, s));
    }
    flush(room);
  }, Math.max(0, soonest - t));
}

function setAuto(ws, on) {
  const room = ws.room && rooms.get(ws.room);
  if (!room || !room.game) return null;
  const seat = seatOf(room, ws.player.id);
  if (seat < 0) return null;
  room.seats[seat].away = !!on;
  schedule(room);
  for (const c of room.clients) send(c, { type: 'auto', auto: room.seats.map((s) => !!s.away) });
  return null;
}

const SPEEDS = [1, 1.5, 2.2];
function setSpeed(ws) {
  const room = hostRoom(ws);
  if (typeof room === 'string') return room;
  room.speed = SPEEDS[(SPEEDS.indexOf(room.speed) + 1) % SPEEDS.length];
  for (const c of room.clients) send(c, { type: 'speed', speed: room.speed });
  return null;
}

function emote(ws, key) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const seat = seatOf(room, ws.player.id);
  const t = now();
  if (ws.lastEmote && t - ws.lastEmote < 800) return;
  ws.lastEmote = t;
  for (const c of room.clients) send(c, { type: 'emote', seat, key: String(key).slice(0, 16) });
}

function quick(ws, n) {
  const room = createRoom(ws);
  const k = Math.max(2, Math.min(5, Number(n) || 3));
  for (let i = 0; i < k; i++) addAI(ws);
  return startGame(ws) || null;
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'hello': return hello(ws, msg);
    case 'setName': {
      const p = ws.player; if (!p) return;
      p.name = cleanName(msg.name) || p.name;
      const room = p.room && rooms.get(p.room);
      if (room && room.status === 'lobby') { const i = seatOf(room, p.id); if (i >= 0) room.seats[i].name = p.name; broadcastRoom(room); }
      return send(ws, { type: 'hello', token: p.token, id: p.id, name: p.name, room: p.room });
    }
    case 'create': createRoom(ws); return null;
    case 'join': return joinRoom(ws, msg.code);
    case 'leave': leaveRoom(ws); send(ws, { type: 'left' }); return null;
    case 'addAI': return addAI(ws);
    case 'removeAI': return removeAI(ws, msg.seat);
    case 'start': return startGame(ws);
    case 'quick': return quick(ws, msg.ai);
    case 'act': return act(ws, msg);
    case 'auto': return setAuto(ws, msg.on);
    case 'emote': return emote(ws, msg.key);
    case 'speed': return setSpeed(ws);
    case 'lobby': return backToLobby(ws);
    default: return '未知指令';
  }
}

// 清理长时间无人的房间
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.clients.size === 0 && t - room.touched > 30 * 60 * 1000) closeRoom(room);
  }
}, 60 * 1000).unref();

module.exports = { handle, disconnect, rooms };
