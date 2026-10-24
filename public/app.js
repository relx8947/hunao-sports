(() => {
  'use strict';
  /* ================= 基础 ================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const CANCELLED = new Error('动画已取消');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const PCOL = ['#FF6B57', '#3B9EFF', '#22B573', '#FFB020', '#8B6CF0', '#F25CA2'];
  const RACERS = window.RACERS;
  const R = Object.fromEntries(RACERS.map((r) => [r.id, r]));
  const TRACKS = window.TRACKS;
  const FIN = window.FINISH;
  const GOLD = window.GOLD, SILVER = window.SILVER, SCHEDULE = window.SCHEDULE;
  const EMOTES = ['哈哈哈', '离谱！', '好耶', '救命', '666', '等等我'];
  const INK = '#231F33';

  const art = (id) => (window.Art ? Art.racer(id) : `<svg viewBox="0 0 100 100"><circle cx="50" cy="55" r="32" fill="#ddd" stroke="${INK}" stroke-width="3"/></svg>`);
  const icon = (n) => (window.Art && Art.icon ? Art.icon(n) : '');
  const rcol = (id) => (window.Art && Art.color ? Art.color(id) : '#F4EDDF');
  const die = (v) => (window.Art && Art.die ? Art.die(v) : `<svg viewBox="0 0 100 100"><rect x="8" y="8" width="84" height="84" rx="18" fill="#fff" stroke="${INK}" stroke-width="5"/><text x="50" y="66" font-size="44" text-anchor="middle" font-weight="900">${v}</text></svg>`);
  function fillIcons(root = document) {
    for (const el of $$('[data-icon]', root)) if (!el.dataset.filled) { el.innerHTML = icon(el.dataset.icon); el.dataset.filled = '1'; }
  }

  /* ================= 一屏分页 ================= */
  // 页面不滚动：集合放不下时按页显示。容器高度由布局限定（flex 收缩），
  // 二分找出真正放得下的每页条数；左右按钮、左右滑动、方向键都能翻页。
  const pagers = {};
  function paginate(key, box, getItems, host) {
    const st = pagers[key] || (pagers[key] = { anchor: 0, dir: 0 });
    st.run = () => paginate(key, box, getItems, host);
    st.box = box;
    if (!box.offsetParent) return st; // 还没显示出来量不了尺寸，显示后由 refitPagers 补排
    const items = getItems();
    const n = items.length;
    const apply = (per) => {
      const page = Math.floor(Math.min(st.anchor, Math.max(0, n - 1)) / per);
      items.forEach((el, i) => { el.hidden = Math.floor(i / per) !== page; });
      return page;
    };
    const fits = () => box.scrollHeight <= box.clientHeight + 1;
    let per = Math.max(1, n);
    apply(per);
    if (n > 1 && !fits()) {
      let lo = 1, hi = n - 1;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); apply(mid); if (fits()) lo = mid; else hi = mid - 1; }
      per = lo;
    }
    const page = apply(per);
    const pages = Math.max(1, Math.ceil(n / per));
    st.anchor = page * per;
    st.per = per; st.pages = pages; st.page = page;
    st.h = box.clientHeight;
    // 旁边的提示栏、状态条变高变矮时容器会被挤压/放开，尺寸变了就重新分页
    if (!st.ro && window.ResizeObserver) {
      st.ro = new ResizeObserver(() => {
        if (!box.isConnected || !box.offsetParent || Math.abs(box.clientHeight - st.h) < 2) return;
        cancelAnimationFrame(st.raf);
        st.raf = requestAnimationFrame(() => st.run());
      });
      st.ro.observe(box);
    }
    if (st.dir) {
      box.classList.remove('pg-in-next', 'pg-in-prev');
      void box.offsetWidth;
      box.classList.add(st.dir > 0 ? 'pg-in-next' : 'pg-in-prev');
      st.dir = 0;
    }
    if (host) {
      host.hidden = pages <= 1;
      host.innerHTML = pages <= 1 ? '' : `<button class="pg-btn" data-pg="-1" aria-label="上一页"${page === 0 ? ' disabled' : ''}>${icon('arrowL')}</button><span class="pg-no" aria-live="polite">${page + 1} / ${pages}</span><button class="pg-btn" data-pg="1" aria-label="下一页"${page >= pages - 1 ? ' disabled' : ''}>${icon('arrowR')}</button>`;
      host.onclick = (e) => { const b = e.target.closest('[data-pg]'); if (b && !b.disabled) turnPage(key, Number(b.dataset.pg)); };
    }
    if (!box.dataset.swipe) {
      box.dataset.swipe = '1';
      let sx = 0, sy = 0, swiped = false;
      box.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; swiped = false; });
      box.addEventListener('pointerup', (e) => {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && (pagers[key].pages || 1) > 1) { swiped = true; turnPage(key, dx < 0 ? 1 : -1); }
      });
      // 滑动翻页后不要把这次手势当成点击（选秀卡牌本身是按钮）
      box.addEventListener('click', (e) => { if (swiped) { swiped = false; e.stopPropagation(); e.preventDefault(); } }, true);
    }
    return st;
  }
  function turnPage(key, d) {
    const st = pagers[key];
    if (!st || !st.run) return;
    const page = Math.max(0, Math.min(st.pages - 1, st.page + d));
    if (page === st.page) return;
    st.anchor = page * st.per; st.dir = d;
    Sound.click();
    st.run();
  }
  function refitPagers() {
    for (const st of Object.values(pagers)) if (st.run && st.box && st.box.isConnected && st.box.offsetParent) st.run();
  }

  /* ================= 状态 ================= */
  let ws = null;
  let me = store.get('hn_me', {});
  if (!me || typeof me !== 'object' || Array.isArray(me)) me = {};
  let room = null;
  let gameId = null;
  let gameMode = null;
  const retiredGames = new Set();
  const isSpectator = () => room?.mode === 'spectator' || gameMode === 'spectator';
  const isParticipant = () => !isSpectator() && you >= 0;
  let inviteRoom = new URLSearchParams(location.search).get('room');
  let snap = null; // 服务端最新权威快照
  let vs = null; // 当前画面状态（随动画推进）
  let you = -1;
  let speed = 1;
  let autoFlags = [];
  let deadlineAt = 0;
  const queue = [];
  let playing = false;
  let fast = false;
  let lastYourTurnId = null;
  let overlayKind = null;
  let overlayDecision = null;
  let builtTrack = null;
  let layout = 'wide';
  let podium = { 1: [153, 171], 2: [114, 189] };
  let lastGameOver = null;
  let reconnectDelay = 800;
  let connection = 'connecting';
  let greeted = false;
  let reconnectTimer = null;
  let handshakeTimer = null;
  let animationEpoch = 0;
  const animationTimers = new Set();
  const animationIntervals = new Set();
  const pendingWaits = new Set();
  let submitted = null;
  let submitTimer = null;
  let autoModes = [];
  let timerTicker = null;
  let timerEnds = 0;
  let timerDuration = 0;
  let deadlineId = null;
  let overlayHideTimer = null;
  let lastFullContext = null;
  let navigationPending = null;
  let navigationTimer = null;
  let roomRows = [];
  let roomsLoading = false;
  let roomsFresh = false;
  let roomsReceived = false;

  /* ================= 连接 ================= */
  function setConnection(state) {
    connection = state;
    if (state !== 'ready') { roomsFresh = false; roomsLoading = false; }
    document.body.dataset.connection = state;
    const status = $('#connectionStatus');
    if (status) {
      status.hidden = state === 'ready';
      status.textContent = state === 'syncing' ? '正在同步房间，请稍候…' : state === 'connecting' ? '正在连接服务器…' : '连接断开，正在重连；未确认操作将核对最新局面';
    }
    if (state === 'ready') clearTimeout(handshakeTimer);
    for (const el of $$('[data-network]')) el.disabled = state !== 'ready';
    for (const el of $$('[data-navigation]')) el.disabled = state !== 'ready' || !!navigationPending;
    renderTopButtons();
    renderRoomDirectory();
    syncFinalActions();
    if (room && room.status === 'lobby') renderLobby();
  }
  function connect() {
    clearTimeout(reconnectTimer);
    setConnection('connecting');
    greeted = false;
    // 相对当前页面路径连接，挂在任意子路径（如 /hunao/）下都能用
    const u = new URL('ws', location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = '';
    const socket = new WebSocket(u.toString());
    ws = socket;
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => { if (ws === socket && connection !== 'ready') socket.close(); }, 10000);
    socket.onopen = () => {
      if (ws !== socket) return;
      setConnection('syncing');
      send({ type: 'hello', token: me.token, name: me.name || $('#nameInput').value.trim() }, true);
    };
    socket.onmessage = (ev) => {
      if (ws !== socket) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && typeof msg === 'object') handle(msg);
    };
    socket.onclose = () => {
      if (ws !== socket) return;
      clearTimeout(handshakeTimer);
      greeted = false;
      // 关闭时不知道 act 是否被服务端处理；重连快照决定，不自动重发。
      clearTimeout(submitTimer); submitTimer = null;
      clearNavigation();
      deadlineAt = 0;
      setConnection('offline');
      clearPromptLive();
      if (!playing) renderPrompt();
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
    };
    socket.onerror = () => { if (ws === socket) socket.close(); };
  }
  function send(m, quiet = false) {
    // 观众没有个人席位；即使旧按钮或快捷键仍有引用，也不能提交玩家动作。
    if (isSpectator() && ['act', 'auto', 'emote'].includes(m.type)) return false;
    if (isSpectator() && ['speed', 'replay'].includes(m.type) && room?.host !== me.id) return false;
    if (!ws || ws.readyState !== WebSocket.OPEN || (m.type !== 'hello' && (!greeted || connection !== 'ready'))) {
      if (!quiet) toast('尚未连接，请等重连完成后重新操作', true);
      return false;
    }
    try { ws.send(JSON.stringify(m)); return true; } catch (e) {
      if (!quiet) toast('发送失败，请重连后重试', true);
      ws.close();
      return false;
    }
  }
  function clearSubmission() {
    clearTimeout(submitTimer); submitTimer = null;
    submitted = null;
    locked = false;
  }
  function reconcileSubmission(next) {
    if (!submitted) return;
    const d = next.pending;
    // 同 id 的完整快照也不是确认；同时暗选只认本席 done。
    if (!d || d.id !== submitted.id || (d.simul && (d.done || []).includes(you))) clearSubmission();
  }
  function setDeadline(msg, id = deadlineId) {
    if (id !== deadlineId) { deadlineAt = 0; timerEnds = 0; timerDuration = 0; deadlineId = id; }
    if (Object.prototype.hasOwnProperty.call(msg, 'deadlineIn')) {
      deadlineAt = Number.isFinite(msg.deadlineIn) && msg.deadlineIn > 0 ? Date.now() + msg.deadlineIn : 0;
    }
  }
  function clearNavigation() {
    clearTimeout(navigationTimer); navigationTimer = null;
    navigationPending = null;
    for (const el of $$('[data-navigation]')) el.disabled = connection !== 'ready';
  }
  function navigate(type, button) {
    if (navigationPending || !send({ type })) return false;
    navigationPending = type;
    if (button) { button.dataset.navigation = type; button.disabled = true; }
    for (const el of $$('[data-navigation]')) el.disabled = true;
    const epoch = animationEpoch;
    navigationTimer = setTimeout(() => {
      if (epoch !== animationEpoch || !navigationPending) return;
      toast('房间操作尚未确认，正在重新同步', true);
      if (ws) ws.close();
    }, 8000);
    return true;
  }

  function handle(msg) {
    if (!greeted && msg.type !== 'hello' && msg.type !== 'error') return;
    switch (msg.type) {
      case 'hello': {
        const firstHello = !greeted;
        greeted = true;
        clearTimeout(handshakeTimer);
        reconnectDelay = 800;
        me = { token: msg.token, id: msg.id, name: msg.name };
        store.set('hn_me', me);
        if (!$('#nameInput').value) $('#nameInput').value = me.name;
        if (firstHello && !msg.room) {
          const want = inviteRoom || new URLSearchParams(location.search).get('room');
          returnHome({ keepInvite: !!want });
          if (want) { inviteRoom = want; send({ type: 'join', code: want }); }
        } else if (!msg.room) setConnection('ready');
        break;
      }
      case 'roomList':
        roomRows = normalizeRoomRows(msg.rooms);
        roomsLoading = false; roomsFresh = true; roomsReceived = true;
        renderRoomDirectory();
        break;
      case 'room':
        if (room && (room.code !== msg.room.code || (room.mode || 'play') !== (msg.room.mode || 'play'))) { resetGameView(); gameId = null; gameMode = null; }
        room = msg.room;
        inviteRoom = null;
        if (room.status === 'lobby') {
          if (vs) resetGameView();
          setConnection('ready'); showScreen('lobby'); renderLobby();
        } else if (!$('#game').hidden) {
          renderPlayers(); renderTopButtons();
          syncFinalActions();
          if (isSpectator() && !playing && !queue.length) renderPrompt();
          if (snap?.phase === 'over' && !playing && !queue.length) renderPrompt();
        }
        setRoomUrl(room.code);
        break;
      case 'game': {
        const resyncing = connection !== 'ready';
        const nextGameId = msg.gameId ?? null;
        if (nextGameId && retiredGames.has(nextGameId)) break;
        const changedGame = nextGameId !== gameId;
        if (changedGame) {
          if (gameId && isSpectator()) {
            retiredGames.add(gameId);
            if (retiredGames.size > 32) retiredGames.delete(retiredGames.values().next().value);
          }
          resetGameView(); gameId = nextGameId;
        }
        gameMode = msg.mode || room?.mode || 'play';
        you = isSpectator() ? -1 : msg.you;
        autoFlags = msg.auto || [];
        autoModes = msg.autoModes || [];
        if (msg.speed) speed = msg.speed;
        setDeadline(isSpectator() ? { ...msg, deadlineIn: null } : msg, msg.snap.pending?.id ?? null);
        reconcileSubmission(msg.snap);
        setConnection('ready');
        showScreen('game');
        renderTopButtons();
        const events = msg.events || [];
        if (msg.full || !vs) {
          const sameGame = !changedGame && lastFullContext && lastFullContext.gameId === gameId && msg.snap.seq >= lastFullContext.seq;
          resetGameView({ preserveSubmission: !!sameGame && !resyncing, preserveDeadline: true });
          lastFullContext = { gameId, seq: msg.snap.seq };
          snap = msg.snap;
          vs = clone(snap);
          for (const l of snap.log || []) addFeed(l.text);
          if (snap.phase === 'over' && snap.champions) lastGameOver = { scores: snap.players.map((p) => ({ seat: p.seat, score: p.score })), champions: snap.champions };
          renderAll();
          renderPrompt();
          if (snap.phase === 'over' && lastGameOver) showFinalOverlay(lastGameOver);
        } else {
          queue.push({ events, snap: msg.snap });
          pump();
        }
        break;
      }
      case 'lobby':
        resetGameView();
        gameId = null; gameMode = null; you = -1;
        setConnection('ready');
        showScreen('lobby');
        renderLobby();
        break;
      case 'left':
        returnHome();
        break;
      case 'error':
        if (msg.for === 'act' && msg.gameId != null && msg.gameId !== gameId) break;
        setDeadline(msg);
        toast(msg.msg, true);
        if (msg.for === 'hello') {
          me = { name: typeof me.name === 'string' ? me.name : '' };
          store.set('hn_me', me);
          if (ws) ws.close();
          break;
        }
        if (msg.for === 'join') returnHome();
        if (!msg.for || msg.for === 'act') { clearSubmission(); hideOverlay(true); unlockPrompt(); }
        if (!msg.for || msg.for === navigationPending) { clearNavigation(); renderPrompt(); }
        if (msg.retryIn > 0 && msg.for === 'lobby') toast('最终动画还没结束，请稍后再试');
        break;
      case 'emote': showEmote(msg.seat, msg.key); break;
      case 'auto':
        if (msg.gameId != null && msg.gameId !== gameId) break;
        autoFlags = msg.auto; autoModes = msg.autoModes || [];
        if (msg.decisionId == null || msg.decisionId === deadlineId) setDeadline(msg);
        renderPlayers(); renderTopButtons(); addTimer(); break;
      case 'speed': speed = msg.speed; setDeadline(msg); renderTopButtons(); addTimer(); break;
      default: break;
    }
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function setRoomUrl(code) {
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    history.replaceState(null, '', u.toString());
  }

  /* ================= 屏幕 ================= */
  function returnHome({ keepInvite = false } = {}) {
    resetGameView();
    room = null; gameId = null; gameMode = null; you = -1; autoFlags = []; autoModes = [];
    if (!keepInvite) { inviteRoom = null; setRoomUrl(null); }
    setConnection('ready');
    showScreen('home');
    requestRooms();
  }
  function showScreen(id) {
    for (const s of ['home', 'lobby', 'game']) $(`#${s}`).hidden = s !== id;
    document.body.dataset.screen = id;
    if (id === 'home') requestAnimationFrame(fitRooms);
    renderSpectatorStatus();
    if (id === 'game') requestAnimationFrame(() => { checkLayout(); refitPagers(); });
  }

  /* ---------- 首页公开房间（只读订阅，不驱动屏幕或对局） ---------- */
  const validRoomCode = (code) => typeof code === 'string' && /^[A-Z0-9]{4}$/.test(code);
  function normalizeRoomRows(rows) {
    if (!Array.isArray(rows)) return [];
    const seen = new Set();
    const count = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : 0;
    return rows.filter((r) => {
      if (!r || !validRoomCode(r.code) || !['play', 'spectator'].includes(r.mode) || !['lobby', 'playing', 'over'].includes(r.status) || seen.has(r.code)) return false;
      seen.add(r.code); return true;
    }).map((r) => ({
      code: r.code, mode: r.mode, status: r.status,
      hostName: typeof r.hostName === 'string' ? r.hostName : '未命名房主',
      playerCount: count(r.playerCount, 6), aiCount: count(r.aiCount, 6), humanCount: count(r.humanCount, 6),
      onlineCount: count(r.onlineCount, 6), maxPlayers: 6,
      spectatorCount: count(r.spectatorCount), onlineSpectatorCount: count(r.onlineSpectatorCount),
      canJoin: r.canJoin === true, isMember: r.isMember === true,
    }));
  }
  function requestRooms() {
    if (!send({ type: 'listRooms' }, true)) { renderRoomDirectory(); return false; }
    roomsLoading = true; roomsFresh = false;
    renderRoomDirectory();
    return true;
  }
  function renderRoomDirectory() {
    const list = $('#roomList'), status = $('#roomListStatus');
    if (!list || !status) return;
    const online = connection === 'ready' && greeted;
    const usable = online && roomsFresh;
    list.setAttribute('aria-busy', String(online && roomsLoading));
    status.textContent = !online
      ? (connection === 'offline' ? '已离线' : '正在连接服务器…') + (roomsReceived ? ' · 以下为上次列表，重连后更新' : ' · 连接后显示公开房间')
      : roomsLoading ? '正在加载公开房间…'
      : !roomsFresh ? '房间列表尚未更新，请点击刷新'
      : roomRows.length ? `当前 ${roomRows.length} 个公开房间 · 实时更新` : '暂无在线房间，创建一个邀请大家吧';
    list.innerHTML = roomRows.map((r) => {
      const watch = r.mode === 'spectator';
      const state = r.status === 'lobby' ? '等待开赛' : r.status === 'playing' ? '进行中' : '已结束';
      const label = r.isMember ? '返回房间' : watch ? '观看' : '加入';
      const note = !usable ? (online ? '更新后可进入' : '离线，暂不可进入')
        : !r.canJoin ? (r.status === 'playing' ? '比赛中，暂不可加入' : r.status === 'over' ? '已结束，暂不可加入' : '真人已满，暂不可加入')
        : r.isMember ? '你已在此房间' : watch ? '随时加入观战' : r.playerCount === 6 && r.aiCount > 0 ? '加入可替换 AI' : '欢迎加入';
      const people = `选手 ${r.playerCount}/${r.maxPlayers} · 真人 ${r.humanCount} / AI ${r.aiCount}`;
      const presence = watch ? `观众 ${r.spectatorCount} 人${usable ? ` · ${r.onlineSpectatorCount} 人在线` : ''}` : usable ? `${r.onlineCount} 位真人在线` : '上次房间记录';
      return `<li class="room-list-item${watch ? ' watch-room' : ''}">
        <span class="room-list-icon ico" aria-hidden="true">${icon(watch ? 'eye' : 'users')}</span>
        <div class="room-list-info">
          <div class="room-list-title"><span class="room-list-host" title="${esc(r.hostName)}">${esc(r.hostName)}</span><span class="room-list-code">${esc(r.code)}</span></div>
          <p class="room-list-state"><span class="room-state ${esc(r.status)}">${watch ? 'AI 观战 · ' : ''}${esc(state)}</span></p>
          <p class="room-list-meta">${esc(people)}</p><p class="room-list-meta">${esc(presence)}</p>
        </div>
        <div class="room-list-action"><button class="btn small${watch ? '' : ' primary'}" data-room-code="${esc(r.code)}" aria-label="${esc(`${label}：${r.hostName}，房间 ${r.code}`)}"${!usable || !r.canJoin ? ' disabled' : ''}>${esc(label)}</button><span class="room-list-note">${esc(note)}</span></div>
      </li>`;
    }).join('');
    fitRooms();
  }
  // 首页一屏：公开房间至少要放下一间，放不下就逐级收起装饰（徽章、游行队伍、标语、缩小标志）
  function fitRooms() {
    const home = $('#home'), inner = $('.home-inner', home), list = $('#roomList');
    if (home.hidden) return;
    for (let level = 0; level <= 3; level++) {
      home.dataset.tight = level;
      paginate('rooms', list, () => $$('#roomList .room-list-item'), $('#roomPager'));
      if (list.scrollHeight <= list.clientHeight + 1 && inner.scrollHeight <= inner.clientHeight + 1) break;
    }
  }

  /* ---------- 首页 ---------- */
  function initHome() {
    const ids = RACERS.map((r) => r.id);
    const items = ids.concat(ids).map((id, k) => `<div class="pr" style="--k:${k}">${art(id)}</div>`).join('');
    $('#parade').innerHTML = `<div class="parade-track">${items}</div>`;
    $('#nameInput').value = me.name || '';
    $('#nameInput').addEventListener('change', () => {
      const name = $('#nameInput').value.trim();
      if (name) { me.name = name; store.set('hn_me', me); send({ type: 'setName', name }); }
    });
    let aiN = store.get('hn_ai', 3);
    const seg = $('#aiCount');
    const syncSeg = () => $$('button', seg).forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === aiN));
    syncSeg();
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      aiN = Number(b.dataset.v); store.set('hn_ai', aiN); syncSeg(); Sound.click();
    });
    const ensureName = () => {
      const name = $('#nameInput').value.trim();
      if (name && name !== me.name) { me.name = name; store.set('hn_me', me); send({ type: 'setName', name }); }
    };
    let watchN = store.get('hn_watch_ai', 4);
    if (!Number.isInteger(watchN) || watchN < 3 || watchN > 6) watchN = 4;
    const watchSeg = $('#watchCount');
    const syncWatchSeg = () => $$('button', watchSeg).forEach((b) => {
      const selected = Number(b.dataset.v) === watchN;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-checked', String(selected));
      b.tabIndex = selected ? 0 : -1;
    });
    const selectWatch = (b) => {
      watchN = Number(b.dataset.v); store.set('hn_watch_ai', watchN); syncWatchSeg(); Sound.click();
    };
    syncWatchSeg();
    watchSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (b) selectWatch(b);
    });
    watchSeg.addEventListener('keydown', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const buttons = $$('button', watchSeg), i = buttons.indexOf(b);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
      selectWatch(buttons[next]); buttons[next].focus();
    });
    $('#watchBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'watch', ai: watchN }); };
    $('#quickBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'quick', ai: aiN }); };
    $('#createBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'create' }); };
    const join = () => {
      const code = $('#codeInput').value.trim().toUpperCase();
      if (code.length !== 4) return toast('房间码是 4 位', true);
      Sound.click(); ensureName(); send({ type: 'join', code });
    };
    $('#joinBtn').onclick = join;
    $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#refreshRooms').onclick = () => { Sound.click(); requestRooms(); };
    $('#roomList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-room-code]');
      if (!b || b.disabled || $('#home').hidden || connection !== 'ready' || !roomsFresh) return;
      const code = b.dataset.roomCode;
      if (!validRoomCode(code) || !roomRows.some(r => r.code === code && r.canJoin)) return;
      Sound.click(); ensureName(); send({ type: 'join', code });
    });
    renderRoomDirectory();
  }

  /* ---------- 房间 ---------- */
  function renderLobby() {
    if (!room) return;
    $('#roomCode').textContent = room.code;
    $('#inviteLinkInput').value = `${location.origin}${location.pathname}?room=${room.code}`;
    const host = room.host === me.id;
    const cards = room.seats.map((s, i) => {
      const c = PCOL[i % 6];
      const inner = s.ai ? `<span class="ico" data-icon="robot"></span>` : esc((s.name || '?').slice(0, 1));
      const kick = host && s.ai ? `<button class="kick" data-kick="${i}" title="移除">${icon('close')}</button>` : '';
      const tag = s.ai ? 'AI 选手' : `<span class="dot ${s.online ? '' : 'off'}"></span>${s.pid === room.host ? '房主' : '玩家'}${s.pid === me.id ? ' · 你' : ''}`;
      return `<div class="seat" style="--c:${c}">${kick}<div class="ava">${inner}</div><div class="nm">${esc(s.name)}</div><div class="tag">${tag}</div></div>`;
    });
    for (let i = room.seats.length; i < 6; i++) cards.push(`<div class="seat empty">${i < 3 ? '至少 3 人' : '空位'}</div>`);
    $('#seats').innerHTML = cards.join('');
    fillIcons($('#seats'));
    $('#addAI').hidden = !host;
    $('#addAI').disabled = room.seats.length >= 6 || connection !== 'ready';
    $('#startBtn').hidden = !host;
    $('#startBtn').disabled = room.seats.length < 3 || connection !== 'ready';
    $('#lobbyTip').textContent = host
      ? (room.seats.length < 3 ? '把房间码发给朋友，人不够可以加 AI。3-6 人开赛。' : '人齐了就开始吧！')
      : '等待房主开始比赛…';
  }
  function initLobby() {
    $('#seats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kick]'); if (!b) return;
      Sound.click(); send({ type: 'removeAI', seat: Number(b.dataset.kick) });
    });
    $('#addAI').onclick = () => { Sound.click(); send({ type: 'addAI' }); };
    $('#startBtn').onclick = () => { Sound.click(); send({ type: 'start' }); };
    $('#leaveLobby').onclick = () => { Sound.click(); navigate('leave', $('#leaveLobby')); };
    $('#copyLink').onclick = async () => {
      const link = `${location.origin}${location.pathname}?room=${room.code}`;
      try {
        await navigator.clipboard.writeText(link);
        toast('邀请链接已复制');
      } catch (e) {
        $('#inviteLinkBox').hidden = false;
        const input = $('#inviteLinkInput');
        input.value = link;
        input.focus();
        input.select();
        toast('邀请链接已选中，可以手动复制');
      }
    };
    $('#inviteLinkInput').onclick = (e) => e.target.select();
  }

  /* ================= 棋盘几何 ================= */
  // 横屏：上排起点 + 1..12，右侧 13、14，下排 15..29 从右往左，终点在左下；内场加高放骰子和行动卡
  function wideRect(p) {
    if (p <= 0) return { x: 64, y: 22, w: 172, h: 88 };
    if (p <= 12) return { x: 240 + (p - 1) * 60, y: 22, w: 56, h: 88 };
    if (p === 13) return { x: 900, y: 116, w: 56, h: 116 };
    if (p === 14) return { x: 900, y: 238, w: 56, h: 116 };
    if (p <= 29) return { x: 900 - (p - 15) * 60, y: 360, w: 56, h: 88 };
    return { x: 6, y: 360, w: 50, h: 88 };
  }
  // 竖屏：7 列 × 10 行的方格回环，起点在左上，顺时针一圈，终点线在起点正下方
  function tallRect(p) {
    const S = 64, pad = 8;
    let c, r;
    if (p <= 0) { c = 0; r = 0; } else if (p <= 6) { c = p; r = 0; } else if (p <= 15) { c = 6; r = p - 6; } else if (p <= 21) { c = 6 - (p - 15); r = 9; } else if (p <= 29) { c = 0; r = 9 - (p - 21); } else return { x: 76, y: 72, w: 26, h: 60 };
    return { x: pad + c * S, y: pad + r * S, w: 60, h: 60 };
  }
  const GEO = {
    wide: {
      vb: [964, 470], rect: wideRect, bed: { x: 0, y: 8, w: 964, h: 454, rx: 50 },
      inf: { x: 62, y: 116, w: 832, h: 238 }, pod: { x: 70, y: 150, w: 150, h: 150 },
      center: { x: 236, y: 124, w: 652, h: 222 },
      arrows: [[330, 15, 0], [570, 15, 0], [810, 15, 0], [810, 455, 180], [570, 455, 180], [330, 455, 180]],
    },
    tall: {
      vb: [460, 652], rect: tallRect, bed: { x: 0, y: 0, w: 460, h: 652, rx: 34 },
      inf: { x: 72, y: 72, w: 316, h: 508 }, pod: { x: 150, y: 78, w: 150, h: 120 },
      center: { x: 80, y: 196, w: 300, h: 378 },
      arrows: [],
    },
  };
  const geo = () => GEO[layout];
  const cellRect = (p) => geo().rect(p);
  const VB = () => geo().vb;

  function checkLayout() {
    const wrap = $('.board-wrap');
    if (!wrap || $('#game').hidden) return;
    // 按屏幕方向决定，避免操作栏高度变化导致赛道来回切换
    const want = innerHeight > innerWidth * 1.05 && innerWidth < 900 ? 'tall' : 'wide';
    if (want !== layout) {
      layout = want;
      builtTrack = null;
      if (vs && vs.phase !== 'draft') {
        buildBoard(vs.track); layoutTokens(true); renderTurnCard();
        if (!playing && !queue.length) renderPrompt();
      }
    }
  }

  const TRACK_COLS = ['#F27AB8', '#FFC53D', '#33B679', '#4D9DF7'];
  function starPts(cx, cy, r1, r2) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? r2 : r1;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  }
  // 特殊格图标（也用于图例）
  function spaceGlyph(type, n, cx, cy, k = 1) {
    if (type === 'star') return `<polygon points="${starPts(cx, cy, 20 * k, 8.5 * k)}" fill="#FFE27A" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><text x="${cx}" y="${cy + 4.5 * k}" font-size="${12 * k}" font-weight="900" text-anchor="middle" fill="${INK}">1</text>`;
    if (type === 'rock') return `<g transform="translate(${cx} ${cy}) scale(${k})"><path d="M-19 11 Q-21 -6 -8 -12 Q4 -19 13 -8 Q23 0 17 11 Z" fill="#A9A2B6" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M-7 -2 q6 -4 12 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M-12 5 l4 -1 M6 6 l5 0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/></g>`;
    if (type === 'arrow') {
      const fwd = n > 0;
      return `<g transform="translate(${cx} ${cy}) scale(${k})"><circle r="20" fill="${fwd ? '#33B679' : '#F2553C'}" stroke="${INK}" stroke-width="2.5"/><text y="7" font-size="19" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">${fwd ? '+' : '−'}${Math.abs(n)}</text></g>`;
    }
    return '';
  }

  // 赛道 SVG：对局棋盘和地图图鉴共用同一套画法（wide = 电脑/横屏，tall = 手机竖屏）
  function trackSvgMarkup(trackKey, lay) {
    const wild = trackKey === 'wild';
    const G = GEO[lay];
    const { bed, inf } = G;
    let s = `<defs><pattern id="chk" width="12.5" height="12.5" patternUnits="userSpaceOnUse"><rect width="12.5" height="12.5" fill="#fff"/><rect width="6.25" height="6.25" fill="${INK}"/><rect x="6.25" y="6.25" width="6.25" height="6.25" fill="${INK}"/></pattern></defs>`;
    s += `<rect x="${bed.x}" y="${bed.y}" width="${bed.w}" height="${bed.h}" rx="${bed.rx}" fill="${INK}"/>`;
    s += `<rect x="${inf.x}" y="${inf.y}" width="${inf.w}" height="${inf.h}" rx="24" fill="${wild ? '#F7DDAE' : '#CFEFC4'}" stroke="#fff" stroke-width="3"/>`;
    // 行进方向箭头（跑道外圈的小白箭头）
    for (const [x, y, rot] of G.arrows) s += `<path d="M-5 -5 L3 0 L-5 5" transform="translate(${x} ${y}) rotate(${rot})" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>`;
    // 内场点缀
    let seed = wild ? 7 : 3;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 30; i++) {
      const x = inf.x + 18 + rnd() * (inf.w - 36), y = inf.y + 14 + rnd() * (inf.h - 28);
      if (wild) s += `<path d="M${x} ${y} l4 -9 l4 9 z" fill="#E4B774" opacity=".7"/>`;
      else {
        const c = ['#F27AB8', '#FFC53D', '#fff', '#8B6CF0'][i % 4];
        s += `<g opacity=".7"><circle cx="${x}" cy="${y}" r="4.5" fill="${c}"/><circle cx="${x}" cy="${y}" r="1.8" fill="#FFC53D"/></g>`;
      }
    }
    for (let p = 0; p < FIN; p++) {
      const r = G.rect(p);
      let fill = TRACK_COLS[(p - 1 + 4) % 4];
      if (p > 0 && p % 5 === 0) fill = '#F2553C';
      if (p === 0) fill = '#4D9DF7';
      s += `<g class="cell" data-p="${p}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="9" fill="${fill}" stroke="${INK}" stroke-width="2.5"/>`;
      s += `<rect x="${r.x + 4}" y="${r.y + 4}" width="${r.w - 8}" height="${Math.min(18, r.h * 0.28)}" rx="6" fill="#fff" opacity=".22"/>`;
      if (p === 0) {
        s += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + (lay === 'wide' ? 12 : 7)}" font-size="${lay === 'wide' ? 34 : 19}" font-weight="900" text-anchor="middle" fill="#F2553C" stroke="${INK}" stroke-width="5" paint-order="stroke" font-style="italic" letter-spacing="2">起点</text>`;
      } else if (p % 5 === 0) {
        s += `<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2 + 9}" font-size="25" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="4" paint-order="stroke">${p}</text>`;
      } else {
        // 每格角标编号，方便数位置
        s += `<text x="${r.x + 6}" y="${r.y + r.h - 7}" font-size="12" font-weight="800" fill="${INK}" opacity=".5">${p}</text>`;
      }
      const sp = TRACKS[trackKey].spaces[p];
      if (sp) s += spaceGlyph(sp.type, sp.n, r.x + r.w / 2, r.y + r.h / 2 - 2);
      s += '</g>';
    }
    // 终点：棋盘格 + 竖排「终点」
    const f = G.rect(FIN);
    s += `<g class="cell" data-p="${FIN}"><rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="url(#chk)" stroke="${INK}" stroke-width="2.5"/>`;
    if (lay === 'wide') s += `<rect x="${f.x + 9}" y="${f.y + 16}" width="${f.w - 18}" height="${f.h - 32}" rx="7" fill="${INK}"/><text x="${f.x + f.w / 2}" y="${f.y + f.h / 2 - 3}" font-size="15" font-weight="900" text-anchor="middle" fill="#fff">终</text><text x="${f.x + f.w / 2}" y="${f.y + f.h / 2 + 15}" font-size="15" font-weight="900" text-anchor="middle" fill="#fff">点</text>`;
    s += '</g>';
    // 领奖台：冲线的运动员会站上来
    const pd = G.pod;
    const pcx = pd.x + pd.w / 2, pcy = pd.y + pd.h / 2 + 10;
    s += `<g transform="translate(${pcx} ${pcy})"><ellipse cx="0" cy="40" rx="66" ry="7" fill="${INK}" opacity=".12"/><rect x="-58" y="6" width="38" height="30" rx="4" fill="#A7B0BE" stroke="${INK}" stroke-width="2.5"/><rect x="-19" y="-10" width="38" height="46" rx="4" fill="#E9A91B" stroke="${INK}" stroke-width="2.5"/><rect x="20" y="16" width="38" height="20" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/><text x="0" y="18" font-size="20" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3.5" paint-order="stroke">1</text><text x="-39" y="29" font-size="17" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3.5" paint-order="stroke">2</text><text x="0" y="62" font-size="13" font-weight="900" text-anchor="middle" fill="${INK}" opacity=".55">领奖台</text></g>`;
    return s;
  }

  function buildBoard(trackKey) {
    if (!trackKey) return;
    const board = $('#board');
    board.classList.toggle('tall', layout === 'tall');
    if (builtTrack === `${trackKey}:${layout}`) return;
    builtTrack = `${trackKey}:${layout}`;
    const [W, H] = VB();
    const svg = $('#trackSvg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const wild = trackKey === 'wild';
    const G = geo();
    const pd = G.pod;
    const pcx = pd.x + pd.w / 2, pcy = pd.y + pd.h / 2 + 10;
    podium = { 1: [pcx, pcy - 34], 2: [pcx - 39, pcy - 16] };
    svg.innerHTML = trackSvgMarkup(trackKey, layout);
    // 中央区域
    const c = G.center;
    Object.assign($('#center').style, { left: `${c.x / W * 100}%`, top: `${c.y / H * 100}%`, width: `${c.w / W * 100}%`, height: `${c.h / H * 100}%` });
    const t = TRACKS[trackKey];
    const legend = wild
      ? `<div class="legend">${[['arrow', 2, '箭头：前进/后退'], ['rock', 0, '石头：摔倒'], ['star', 0, '星星：+1 分']].map(([ty, n, tx]) => `<span><svg viewBox="-24 -24 48 48">${spaceGlyph(ty, n, 0, 0, 1)}</svg>${tx}</span>`).join('')}</div>`
      : '<small>一条平平无奇的跑道 · 全靠技能搞事</small>';
    $('#centerTrack').innerHTML = `<b>${t.name}</b>${legend}`;
    $('#centerTrack').style.setProperty('--c', wild ? '#F2553C' : '#33B679');
  }

  /* ================= 棋子 ================= */
  const SLOTS = {
    1: [[0, 0]], 2: [[-11, -10], [11, 10]], 3: [[-13, -12], [13, -12], [0, 13]],
    4: [[-13, -13], [13, -13], [-13, 13], [13, 13]],
    5: [[-15, -16], [15, -16], [0, 0], [-15, 16], [15, 16]],
    6: [[-15, -20], [15, -20], [-15, 0], [15, 0], [-15, 20], [15, 20]],
  };
  function tokenEl(r) {
    let el = $(`#tokens .token[data-rid="${r.rid}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'token';
      el.dataset.rid = r.rid;
      el.dataset.tip = r.rid;
      el.style.setProperty('--c', PCOL[r.seat % 6]);
      // 棋盘上地方小，AI 名字省掉「（AI）」后缀，侧栏里另有 AI 标记
      const p = vs.players[r.seat];
      const nm = p ? (p.ai ? p.name.replace(/（AI）$/, '') : p.name) : '';
      el.innerHTML = `<div class="hop"><div class="body">${art(r.rid)}</div></div><div class="seat-dot">${esc(nm)}</div>`;
      el.addEventListener('click', () => onTokenClick(r.rid));
      $('#tokens').appendChild(el);
    }
    return el;
  }
  function layoutTokens(instant) {
    if (!vs || !vs.racers) return;
    const [W, H] = VB();
    const live = new Set(vs.racers.map((r) => r.rid));
    for (const el of $$('#tokens .token')) if (!live.has(el.dataset.rid)) el.remove();
    const groups = {}, placed = [];
    for (const r of vs.racers) {
      const p = r.finished ? FIN : r.pos;
      (groups[p] = groups[p] || []).push(r);
    }
    for (const [pk, list] of Object.entries(groups)) {
      const p = Number(pk);
      if (p === FIN) {
        // 冲线的运动员站上领奖台
        list.forEach((r, k) => {
          const [px, y] = podium[r.finished] || podium[2];
          const x = px + (r.finished > 2 ? k * 10 : 0);
          const el = tokenEl(r);
          if (instant) el.style.transition = 'none';
          el.style.left = `${x / W * 100}%`;
          el.style.top = `${y / H * 100}%`;
          el.classList.remove('tripped', 'cur');
          el.classList.add('done');
          let pl = $('.place', el);
          if (!pl) { pl = document.createElement('div'); el.appendChild(pl); }
          pl.className = `place p${r.finished}`; pl.textContent = r.finished;
          // 冠军站在亚军前面，名字不被挡
          const z = r.finished === 1 ? 5 : 4;
          el.style.zIndex = z;
          placed.push({ el, x, y, z });
          if (instant) { void el.offsetWidth; el.style.transition = ''; }
        });
        continue;
      }
      const rc = cellRect(p);
      const cx = rc.x + rc.w / 2, cy = rc.y + rc.h / 2;
      list.sort((a, b) => (a.finished || 9) - (b.finished || 9) || a.seat - b.seat);
      const n = list.length;
      list.forEach((r, k) => {
        let dx, dy;
        if (p === 0 && layout === 'wide') {
          // 起点格够宽：3 人以内排成一行，名字全露出来；人多就分前后两排
          const rows = n > 3 ? 2 : 1, per = Math.ceil(n / rows);
          const row = Math.floor(k / per), cnt = row ? n - per : per;
          dx = (k % per - (cnt - 1) / 2) * 57;
          dy = rows > 1 ? (row ? 15 : -15) : 0;
        } else {
          const sl = (SLOTS[Math.min(n, 6)] || SLOTS[6])[k % 6];
          [dx, dy] = layout === 'wide' ? sl : [sl[1], sl[0]];
        }
        const el = tokenEl(r);
        if (instant) el.style.transition = 'none';
        el.style.left = `${(cx + dx) / W * 100}%`;
        el.style.top = `${(cy + dy) / H * 100}%`;
        el.classList.toggle('tripped', !!r.tripped);
        el.classList.toggle('out', !!r.out);
        el.classList.toggle('done', !!r.finished);
        el.classList.toggle('cur', vs.curSeat === r.seat && vs.phase === 'race' && !r.finished && !r.out);
        let pl = $('.place', el);
        if (r.finished && !pl) { pl = document.createElement('div'); el.appendChild(pl); }
        if (pl) { if (r.finished) { pl.className = `place p${r.finished}`; pl.textContent = r.finished; } else pl.remove(); }
        const z = el.classList.contains('cur') ? 6 : 2 + k;
        el.style.zIndex = z;
        if (!r.out) placed.push({ el, x: cx + dx, y: cy + dy, z });
        if (instant) { void el.offsetWidth; el.style.transition = ''; }
      });
    }
    fitTags(placed);
    renderStandings();
  }
  // 名字签防重叠：从最上层的棋子往下排，名字签会压到更上层的棋子或已显示的名字签就先收起（悬停棋子仍能看是谁）
  function fitTags(placed) {
    const s = layout === 'tall' ? 50 : 58;
    const shown = [], bodies = [];
    placed.sort((a, b) => b.z - a.z || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
    const measured = placed.map((t) => {
      const tag = $('.seat-dot', t.el), u = t.el.offsetWidth / s;
      return { ...t, hw: tag && u ? tag.offsetWidth / u / 2 : null };
    });
    const changes = [];
    for (const t of measured) {
      if (t.hw == null) continue;
      // 名字签贴在棋子底下：bottom -16%、高 16
      const bottom = t.y + s * 0.66;
      const box = { l: t.x - t.hw, r: t.x + t.hw, t: bottom - 16, b: bottom };
      const hit = shown.some((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b)
        || bodies.some((c) => Math.hypot(c.x - Math.max(box.l, Math.min(c.x, box.r)), c.y - Math.max(box.t, Math.min(c.y, box.b))) < c.r);
      changes.push({ el: t.el, hit });
      if (!hit) shown.push(box);
      bodies.push({ x: t.x, y: t.y, r: s / 2 });
    }
    for (const { el, hit } of changes) el.classList.toggle('notag', hit);
  }
  const vr = (rid) => vs && vs.racers.find((r) => r.rid === rid);
  const rname = (rid) => { const r = vr(rid); return r ? `${vs.players[r.seat].name}的${R[rid].name}` : R[rid] ? R[rid].name : rid; };

  function floater(rid, text, cls = '', color) {
    const el = rid && $(`#tokens .token[data-rid="${rid}"]`);
    const f = document.createElement('div');
    f.className = `floater ${cls}`;
    f.textContent = text;
    if (color) f.style.setProperty('--fc', color);
    if (el) { f.style.left = el.style.left; f.style.top = el.style.top; } else { f.style.left = '50%'; f.style.top = '50%'; }
    $('#floaters').appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
  function pulseCell(p) {
    const c = $(`#trackSvg .cell[data-p="${p}"]`);
    if (!c) return;
    c.classList.remove('pulse'); void c.getBoundingClientRect(); c.classList.add('pulse');
  }

  /* ================= 渲染 ================= */
  function renderAll() {
    if (!vs) return;
    renderSpectatorStatus();
    if (!isParticipant()) $('#myTeam').innerHTML = '';
    renderPills();
    renderTitle();
    renderPlayers();
    if (vs.phase === 'draft') {
      $('#draft').hidden = false;
      $('.board-wrap').style.visibility = 'hidden';
      renderDraft();
    } else {
      $('#draft').hidden = true;
      $('.board-wrap').style.visibility = '';
      checkLayout();
      buildBoard(vs.track);
      if (vs.phase === 'pick') $('#tokens').innerHTML = '';
      layoutTokens(true);
      renderTurnCard();
    }
    if (vs.phase !== 'race' && vs.phase !== 'between') renderStandings();
  }
  function syncMeta() { renderPlayers(); renderTitle(); }

  function renderPills() {
    $('#races').innerHTML = SCHEDULE.map((t, i) => {
      const n = i + 1;
      const cls = [t === 'wild' ? 'wild' : '', vs.raceNo === n && vs.phase !== 'draft' ? 'cur' : '', vs.raceNo > n || (vs.raceNo === n && (vs.phase === 'between' || vs.phase === 'over')) ? 'done' : ''].join(' ');
      return `<div class="race-pill ${cls}" title="${TRACKS[t].name}"><span class="no">${n}</span><span class="tn">${t === 'wild' ? '狂野' : '温和'}</span><span class="pts">金${GOLD[i]}·银${SILVER[i]}</span></div>`;
    }).join('');
  }
  function renderTitle() {
    let t = '';
    if (!vs) return;
    if (vs.phase === 'draft') t = isParticipant() ? '选秀：组建你的 4 人队伍' : 'AI 选秀：自动组建队伍';
    else if (vs.phase === 'pick') t = `第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name} · ${isParticipant() ? '派谁上场？' : 'AI 正在暗选出战'}`;
    else if (vs.phase === 'race') {
      const p = vs.curSeat != null ? vs.players[vs.curSeat] : null;
      t = `第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}${p ? ` · 轮到 ${p.name}` : ''}`;
    } else if (vs.phase === 'between') t = `第 ${vs.raceNo} 场结束`;
    else if (vs.phase === 'over') t = '比赛结束';
    $('#topTitle').textContent = t;
  }
  function renderSpectatorStatus() {
    const show = isSpectator() && !$('#game').hidden;
    $('#game').dataset.mode = isSpectator() ? 'spectator' : 'play';
    $('#spectatorStatus').hidden = !show;
    if (!show) return;
    const count = room?.seats?.length || vs?.players?.length || 0;
    $('#spectatorLabel').textContent = `正在观战 · ${count}名AI`;
    const viewers = (room?.spectators || []).filter((p) => p.online).length;
    $('#spectatorViewers').textContent = `${viewers}人观看`;
    $('#spectatorCode').textContent = room?.code ? `房间 ${room.code}` : '';
    $('#spectatorCode').hidden = !room?.code;
  }
  function renderTopButtons() {
    renderSpectatorStatus();
    $('#speedLabel').textContent = `${speed}x`;
    const host = room && room.host === me.id;
    $('#speedBtn').disabled = !host || connection !== 'ready';
    $('#speedBtn').setAttribute('aria-label', `动画速度 ${speed} 倍${host ? '，点击切换' : '，由房主设置'}`);
    $('#speedBtn').title = host ? '动画速度（房主设置）' : '动画速度由房主设置';
    $('#autoBtn').classList.toggle('on', !!autoFlags[you]);
    $('#autoBtn').disabled = connection !== 'ready';
    $('#autoBtn').setAttribute('aria-pressed', String(!!autoFlags[you]));
    $('#autoBtn').title = autoFlags[you] ? '点击关闭托管并接管' : '点击开启托管';
    $('#autoBtn').hidden = !isParticipant();
    $('#emotes').hidden = !isParticipant();
    $('#soundBtn').innerHTML = `<span class="ico">${icon(Sound.muted ? 'mute' : 'sound')}</span>`;
  }

  function renderPlayers() {
    if (!vs) return;
    const d = snap && snap.pending;
    const racing = vs.phase === 'race' || vs.phase === 'between';
    $('#players').innerHTML = vs.players.map((p) => {
      const c = PCOL[p.seat % 6];
      const cur = vs.racers.find((r) => r.seat === p.seat);
      const ava = cur && racing ? art(cur.rid) : `<span class="init">${esc(p.name.slice(0, 1))}</span>`;
      const hand = p.hand.map((id) => `<i class="${p.used.includes(id) && !(cur && cur.rid === id && racing) ? 'used' : ''} ${cur && cur.rid === id && racing ? 'now' : ''}" style="--rc:${rcol(id)}" data-tip="${id}">${art(id)}</i>`).join('');
      const effective = cur && (Object.prototype.hasOwnProperty.call(cur, 'eff') ? cur.eff : cur.power);
      const skill = effective && R[effective] ? R[effective].skill : cur?.power === 'copycat' ? '暂无可复制技能' : R[cur?.rid]?.skill;
      const line = cur && racing
        ? `<div class="pline" data-tip="${cur.rid}">${esc(R[cur.rid].name)} · <span>${esc(skill)}</span>${cur.finished ? ` · 第 ${cur.finished} 名` : cur.out ? ' · 出局' : cur.tripped ? ' · 摔倒' : ` · ${cur.pos} 格`}</div>`
        : '';
      const kinds = { gold: 0, silver: 0, bronze: 0 };
      for (const c of p.chips || []) if (kinds[c.kind] != null) kinds[c.kind] += c.v;
      const scoreTitle = `金 ${kinds.gold} · 银 ${kinds.silver} · 铜 ${kinds.bronze}`;
      let think = '';
      if (d && !playing && !queue.length) {
        if (d.simul && d.seats.includes(p.seat)) think = d.done.includes(p.seat) ? '<span class="think ok">已出牌</span>' : '<span class="think">思考中</span>';
        else if (!d.simul && d.seat === p.seat) think = '<span class="think">行动中</span>';
      }
      const offline = !p.ai && room && room.seats[p.seat] && room.seats[p.seat].online === false;
      const modeLabel = offline ? '离线' : autoModes[p.seat] === 'timeout' ? '超时托管' : '托管';
      const tags = `${p.seat === you ? '<span class="you">你</span>' : ''}${(autoFlags[p.seat] || offline) && !p.ai ? `<span class="auto">${modeLabel}</span>` : ''}${p.ai ? '<span class="auto">AI</span>' : ''}`;
      return `<div class="prow ${vs.curSeat === p.seat && vs.phase === 'race' ? 'cur' : ''} ${p.seat === you ? 'me' : ''}" data-seat="${p.seat}" style="--c:${c}">
        <div class="pav" ${cur && racing ? `data-tip="${cur.rid}"` : ''}>${ava}</div>
        <div class="pn"><b>${esc(p.name)}${tags}</b>${line}<div class="hand">${hand}</div></div>
        <div class="sc" title="${scoreTitle}"><b data-score="${p.seat}">${p.score}</b><span>分</span></div>${think}</div>`;
    }).join('');
  }

  function rcard(id, opts = {}) {
    const r = R[id];
    const owner = opts.owner != null ? `<span class="owner" style="--c:${PCOL[opts.owner % 6]}">${esc(vs.players[opts.owner].name)}</span>` : '';
    return `<button class="rcard ${opts.mini ? 'mini' : ''} ${opts.cls || ''}" data-id="${id}" style="--rc:${rcol(id)};--k:${opts.k || 0}" ${opts.disabled ? 'tabindex="-1"' : ''}>
      <div class="art">${art(id)}<span class="nm">${esc(r.name)}</span>${owner}</div>
      <div class="txt"><b class="nm2">${esc(r.name)}</b><span class="sk">${esc(r.skill)}</span><div class="tx">${esc(r.text)}</div>${r.note && !opts.mini ? `<div class="nt">${esc(r.note)}</div>` : ''}</div></button>`;
  }

  function renderDraft(deal) {
    const d = snap && snap.pending;
    $('#draftCards').innerHTML = (vs.faceUp || []).map((id, k) => rcard(id, { cls: deal ? 'deal' : '', k })).join('');
    if (!isParticipant()) for (const el of $$('#draftCards .rcard')) el.dataset.tip = el.dataset.id;
    $('#draftTitle').textContent = isParticipant() ? (vs.draft ? `${vs.draft.round === 0 ? '第一' : '第二'}轮选秀` : '组建你的队伍') : `AI 自动选秀${vs.draft ? ` · 第 ${vs.draft.round + 1}/2 轮` : ''}`;
    const total = vs.players.length * 4;
    const picked = vs.players.reduce((s, p) => s + p.hand.length, 0);
    $('#draftSub').textContent = `已选 ${picked}/${total} · 每人 4 名，四场各派一名 · ${isParticipant() ? '技能写在卡上，轮到你时点击选人' : 'AI 自己选人，点卡牌可查看技能'}`;
    renderDraftOrder();
    renderMyTeam();
    if (d && d.kind === 'draft') bindDraftPick(d);
    fitDraft();
  }
  function fitDraft() {
    if ($('#draft').hidden) return;
    paginate('draft', $('#draftCards'), () => $$('#draftCards .rcard'), $('#draftPager'));
  }
  function bindDraftPick(d) {
    const mine = isParticipant() && d.seat === you && !playing && !queue.length && !submitted && connection === 'ready';
    for (const el of $$('#draftCards .rcard')) {
      el.classList.toggle('pickable', mine);
      el.onclick = mine ? () => {
        if (answer(d, el.dataset.id)) {
          Sound.card();
          $$('#draftCards .rcard').forEach((c) => { c.classList.remove('pickable'); c.onclick = null; });
        }
      } : null;
    }
  }

  /* ================= 名次条 / 行动卡 / 悬停说明 ================= */
  const rankKey = (r) => (r.finished ? -1000 + r.finished : r.out ? 1000 : -r.pos);
  function renderStandings() {
    const box = $('#rankbar');
    const show = !!(vs && (vs.phase === 'race' || vs.phase === 'between') && vs.racers.length && layout === 'wide');
    box.hidden = !show;
    if (!show) return;
    const list = vs.racers.slice().sort((a, b) => rankKey(a) - rankKey(b) || a.seat - b.seat);
    const W = box.clientWidth || 800;
    const n = list.length, gap = 10;
    const w = Math.min(230, (W - gap * (n - 1)) / n);
    const x0 = (W - (n * w + gap * (n - 1))) / 2;
    const live = new Set(list.map((r) => r.rid));
    for (const el of $$('.st-item', box)) if (!live.has(el.dataset.rid)) el.remove();
    let rank = 0, prev = null;
    list.forEach((r, i) => {
      const k = rankKey(r);
      if (k !== prev) { rank = i + 1; prev = k; }
      let el = $(`.st-item[data-rid="${r.rid}"]`, box);
      const fresh = !el;
      if (fresh) {
        el = document.createElement('div');
        el.className = 'st-item';
        el.dataset.rid = r.rid;
        el.dataset.tip = r.rid;
        el.style.setProperty('--c', PCOL[r.seat % 6]);
        el.innerHTML = `<span class="sr"></span><span class="sa">${art(r.rid)}</span><span class="sn"><b>${esc(R[r.rid].name)}</b><i>${esc(vs.players[r.seat].name)}</i></span><span class="ss"></span><span class="sbar"><em></em></span>`;
        el.style.transition = 'none';
        box.appendChild(el);
      }
      el.style.width = `${w}px`;
      el.style.transform = `translateX(${x0 + i * (w + gap)}px)`;
      const sr = $('.sr', el);
      sr.textContent = r.finished ? (r.finished === 1 ? '冠' : '亚') : r.out ? '出' : rank;
      sr.className = `sr ${r.finished ? `rk${r.finished}` : r.out ? 'rko' : ''}`;
      $('.ss', el).textContent = r.finished ? '已冲线' : r.out ? '被吃掉' : `${r.pos} 格`;
      $('.ss', el).classList.toggle('bad', !!r.tripped && !r.finished);
      if (r.tripped && !r.finished && !r.out) $('.ss', el).textContent = `摔倒 · ${r.pos} 格`;
      $('.sbar em', el).style.width = `${r.finished ? 100 : r.out ? 0 : Math.round(r.pos / FIN * 100)}%`;
      el.classList.toggle('cur', vs.curSeat === r.seat && vs.phase === 'race' && !r.finished && !r.out);
      el.classList.toggle('gone', !!r.out);
      if (fresh) { void el.offsetWidth; el.style.transition = ''; }
    });
  }

  let tcRid = null;
  function renderTurnCard() {
    const tc = $('#turnCard');
    const r = vs && vs.phase === 'race' && vs.curSeat != null ? vs.racers.find((x) => x.seat === vs.curSeat) : null;
    if (!r || r.finished || r.out) { tc.hidden = true; tcRid = null; return; }
    const base = R[r.rid];
    const effective = Object.prototype.hasOwnProperty.call(r, 'eff') ? r.eff : r.power;
    const pw = effective && effective !== r.rid && R[effective] ? R[effective] : null;
    const p = vs.players[r.seat];
    const status = r.tripped
      ? '<div class="tc-st bad">摔倒中 · 本回合不掷骰</div>'
      : `<div class="tc-st"><b>${r.pos}</b> 格 · 离终点还差 <b>${FIN - r.pos}</b> 格</div>`;
    tc.hidden = false;
    tc.style.setProperty('--c', PCOL[r.seat % 6]);
    tc.style.setProperty('--rc', rcol(r.rid));
    tc.innerHTML = `<div class="tc-head"><div class="tc-ava">${art(r.rid)}</div><div class="tc-who"><span class="tc-player">${esc(p.name)}${r.seat === you ? ' · 你' : ''}</span><b>${esc(base.name)}</b></div></div>
      <div class="tc-skill"><span class="sk">${esc((pw || base).skill)}</span>${pw ? `<em>借自${esc(pw.name)}</em>` : ''}<p>${esc((pw || base).text)}</p></div>${status}`;
    if (tcRid !== r.rid) { tc.classList.remove('in'); void tc.offsetWidth; tc.classList.add('in'); tcRid = r.rid; }
  }

  function tipHtml(id) {
    const base = R[id];
    if (!base) return '';
    const racing = vs && (vs.phase === 'race' || vs.phase === 'between');
    const r = racing ? vs.racers.find((x) => x.rid === id) : null;
    const owner = r ? vs.players[r.seat] : vs && vs.players.find((p) => p.hand.includes(id));
    const effective = r && (Object.prototype.hasOwnProperty.call(r, 'eff') ? r.eff : r.power);
    const pw = effective && effective !== id && R[effective] ? R[effective] : null;
    let st = '';
    if (r) st = r.finished ? `第 ${r.finished} 名冲线` : r.out ? '已被淘汰' : `在第 ${r.pos} 格 · 离终点 ${FIN - r.pos} 格${r.tripped ? ' · 摔倒中' : ''}`;
    else if (owner && owner.used.includes(id)) st = '已经上过场';
    return `<div class="tip-card" style="--rc:${rcol(id)}"><div class="tip-art">${art(id)}</div><div class="tip-body">
      <div class="tip-name"><b>${esc(base.name)}</b>${owner ? `<span style="--c:${PCOL[owner.seat % 6]}">${esc(owner.name)}</span>` : ''}</div>
      <span class="sk">${esc(base.skill)}</span><p>${esc(base.text)}</p>${base.note ? `<small>${esc(base.note)}</small>` : ''}
      ${pw ? `<div class="tip-pw">本场获得「${esc(pw.skill)}」：${esc(pw.text)}</div>` : ''}${st ? `<div class="tip-st">${esc(st)}</div>` : ''}</div></div>`;
  }
  let tipFor = null, tipTimer = null;
  function showTip(id, anchor) {
    const tip = $('#tip');
    const html = tipHtml(id);
    if (!html) return;
    tip.innerHTML = html;
    tip.hidden = false;
    tipFor = anchor;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = a.left + a.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(innerWidth - t.width - 8, x));
    let y = a.top - t.height - 10;
    if (y < 8) y = a.bottom + 10;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTip() { $('#tip').hidden = true; tipFor = null; clearTimeout(tipTimer); }
  function initTips() {
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest('[data-tip]');
      if (t && t !== tipFor) showTip(t.dataset.tip, t);
    });
    document.addEventListener('pointerout', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
    });
    // 触屏：点一下看说明，点别处关闭
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && (e.pointerType === 'touch' || matchMedia('(hover: none)').matches)) {
        if (t.classList.contains('selectable') || t.closest('.pickable')) return;
        showTip(t.dataset.tip, t);
        clearTimeout(tipTimer);
        tipTimer = setTimeout(hideTip, 4000);
      } else if (!t) hideTip();
    });
    window.addEventListener('scroll', hideTip, true);
  }

  /* ================= 选秀：顺位条 & 我的队伍 ================= */
  function renderDraftOrder() {
    const box = $('#draftOrder');
    const d = vs && vs.draft;
    if (!d) { box.innerHTML = ''; return; }
    const chips = d.order.map((seat, k) => `<span class="do ${k < d.idx ? 'past' : ''} ${k === d.idx ? 'now' : ''}" style="--c:${PCOL[seat % 6]}">${esc(vs.players[seat].name)}${seat === you ? '（你）' : ''}</span>`);
    box.innerHTML = `<span class="do-label">第 ${d.round + 1}/2 轮</span>${chips.join('<span class="do-arrow">›</span>')}`;
    const now = $('.do.now', box);
    if (now) now.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
  function renderMyTeam() {
    const box = $('#myTeam');
    const p = vs && isParticipant() ? vs.players[you] : null;
    if (!p) { box.innerHTML = ''; return; }
    const slots = p.hand.map((id) => `<div class="mt-slot filled" data-tip="${id}" style="--rc:${rcol(id)}">${art(id)}<span>${esc(R[id].name)}</span></div>`);
    for (let i = p.hand.length; i < 4; i++) slots.push('<div class="mt-slot"><span>待选</span></div>');
    box.innerHTML = `<span class="mt-label">你的队伍</span>${slots.join('')}`;
  }

  /* ================= 赛况 / 解说 ================= */
  function addFeed(text, cls = '', seat) {
    if (!text) return;
    const f = $('#feed');
    const ln = document.createElement('div');
    ln.className = `ln ${cls}`;
    if (seat != null && seat >= 0) { ln.classList.add('p'); ln.style.setProperty('--c', PCOL[seat % 6]); }
    ln.textContent = text;
    f.appendChild(ln);
    while (f.children.length > 160) f.firstChild.remove();
    f.scrollTop = f.scrollHeight;
  }
  let comTimer = null;
  function commentary(text) {
    const c = $('#commentary');
    c.innerHTML = text ? `<span>${esc(text)}</span>` : '';
    clearTimeout(comTimer);
    if (text) comTimer = setTimeout(() => { c.innerHTML = ''; }, 3200);
  }
  function setDice(html) {
    $('#diceZone').innerHTML = html || '';
    $('#center').classList.toggle('busy', !!html);
  }

  /* ================= 事件播放 ================= */
  function animationLater(fn, ms) {
    const epoch = animationEpoch;
    const timer = setTimeout(() => { animationTimers.delete(timer); if (epoch === animationEpoch) fn(); }, ms);
    animationTimers.add(timer);
    return timer;
  }
  function resetGameView({ preserveSubmission = false, preserveDeadline = false } = {}) {
    animationEpoch++;
    for (const w of pendingWaits) { clearTimeout(w.timer); w.reject(CANCELLED); }
    pendingWaits.clear();
    for (const t of animationTimers) clearTimeout(t);
    animationTimers.clear();
    for (const t of animationIntervals) clearInterval(t);
    animationIntervals.clear();
    clearTimeout(overlayHideTimer);
    clearInterval(timerTicker); timerTicker = null; timerEnds = 0;
    clearTimeout(comTimer);
    clearNavigation();
    if (!preserveSubmission) clearSubmission();
    if (!preserveDeadline) { deadlineAt = 0; deadlineId = null; timerDuration = 0; }
    lastFullContext = null;
    queue.length = 0; playing = false; fast = false;
    clearPromptLive(); hideTip(); hideOverlay(true);
    vs = null; snap = null; builtTrack = null; tcRid = null;
    lastYourTurnId = null; lastGameOver = null;
    for (const id of ['tokens', 'floaters', 'feed', 'dock', 'commentary']) $(`#${id}`).innerHTML = '';
    setDice('');
    for (const el of $$('.banner, .coin, .bubble')) el.remove();
    cancelAnimationFrame(confettiState.raf); confettiState.raf = 0; confettiState.parts = [];
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
    if (Sound.stop) Sound.stop();
  }
  function wait(ms, epoch) {
    if (epoch !== animationEpoch) return Promise.reject(CANCELLED);
    if (fast || reducedMotion.matches) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { reject, timer: null };
      w.timer = setTimeout(() => { pendingWaits.delete(w); epoch === animationEpoch ? resolve() : reject(CANCELLED); }, ms / speed);
      pendingWaits.add(w);
    });
  }
  async function pump() {
    if (playing) return;
    const epoch = animationEpoch;
    playing = true;
    clearPromptLive();
    try {
      while (queue.length && epoch === animationEpoch) {
        const b = queue.shift();
        fast = document.hidden || queue.length > 3;
        for (const e of b.events) {
          if (epoch !== animationEpoch) return;
          try { await playEvent(e, epoch); } catch (err) {
            if (err === CANCELLED || epoch !== animationEpoch) return;
            console.error('播放事件出错', e, err);
          }
        }
        if (epoch !== animationEpoch) return;
        snap = b.snap;
        if (queue.length === 0) {
          const keepOverlay = overlayKind;
          vs = clone(snap);
          renderAll();
          if (keepOverlay && !overlayKeep()) hideOverlay();
        }
      }
    } finally {
      // 旧 pump 的 finally 也不能解锁新一局、重建旧提示。
      if (epoch === animationEpoch) {
        fast = false; playing = false;
        renderPlayers(); renderPrompt(); syncFinalActions();
      }
    }
  }
  function overlayKeep() {
    if (overlayKind === 'results' || overlayKind === 'final') return true;
    const d = snap && snap.pending;
    if (overlayKind === 'pick') return !!(d && d.simul && d.seats.includes(you));
    return overlayKind === 'choose' && !!(d && !d.simul && d.seat === you && d.id === overlayDecision && ['egg', 'twin'].includes(d.kind));
  }

  const FEED_CLS = { finish: 'good', extraTurn: 'good', out: 'bad', trip: 'bad', blocked: 'bad', chip: 'gold', transform: 'hi', predict: 'hi', duel: 'hi', reveal: 'hi' };
  async function playEvent(e, epoch) {
    const pause = async (ms) => { await wait(ms, epoch); if (epoch !== animationEpoch) throw CANCELLED; };
    if (epoch !== animationEpoch) throw CANCELLED;
    if (e.text && e.t !== 'raceIntro') {
      const r0 = vr(e.rid) || vr(e.a);
      addFeed(e.text, FEED_CLS[e.t] || '', e.seat != null ? e.seat : r0 ? r0.seat : undefined);
    }
    switch (e.t) {
      case 'rollOff': {
        const who = e.reason === 'draft' ? '选秀顺序' : '第一场先手';
        const html = `<div class="roll-off">${e.rolls.map((r) => `<div class="ro"><div class="die land">${die(r.v)}</div><span style="color:${PCOL[r.seat % 6]}">${esc(vs.players[r.seat].name)}</span></div>`).join('')}</div>`;
        if (vs.phase === 'draft' || vs.phase === 'pick') { showMiniOverlay(`<h2>掷骰决定${who}</h2>${html}`); Sound.dice(); await pause(1200); } else { setDice(html); Sound.dice(); await pause(1200); }
        break;
      }
      case 'draftStart':
        vs.phase = 'draft';
        hideOverlay();
        renderAll();
        commentary(e.text);
        await pause(700);
        break;
      case 'faceUp':
        vs.faceUp = e.cards.slice();
        if (e.order) vs.draft = { order: e.order, idx: 0, round: e.round };
        $('#draftTitle').textContent = e.round === 0 ? '第一轮选秀' : '第二轮选秀';
        renderDraft(true);
        for (let i = 0; i < Math.min(6, e.cards.length); i++) animationLater(() => Sound.card(), i * 70);
        await pause(1000);
        break;
      case 'drafted': {
        const el = $(`#draftCards .rcard[data-id="${e.rid}"]`);
        vs.players[e.seat].hand.push(e.rid);
        if (vs.draft) vs.draft.idx++;
        renderDraftOrder();
        renderMyTeam();
        if (el) {
          const o = document.createElement('span');
          o.className = 'owner'; o.style.setProperty('--c', PCOL[e.seat % 6]); o.textContent = vs.players[e.seat].name;
          $('.art', el).appendChild(o);
          el.classList.add('gone');
        }
        Sound.card();
        renderPlayers();
        await pause(480);
        vs.faceUp = vs.faceUp.filter((id) => id !== e.rid);
        if (el) el.remove();
        break;
      }
      case 'firstPlayer':
        commentary(e.text);
        await pause(700);
        break;
      case 'raceIntro': {
        hideOverlay();
        vs.phase = 'pick';
        vs.raceNo = e.race;
        vs.track = e.track;
        vs.racers = [];
        vs.curSeat = null;
        $('#tokens').innerHTML = '';
        setDice('');
        renderAll();
        addFeed(`第 ${e.race} 场 · ${TRACKS[e.track].name}（金 ${e.gold} / 银 ${e.silver}）`, 'race');
        banner(`第 ${e.race} 场 · ${TRACKS[e.track].name}`, `冠军 ${e.gold} 分 · 亚军 ${e.silver} 分`, e.track === 'wild');
        Sound.reveal();
        await pause(1500);
        break;
      }
      case 'picked': {
        if (snap && snap.pending && snap.pending.simul) {
          if (!snap.pending.done.includes(e.seat)) snap.pending.done.push(e.seat);
          updatePickStatus(snap.pending);
          renderPlayers();
        }
        break;
      }
      case 'reveal': {
        vs.phase = 'race';
        vs.racers = e.picks.map((p) => ({ rid: p.rid, seat: p.seat, pos: 0, tripped: false, finished: 0, out: false, power: p.rid }));
        for (const p of e.picks) if (!vs.players[p.seat].used.includes(p.rid)) vs.players[p.seat].used.push(p.rid);
        showRevealOverlay(e.picks);
        Sound.reveal();
        renderPlayers();
        await pause(2300);
        hideOverlay();
        layoutTokens(true);
        renderTitle();
        break;
      }
      case 'turn': {
        vs.curSeat = e.seat;
        setDice('');
        layoutTokens();
        renderPlayers();
        renderTitle();
        renderTurnCard();
        { const r = vr(e.rid); if (r) addFeed(`${vs.players[e.seat].name} · ${R[r.rid].name} 的回合`, 'turn', e.seat); }
        Sound.turn();
        await pause(330);
        break;
      }
      case 'recover': {
        const r = vr(e.rid); if (r) r.tripped = false;
        layoutTokens();
        floater(e.rid, '爬起来了', '');
        await pause(420);
        break;
      }
      case 'roll': {
        const r = vr(e.rid);
        const cap = `${r ? esc(vs.players[r.seat].name) : ''}${e.reroll ? ' 重掷' : ''}`;
        setDice(`<div class="die rolling">${die(1 + Math.floor(Math.random() * 6))}</div>`);
        Sound.dice();
        const spin = setInterval(() => { if (epoch !== animationEpoch) return; const d = $('#diceZone .die.rolling'); if (d) d.innerHTML = die(1 + Math.floor(Math.random() * 6)); }, 90);
        animationIntervals.add(spin);
        await pause(560);
        clearInterval(spin); animationIntervals.delete(spin);
        setDice(`<div class="die land">${die(e.value)}<div class="die-cap">${cap}</div></div>`);
        Sound.diceLand(e.value);
        await pause(420);
        break;
      }
      case 'calc': {
        const mods = e.mods.map((m) => `<span class="m ${m.v < 0 ? 'neg' : 'pos'}">${esc(m.label)} ${m.v > 0 ? '+' : ''}${m.v}</span>`).join('');
        setDice(`<div class="calc"><div class="die" style="width:calc(56*var(--u));height:calc(56*var(--u))">${e.base <= 6 ? die(e.base) : ''}</div>${e.base > 6 ? `<b>${e.base}</b>` : ''}${mods}<span>=</span><span class="eq">${e.total}</span></div>`);
        await pause(850);
        break;
      }
      case 'move': {
        const r = vr(e.rid);
        if (!r) break;
        const el = tokenEl(r);
        const back = e.to < e.from;
        let i = 0;
        for (const p of e.path) {
          r.pos = p === FIN ? FIN : p;
          layoutTokens();
          const hop = $('.hop', el);
          hop.classList.remove('go'); void hop.offsetWidth; hop.classList.add('go');
          if (back) Sound.back(); else Sound.hop(i);
          i++;
          await pause(Timing.STEP);
        }
        r.pos = e.to;
        if (e.kind === 'arrow') pulseCell(e.to);
        layoutTokens();
        await pause(140);
        break;
      }
      case 'warp': {
        const r = vr(e.rid); if (!r) break;
        const el = tokenEl(r);
        el.classList.add('warp-out');
        Sound.warp();
        await pause(250);
        r.pos = e.to;
        layoutTokens(true);
        el.classList.remove('warp-out');
        pulseCell(e.to);
        await pause(300);
        break;
      }
      case 'swap': {
        const a = vr(e.a), b = vr(e.b); if (!a || !b) break;
        const ea = tokenEl(a), eb = tokenEl(b);
        ea.classList.add('warp-out'); eb.classList.add('warp-out');
        Sound.warp();
        commentary(e.text);
        await pause(300);
        a.pos = e.pa; b.pos = e.pb;
        layoutTokens(true);
        ea.classList.remove('warp-out'); eb.classList.remove('warp-out');
        await pause(450);
        break;
      }
      case 'power': {
        const r = vr(e.rid);
        const key = e.key;
        floater(e.rid, `${R[key] ? R[key].skill : key}！`, '', r ? '#FFF3C4' : undefined);
        Sound.power();
        await pause(260);
        break;
      }
      case 'trip': {
        const r = vr(e.rid); if (r) r.tripped = true;
        layoutTokens();
        renderTurnCard();
        floater(e.rid, '摔倒！', 'bad');
        Sound.trip();
        await pause(500);
        break;
      }
      case 'finish': {
        const r = vr(e.rid);
        if (r) { r.finished = e.place; }
        layoutTokens();
        Sound.finish(e.place);
        floater(e.rid, e.place === 1 ? '冠军！' : '亚军！', 'good');
        commentary(e.text);
        const el = r && tokenEl(r);
        if (el) { const b = el.getBoundingClientRect(); confetti(e.place === 1 ? 90 : 50, b.left + b.width / 2, b.top + b.height / 2); }
        await pause(1250);
        break;
      }
      case 'out': {
        const r = vr(e.rid); if (r) r.out = true;
        Sound.chomp();
        floater(e.rid, '被吃掉了！', 'bad');
        commentary(e.text);
        await pause(300);
        layoutTokens();
        await pause(650);
        break;
      }
      case 'chip': {
        const p = vs.players[e.seat];
        if (e.kind === 'lose') {
          p.score = Math.max(0, p.score - 1);
          const r = vs.racers.find((x) => x.seat === e.seat);
          floater(r && r.rid, '-1 分', 'bad');
          Sound.lose();
        } else {
          p.score += e.v;
          const r = vs.racers.find((x) => x.seat === e.seat);
          flyCoin(r && r.rid, e.seat, e.kind, e.v);
          Sound.chip();
        }
        await pause(360);
        const sc = $(`[data-score="${e.seat}"]`);
        if (sc) { sc.textContent = p.score; sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump'); }
        break;
      }
      case 'blocked': {
        const el = $(`#tokens .token[data-rid="${e.rid}"]`);
        if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
        floater(e.rid, '走不了！', 'bad');
        Sound.blocked();
        commentary(e.text);
        await pause(650);
        break;
      }
      case 'space':
        pulseCell(e.pos);
        await pause(300);
        break;
      case 'predict': {
        const txt = e.target ? `预言：${R[vr(e.target)?.rid || e.target]?.name || ''} 夺冠` : `预言掷出 ${e.value}`;
        floater(e.rid, txt, 'good');
        commentary(e.text);
        await pause(850);
        break;
      }
      case 'copy': {
        const r = vr(e.rid); if (r) r.eff = e.power;
        renderTurnCard(); renderPlayers(); commentary(e.text);
        await pause(400);
        break;
      }
      case 'transform': {
        const r = vr(e.rid); if (r) { r.power = e.power; r.eff = e.power; }
        renderTurnCard();
        renderPlayers();
        floater(e.rid, `获得「${R[e.power].skill}」`, 'good');
        commentary(e.text);
        Sound.warp();
        await pause(1200);
        break;
      }
      case 'duel': {
        setDice(`<div class="duel-dice"><div class="die land">${die(e.ra)}<div class="die-cap">${esc(rname(e.a))}</div></div><b class="vs">VS</b><div class="die land">${die(e.rb)}<div class="die-cap">${esc(rname(e.b))}</div></div></div>`);
        Sound.duel();
        commentary(e.text);
        await pause(1400);
        break;
      }
      case 'extraTurn':
        floater(e.rid, '再来一回合！', 'good');
        await pause(650);
        break;
      case 'info':
        if (e.text) commentary(e.text);
        await pause(e.rid ? 380 : 500);
        break;
      case 'raceEnd': {
        vs.phase = 'between';
        await pause(500);
        showResultsOverlay(e);
        Sound.fanfare();
        await pause(3000);
        break;
      }
      case 'gameOver':
        vs.phase = 'over';
        showFinalOverlay(e);
        Sound.fanfare();
        confetti(260);
        await pause(1500);
        break;
      default: break;
    }
  }

  function banner(title, sub, wild) {
    const b = document.createElement('div');
    b.className = `banner ${wild ? 'wild' : ''}`;
    b.innerHTML = `<div><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
    document.body.appendChild(b);
    animationLater(() => b.remove(), 1700 / Math.min(speed, 1.5));
  }

  function flyCoin(rid, seat, kind, v) {
    const from = (rid && $(`#tokens .token[data-rid="${rid}"]`)) || $('#center');
    const to = $(`[data-score="${seat}"]`);
    if (!from || !to || fast || reducedMotion.matches) return;
    const epoch = animationEpoch;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const c = document.createElement('div');
    c.className = 'coin';
    c.style.background = kind === 'gold' ? 'var(--gold)' : kind === 'silver' ? 'var(--silver)' : 'var(--bronze)';
    c.textContent = v;
    c.style.left = `${a.left + a.width / 2 - 13}px`;
    c.style.top = `${a.top + a.height / 2 - 13}px`;
    document.body.appendChild(c);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (epoch !== animationEpoch) return;
      c.style.left = `${b.left + b.width / 2 - 13}px`;
      c.style.top = `${b.top + b.height / 2 - 13}px`;
      c.style.transform = 'scale(.6) rotate(360deg)';
    }));
    setTimeout(() => c.remove(), 760);
  }

  /* ================= 浮层 ================= */
  function showOverlay(html, kind) {
    const ov = $('#overlay');
    clearTimeout(overlayHideTimer);
    ov.hidden = false;
    ov.classList.remove('out');
    ov.innerHTML = html;
    overlayKind = kind;
    fillIcons(ov);
    return ov;
  }
  function hideOverlay(instant) {
    const ov = $('#overlay');
    overlayKind = null;
    overlayDecision = null;
    if (ov.hidden) return;
    if (instant) { ov.hidden = true; ov.innerHTML = ''; return; }
    ov.classList.add('out');
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => { if (ov.classList.contains('out')) { ov.hidden = true; ov.innerHTML = ''; ov.classList.remove('out'); } }, 280);
  }
  function showMiniOverlay(inner) {
    showOverlay(`<div class="ov-box card mini-ov">${inner}</div>`, 'mini');
  }
  function showRevealOverlay(picks) {
    const cards = picks.map((p, k) => `<div class="flip" style="--k:${k}"><div class="face">${rcard(p.rid, { mini: true })}</div><div class="face back"></div><div class="who" style="color:${PCOL[p.seat % 6]}">${esc(vs.players[p.seat].name)}</div></div>`).join('');
    showOverlay(`<div class="ov-box card"><h2>第 ${vs.raceNo} 场 · 选手登场</h2><p class="sub">${TRACKS[vs.track].name}</p><div class="reveal-grid">${cards}</div><div style="height:30px"></div></div>`, 'reveal');
  }
  function showResultsOverlay(e) {
    const st = e.standings.slice();
    const first = st.find((s) => s.finished === 1);
    const second = st.find((s) => s.finished === 2) || (first && first.bonus ? first : null);
    const pod = (s, cls, label, pts) => (s ? `<div class="pod ${cls}" style="--c:${PCOL[s.seat % 6]}"><div class="who">${art(s.rid)}</div><div class="nm">${esc(vs.players[s.seat].name)}</div><div class="rn">${esc(R[s.rid].name)}</div><div class="blk">${label}<small>+${pts} 分</small></div></div>` : '');
    const idx = e.race - 1;
    const rows = vs.players.map((p) => ({ p, sc: e.scores[p.seat], prev: e.race > 1 && snap && snap.results && snap.results[e.race - 2] ? snap.results[e.race - 2].scores[p.seat] : (e.race === 1 ? 0 : null) }))
      .sort((a, b) => b.sc - a.sc)
      .map((x, k) => `<div class="st-row ${k === 0 ? 'top' : ''}" style="animation-delay:${k * 60}ms"><span class="rk">${k + 1}</span><span>${esc(x.p.name)}</span><span class="gain">${x.prev != null && x.sc - x.prev > 0 ? `+${x.sc - x.prev}` : ''}</span><span class="tot">${x.sc}</span></div>`).join('');
    showOverlay(`<div class="ov-box card"><h2>第 ${e.race} 场结果</h2><p class="sub">${TRACKS[e.track].name}</p>
      <div class="podium">${pod(second, 'p2', '2', SILVER[idx])}${pod(first, 'p1', '1', GOLD[idx])}</div>
      <div class="standings">${rows}</div>
      <div class="ov-actions"><button class="btn" id="ovClose">看看赛道</button></div></div>`, 'results');
    $('#ovClose').onclick = () => { Sound.click(); hideOverlay(); };
  }
  function syncFinalActions() {
    if (overlayKind !== 'final') return;
    const control = $('#finalReplayControl');
    if (!control) return;
    const host = room?.host === me.id;
    const spectator = isSpectator();
    const type = spectator ? 'replay' : 'lobby';
    if (host) {
      let again = $('#again', control);
      if (!again) {
        control.innerHTML = `<button class="btn primary big" id="again" data-navigation="${type}">${spectator ? '再看一局' : '再来一局'}</button>`;
        again = $('#again', control);
        again.onclick = () => { Sound.click(); navigate(type, again); };
      }
      again.disabled = connection !== 'ready' || !!navigationPending;
    } else if ($('#again', control) || !control.firstChild) {
      control.innerHTML = `<span class="sub">${spectator ? '等房主开启下一场 AI 对局…' : '等房主开下一局…'}</span>`;
    }
  }
  function showFinalOverlay(e) {
    lastGameOver = e;
    const rows = e.scores.slice().sort((a, b) => b.score - a.score);
    const champs = e.champions.map((s) => vs.players[s].name).join('、');
    const list = rows.map((x, k) => `<div class="st-row ${e.champions.includes(x.seat) ? 'top' : ''}" data-seat="${x.seat}" style="animation-delay:${k * 80}ms"><span class="rk">${k + 1}</span><span class="st-name">${esc(vs.players[x.seat].name)}${x.seat === you ? '（你）' : ''}</span><span class="gain"></span><span class="tot">${x.score}</span></div>`).join('');
    const spectator = isSpectator();
    const champ = e.champions[0];
    const cp = vs.players[champ];
    const lastRid = cp && cp.hand[cp.hand.length - 1];
    showOverlay(`<div class="ov-box card"><h2>总冠军：${esc(champs)}</h2><p class="sub">${e.champions.includes(you) ? '你赢了！胡闹之王！' : spectator ? '四场 AI 对局已落幕，冠军诞生！' : '四场胡闹落幕，下次再战！'}</p>
      <div class="podium"><div class="pod p1" style="--c:${PCOL[champ % 6]}"><div class="who">${lastRid ? art(lastRid) : ''}</div><div class="nm">${esc(cp.name)}</div><div class="blk">1<small>${rows[0].score} 分</small></div></div></div>
      <div class="standings">${list}</div>
      <div class="ov-actions"><span id="finalReplayControl"></span><button class="btn" id="toHome">回到首页</button><button class="btn ghost" id="ovClose">看看赛道</button></div></div>`, 'final');
    syncFinalActions();
    $('#toHome').onclick = () => { Sound.click(); navigate('leave', $('#toHome')); };
    $('#ovClose').onclick = () => { Sound.click(); hideOverlay(); };
  }

  function showPickOverlay(d) {
    const mineOpts = d.optionsBySeat[you];
    const answered = d.done.includes(you);
    const sending = !!(submitted && submitted.id === d.id);
    const key = `${d.id}:${answered}:${sending}:${connection}`;
    if (overlayKind === 'pick' && overlayDecision === key) { updatePickStatus(d); return; }
    const idx = vs.raceNo - 1;
    const hint = idx < 3 ? '后面的比赛分更高，王牌可以留到后面' : '最后一场，全力以赴！';
    const canPick = mineOpts && !answered && !sending && connection === 'ready';
    const cards = mineOpts && !answered ? mineOpts.map((o, k) => rcard(o.v, { cls: canPick ? 'pickable deal' : 'dim', k })).join('') : '';
    showOverlay(`<div class="ov-box card"><h2>第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}</h2>
      <p class="sub">冠军 ${GOLD[idx]} 分 · 亚军 ${SILVER[idx]} 分 · ${sending ? '正在提交，等待服务器确认…' : connection !== 'ready' ? '断线中，重连同步后可重新选择' : canPick ? `派谁上场？${hint}` : answered ? '你的出牌已确认，等待其他人…' : '等待其他人出牌…'}</p>
      <div class="ov-cards" id="pickCards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div><div class="pick-status" id="pickStatus"></div></div>`, 'pick');
    overlayDecision = key;
    updatePickStatus(d);
    fitOverlayCards(true);
    for (const el of $$('#pickCards .rcard')) {
      el.onclick = canPick ? () => { if (answer(d, el.dataset.id)) Sound.card(); } : null;
    }
  }
  // 出战 / 选择浮层里的卡牌放不下时分页
  function fitOverlayCards(fresh) {
    const box = $('#overlay .ov-cards');
    if (!box || $('#overlay').hidden) return;
    if (fresh && pagers.ov) pagers.ov.anchor = 0;
    paginate('ov', box, () => $$('.rcard', box), $('#ovPager'));
  }
  function updatePickStatus(d) {
    const box = $('#pickStatus');
    if (!box) return;
    box.innerHTML = d.seats.map((s) => `<span class="${d.done.includes(s) ? 'ok' : ''}" style="border-color:${PCOL[s % 6]}">${d.done.includes(s) ? `<span class="ico">${icon('check')}</span>` : ''}${esc(vs.players[s].name)}</span>`).join('');
  }

  function showChooseOverlay(d, title, sub) {
    if (overlayKind === 'choose' && overlayDecision === d.id) return;
    const cards = d.options.filter((o) => R[o.v]).map((o, k) => rcard(o.v, { cls: 'pickable deal', k })).join('');
    const extra = d.options.filter((o) => !R[o.v]).map((o) => `<button class="btn" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
    showOverlay(`<div class="ov-box card"><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p><div class="ov-cards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div><div class="ov-actions">${extra}</div></div>`, 'choose');
    overlayDecision = d.id;
    fitOverlayCards(true);
    for (const el of $$('#overlay .rcard, #overlay [data-v]')) {
      el.onclick = () => { if (answer(d, el.dataset.id || el.dataset.v)) { Sound.card(); hideOverlay(); } };
    }
  }

  /* ================= 决策面板 ================= */
  function clearPromptLive() {
    $('#board').classList.remove('picking-cell');
    for (const el of $$('#tokens .token.selectable')) el.classList.remove('selectable');
    for (const el of $$('#trackSvg .cell.pick')) { el.classList.remove('pick'); el.onclick = null; }
    tokenPick = null;
  }
  let tokenPick = null;
  function onTokenClick(rid) {
    if (tokenPick && tokenPick.map[rid]) tokenPick.fn(tokenPick.map[rid]);
  }
  let locked = false;
  function lockPrompt() { locked = true; $$('#dock button').forEach((b) => { b.disabled = true; }); }
  function unlockPrompt() { locked = !!submitted; if (!playing && !queue.length) renderPrompt(); }
  function answer(d, v) {
    const current = snap && snap.pending;
    if (!isParticipant() || locked || playing || queue.length || !current || current.id !== d.id ||
        (current.simul ? !current.seats.includes(you) || current.done.includes(you) : current.seat !== you)) return false;
    // 旧后端没有 gameId 字段；新后端始终下发并严格校验，升级前仍可继续现有对局。
    if (!send({ type: 'act', ...(gameId ? { gameId } : {}), id: d.id, value: v })) return false;
    submitted = { gameId, id: d.id, value: v };
    lockPrompt();
    clearPromptLive();
    // 没有独立 ack 的协议下，长时间不确认就重新握手拿权威快照，绝不重播旧 act。
    submitTimer = setTimeout(() => {
      if (!submitted || submitted.id !== d.id || submitted.gameId !== gameId) return;
      toast('操作尚未确认，正在重新同步；不会重复提交', true);
      if (ws) ws.close();
    }, 8000);
    renderPrompt();
    return true;
  }

  const WAIT_TEXT = {
    draft: '正在挑选运动员', roll: '准备掷骰子', mode: '在想这回合怎么走', reroll: '在考虑要不要重掷',
    genius: '在预言点数', mastermind: '在预言冠军', hypnotist: '在施展催眠', thirdwheel: '在找两人世界',
    cheerleader: '在考虑要不要加油', alchemist: '在炼金', rocket: '在考虑要不要点火', suckerfish: '在考虑要不要跟上',
    duel: '在考虑要不要决斗', egg: '在孵蛋', twin: '在挑选要复制的冠军',
  };

  function renderPrompt() {
    if (playing || queue.length || !snap || !vs) return;
    locked = !!submitted;
    clearPromptLive();
    renderPlayers();
    const dock = $('#dock');
    const d = snap.pending;
    if (!isParticipant() && (snap.phase !== 'over' || connection !== 'ready')) {
      if (['pick', 'choose', 'mini', 'reveal'].includes(overlayKind)) hideOverlay(true);
      if (vs.phase === 'draft') bindDraftPick(d || {});
      let title = 'AI 对局正在进行', sub = '选秀、出战、掷骰与技能均由 AI 自动完成';
      let seat = -1;
      if (connection !== 'ready') { title = '观战连接已断开，正在重新同步'; sub = '重连后继续观看，不会要求你选卡或接管 AI'; }
      else if (d?.simul) {
        const done = (d.done || []).length, total = (d.seats || vs.players).length;
        title = `AI 正在暗选出战 · ${done}/${total} 已选好`;
        sub = `第 ${vs.raceNo} 场 · 全部选好后同时亮牌`;
      } else if (d) {
        seat = d.seat;
        const p = vs.players[seat];
        title = `${p?.name || 'AI'} ${WAIT_TEXT[d.kind] || '正在思考'}`;
        sub = d.kind === 'draft' ? 'AI 自动组建队伍 · 可以查看卡牌技能，无需操作' : 'AI 自动行动 · 骰子、技能和移动按顺序播放';
      } else if (vs.phase === 'between') { title = `第 ${vs.raceNo} 场已结束`; sub = '正在结算，随后自动进入下一场'; }
      if (connection === 'ready' && room?.spectators?.length && !room.spectators.some((p) => p.online)) {
        title = '暂无在线观众，AI 对局等待中'; sub = '观众重新连接后会自动继续';
      }
      dock.innerHTML = promptHtml({ seat, mine: false, title, sub });
      return;
    }
    if (vs.phase === 'draft') bindDraftPick(d || {});
    if (connection !== 'ready' || submitted) {
      if (d && d.simul) showPickOverlay(d);
      else if (overlayKind === 'choose' || overlayKind === 'pick') hideOverlay(true);
      dock.innerHTML = promptHtml({ seat: you, mine: false, title: submitted ? '正在提交，等待服务器确认' : '连接已断开，正在重新同步', sub: submitted ? '确认前不会重复提交；其他选手的更新不会误判为成功' : '重连完成后按最新局面重新操作，未发送的动作不会自动补发' });
      addTimer();
      return;
    }
    if (snap.phase === 'over') {
      const host = room && room.host === me.id;
      const spectator = isSpectator();
      const againType = spectator ? 'replay' : 'lobby';
      dock.innerHTML = promptHtml({ seat: you, mine: false, title: '比赛结束', sub: spectator && !host ? '等房主开启下一场 AI 对局…' : '四场胡闹已落幕', opts: `<button class="btn" data-x="show">查看成绩</button>${host ? `<button class="btn primary" data-x="again" data-navigation="${againType}" ${navigationPending ? 'disabled' : ''}>${spectator ? '再看一局' : '再来一局'}</button>` : ''}<button class="btn" data-x="home">回到首页</button>` });
      $('.prompt', dock).classList.remove('wait');
      for (const b of $$('#dock [data-x]')) {
        b.onclick = () => {
          Sound.click();
          if (b.dataset.x === 'show' && lastGameOver) showFinalOverlay(lastGameOver);
          if (b.dataset.x === 'again') navigate(againType, b);
          if (b.dataset.x === 'home') navigate('leave', b);
        };
      }
      return;
    }
    if (!d) { dock.innerHTML = ''; return; }
    if (d.simul) {
      showPickOverlay(d);
      const mine = d.seats.includes(you) && !d.done.includes(you);
      dock.innerHTML = promptHtml({ seat: you, mine, title: mine ? '选择本场出战的运动员' : '等待所有人出牌', sub: mine ? '在上方卡牌中点选' : '所有人选好后同时亮牌' });
      if (mine) { yourTurnPing(d.id); addTimer(); }
      return;
    }
    if (overlayKind === 'pick' || overlayKind === 'mini' || overlayKind === 'reveal' || (overlayKind === 'choose' && !overlayKeep())) hideOverlay();
    const p = vs.players[d.seat];
    const mine = d.seat === you;
    if (!mine) {
      dock.innerHTML = promptHtml({ seat: d.seat, mine: false, title: `${p.name} ${WAIT_TEXT[d.kind] || '正在决策'}`, sub: d.title });
      return;
    }
    yourTurnPing(d.id);
    let opts = '';
    let sub = '';
    const r = vs.racers.find((x) => x.seat === you);
    switch (d.kind) {
      case 'draft':
        dock.innerHTML = promptHtml({ seat: you, mine: true, title: '轮到你选人了！', sub: '点击上方任意一张卡牌，把它招进你的队伍' });
        addTimer();
        return;
      case 'roll':
        opts = `<button class="btn roll-btn" data-v="roll"><span class="ico">${icon('dice')}</span>掷骰子</button>`;
        sub = r ? `${R[r.rid].name} 在第 ${r.pos} 格 · 按空格也能掷` : '';
        break;
      case 'genius':
        opts = `<div class="num-opts">${d.options.map((o) => `<button class="btn" data-v="${o.v}" title="${o.v}">${o.v}</button>`).join('')}</div>`;
        sub = '猜中了本回合结束后再来一回合';
        break;
      case 'reroll':
        opts = d.options.map((o) => `<button class="btn ${o.v === 'keep' ? 'primary' : ''}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
        sub = r ? `现在在第 ${r.pos} 格` : '';
        break;
      case 'egg':
        showChooseOverlay(d, '神秘蛋孵化中', '从三名运动员里挑一个技能');
        dock.innerHTML = promptHtml({ seat: you, mine: true, title: d.title, sub: '在上方挑一张卡' });
        addTimer();
        return;
      case 'twin':
        showChooseOverlay(d, '双胞胎', '复制一位往届冠军的技能');
        dock.innerHTML = promptHtml({ seat: you, mine: true, title: d.title, sub: '在上方挑一张卡' });
        addTimer();
        return;
      case 'mode':
      case 'hypnotist':
      case 'mastermind':
      case 'duel': {
        const map = {};
        for (const o of d.options) {
          const rid = d.kind === 'mode' ? (o.v.startsWith('flip:') ? o.v.slice(5) : null) : (R[o.v] ? o.v : null);
          if (rid) map[rid] = o.v;
        }
        const tokOpts = d.options.filter((o) => Object.values(map).includes(o.v));
        const plain = d.options.filter((o) => !Object.values(map).includes(o.v));
        opts = plain.map((o, k) => `<button class="btn ${k === 0 ? 'primary' : ''}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
        if (tokOpts.length) {
          opts += tokOpts.map((o) => `<button class="btn small" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
          for (const rid of Object.keys(map)) { const el = $(`#tokens .token[data-rid="${rid}"]`); if (el) el.classList.add('selectable'); }
          tokenPick = { map, fn: (v) => answer(d, v) };
          sub = '也可以直接点赛道上闪烁的棋子';
        }
        break;
      }
      case 'thirdwheel': {
        $('#board').classList.add('picking-cell');
        opts = d.options.map((o) => `<button class="btn ${o.v === '_no' ? '' : 'small'}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
        for (const o of d.options) {
          if (!o.v.startsWith('s')) continue;
          const c = $(`#trackSvg .cell[data-p="${o.v.slice(1)}"]`);
          if (c) { c.classList.add('pick'); c.onclick = () => answer(d, o.v); }
        }
        sub = '也可以直接点赛道上闪烁的格子';
        break;
      }
      default:
        opts = d.options.map((o, k) => `<button class="btn ${k === 0 ? 'primary' : ''}" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
    }
    dock.innerHTML = promptHtml({ seat: you, mine: true, title: d.title, sub, opts });
    for (const b of $$('#dock [data-v]')) b.onclick = () => { Sound.click(); answer(d, b.dataset.v); };
    addTimer();
  }

  function promptHtml({ seat, mine, title, sub, opts }) {
    const r = vs.racers.find((x) => x.seat === seat);
    const c = PCOL[seat % 6] || '#ccc';
    const ava = r && vs.phase === 'race' ? art(r.rid) : '';
    return `<div class="prompt ${mine ? 'mine' : 'wait'}" style="--c:${c}">${ava ? `<div class="p-ava">${ava}</div>` : ''}<div class="p-txt"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>${opts ? `<div class="p-opts">${opts}</div>` : ''}<div class="timer" hidden></div></div>`;
  }
  function addTimer() {
    clearInterval(timerTicker); timerTicker = null;
    const t = $('#dock .timer');
    if (!t) return;
    const remain = deadlineAt - Date.now();
    if (!deadlineAt || remain <= 0 || remain > 120000) { t.hidden = true; timerEnds = 0; return; }
    if (!timerDuration) timerDuration = remain;
    const duration = timerDuration;
    timerEnds = deadlineAt;
    t.style.transform = 'none';
    t.style.transition = 'none';
    t.dataset.duration = String(duration);
    t.hidden = false;
    t.setAttribute('role', 'progressbar');
    t.setAttribute('aria-label', '本次决策剩余时间');
    t.setAttribute('aria-valuemin', '0'); t.setAttribute('aria-valuemax', String(Math.ceil(duration / 1000)));
    const tick = () => {
      if (!t.isConnected || timerEnds !== deadlineAt) { clearInterval(timerTicker); timerTicker = null; return; }
      const ms = Math.max(0, deadlineAt - Date.now());
      t.style.width = `${Math.min(100, ms / duration * 100)}%`;
      t.setAttribute('aria-valuenow', String(Math.ceil(ms / 1000)));
      t.setAttribute('aria-valuetext', `剩余 ${Math.ceil(ms / 1000)} 秒`);
      if (!ms) { clearInterval(timerTicker); timerTicker = null; }
    };
    tick(); timerTicker = setInterval(tick, 100);
  }
  function yourTurnPing(id) {
    if (lastYourTurnId === id) return;
    lastYourTurnId = id;
    Sound.yourTurn();
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) try { navigator.vibrate(30); } catch (e) { /* ignore */ }
  }

  /* ================= 表情 ================= */
  function initEmotes() {
    const box = $('#emotes');
    box.innerHTML = EMOTES.map((t) => `<button data-e="${t}">${t}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      send({ type: 'emote', key: b.dataset.e });
    });
  }
  function showEmote(seat, key) {
    const row = $(`.prow[data-seat="${seat}"]`);
    if (row) {
      const b = document.createElement('div');
      b.className = 'bubble'; b.textContent = key;
      row.appendChild(b);
      setTimeout(() => b.remove(), 2300);
    }
    const r = vs && vs.racers.find((x) => x.seat === seat && !x.out);
    if (r && vs.phase === 'race') floater(r.rid, key, '', '#fff');
    Sound.pop();
  }

  /* ================= 弹窗：规则 / 图鉴 ================= */
  function openModal(kind) {
    const m = $('#modal');
    let title, body;
    if (kind === 'gallery') {
      title = '运动员图鉴 · 36 名';
      const save = vs; if (!vs) vs = { players: [] };
      body = `<div class="gallery" data-fit>${RACERS.map((r) => rcard(r.id)).join('')}</div>`;
      vs = save;
    } else if (kind === 'tracks') {
      title = '地图图鉴 · 2 条赛道';
      body = '<div class="tguide" id="tguide"></div>';
    } else {
      title = '玩法说明';
      body = `<div class="rules" data-fit>
        <section class="rule-sec"><h4>当前试玩版</h4><p>支持 <span class="kw">3-6 名选手</span>（含 AI）。两位朋友可以加 1 名 AI 开赛，单人可以直接挑战 AI。狂野赛道采用自定义布局；奖牌分值使用下方的递增设置。双人各操控两名运动员的变体尚未加入。</p></section>
        <section class="rule-sec"><h4>目标</h4><p>一共比 <span class="kw">4 场</span>赛跑，每场前两名冲线的拿分：冠军拿金杯、亚军拿银牌，越往后的比赛分越高（金 ${GOLD.join('/')}，银 ${SILVER.join('/')}）。四场结束总分最高者获胜，并列就一起庆祝！</p></section>
        <section class="rule-sec"><h4>组建队伍</h4><p>开局掷骰决定顺序，进行两轮<span class="kw">蛇形选秀</span>：翻开人数×2 张运动员卡，按 1→N 再 N→1 的顺序每人挑一张，两轮后每人 4 名运动员。</p></section>
        <section class="rule-sec"><h4>比赛</h4><ul>
          <li>每场所有人<span class="kw">同时暗选</span>一名还没上过场的运动员，一起亮牌，放到起点。</li>
          <li>轮到你时掷骰，走对应格数，这叫<span class="kw">主移动</span>。很多技能只对主移动生效。</li>
          <li>有两名运动员冲过终点，比赛立刻结束。下一场由上一场最落后（或最先被淘汰）的人先手。</li>
          <li>赛道交替：温和一英里 → 狂野荒原 → 温和一英里 → 狂野荒原。</li>
        </ul></section>
        <section class="rule-sec"><h4>技能</h4><ul>
          <li>写着「可以」的技能是可选的，其他技能都是强制生效。</li>
          <li>同时触发时的顺序：赛道格效果 → 当前玩家 → 其他玩家（顺时针）。</li>
          <li><span class="kw">超过</span>：移动开始时在对方后面、结束时在对方前面。停在同一格不算超过。</li>
          <li><span class="kw">瞬移</span>：直接放到新位置，不算移动，不会超过别人。</li>
          <li><span class="kw">摔倒</span>：跳过下一次主移动（不掷骰），但技能照样生效，也能被别的方式移动。</li>
          <li>运动员冲线或被淘汰后，技能失效。</li>
          <li>遇到无限循环（比如蹭蹭狗撞上巨婴），按顺序走完一遍就停止。</li>
        </ul></section>
        <section class="rule-sec"><h4>狂野荒原的特殊格</h4><ul>
          <li><span class="kw">箭头</span>：停上去就按数字前进/后退，算一次独立的移动。</li>
          <li><span class="kw">石头</span>：停上去就摔倒。</li>
          <li><span class="kw">星星</span>：停上去拿 1 分铜牌。</li>
        </ul></section>
        <section class="rule-sec"><h4>联机小贴士</h4><ul>
          <li>把房间码或邀请链接发给朋友；人不够可以加 AI。</li>
          <li>掉线或超时会自动托管，回来点一下「托管」即可接管。</li>
          <li>空格键可以直接掷骰。</li>
        </ul></section></div>`;
    }
    m.innerHTML = `<div class="modal-box card modal-${kind === 'gallery' || kind === 'tracks' ? kind : 'rules'}"><div class="modal-head"><h3>${title}</h3><div class="pager" id="mPager" hidden></div><button class="icon-btn" id="mClose" aria-label="关闭"><span class="ico">${icon('close')}</span></button></div><div class="modal-body">${body}</div></div>`;
    m.hidden = false;
    modalKind = kind;
    const close = () => { m.hidden = true; modalKind = null; };
    $('#mClose').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    fitModal(true);
  }
  let modalKind = null;
  function fitModal(fresh) {
    const m = $('#modal');
    if (m.hidden || !modalKind) return;
    if (fresh) for (const k of ['gallery', 'rules']) if (pagers[k]) pagers[k].anchor = 0;
    if (modalKind === 'gallery') paginate('gallery', $('.gallery', m), () => $$('.gallery .rcard', m), $('#mPager'));
    else if (modalKind === 'tracks') renderTrackGuide(fresh ? SCHEDULE[0] : tgKey);
    else paginate('rules', $('.rules', m), () => $$('.rules .rule-sec', m), $('#mPager'));
  }

  /* ---------- 地图图鉴 ---------- */
  // 特殊格说明对照 game/engine.js 的 afterStop：只看最后停在哪格（掷骰、技能移动、瞬移都算），路过不触发；
  // 赛道格效果先于所有技能结算；箭头调用 move() 算一次独立移动，后退最多退回起点；石头 trip()；星星 giveChip 铜牌 1 分。
  const TRACK_INTRO = {
    mild: '平平无奇的一圈跑道，没有任何机关，快慢全看运动员技能怎么搞事。',
    wild: '遍地箭头、石头和星星，落点决定命运，一步踩错就前功尽弃。',
  };
  let tgKey = 'mild';
  function renderTrackGuide(key, dir = 0) {
    const box = $('#tguide');
    if (!box) return;
    tgKey = key;
    const t = TRACKS[key];
    const lay = innerHeight > innerWidth * 1.05 && innerWidth < 900 ? 'tall' : 'wide';
    const races = SCHEDULE.map((k, i) => (k === key ? `<li><b>第 ${i + 1} 场</b><span class="tg-medal g">金 ${GOLD[i]}</span><span class="tg-medal s">银 ${SILVER[i]}</span></li>` : '')).join('');
    const at = (pred) => Object.entries(t.spaces).filter(([, sp]) => pred(sp)).map(([p, sp]) => ({ p: Number(p), sp }));
    const fwd = at((sp) => sp.type === 'arrow' && sp.n > 0), back = at((sp) => sp.type === 'arrow' && sp.n < 0);
    const rocks = at((sp) => sp.type === 'rock'), stars = at((sp) => sp.type === 'star');
    const cells = (arr, fmt = (p) => `${p}`) => arr.map(({ p, sp }) => fmt(p, sp)).join('、');
    const glyph = (type, n) => `<svg viewBox="-24 -24 48 48" aria-hidden="true">${spaceGlyph(type, n, 0, 0, 1)}</svg>`;
    const item = (g, name, where, text) => `<li>${g}<div><b>${name}<em>${where}</em></b><p>${text}</p></div></li>`;
    const legend = Object.keys(t.spaces).length ? `<ul class="tg-legend">
        ${fwd.length ? item(glyph('arrow', 2), '前进箭头', `第 ${cells(fwd, (p, sp) => `${p} 格 +${sp.n}`)}`, '停在这格立刻再前进对应格数，算一次独立移动，落到别的特殊格接着结算。') : ''}
        ${back.length ? item(glyph('arrow', -3), '后退箭头', `第 ${cells(back, (p, sp) => `${p} 格 −${Math.abs(sp.n)}`)}`, '停在这格立刻后退对应格数（最多退回起点），同样算一次独立移动。') : ''}
        ${rocks.length ? item(glyph('rock', 0), '石头', `第 ${cells(rocks)} 格`, '停上去就摔倒：下回合跳过主移动不掷骰，技能照常生效。') : ''}
        ${stars.length ? item(glyph('star', 0), '星星', `第 ${cells(stars)} 格`, '停上去立刻拿 1 分铜牌，每次停上都算。') : ''}
      </ul><p class="tg-note">只看最后停在哪格：掷骰、技能移动、瞬移落到这里都触发，路过不算；赛道格效果先于所有技能结算。</p>`
      : `<p class="tg-note tg-plain">没有特殊格。起点后 ${FIN - 1} 格赛道，第 ${FIN} 步冲线，比的就是技能和运气。</p>`;
    const [W, H] = GEO[lay].vb;
    box.innerHTML = `<div class="tg-tabs" role="tablist" aria-label="选择赛道">${Object.values(TRACKS).map((x) => `<button role="tab" data-tg="${x.key}" aria-selected="${x.key === key}" class="${x.key === key ? 'on' : ''}${x.key === 'wild' ? ' wild' : ''}">${icon(x.key === 'wild' ? 'rock' : 'flag')}${esc(x.name)}</button>`).join('')}</div>
      <div class="tg-page tg-${lay}${dir ? (dir > 0 ? ' pg-in-next' : ' pg-in-prev') : ''}" data-fit>
        <div class="tg-map"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t.name)}赛道缩略图">${trackSvgMarkup(key, lay)}</svg></div>
        <div class="tg-info">
          <p class="tg-intro"><b style="--c:${key === 'wild' ? 'var(--red)' : 'var(--green)'}">${esc(t.name)}</b>${esc(TRACK_INTRO[key] || '')}</p>
          <div class="tg-facts"><div class="tg-fact"><span>总格数</span><b>${FIN}</b><small>起点后 ${FIN - 1} 格，第 ${FIN} 步冲线</small></div><div class="tg-fact tg-races"><span>出场与奖牌</span><ul>${races}</ul></div></div>
          ${legend}
        </div>
      </div>`;
    fillIcons(box);
    box.querySelector('.tg-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tg]');
      if (!b || b.dataset.tg === tgKey) return;
      const keys = Object.keys(TRACKS);
      Sound.click();
      renderTrackGuide(b.dataset.tg, keys.indexOf(b.dataset.tg) > keys.indexOf(tgKey) ? 1 : -1);
    };
    const page = $('.tg-page', box);
    let sx = 0, sy = 0;
    page.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    page.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const keys = Object.keys(TRACKS), i = keys.indexOf(tgKey) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < keys.length) { Sound.click(); renderTrackGuide(keys[i], dx < 0 ? 1 : -1); }
    });
  }


  /* ================= 提示 & 彩纸 ================= */
  function toast(text, err) {
    const t = document.createElement('div');
    t.className = `toast ${err ? 'err' : ''}`;
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }
  const confettiState = { parts: [], raf: 0 };
  function confetti(n = 150, x, y) {
    if (fast || reducedMotion.matches) return;
    const cv = $('#confetti');
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const cols = ['#F27AB8', '#FFC53D', '#33B679', '#4D9DF7', '#F2553C', '#8B6CF0'];
    const ox = x ?? innerWidth / 2, oy = y ?? innerHeight * 0.35;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * (x != null ? 6 : 10);
      confettiState.parts.push({ x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (x != null ? 4 : 7), r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[i % 6], life: 0 });
    }
    if (confettiState.raf) return;
    const ctx = cv.getContext('2d');
    const tick = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const ps = confettiState.parts;
      for (const p of ps) {
        p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 170);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
        ctx.restore();
      }
      confettiState.parts = ps.filter((p) => p.life < 170 && p.y < innerHeight + 40);
      if (confettiState.parts.length) confettiState.raf = requestAnimationFrame(tick);
      else { confettiState.raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    };
    confettiState.raf = requestAnimationFrame(tick);
  }

  /* ================= 对局顶栏 ================= */
  function initGameBar() {
    $('#speedBtn').onclick = () => { Sound.click(); send({ type: 'speed' }); };
    $('#autoBtn').onclick = () => { Sound.click(); send({ type: 'auto', on: !autoFlags[you] }); };
    $('#soundBtn').onclick = () => { Sound.setMuted(!Sound.muted); renderTopButtons(); Sound.click(); };
    $('#leaveGame').onclick = () => {
      if ($('#leaveGame').dataset.armed) { navigate('leave', $('#leaveGame')); return; }
      $('#leaveGame').dataset.armed = '1';
      toast('再点一次离开对局');
      setTimeout(() => { delete $('#leaveGame').dataset.armed; }, 2500);
    };
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' && e.key !== 'Enter') return;
      if (!$('#modal').hidden || !$('#overlay').hidden || e.repeat || e.isComposing) return;
      if (document.activeElement?.matches('input, textarea, button, select, a, [contenteditable="true"]')) return;
      const b = $('#dock .roll-btn');
      if (b && !b.disabled) { e.preventDefault(); b.click(); }
    });
  }

  window.__hn = () => ({ pending: snap && snap.pending, phase: vs && vs.phase, playing, queue: queue.length, overlayKind, you, locked, mode: gameMode, gameId, navigationPending });

  /* ================= 启动 ================= */
  // 同源挂在桌游大厅的 /hunao/ 下时才显示「返回大厅」，指向大厅首页；18160 原入口在根路径，保持隐藏。
  function initHallBack() {
    const link = $('#hallBack');
    const m = location.pathname.match(/^(.*\/)hunao\/(?:index\.html)?$/);
    if (!link || !m) return;
    link.href = m[1];
    link.hidden = false;
  }
  function init() {
    fillIcons();
    initHallBack();
    initTips();
    const swirl = icon('swirl').replace(/currentColor/g, INK);
    if (swirl) document.documentElement.style.setProperty('--swirl', `url("data:image/svg+xml,${encodeURIComponent(swirl)}")`);
    initHome();
    initLobby();
    initGameBar();
    initEmotes();
    for (const b of $$('[data-open]')) b.addEventListener('click', () => { Sound.click(); openModal(b.dataset.open); });
    window.addEventListener('resize', () => { checkLayout(); renderStandings(); hideTip(); refitPagers(); fitRooms(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && queue.length > 1) fast = true; });
    showScreen(new URLSearchParams(location.search).get('room') ? 'lobby' : 'home');
    connect();
  }
  init();
})();
