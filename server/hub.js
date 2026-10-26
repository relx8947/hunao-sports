'use strict';
// 房间与对局管理：全部在内存里。计时器按决策保存，连接变化不会重新发放思考时间。
const crypto = require('crypto');
const { Game } = require('../game/engine');
const { decide } = require('../game/ai');
const { EDITIONS, DEFAULT_EDITION } = require('../game/tracks');
const editionOf = (value) => (typeof value === 'string' && EDITIONS[value] ? value : DEFAULT_EDITION);
const { batchMs } = require('../public/timing');
const { createGameLog } = require('./gamelog');

const AI_NAMES = ['阿呆', '小飞', '豆豆', '球球', '闪电', '胖虎', '米粒', '大卫', '可乐', '跳跳'];
const EMOTES = new Set(['哈哈哈', '离谱！', '好耶', '救命', '666', '等等我']);
const TIMEOUT = { draft: 40000, pickRacer: 45000, roll: 25000, default: 30000 };
const AWAY_DELAY = 2500;
const ROOM_TTL = 30 * 60 * 1000;
const PLAYER_TTL = 24 * 60 * 60 * 1000;
const SPEEDS = [1, 1.5, 2.2];
const SKIP_SPEED = 6; // 真人都跑完后「快进到结算」：只加速本场剩余的 AI 回合
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
  // 对局日志：只有传了 logDir 才写盘（测试和 require 默认不写）
  const gameLog = options.gameLog || createGameLog({ dir: options.logDir, now });
  let lastPrune = now();
  const players = new Map(); // token -> { id, token, name, sockets:Set, room, touched }
  const byId = new Map();
  const rooms = new Map();
  const listSubscribers = new Set(); // 仅请求列表的本标签订阅，不扩散到同身份的其他标签。
  let disposed = false;

  function send(ws, msg) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* 关闭中的连接由 close/心跳清理，不能中断其他席广播 */ }
  }
  function openSockets(p) { return [...p.sockets].filter((ws) => ws.readyState === 1 && ws.player === p); }
  function seatOf(room, pid) { return room.seats.findIndex((s) => !s.ai && s.pid === pid); }
  // 成员资格与比赛席位分离：观众有身份和房间绑定，但永远没有参赛 seat。
  function hasMember(room, pid) { return room.mode === 'spectator' ? room.spectators.has(pid) : seatOf(room, pid) >= 0; }
  function memberIds(room) {
    const ids = room.mode === 'spectator' ? [...room.spectators] : room.seats.filter((s) => !s.ai).map((s) => s.pid);
    return ids.filter((id) => byId.get(id)?.room === room.code);
  }
  function viewers(room) { return [...room.clients].filter((ws) => ws.readyState === 1 && ws.room === room.code && ws.player?.room === room.code && ws.player.sockets.has(ws) && hasMember(room, ws.player.id)); }
  function isOnline(pid, room) {
    const p = byId.get(pid);
    return !!p && hasMember(room, pid) && p.room === room.code && openSockets(p).some((ws) => ws.room === room.code && room.clients.has(ws));
  }
  // 离线是连接状态，不再覆盖手动托管/超时托管。重连不偷偷取消手动选择。
  function isAuto(room, s) { return !s.ai && (!!s.autoMode || !isOnline(s.pid, room)); }
  function autoFlags(room) { return room.seats.map((s) => isAuto(room, s)); }
  function autoModes(room) { return room.seats.map((s) => s.autoMode || null); }
  function roomSummary(room) {
    return {
      code: room.code, host: room.host, status: room.status, edition: room.edition,
      seats: room.seats.map((s, seat) => ({ seat, name: s.name, ai: s.ai, pid: s.pid || null, online: s.ai || isOnline(s.pid, room) })),
      ...(room.mode === 'spectator' ? { mode: room.mode, spectators: memberIds(room).map((id) => ({ id, name: byId.get(id).name, online: isOnline(id, room) })) } : {}),
    };
  }
  // 公开目录与房内快照分开：只保留安全摘要，不能泄漏身份、手牌或游戏状态。
  function snapshotDirectory() {
    const directorySnapshot = [];
    for (const room of rooms.values()) {
      const members = memberIds(room);
      const online = members.filter((id) => isOnline(id, room)).length;
      // 暂停房间仍可凭原邀请码/身份返回，但无人在线时不放进公开大厅。
      if (!online) continue;
      const spectator = room.mode === 'spectator';
      const aiCount = room.seats.filter((s) => s.ai).length;
      const humanCount = room.seats.length - aiCount;
      const host = members.includes(room.host) ? byId.get(room.host) : byId.get(members[0]);
      directorySnapshot.push({
        summary: {
          code: room.code, mode: spectator ? 'spectator' : 'play', status: room.status, edition: room.edition,
          hostName: host?.name || room.seats.find((s) => !s.ai)?.name || '公开房间',
          playerCount: room.seats.length, aiCount, humanCount,
          onlineCount: online, maxPlayers: 6,
          spectatorCount: spectator ? members.length : 0,
          onlineSpectatorCount: spectator ? online : 0,
        },
        // 与 joinRoom 的成员返回规则一致，已经离席但保留的比赛席位也可返回。
        members: new Set(spectator ? room.spectators : room.seats.filter((s) => !s.ai).map((s) => s.pid)),
      });
    }
    return directorySnapshot;
  }
  function directoryRank(room) {
    if (room.mode === 'play' && room.status === 'lobby' && room.canJoin) return 0;
    if (room.mode === 'spectator') return 1;
    return room.status === 'lobby' ? 2 : room.status === 'playing' ? 3 : 4;
  }
  function sendDirectory(ws, snapshot) {
    if (ws.readyState !== 1 || !ws.player || byId.get(ws.player.id) !== ws.player || !ws.player.sockets.has(ws)) {
      listSubscribers.delete(ws);
      return;
    }
    const list = snapshot.map(({ summary, members }) => {
      const isMember = members.has(ws.player.id);
      const canJoin = isMember || summary.mode === 'spectator' ||
        (summary.status === 'lobby' && (summary.playerCount < 6 || summary.aiCount > 0));
      return { ...summary, canJoin, isMember };
    });
    list.sort((a, b) => directoryRank(a) - directoryRank(b) || a.code.localeCompare(b.code));
    send(ws, { type: 'roomList', rooms: list });
  }
  function notifyDirectory() {
    if (disposed || !listSubscribers.size) return;
    // 一次房间变化只计算一次轻量目录，再按订阅者身份附加加入权限。
    const snapshot = snapshotDirectory();
    for (const ws of listSubscribers) sendDirectory(ws, snapshot);
  }
  function listRooms(ws, msg) {
    if (Object.keys(msg).some((key) => key !== 'type')) return '指令参数不正确';
    listSubscribers.add(ws);
    // 手动刷新也重新核对 OPEN 状态，不依赖可能尚未到达的 close 事件。
    sendDirectory(ws, snapshotDirectory());
    return null;
  }
  function broadcastRoom(room) {
    const msg = { type: 'room', room: roomSummary(room) };
    for (const ws of viewers(room)) send(ws, msg);
    notifyDirectory();
  }
  function unanswered(d, seat) { return d.simul ? d.seats.includes(seat) && d.answers[seat] === undefined : d.seat === seat; }
  function deadlineIn(room, seat) {
    const state = room.timing;
    const entry = state && state.due.get(seat);
    if (!entry || state.pausedAt != null || !room.game || !room.game.pending || !unanswered(room.game.pending, seat) || entry.mode !== 'human') return null;
    return Math.max(0, entry.humanAt - now());
  }
  // 所有真人席位各自的剩余思考时间 { 座位: 毫秒 }，客户端据此在每个人的头像上画倒计时环
  function deadlines(room) {
    const state = room.timing, pending = room.game && room.game.pending;
    if (!state || state.pausedAt != null || !pending) return null;
    const out = {};
    for (const [seat, entry] of state.due) {
      if (entry.mode === 'human' && unanswered(pending, seat)) out[seat] = Math.max(0, entry.humanAt - now());
    }
    return Object.keys(out).length ? out : null;
  }
  function gameMsg(room, p, events = [], full = false) {
    const seat = p ? seatOf(room, p.id) : -1;
    return { type: 'game', gameId: room.gameId, edition: room.edition, you: seat, events, snap: room.game.snapshot(seat), full: !!full, auto: autoFlags(room), autoModes: autoModes(room), speed: room.speed, deadlineIn: deadlineIn(room, seat), deadlines: deadlines(room), ...(room.mode === 'spectator' ? { mode: room.mode } : {}) };
  }
  function broadcastAuto(room) {
    if (!room.game) return;
    for (const ws of viewers(room)) send(ws, { type: 'auto', gameId: room.gameId, auto: autoFlags(room), autoModes: autoModes(room), decisionId: room.game.pending ? room.game.pending.id : null, deadlineIn: deadlineIn(room, seatOf(room, ws.player.id)), deadlines: deadlines(room) });
  }
  function stopTimer(room) {
    cancel(room.timer);
    room.timer = null;
    room.scheduleVersion++;
    room.deadline = 0;
  }
  function transferHost(room) {
    const members = memberIds(room);
    const online = members.filter((id) => isOnline(id, room));
    // 在线成员优先；无人在线时保留已有房主，支持短时断线后恢复。
    const candidates = online.length ? online : members;
    if (!candidates.includes(room.host)) room.host = candidates[0] || null;
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
    if (room && !hasMember(room, p.id)) room = null;
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
      const seat = seatOf(room, p.id);
      if (room.status === 'lobby' && seat >= 0) room.seats[seat].name = p.name;
      transferHost(room);
      schedule(room);
      broadcastRoom(room);
      if (room.game) { send(ws, gameMsg(room, p, [], true)); broadcastAuto(room); }
    }
    return null;
  }
  function disconnect(ws) {
    listSubscribers.delete(ws);
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
  function endLog(room, reason) {
    if (!room.log) return;
    const g = room.game;
    room.log.end(reason, g ? { phase: g.phase, raceNo: g.raceNo, scores: g.players.map((p) => p.score) } : {});
    room.log = null;
  }
  function closeRoom(room, reason = 'closed') {
    endLog(room, reason);
    stopTimer(room);
    room.timing = null;
    rooms.delete(room.code);
    for (const p of byId.values()) if (p.room === room.code) releasePlayer(p, room, reason);
    for (const ws of room.clients) {
      if (ws.room === room.code) { ws.room = null; send(ws, { type: 'left', reason }); }
    }
    room.clients.clear();
    room.spectators.clear();
    notifyDirectory();
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
    room.spectators.delete(p.id);
    if (room.status === 'lobby') {
      const seat = seatOf(room, p.id);
      if (seat >= 0) room.seats.splice(seat, 1);
    }
    if (!memberIds(room).length) { closeRoom(room); return null; }
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
    if (room.mode === 'spectator') room.spectators.add(p.id);
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
  function createRoom(ws, mode = 'play', aiCount = 0, edition = DEFAULT_EDITION) {
    const p = ws.player;
    if (p.room) leaveRoom(ws);
    const room = {
      code: newCode(), host: p.id, status: 'lobby', edition: editionOf(edition), seats: mode === 'spectator' ? [] : [{ pid: p.id, name: p.name, ai: false, autoMode: null }],
      ...(mode === 'spectator' ? { mode } : {}), spectators: new Set(),
      clients: new Set(), game: null, gameId: null, timer: null, timing: null, scheduleVersion: 0, busyUntil: 0, touched: now(), speed: 1, deadline: 0, log: null,
    };
    for (let i = 0; i < aiCount; i++) appendAI(room);
    rooms.set(room.code, room);
    enter(ws, room);
    return room;
  }
  function joinRoom(ws, code) {
    if (typeof code !== 'string') return '房间号格式不正确';
    const room = rooms.get(code.trim().toUpperCase());
    if (!room) return '房间不存在';
    const p = ws.player;
    if (hasMember(room, p.id) || room.mode === 'spectator') { enter(ws, room); return null; }
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
    return room && p.sockets.has(ws) && room.clients.has(ws) && hasMember(room, p.id) ? room : null;
  }
  function hostRoom(ws) {
    const room = currentRoom(ws);
    if (!room) return '你不在房间里';
    if (room.host !== ws.player.id) return '只有房主可以操作';
    return room;
  }
  function appendAI(room) {
    const used = new Set(room.seats.map((s) => s.name));
    const name = AI_NAMES.find((n) => !used.has(`${n}（AI）`)) || '机器人';
    room.seats.push({ pid: null, name: `${name}（AI）`, ai: true, autoMode: null });
  }
  function addAI(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode === 'spectator') return '观战房间不能修改参赛席位';
    if (room.status !== 'lobby') return '对局已开始';
    if (room.seats.length >= 6) return '最多 6 人';
    appendAI(room);
    broadcastRoom(room);
    return null;
  }
  function removeAI(ws, seat) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode === 'spectator') return '观战房间不能修改参赛席位';
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
    if (room.mode === 'spectator') return '观战房间请使用再看一局';
    if (room.status !== 'lobby') return '请先结束结算并返回大厅';
    if (room.seats.length < 3 || room.seats.length > 6) return '需要 3–6 名选手（可以加 AI）';
    return beginGame(room);
  }
  function beginGame(room) {
    stopTimer(room);
    room.status = 'playing';
    // 决策 ID 只在局内递增；跨房间/重开必须用独立的随机局标识隔离旧标签动作。
    room.gameId = crypto.randomUUID();
    endLog(room, 'replaced');
    const seed = Math.floor(random() * 2 ** 31);
    room.game = new Game({ players: room.seats.map((s) => ({ name: s.name, ai: s.ai })), seed, edition: room.edition });
    room.log = gameLog.begin({ gameId: room.gameId, room: room.code, mode: room.mode || 'play', edition: room.edition, seed, players: room.seats.map((s) => ({ name: s.name, ai: !!s.ai })) });
    room.busyUntil = now();
    room.timing = null;
    room.game.start();
    broadcastRoom(room);
    flush(room, true);
    return null;
  }
  function replay(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode !== 'spectator') return '只有观战房间可以再看一局';
    if (room.status !== 'over' || !room.game || room.game.phase !== 'over') return '对局还没结束';
    if (now() < room.busyUntil) return '结算动画还没结束，请稍等';
    return beginGame(room);
  }
  function backToLobby(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode === 'spectator') return '观战房间请使用再看一局';
    if (room.status !== 'over' || !room.game || room.game.phase !== 'over') return '对局还没结束';
    if (now() < room.busyUntil) return '结算动画还没结束，请稍等';
    stopTimer(room);
    room.timing = null;
    room.status = 'lobby';
    endLog(room, 'lobby');
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

  // 只有一名真人的快速局：沿用同一房间与 AI 席位直接重开，不再先回大厅。
  function playAgain(ws) {
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode === 'spectator') return '观战房间请使用再看一局';
    if (room.status !== 'over' || !room.game || room.game.phase !== 'over') return '对局还没结束';
    if (room.seats.filter((s) => !s.ai).length !== 1) return '多人房间请回到大厅再开一局';
    if (now() < room.busyUntil) return '结算动画还没结束，请稍等';
    for (const s of room.seats) s.autoMode = null;
    room.boost = null;
    return beginGame(room);
  }
  // 本场所有真人选手都已冲线或出局时，任一真人可把本场剩余的 AI 回合快进；下一场恢复原速度。
  function skipRace(ws) {
    const room = currentRoom(ws);
    if (!room || !room.game) return '没有进行中的对局';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众';
    const g = room.game;
    if (room.status !== 'playing' || g.phase !== 'race') return '现在不能快进';
    const done = (s) => { const r = g.racers.find((x) => x.seat === s); return !r || !!r.finished || !!r.out; };
    if (!room.seats.every((s, i) => s.ai || done(i))) return '还有真人选手在比赛';
    if (room.boost) return null;
    room.boost = { race: g.raceNo, prev: room.speed };
    room.speed = SKIP_SPEED;
    for (const c of viewers(room)) send(c, { type: 'speed', speed: room.speed, boost: true, deadlineIn: deadlineIn(room, seatOf(room, c.player.id)), deadlines: deadlines(room) });
    return null;
  }
  // 快进只覆盖本场：一旦这一批事件跑出了本场（结算、下一场或终局），在排程前恢复原速度。
  function settleBoost(room) {
    const b = room.boost;
    if (!b || (room.game && room.game.phase === 'race' && room.game.raceNo === b.race)) return;
    room.boost = null;
    if (room.speed === SKIP_SPEED) room.speed = b.prev;
  }

  /* ---------- 对局 ---------- */
  function flush(room, full) {
    settleBoost(room);
    const events = room.game.drain();
    room.log?.events(events);
    const t = now();
    // 动画随倍速缩短；结算停留（Timing.FIXED）不缩短，免得下一场的选人浮层顶掉结果
    room.busyUntil = Math.max(room.busyUntil, t) + batchMs(events, room.speed);
    room.touched = t;
    if (room.game.phase === 'over') {
      room.status = 'over';
      endLog(room, 'over');
      broadcastRoom(room);
    }
    schedule(room);
    for (const ws of viewers(room)) send(ws, gameMsg(room, ws.player, events, full));
  }
  function act(ws, { gameId, id, value }) {
    const room = currentRoom(ws);
    if (!room || !room.game) return '没有进行中的对局';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众，不能操作选手';
    if (typeof gameId !== 'string' || gameId !== room.gameId) return '对局已过期，请重新选择';
    const d = room.game.pending;
    if (!d || room.status !== 'playing') return '当前没有待决策项';
    // 引擎内部调用不变；不可信网络动作必须同时匹配局标识与局内决策 ID，不兼容省略字段。
    if (!Number.isSafeInteger(id) || id <= 0 || id !== d.id) return '决策已过期，请重新选择';
    if (typeof value !== 'string') return '无效选项';
    const err = room.game.answer(seat, id, value);
    if (err) return err;
    room.log?.answer(seat, d, value, 'human');
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
      // close/心跳清理可能晚于连接失去可写状态；不能靠集合中残留的连接多推进一步。
      if (!viewers(room).length) { schedule(room); return; }
      for (const seat of who) {
        if (g.pending !== d || !unanswered(d, seat)) continue;
        const st = room.seats[seat];
        const by = st.ai ? 'ai' : !isAuto(room, st) || st.autoMode === 'timeout' ? 'timeout' : 'auto';
        if (!st.ai && !isAuto(room, st)) st.autoMode = 'timeout';
        const opts = d.simul ? d.optionsBySeat[seat] : d.options;
        let value = decide(g, d, seat);
        if (!opts.some((o) => o.v === value)) value = opts[0]?.v;
        if (!g.answer(seat, d.id, value)) room.log?.answer(seat, d, value, by);
      }
      flush(room);
    }, Math.max(0, soonest - t));
    room.timer.unref?.();
  }
  function setAuto(ws, on) {
    if (typeof on !== 'boolean') return '托管状态必须是布尔值';
    const room = currentRoom(ws);
    if (!room || !room.game) return '没有进行中的对局';
    const seat = seatOf(room, ws.player.id);
    if (seat < 0) return '你是观众';
    if (room.status !== 'playing') return '没有进行中的对局';
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
    for (const c of viewers(room)) send(c, { type: 'speed', speed: room.speed, deadlineIn: deadlineIn(room, seatOf(room, c.player.id)), deadlines: deadlines(room) });
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
  // 房主在大厅切换模式（一代/二代/混合）；开局后锁定
  function setEdition(ws, edition) {
    if (typeof edition !== 'string' || !EDITIONS[edition]) return '未知的模式';
    const room = hostRoom(ws);
    if (typeof room === 'string') return room;
    if (room.mode === 'spectator') return '观战房间请在创建时选择模式';
    if (room.status !== 'lobby') return '对局已开始，不能切换模式';
    room.edition = edition;
    broadcastRoom(room);
    return null;
  }
  function quick(ws, n, edition) {
    const count = n === undefined ? 3 : n;
    if (!Number.isSafeInteger(count) || count < 2 || count > 5) return 'AI 数量必须是 2–5 的整数';
    if (edition !== undefined && !EDITIONS[edition]) return '未知的模式';
    createRoom(ws, 'play', 0, edition);
    for (let i = 0; i < count; i++) addAI(ws);
    return startGame(ws);
  }
  function watch(ws, n, edition) {
    const count = n === undefined ? 4 : n;
    // 先校验后离开旧房间；非法参数不能退席或生成一个空观战房间。
    if (!Number.isSafeInteger(count) || count < 3 || count > 6) return 'AI 数量必须是 3–6 的整数';
    if (edition !== undefined && !EDITIONS[edition]) return '未知的模式';
    return beginGame(createRoom(ws, 'spectator', count, edition));
  }
  function handle(ws, msg) {
    if (disposed) return '服务已关闭';
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return '无效指令';
    if (ws.readyState !== 1) return '连接已关闭';
    if (msg.type !== 'hello' && (!ws.player || !ws.player.sockets.has(ws))) return '请先连接';
    // 列表查询是纯只读：不 touch、不改成员资格，也不重新调度或 drain 游戏事件。
    if (msg.type === 'listRooms') return listRooms(ws, msg);
    // watch 的人数校验先于 touched 更新，非法创建请求没有任何房间/身份副作用。
    if (msg.type === 'watch') return watch(ws, msg.ai, msg.edition);
    if (ws.player) ws.player.touched = now();
    const room = currentRoom(ws);
    if (room) room.touched = now();
    switch (msg.type) {
      case 'hello': return hello(ws, msg);
      case 'setName': {
        if (typeof msg.name !== 'string' || !cleanName(msg.name)) return '请输入有效名字';
        const p = ws.player;
        p.name = cleanName(msg.name);
        if (room && (room.status === 'lobby' || room.mode === 'spectator')) {
          const seat = seatOf(room, p.id);
          if (seat >= 0 && room.status === 'lobby') room.seats[seat].name = p.name;
          broadcastRoom(room);
        } else if (room) notifyDirectory(); // 比赛席位名字冻结，但公开目录房主名随身份改名。
        for (const c of openSockets(p)) send(c, { type: 'hello', token: p.token, id: p.id, name: p.name, room: p.room });
        return null;
      }
      case 'create':
        if (msg.edition !== undefined && !EDITIONS[msg.edition]) return '未知的模式';
        createRoom(ws, 'play', 0, msg.edition);
        return null;
      case 'edition': return setEdition(ws, msg.edition);
      case 'join': return joinRoom(ws, msg.code);
      case 'leave': return leaveRoom(ws);
      case 'addAI': return addAI(ws);
      case 'removeAI': return removeAI(ws, msg.seat);
      case 'start': return startGame(ws);
      case 'quick': return quick(ws, msg.ai, msg.edition);
      case 'replay': return replay(ws);
      case 'act': return act(ws, msg);
      case 'auto': return setAuto(ws, msg.on);
      case 'emote': return emote(ws, msg.key);
      case 'speed': return setSpeed(ws);
      case 'lobby': return backToLobby(ws);
      case 'again': return playAgain(ws);
      case 'skip': return skipRace(ws);
      default: return '未知指令';
    }
  }
  function cleanup() {
    if (disposed) return;
    const t = now();
    if (t - lastPrune >= 60 * 60 * 1000) { lastPrune = t; gameLog.prune(); }
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
    listSubscribers.clear();
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
      deadlines: (() => { const room = currentRoom(ws); return room ? deadlines(room) : null; })(),
      decisionId: room?.game?.pending?.id ?? null,
      ...((type === 'lobby' || type === 'replay' || type === 'again') && room?.status === 'over' && now() < room.busyUntil ? { retryIn: Math.ceil(room.busyUntil - now()) } : {}),
    };
  }
  // 进程被 systemd 停掉前调用：给还在进行的对局补一条 end，复盘时能看出是重启打断的
  function shutdownLogs() { for (const room of rooms.values()) endLog(room, 'shutdown'); }
  return { handle, disconnect, rooms, cleanup, dispose, getDeadlineIn, recover, errorContext, shutdownLogs };
}

module.exports = { ...createHub(), createHub };
