'use strict';
// 房间与对局管理：全部在内存里。计时器按决策保存，连接变化不会重新发放思考时间。
const crypto = require('crypto');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');
const { batchMs } = require('../public/timing');

const AI_NAMES = ['阿呆', '小飞', '豆豆', '球球', '闪电', '胖虎', '米粒', '大卫', '可乐', '跳跳'];
const EMOTES = new Set(['哈哈哈', '离谱！', '好耶', '救命', '666', '等等我']);
const TIMEOUT = { draft: 40000, pickRacer: 45000, roll: 25000, default: 30000 };
const AWAY_DELAY = 2500;
const ROOM_TTL = 30 * 60 * 1000;
const PLAYER_TTL = 24 * 60 * 60 * 1000;
const SPEEDS = [1, 1.5, 2.2];
const rid = (n) => crypto.randomBytes(n).toString('hex');
const cleanName = (s) => typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';

// 服务和本地测试使用独立实例，注入时钟便于验证计时器；保留默认实例导出兼容其他调用方。
function createHub(options = {}) {
  const now = options.now || Date.now;
  const later = options.setTimeout || setTimeout;
  const cancel = options.clearTimeout || clearTimeout;
  const every = options.setInterval || setInterval;
  const cancelEvery = options.clearInterval || clearInterval;
  const random = options.random || Math.random;
  const players = new Map(); // token -> { id, token, name, sockets:Set, room, touched }
  const byId = new Map();
  const rooms = new Map();
  let disposed = false;

  function send(ws, msg) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* 关闭中的连接由 close/心跳清理，不能中断其他席广播 */ }
  }
  function openSockets(p) { return [...p.sockets].filter((ws) => ws.readyState === 1 && ws.player === p); }
  function viewers(room) { return [...room.clients].filter((ws) => ws.readyState === 1 && ws.room === room.code && ws.player?.room === room.code && ws.player.sockets.has(ws) && seatOf(room, ws.player.id) >= 0); }
  function seatOf(room, pid) { return room.seats.findIndex((s) => !s.ai && s.pid === pid); }
  function isOnline(pid, room) {
    const p = byId.get(pid);
    return !!p && p.room === room.code && openSockets(p).some((ws) => ws.room === room.code && room.clients.has(ws));
  }
  // 离线是连接状态，不再覆盖手动托管/超时托管。重连不偷偷取消手动选择。
  function isAuto(room, s) { return !s.ai && (!!s.autoMode || !isOnline(s.pid, room)); }
  function autoFlags(room) { return room.seats.map((s) => isAuto(room, s)); }
  function autoModes(room) { return room.seats.map((s) => s.autoMode || null); }
  function roomSummary(room) {
    return {
      code: room.code, host: room.host, status: room.status,
      seats: room.seats.map((s, seat) => ({ seat, name: s.name, ai: s.ai, pid: s.pid || null, online: s.ai || isOnline(s.pid, room) })),
    };
  }
  function broadcastRoom(room) {
    const msg = { type: 'room', room: roomSummary(room) };
    for (const ws of viewers(room)) send(ws, msg);
  }
  function unanswered(d, seat) { return d.simul ? d.seats.includes(seat) && d.answers[seat] === undefined : d.seat === seat; }
  function deadlineIn(room, seat) {
    const state = room.timing;
    const entry = state && state.due.get(seat);
    if (!entry || state.pausedAt != null || !room.game || !room.game.pending || !unanswered(room.game.pending, seat) || entry.mode !== 'human') return null;
    return Math.max(0, entry.humanAt - now());
  }
  function gameMsg(room, p, events = [], full = false) {
    const seat = p ? seatOf(room, p.id) : -1;
    return { type: 'game', gameId: room.gameId, you: seat, events, snap: room.game.snapshot(seat), full: !!full, auto: autoFlags(room), autoModes: autoModes(room), speed: room.speed, deadlineIn: deadlineIn(room, seat) };
  }
  function broadcastAuto(room) {
    if (!room.game) return;
    for (const ws of viewers(room)) send(ws, { type: 'auto', gameId: room.gameId, auto: autoFlags(room), autoModes: autoModes(room), decisionId: room.game.pending ? room.game.pending.id : null, deadlineIn: deadlineIn(room, seatOf(room, ws.player.id)) });
  }
  function stopTimer(room) {
    cancel(room.timer);
    room.timer = null;
    room.scheduleVersion++;
    room.deadline = 0;
  }
  function transferHost(room) {
    const humans = room.seats.filter((s) => !s.ai && byId.get(s.pid)?.room === room.code);
    const online = humans.filter((s) => isOnline(s.pid, room));
    // 在线成员优先；无人在线时保留已有房主，支持短时断线后恢复。
    const candidates = online.length ? online : humans;
    if (!candidates.some((s) => s.pid === room.host)) room.host = candidates[0]?.pid || null;
  }

  /* ---------- 身份与连接 ---------- */
  function hello(ws, { token, name }) {
    if (token != null && token !== '' && (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token))) return '身份凭证无效';
    if (name != null && typeof name !== 'string') return '名字格式不正确';
    let p = token ? players.get(token) : ws.player;
    if (ws.player && ws.player !== p) disconnect(ws); // 换身份仅解绑本标签，不退掉旧身份的其他标签。
    if (!p) {
      p = { id: rid(6), token: rid(16), name: cleanName(name) || `选手${Math.floor(random() * 900 + 100)}`, sockets: new Set(), room: null, touched: now() };
      players.set(p.token, p);
      byId.set(p.id, p);
    } else if (cleanName(name)) p.name = cleanName(name);
    p.touched = now();
    p.sockets.add(ws);
    ws.player = p;
    let room = p.room && rooms.get(p.room);
    if (room && seatOf(room, p.id) < 0) room = null;
    if (!room) {
      // 防御陈旧 room 指针；不能保留一个仍能触发广播/暂停恢复的幽灵连接。
      const staleRoom = ws.room && rooms.get(ws.room);
      if (staleRoom) staleRoom.clients.delete(ws);
      p.room = null;
      ws.room = null;
      if (staleRoom) { transferHost(staleRoom); schedule(staleRoom); broadcastRoom(staleRoom); broadcastAuto(staleRoom); }
    }
    send(ws, { type: 'hello', token: p.token, id: p.id, name: p.name, room: p.room });
    if (room) {
      room.clients.add(ws);
      ws.room = room.code;
      room.touched = now();
      if (room.status === 'lobby') room.seats[seatOf(room, p.id)].name = p.name;
      transferHost(room);
      schedule(room);
      broadcastRoom(room);
      if (room.game) { send(ws, gameMsg(room, p, [], true)); broadcastAuto(room); }
    }
    return null;
  }
  function disconnect(ws) {
    const p = ws.player;
    const room = ws.room && rooms.get(ws.room);
    if (p) { p.sockets.delete(ws); p.touched = now(); }
    if (room) room.clients.delete(ws);
    ws.room = null;
    ws.player = null;
    if (room) {
      room.touched = now();
      transferHost(room);
      schedule(room);
      broadcastRoom(room);
      broadcastAuto(room);
    }
  }
  function releasePlayer(p, room, reason) {
    if (p.room === room.code) p.room = null;
    for (const ws of p.sockets) {
      if (ws.room !== room.code) continue;
      room.clients.delete(ws);
      ws.room = null;
      send(ws, { type: 'left', reason });
    }
    p.touched = now();
  }

  /* ---------- 房间 ---------- */
  function newCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    // 连续随机碰撞后按计数兜底，测试固定随机数或极端碰撞也不会卡死。
    for (let attempt = 0; ; attempt++) {
      let code = '';
      if (attempt < 32) for (let i = 0; i < 4; i++) code += alphabet[Math.floor(random() * alphabet.length)];
      else {
        let n = attempt - 32;
        for (let i = 0; i < 4; i++) { code = alphabet[n % alphabet.length] + code; n = Math.floor(n / alphabet.length); }
        if (n) throw new Error('房间编号已用完');
      }
      if (!rooms.has(code)) return code;
    }
  }
  function closeRoom(room, reason = 'closed') {
    stopTimer(room);
    room.timing = null;
    rooms.delete(room.code);
    for (const p of byId.values()) if (p.room === room.code) releasePlayer(p, room, reason);
    for (const ws of room.clients) {
      if (ws.room === room.code) { ws.room = null; send(ws, { type: 'left', reason }); }
    }
    room.clients.clear();
  }
  function leaveRoom(ws) {
    const p = ws.player;
    const room = p.room && rooms.get(p.room);
    if (!room) {
      p.room = null;
      for (const s of p.sockets) { s.room = null; send(s, { type: 'left' }); }
      return null;
    }
    releasePlayer(p, room, 'leave');
    if (room.status === 'lobby') {
      const seat = seatOf(room, p.id);
      if (seat >= 0) room.seats.splice(seat, 1);
    }
    const members = room.seats.some((s) => !s.ai && byId.get(s.pid)?.room === room.code);
    if (!members) { closeRoom(room); return null; }
    room.touched = now();
    transferHost(room);
    schedule(room);
    broadcastRoom(room);
    broadcastAuto(room);
    return null;
  }
  function enter(ws, room) {
    const p = ws.player;
    if (p.room && p.room !== room.code) leaveRoom(ws);
    p.room = room.code;
    p.touched = room.touched = now();
    for (const s of openSockets(p)) { s.room = room.code; room.clients.add(s); }
    transferHost(room);
    schedule(room);
    broadcastRoom(room);
    // 同身份所有标签进入同一房间，重连/加入不能只同步发起请求的一个标签。
    if (room.game) {
      for (const s of openSockets(p)) send(s, gameMsg(room, p, [], true));
      broadcastAuto(room);
    }
  }
  function createRoom(ws) {
    const p = ws.player;
    if (p.room) leaveRoom(ws);
    const room = {
      code: newCode(), host: p.id, status: 'lobby', seats: [{ pid: p.id, name: p.name, ai: false, autoMode: null }],
      clients: new Set(), game: null, gameId: null, timer: null, timing: null, scheduleVersion: 0, busyUntil: 0, touched: now(), speed: 1, deadline: 0,
    };
    rooms.set(room.code, room);
    enter(ws, room);
    return room;
  }
  function joinRoom(ws, code) {
    if (typeof code !== 'string') return '房间号格式不正确';
    const room = rooms.get(code.trim().toUpperCase());
    if (!room) return '房间不存在';
    const p = ws.player;
    if (seatOf(room, p.id) >= 0) { enter(ws, room); return null; }
    if (room.status !== 'lobby') return '对局已经开始了';
    if (room.seats.length >= 6 && !room.seats.some((s) => s.ai)) return '房间已满（最多 6 人）';
    if (p.room) leaveRoom(ws);
    if (room.seats.length >= 6) room.seats.splice(room.seats.findIndex((s) => s.ai), 1);
    room.seats.push({ pid: p.id, name: p.name, ai: false, autoMode: null });
    enter(ws, room);
    return null;
  }
  function currentRoom(ws) {
    const p = ws.player;
    const room = p && ws.room === p.room && rooms.get(p.room);
    return room && p.sockets.has(ws) && room.clients.has(ws) && seatOf(room, p.id) >= 0 ? room : null;
  }
  function hostRoom(ws) {
    const room = currentRoom(ws);
    if (!room || seatOf(room, ws.player.id) < 0) return '你不在房间里';
    if (room.host !== ws.player.id) return '只有房主可以操作';
    return room;
  }
  function addAI(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.status !== 'lobby') return '对局已开始';
    if (room.seats.length >= 6) return '最多 6 人';
    const used = new Set(room.seats.map((s) => s.name));
    const name = AI_NAMES.find((n) => !used.has(`${n}（AI）`)) || '机器人';
    room.seats.push({ pid: null, name: `${name}（AI）`, ai: true, autoMode: null });
    broadcastRoom(room);
    return null;
  }
  function removeAI(ws, seat) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.status !== 'lobby') return '对局已开始';
    if (!Number.isSafeInteger(seat) || seat < 0 || seat >= room.seats.length) return '席位编号无效';
    if (!room.seats[seat].ai) return '只能移除 AI';
    room.seats.splice(seat, 1);
    broadcastRoom(room);
    return null;
  }
  function startGame(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.status !== 'lobby') return '请先结束结算并返回大厅';
    if (room.seats.length < 3 || room.seats.length > 6) return '需要 3–6 名选手（可以加 AI）';
    room.status = 'playing';
    // 决策 ID 只在局内递增；跨房间/重开必须用独立的随机局标识隔离旧标签动作。
    room.gameId = crypto.randomUUID();
    room.game = new Game({ players: room.seats.map((s) => ({ name: s.name, ai: s.ai })), seed: Math.floor(random() * 2 ** 31) });
    room.busyUntil = now();
    room.timing = null;
    room.game.start();
    broadcastRoom(room);
    flush(room, true);
    return null;
  }
  function backToLobby(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.status !== 'over' || !room.game || room.game.phase !== 'over') return '对局还没结束';
    if (now() < room.busyUntil) return '结算动画还没结束，请稍等';
    stopTimer(room);
    room.timing = null;
    room.status = 'lobby';
    room.game = null;
    room.gameId = null;
    room.busyUntil = 0;
    room.seats = room.seats.filter((s) => {
      if (s.ai || isOnline(s.pid, room)) { s.autoMode = null; return true; }
      const p = byId.get(s.pid);
      if (p && p.room === room.code) releasePlayer(p, room, 'offline');
      return false;
    });
    transferHost(room);
    broadcastRoom(room);
    for (const c of viewers(room)) send(c, { type: 'lobby' });
    return null;
  }

  /* ---------- 对局 ---------- */
  function flush(room, full) {
    const events = room.game.drain();
    const t = now();
    room.busyUntil = Math.max(room.busyUntil, t) + batchMs(events) / room.speed;
    room.touched = t;
    if (room.game.phase === 'over') {
      room.status = 'over';
      broadcastRoom(room);
    }
    schedule(room);
    for (const ws of viewers(room)) send(ws, gameMsg(room, ws.player, events, full));
  }
  function act(ws, { gameId, id, value }) {
    const room = currentRoom(ws);
    if (!room || !room.game) return '没有进行中的对局';
    if (typeof gameId !== 'string' || gameId !== room.gameId) return '对局已过期，请重新选择';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众';
    const d = room.game.pending;
    if (!d || room.status !== 'playing') return '当前没有待决策项';
    // 引擎内部调用不变；不可信网络动作必须同时匹配局标识与局内决策 ID，不兼容省略字段。
    if (!Number.isSafeInteger(id) || id <= 0 || id !== d.id) return '决策已过期，请重新选择';
    if (typeof value !== 'string') return '无效选项';
    const err = room.game.answer(seat, id, value);
    if (err) return err;
    // 成功的真人操作明确接管；无效/过期动作不会偷偷取消托管。
    room.seats[seat].autoMode = null;
    flush(room);
    send(ws, { type: 'ack', for: 'act', gameId, id, value });
    return null;
  }

  // 每个决策每席只分配一次思考截止时间。断线与手动托管仅切换驱动方式，不重置其他席。
  function schedule(room) {
    stopTimer(room);
    if (disposed) { room.timing = null; return; }
    const g = room.game;
    const d = g && g.pending;
    if (!d) { room.timing = null; return; }
    const t = now();
    let state = room.timing;
    if (!state || state.game !== g || state.decision !== d) state = room.timing = { game: g, decision: d, readyAt: Math.max(room.busyUntil, t), due: new Map(), pausedAt: null };
    const watching = viewers(room).length > 0;
    if (watching && state.pausedAt != null) {
      const pause = t - state.pausedAt;
      state.readyAt += pause;
      for (const e of state.due.values()) { e.humanAt += pause; e.autoAt += pause; e.aiAt += pause; }
      if (room.busyUntil > state.pausedAt) room.busyUntil += pause;
      state.pausedAt = null;
    }
    const seats = d.simul ? d.seats.filter((s) => d.answers[s] === undefined) : [d.seat];
    let soonest = Infinity;
    let who = [];
    let humanDeadline = Infinity;
    for (const seat of seats) {
      const st = room.seats[seat];
      const mode = st.ai ? 'ai' : isAuto(room, st) ? 'auto' : 'human';
      let entry = state.due.get(seat);
      if (!entry) {
        entry = { humanAt: state.readyAt + (TIMEOUT[d.kind] || TIMEOUT.default), autoAt: state.readyAt + AWAY_DELAY, aiAt: state.readyAt + 350 + Math.floor(random() * 450), mode };
        state.due.set(seat, entry);
      } else if (mode === 'auto' && entry.mode !== 'auto') {
        entry.autoAt = Math.min(entry.humanAt, Math.max(state.readyAt, t) + AWAY_DELAY);
      }
      entry.mode = mode;
      const at = mode === 'ai' ? entry.aiAt : mode === 'auto' ? entry.autoAt : entry.humanAt;
      if (mode === 'human') humanDeadline = Math.min(humanDeadline, at);
      if (at < soonest) { soonest = at; who = [seat]; } else if (at === soonest) who.push(seat);
    }
    // 没有任何观众时暂停，包括剩余思考时间；有人返回后才继续。
    if (!watching) { if (state.pausedAt == null) state.pausedAt = t; return; }
    room.deadline = Number.isFinite(humanDeadline) ? humanDeadline : 0;
    if (!Number.isFinite(soonest)) return;
    const version = room.scheduleVersion;
    room.timer = later(() => {
      if (rooms.get(room.code) !== room || room.scheduleVersion !== version || room.game !== g || g.pending !== d) return;
      for (const seat of who) {
        if (g.pending !== d || !unanswered(d, seat)) continue;
        const st = room.seats[seat];
        if (!st.ai && !isAuto(room, st)) st.autoMode = 'timeout';
        const opts = d.simul ? d.optionsBySeat[seat] : d.options;
        let value = decide(g, d, seat);
        if (!opts.some((o) => o.v === value)) value = opts[0]?.v;
        g.answer(seat, d.id, value);
      }
      flush(room);
    }, Math.max(0, soonest - t));
    room.timer.unref?.();
  }
  function setAuto(ws, on) {
    if (typeof on !== 'boolean') return '托管状态必须是布尔值';
    const room = currentRoom(ws);
    if (!room || !room.game || room.status !== 'playing') return '没有进行中的对局';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众';
    room.seats[seat].autoMode = on ? 'manual' : null;
    schedule(room);
    broadcastAuto(room);
    return null;
  }
  function setSpeed(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    room.speed = SPEEDS[(SPEEDS.indexOf(room.speed) + 1) % SPEEDS.length];
    // 已发放的决策时间保持不变，新事件批次使用新速度。
    for (const c of viewers(room)) send(c, { type: 'speed', speed: room.speed, deadlineIn: deadlineIn(room, seatOf(room, c.player.id)) });
    return null;
  }
  function emote(ws, key) {
    const room = currentRoom(ws);
    if (!room) return '你不在房间里';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众';
    if (!EMOTES.has(key)) return '无效表情';
    const p = ws.player;
    const t = now();
    if (p.lastEmote != null && t - p.lastEmote < 800) return null; // 多标签共享限频。
    p.lastEmote = t;
    for (const c of viewers(room)) send(c, { type: 'emote', seat, key });
    return null;
  }
  function quick(ws, n) {
    const count = n === undefined ? 3 : n;
    if (!Number.isSafeInteger(count) || count < 2 || count > 5) return 'AI 数量必须是 2–5 的整数';
    createRoom(ws);
    for (let i = 0; i < count; i++) addAI(ws);
    return startGame(ws);
  }
  function handle(ws, msg) {
    if (disposed) return '服务已关闭';
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return '无效指令';
    if (ws.readyState !== 1) return '连接已关闭';
    if (msg.type !== 'hello' && (!ws.player || !ws.player.sockets.has(ws))) return '请先连接';
    if (ws.player) ws.player.touched = now();
    const room = currentRoom(ws);
    if (room) room.touched = now();
    switch (msg.type) {
      case 'hello': return hello(ws, msg);
      case 'setName': {
        if (typeof msg.name !== 'string' || !cleanName(msg.name)) return '请输入有效名字';
        const p = ws.player;
        p.name = cleanName(msg.name);
        if (room && room.status === 'lobby') { const seat = seatOf(room, p.id); if (seat >= 0) room.seats[seat].name = p.name; broadcastRoom(room); }
        for (const c of openSockets(p)) send(c, { type: 'hello', token: p.token, id: p.id, name: p.name, room: p.room });
        return null;
      }
      case 'create': createRoom(ws); return null;
      case 'join': return joinRoom(ws, msg.code);
      case 'leave': return leaveRoom(ws);
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
  function cleanup() {
    if (disposed) return;
    const t = now();
    for (const room of rooms.values()) if (!viewers(room).length && t - room.touched >= ROOM_TTL) closeRoom(room, 'expired');
    for (const p of players.values()) {
      if (!openSockets(p).length && !p.room && t - p.touched >= PLAYER_TTL) { players.delete(p.token); byId.delete(p.id); }
    }
  }
  const cleanupTimer = every(cleanup, 60 * 1000);
  cleanupTimer.unref?.();
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelEvery(cleanupTimer);
    for (const room of [...rooms.values()]) closeRoom(room);
    for (const p of players.values()) {
      for (const ws of p.sockets) { ws.player = null; ws.room = null; }
      p.sockets.clear();
      p.room = null;
    }
    players.clear();
    byId.clear();
  }
  function getDeadlineIn(ws) {
    const room = currentRoom(ws);
    return room ? deadlineIn(room, seatOf(room, ws.player.id)) : null;
  }
  function recover(ws) {
    const room = currentRoom(ws);
    if (room?.game) send(ws, gameMsg(room, ws.player, [], true));
  }
  function errorContext(ws, type) {
    const room = currentRoom(ws);
    return {
      gameId: room?.game ? room.gameId : null,
      deadlineIn: getDeadlineIn(ws),
      decisionId: room?.game?.pending?.id ?? null,
      ...(type === 'lobby' && room?.status === 'over' && now() < room.busyUntil ? { retryIn: Math.ceil(room.busyUntil - now()) } : {}),
    };
  }
  return { handle, disconnect, rooms, cleanup, dispose, getDeadlineIn, recover, errorContext };
}

module.exports = { ...createHub(), createHub };
