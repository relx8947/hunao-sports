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
  // 二代/混合模式的运动员 id 也要查得到：R 与赛道表用全部模式的数据（RACERS 仍是一代 36 名）
  const RACERS_ALL = window.RACERS_ALL || RACERS;
  const R = Object.fromEntries(RACERS_ALL.map((r) => [r.id, r]));
  const TRACKS = window.TRACKS_ALL || window.TRACKS;
  const FIN = window.FINISH;
  const GOLD = window.GOLD, SILVER = window.SILVER, SCHEDULE = window.SCHEDULE;
  const EMOTES = ['哈哈哈', '离谱！', '好耶', '救命', '666', '等等我'];
  const INK = '#231F33';

  const art = (id) => (window.Art ? Art.racer(id) : `<svg viewBox="0 0 100 100"><circle cx="50" cy="55" r="32" fill="#ddd" stroke="${INK}" stroke-width="3"/></svg>`);
  const icon = (n) => (window.Art && Art.icon ? Art.icon(n) : '');
  const rcol = (id) => (window.Art && Art.color ? Art.color(id) : '#F4EDDF');
  const die = (v) => (window.Art && Art.die ? Art.die(v) : `<svg viewBox="0 0 100 100"><rect x="8" y="8" width="84" height="84" rx="18" fill="#fff" stroke="${INK}" stroke-width="5"/><text x="50" y="66" font-size="44" text-anchor="middle" font-weight="900">${v}</text></svg>`);
  // 骰子区 / 决策遮罩用原创矢量骰子（Skin.dice），缺 skin.js 时退回 art.js 的骰面
  const sdie = (v, st = 'idle') => (window.Skin && Skin.dice ? Skin.dice(v, st) : die(v));
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
    if (st.pre) st.pre(box); // 分页前的统一量尺（图鉴用它把所有卡拉到同一高度）
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
        st.raf = requestAnimationFrame(() => (st.refit || st.run)());
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
  // WP-D 自用的手绘图标（与 Art.icon 同一套笔触），避免改动 art.js
  const WPD_IC = {
    wifiOff: '<path d="M2.5 9a14 14 0 0 1 6-3.3M13.8 5.3A14 14 0 0 1 21.5 9"/><path d="M5.5 12.3a9.5 9.5 0 0 1 3.8-2.1M15.6 10.5a9.5 9.5 0 0 1 2.9 1.8"/><path d="M8.7 15.5a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19" r="1.1" fill="currentColor"/><path d="M3.5 3.5l17 17"/>',
    pencil: '<path d="M4.5 19.5l1-4.3L15.8 4.9a2.1 2.1 0 0 1 3 3L8.5 18.2z"/><path d="M13.8 7l3 3"/>',
    share: '<circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4"/>',
    alert: '<path d="M12 3.8l9 15.7H3z"/><path d="M12 10v4.3M12 17h.01"/>',
    retry: '<path d="M19.3 12.5a7.3 7.3 0 1 1-2.1-5.6"/><path d="M19.5 3.8v4.6h-4.6"/>',
    spin: '<path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" stroke-dasharray="3 3.2"/>',
  };
  const wpdIcon = (n) => `<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WPD_IC[n] || ''}</svg>`;
  // 提示条/toast 贴在顶栏（对局）或离开按钮（房间）下方，不挡住任何按钮
  function placeNotices() {
    const scr = document.body.dataset.screen;
    const anchor = scr === 'game' ? $('#game .topbar') : scr === 'lobby' ? $('#leaveLobby') : null;
    const top = anchor && anchor.offsetParent ? Math.max(0, Math.round(anchor.getBoundingClientRect().bottom)) : 0;
    const root = document.documentElement.style;
    root.setProperty('--wpd-top', `${top}px`);
    const box = $('#connectionStatus');
    root.setProperty('--wpd-cs-h', box && !box.hidden ? `${Math.round(box.offsetHeight) + 8}px` : '0px');
  }
  const conn = { ever: false, since: 0, retryAt: 0, tries: 0, tick: null, show: null, hide: null };
  function connBox() {
    const box = $('#connectionStatus');
    if (box && !box.dataset.wpd) {
      box.dataset.wpd = '1';
      box.innerHTML = `<span class="cs-ico"></span><span class="cs-text"><b class="cs-main"></b><small class="cs-sub"></small></span><button type="button" class="cs-retry" hidden>${wpdIcon('retry')}<span>立即重试</span></button>`;
      $('.cs-retry', box).addEventListener('click', retryNow);
    }
    return box;
  }
  function retryNow() {
    Sound.click();
    const s = ws;
    if (s && s.readyState !== WebSocket.OPEN) { ws = null; try { s.close(); } catch (e) { /* ignore */ } }
    reconnectDelay = 800;
    conn.retryAt = Date.now() + 6000;
    connect();
  }
  function paintConnection(box, kind, main, sub, retry) {
    box.dataset.kind = kind;
    const ico = $('.cs-ico', box);
    if (ico.dataset.k !== kind) { ico.dataset.k = kind; ico.innerHTML = kind === 'back' ? icon('check') : wpdIcon(kind === 'lost' ? 'wifiOff' : 'spin'); }
    const m = $('.cs-main', box), s = $('.cs-sub', box), b = $('.cs-retry', box);
    if (m.textContent !== main) m.textContent = main;
    if (s.textContent !== sub) s.textContent = sub;
    s.hidden = !sub;
    b.hidden = !retry;
  }
  function showConnection(box) {
    clearTimeout(conn.hide);
    if (box.hidden) { box.hidden = false; void box.offsetWidth; }
    box.classList.add('cs-on');
    placeNotices();
  }
  function hideConnection(box) {
    box.classList.remove('cs-on');
    clearTimeout(conn.hide);
    conn.hide = setTimeout(() => { if (!box.classList.contains('cs-on')) { box.hidden = true; placeNotices(); } }, 260);
  }
  function renderConnection() {
    const box = connBox();
    if (!box) return;
    const st = connection;
    clearTimeout(conn.show);
    if (st === 'ready') {
      conn.ever = true;
      clearInterval(conn.tick); conn.tick = null;
      if (conn.since) {
        conn.since = 0; conn.tries = 0;
        paintConnection(box, 'back', '已重新连上', document.body.dataset.screen === 'game' ? '画面已同步到最新局面' : '', false);
        showConnection(box);
        conn.hide = setTimeout(() => hideConnection(box), 1800);
      } else if (!box.hidden) hideConnection(box);
      return;
    }
    if (st === 'offline' && !conn.since) { conn.since = Date.now(); conn.retryAt = conn.since + 10000; }
    if (st === 'connecting' && conn.since) conn.tries++;
    let kind = 'wait', main, sub = '';
    if (!conn.since) main = st === 'syncing' ? '正在进入…' : '正在连接服务器…';
    else if (st === 'syncing') main = '连上了，正在同步最新局面…';
    else {
      kind = 'lost';
      const n = conn.tries ? `（第 ${conn.tries} 次）` : '…';
      main = conn.ever ? `网络断了，正在重连${n}` : `连不上服务器，正在重试${n}`;
      sub = conn.ever ? '恢复后会自动回到刚才的局面' : '检查一下网络，或者稍后再来';
    }
    paintConnection(box, kind, main, sub, kind === 'lost' && Date.now() >= conn.retryAt);
    if (conn.since && !conn.tick) {
      conn.tick = setInterval(() => {
        const b = $('.cs-retry', box);
        if (connection !== 'ready' && box.dataset.kind === 'lost' && b.hidden && Date.now() >= conn.retryAt) { b.hidden = false; placeNotices(); }
      }, 500);
    }
    // 首次连接通常 100ms 内完成，晚一点再出现，避免每次打开页面都闪一下
    if (!conn.since && !conn.ever) { if (box.hidden) conn.show = setTimeout(() => showConnection(box), 700); }
    else showConnection(box);
  }
  function setConnection(state) {
    connection = state;
    if (state !== 'ready') { roomsFresh = false; roomsLoading = false; }
    document.body.dataset.connection = state;
    renderConnection();
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
      if (!quiet) { denyCue(); toast('尚未连接，请等重连完成后重新操作', true); }
      return false;
    }
    try { ws.send(JSON.stringify(m)); return true; } catch (e) {
      if (!quiet) { denyCue(); toast('发送失败，请重连后重试', true); }
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
      case 'error': {
        if (msg.for === 'act' && msg.gameId != null && msg.gameId !== gameId) break;
        setDeadline(msg);
        const raw = typeof msg.msg === 'string' ? msg.msg : '';
        if (msg.for === 'hello') {
          toast('登录信息过期了，正在换个新身份重连', true);
          me = { name: typeof me.name === 'string' ? me.name : '' };
          store.set('hn_me', me);
          if (ws) ws.close();
          break;
        }
        if (msg.for === 'join') {
          // 失效邀请链接 / 错码 / 目录里刚关掉的房间：回首页，并在对应位置留下行内说明和下一步
          const via = inviteRoom ? 'link' : joinTry && joinTry.via || 'input';
          const code = (inviteRoom || joinTry && joinTry.code || '').toUpperCase();
          joinTry = null;
          returnHome();
          showJoinProblem(code, raw, via);
        } else if (msg.for === 'setName') {
          lobbyEdit = true;
          if (room && room.status === 'lobby') renderLobby();
          toast(raw.includes('名字') ? '这个名字用不了，换一个试试（最多 12 个字）' : friendlyError(raw), true);
        } else toast(friendlyError(raw), true);
        denyCue();
        if (!msg.for || msg.for === 'act') { clearSubmission(); hideOverlay(true); unlockPrompt(); }
        if (!msg.for || msg.for === navigationPending) { clearNavigation(); renderPrompt(); }
        if (msg.retryIn > 0 && msg.for === 'lobby') toast('最终动画还没结束，请稍后再试');
        break;
      }
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
    // 只在变化时改地址栏；失效链接回首页时清掉 ?room=，刷新不会再撞一次
    const u = new URL(location.href);
    if (code) u.searchParams.set('room', code); else u.searchParams.delete('room');
    if (u.href !== location.href) history.replaceState(history.state, '', u.toString());
  }

  /* ---------- WP-D：异常文案 ---------- */
  let joinTry = null; // 最近一次手动加入：{ code, via: 'input' | 'list' }
  let homeNotice = null; // 首页公开房间上方的行内说明
  let lobbyEdit = false; // 房间里正在改名
  const ERR_TEXT = [
    [/请先连接|连接已关闭|尚未连接/, '还没连上服务器，稍等一下再试'],
    [/只有房主/, '只有房主能这样做'],
    [/需要 3–6 名选手/, '至少要 3 名选手才能开赛，点「加一个 AI」凑人数'],
    [/最多 6 人/, '房间最多 6 名选手'],
    [/已过期/, '这一步已经过时了，画面已同步到最新局面'],
    [/当前没有待决策项/, '现在还没轮到你，等一下'],
    [/结算动画还没结束/, '结算动画还没播完，稍等一下'],
    [/你是观众/, '观战时不能操作选手'],
    [/服务已关闭/, '服务器正在维护，稍后再来'],
  ];
  function friendlyError(raw) {
    for (const [re, text] of ERR_TEXT) if (re.test(raw)) return text;
    return raw || '出了点小问题，再试一次';
  }
  function joinProblem(code, raw, via) {
    const label = code ? `房间 ${code} ` : '这个房间';
    if (/格式/.test(raw)) return { title: '房间码是 4 位字母或数字', next: '例如 S9D8，再输一次试试' };
    if (/不存在/.test(raw)) {
      if (via === 'link') return { title: `邀请链接里的${label}已经解散了`, next: '让朋友重新发一次链接，或者加入下面的公开房间、自己开一局' };
      if (via === 'list') return { title: `${label}刚刚关闭了`, next: '列表已经刷新，换一个房间试试' };
      return { title: `${label}不存在或已解散`, next: '核对一下房间码，或者加入下面的公开房间' };
    }
    if (/开始|开赛/.test(raw)) return { title: `${label}已经开赛了`, next: '等这一局结束再加入，或者先和 AI 开一局' };
    if (/满/.test(raw)) return { title: `${label}已经满员`, next: '请房主移除一个 AI 空出位置，或者自己开一局' };
    return { title: raw || `进不去${label}`, next: '刷新一下公开房间，或者自己开一局' };
  }
  function showJoinProblem(code, raw, via) {
    const p = joinProblem(code, raw, via);
    if (via === 'list') { toast(`${p.title}，${p.next}`, true); return; } // 目录随后自动刷新
    showCodeError(p, via);
  }
  // 错码 / 失效链接的行内说明：在「加入」那一行正下方，占掉分隔线的位置；改房间码或点叉收起
  function showCodeError(p, via = 'input') {
    const input = $('#codeInput'), box = $('#codeError');
    if (!input || !box) return;
    homeNotice = via === 'link' ? p : null;
    if (via === 'input') {
      input.setAttribute('aria-invalid', 'true');
      input.classList.remove('wpd-shake'); void input.offsetWidth; input.classList.add('wpd-shake');
    } else input.removeAttribute('aria-invalid');
    box.dataset.via = via;
    box.innerHTML = `<span class="ce-ico">${wpdIcon('alert')}</span><span class="ce-text"><b>${esc(p.title)}</b><small>${esc(p.next)}</small></span><button type="button" class="ce-close" aria-label="知道了">${icon('close')}</button>`;
    box.hidden = false;
    $('.home-card')?.classList.add('wpd-err');
    renderRoomDirectory();
  }
  function clearCodeError() {
    const input = $('#codeInput'), box = $('#codeError');
    if (!box || box.hidden) return;
    input?.removeAttribute('aria-invalid');
    input?.classList.remove('wpd-shake');
    box.hidden = true; box.innerHTML = '';
    homeNotice = null;
    $('.home-card')?.classList.remove('wpd-err');
    renderRoomDirectory();
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
  // 背景音乐跟随界面与阶段：music.js 每 60ms 读一次，场景变了自己交叉淡入淡出；heat 是领跑者离终点的进度
  function musicScene() {
    if (document.body.dataset.screen !== 'game' || !vs) return { scene: 'home' };
    if (vs.phase === 'over') return { scene: 'over' };
    if (vs.phase !== 'race') return { scene: 'draft' };
    return { scene: 'race', heat: Math.max(0, ...(vs.racers || []).map((r) => (r.finished ? FIN : r.pos || 0))) / FIN };
  }
  function showScreen(id) {
    // 只在真正换界面时收起头像弹层；对局里每条消息都会再调一次 showScreen('game')，不能因此把它关掉
    if (document.body.dataset.screen !== id && typeof closePlayerPop === 'function') closePlayerPop();
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
      code: r.code, mode: r.mode, status: r.status, edition: editionOf(r.edition),
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
      // 刚打开失效链接时，状态行顺带指一条出路（不额外占高度）
      : roomRows.length ? `当前 ${roomRows.length} 个公开房间 · ${homeNotice ? '点「加入」就能直接进' : '实时更新'}`
      : homeNotice ? '暂无在线房间，可以点「创建房间」自己开一局' : '暂无在线房间，创建一个邀请大家吧';
    status.classList.toggle('wpd-hint', !!homeNotice && online && roomsFresh);
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
          <div class="room-list-title"><span class="room-list-host" title="${esc(r.hostName)}">${esc(r.hostName)}</span><span class="room-list-code">${esc(r.code)}</span>${edBadge(r.edition, 'room-list-ed')}</div>
          <p class="room-list-state"><span class="room-state ${esc(r.status)}">${watch ? 'AI 观战 · ' : ''}${esc(state)}</span></p>
          <p class="room-list-meta">${esc(people)}</p><p class="room-list-meta">${esc(presence)}</p>
        </div>
        <div class="room-list-action"><button class="btn small${watch ? '' : ' primary'}" data-room-code="${esc(r.code)}" aria-label="${esc(`${label}：${r.hostName}，房间 ${r.code}，${edName(r.edition)}模式`)}"${!usable || !r.canJoin ? ' disabled' : ''}>${esc(label)}</button><span class="room-list-note">${esc(note)}</span></div>
      </li>`;
    }).join('');
    fitRooms();
  }
  // 首页一屏：公开房间至少要放下一间，放不下就逐级收起装饰（徽章、游行队伍、标语、缩小标志）
  function fitRooms() {
    const home = $('#home'), inner = $('.home-inner', home), list = $('#roomList'), dir = $('.room-directory', home);
    if (home.hidden) return;
    for (let level = 0; level <= 4; level++) {
      home.dataset.tight = level;
      paginate('rooms', list, () => $$('#roomList .room-list-item'), $('#roomPager'));
      // 房间卡片本身也要放得下（列表为空时提示文字在列表外，卡片被压扁会盖住它）
      if (list.scrollHeight <= list.clientHeight + 1 && inner.scrollHeight <= inner.clientHeight + 1 && (!dir || dir.scrollHeight <= dir.clientHeight + 1)) break;
    }
    // 房间列表被挤压时要连同首页收紧级别一起重算，单独重排分页会和收紧级别打架
    pagers.rooms.refit = fitRooms;
  }

  /* ---------- 模式：一代 / 二代 / 混合 ---------- */
  // 首页选的模式随 create/quick/watch 发给服务端；房间、目录、对局都以服务端下发的 edition 为准。
  const EDITIONS = window.EDITIONS || { v1: { key: 'v1', name: '一代', desc: '', schedule: SCHEDULE, pools: [1], twists: false } };
  const DEFAULT_EDITION = EDITIONS[window.DEFAULT_EDITION] ? window.DEFAULT_EDITION : Object.keys(EDITIONS)[0];
  // 分段选择器下面那一句说明（比服务端 desc 短，手机上两行内放得下）
  const EDITION_HINT = { v1: '经典 36 名运动员 · 温和与狂野赛道', v2: '续作 36 名新运动员 · 新赛道 + 变数卡', mix: '72 名运动员同池选秀 · 四条赛道各一场' };
  const TRACK_SHORT = { mild: '温和', wild: '狂野', twisty: '扭扭', whirly: '漩涡' };
  function validEdition(e) { return typeof e === 'string' && Object.prototype.hasOwnProperty.call(EDITIONS, e); }
  function editionOf(e) { return validEdition(e) ? e : DEFAULT_EDITION; }
  function edName(e) { return EDITIONS[editionOf(e)].name; }
  function edHint(e) { const k = editionOf(e); return EDITION_HINT[k] || EDITIONS[k].desc || ''; }
  function edBadge(e, cls = '') { const k = editionOf(e); return `<span class="ed-badge ed-${k}${cls ? ` ${cls}` : ''}" title="${esc(`${edName(k)}模式`)}">${esc(edName(k))}</span>`; }
  let homeEdition = editionOf(store.get('hn_edition', DEFAULT_EDITION));
  // 当前语境的模式：首页看自己的选择；房间/对局看服务端（对局快照优先）
  function curEdition() {
    if (document.body.dataset.screen === 'home' || (!room && !snap)) return homeEdition;
    if (snap && validEdition(snap.edition)) return snap.edition;
    if (room && validEdition(room.edition)) return room.edition;
    return homeEdition;
  }
  // 本局四场的赛道顺序：对局快照带 schedule，没有就按模式表
  function raceSchedule() {
    const s = (vs && vs.schedule) || (snap && snap.schedule);
    if (Array.isArray(s) && s.length && s.every((k) => TRACKS[k])) return s;
    return EDITIONS[curEdition()].schedule || SCHEDULE;
  }
  function trackShort(k) { return TRACK_SHORT[k] || (TRACKS[k] ? TRACKS[k].name.slice(0, 2) : ''); }
  // 三选一分段按钮（首页、房间共用）：点按、方向键切换；disabled 时只读显示当前模式
  function syncEditionSeg(seg, ed, { disabled = false } = {}) {
    if (!seg) return;
    seg.toggleAttribute('aria-disabled', disabled);
    seg.classList.toggle('readonly', disabled);
    for (const b of $$('button[data-ed]', seg)) {
      const on = b.dataset.ed === ed;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.disabled = disabled && !on;
    }
  }
  function bindEditionSeg(seg, pick) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ed]');
      if (!b || b.disabled || seg.classList.contains('readonly') || !validEdition(b.dataset.ed)) return;
      pick(b.dataset.ed, b);
    });
    seg.addEventListener('keydown', (e) => {
      const b = e.target.closest('button[data-ed]');
      if (!b || seg.classList.contains('readonly') || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const buttons = $$('button[data-ed]', seg), i = buttons.indexOf(b);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
      pick(buttons[next].dataset.ed, buttons[next]);
      buttons[next].focus();
    });
  }
  function setHomeEdition(ed) {
    homeEdition = editionOf(ed);
    store.set('hn_edition', homeEdition);
    syncEditionSeg($('#editionSeg'), homeEdition);
    const hint = $('#editionHint');
    if (hint) { hint.textContent = edHint(homeEdition); hint.title = EDITIONS[homeEdition].desc || ''; hint.dataset.ed = homeEdition; }
    $('#modePick')?.setAttribute('data-ed', homeEdition);
  }
  // 房间里的模式：房主可切换（开局后、观战房、断线时锁定），其他人只读
  function renderLobbyEdition() {
    if (!room) return;
    const ed = editionOf(room.edition);
    const host = room.host === me.id;
    const canSwitch = host && room.status === 'lobby' && (room.mode || 'play') === 'play' && connection === 'ready';
    const seg = $('#lobbyEdition');
    syncEditionSeg(seg, ed, { disabled: !canSwitch });
    if (seg) seg.title = canSwitch ? '点击切换本房间的模式' : host ? '开局后不能切换模式' : '模式由房主选择';
    $('#lobbyMode').dataset.ed = ed;
    const hint = $('#lobbyEditionHint');
    const text = `${host ? '' : '房主已选 · '}${edHint(ed)}`;
    if (hint && hint.textContent !== text) { hint.textContent = text; hint.title = `${edName(ed)}：${EDITIONS[ed].desc || edHint(ed)}`; }
  }

  /* ---------- 首页 ---------- */
  function initHome() {
    const ids = RACERS.map((r) => r.id);
    const items = ids.concat(ids).map((id, k) => `<div class="pr" style="--k:${k}">${art(id)}</div>`).join('');
    $('#parade').innerHTML = `<div class="parade-track">${items}</div>`;
    $('#nameInput').value = me.name || '';
    $('#nameInput').addEventListener('change', () => {
      const name = $('#nameInput').value.trim();
      if (name) { me.name = name; store.set('hn_me', me); store.set('hn_named', true); send({ type: 'setName', name }); }
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
      if (name && name !== me.name) { me.name = name; store.set('hn_me', me); store.set('hn_named', true); send({ type: 'setName', name }); }
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
    setHomeEdition(homeEdition);
    bindEditionSeg($('#editionSeg'), (ed) => { if (ed !== homeEdition) { setHomeEdition(ed); Sound.click(); } });
    $('#watchBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'watch', ai: watchN, edition: homeEdition }); };
    $('#quickBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'quick', ai: aiN, edition: homeEdition }); };
    $('#createBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'create', edition: homeEdition }); };
    const join = () => {
      const code = $('#codeInput').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) { denyCue(); showCodeError(joinProblem(code, '格式', 'input')); return; }
      Sound.click(); ensureName();
      if (send({ type: 'join', code })) joinTry = { code, via: 'input' };
    };
    $('#joinBtn').onclick = join;
    $('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    // 改了房间码就收起错误提示
    $('#codeInput').addEventListener('input', clearCodeError);
    $('#refreshRooms').onclick = () => { Sound.click(); requestRooms(); };
    $('#codeError').addEventListener('click', (e) => { if (e.target.closest('.ce-close')) { Sound.click(); clearCodeError(); } });
    $('#roomList').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-room-code]');
      if (!b || b.disabled || $('#home').hidden || connection !== 'ready' || !roomsFresh) return;
      const code = b.dataset.roomCode;
      if (!validRoomCode(code) || !roomRows.some(r => r.code === code && r.canJoin)) return;
      Sound.click(); ensureName();
      if (send({ type: 'join', code })) joinTry = { code, via: 'list' };
    });
    renderRoomDirectory();
    // 提示条跟着顶栏/离开按钮的位置走（顶栏换行、横竖屏切换都会变）
    window.addEventListener('resize', placeNotices);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => placeNotices());
      for (const el of [$('#game .topbar'), $('#leaveLobby')]) if (el) ro.observe(el);
    }
  }

  /* ---------- 房间 ---------- */
  function renderLobby() {
    if (!room) return;
    $('#roomCode').textContent = room.code;
    $('#inviteLinkInput').value = `${location.origin}${location.pathname}?room=${room.code}`;
    const host = room.host === me.id;
    // 进了房间，首页的错误提示就过时了
    clearCodeError();
    const unnamed = !isNamed();
    const cards = room.seats.map((s, i) => {
      const c = PCOL[i % 6];
      const mine = !s.ai && s.pid === me.id;
      const inner = s.ai ? `<span class="ico" data-icon="robot"></span>` : esc((s.name || '?').slice(0, 1));
      const kick = host && s.ai ? `<button class="kick" data-kick="${i}" title="移除" aria-label="移除 ${esc(s.name)}">${icon('close')}</button>` : '';
      const tag = s.ai ? 'AI 选手' : `<span class="dot ${s.online ? '' : 'off'}"></span>${s.pid === room.host ? '房主' : '玩家'}${mine ? ' · 你' : ''}`;
      if (mine && (lobbyEdit || unnamed)) {
        // 行内起名：受邀者第一次进来是随机名，直接在自己的座位上改
        return `<div class="seat wpd-me wpd-editing${unnamed ? ' wpd-unnamed' : ''}" style="--c:${c}"><div class="ava">${inner}</div>`
          + `<label class="wpd-name"><input id="lobbyName" maxlength="12" value="${unnamed ? '' : esc(s.name)}" placeholder="${esc(s.name)}" aria-label="你的名字" autocomplete="nickname" enterkeyhint="done" spellcheck="false">${wpdIcon('pencil')}</label>`
          + `<div class="tag wpd-name-tag">${unnamed ? '点上面起个名字' : '回车保存'}</div></div>`;
      }
      // 自己的名字本身就是改名按钮（带一支小铅笔），点一下变回输入框
      const nm = mine ? `<button type="button" class="nm wpd-nm" data-rename aria-label="改名，现在叫 ${esc(s.name)}"><span>${esc(s.name)}</span>${wpdIcon('pencil')}</button>` : `<div class="nm">${esc(s.name)}</div>`;
      return `<div class="seat${mine ? ' wpd-me' : ''}" style="--c:${c}">${kick}<div class="ava">${inner}</div>${nm}<div class="tag">${tag}</div></div>`;
    });
    for (let i = room.seats.length; i < 6; i++) cards.push(`<div class="seat empty">${i < 3 ? '至少 3 人' : '空位'}</div>`);
    // 逐个座位比对：只重画变了的那张，正在输入名字的座位不打断，新来的人才有弹入动画
    const box = $('#seats');
    const kids = [...box.children];
    const typing = document.activeElement && document.activeElement.id === 'lobbyName';
    cards.forEach((html, i) => {
      const old = kids[i];
      if (old && old.__html === html) return;
      if (old && typing && old.contains(document.activeElement)) return;
      const t = document.createElement('template');
      t.innerHTML = html;
      const el = t.content.firstElementChild;
      el.__html = html;
      if (old) old.replaceWith(el); else box.appendChild(el);
    });
    for (const extra of kids.slice(cards.length)) extra.remove();
    fillIcons(box);
    $('#addAI').hidden = !host;
    $('#addAI').disabled = room.seats.length >= 6 || connection !== 'ready';
    $('#startBtn').hidden = !host;
    $('#startBtn').disabled = room.seats.length < 3 || connection !== 'ready';
    const tip = unnamed
      ? '先在自己的座位上起个名字，朋友才认得出你'
      : host ? (room.seats.length < 3 ? '把房间码发给朋友，人不够可以加 AI。3-6 人开赛。' : '人齐了就开始吧！')
      : '等待房主开始比赛…';
    if ($('#lobbyTip').textContent !== tip) $('#lobbyTip').textContent = tip;
    renderInviteButton();
    renderLobbyEdition();
  }
  const RANDOM_NAME = /^选手\d{3}$/;
  // 名字是否由用户自己起过：本机标记过，或者不是服务端发的随机名
  const isNamed = () => store.get('hn_named', false) === true || (!!me.name && !RANDOM_NAME.test(me.name));
  const canShare = () => typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
  function renderInviteButton() {
    const label = $('#copyLinkLabel'), b = $('#copyLink');
    if (!label || !b || b.dataset.done) return;
    const share = canShare();
    const text = share ? '邀请朋友' : '复制邀请链接';
    if (label.textContent !== text) {
      label.textContent = text;
      const ico = $('.ico', b);
      if (ico) ico.innerHTML = share ? wpdIcon('share') : icon('link');
    }
  }
  function commitLobbyName(input) {
    const name = input.value.trim().slice(0, 12);
    const seat = room ? room.seats.findIndex((s) => !s.ai && s.pid === me.id) : -1;
    if (!name) { if (isNamed()) { lobbyEdit = false; renderLobby(); } return; }
    lobbyEdit = false;
    store.set('hn_named', true);
    if (name !== me.name || seat < 0 || room.seats[seat].name !== name) {
      if (!send({ type: 'setName', name })) { lobbyEdit = true; return; }
      me.name = name; store.set('hn_me', me);
      if (seat >= 0) room.seats[seat] = { ...room.seats[seat], name }; // 先在本地显示，服务端广播会确认
      toast(`好的，大家会看到你叫「${name}」`);
    }
    $('#nameInput').value = name;
    Sound.click();
    input.blur();
    renderLobby();
  }
  function initLobby() {
    const seats = $('#seats');
    seats.addEventListener('click', (e) => {
      const r = e.target.closest('[data-rename]');
      if (r) {
        Sound.click(); lobbyEdit = true; renderLobby();
        const input = $('#lobbyName');
        if (input) { input.focus(); input.select(); }
        return;
      }
      const b = e.target.closest('[data-kick]'); if (!b) return;
      Sound.click(); send({ type: 'removeAI', seat: Number(b.dataset.kick) });
    });
    // 行内改名：回车或离开输入框保存，Esc 取消
    seats.addEventListener('keydown', (e) => {
      if (e.target.id !== 'lobbyName' || e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); commitLobbyName(e.target); }
      if (e.key === 'Escape' && isNamed()) { lobbyEdit = false; e.target.blur(); renderLobby(); }
    });
    seats.addEventListener('focusout', (e) => {
      if (e.target.id !== 'lobbyName') return;
      const input = e.target;
      setTimeout(() => { if (input.isConnected && document.activeElement !== input) commitLobbyName(input); }, 0);
    });
    bindEditionSeg($('#lobbyEdition'), (ed) => {
      if (!room || room.host !== me.id || room.status !== 'lobby' || ed === editionOf(room.edition)) return;
      Sound.click();
      if (send({ type: 'edition', edition: ed })) setHomeEdition(ed); // 房主的选择也记成下次首页默认；房间以服务端广播为准
    });
    $('#addAI').onclick = () => { Sound.click(); send({ type: 'addAI' }); };
    $('#startBtn').onclick = () => { Sound.click(); send({ type: 'start' }); };
    $('#leaveLobby').onclick = () => { Sound.click(); navigate('leave', $('#leaveLobby')); };
    const flashInvite = (text) => {
      const b = $('#copyLink'), label = $('#copyLinkLabel');
      if (!b || !label) return;
      b.dataset.done = '1'; b.classList.add('wpd-done');
      label.textContent = text;
      const ico = $('.ico', b); if (ico) ico.innerHTML = icon('check');
      clearTimeout(flashInvite.t);
      flashInvite.t = setTimeout(() => { delete b.dataset.done; b.classList.remove('wpd-done'); label.textContent = ''; renderInviteButton(); }, 1800);
    };
    $('#copyLink').onclick = async () => {
      if (!room) return;
      const link = `${location.origin}${location.pathname}?room=${room.code}`;
      Sound.click();
      // 手机优先调起系统分享（微信、飞书等）；用户取消就什么都不做，其他失败再退回复制
      if (canShare()) {
        try {
          await navigator.share({ title: '胡闹运动会', text: `来胡闹运动会，房间码 ${room.code}`, url: link });
          flashInvite('已发出邀请');
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        flashInvite('已复制');
        toast(`邀请链接已复制，发给朋友就能进房间 ${room.code}`);
      } catch (e) {
        $('#inviteLinkBox').hidden = false;
        const input = $('#inviteLinkInput');
        input.value = link;
        input.focus();
        input.select();
        toast('链接已选中，长按或按 Ctrl/Cmd+C 复制');
      }
    };
    $('#inviteLinkInput').onclick = (e) => e.target.select();
  }

  /* ================= 棋盘几何 ================= */
  // 横屏：上排起点 + 1..12，右侧 13、14，下排 15..29 从右往左，终点在左下；内场加高放骰子和行动卡
  function wideRect(p) {
    // 实物版图：下排 15 格铺满底边，上排「起点箱」占 3 格宽 + 12 格，右侧 13、14 夹在两个弯道格之间
    if (p <= 0) return { x: 12, y: 20, w: 184, h: 90 };
    if (p <= 12) return { x: 199.5 + (p - 1) * 62.5, y: 20, w: 59, h: 90 };
    if (p === 13) return { x: 887, y: 114, w: 59, h: 119 };
    if (p === 14) return { x: 887, y: 237, w: 59, h: 119 };
    if (p <= 29) return { x: 887 - (p - 15) * 62.5, y: 360, w: 59, h: 90 };
    return { x: 18, y: 322, w: 128, h: 26 };
  }
  // 竖屏（照 APK）：7 列 × 7 行的大方格，竖着蛇形走——起点在左上，第 0 列往下（1-6），下沿横走 7-8，
  // 第 2 列往上（9-14），顶沿 15-16，第 4 列往下（17-22），下沿 23-24，第 6 列往上（25-29），右上角是终点旗；
  // 赛道只占上半，下半整块留给行动卡、骰子和领奖台
  const TALL_COL = (p) => p <= 0 ? [0, 0] : p <= 6 ? [0, p] : p <= 8 ? [p - 6, 6] : p <= 14 ? [2, 14 - p] : p <= 16 ? [p - 12, 0] : p <= 22 ? [4, p - 16] : p <= 24 ? [p - 18, 6] : p <= 29 ? [6, 30 - p] : [6, 0];
  function tallRect(p) {
    const [c, r] = TALL_COL(p);
    return { x: 8 + c * 64, y: 6 + r * 56, w: 60, h: 52 };
  }
  const GEO = {
    wide: {
      vb: [964, 470], rect: wideRect, bed: { x: 0, y: 8, w: 964, h: 454, rx: 50 },
      inf: { x: 164, y: 116, w: 717, h: 238 }, pod: { x: 12, y: 116, w: 140, h: 238 },
      center: { x: 170, y: 122, w: 705, h: 226 },
      arrows: [[270, 128, 0], [520, 128, 0], [770, 128, 0], [770, 342, 180], [520, 342, 180], [270, 342, 180]],
    },
    tall: {
      vb: [460, 622], rect: tallRect, bed: { x: 0, y: 0, w: 460, h: 622, rx: 28, fill: '#FFF8E8' },
      inf: { x: 8, y: 404, w: 444, h: 210 }, pod: { x: 316, y: 402, w: 130, h: 84 },
      center: { x: 14, y: 409, w: 432, h: 199 },
      arrows: [], thumb: [460, 400],
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
    if (type === 'arrow') return `<g transform="translate(${cx} ${cy}) scale(${k})">${window.BoardArt.arrowShape(n, 0)}</g>`;
    return '';
  }

  // 赛道 SVG：对局棋盘和地图图鉴共用同一套画法（wide = 电脑/横屏，tall = 手机竖屏）
  // 按实物版图复原：黑底白边的体育场赛道、五色循环格、里程红格、紫框特殊格、领奖台拱门、中央场景
  const CORNER_R = 40;
  const WIDE_CORNERS = { 0: [CORNER_R, 7, 7, 7], 12: [7, CORNER_R, 7, 7], 15: [7, 7, CORNER_R, 7], 29: [7, 7, 7, CORNER_R] };
  function trackSvgMarkup(trackKey, lay, thumb) {
    const BA = window.BoardArt;
    const wide = lay === 'wide';
    // 手机竖屏的缩略图只取蛇形赛道本身（不带下半部的内场和领奖台）
    const crop = thumb && lay === 'tall';
    const G = crop ? { ...GEO[lay], bed: { ...GEO[lay].bed, h: GEO[lay].thumb[1] } } : GEO[lay];
    const { bed, inf } = G;
    let s = `<defs><pattern id="chk" width="12.5" height="12.5" patternUnits="userSpaceOnUse"><rect width="12.5" height="12.5" fill="#fff"/><rect width="6.25" height="6.25" fill="${INK}"/><rect x="6.25" y="6.25" width="6.25" height="6.25" fill="${INK}"/></pattern>`;
    if (wide) for (const [p, r] of Object.entries(WIDE_CORNERS)) { const c = G.rect(Number(p)); s += `<clipPath id="cc${p}"><path d="${BA.rrect(c.x, c.y, c.w, c.h, r)}"/></clipPath>`; }
    s += '</defs>';
    // 注意：底板和内场必须是前两个 <rect>（二代赛道层按 nth-of-type 改内场颜色）
    s += `<rect x="${bed.x}" y="${bed.y}" width="${bed.w}" height="${bed.h}" rx="${bed.rx}" fill="${bed.fill || '#0D0B14'}"${wide ? '' : ` stroke="${INK}" stroke-width="3"`}/>`;
    if (!crop) s += `<rect x="${inf.x}" y="${inf.y}" width="${inf.w}" height="${inf.h}" rx="22" fill="#0D0B14" stroke="#fff" stroke-width="3"/>`;
    // 外圈白线
    if (wide) s += `<path d="${BA.rrect(5, 13, 954, 444, [46, 46, 46, 46])}" fill="none" stroke="#fff" stroke-width="3"/>`;
    // 行进方向箭头（内场边缘的小白箭头）
    for (const [x, y, rot] of G.arrows) s += `<path d="M-5 -5 L3 0 L-5 5" transform="translate(${x} ${y}) rotate(${rot})" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".4"/>`;
    if (wide && !crop) s += BA.scene(trackKey, inf);
    if (wide && !crop) s += BA.arch(G.pod);
    for (let p = 0; p < FIN; p++) {
      const r = G.rect(p);
      const sp = TRACKS[trackKey].spaces[p];
      const fill = p === 0 ? (wide ? BA.CELL[3] : '#55505F') : BA.cellColor(p);
      const clip = wide && WIDE_CORNERS[p] ? ` clip-path="url(#cc${p})"` : '';
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      s += `<g class="cell" data-p="${p}"><rect x="${f1(r.x)}" y="${f1(r.y)}" width="${r.w}" height="${r.h}" rx="${wide ? 7 : 7}" fill="${fill}"${wide ? '' : ` stroke="${INK}" stroke-width="2.6"`}${clip}/>`;
      if (p === 0) {
        s += wide
          ? `<text x="${f1(cx)}" y="${f1(r.y + 31)}" font-size="27" font-weight="900" text-anchor="middle" fill="#F4432A" stroke="${INK}" stroke-width="5" paint-order="stroke" font-style="italic" letter-spacing="1">START</text>`
          : `<text x="${f1(cx)}" y="${f1(cy + 6)}" font-size="17" font-weight="900" text-anchor="middle" fill="#fff" opacity=".85" letter-spacing="2">起点</text>`;
      } else if (sp && (sp.type === 'star' || sp.type === 'rock' || sp.type === 'arrow')) {
        // 箭头沿赛道行进方向画：前进箭头指向下一格，后退箭头反向
        const nx = G.rect(p + 1), ang = Math.atan2(nx.y + nx.h / 2 - cy, nx.x + nx.w / 2 - cx) * 180 / Math.PI;
        s += BA.tile(sp.type, sp.n, ang, cx, cy, Math.min(r.w, r.h) - 10);
      } else if (p % 5 === 0 && !(sp && sp.type === 'whirl')) {
        // 竖屏照 APK：里程数字缩在格子右上角；横屏是居中大字
        s += wide
          ? `<text x="${f1(cx)}" y="${f1(cy + 11)}" font-size="32" font-weight="900" text-anchor="middle" fill="${BA.MILE_INK[p]}">${p}</text>`
          : `<text x="${f1(r.x + r.w - 6)}" y="${f1(r.y + 19)}" font-size="18" font-weight="900" text-anchor="end" fill="${INK}" opacity=".78">${p}</text>`;
      } else {
        // 每格角落淡淡的编号，方便数位置
        s += wide
          ? `<text x="${f1(cx)}" y="${f1(r.y + r.h - 7)}" font-size="11" font-weight="800" text-anchor="middle" fill="${INK}" opacity=".38">${p}</text>`
          : `<text x="${f1(r.x + r.w - 6)}" y="${f1(r.y + r.h - 6)}" font-size="11" font-weight="800" text-anchor="end" fill="${INK}" opacity=".34">${p}</text>`;
      }
      s += '</g>';
    }
    // 终点：横屏是领奖台拱门底边的方格旗；竖屏是最下面一条棋盘格带
    const f0 = G.rect(FIN);
    if (wide) {
      s += `<g class="cell" data-p="${FIN}"><rect x="${f0.x}" y="${f0.y}" width="${f0.w}" height="${f0.h}" rx="4" fill="url(#chk)"/>`;
      s += `<rect x="${f1(f0.x + f0.w / 2 - 32)}" y="${f1(f0.y + f0.h / 2 - 8)}" width="64" height="16" rx="5.3" fill="${INK}"/><text x="${f1(f0.x + f0.w / 2)}" y="${f1(f0.y + f0.h / 2 + 4)}" font-size="11" font-weight="900" text-anchor="middle" fill="#fff" letter-spacing="2">终点</text></g>`;
    } else {
      // 竖屏：右上角米色格子里立一面方格旗（跟 APK 一样）
      const fx = f0.x + f0.w / 2 - 8, fy = f0.y + 8;
      s += `<g class="cell" data-p="${FIN}"><rect x="${f0.x}" y="${f0.y}" width="${f0.w}" height="${f0.h}" rx="7" fill="#FFFDF4" stroke="${INK}" stroke-width="2.6"/>`
        + `<path d="M${f1(fx)} ${f1(f0.y + f0.h - 9)} V${f1(fy)}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`
        + `<g transform="translate(${f1(fx + 1.5)} ${f1(fy)})"><rect width="26" height="18" fill="#fff" stroke="${INK}" stroke-width="2"/><path d="M0 0h6.5v6h-6.5zM13 0h6.5v6H13zM6.5 6H13v6H6.5zM19.5 6H26v6h-6.5zM0 12h6.5v6H0zM13 12h6.5v6H13z" fill="${INK}"/></g>`
        + `<text x="${f1(f0.x + f0.w / 2)}" y="${f1(f0.y + f0.h - 2)}" font-size="9.5" font-weight="900" text-anchor="middle" fill="${INK}" opacity=".6" letter-spacing="1">终点</text></g>`;
    }
    // 领奖台：冲线的运动员会站上来
    const pd = G.pod;
    const pcx = pd.x + pd.w / 2, pcy = pd.y + pd.h / 2 + 10;
    if (!crop) s += `<g transform="translate(${pcx} ${pcy})"><ellipse cx="0" cy="40" rx="66" ry="7" fill="${wide ? '#fff' : INK}" opacity=".12"/><rect x="-58" y="6" width="38" height="30" rx="4" fill="#B8C2D0" stroke="${INK}" stroke-width="2.5"/><rect x="-19" y="-10" width="38" height="46" rx="4" fill="#F5B41A" stroke="${INK}" stroke-width="2.5"/><rect x="20" y="16" width="38" height="20" rx="4" fill="#D98E4A" stroke="${INK}" stroke-width="2.5"/><text x="0" y="18" font-size="20" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3.5" paint-order="stroke">1</text><text x="-39" y="29" font-size="17" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3.5" paint-order="stroke">2</text><text x="39" y="31" font-size="13" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">3</text><text x="0" y="62" font-size="13" font-weight="900" text-anchor="middle" fill="#fff" opacity=".55">领奖台</text></g>`;
    s += trackV2Layer(trackKey, lay, G.bed); // 二代赛道：糖果格、扭扭招牌、漩涡与管道
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
    // 实物版图中央是大块白色标题：英文名做主标题，中文名放在下面
    $('#centerTrack').innerHTML = `<b class="ct-en">${t.en.toUpperCase()}</b><small class="ct-cn">${t.name}</small>${legend}`;
    $('#centerTrack').style.setProperty('--c', wild ? '#F2553C' : '#33B679');
    v2BoardBuilt(trackKey);
  }

  /* ================= 棋子 ================= */
  // 宽屏赛道的格子是 56×88 的竖条：同格的人沿格子高度竖着排开（两列最多三行），谁都露得出来
  const SLOTS_WIDE = {
    1: [[0, 0]], 2: [[0, -21], [0, 21]], 3: [[0, -28], [0, 0], [0, 28]],
    4: [[-14, -22], [14, -22], [-14, 22], [14, 22]],
    5: [[-14, -28], [14, -28], [-14, 0], [14, 0], [0, 28]],
    6: [[-14, -28], [14, -28], [-14, 0], [14, 0], [-14, 28], [14, 28]],
  };
  // 道具格上有人站着时，棋子下移让出格子上沿，原图块缩成小角标叠在最上层（宽屏竖条 / 竖屏偏右）
  const SLOTS_WIDE_SP = {
    1: [[0, 12]], 2: [[-14, 12], [14, 12]], 3: [[-14, 8], [14, 8], [0, 26]],
    4: [[-14, 8], [14, 8], [-14, 26], [14, 26]],
    5: [[-14, 6], [14, 6], [-14, 22], [14, 22], [0, 32]],
    6: [[-14, 6], [14, 6], [-14, 22], [14, 22], [-14, 34], [14, 34]],
  };
  // 竖屏的格子是 60×52 的大方格：同格的人排成两三排，棋子缩小后都露得出来
  const SLOTS_TALL = {
    1: [[0, 3]], 2: [[-13, 3], [13, 3]], 3: [[-15, -8], [15, -8], [0, 11]],
    4: [[-15, -9], [15, -9], [-15, 10], [15, 10]],
    5: [[-16, -10], [0, -10], [16, -10], [-8, 11], [8, 11]],
    6: [[-16, -9], [0, -9], [16, -9], [-16, 10], [0, 10], [16, 10]],
  };
  const isTileCell = (p) => { const sp = vs && TRACKS[vs.track] && TRACKS[vs.track].spaces[p]; return !!sp && (sp.type === 'star' || sp.type === 'rock' || sp.type === 'arrow'); };
  function syncCellBadges(occupied) {
    const layer = $('#tokens'), want = new Set();
    for (const p of occupied) if (p > 0 && p < FIN && isTileCell(p)) want.add(p);
    for (const g of $$('#trackSvg .cell.occ')) if (!want.has(Number(g.dataset.p))) g.classList.remove('occ');
    for (const b of $$('#tokens .cbadge')) if (!want.has(Number(b.dataset.p))) b.remove();
    const [W, H] = VB();
    for (const p of want) {
      const cell = $(`#trackSvg .cell[data-p="${p}"]`), src = cell && $('.sptile', cell);
      if (!src) continue;
      cell.classList.add('occ');
      const rc = cellRect(p), wide = layout === 'wide';
      const x = wide ? rc.x + rc.w / 2 : rc.x + 20, y = wide ? rc.y + 20 : rc.y + rc.h / 2;
      let b = $(`#tokens .cbadge[data-p="${p}"]`);
      if (!b) {
        b = document.createElement('div');
        b.className = 'cbadge'; b.dataset.p = p;
        b.innerHTML = '<svg viewBox="-26 -26 52 52"></svg>';
        layer.appendChild(b);
      }
      const inner = $('svg', b);
      if (inner.dataset.sig !== `${trackKeySig()}:${p}`) {
        inner.innerHTML = src.innerHTML;
        inner.dataset.sig = `${trackKeySig()}:${p}`;
      }
      b.style.left = `${x / W * 100}%`; b.style.top = `${y / H * 100}%`;
    }
  }
  const trackKeySig = () => `${vs && vs.track}:${layout}`;
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
          el.classList.remove('tripped', 'cur', 'crowd');
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
      // 挤在一格的人多了就整体缩小棋子；只留当前行动者的名字签，其余靠悬停查看（WP-A）
      const crowd = layout === 'tall' ? n >= 3 : (p === 0 ? n >= 4 : n >= 3);
      list.forEach((r, k) => {
        let dx, dy;
        if (p === 0 && layout === 'wide') {
          // 起点格够宽：4 人以内排成一行（4 人时缩小），名字全露出来；更多人分前后两排并错开半格
          const rows = n > 4 ? 2 : 1, per = Math.ceil(n / rows);
          const row = Math.floor(k / per), cnt = row ? n - per : per;
          const gap = rows > 1 ? 52 : n > 3 ? 42 : 57;
          dx = (k % per - (cnt - 1) / 2) * gap + (rows > 1 ? (row ? gap / 4 : -gap / 4) : 0);
          dy = rows > 1 ? (row ? 17 : -17) : 0;
        } else {
          const sp = isTileCell(p);
          const tbl = layout === 'wide' ? (sp ? SLOTS_WIDE_SP : SLOTS_WIDE) : SLOTS_TALL;
          const sl = (tbl[Math.min(n, 6)] || tbl[6])[k % 6];
          [dx, dy] = layout === 'wide' ? sl : [sl[0] + (sp ? 14 : 0), sl[1]];
        }
        const el = tokenEl(r);
        if (instant) el.style.transition = 'none';
        el.style.left = `${(cx + dx) / W * 100}%`;
        el.style.top = `${(cy + dy) / H * 100}%`;
        el.classList.toggle('tripped', !!r.tripped);
        el.classList.toggle('out', !!r.out);
        el.classList.toggle('done', !!r.finished);
        el.classList.toggle('cur', vs.curSeat === r.seat && vs.phase === 'race' && !r.finished && !r.out);
        el.classList.toggle('crowd', crowd);
        let pl = $('.place', el);
        if (r.finished && !pl) { pl = document.createElement('div'); el.appendChild(pl); }
        if (pl) { if (r.finished) { pl.className = `place p${r.finished}`; pl.textContent = r.finished; } else pl.remove(); }
        const cur = el.classList.contains('cur');
        const z = cur ? 9 : 2 + k;
        el.style.zIndex = z;
        if (!r.out) placed.push({ el, x: cx + dx, y: cy + dy, z, hide: crowd && layout === 'tall' && !cur });
        if (instant) { void el.offsetWidth; el.style.transition = ''; }
      });
    }
    syncCellBadges(Object.keys(groups).map(Number).filter((p) => p !== FIN));
    fitTags(placed);
  }
  // 名字签防重叠：从最上层的棋子往下排，名字签会压到更上层的棋子或已显示的名字签就先收起（悬停棋子仍能看是谁）
  function fitTags(placed) {
    const s = layout === 'tall' ? 50 : 46;
    const shown = [], bodies = [];
    placed.sort((a, b) => b.z - a.z || (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1));
    const measured = placed.map((t) => {
      const tag = $('.seat-dot', t.el), u = t.el.offsetWidth / s;
      return { ...t, hw: tag && u ? tag.offsetWidth / u / 2 : null };
    });
    const changes = [];
    for (const t of measured) {
      if (t.hw == null) continue;
      if (t.hide) { changes.push({ el: t.el, hit: true }); bodies.push({ x: t.x, y: t.y, r: s * 0.4 }); continue; }
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
    const fl = $('#floaters');
    fl.appendChild(f);
    // 靠赛道左右边缘的飘字往里收，连放大到 1.08 时也不出赛道，免得页面横向多出几像素
    const W = fl.clientWidth, half = f.offsetWidth * 0.55 + 2;
    if (W > 0 && half * 2 < W) {
      const x = parseFloat(f.style.left) / 100 * W;
      const cx = Math.max(half, Math.min(W - half, x));
      if (Math.abs(cx - x) > 0.5) f.style.left = `${cx / W * 100}%`;
    }
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
    renderV2();
  }
  function syncMeta() { renderPlayers(); renderTitle(); }

  function renderPills() {
    // 本局模式的小标签放在场次条最前面，不另占一块区域
    $('#races').innerHTML = edBadge(curEdition(), 'race-ed') + raceSchedule().map((t, i) => {
      const n = i + 1;
      const cls = [t === 'wild' ? 'wild' : '', t !== 'mild' && t !== 'wild' ? `v2 ${t}` : '', `tk-${t}`, vs.raceNo === n && vs.phase !== 'draft' ? 'cur' : '', vs.raceNo > n || (vs.raceNo === n && (vs.phase === 'between' || vs.phase === 'over')) ? 'done' : ''].join(' ');
      return `<div class="race-pill ${cls}" title="${esc(TRACKS[t] ? TRACKS[t].name : t)}"><span class="no">${n}</span><span class="tn">${esc(trackShort(t))}</span><span class="pts">金${GOLD[i]}·银${SILVER[i]}</span></div>`;
    }).join('');
  }
  // 顶栏标题只讲「现在是什么局面」：场次 + 轮到谁 + 离你还有几位（手机上场次名会让位给后两项）
  // 手机竖屏里它就是 APK 风格的「提示框」：一句话说清轮到谁、该做什么，右侧旗帜 + 第 N/4 场（桌面隐藏 .tb-end / .tb-do）
  const TURN_DO = {
    draft: '选一名运动员', roll: '掷骰子', mode: '选择这回合怎么走', reroll: '决定要不要重掷', genius: '预言点数',
    mastermind: '预言冠军', hypnotist: '施展催眠', thirdwheel: '找两人世界', cheerleader: '决定要不要加油', alchemist: '炼金',
    rocket: '决定要不要点火', suckerfish: '决定要不要跟上', duel: '决定要不要决斗', egg: '挑一个技能', twin: '挑一位冠军复制',
  };
  function bannerDo(mine, d, p) {
    if (!d || !p || d.simul || playing || queue.length) return '';
    if (mine) return TURN_DO[d.kind] || '';
    return WAIT_TEXT[d.kind] || '';
  }
  function renderTitle() {
    if (!vs) return;
    const el = $('#topTitle');
    const plainSpan = (t) => `<span class="tt-plain">${esc(t)}</span>`;
    const part = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
    const pend = snap && snap.pending;
    const total = raceSchedule().length || 4;
    let html = '', plain = '', mine = false, doing = '', cue2 = '';
    let round = vs.phase === 'draft' ? '选秀' : `第 ${Math.max(1, vs.raceNo)}/${total} 场`;
    if (vs.phase === 'draft') {
      plain = isParticipant() ? '选秀：组建你的 4 人队伍' : 'AI 选秀：自动组建队伍';
      html = plainSpan(plain);
      if (isParticipant() && pend && pend.kind === 'draft' && !playing && !queue.length) {
        const dp = vs.players[pend.seat];
        mine = pend.seat === you;
        doing = mine ? '轮到你选人：点一张卡牌' : `轮到 ${pname(dp)} 选人`;
      } else doing = plain;
    } else if (vs.phase === 'pick') {
      plain = `第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name} · ${isParticipant() ? '派谁上场？' : 'AI 正在暗选出战'}`;
      html = plainSpan(plain);
      const done = pend && pend.simul && (pend.done || []).includes(you);
      mine = isParticipant() && !done;
      doing = isParticipant() ? (done ? '已选好，等其他人亮牌' : '派谁上场？点一张卡牌') : 'AI 正在暗选出战';
      cue2 = TRACKS[vs.track].name;
    } else if (vs.phase === 'race') {
      const p = vs.curSeat != null ? vs.players[vs.curSeat] : null;
      const race = `第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}`;
      const ahead = turnsAhead();
      const who = !p ? '' : ahead === 0 ? '轮到你了' : `轮到 ${pname(p)}`;
      const cue = ahead > 0 ? aheadText(ahead) : '';
      plain = [race, who, cue].filter(Boolean).join(' · ');
      html = part('tt-race', race) + (who ? `<span class="tt-sep"> · </span>${part(`tt-turn ${ahead === 0 ? 'mine' : ''}`, who)}` : '')
        + (cue ? `<span class="tt-sep"> · </span>${part(`tt-cue ${ahead === 1 ? 'soon' : ''}`, cue)}` : '');
      if (p) el.style.setProperty('--c', PCOL[p.seat % 6]);
      mine = ahead === 0;
      const todo = bannerDo(mine, pend && !pend.simul && pend.seat === p?.seat ? pend : null, p);
      doing = who ? who + (todo ? `：${todo}` : '') : race;
      cue2 = cue;
    } else if (vs.phase === 'between') { plain = `第 ${vs.raceNo} 场结束`; html = plainSpan(plain); doing = plain; }
    else if (vs.phase === 'over') { plain = '比赛结束'; html = plainSpan(plain); doing = plain; round = `共 ${total} 场`; }
    // 手机竖屏的场次条放不下模式徽标，改由标题行开头显示（CSS 二选一显示）
    const ed = curEdition();
    const key = `${plain}|${doing}|${cue2}|${round}|${mine}`;
    if (el.dataset.plain === key && el.dataset.ed === ed) return;
    el.dataset.plain = key;
    el.dataset.ed = ed;
    el.dataset.mine = mine ? '1' : '';
    const flagSvg = window.Skin ? Skin.flag({ size: 22 }) : '';
    el.innerHTML = edBadge(ed, 'tt-ed') + html
      + `<span class="tb-do"><b class="tb-main">${esc(doing)}</b>${cue2 && cue2 !== doing ? `<small class="tb-cue">${esc(cue2)}</small>` : ''}</span>`
      + `<span class="tb-end">${flagSvg}<b>${esc(round)}</b></span>`;
    el.title = `${edName(ed)} · ${plain}`;
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
  // 首页、房间里的声音开关：和对局顶栏的 #soundBtn 一样读 Sound.ui
  function renderSoundToggles() {
    // 首页页脚的开关和旁边的文字链接统一：图标 + 当前档位短标签
    const short = { all: '音乐', sfx: '音效', off: '静音' }[Sound.mode] || '声音';
    for (const b of $$('[data-sound]')) {
      b.innerHTML = `<span class="ico">${icon(Sound.ui.icon)}</span>${b.closest('.home-foot') ? `<span class="sound-label">${short}</span>` : ''}`;
      b.dataset.mode = Sound.mode;
      b.title = Sound.ui.label;
      b.setAttribute('aria-label', Sound.ui.label);
    }
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
    $('#chatBtn').hidden = !isParticipant();
    if (!isParticipant()) closeTopPops();
    const soundShort = { all: '音乐', sfx: '音效', off: '静音' }[Sound.mode] || '';
    $('#soundBtn').innerHTML = `<span class="ico">${icon(Sound.ui.icon)}</span><span class="lbl">声音</span><b class="st">${soundShort}</b>`;
    $('#soundBtn').title = Sound.ui.label;
    $('#soundBtn').setAttribute('aria-label', Sound.ui.label);
    renderSoundToggles();
  }

  /* ================= WP-B 局势：显示名 / 行动顺序 ================= */
  // AI 座位的名字去掉「（AI）」后缀，改由 AI 徽章表示，窄卡片里能多露出几个字
  function pname(p) { return !p ? '' : p.ai ? String(p.name).replace(/（AI）$/, '') : p.name; }
  const activeRacer = (r) => !!r && !r.finished && !r.out;
  // 比赛中从当前行动者开始、顺时针排列的在场选手（当前行动者在前）
  function turnOrder() {
    if (!vs || vs.phase !== 'race' || vs.curSeat == null) return [];
    const n = vs.players.length, out = [];
    for (let k = 0; k < n; k++) {
      const r = vs.racers.find((x) => x.seat === (vs.curSeat + k) % n);
      if (activeRacer(r)) out.push(r);
    }
    return out;
  }
  // 还要等几位才轮到你：0 = 正轮到你，1 = 下一个就是你；你不在场或已冲线/出局返回 null
  function turnsAhead() {
    if (!isParticipant()) return null;
    const order = turnOrder();
    const k = order.findIndex((r) => r.seat === you);
    if (k < 0) return null;
    const cur = vs.racers.find((r) => r.seat === vs.curSeat);
    return activeRacer(cur) ? k : k + 1;
  }
  const aheadText = (n) => (n === 0 ? '轮到你了' : n === 1 ? '下一个就是你' : `再过 ${n} 位轮到你`);
  // 窄屏玩家卡：卡片太窄时把名字放到头像下面一行；名字还放不下就缩字号，最后只保留前几个字（不加省略号）
  // 名字、标签和视口都没变时直接套用上次量好的字号，不再强制布局
  let fitMemo = null;
  const MQ_PHONE_PORTRAIT = matchMedia('(max-width: 600px) and (orientation: portrait)');
  function fitPlayerNames() {
    const box = $('#players');
    if (!box) return;
    // 手机竖屏的玩家栏是等宽头像卡（名字条 CSS 省略号截断），不需要逐个量字号
    if (MQ_PHONE_PORTRAIT.matches) {
      box.classList.remove('pf-stack');
      for (const nm of $$('.prow .pnm', box)) { nm.style.fontSize = ''; nm.classList.remove('clip'); }
      fitMemo = null;
      return;
    }
    const all = $$('.prow .pnm', box);
    const key = `${innerWidth}x${innerHeight}|${document.fonts ? document.fonts.status : ''}|${all.map((nm) => nm.parentElement.textContent).join('|')}`;
    if (fitMemo && fitMemo.key === key) {
      box.classList.toggle('pf-stack', fitMemo.narrow);
      all.forEach((nm, i) => { nm.style.fontSize = fitMemo.fs[i]; nm.classList.toggle('clip', fitMemo.clip[i]); });
      return;
    }
    const first = $('.prow', box);
    const fw = first ? first.getBoundingClientRect().width : 0;
    // 3 人局的手机卡片约 119–131px 宽，横排时名字只剩 40px 左右（「选手100」会被截成「选手1…」），也改成名字单独一行
    const narrow = fw > 0 && fw < 134 && matchMedia('(max-width: 1000px) and (orientation: portrait)').matches;
    box.classList.toggle('pf-stack', narrow);
    // 先统一写、再统一读：每一档字号只触发一次布局，不再逐个名字读写交替（布局抖动）
    const names = $$('.prow .pnm', box);
    for (const nm of names) { nm.style.fontSize = ''; nm.classList.remove('clip'); }
    let over = names.filter((nm) => nm.scrollWidth > nm.clientWidth + 1);
    for (const fs of [11.5, 10.5]) {
      if (!over.length) break;
      for (const nm of over) nm.style.fontSize = `${fs}px`;
      over = over.filter((nm) => nm.scrollWidth > nm.clientWidth + 1);
    }
    for (const nm of over) nm.classList.add('clip');
    fitMemo = { key, narrow, fs: names.map((nm) => nm.style.fontSize), clip: names.map((nm) => nm.classList.contains('clip')) };
  }

  // 每批事件收尾会连着调好几次 renderPlayers：内容没变就不重建 DOM、不重新量名字（省掉强制布局）
  let playersHtml = '';
  // 赛中的实时名次（并列同名次）；全员还在同一格时没有意义，不标
  function seatRanks() {
    const out = {};
    if (!vs || (vs.phase !== 'race' && vs.phase !== 'between') || !vs.racers.length) return out;
    const list = vs.racers.slice().sort((a, b) => rankKey(a) - rankKey(b) || a.seat - b.seat);
    if (rankKey(list[0]) === rankKey(list[list.length - 1])) return out;
    let rank = 0, prev = null;
    list.forEach((r, i) => {
      const k = rankKey(r);
      if (k !== prev) { rank = i + 1; prev = k; }
      out[r.seat] = r.out ? 'out' : rank;
    });
    return out;
  }
  function renderPlayers() {
    if (!vs) return;
    const d = snap && snap.pending;
    const racing = vs.phase === 'race' || vs.phase === 'between';
    const ahead = vs.phase === 'race' ? turnsAhead() : null;
    const box = $('#players');
    const starSvg = window.Skin ? Skin.star({ size: 16 }) : '★';
    const ranks = seatRanks();
    // 手机竖屏的提示框读取 pending（轮到谁、该做什么）：每次重排玩家栏顺带刷新（内容没变时 renderTitle 自己早退）
    renderTitle();
    const html = vs.players.map((p) => {
      const c = PCOL[p.seat % 6];
      const cur = vs.racers.find((r) => r.seat === p.seat);
      const ava = cur && racing ? art(cur.rid) : `<span class="init">${esc(p.name.slice(0, 1))}</span>`;
      let think = '';
      if (d && !playing && !queue.length) {
        if (d.simul && d.seats.includes(p.seat)) think = d.done.includes(p.seat) ? '<span class="think ok">已出牌</span>' : '<span class="think">思考中</span>';
        else if (!d.simul && d.seat === p.seat) think = '<span class="think">行动中</span>';
      }
      const tags = playerTags(p);
      // 快轮到你：你的选手下一个行动时，你的玩家卡轻轻脉冲
      const soon = p.seat === you && ahead === 1 && !think;
      const rk = ranks[p.seat];
      const rkHtml = rk == null ? '' : `<i class="rk ${rk === 1 ? 'rk1' : rk === 2 ? 'rk2' : rk === 'out' ? 'rko' : ''}" title="${rk === 'out' ? '出局' : `当前第 ${rk} 名`}">${rk === 'out' ? '出' : rk}</i>`;
      return `<div class="prow ${vs.curSeat === p.seat && vs.phase === 'race' ? 'cur' : ''} ${p.seat === you ? 'me' : ''} ${soon ? 'soon' : ''} ${p.ai ? 'is-ai' : ''} ${popSeat === p.seat ? 'open' : ''}" data-seat="${p.seat}" data-fly-target="seat-${p.seat}" style="--c:${c}" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="${popSeat === p.seat}" aria-label="${esc(p.name)}，${p.score} 分，点按查看角色和得分">
        <div class="pav">${ava}</div>${rkHtml}
        <div class="pn"><b><span class="pnm">${esc(pname(p))}</span>${tags}</b></div>
        <div class="sc"><i class="sk-star" aria-hidden="true">${starSvg}</i><b data-score="${p.seat}">${p.score}</b><span>分</span></div>${think}${soon ? '<span class="soon-tag">下一个是你</span>' : ''}</div>`;
    }).join('');
    if (html !== playersHtml || !box.firstElementChild) {
      playersHtml = html;
      box.innerHTML = html;
      fitPlayerNames();
    }
    refreshPlayerPop();
  }
  function playerTags(p) {
    const offline = !p.ai && room && room.seats[p.seat] && room.seats[p.seat].online === false;
    const modeLabel = offline ? '离线' : autoModes[p.seat] === 'timeout' ? '超时托管' : '托管';
    return `${p.seat === you ? '<span class="you">你</span>' : ''}${(autoFlags[p.seat] || offline) && !p.ai ? `<span class="auto">${modeLabel}</span>` : ''}${p.ai ? '<span class="auto ai">AI</span>' : ''}`;
  }

  /* ================= 玩家信息弹层：点头像看分数、角色名单、当前角色 ================= */
  let popSeat = null, popHtml = '';
  function playerPopHtml(p) {
    const racing = vs.phase === 'race' || vs.phase === 'between';
    const cur = vs.racers.find((r) => r.seat === p.seat);
    const kinds = { gold: 0, silver: 0, bronze: 0 };
    for (const c of p.chips || []) if (kinds[c.kind] != null) kinds[c.kind] += c.v;
    const names = { gold: '金', silver: '银', bronze: '铜' };
    const chips = Object.keys(kinds).filter((k) => kinds[k]).map((k) => `<span class="pp-chip ${k}"><i></i>${names[k]} ${kinds[k]}</span>`).join('') || '<span class="pp-none">还没有得分</span>';
    const rows = p.hand.map((id) => {
      const now = !!(cur && cur.rid === id && racing);
      const used = p.used.includes(id) && !now;
      let st = used ? '已上场' : '待上场', skill = R[id].skill;
      if (now) {
        const effective = Object.prototype.hasOwnProperty.call(cur, 'eff') ? cur.eff : cur.power;
        skill = effective && R[effective] ? R[effective].skill : cur.power === 'copycat' ? '暂无可复制技能' : R[id].skill;
        st = cur.finished ? `第 ${cur.finished} 名` : cur.out ? '出局' : cur.tripped ? '摔倒中' : `第 ${cur.pos} 格`;
      }
      return `<div class="pp-r ${now ? 'now' : ''} ${used ? 'used' : ''}" data-tip="${id}"><i style="--rc:${rcol(id)}">${art(id)}</i><span class="pp-n"><b>${esc(R[id].name)}</b><small>${esc(skill)}</small></span><em>${now ? '<u>出战</u>' : ''}${st}</em></div>`;
    }).join('');
    const empty = p.hand.length ? '' : '<div class="pp-none pp-empty">还没有选人</div>';
    const ava = cur && racing ? art(cur.rid) : `<span class="init">${esc(p.name.slice(0, 1))}</span>`;
    return `<div class="pp-head"><div class="pav">${ava}</div><div class="pp-who"><b>${esc(pname(p))}${playerTags(p)}</b><div class="pp-chips">${chips}</div></div><div class="pp-sc"><i class="sk-star" aria-hidden="true">${window.Skin ? Skin.star({ size: 20 }) : '★'}</i><b>${p.score}</b></div></div>
      <div class="pp-sec">角色${p.hand.length ? `<small>${p.hand.length}/4</small>` : ''}</div><div class="pp-list">${rows}${empty}</div>`;
  }
  function placePlayerPop() {
    const pop = $('#playerPop');
    if (popSeat == null || pop.hidden) return;
    const row = $(`#players .prow[data-seat="${popSeat}"]`);
    if (!row || $('#game').hidden) { closePlayerPop(); return; }
    const a = row.getBoundingClientRect();
    // 矮横屏：玩家条竖排在左侧，弹层从头像右边展开
    const beside = matchMedia('(max-width: 1000px) and (orientation: landscape) and (max-height: 550px)').matches;
    pop.classList.toggle('beside', beside);
    pop.style.setProperty('--w', `${Math.min(320, beside ? innerWidth - a.right - 16 : innerWidth - 16)}px`);
    const w = pop.offsetWidth;
    if (beside) {
      pop.style.maxHeight = `${innerHeight - 16}px`;
      const h = pop.offsetHeight;
      pop.style.left = `${a.right + 10}px`;
      pop.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, a.top + a.height / 2 - h / 2))}px`;
      pop.style.setProperty('--c', PCOL[popSeat % 6]);
      return;
    }
    const x = Math.max(8, Math.min(innerWidth - w - 8, a.left + a.width / 2 - w / 2));
    pop.style.left = `${x}px`;
    pop.style.top = `${a.bottom + 10}px`;
    pop.style.maxHeight = `${Math.max(160, innerHeight - a.bottom - 18)}px`;
    pop.style.setProperty('--ax', `${Math.max(16, Math.min(w - 16, a.left + a.width / 2 - x))}px`);
    pop.style.setProperty('--c', PCOL[popSeat % 6]);
  }
  function refreshPlayerPop() {
    if (popSeat == null) return;
    const p = vs && vs.players[popSeat];
    if (!p) { closePlayerPop(); return; }
    const pop = $('#playerPop');
    const html = playerPopHtml(p);
    if (html !== popHtml) { popHtml = html; pop.innerHTML = html; }
    placePlayerPop();
  }
  function closePlayerPop(focusBack) {
    if (popSeat == null) return;
    const seat = popSeat;
    popSeat = null; popHtml = '';
    const pop = $('#playerPop');
    pop.hidden = true;
    pop.classList.remove('in');
    const row = $(`#players .prow[data-seat="${seat}"]`);
    if (row) { row.classList.remove('open'); row.setAttribute('aria-expanded', 'false'); if (focusBack) row.focus({ preventScroll: true }); }
  }
  function togglePlayerPop(row) {
    const seat = Number(row.dataset.seat);
    if (popSeat === seat) { closePlayerPop(); Sound.click(); return; }
    const prev = popSeat;
    if (prev != null) closePlayerPop();
    closeTopPops();
    hideTip();
    Sound.click();
    popSeat = seat;
    const pop = $('#playerPop');
    pop.hidden = false;
    row.classList.add('open'); row.setAttribute('aria-expanded', 'true');
    popHtml = '';
    refreshPlayerPop();
    pop.classList.remove('in'); void pop.offsetWidth; pop.classList.add('in');
  }
  function initPlayerPop() {
    const box = $('#players');
    box.addEventListener('click', (e) => { const row = e.target.closest('.prow'); if (row) togglePlayerPop(row); });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.prow');
      if (!row) return;
      e.preventDefault();
      togglePlayerPop(row);
    });
    document.addEventListener('pointerdown', (e) => {
      if (popSeat != null && !e.target.closest('#playerPop, #players .prow, #tip')) closePlayerPop();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popSeat != null) { e.preventDefault(); closePlayerPop(true); } });
  }

  function rcard(id, opts = {}) {
    const r = R[id];
    const owner = opts.owner != null ? `<span class="owner" style="--c:${PCOL[opts.owner % 6]}">${esc(vs.players[opts.owner].name)}</span>` : '';
    const takenBy = opts.taken != null ? `<span class="owner taken-by" style="--c:${PCOL[opts.taken % 6]}">${esc(vs.players[opts.taken].name.replace(/（AI）$/, ''))} 选走</span>` : '';
    return `<button class="rcard ${opts.mini ? 'mini' : ''} ${opts.taken != null ? 'taken' : ''} ${opts.cls || ''}" data-id="${id}" style="--rc:${rcol(id)};--k:${opts.k || 0}" ${opts.disabled ? 'tabindex="-1"' : ''}>
      <div class="art">${art(id)}<span class="nm">${esc(r.name)}</span>${owner}${takenBy}</div>
      <div class="txt"><b class="nm2">${esc(r.name)}</b><span class="sk">${esc(r.skill)}</span><div class="tx">${esc(r.text)}</div>${r.note && !opts.mini ? `<div class="nt">${esc(r.note)}</div>` : ''}</div></button>`;
  }

  let dRound = null; // 本轮选秀的原始名单与「谁选走了哪张」
  // 手机（竖屏窄屏、横屏矮屏）：选秀改成固定图标网格 + 独立技能栏——点图标只是查看，点「选 TA」才真正选人
  let dSel = null;
  const phoneDraft = () => innerWidth <= 600 || (innerHeight <= 520 && innerWidth > innerHeight);
  function draftCols(n) { return n <= 16 ? 4 : n <= 25 ? 5 : 6; }
  function renderDraftDetail() {
    const box = $('#draftDetail'), ig = phoneDraft();
    $('#draft').classList.toggle('ig', ig);
    if (!ig || $('#draft').hidden) { box.hidden = true; return; }
    box.hidden = false;
    const d = snap && snap.pending;
    const tile = dSel && $(`#draftCards .rcard[data-id="${dSel}"]`);
    if (!tile) {
      dSel = null;
      box.className = 'draft-detail empty';
      box.innerHTML = '<div class="dd-info"><span>点一下上面的头像，在这里查看 TA 的技能</span></div><button class="dd-btn" disabled><b>选 TA</b><small>先点一个头像</small></button>';
      return;
    }
    const r = R[dSel];
    const takenSeat = tile.classList.contains('taken') ? (dRound && dRound.taken[dSel]) : null;
    const mine = isParticipant() && d && d.kind === 'draft' && d.seat === you && !playing && !queue.length && !submitted && connection === 'ready';
    let btn;
    if (takenSeat != null && takenSeat === you && isParticipant()) btn = '<button class="dd-btn" disabled><b>已入队</b><small>我的队伍</small></button>';
    else if (takenSeat != null) btn = `<button class="dd-btn" disabled><b>已被选走</b><small>${esc(vs.players[takenSeat].name.replace(/（AI）$/, ''))}</small></button>`;
    else if (!isParticipant()) btn = '<button class="dd-btn" disabled><b>观战中</b><small>AI 自动选人</small></button>';
    else if (mine) btn = '<button class="dd-btn go"><b>选 TA</b><small>加入我的队伍</small></button>';
    else btn = `<button class="dd-btn" disabled><b>等待中</b><small>${d && d.kind === 'draft' && vs.players[d.seat] ? `${esc(vs.players[d.seat].name.replace(/（AI）$/, ''))} 在选` : '还没轮到你'}</small></button>`;
    box.className = `draft-detail${takenSeat != null ? ' taken' : ''}`;
    box.style.setProperty('--rc', rcol(dSel));
    box.innerHTML = `<div class="dd-info"><div class="dd-art">${art(dSel)}</div><div class="dd-tx"><div class="dd-name"><b>${esc(r.name)}</b><span class="sk">${esc(r.skill)}</span></div><p>${esc(r.text)}</p>${r.note ? `<small>${esc(r.note)}</small>` : ''}</div></div>${btn}`;
    const go = $('.dd-btn.go', box);
    if (go) go.onclick = () => {
      if (answer(d, dSel)) {
        Sound.card();
        tile.classList.add('chosen');
        store.set('hn_tapHint', 1);
        $$('#draftCards .rcard').forEach((c) => { c.classList.remove('pickable'); c.onclick = null; });
        renderDraftDetail();
      }
    };
  }
  function selectDraftTile(id) {
    dSel = id;
    for (const c of $$('#draftCards .rcard')) c.classList.toggle('sel', c.dataset.id === id);
    Sound.click();
    renderDraftDetail();
  }
  function renderDraft(deal) {
    const d = snap && snap.pending;
    // 本轮名单固定：被选走的卡留在原位置灰并标明是谁选的，不补位（快照恢复时没有原名单，只列剩下的）
    // 本轮名单只在名单与服务端剩余牌一致时沿用（每批事件收尾 vs 会被快照整体替换，名单所以放在 dRound 里）
    if ((!dRound || !(vs.faceUp || []).every((id) => dRound.cards.includes(id))) && snap && snap.draftDeal && (vs.faceUp || []).every((id) => snap.draftDeal.cards.includes(id))) {
      // 断线重连 / 中途进入：用服务端快照里的本轮原始名单还原固定位置（只认已经在 vs 里被拿走的牌）
      dRound = { cards: snap.draftDeal.cards.slice(), taken: Object.fromEntries(Object.entries(snap.draftDeal.taken || {}).filter(([id]) => !(vs.faceUp || []).includes(id))) };
    }
    const keep = dRound && (vs.faceUp || []).every((id) => dRound.cards.includes(id));
    const taken = keep ? dRound.taken : {};
    const list = keep ? dRound.cards : vs.faceUp || [];
    $('#draftCards').innerHTML = list.map((id, k) => rcard(id, { cls: deal ? 'deal' : '', k, taken: taken[id] })).join('');
    $('#draftTitle').textContent = isParticipant() ? (vs.draft ? `${vs.draft.round === 0 ? '第一' : '第二'}轮选秀` : '组建你的队伍') : `AI 自动选秀${vs.draft ? ` · 第 ${vs.draft.round + 1}/2 轮` : ''}`;
    const total = vs.players.length * 4;
    const picked = vs.players.reduce((s, p) => s + p.hand.length, 0);
    $('#draftSub').textContent = `已选 ${picked}/${total} · 每人 4 名，四场各派一名 · ${isParticipant() ? '技能写在卡上，轮到你时点击选人' : 'AI 自己选人，点卡牌可查看技能'}`;
    renderDraftOrder();
    renderMyTeam();
    if (d && d.kind === 'draft') bindDraftPick(d);
    fitDraft();
    renderDraftDetail();
  }
  // 选秀卡一屏摆完：在容器里找「卡宽最大且放得下」的方案；按密度分三档（a 完整 / b 去掉补充说明 / c 只留图与名字，说明靠悬停或点按），
  // 三档都放不下（极小屏）才退回分页
  function fitDraft() {
    if ($('#draft').hidden) return;
    const box = $('#draftCards'), items = $$('#draftCards .rcard'), pager = $('#draftPager');
    if (!box.offsetParent || !items.length) return;
    // 提示栏 / 操作坞变高变矮会改变容器高度：尺寸变了就重排
    if (!box.dataset.ro && window.ResizeObserver) {
      box.dataset.ro = '1';
      let lw = 0, lh = 0, raf = 0;
      new ResizeObserver(() => {
        if (!box.offsetParent || (Math.abs(box.clientWidth - lw) < 2 && Math.abs(box.clientHeight - lh) < 2)) return;
        lw = box.clientWidth; lh = box.clientHeight;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(fitDraft);
      }).observe(box);
    }
    $('#draft').classList.toggle('ig', phoneDraft());
    if (phoneDraft()) {
      box.dataset.d = 'ig';
      box.classList.remove('fitted');
      box.style.setProperty('--cols', draftCols(items.length));
      box.style.setProperty('--rows', Math.ceil(items.length / draftCols(items.length)));
      for (const el of items) { el.hidden = false; delete el.dataset.tip; el.classList.toggle('sel', el.dataset.id === dSel); }
      pager.hidden = true; pager.innerHTML = '';
      renderDraftDetail();
      return;
    }
    const fits = () => box.scrollHeight <= box.clientHeight + 1;
    const setW = (w) => box.style.setProperty('--cw', `${w}px`);
    const phone = innerWidth <= 600;
    box.classList.remove('fitted');
    for (const el of items) el.hidden = false;
    pager.hidden = true; pager.innerHTML = '';
    let done = false;
    for (const [lv, minW] of [['a', 150], ['b', 120], ['c', phone ? 72 : 88], ['d', 60]]) {
      box.dataset.d = lv;
      setW(minW);
      if (!fits()) continue;
      let lo = minW, hi = 250;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); setW(mid); if (fits()) lo = mid; else hi = mid - 1; }
      setW(lo);
      done = true;
      break;
    }
    if (done) {
      box.classList.add('fitted');
      // 技能文字已写在卡面上的档位不再弹悬浮框，只有文字被收起的紧凑档位才悬停 / 点按看完整技能
      for (const el of items) { if (box.dataset.d === 'c' || box.dataset.d === 'd') el.dataset.tip = el.dataset.id; else delete el.dataset.tip; }
      return;
    }
    box.dataset.d = 'd'; setW(60);
    const run = () => paginate('draft', box, () => $$('#draftCards .rcard'), pager);
    run();
    // 轮到你选而这一页的卡都被选走了：翻到第一张还能选的卡所在页
    const open = items.filter((c) => c.classList.contains('pickable'));
    if (open.length && open.every((c) => c.hidden)) { pagers.draft.anchor = items.indexOf(open[0]); run(); }
  }
  function bindDraftPick(d) {
    const mine = isParticipant() && d.seat === you && !playing && !queue.length && !submitted && connection === 'ready';
    const cards = $$('#draftCards .rcard:not(.taken)');
    if (phoneDraft()) {
      // 手机：所有图标（含已被选走的）都只用来查看；真正选人在技能栏的「选 TA」按钮
      for (const el of $$('#draftCards .rcard')) {
        el.classList.toggle('pickable', mine && !el.classList.contains('taken'));
        el.classList.remove('tap-hint', 'armed');
        el.onclick = () => selectDraftTile(el.dataset.id);
      }
      renderDraftDetail();
      return;
    }
    for (const el of cards) {
      el.classList.toggle('pickable', mine);
      el.classList.remove('tap-hint');
      el.onclick = mine ? () => {
        // 说明被收起时，触屏第一次点按只是看说明（卡上标「再点一次」），第二次才选
        if (/^[cd]$/.test($('#draftCards').dataset.d) && matchMedia('(hover: none)').matches && !el.classList.contains('armed')) {
          for (const c of $$('#draftCards .rcard.armed')) c.classList.remove('armed');
          el.classList.add('armed');
          Sound.click();
          showTip(el.dataset.id, el);
          return;
        }
        if (answer(d, el.dataset.id)) {
          Sound.card();
          el.classList.add('chosen');
          store.set('hn_tapHint', 1);
          $$('#draftCards .rcard').forEach((c) => { c.classList.remove('pickable', 'tap-hint'); c.onclick = null; });
        }
      } : isParticipant() && vs && vs.phase === 'draft' ? () => { denyCue(); nudge(el); } : null;
    }
    // 第一次轮到自己选人：在第一张可见卡上挂一枚静态「点我选人」，选过一次就不再出现
    if (mine && !store.get('hn_tapHint', 0)) {
      const first = cards.find((c) => !c.hidden);
      if (first) first.classList.add('tap-hint');
    }
    if (mine && hasKeyboard.matches && d.id != null) focusFirst('#draftCards .rcard.pickable:not([hidden])', `draft:${d.id}`);
  }

  /* ================= 名次条 / 行动卡 / 悬停说明 ================= */
  const rankKey = (r) => (r.finished ? -1000 + r.finished : r.out ? 1000 : -r.pos);

  // 行动卡：谁在行动（头像、玩家、选手）→ 位置进度（技能点头像可看，卡里只在借用他人技能时标出） + 接下来的行动顺序；右上角标签告诉你还有几位轮到你
  let tcRid = null, tcSoonSaid = null;
  // 本场实时名次：已冲线按名次靠前，其余按位置；返回「第几名 + 和前后一名的差距」
  function rankInfo(r) {
    if (!vs || vs.phase !== 'race') return null;
    const key = (x) => (x.finished ? 1000 - x.finished : x.out ? -1 : x.pos);
    const order = vs.racers.slice().sort((a, b) => key(b) - key(a));
    const i = order.findIndex((x) => x.rid === r.rid);
    if (i < 0 || order.length < 2) return null;
    const nm = (x) => pname(vs.players[x.seat]);
    const dist = (a, b) => Math.max(0, Math.min(FIN, key(a)) - Math.min(FIN, key(b)));
    let text, cls = '';
    if (i === 0) { const nx = order[1]; const d = dist(r, nx); text = d ? `领跑中 · 领先${nm(nx)} ${d} 格` : `领跑中 · 与${nm(nx)}并列`; cls = 'lead'; }
    else { const up = order[i - 1]; const d = dist(up, r); text = d ? `落后${nm(up)} ${d} 格` : `与${nm(up)}并列`; if (i === order.length - 1) cls = 'last'; }
    return { rank: `第${i + 1}名`, text, cls };
  }
  function renderTurnCard() {
    const tc = $('#turnCard');
    $('#center').classList.toggle('hud-race', !!(vs && vs.phase === 'race'));
    const r = vs && vs.phase === 'race' && vs.curSeat != null ? vs.racers.find((x) => x.seat === vs.curSeat) : null;
    if (!r || r.finished || r.out) { tc.hidden = true; tcRid = null; return; }
    const base = R[r.rid];
    const effective = Object.prototype.hasOwnProperty.call(r, 'eff') ? r.eff : r.power;
    const pw = effective && effective !== r.rid && R[effective] ? R[effective] : null;
    const p = vs.players[r.seat];
    const ahead = turnsAhead();
    const left = FIN - r.pos;
    const rk = rankInfo(r);
    const pos = r.tripped
      ? '<span class="tc-pos bad">摔倒中 · 本回合爬起来，不掷骰</span>'
      : `<span class="tc-pos" title="在第 ${r.pos} 格，离终点还差 ${left} 格">第 <b>${r.pos}</b> 格 · 差 <b>${left}</b> 格</span>`;
    const gap = rk ? `<div class="tc-gap ${rk.cls}"><i>${rk.rank}</i><span>${esc(rk.text)}</span></div>` : '';
    tc.hidden = false;
    tc.style.setProperty('--c', PCOL[r.seat % 6]);
    tc.style.setProperty('--rc', rcol(r.rid));
    tc.innerHTML = `<div class="tc-head"><div class="tc-ava">${art(r.rid)}</div><div class="tc-who"><span class="tc-player">${esc(pname(p))}${r.seat === you ? ' · 你' : p.ai ? ' · AI' : ''}</span><b>${esc(base.name)}</b></div></div>
      <div class="tc-bar" aria-hidden="true"><em style="width:${Math.round(r.pos / FIN * 100)}%"></em></div>
      ${pw ? `<div class="tc-skill"><span class="sk">借用「${esc(pw.skill)}」</span><em>来自${esc(pw.name)}</em></div>` : ''}
      ${gap}
      <div class="tc-st ${r.tripped ? 'bad' : ''}">${pos}</div>`;
    if (tcRid !== r.rid) { tc.classList.remove('in'); void tc.offsetWidth; tc.classList.add('in'); tcRid = r.rid; }
    // 读屏：只在「下一个就是你」时提醒一次（轮到你由出牌提示负责播报）
    if (ahead !== 1) tcSoonSaid = null;
    else if (tcSoonSaid !== r.rid) { tcSoonSaid = r.rid; say('下一个就轮到你了'); }
  }

  // 悬停/点按说明：名字与归属 → 技能名 → 什么时候触发、效果 → 补充说明 → 本场状态（位置进度条）
  function tipHtml(id) {
    const base = R[id];
    if (!base) return '';
    const racing = vs && (vs.phase === 'race' || vs.phase === 'between');
    const r = racing ? vs.racers.find((x) => x.rid === id) : null;
    const owner = r ? vs.players[r.seat] : vs && vs.players.find((p) => p.hand.includes(id));
    const effective = r && (Object.prototype.hasOwnProperty.call(r, 'eff') ? r.eff : r.power);
    const pw = effective && effective !== id && R[effective] ? R[effective] : null;
    let st = '';
    if (r) {
      st = r.finished ? `<b>第 ${r.finished} 名</b>冲线` : r.out ? '已被淘汰'
        : `在第 <b>${r.pos}</b> 格 · 离终点 <b>${FIN - r.pos}</b> 格${r.tripped ? ' · <i>摔倒中</i>' : ''}`;
      st += `<span class="tip-bar"><em style="width:${r.finished ? 100 : r.out ? 0 : Math.round(r.pos / FIN * 100)}%"></em></span>`;
    } else if (owner && owner.used.includes(id)) st = '已经上过场';
    const mine = owner && owner.seat === you && isParticipant();
    return `<div class="tip-card" style="--rc:${rcol(id)}"><div class="tip-art">${art(id)}</div><div class="tip-body">
      <div class="tip-name"><b>${esc(base.name)}</b>${owner ? `<span style="--c:${PCOL[owner.seat % 6]}">${esc(pname(owner))}${mine ? ' · 你' : ''}</span>` : ''}</div>
      <div class="tip-skill"><em>技能</em><span class="sk">${esc(base.skill)}</span></div><p>${esc(base.text)}</p>${base.note ? `<small>${esc(base.note)}</small>` : ''}
      ${pw ? `<div class="tip-pw"><em>本场借用</em>「${esc(pw.skill)}」${esc(pw.text)}</div>` : ''}${st ? `<div class="tip-st">${st}</div>` : ''}</div></div>`;
  }
  let tipFor = null, tipTimer = null, tipTapFor = null;
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
  function hideTip() { $('#tip').hidden = true; tipFor = null; tipTapFor = null; clearTimeout(tipTimer); }
  function initTips() {
    $('#tip').setAttribute('role', 'tooltip');
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest('[data-tip]');
      if (t && t !== tipFor) showTip(t.dataset.tip, t);
    });
    document.addEventListener('pointerout', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) hideTip();
    });
    // 触屏：点一下看说明，再点同一处或点别处关闭；说明停留时间按字数给足
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && (e.pointerType === 'touch' || matchMedia('(hover: none)').matches)) {
        if (t.classList.contains('selectable') || t.closest('.pickable')) return;
        // 只有上一次也是点按打开的同一张说明才收起（悬停已打开的不算，避免点一下反而关掉）
        if (tipTapFor === t && tipFor === t && !$('#tip').hidden) { hideTip(); return; }
        showTip(t.dataset.tip, t);
        tipTapFor = t;
        clearTimeout(tipTimer);
        const len = ($('#tip').textContent || '').length;
        tipTimer = setTimeout(hideTip, Math.min(9000, Math.max(4000, len * 90)));
      } else if (!t) hideTip();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#tip').hidden) hideTip(); });
    window.addEventListener('scroll', hideTip, true);
    // 尺寸变化后重新收紧顺位条和窄屏玩家名
    let fitRaf = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(fitRaf);
      fitRaf = requestAnimationFrame(() => { fitDraftOrder(); fitPlayerNames(); });
    });
  }

  /* ================= 选秀：顺位条 & 我的队伍 ================= */
  function renderDraftOrder() {
    const box = $('#draftOrder');
    const d = vs && vs.draft;
    if (!d) { box.innerHTML = ''; return; }
    // 紧凑顺位条：每一手是一颗彩色小圆（玩家首字，你的那几手写「你」），正在选的那手展开成名字；
    // 末尾写「再过 n 位轮到你」。放不下时逐级收紧（去首字 → 去轮次 → 收起已选的手），整条始终完整可见、不横向滚动。
    const mine = isParticipant();
    const k0 = mine ? d.order.indexOf(you, d.idx) : -1;
    const ahead = k0 < 0 ? null : k0 - d.idx;
    const chips = d.order.map((seat, k) => {
      const p = vs.players[seat], me = mine && seat === you;
      const cls = `do ${k < d.idx ? 'past' : ''} ${k === d.idx ? 'now' : ''} ${me ? 'me' : ''}`;
      const label = k === d.idx ? (me ? '你来选' : pname(p)) : me ? '你' : pname(p).slice(0, 1);
      return `<span class="${cls}" style="--c:${PCOL[seat % 6]}" title="第 ${d.round * d.order.length + k + 1} 手 · ${esc(p.name)}"><span>${esc(label)}</span></span>`;
    });
    const cue = ahead == null ? (mine ? '<span class="do-cue">本轮你已选完</span>' : '')
      : `<span class="do-cue ${ahead === 0 ? 'mine' : ahead === 1 ? 'soon' : ''}">${ahead === 0 ? '轮到你选' : ahead === 1 ? '下一个是你' : `再过 ${ahead} 位到你`}</span>`;
    box.innerHTML = `<span class="do-label">第 ${d.round + 1}/2 轮</span><span class="do-row">${chips.join('')}</span>${cue}`;
    box.setAttribute('aria-label', `第 ${d.round + 1}/2 轮选秀，正在选：${pname(vs.players[d.order[d.idx]] || {})}${ahead != null ? `，${ahead === 0 ? '轮到你' : `还有 ${ahead} 位到你`}` : ''}`);
    fitDraftOrder();
  }
  function fitDraftOrder() {
    const box = $('#draftOrder');
    if (!box || !box.firstChild) return;
    box.classList.remove('fit1', 'fit2', 'fit3');
    for (const lv of ['fit1', 'fit2', 'fit3']) {
      if (box.scrollWidth <= box.clientWidth + 1) break;
      box.classList.add(lv);
    }
  }
  function renderMyTeam() {
    const box = $('#myTeam');
    const p = vs && isParticipant() ? vs.players[you] : null;
    if (!p) { box.innerHTML = ''; delete box.dataset.shown; return; }
    // data-slot = 队伍槽位序号（0–3，与 hand 下标一致），供选秀飞卡定位落点；只有新加入的那张播入场动画
    let shown = Number(box.dataset.shown || 0);
    if (shown > p.hand.length) shown = 0;
    const slots = p.hand.map((id, i) => `<div class="mt-slot filled ${i < shown ? 'old' : 'fresh'}" data-slot="${i}" data-tip="${id}" style="--rc:${rcol(id)}">${art(id)}<span>${esc(R[id].name)}</span></div>`);
    for (let i = p.hand.length; i < 4; i++) slots.push(`<div class="mt-slot ${i === p.hand.length ? 'next' : ''}" data-slot="${i}"><span>${i === p.hand.length ? '下一位' : '待选'}</span></div>`);
    box.innerHTML = `<span class="mt-label">你的队伍<small>${p.hand.length}/4</small></span>${slots.join('')}`;
    box.dataset.shown = p.hand.length;
  }

  /* ================= 赛况 / 解说 ================= */
  // 赛况：AI 名字去掉「（AI）」后缀（行首色点已经标明是谁）；同时记下本回合最近几条，供技能解说找「造成了什么」
  let feedLog = [];
  function addFeed(text, cls = '', seat) {
    if (!text) return;
    const f = $('#feed');
    const ln = document.createElement('div');
    ln.className = `ln ${cls}`;
    if (seat != null && seat >= 0) { ln.classList.add('p'); ln.style.setProperty('--c', PCOL[seat % 6]); }
    const shown = String(text).replace(/（AI）/g, '');
    ln.textContent = shown;
    f.appendChild(ln);
    while (f.children.length > 160) f.firstChild.remove();
    f.scrollTop = f.scrollHeight;
    if (cls === 'turn' || cls === 'race') feedLog = [];
    // 掷骰、主移动算式不算技能的效果
    else if (!/掷出|重掷|主移动：/.test(shown)) feedLog.push({ text: shown, cls, seat });
    if (feedLog.length > 6) feedLog.shift();
  }
  // 技能解说的素材：谁（玩家的选手）发动了哪个技能，造成了什么。
  // 引擎先播放效果事件、再发 power 事件，所以「效果」取本回合 power 之前最近的一条赛况；
  // 事件里带 targets（WP-A 补充，可能缺失）时点名受影响的选手。返回给 commentary() 的对象。
  function skillLine(e) {
    if (!e || !vs) return null;
    const r = vr(e.rid);
    const pw = R[e.key] || R[e.rid];
    if (!pw || !R[e.rid]) return null;
    const owner = r ? vs.players[r.seat] : null;
    const who = `${owner ? `${pname(owner)}的` : ''}${R[e.rid].name}`;
    const borrowed = e.key && e.key !== e.rid && R[e.key] ? R[e.key].name : '';
    const targets = (Array.isArray(e.targets) ? e.targets : []).map((t) => (typeof t === 'string' ? t : t && t.rid)).filter((rid) => rid && R[rid] && rid !== e.rid);
    const last = feedLog.length ? feedLog[feedLog.length - 1].text : '';
    feedLog = [];
    let effect = last;
    if (!effect && targets.length) effect = `影响了 ${targets.map((rid) => { const o = vr(rid); return o ? `${pname(vs.players[o.seat])}的${R[rid].name}` : R[rid].name; }).join('、')}`;
    if (!effect) effect = pw.text.split(/[。；]/)[0];
    // 效果句以发动者开头时去掉重复的主语
    if (effect.startsWith(who)) effect = effect.slice(who.length).replace(/^[：:\s]+/, '');
    return { kind: 'skill', seat: r ? r.seat : null, who, skill: pw.skill, borrowed, effect, targets };
  }

  // 解说条：可见文字随事件更新；读屏只播报节流后的摘要（同一句不重复，至少间隔 2.6 秒，期间只保留最新一句）
  let comTimer = null, comSaid = '', comPending = '', comSayTimer = null;
  function say(text) {
    if (!text) return;
    comPending = text;
    if (comSayTimer) return;
    const flush = () => {
      comSayTimer = null;
      const c = $('#commentary');
      if (!comPending || comPending === comSaid || !c) { comPending = ''; return; }
      let s = $('.com-sr', c);
      if (!s) { s = document.createElement('div'); s.className = 'com-sr sr-only'; c.appendChild(s); }
      s.textContent = comSaid = comPending;
      comPending = '';
      comSayTimer = setTimeout(flush, 2600);
    };
    flush();
  }
  function commentary(text) {
    const c = $('#commentary');
    if (!c.hasAttribute('aria-live')) { c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'polite'); c.setAttribute('aria-atomic', 'false'); }
    let vis = $('.com-vis', c);
    if (!vis) { c.innerHTML = '<div class="com-vis" aria-hidden="true"></div><div class="com-sr sr-only"></div>'; vis = $('.com-vis', c); }
    const info = text && typeof text === 'object' ? text : null;
    let html = '', plain = '';
    if (info && info.kind === 'skill') {
      // 画面上的技能提示由 skillCallout 的小提示条负责，解说条里不再重复，只给读屏播报
      plain = `${info.who} 发动「${info.skill}」：${info.effect}`;
    } else if (text) {
      plain = String(text).replace(/（AI）/g, '');
      html = `<span>${esc(plain)}</span>`;
    }
    vis.innerHTML = html;
    clearTimeout(comTimer);
    if (html) comTimer = setTimeout(() => { vis.innerHTML = ''; }, info ? 3800 : 3200);
    if (plain) say(plain);
  }
  function setDice(html, label) {
    const z = $('#diceZone');
    z.innerHTML = html || '';
    if (label) z.setAttribute('aria-label', label); else z.removeAttribute('aria-label');
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
    dRound = null;
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
  // 结算停留（Timing.FIXED）：给人读分数，不随倍速缩短，减少动态效果时也照样停；只有积压快进时跳过。
  // skipHold() 供结果浮层的「继续」按钮提前结束停留。
  let holdRelease = null;
  function hold(ms, epoch) {
    if (epoch !== animationEpoch) return Promise.reject(CANCELLED);
    if (fast) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { reject, timer: null };
      const done = () => {
        clearTimeout(w.timer); pendingWaits.delete(w);
        if (holdRelease === done) holdRelease = null;
        epoch === animationEpoch ? resolve() : reject(CANCELLED);
      };
      w.timer = setTimeout(done, ms);
      holdRelease = done;
      pendingWaits.add(w);
    });
  }
  function skipHold() { if (holdRelease) holdRelease(); }
  // 结算浮层的「继续」（WP-C 的 #ovNext）：提前结束停留，让下一场接着播；「看看赛道」不放行，棋盘留着给人看
  document.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('#ovNext')) skipHold(); });
  // 等结算浮层真正收起（停留期内被推迟的收起 + 退场动画）再播下一场开场，横幅不会压在结果上
  function overlayGone(epoch) {
    if (epoch !== animationEpoch) return Promise.reject(CANCELLED);
    const ov = $('#overlay');
    const busy = () => overlayKind === 'results' || (!ov.hidden && ov.classList.contains('out'));
    if (fast || !busy()) return Promise.resolve();
    const end = performance.now() + Timing.FIXED.raceEnd + 800;
    return new Promise((resolve, reject) => {
      const w = { reject, timer: null };
      const tick = () => {
        if (epoch !== animationEpoch) { pendingWaits.delete(w); reject(CANCELLED); return; }
        if (fast || !busy() || performance.now() > end) { pendingWaits.delete(w); resolve(); return; }
        w.timer = setTimeout(tick, 60);
      };
      pendingWaits.add(w);
      w.timer = setTimeout(tick, 60);
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
        const evs = causalOrder(b.events);
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (epoch !== animationEpoch) return;
          if (fast && MOTION_EVENTS.has(e.t)) {
            // fast 也可能在批次中途被切回前台打开，这里按需建账
            if (!syncAcc || syncAcc.epoch !== epoch) syncAcc = { n: 0, before: tokenSpots(), epoch };
            syncAcc.n++;
          }
          playAhead = { list: evs, i };
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
        fast = false; playing = false; playAhead = null;
        renderPlayers(); renderPrompt(); syncFinalActions();
        flushSync();
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
    if (await playV2Event(e, epoch, pause)) return; // 二代新事件与特殊格
    switch (e.t) {
      case 'rollOff': {
        const who = e.reason === 'draft' ? '选秀顺序' : '第一场先手';
        const html = `<div class="roll-off">${e.rolls.map((r) => `<div class="ro"><div class="die land">${sdie(r.v)}</div><span style="color:${PCOL[r.seat % 6]}">${esc(vs.players[r.seat].name)}</span></div>`).join('')}</div>`;
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
        dRound = { cards: e.cards.slice(), taken: {} };
        dSel = null;
        if (e.order) vs.draft = { order: e.order, idx: 0, round: e.round };
        $('#draftTitle').textContent = e.round === 0 ? '第一轮选秀' : '第二轮选秀';
        renderDraft(true);
        for (let i = 0; i < Math.min(6, e.cards.length); i++) animationLater(() => Sound.card(), i * 70);
        await pause(1000);
        break;
      case 'drafted': {
        const el = $(`#draftCards .rcard[data-id="${e.rid}"]`);
        vs.players[e.seat].hand.push(e.rid);
        if (dRound) dRound.taken[e.rid] = e.seat;
        if (vs.draft) vs.draft.idx++;
        renderDraftOrder();
        renderMyTeam();
        renderPlayers();
        // 被选走的卡先被「拎起」，复制一张飞向该玩家的队伍栏/玩家卡；原卡留在原位变灰，标上谁选走的
        const target = el && !el.hidden && !fast && !reducedMotion.matches ? flyTarget(e.seat, vs.players[e.seat].hand.length - 1) : null;
        if (target) {
          el.classList.add('lift');
          el.style.setProperty('--c', PCOL[e.seat % 6]);
          await pause(160);
          // 起飞「咻」、落进队伍「啪嗒」；旧 sound.js 没有这两个音时退回原来的翻卡声
          if (!playSfx('swish')) Sound.card();
          flyCard(el, target, () => playSfx('cardLand'));
          await pause(440);
        } else {
          Sound.card();
          await pause(fast ? 0 : 200);
        }
        vs.faceUp = vs.faceUp.filter((id) => id !== e.rid);
        if (el && el.isConnected) {
          el.classList.remove('lift', 'pickable', 'tap-hint', 'chosen');
          el.style.visibility = '';
          el.onclick = null;
          el.classList.add('taken');
          const o = document.createElement('span');
          o.className = 'owner taken-by'; o.style.setProperty('--c', PCOL[e.seat % 6]); o.textContent = `${vs.players[e.seat].name.replace(/（AI）$/, '')} 选走`;
          $('.art', el).appendChild(o);
          el.tabIndex = -1;
          if (phoneDraft()) el.onclick = () => selectDraftTile(el.dataset.id);
        }
        renderDraftDetail();
        break;
      }
      case 'firstPlayer':
        commentary(e.text);
        await pause(700);
        break;
      case 'raceIntro': {
        hideOverlay();
        // 结算浮层还在停留或正在退场：等它收起，再清棋盘、上横幅
        await overlayGone(epoch);
        vs.phase = 'pick';
        vs.raceNo = e.race;
        vs.track = e.track;
        vs.racers = [];
        vs.curSeat = null;
        $('#tokens').innerHTML = '';
        setDice('');
        renderAll();
        addFeed(`第 ${e.race} 场 · ${TRACKS[e.track].name}（金 ${e.gold} / 银 ${e.silver}）`, 'race');
        // 横幅完全退场后赛道名才淡入，避免两层标题叠在一起
        const ms = banner(`第 ${e.race} 场 · ${TRACKS[e.track].name}`, `冠军 ${e.gold} 分 · 亚军 ${e.silver} 分`, e.track === 'wild');
        const ct = $('#centerTrack');
        ct.classList.remove('ct-in'); void ct.offsetWidth;
        ct.style.setProperty('--ctd', `${fast || reducedMotion.matches ? 0 : Math.round(ms * 0.92)}ms`);
        ct.classList.add('ct-in');
        Sound.reveal();
        await pause(1800);
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
        spotlight(e.rid);
        await pause(e.ai ? 200 : 330);
        break;
      }
      case 'recover': {
        const r = vr(e.rid); if (r) r.tripped = false;
        layoutTokens();
        floater(e.rid, '爬起来了', '');
        await pause(e.ai ? 340 : 420);
        break;
      }
      case 'roll': {
        const r = vr(e.rid);
        const cap = `${r ? esc(vs.players[r.seat].name) : ''}${e.reroll ? ' 重掷' : ''}`;
        const T = Timing.ROLL[e.ai ? 'ai' : 'human'];
        setDice(`<div class="die rolling sk-die">${sdie(1 + Math.floor(Math.random() * 6), { tilt: Math.round(Math.random() * 50 - 25) })}</div>`, '掷骰中');
        Sound.dice();
        const spin = setInterval(() => { if (epoch !== animationEpoch) return; const d = $('#diceZone .die.rolling'); if (d) d.innerHTML = sdie(1 + Math.floor(Math.random() * 6), { tilt: Math.round(Math.random() * 50 - 25) }); }, 90);
        animationIntervals.add(spin);
        await pause(T.spin);
        clearInterval(spin); animationIntervals.delete(spin);
        setDice(`<div class="die land sk-die" style="--c:${r ? PCOL[r.seat % 6] : INK}">${sdie(e.value, 'win')}<div class="die-cap">${cap}</div><div class="die-n" aria-hidden="true">前进 ${e.value} 格</div></div>`, `掷出 ${e.value} 点，前进 ${e.value} 格`);
        // 「叮」响在点数落到棋子上的那一刻：后面跟着 calc 的，由 calc 的飞点落地时响；没有加减值的，定格的骰点就是最终点数
        if (!fast && !calcFollows(e)) playSfx('diceLand', e.value);
        await pause(T.land);
        break;
      }
      case 'calc': {
        const mods = e.mods.map((m) => `<span class="m ${m.v < 0 ? 'neg' : 'pos'}">${esc(m.label)} ${m.v > 0 ? '+' : ''}${m.v}</span>`).join('');
        setDice(`<div class="calc"><div class="die" style="width:calc(56*var(--u));height:calc(56*var(--u))">${e.base <= 6 ? sdie(e.base) : ''}</div>${e.base > 6 ? `<b>${e.base}</b>` : ''}${mods}<span>=</span><span class="eq">${e.total}</span></div>`, `主移动 ${e.total} 格`);
        await pause(e.ai ? 320 : 500);
        // 结果小标签从骰子区飞到要走的棋子身上
        if (!flyChip($('#diceZone .calc .eq'), e.rid, e.total, () => playSfx('diceLand', e.total)) && !fast) playSfx('diceLand', e.total);
        await pause(e.ai ? 240 : 350);
        break;
      }
      case 'move': {
        const r = vr(e.rid);
        if (!r) break;
        const el = tokenEl(r);
        const back = e.to < e.from;
        // 主移动：先逐格预亮路径、落点放幽灵棋子，再开始跳
        const preview = e.kind === 'main' ? previewPath(r, e.path, Timing.previewMs(e) / speed) : null;
        el.classList.toggle('quick', !!e.ai);
        if (preview) await pause(Timing.previewMs(e));
        let i = 0;
        try {
          for (const p of e.path) {
            r.pos = p === FIN ? FIN : p;
            layoutTokens();
            const hop = $('.hop', el);
            hop.classList.remove('go'); void hop.offsetWidth; hop.classList.add('go');
            if (back) Sound.back(); else Sound.hop(i);
            i++;
            await pause(Timing.stepMs(e));
          }
        } finally { if (preview) preview(); }
        r.pos = e.to;
        if (e.kind === 'arrow') pulseCell(e.to);
        layoutTokens();
        if (e.kind === 'main') buzz('land', e.rid);
        await pause(e.ai ? 90 : 140);
        break;
      }
      case 'warp': {
        const r = vr(e.rid); if (!r) break;
        const el = tokenEl(r);
        trail(el, cellCenter(e.to), 'warp');
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
        trail(ea, cellCenter(e.pa), 'swap'); trail(eb, cellCenter(e.pb), 'swap', true);
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
        // 技能提示卡：发动者亮圈 + 卡片（头像 / 技能名 / 一句话），连线指向受影响的人（WP-A）
        const voiced = skillCallout(e.rid, e.key, powerTargets(e));
        commentary(skillLine(e)); // WP-B：技能解说（谁发动、造成了什么）
        // 提示卡弹出时已响 callout；没弹卡（快进等）或旧 sound.js 时才用原来的 power 音，免得两声叠在一起
        if (!voiced) Sound.power();
        await pause(e.ai ? 520 : 640);
        break;
      }
      case 'trip': {
        const r = vr(e.rid); if (r) r.tripped = true;
        layoutTokens();
        renderTurnCard();
        knock(e.rid);
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
        setDice(`<div class="duel-dice"><div class="die land">${sdie(e.ra)}<div class="die-cap">${esc(rname(e.a))}</div></div><b class="vs">VS</b><div class="die land">${sdie(e.rb)}<div class="die-cap">${esc(rname(e.b))}</div></div></div>`);
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
        await pause(560);
        // 号角由 showResultsOverlay 在小领奖台柱子升完后接上
        showResultsOverlay(e);
        // 结果至少停 Timing.FIXED.raceEnd，不随倍速缩短；服务端排程同样单独累加
        await hold(Timing.FIXED.raceEnd, epoch);
        break;
      }
      case 'gameOver':
        vs.phase = 'over';
        // 号角改由 showFinalOverlay 在领奖台柱子升完后接上（浮层可能要等单场结算停够才出来）
        finalCheer = true;
        showFinalOverlay(e);
        confetti(260);
        await pause(560);
        await hold(Timing.FIXED.gameOver, epoch);
        break;
      default: break;
    }
  }

  // 返回横幅的总时长（ms），调用方据此安排后续淡入
  function banner(title, sub, wild) {
    for (const old of $$('.banner')) old.remove();
    const ms = Math.round(1600 / Math.min(speed, 1.5));
    const b = document.createElement('div');
    b.className = `banner ${wild ? 'wild' : ''}`;
    b.innerHTML = `<div style="animation-duration:${ms}ms"><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
    document.body.appendChild(b);
    animationLater(() => b.remove(), ms + 80);
    return ms;
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

  /* ---------- WP-A：因果、跟随与快进提示 ---------- */
  let playAhead = null; // 当前批次（已按因果重排）与播放下标，供技能卡推断受影响者
  const MOTION_EVENTS = new Set(['move', 'warp', 'swap', 'trip', 'out', 'finish', 'power', 'roll', 'chip']);
  // 引擎先结算效果再报技能；播放时把技能提到它自己的效果前面，让「谁发动 → 影响了谁」按因果顺序出现
  const POWER_EFFECTS = {
    banana: ['trip'], babayaga: ['trip'], mouth: ['out'], flipflop: ['swap'], hypnotist: ['warp'], thirdwheel: ['warp'],
    hugebaby: ['warp', 'info'], stickler: ['blocked'], sisyphus: ['chip', 'warp', 'info'], loser: ['chip'],
    centaur: ['info', 'move'], cheerleader: ['info', 'move'], partyanimal: ['info', 'move'], heckler: ['info', 'move'],
    romantic: ['info', 'move'], inchworm: ['info', 'move'], lackey: ['info', 'move'], dicemonger: ['info', 'move'],
    scoocher: ['info', 'move'], suckerfish: ['move'], legs: ['info'], hare: ['info'], skipper: ['info'], genius: ['info'],
  };
  const MOVES_OTHERS = new Set(['centaur', 'cheerleader', 'partyanimal']);
  function causalOrder(events) {
    if (!events.some((e) => e.t === 'power')) return events;
    const out = events.slice();
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (e.t !== 'power') continue;
      const kinds = POWER_EFFECTS[e.key];
      if (!kinds) continue;
      const src = e.rid, tg = new Set(e.targets || []);
      const srcRacer = vs && vs.racers ? vr(src) : null;
      const related = (x) => {
        if (!kinds.includes(x.t)) return false;
        if (x.t === 'info') return x.rid === src;
        if (x.t === 'swap') return x.a === src || x.b === src;
        if (x.t === 'chip') return !!srcRacer && x.seat === srcRacer.seat;
        if (x.t === 'move') return x.kind !== 'main' && (x.rid === src || (MOVES_OTHERS.has(e.key) && (tg.has(x.rid) || e.key === 'partyanimal')));
        return x.rid === src || tg.has(x.rid);
      };
      let j = i;
      while (j > 0 && related(out[j - 1])) j--;
      if (j < i) { out.splice(i, 1); out.splice(j, 0, e); }
    }
    return out;
  }
  // 受影响者：优先用服务端给的 targets，否则在本批次里往后看到下一个回合/技能为止
  function powerTargets(e) {
    if (e.targets && e.targets.length) return e.targets.filter((x) => x !== e.rid);
    const got = [];
    if (!playAhead) return got;
    const { list, i } = playAhead;
    for (let k = i + 1; k < list.length && got.length < 3; k++) {
      const x = list[k];
      if (['power', 'turn', 'roll', 'calc', 'raceEnd', 'finish'].includes(x.t) || (x.t === 'move' && x.kind === 'main')) break;
      const ids = x.t === 'swap' ? [x.a, x.b] : ['trip', 'out', 'warp', 'move', 'blocked'].includes(x.t) ? [x.rid] : [];
      for (const id of ids) if (id && id !== e.rid && !got.includes(id)) got.push(id);
    }
    return got;
  }
  const tokenOf = (rid) => rid && $(`#tokens .token[data-rid="${rid}"]`);
  // 棋子在棋盘坐标系（viewBox 单位）里的位置
  function tokenPt(el) {
    const [W, H] = VB();
    return { x: parseFloat(el.style.left) / 100 * W, y: parseFloat(el.style.top) / 100 * H };
  }
  function cellCenter(p) { const c = cellRect(p >= FIN ? FIN : Math.max(0, p)); return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }
  function restartClass(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    animationLater(() => el.classList.remove(cls), ms);
  }
  function spotlight(rid) { if (!fast) restartClass(tokenOf(rid), 'spot', 900); }
  function knock(rid) { if (!fast) { restartClass(tokenOf(rid), 'sk-hit', 560); buzz('hit', rid); } }
  // 震动反馈（WP-C 提供 haptic）：只给自己的棋子，快进时不震；没有 haptic 时什么都不做
  function buzz(kind, rid) {
    if (fast || typeof haptic !== 'function') return;
    const r = rid && vs ? vr(rid) : null;
    if (r && r.seat === you) haptic(kind);
  }
  // 挂在 #floaters 上的 SVG 弧线层（坐标与赛道 viewBox 一致）
  function arcLayer() {
    let svg = $('#floaters .sk-arcs');
    const [W, H] = VB();
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'sk-arcs');
      svg.setAttribute('aria-hidden', 'true');
      $('#floaters').appendChild(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    return svg;
  }
  function arcPath(a, b, bend) {
    const [W, H] = VB();
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    // 弧线朝棋盘中心鼓起，避免压在赛道外沿；bend 为负时反向（换位的第二条线）
    let nx = -dy / len, ny = dx / len;
    if ((W / 2 - mx) * nx + (H / 2 - my) * ny < 0) { nx = -nx; ny = -ny; }
    const k = Math.min(len * bend, 120);
    return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx + nx * k).toFixed(1)} ${(my + ny * k).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  function drawArc(a, b, cls, life, color) {
    if (fast || reducedMotion.matches || Math.hypot(b.x - a.x, b.y - a.y) < 8) return;
    const svg = arcLayer();
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `sk-arc ${cls}`);
    if (color) g.style.setProperty('--ac', color);
    const d = arcPath(a, b, cls === 'swap2' ? 0.2 : cls === 'swap' ? -0.2 : 0.28);
    g.innerHTML = `<path class="under" d="${d}" pathLength="1"/><path class="over" d="${d}" pathLength="1"/><circle class="hit" cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="18"/>`;
    svg.appendChild(g);
    animationLater(() => g.classList.add('out'), life);
    animationLater(() => g.remove(), life + 320);
  }
  function trail(el, to, kind, second) {
    if (!el || !el.style.left) return;
    drawArc(tokenPt(el), to, second ? 'swap2' : kind, 620 / Math.min(speed, 1.5), el.style.getPropertyValue('--c'));
  }
  // 技能提示：棋盘顶部一条细小的单行提示（不压骰子、不压行动卡）；发动者棋子亮一圈，受影响者有弧线与抖动
  function skillCallout(rid, key, targets = []) {
    const info = R[key];
    if (!info || fast) return false;
    const el = tokenOf(rid);
    const r = vr(rid);
    const board = $('#board');
    for (const old of $$('.skt', board)) { old.classList.add('out'); setTimeout(() => old.remove(), 200); }
    const col = r ? PCOL[r.seat % 6] : INK;
    const tip = document.createElement('div');
    tip.className = 'skt';
    tip.style.setProperty('--c', col);
    // 照 APK：只在发动者头顶弹一个对话气泡，里面只有技能名
    tip.innerHTML = `<b>${esc(info.skill)}</b>`;
    board.appendChild(tip);
    if (el) {
      const br = board.getBoundingClientRect(), tr = el.getBoundingClientRect(), tw = tip.offsetWidth;
      const cx = tr.left + tr.width / 2 - br.left;
      tip.style.left = `${Math.min(Math.max(cx, tw / 2 + 4), br.width - tw / 2 - 4)}px`;
      tip.style.top = `${Math.max(tr.top - br.top - 4, tip.offsetHeight + 4)}px`;
      tip.style.setProperty('--tail', `${cx - Math.min(Math.max(cx, tw / 2 + 4), br.width - tw / 2 - 4)}px`);
    }
    const voiced = playSfx('callout');
    const life = reducedMotion.matches ? 1000 : Math.max(800, 1300 / speed);
    animationLater(() => tip.classList.add('out'), life);
    animationLater(() => tip.remove(), life + 220);
    if (el) restartClass(el, 'sk-cast', 1000);
    // 解说文字由 WP-B 在 case 'power' 里统一出（commentary(skillLine(e))），这里只管画面
    for (const t of targets) {
      const tel = tokenOf(t);
      if (!tel || !el || t === rid) continue;
      drawArc(tokenPt(el), tokenPt(tel), 'power', Math.max(700, 1100 / speed), col);
      // 同一帧多枚棋子被击中时 Sound.hit 内部会合并成一声
      animationLater(() => { restartClass(tel, 'sk-hit', 560); playSfx('hit'); buzz('hit', t); }, reducedMotion.matches ? 0 : 380 / Math.min(speed, 1.5));
    }
    return voiced;
  }
  // 主移动预览：路径逐格亮起，落点放一个幽灵棋子；返回清理函数
  function previewPath(r, path, windowMs = Infinity) {
    if (fast || reducedMotion.matches || !path || !path.length) return null;
    const cells = [];
    path.forEach((p, k) => {
      const c = $(`#trackSvg .cell[data-p="${p}"]`);
      if (!c) return;
      // 每隔一格滴答一次（Sound.tick 自带 60ms 节流，40ms 一格会被吞掉一半），音高逐格上行
      if (k % 2 === 0 && k * 40 <= 320 && k * 40 < windowMs - 10) animationLater(() => playSfx('tick', k / 2), k * 40);
      c.style.setProperty('--d', `${Math.min(k * 40, 320)}ms`);
      c.classList.remove('path-lit'); void c.getBoundingClientRect(); c.classList.add('path-lit');
      cells.push(c);
    });
    const [W, H] = VB();
    const end = cellCenter(path[path.length - 1]);
    const g = document.createElement('div');
    g.className = 'ghost-token';
    g.style.setProperty('--c', PCOL[r.seat % 6]);
    g.style.left = `${end.x / W * 100}%`;
    g.style.top = `${end.y / H * 100}%`;
    g.innerHTML = `<div class="gb">${art(r.rid)}</div>`;
    $('#floaters').appendChild(g);
    let done = false;
    const clean = () => {
      if (done) return;
      done = true;
      for (const c of cells) c.classList.remove('path-lit');
      g.classList.add('out');
      setTimeout(() => g.remove(), 240);
    };
    animationLater(clean, 6000);
    return clean;
  }
  // 骰子区的结果标签飞到棋子身上（和金币同一种弧线手感，WAAPI 驱动）
  // 返回是否真的飞了；onLand 在飞点落到棋子上时调用
  function flyChip(src, rid, v, onLand) {
    const to = tokenOf(rid);
    if (!src || !to || fast || reducedMotion.matches) return false;
    const a = src.getBoundingClientRect(), b = to.getBoundingClientRect();
    const c = document.createElement('div');
    c.className = 'fly-chip';
    c.textContent = v;
    c.style.left = `${a.left + a.width / 2}px`;
    c.style.top = `${a.top + a.height / 2}px`;
    document.body.appendChild(c);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height * 0.1 - (a.top + a.height / 2);
    const dur = 380 / Math.min(speed, 1.5);
    const anim = c.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 36}px)) scale(.9)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.55)`, opacity: 0.2 },
    ], { duration: dur, easing: 'cubic-bezier(.45, 0, .35, 1)', fill: 'forwards' });
    anim.onfinish = () => { c.remove(); restartClass(to, 'chip-land', 420); if (onLand) onLand(); };
    setTimeout(() => c.remove(), dur + 200);
    return true;
  }
  // 掷骰之后同一批里是否还有这名选手的 calc（加减值后的点数会再飞到棋子上）
  function calcFollows(e) {
    if (!playAhead) return false;
    const { list, i } = playAhead;
    for (let k = i + 1; k < list.length; k++) {
      const x = list[k];
      if (x.t === 'calc') return x.rid === e.rid;
      if (x.t === 'roll' || x.t === 'turn' || x.t === 'move') return false;
    }
    return false;
  }
  // 选秀飞卡：落点由 WP-B 的 data-fly-target / data-slot 提供，读不到就退回玩家卡；都没有返回 null
  function flyTarget(seat, slot) {
    const ok = (n) => {
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth ? n : null;
    };
    const mine = seat === you;
    return ok($(`[data-fly-target="seat-${seat}"]`))
      || (mine && (ok($(`#myTeam [data-slot="${slot}"]`)) || ok($$('#myTeam .mt-slot')[slot])))
      || ok($(`#players .prow[data-seat="${seat}"]`))
      || null;
  }
  function flyCard(el, target, onLand) {
    const a = el.getBoundingClientRect(), b = target.getBoundingClientRect();
    const c = el.cloneNode(true);
    c.classList.remove('pickable', 'deal', 'lift', 'gone');
    c.classList.add('fly-card');
    c.removeAttribute('id');
    Object.assign(c.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, visibility: 'visible' });
    c.style.setProperty('--w', `${a.width}px`);
    document.body.appendChild(c);
    el.style.visibility = 'hidden';
    const s = Math.max(0.18, Math.min(b.width / a.width, b.height / a.height, 1));
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const dur = 440 / Math.min(speed, 1.5);
    const anim = c.animate([
      { transform: 'translate(0, 0) scale(1.04) rotate(-2deg)', opacity: 1 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 30}px) scale(${(1 + s) / 2}) rotate(-8deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(0deg)`, opacity: 0.35 },
    ], { duration: dur, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'forwards' });
    anim.onfinish = () => { c.remove(); restartClass(target, 'fly-land', 520); if (onLand) onLand(); };
    setTimeout(() => c.remove(), dur + 250);
  }
  // 快进（积压或后台）跳过了动画：结束后提示一次，并让位置变了的棋子闪一下
  function tokenSpots() {
    const m = new Map();
    if (vs && vs.racers) for (const r of vs.racers) m.set(r.rid, `${r.pos}|${r.finished}|${r.out}`);
    return m;
  }
  // 后台标签页里服务端一批一批推送，每批各自 pump 一次：跳过的步数跨 pump 累计，回到前台再统一提示
  let syncAcc = null;
  function flushSync() {
    if (!syncAcc || document.hidden) return;
    const { n, before, epoch } = syncAcc;
    syncAcc = null;
    if (epoch === animationEpoch && n >= 4) syncHint(before, n);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !playing) flushSync(); });
  function syncHint(before, n) {
    if (!vs || $('#game').hidden) return;
    const fl = $('#floaters');
    for (const old of $$('.sync-hint', fl)) old.remove();
    const h = document.createElement('div');
    h.className = 'sync-hint';
    h.setAttribute('role', 'status');
    h.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l6 6-6 6M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>已快进 ${n} 步，同步到最新局面</span>`;
    fl.appendChild(h);
    playSfx('syncChime');
    animationLater(() => h.classList.add('out'), 2200);
    animationLater(() => h.remove(), 2600);
    if (before && vs.racers) {
      for (const r of vs.racers) {
        if (before.get(r.rid) === `${r.pos}|${r.finished}|${r.out}`) continue;
        restartClass(tokenOf(r.rid), 'sync-flash', 1300);
      }
    }
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
    skinButtons(ov);
    return ov;
  }
  function hideOverlay(instant) {
    const ov = $('#overlay');
    // 单场结算没停够时，下一场开场等非用户触发的收起先排队（用户点「继续 / 看看赛道」会先清掉停留）
    if (!instant && overlayKind === 'results' && holdForResults(() => { if (overlayKind === 'results') hideOverlay(); })) return;
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
    const cards = picks.map((p, k) => `<div class="flip ${p.seat === you ? 'mine' : ''}" style="--k:${k}"><div class="face">${rcard(p.rid, { mini: true })}</div><div class="face back"></div><div class="who" style="color:${PCOL[p.seat % 6]}">${esc(vs.players[p.seat].name)}${p.seat === you ? '（你）' : ''}</div></div>`).join('');
    showOverlay(`<div class="ov-box ${phoneDraft() ? 'pickig reveal' : 'card'}"><h2>第 ${vs.raceNo} 场 · 选手登场</h2><p class="sub">${TRACKS[vs.track].name}</p><div class="reveal-grid" style="--n:${picks.length}">${cards}</div><div style="height:30px"></div></div>`, 'reveal');
  }
  /* ---------- WP-C：单场结算 / 终局庆祝 ---------- */
  // 单场结算停留由 timing.js 统一定义（WP-A）；旧版没有这个常量时按 4.5 秒
  const RESULTS_DWELL = () => (window.Timing && Timing.FIXED && Timing.FIXED.raceEnd) || 4500;
  const RESULTS_NEXT_AT = 3000; // 「继续」按钮可点的时刻
  const FINAL_AFTER_RESULTS = 3000; // 最后一场结果至少停这么久才换终局
  let resultsShownAt = 0;
  let resultsHold = 0; // 结果浮层最早可被下一场出战替换的时刻
  let overlayDeferTimer = null;
  const raceCache = { gameId: null, byRace: {} };
  const animOk = () => !fast && !reducedMotion.matches;
  function cacheRace(e) {
    if (raceCache.gameId !== gameId) { raceCache.gameId = gameId; raceCache.byRace = {}; }
    raceCache.byRace[e.race] = { scores: e.scores.slice(), standings: e.standings.slice() };
  }
  // 每场结束后的累计分（race 从 1 开始）；快照与本局已播放的结算事件合并
  function raceScores() {
    const out = [];
    for (const r of (snap && snap.results) || []) out[r.race - 1] = { scores: r.scores, standings: r.standings };
    if (raceCache.gameId === gameId) for (const [k, v] of Object.entries(raceCache.byRace)) out[Number(k) - 1] = v;
    return out;
  }
  // 数字从 a 滚到 b；跳过动画时直接写终值
  function rollNumber(el, a, b, ms = 600, delay = 0) {
    if (!el) return;
    if (!animOk() || a === b) { el.textContent = String(b); return; }
    el.textContent = String(a);
    const epoch = animationEpoch;
    animationLater(() => {
      const t0 = performance.now();
      const tick = (now) => {
        if (epoch !== animationEpoch || !el.isConnected) return;
        const k = Math.min(1, Math.max(0, (now - t0) / ms));
        const ease = 1 - Math.pow(1 - k, 3);
        el.textContent = String(Math.round(a + (b - a) * ease));
        if (k < 1) requestAnimationFrame(tick);
        else { el.textContent = String(b); el.classList.add('landed'); }
      };
      requestAnimationFrame(tick);
    }, delay);
  }
  const ARROW = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v9.5M3.5 8.5L8 13l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  // 名次 FLIP：先按旧名次的位置摆放，到点再滑到新位置
  function flipRows(rows, delay, onGo) {
    if (!rows.length) return;
    const moved = rows.filter((r) => Number(r.dataset.from) !== Number(r.dataset.to));
    const settle = () => { for (const r of rows) { r.style.translate = ''; r.classList.add('settled'); } };
    if (!animOk() || !moved.length || rows.length < 2) { settle(); return; }
    const pitch = rows[1].offsetTop - rows[0].offsetTop;
    for (const r of moved) { r.classList.add('flip-prep'); r.style.translate = `0 ${(Number(r.dataset.from) - Number(r.dataset.to)) * pitch}px`; }
    animationLater(() => {
      for (const r of moved) { r.classList.remove('flip-prep'); r.classList.add('flip-go'); }
      if (onGo) onGo(moved);
      requestAnimationFrame(settle);
    }, delay);
  }
  function showResultsOverlay(e) {
    cacheRace(e);
    const st = e.standings.slice();
    const first = st.find((s) => s.finished === 1);
    const second = st.find((s) => s.finished === 2) || (first && first.bonus ? first : null);
    const idx = e.race - 1;
    const pod = (s, cls, label, pts, k) => (s ? `<div class="pod ${cls} wpc-pod" style="--c:${PCOL[s.seat % 6]};--k:${k}"><div class="who">${art(s.rid)}</div><div class="nm">${esc(vs.players[s.seat].name)}${s.seat === you ? '<em class="me-tag">你</em>' : ''}</div><div class="rn">${esc(R[s.rid].name)}</div><div class="blk"><span class="medal-no">${label}</span><small>+${pts} 分</small></div></div>` : '');
    const prevRes = e.race > 1 ? raceScores()[e.race - 2] : null;
    const prevScores = e.race === 1 ? vs.players.map(() => 0) : prevRes ? prevRes.scores : null;
    const order = (scores) => vs.players.map((p) => p.seat).sort((a, b) => scores[b] - scores[a] || a - b);
    const newOrder = order(e.scores);
    const oldOrder = prevScores ? order(prevScores) : newOrder;
    const tied = (scores) => scores.every((v) => v === scores[0]);
    const showMove = !!prevScores && e.race > 1 && !tied(prevScores);
    const rows = newOrder.map((seat, k) => {
      const p = vs.players[seat];
      const sc = e.scores[seat];
      const prev = prevScores ? prevScores[seat] : null;
      const gain = prev != null ? sc - prev : null;
      const from = oldOrder.indexOf(seat);
      const move = showMove ? from - k : 0;
      const r = st.find((x) => x.seat === seat);
      const place = r && r.finished ? `第 ${r.finished} 名冲线` : r && r.out ? '出局' : r ? `停在 ${r.pos} 格` : '';
      return `<div class="st-row wpc-row ${k === 0 ? 'top' : ''} ${seat === you ? 'me' : ''}" data-seat="${seat}" data-from="${showMove ? from : k}" data-to="${k}" style="--c:${PCOL[seat % 6]};animation-delay:${180 + k * 70}ms">`
        + `<span class="rk">${k + 1}</span>`
        + `<span class="st-name"><i class="dot"></i><span class="nm-t">${esc(p.name)}</span>${seat === you ? '<em class="me-tag">你</em>' : ''}<small class="st-place">${r ? esc(R[r.rid].name) : ''}${place ? ` · ${place}` : ''}</small></span>`
        + `<span class="mv ${move > 0 ? 'up' : move < 0 ? 'down' : ''}" ${move ? `aria-label="${move > 0 ? '上升' : '下降'} ${Math.abs(move)} 名"` : 'aria-hidden="true"'}>${move > 0 ? ARROW.up + move : move < 0 ? ARROW.down + -move : ''}</span>`
        + `<span class="gain ${gain ? 'pos' : 'zero'}">${gain != null ? `+<b>${gain}</b>` : ''}</span>`
        + `<span class="tot">${sc}</span></div>`;
    }).join('');
    const reason = e.reason === 'turn-limit' ? '<p class="sub wpc-note">回合数已到上限，按当前名次结算</p>' : e.reason === 'loop-limit' ? '<p class="sub wpc-note">技能连锁停不下来，按当前名次结算</p>' : '';
    showOverlay(`<div class="ov-box card wpc-results"><h2>第 ${e.race} 场结果</h2><p class="sub">${TRACKS[e.track].name} · 冠军 ${GOLD[idx]} 分 / 亚军 ${SILVER[idx]} 分</p>${reason}
      <div class="podium">${pod(second, 'p2', '2', SILVER[idx], 0)}${pod(first, 'p1', '1', GOLD[idx], 1)}</div>
      <div class="st-head" aria-hidden="true"><span></span><span>选手</span><span></span><span>本场</span><span>总分</span></div>
      <div class="standings">${rows}</div>
      <div class="ov-actions"><button class="btn" id="ovClose"><span class="ico">${icon('map')}</span>看看赛道</button><button class="btn primary wpc-next" id="ovNext" disabled><span class="wpc-ring" aria-hidden="true"></span><span class="lbl">继续</span><b class="cd"></b></button></div></div>`, 'results');
    resultsShownAt = performance.now();
    const dwell = RESULTS_DWELL();
    resultsHold = resultsShownAt + dwell;
    const ov = $('#overlay');
    // 小领奖台和终局一样由低到高升起（亚军 → 冠军），每根柱子升起时响一声，最后接号角；
    // 与 .wpc-pod .blk 的 animation-delay（200ms + k×300ms）对齐
    if (animOk() && typeof Sound.pillar === 'function') {
      const pods = [[second, 2, 200], [first, 1, 500]];
      pods.forEach(([x, i, ms]) => { if (x) animationLater(() => Sound.pillar(i), ms); });
      animationLater(() => Sound.fanfare(), 850);
    } else Sound.fanfare();
    // 分数：本场加分先弹出，总分随后滚动；名次再滑到新位置
    const rowEls = $$('.wpc-row', ov);
    rowEls.forEach((row, k) => {
      const seat = Number(row.dataset.seat);
      const prev = prevScores ? prevScores[seat] : e.scores[seat];
      const g = $('.gain b', row);
      if (g) rollNumber(g, 0, e.scores[seat] - prev, 450, 520 + k * 70);
      rollNumber($('.tot', row), prev, e.scores[seat], 600, 760 + k * 70);
    });
    flipRows(rowEls, 1500 + rowEls.length * 70, (moved) => {
      // 多人同时变动：玩家只听自己的升降；观众（没有自己的名次）只响一次
      const mine = isParticipant() ? moved.find((r) => Number(r.dataset.seat) === you) : moved[0];
      if (!mine) return;
      playSfx(Number(mine.dataset.to) < Number(mine.dataset.from) ? 'rankUp' : 'rankDown');
    });
    const mine = st.find((s) => s.seat === you);
    if (mine && mine.finished && animOk()) animationLater(() => haptic('finish'), 400);
    $('#ovClose').onclick = () => { Sound.click(); resultsHold = 0; clearTimeout(overlayDeferTimer); hideOverlay(); };
    const next = $('#ovNext');
    const cdEl = $('.cd', next);
    next.style.setProperty('--wait', `${Math.min(RESULTS_NEXT_AT, dwell)}ms`);
    const tick = () => {
      if (!next.isConnected || overlayKind !== 'results') return false;
      const t = performance.now();
      const left = Math.max(0, resultsHold - t);
      const ready = t - resultsShownAt >= Math.min(RESULTS_NEXT_AT, dwell);
      next.disabled = !ready;
      next.classList.toggle('waiting', !ready);
      cdEl.textContent = left > 0 ? `${Math.ceil(left / 1000)}` : '';
      return left > 0 || !ready;
    };
    tick();
    const iv = setInterval(() => { if (!tick()) { clearInterval(iv); animationIntervals.delete(iv); } }, 200);
    animationIntervals.add(iv);
    next.onclick = () => {
      Sound.click();
      resultsHold = 0;
      clearTimeout(overlayDeferTimer);
      hideOverlay();
      if (!playing && !queue.length) renderPrompt();
      else if (lastGameOver && vs && vs.phase === 'over') showFinalOverlay(lastGameOver, { now: true });
    };
  }
  // 单场结算还没停够时，下一场出战 / 终局先排队，到点再显示
  function holdForResults(fn, minMs) {
    if (overlayKind !== 'results' || fast) return false;
    const until = minMs != null ? resultsShownAt + minMs : resultsHold;
    // 测试钩子：一屏验收要在结算浮层上把各尺寸量完，期间一直让结果停着
    const left = window.__hnHoldResults ? 250 : until - performance.now();
    if (left <= 30) return false;
    clearTimeout(overlayDeferTimer);
    overlayDeferTimer = animationLater(fn, left);
    return true;
  }
  // 只有自己一名真人（其余都是 AI）的对局：一键原班人马重开，不再先回大厅
  function quickAgain() {
    return !!room && (room.mode || 'play') === 'play' && Array.isArray(room.seats) && room.seats.filter((s) => !s.ai).length === 1;
  }
  function againType() {
    return isSpectator() ? 'replay' : quickAgain() ? 'again' : 'lobby';
  }
  let finalReadyAt = 0;
  let finalCheer = false; // 本次终局浮层是否由 gameOver 事件带出（要放柱子音和号角）
  let finalReadyTimer = null;
  function syncFinalActions() {
    if (overlayKind !== 'final') return;
    const control = $('#finalReplayControl');
    if (!control) return;
    const host = room?.host === me.id;
    const spectator = isSpectator();
    const type = againType();
    if (host) {
      let again = $('#again', control);
      if (!again || again.dataset.navigation !== type) {
        control.innerHTML = `<button class="btn primary big wpc-again" id="again" data-navigation="${type}"><span class="ico">${icon(type === 'again' ? 'play' : spectator ? 'eye' : 'users')}</span><span class="lbl">${spectator ? '再看一局' : '再来一局'}</span></button>`;
        again = $('#again', control);
        skinButtons(control);
        again.onclick = () => {
          Sound.click();
          if (navigate(type, again)) { again.classList.add('is-loading'); $('.lbl', again).textContent = type === 'again' ? '正在重开…' : spectator ? '正在准备…' : '正在回大厅…'; }
          else denyCue();
        };
      }
      // 终局动画还在播时服务端会拒绝重开：按钮先显示等待进度，到点自动可点
      const wait = Math.max(0, finalReadyAt - performance.now());
      again.classList.toggle('waiting', wait > 0 && !navigationPending);
      if (wait > 0) again.style.setProperty('--wait', `${Math.round(wait)}ms`);
      again.disabled = connection !== 'ready' || !!navigationPending || wait > 0;
      if (!navigationPending && again.classList.contains('is-loading')) {
        again.classList.remove('is-loading');
        $('.lbl', again).textContent = spectator ? '再看一局' : '再来一局';
      }
      if (wait > 0) { clearTimeout(finalReadyTimer); finalReadyTimer = animationLater(syncFinalActions, wait + 30); }
    } else if ($('#again', control) || !control.firstChild) {
      control.innerHTML = `<span class="sub wpc-wait">${spectator ? '等房主开启下一场 AI 对局…' : '等房主开下一局…'}</span>`;
    }
  }
  function showFinalOverlay(e, { now = false } = {}) {
    lastGameOver = e;
    if (!now && holdForResults(() => showFinalOverlay(e, { now: true }), FINAL_AFTER_RESULTS)) return;
    const rows = e.scores.slice().sort((a, b) => b.score - a.score);
    const champs = e.champions.map((s) => vs.players[s].name).join('、');
    const races = raceScores();
    const nRaces = Math.max(4, races.length);
    const perRace = (seat) => Array.from({ length: nRaces }, (_, i) => {
      const cur = races[i] && races[i].scores ? races[i].scores[seat] : null;
      const prev = i === 0 ? 0 : races[i - 1] && races[i - 1].scores ? races[i - 1].scores[seat] : null;
      return cur == null || prev == null ? null : cur - prev;
    });
    // 领奖台上的形象：这名玩家拿分最多那一场派出的运动员
    const hero = (seat) => {
      const g = perRace(seat);
      let best = -1, rid = null;
      g.forEach((v, i) => { const s = races[i] && races[i].standings && races[i].standings.find((x) => x.seat === seat); if (s && v != null && v > best) { best = v; rid = s.rid; } });
      const p = vs.players[seat];
      return rid || (p && p.hand && p.hand[p.hand.length - 1]) || null;
    };
    const rankOf = (x) => 1 + rows.filter((y) => y.score > x.score).length;
    const head = `<div class="fx-head" aria-hidden="true" style="--races:${nRaces}"><span></span><span>选手</span>${Array.from({ length: nRaces }, (_, i) => `<span>第${i + 1}场</span>`).join('')}<span>总分</span></div>`;
    const list = rows.map((x, k) => {
      const g = perRace(x.seat);
      const best = Math.max(...g.map((v) => v || 0));
      const cells = g.map((v, i) => `<span class="fx-c ${v && v === best ? 'best' : ''} ${v ? '' : 'z'}" style="--d:${900 + k * 70 + i * 90}ms" aria-label="第 ${i + 1} 场 ${v == null ? '无' : v} 分">${v == null ? '–' : v}</span>`).join('');
      return `<div class="st-row wpc-frow ${e.champions.includes(x.seat) ? 'top' : ''} ${x.seat === you ? 'me' : ''}" data-seat="${x.seat}" style="--c:${PCOL[x.seat % 6]};animation-delay:${700 + k * 80}ms"><span class="rk">${rankOf(x)}</span><span class="st-name">${esc(vs.players[x.seat].name)}${x.seat === you ? '（你）' : ''}</span>${cells}<span class="tot">${x.score}</span></div>`;
    }).join('');
    const spectator = isSpectator();
    const podCol = (x, cls, k) => {
      if (!x) return '';
      const rid = hero(x.seat);
      const rank = rankOf(x);
      return `<div class="pod ${cls} m${Math.min(rank, 3)} wpc-fpod" style="--c:${PCOL[x.seat % 6]};--k:${k}"><div class="who">${rid ? art(rid) : ''}</div>${rank === 1 ? `<span class="crown" aria-hidden="true">${icon('crown')}</span>` : ''}<div class="nm">${esc(vs.players[x.seat].name)}${x.seat === you ? '<em class="me-tag">你</em>' : ''}</div><div class="blk"><span class="medal-no">${rank}</span><small><b class="pod-sc">${x.score}</b> 分</small></div></div>`;
    };
    // 领奖台从左到右 2–1–3，依次升起：先第 3 名，再第 2 名，冠军压轴
    const podium = `${podCol(rows[1], 'p2', 1)}${podCol(rows[0], 'p1', 2)}${podCol(rows[2], 'p3', 0)}`;
    const youWon = e.champions.includes(you);
    showOverlay(`<div class="ov-box card wpc-final ${youWon ? 'won' : ''}"><h2>总冠军：${esc(champs)}</h2><p class="sub">${youWon ? '你赢了！胡闹之王！' : spectator ? '四场 AI 对局已落幕，冠军诞生！' : '四场胡闹落幕，下次再战！'}</p>
      <div class="podium wpc-podium">${podium}</div>
      ${head}<div class="standings wpc-table" style="--races:${nRaces}">${list}</div>
      <div class="ov-actions"><span id="finalReplayControl"></span><button class="btn" id="toHome" data-navigation="leave"><span class="ico">${icon('door')}</span>回到首页</button><button class="btn" id="ovClose"><span class="ico">${icon('map')}</span>看看赛道</button></div></div>`, 'final');
    const ov = $('#overlay');
    for (const el of $$('.pod-sc', ov)) rollNumber(el, 0, Number(el.textContent), 700, 650);
    if (finalCheer) {
      finalCheer = false;
      if (animOk() && typeof Sound.pillar === 'function') {
        // 与 .wpc-fpod .blk 的 animation-delay（200ms + k×300ms）对齐：第 3、2、1 名依次升起，最后接号角
        [[rows[2], 3, 200], [rows[1], 2, 500], [rows[0], 1, 800]].forEach(([x, i, ms]) => { if (x) animationLater(() => Sound.pillar(i), ms); });
        animationLater(() => Sound.fanfare(), 1150);
      } else Sound.fanfare();
    }
    // 冠军压轴：最后一根柱子升起时第二次喷彩纸（冠军是你时）
    if (youWon && animOk()) {
      animationLater(() => confetti(160, innerWidth / 2, innerHeight * 0.3), 1250);
      animationLater(() => haptic('champ'), 300);
    }
    // 总冠军诞生：不论是不是你，都放一轮烟花
    if (animOk()) animationLater(() => fireworks(youWon ? 5 : 3), 900);
    finalReadyAt = performance.now() + (now ? 0 : (window.Timing ? Timing.eventMs({ t: 'gameOver' }) : 2000) / Math.max(1, speed));
    syncFinalActions();
    $('#toHome').onclick = () => { Sound.click(); if (navigate('leave', $('#toHome'))) $('#toHome').classList.add('is-loading'); };
    $('#ovClose').onclick = () => { Sound.click(); hideOverlay(); };
    if (hasKeyboard.matches) { const f = $('#again:not(:disabled)') || $('#toHome'); if (f) f.focus({ preventScroll: true }); }
  }

  function showPickOverlay(d) {
    if (d.kind === 'swapmeet') return showSwapMeetOverlay(d);
    const mineOpts = d.optionsBySeat[you];
    const answered = d.done.includes(you);
    const sending = !!(submitted && submitted.id === d.id);
    const key = `${d.id}:${answered}:${sending}:${connection}`;
    if (overlayKind === 'pick' && overlayDecision === key) { updatePickStatus(d); return; }
    // 单场结算还在展示：出战浮层排到结算停够之后，不把结果顶掉
    if (holdForResults(() => { if (!playing && !queue.length) renderPrompt(); })) return;
    const idx = vs.raceNo - 1;
    const hint = idx < 3 ? '后面的比赛分更高，王牌可以留到后面' : '最后一场，全力以赴！';
    const canPick = mineOpts && !answered && !sending && connection === 'ready';
    const cards = mineOpts && !answered ? mineOpts.map((o, k) => rcard(o.v, { cls: canPick ? 'pickable deal' : 'dim', k })).join('') : '';
    if (phoneDraft()) return showPickOverlayPhone(d, { key, canPick, answered, sending, cards, idx, hint, n: mineOpts && !answered ? mineOpts.length : 0 });
    showOverlay(`<div class="ov-box card"><h2>第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}</h2>
      <p class="sub">冠军 ${GOLD[idx]} 分 · 亚军 ${SILVER[idx]} 分 · ${sending ? '正在提交，等待服务器确认…' : connection !== 'ready' ? '断线中，重连同步后可重新选择' : canPick ? `派谁上场？${hint}` : answered ? '你的出牌已确认，等待其他人…' : '等待其他人出牌…'}</p>
      <div class="ov-cards" id="pickCards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div><div class="pick-status" id="pickStatus" hidden></div></div>`, 'pick');
    overlayDecision = key;
    updatePickStatus(d);
    fitOverlayCards(true);
    for (const el of $$('#pickCards .rcard')) {
      el.onclick = canPick ? () => { if (answer(d, el.dataset.id)) { Sound.card(); el.classList.add('chosen'); } } : () => { denyCue(); nudge(el); };
    }
    if (canPick) focusFirst('#pickCards .rcard.pickable:not([hidden])', `pick:${d.id}`);
  }
  // 手机出战：和选秀同一套「头像格 + 固定技能栏 + 底部确认」，点头像只查看，点「派 TA 上场」才提交
  let pSel = null, pSelFor = null;
  function showPickOverlayPhone(d, o) {
    if (pSelFor !== d.id) { pSelFor = d.id; pSel = null; }
    const sub = o.sending ? '正在提交，等待服务器确认…' : connection !== 'ready' ? '断线中，重连同步后可重新选择' : o.answered ? '你的出牌已确认，等待其他人…' : o.canPick ? `冠军 ${GOLD[o.idx]} 分 · 亚军 ${SILVER[o.idx]} 分` : '等待其他人出牌…';
    showOverlay(`<div class="ov-box pickig" style="--cols:${o.n <= 4 ? 2 : 3}"><h2>第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}</h2><p class="sub">${sub}</p>
      <div class="ov-cards pg-cards" id="pickCards">${o.cards}</div><div class="draft-detail pg-detail" id="pickDetail"></div><div class="pick-status" id="pickStatus" hidden></div></div>`, 'pick');
    overlayDecision = o.key;
    updatePickStatus(d);
    const detail = () => {
      const box = $('#pickDetail');
      if (!box) return;
      for (const c of $$('#pickCards .rcard')) c.classList.toggle('sel', c.dataset.id === pSel);
      const r = pSel && R[pSel];
      let info, btn;
      if (r) {
        box.style.setProperty('--rc', rcol(pSel));
        info = `<div class="dd-art">${art(pSel)}</div><div class="dd-tx"><div class="dd-name"><b>${esc(r.name)}</b><span class="sk">${esc(r.skill)}</span></div><p>${esc(r.text)}</p>${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>`;
      } else info = `<span>${o.canPick ? `点一下头像查看技能。${o.hint}` : o.answered ? '你的出战已确认' : '请稍候'}</span>`;
      if (o.answered || o.sending) btn = `<button class="dd-btn" disabled><b>${o.sending ? '提交中…' : '已确认'}</b><small>等待其他人</small></button>`;
      else if (!o.canPick) btn = '<button class="dd-btn" disabled><b>请稍候</b><small>同步中</small></button>';
      else if (!r) btn = '<button class="dd-btn" disabled><b>派 TA 上场</b><small>先点一个头像</small></button>';
      else btn = `<button class="dd-btn go"><b>派 TA 上场</b><small>第 ${vs.raceNo} 场 · ${esc(r.name)}</small></button>`;
      box.className = 'draft-detail pg-detail' + (r ? '' : ' empty');
      box.innerHTML = `<div class="dd-info">${info}</div>${btn}`;
      const go = $('.dd-btn.go', box);
      if (go) go.onclick = () => { if (answer(d, pSel)) { Sound.card(); $$('#pickCards .rcard').forEach((c) => { c.onclick = null; c.classList.remove('pickable'); }); const ch = $(`#pickCards .rcard[data-id="${pSel}"]`); if (ch) ch.classList.add('chosen'); } };
    };
    for (const el of $$('#pickCards .rcard')) {
      el.onclick = o.canPick ? () => { pSel = el.dataset.id; Sound.click(); detail(); } : () => { denyCue(); nudge(el); };
    }
    detail();
  }
  // 手机选择类弹层（跳蚤市场 / 复制 / 孵蛋…）：头像格 + 固定技能栏 + 底部确认，与选秀、出战同款
  function showChoosePhone(o) {
    const n = o.items.length;
    let sel = n === 1 && o.canPick ? o.items[0].v : null;
    const cards = o.items.map((it, k) => rcard(it.rid, { cls: o.canPick ? 'pickable deal' : 'dim', k }).replace('class="rcard', `data-v="${esc(it.v)}" class="rcard`)).join('');
    showOverlay(`<div class="ov-box pickig${n === 1 ? ' one' : ''}" style="--cols:${n === 3 ? 3 : n <= 4 ? 2 : 3};--lc:${Math.min(n, 4)}"><h2>${esc(o.title)}</h2><p class="sub">${esc(o.sub)}</p>
      <div class="ov-cards pg-cards" id="pickCards">${cards}</div><div class="draft-detail pg-detail" id="pickDetail"></div>${o.status ? '<div class="pick-status" id="pickStatus" hidden></div>' : ''}</div>`, o.kind);
    overlayDecision = o.decision;
    if (o.status) updatePickStatus(o.d);
    const send = (v) => { if (answer(o.d, v)) { Sound.card(); if (o.after) o.after(); } };
    const detail = () => {
      const box = $('#pickDetail');
      if (!box) return;
      for (const c of $$('#pickCards .rcard')) c.classList.toggle('sel', c.dataset.v === sel);
      const it = o.items.find((i) => i.v === sel), r = it && R[it.rid];
      let info, btn;
      if (r) {
        box.style.setProperty('--rc', rcol(it.rid));
        info = `<div class="dd-art">${art(it.rid)}</div><div class="dd-tx"><div class="dd-name"><b>${esc(r.name)}</b><span class="sk">${esc(r.skill)}</span></div><p>${esc(r.text)}</p>${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>`;
      } else info = `<span>${o.canPick ? '点一下头像，查看技能' : o.answered ? '你已决定' : '请稍候'}</span>`;
      if (o.answered || o.sending) btn = `<button class="dd-btn" disabled><b>${o.sending ? '提交中…' : '已确认'}</b><small>等待其他人</small></button>`;
      else if (!o.canPick) btn = '<button class="dd-btn" disabled><b>请稍候</b><small>同步中</small></button>';
      else if (!it) btn = `<button class="dd-btn" disabled><b>${esc(o.verb)}</b><small>先点一个头像</small></button>`;
      else btn = `<button class="dd-btn go" data-send="${esc(it.v)}"><b>${esc(it.t)}</b>${it.s ? `<small>${esc(it.s)}</small>` : ''}</button>`;
      const extra = o.canPick && o.extra.length ? `<div class="pg-extra">${o.extra.map((e) => `<button class="dd-btn alt" data-send="${esc(e.v)}"><b>${esc(e.label)}</b></button>`).join('')}</div>` : '';
      box.className = 'draft-detail pg-detail' + (r ? '' : ' empty');
      box.innerHTML = `<div class="dd-info">${info}</div>${btn}${extra}`;
      for (const b of $$('[data-send]', box)) b.onclick = () => send(b.dataset.send);
    };
    for (const el of $$('#pickCards .rcard')) {
      el.onclick = o.canPick ? () => { sel = el.dataset.v; Sound.click(); detail(); } : () => { denyCue(); nudge(el); };
    }
    detail();
  }
  // 出战 / 选择浮层里的卡牌放不下时分页
  function fitOverlayCards(fresh) {
    const box = $('#overlay .ov-cards');
    if (!box || $('#overlay').hidden) return;
    if (fresh && pagers.ov) pagers.ov.anchor = 0;
    paginate('ov', box, () => $$('.rcard', box), $('#ovPager'));
  }
  // 选人浮层底部只留一条细倒计时：别人选没选好与你无关，超时由服务器兜底
  let pickTimerTick = null;
  function updatePickStatus() {
    clearInterval(pickTimerTick); pickTimerTick = null;
    const box = $('#pickStatus');
    if (!box) return;
    const remain = deadlineAt - Date.now();
    if (!deadlineAt || remain <= 0 || remain > 120000) { box.hidden = true; return; }
    if (!timerDuration) timerDuration = remain;
    const total = timerDuration;
    box.hidden = false;
    box.innerHTML = '<em></em>';
    const bar = box.firstChild;
    const tick = () => {
      if (!box.isConnected) { clearInterval(pickTimerTick); pickTimerTick = null; return; }
      const ms = Math.max(0, deadlineAt - Date.now());
      bar.style.width = `${Math.min(100, ms / total * 100)}%`;
      box.classList.toggle('urgent', ms > 0 && ms <= 5000);
      if (!ms) { clearInterval(pickTimerTick); pickTimerTick = null; }
    };
    tick(); pickTimerTick = setInterval(tick, 200);
  }

  function showChooseOverlay(d, title, sub) {
    if (overlayKind === 'choose' && overlayDecision === d.id) return;
    const cardOpts = d.options.filter((o) => R[o.v]);
    const cards = cardOpts.map((o, k) => rcard(o.v, { cls: 'pickable deal', k })).join('');
    // 只有一张候选时，主操作就是「复制它 / 孵出它」，不用让人去猜要点卡牌
    const verb = d.kind === 'twin' ? '复制' : d.kind === 'egg' ? '孵出' : '选';
    const main = cardOpts.length === 1 ? `<button class="btn primary big wpc-main" data-v="${esc(cardOpts[0].v)}"><span class="ico">${icon(d.kind === 'twin' ? 'copy' : 'check')}</span>${verb}「${esc(R[cardOpts[0].v].name)}」</button>` : '';
    if (phoneDraft() && cardOpts.length && cardOpts.length <= 6) {
      const one = cardOpts.length === 1;
      return showChoosePhone({
        d, kind: 'choose', decision: d.id, title, sub, canPick: true, verb: verb === '选' ? '选 TA' : verb,
        items: cardOpts.map((o) => ({ v: o.v, rid: o.v, t: one ? `${verb}「${R[o.v].name}」` : '选 TA', s: one ? '' : R[o.v].name })),
        extra: d.options.filter((o) => !R[o.v]).map((o) => ({ v: o.v, label: o.label })),
        after: () => hideOverlay(),
      });
    }
    const extra = main + d.options.filter((o) => !R[o.v]).map((o) => `<button class="btn" data-v="${esc(o.v)}">${esc(o.label)}</button>`).join('');
    showOverlay(`<div class="ov-box card"><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p><div class="ov-cards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div><div class="ov-actions">${extra}</div></div>`, 'choose');
    overlayDecision = d.id;
    fitOverlayCards(true);
    for (const el of $$('#overlay .rcard, #overlay [data-v]')) {
      el.onclick = () => { if (answer(d, el.dataset.id || el.dataset.v)) { Sound.card(); el.classList.add('chosen'); hideOverlay(); } };
    }
    focusFirst('#overlay .wpc-main, #overlay .rcard.pickable:not([hidden])', `choose:${d.id}`);
  }

  /* ================= 决策面板 ================= */
  /* ---------- 底部与弹层重构：双行按钮（Skin 风格）与决策遮罩 ---------- */
  // 「标题（说明）」「标题：说明」拆成双行；「就用 5」「就走 7 格」写成「确认移动 / 前进 N 格」
  function skSplit(label) {
    const t = String(label == null ? '' : label).trim();
    let m = /^就(?:用|走)\s*(\d+)(?:\s*格)?$/.exec(t);
    if (m) return ['确认移动', `前进 ${m[1]} 格`];
    m = /^走\s*(\d+)\s*格$/.exec(t);
    if (m) return [`走 ${m[1]}`, `前进 ${m[1]} 格`];
    m = /^(.{1,10}?)[（(](.{1,16})[）)]\s*$/.exec(t) || /^(.{1,8}?)[：:]\s*(.{1,14})$/.exec(t);
    return m ? [m[1].trim(), m[2].trim()] : [t, ''];
  }
  function skBtn(title, sub, kind, attrs = '', cls = '', aria = '') {
    const label = aria || (sub ? `${title}，${sub}` : title);
    return `<button type="button" class="sk-btn ${kind === 'secondary' ? 'secondary' : 'primary'}${cls ? ` ${cls}` : ''}" ${attrs} aria-label="${esc(label)}"><b class="sk-t">${esc(title)}</b>${sub ? `<small class="sk-s">${esc(sub)}</small>` : ''}</button>`;
  }
  const NEG_OPT = /^(no|_no|_skip|skip|none)$/;
  const NEG_LABEL = /^(算了|不了|不用|先不用|不跟|不复制|稳一点|放弃|不决斗|不要)/;
  // 一个决策选项 → 双行按钮。primary 为 undefined 时按「否定词→辅，其余第一个→主」判断
  function optBtn(o, k, { d, primary, cls = '' } = {}) {
    let [t, s] = skSplit(o.label);
    if (d && d.kind === 'reroll' && o.v === 'keep') [t, s] = ['确认移动', `前进 ${d.roll} 格`];
    const neg = NEG_OPT.test(String(o.v)) || NEG_LABEL.test(String(o.label));
    const main = primary != null ? primary : !neg && (k === 0 || o.v === 'yes' || o.v === 'keep');
    return skBtn(t, s, main ? 'primary' : 'secondary', `data-v="${esc(o.v)}"`, cls, s ? `${t}，${s}` : t);
  }
  // 决策弹层里的数字选项：扁平骰面，数字用 aria-label
  const numBtn = (o) => `<button type="button" class="dc-num" data-v="${esc(o.v)}" title="${esc(o.label || o.v)}" aria-label="${esc(`选 ${o.v}`)}">${window.Skin ? Skin.dice(Number(o.v) >= 1 && Number(o.v) <= 6 ? Number(o.v) : 1, 'flat') : ''}<b>${esc(o.v)}</b></button>`;
  // 决策遮罩上方的骰子：rolls 里每个数字一颗
  function decisionArt(d) {
    if (!window.Skin || !d) return '';
    const dice = Array.isArray(d.dice) && d.dice.length ? d.dice : (typeof d.roll === 'number' && d.roll >= 1 && d.roll <= 6 ? [d.roll] : []);
    if (!dice.length) return '';
    const counts = {};
    for (const v of dice) counts[v] = (counts[v] || 0) + 1;
    const many = dice.length > 1;
    const cells = dice.map((v, i) => `<span class="dc-die ${many ? (counts[v] > 1 ? 'dup' : 'dim') : ''}" style="--k:${i}">${Skin.dice(v, many ? (counts[v] > 1 ? 'win' : 'dim') : 'win')}</span>`).join('');
    const cap = d.kind === 'reroll' ? `前进 ${d.roll} 格` : d.kind === 'showoff' ? `已累计 ${d.sum ?? '?'} 格` : many ? '' : `掷出 ${dice[0]}`;
    return `<div class="dc-art ${many ? 'many' : ''}" role="img" aria-label="${esc(many ? `掷出 ${dice.join(' ')}` : `点数 ${dice[0]}`)}">${cells}</div>${cap ? `<div class="dc-big" aria-hidden="true">${esc(cap)}</div>` : ''}`;
  }
  // 选目标类决策：把棋盘的位置告诉遮罩，让它留出一个「洞」
  function syncSpot() {
    const p = $('#dock .prompt.pick-board');
    const b = $('#board');
    if (!p || !b) return;
    const r = b.getBoundingClientRect();
    p.style.setProperty('--sx', `${Math.round(r.left)}px`);
    p.style.setProperty('--sy', `${Math.round(r.top)}px`);
    p.style.setProperty('--sw', `${Math.round(r.width)}px`);
    p.style.setProperty('--sh', `${Math.round(r.height)}px`);
  }
  // 浮层 / 弹窗里的老按钮统一换成 Skin 双行按钮风格（含图标的保持单行横排）
  function skinButtons(root) {
    for (const b of root.querySelectorAll('.ov-actions .btn, .modal-foot .btn')) {
      if (b.classList.contains('sk-btn')) continue;
      const main = b.classList.contains('primary');
      b.classList.remove('btn', 'big', 'small', 'primary', 'hot', 'blue', 'green');
      b.classList.add('sk-btn', 'inl', main ? 'primary' : 'secondary');
    }
  }

  function clearPromptLive() {
    $('#board').classList.remove('picking-cell', 'spot');
    for (const el of $$('#tokens .token.selectable')) el.classList.remove('selectable');
    for (const el of $$('#trackSvg .cell.pick')) { el.classList.remove('pick'); el.onclick = null; }
    tokenPick = null;
  }
  let tokenPick = null;
  function onTokenClick(rid) {
    if (tokenPick && tokenPick.map[rid]) tokenPick.fn(tokenPick.map[rid]);
  }
  /* ---------- WP-C：触觉 / 焦点 / 键盘 ---------- */
  // 有物理键盘与精确指针（电脑）时才提示快捷键、自动把焦点移到操作上
  const hasKeyboard = matchMedia('(hover: hover) and (pointer: fine)');
  const HAPTIC = { deny: 10, land: 15, turn: 30, hit: [20, 40, 20], finish: [30, 50, 60], champ: [40, 60, 40, 60, 120] };
  // 振动跟随声音设置：「全部静音」时一起关掉；只在用户已与页面交互后触发（浏览器也要求如此）
  // wp-sfx 的动效音效：旧版 sound.js 没有对应函数时静默跳过；返回是否真的调用了
  function playSfx(name, ...args) {
    if (!window.Sound || typeof Sound[name] !== 'function') return false;
    Sound[name](...args);
    return true;
  }
  // 操作被拒：声音 + 触觉；同一次点击可能同时触发「发送失败」和按钮自身的拒绝，300ms 内只响一次
  let lastDenyAt = 0;
  function denyCue() {
    const t = performance.now();
    if (t - lastDenyAt < 300) return;
    lastDenyAt = t;
    haptic('deny');
    playSfx('deny');
  }
  function haptic(kind) {
    const pattern = HAPTIC[kind];
    if (!pattern || !navigator.vibrate || !navigator.userActivation?.hasBeenActive) return false;
    if (window.Sound && (Sound.mode === 'off' || Sound.muted)) return false;
    if (document.hidden) return false;
    try { return navigator.vibrate(pattern); } catch (e) { return false; }
  }
  function nudge(el) {
    if (!el || reducedMotion.matches) return;
    el.classList.remove('wpc-nudge');
    void el.offsetWidth;
    el.classList.add('wpc-nudge');
    setTimeout(() => el.classList.remove('wpc-nudge'), 420);
  }
  // 新决策出现时把焦点移到第一个可用操作上（每个决策只移一次，不抢输入框）
  let focusedFor = null;
  function focusFirst(sel, key) {
    if (focusedFor === key) return;
    const a = document.activeElement;
    if (a && a.matches('input, textarea, select, [contenteditable="true"]')) return;
    if (!$('#modal').hidden) return;
    const el = $$(sel).find((x) => !x.disabled && !x.hidden && x.getBoundingClientRect().width > 0);
    if (!el) return;
    focusedFor = key;
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  // 屏幕阅读器播报「轮到你」（视觉上隐藏）
  function announce(text) {
    let live = $('#wpcLive');
    if (!live) {
      live = document.createElement('div');
      live.id = 'wpcLive'; live.className = 'sr-only';
      live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 30);
  }
  let skipSentRace = null;
  let skipTimer = null;
  const SKIP_SPEED = 6; // 与 hub.js 一致：快进只覆盖本场剩余的 AI 回合

  let locked = false;
  function lockPrompt() {
    locked = true;
    $$('#dock button').forEach((b) => { b.disabled = true; });
    const p = $('#dock .prompt');
    if (p) p.classList.add('locked');
  }
  function unlockPrompt() { locked = !!submitted; if (!playing && !queue.length) renderPrompt(); }
  function answer(d, v) {
    const current = snap && snap.pending;
    if (!isParticipant() || locked || playing || queue.length || !current || current.id !== d.id ||
        (current.simul ? !current.seats.includes(you) || current.done.includes(you) : current.seat !== you)) {
      if (isParticipant()) denyCue();
      return false;
    }
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
      else if (d?.simul && d.kind === 'swapmeet') { title = `跳蚤市场 · ${(d.done || []).length}/${(d.seats || []).length} 已决定`; sub = '每位玩家暗中决定要不要换运动员'; }
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
      dock.innerHTML = promptHtml({ seat: you, mine: false, busy: true, title: submitted ? '正在提交，等服务器确认' : '网络断了，正在重连', sub: submitted ? '稍等一下，不用重复点' : '恢复后接着刚才的局面，没发出去的操作要再点一次' });
      addTimer();
      return;
    }
    if (snap.phase === 'over') {
      const host = room && room.host === me.id;
      const spectator = isSpectator();
      const again = againType();
      dock.innerHTML = promptHtml({ seat: you, mine: false, title: '比赛结束', sub: spectator && !host ? '等房主开启下一场 AI 对局…' : '四场胡闹已落幕', opts: `${skBtn('查看成绩', '', 'secondary', 'data-x="show"')}${host ? skBtn(spectator ? '再看一局' : '再来一局', '', 'primary', `data-x="again" data-navigation="${again}" ${navigationPending ? 'disabled' : ''}`) : ''}${skBtn('回到首页', '', 'secondary', 'data-x="home"')}` });
      $('.prompt', dock).classList.remove('wait');
      for (const b of $$('#dock [data-x]')) {
        b.onclick = () => {
          Sound.click();
          if (b.dataset.x === 'show' && lastGameOver) showFinalOverlay(lastGameOver, { now: true });
          if (b.dataset.x === 'again' && navigate(again, b)) b.classList.add('is-loading');
          if (b.dataset.x === 'home' && navigate('leave', b)) b.classList.add('is-loading');
        };
      }
      return;
    }
    if (!d) { dock.innerHTML = ''; return; }
    if (d.simul) {
      showPickOverlay(d);
      const mine = d.seats.includes(you) && !d.done.includes(you);
      if (d.kind === 'swapmeet') { renderSwapMeetDock(dock, d, mine); return; }
      // 其他人每选好一张都会重排底栏：内容没变就不重建，避免提示条反复弹入
      const key = `simul:${gameId}:${d.id}:${mine}`;
      if ($('.prompt', dock)?.dataset.k !== key) {
        dock.innerHTML = promptHtml({ seat: you, mine, title: mine ? '选择本场出战的运动员' : '等待所有人出牌', sub: mine ? '在上方卡牌中点选' : '所有人选好后同时亮牌' });
        $('.prompt', dock).dataset.k = key;
      }
      if (mine) { yourTurnPing(d.id); addTimer(); }
      return;
    }
    if (overlayKind === 'pick' || overlayKind === 'mini' || overlayKind === 'reveal' || (overlayKind === 'choose' && !overlayKeep())) hideOverlay();
    // 自己的选手已冲线或出局：底栏改成「快进到结算」，不再干看 AI 跑完
    const myRacer = vs.phase === 'race' && vs.racers.find((x) => x.seat === you);
    if (myRacer && (myRacer.finished || myRacer.out) && d.seat !== you) {
      renderDonePrompt(dock, myRacer);
      return;
    }
    const p = vs.players[d.seat];
    const mine = d.seat === you;
    if (!mine) {
      dock.innerHTML = promptHtml({ seat: d.seat, mine: false, title: `${p.name} ${WAIT_TEXT[d.kind] || '正在决策'}`, sub: d.title });
      return;
    }
    yourTurnPing(d.id);
    let opts = '';
    let sub = '';
    let inline = false; // 掷骰按钮留在底部，其余决策走遮罩
    const r = vs.racers.find((x) => x.seat === you);
    switch (d.kind) {
      case 'draft':
        dock.innerHTML = promptHtml({ seat: you, mine: true, title: '轮到你选人了！', sub: '点击上方任意一张卡牌，把它招进你的队伍' });
        addTimer();
        return;
      case 'roll':
        opts = skBtn('掷骰子', '根据点数前进', 'primary', 'data-v="roll"', 'roll-btn');
        inline = true;
        sub = r ? `${R[r.rid].name} 在第 ${r.pos} 格${hasKeyboard.matches ? ' · 按空格也能掷' : ''}` : '';
        break;
      case 'genius':
        opts = `<div class="dc-nums">${d.options.map(numBtn).join('')}</div>`;
        sub = '猜中了本回合结束后再来一回合';
        break;
      case 'reroll':
        opts = d.options.map((o, k) => optBtn(o, k, { d, primary: o.v === 'keep' })).join('');
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
        opts = plain.map((o, k) => optBtn(o, k, { d })).join('');
        if (tokOpts.length) {
          opts += tokOpts.map((o) => optBtn(o, 1, { d, primary: false, cls: 'sm' })).join('');
          for (const rid of Object.keys(map)) { const el = $(`#tokens .token[data-rid="${rid}"]`); if (el) el.classList.add('selectable'); }
          tokenPick = { map, fn: (v) => answer(d, v) };
          sub = '也可以直接点赛道上闪烁的棋子';
        }
        break;
      }
      case 'thirdwheel': {
        $('#board').classList.add('picking-cell');
        opts = d.options.map((o, k) => optBtn(o, k, { d, primary: false, cls: o.v === '_no' ? '' : 'sm' })).join('');
        for (const o of d.options) {
          if (!o.v.startsWith('s')) continue;
          const c = $(`#trackSvg .cell[data-p="${o.v.slice(1)}"]`);
          if (c) { c.classList.add('pick'); c.onclick = () => answer(d, o.v); }
        }
        sub = '也可以直接点赛道上闪烁的格子';
        break;
      }
      // 二代：选一名运动员的决策直接点棋子；其余保留按钮，补一句看得懂的说明
      case 'soulmate': case 'understudy': case 'diva': case 'athleteWarp': case 'kingtripper': case 'switcharoo':
        ({ opts, sub } = v2TokenPrompt(d));
        break;
      case 'tail': case 'kraken': case 'critic': case 'nemesis': case 'showoff': case 'diceguy':
        ({ opts, sub } = v2ButtonPrompt(d));
        break;
      case 'cheatahSet': case 'cheatahGuess':
        ({ opts, sub } = v2NumberPrompt(d));
        break;
      default:
        opts = d.options.map((o, k) => optBtn(o, k, { d })).join('');
    }
    // 选目标类：棋盘上有闪烁的棋子 / 格子 → 遮罩留出棋盘，按钮收到下方
    const pickBoard = !!tokenPick || !!$('#trackSvg .cell.pick');
    if (pickBoard) $('#board').classList.add('spot');
    dock.innerHTML = promptHtml({ seat: you, mine: true, title: d.title, sub, opts, dec: { kind: d.kind, overlay: !inline, pickBoard, art: inline ? '' : decisionArt(d) } });
    syncSpot();
    for (const b of $$('#dock [data-v]')) {
      b.onclick = () => {
        Sound.click();
        if (!answer(d, b.dataset.v)) nudge(b);
      };
    }
    addTimer();
    if (hasKeyboard.matches) focusFirst('#dock .prompt.mine .sk-btn.primary, #dock .prompt.mine [data-v]', `dock:${d.id}`);
  }
  function renderDonePrompt(dock, r) {
    const humansDone = vs.players.every((p) => p.ai || (() => { const x = vs.racers.find((y) => y.seat === p.seat); return !x || x.finished || x.out; })());
    const boosting = speed >= SKIP_SPEED;
    const sending = skipSentRace === `${gameId}:${vs.raceNo}` && !boosting;
    const what = r.finished ? `${R[r.rid].name} 第 ${r.finished} 名冲线` : `${R[r.rid].name} 已出局`;
    let title, sub, opts = '';
    if (boosting) { title = '快进中，马上进入结算'; sub = `${what} · 剩下的 AI 回合加速播放`; }
    else if (humansDone) {
      title = '你的选手跑完了';
      sub = `${what} · 剩下的交给 AI`;
      opts = `<button type="button" class="sk-btn primary wpc-skip ${sending ? 'is-loading' : ''}" data-x="skip" aria-label="快进到结算，剩下的交给 AI" ${sending || connection !== 'ready' ? 'disabled' : ''}><b class="sk-t"><span class="ico">${icon('bolt')}</span><span class="lbl">${sending ? '正在快进…' : '快进到结算'}</span></b><small class="sk-s">剩下的交给 AI</small></button>`;
    } else { title = '你的选手跑完了'; sub = `${what} · 等其他真人选手跑完后可以快进`; }
    // AI 每走一步都会重排底栏：内容没变就不重建，避免提示条反复弹入
    const key = `${gameId}:${vs.raceNo}:${title}:${sub}:${sending}:${connection}`;
    if (dock.dataset.wpcDone === key && $('.wpc-done', dock)) return;
    dock.dataset.wpcDone = key;
    dock.innerHTML = promptHtml({ seat: you, mine: false, title, sub, opts, cls: `wpc-done ${boosting ? 'boost' : ''}` });
    const b = $('#dock [data-x="skip"]');
    if (!b) return;
    b.onclick = () => {
      if (!send({ type: 'skip' })) { denyCue(); nudge(b); return; }
      if (!playSfx('boost')) Sound.click();
      skipSentRace = `${gameId}:${vs.raceNo}`;
      b.disabled = true; b.classList.add('is-loading'); $('.lbl', b).textContent = '正在快进…';
      clearTimeout(skipTimer);
      // 服务端拒绝或旧服务端不认识时，按钮恢复可点
      skipTimer = animationLater(() => { if (speed < SKIP_SPEED) { skipSentRace = null; if (!playing && !queue.length) renderPrompt(); } }, 2500);
    };
  }

  // dec: { kind, overlay, pickBoard, art }。overlay=true → 86% 深色遮罩 + 内容悬浮；
  // 没有选项（等待他人 / 提交中）→ 禁用的「等待中」按钮；其余（掷骰、赛后按钮）→ 底部居中的双行按钮。
  // .p-txt.dock-msg 保留（文案来源不变）：手机竖屏被顶部提示框接管而隐藏，桌面 / 横屏仍显示为一行字。
  function promptHtml({ seat, mine, title, sub, opts, busy, cls, dec }) {
    const r = vs.racers.find((x) => x.seat === seat);
    const c = PCOL[seat % 6] || '#ccc';
    const ava = r && vs.phase === 'race' ? art(r.rid) : '';
    const overlay = !!(mine && opts && dec && dec.overlay);
    let kids = opts;
    if (!opts && mine) kids = ''; // 自己的暗选等：交给遮罩里的卡牌，dock 不摆「等待中」
    else if (!opts) {
      const who = vs.players[seat]?.name;
      kids = busy
        ? skBtn('请稍候', /提交/.test(title) ? '正在提交' : '正在重连', 'secondary', 'disabled aria-disabled="true"', 'dock-wait')
        : skBtn('等待中', who || '请稍候', 'secondary', 'disabled aria-disabled="true"', 'dock-wait');
    }
    const kind = dec && dec.kind ? ` dc-${dec.kind}` : '';
    const pb = overlay && dec.pickBoard;
    const state = overlay ? ` decision${kind}${pb ? ' pick-board' : ''}` : '';
    const txt = `<div class="p-txt dock-msg" title="${esc(sub ? `${title}\n${sub}` : title)}"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    const stage = overlay
      ? `<div class="dc-stage">${ava ? `<div class="p-ava">${ava}</div>` : ''}${pb ? '' : dec.art || ''}${txt}</div>`
      : `${ava ? `<div class="p-ava">${ava}</div>` : ''}${txt}`;
    const html = `<div class="prompt ${mine ? 'mine' : 'wait'} ${busy ? 'busy' : ''} ${cls || ''}${state}" style="--c:${c}" ${overlay ? `role="group" aria-label="${esc(title)}"` : ''}>${stage}${kids ? `<div class="p-opts">${kids}</div>` : ''}<div class="timer" hidden></div></div>`;
    // 文案钩子：另一个提示框从 #dock 的 data 属性 / 事件取同一句话
    const dock = $('#dock');
    if (dock) {
      dock.dataset.title = title || '';
      dock.dataset.sub = sub || '';
      dock.dataset.mine = mine ? '1' : '0';
      window.dispatchEvent(new CustomEvent('hn:prompt', { detail: { title: title || '', sub: sub || '', mine: !!mine, kind: dec && dec.kind || null, overlay } }));
    }
    return html;
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
      t.classList.toggle('urgent', ms > 0 && ms <= 5000);
      t.setAttribute('aria-valuenow', String(Math.ceil(ms / 1000)));
      t.setAttribute('aria-valuetext', `剩余 ${Math.ceil(ms / 1000)} 秒`);
      if (!ms) { clearInterval(timerTicker); timerTicker = null; }
    };
    tick(); timerTicker = setInterval(tick, 100);
  }
  // 轮到你时，你自己的头像外圈是一圈随时间转着收缩的倒计时环（不显示数字）；决策条、选人浮层里的细条仍保留
  function syncAvatarRing() {
    const box = $('#players');
    if (!box) return;
    const remain = deadlineAt - Date.now();
    if (!deadlineAt || remain <= 0 || remain > 120000 || $('#game').hidden) {
      if (box.hasAttribute('data-ring')) { box.removeAttribute('data-ring'); box.style.removeProperty('--ring'); }
      return;
    }
    if (!timerDuration) timerDuration = remain;
    box.setAttribute('data-ring', remain <= 5000 ? 'urgent' : 'on');
    box.style.setProperty('--ring', Math.min(1, remain / timerDuration).toFixed(3));
  }
  setInterval(syncAvatarRing, 100);
  function yourTurnPing(id) {
    if (lastYourTurnId === id) return;
    lastYourTurnId = id;
    Sound.yourTurn();
    haptic('turn');
    const d = snap && snap.pending;
    announce(`轮到你了：${d && d.kind === 'draft' ? '选一名运动员' : d && d.simul ? '选择本场出战的运动员' : (d && d.title) || '请操作'}`);
  }

  /* ================= 表情 ================= */
  function initEmotes() {
    const box = $('#emotes');
    box.innerHTML = EMOTES.map((t) => `<button data-e="${t}">${t}</button>`).join('');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      send({ type: 'emote', key: b.dataset.e });
      closeTopPops(true);
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
    let title, body, tools = '';
    if (kind === 'gallery') {
      // 默认筛选跟着当前语境的模式：一代 → 一代，二代 → 二代，混合 → 全部
      const ed = curEdition();
      galleryFilter = ed === 'v1' ? 'v1' : ed === 'v2' ? 'v2' : 'all';
      title = `运动员图鉴<span class="mh-n" id="galCount"> · ${galleryRacers().length} 名</span>`;
      tools = galleryFilterHtml('gf-head');
      body = `${galleryFilterHtml('gf-body')}<div class="gallery" data-fit>${galleryCards()}</div>`;
    } else if (kind === 'tracks') {
      tgEdition = curEdition();
      title = `地图图鉴<span class="mh-n" id="tgCount"> · ${tgTracks().length} 条赛道</span>`;
      tools = `<div class="seg mode-seg tg-eds" id="tgEds" role="radiogroup" aria-label="按模式查看赛道">${Object.keys(EDITIONS).map((k) => `<button type="button" role="radio" data-ed="${k}">${esc(edName(k))}</button>`).join('')}</div>`;
      body = '<div class="tguide" id="tguide"></div>';
    } else {
      title = '玩法说明';
      body = `<div class="rules" data-fit>${rulesHtml()}</div>`;
    }
    m.innerHTML = `<div class="modal-box card modal-${kind === 'gallery' || kind === 'tracks' ? kind : 'rules'}"><div class="modal-head"><h3>${title}</h3>${tools}<div class="pager" id="mPager" hidden></div><button class="icon-btn" id="mClose" aria-label="关闭"><span class="ico">${icon('close')}</span></button></div><div class="modal-body">${body}</div></div>`;
    m.hidden = false;
    modalKind = kind;
    const close = () => { m.hidden = true; modalKind = null; };
    $('#mClose').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    if (kind === 'gallery') {
      syncGalleryFilter();
      // 网页字体晚到会改变文字高度，加载完后让下次量尺重来
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { const g = $('#modal .gallery'); if (g && modalKind === 'gallery') { delete g.dataset.eq; fitModal(); } });
      m.querySelector('.modal-box').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-gf]');
        if (!b || b.dataset.gf === galleryFilter) return;
        Sound.click();
        setGalleryFilter(b.dataset.gf);
      });
    } else if (kind === 'tracks') {
      const seg = $('#tgEds');
      syncEditionSeg(seg, tgEdition);
      bindEditionSeg(seg, (ed) => {
        if (ed === tgEdition) return;
        Sound.click();
        tgEdition = ed;
        syncEditionSeg(seg, ed);
        $('#tgCount').textContent = ` · ${tgTracks().length} 条赛道`;
        renderTrackGuide(tgTracks().includes(tgKey) ? tgKey : tgTracks()[0]);
      });
    }
    fitModal(true);
  }

  /* ---------- 图鉴筛选：全部 / 一代 / 二代 ---------- */
  let galleryFilter = 'v1';
  const GALLERY_FILTERS = [['all', '全部'], ['v1', '一代'], ['v2', '二代']];
  function galleryRacers() {
    if (galleryFilter === 'all') return RACERS_ALL;
    const n = galleryFilter === 'v2' ? 2 : 1;
    return RACERS_ALL.filter((r) => (r.edition || 1) === n);
  }
  function galleryCards(list = galleryRacers()) {
    const save = vs; if (!vs) vs = { players: [] };
    try { return list.map((r) => rcard(r.id)).join(''); } finally { vs = save; }
  }
  // 一代、二代的技能文字长短不一，按内容分页会让两边页数、弹窗高度都不一样。
  // 先把全部 72 张卡摆进去量出最高的那张，所有卡统一用这个高度（--ch），再放回当前筛选的卡片：
  // 无论看一代、二代还是全部，每页张数和弹窗大小都一样。列数或字体变了才重量。
  function galleryPre(box) {
    const key = `${box.clientWidth}x${box.clientHeight}|${getComputedStyle(box).display}`;
    if (box.dataset.eq === key) return;
    const keep = box.innerHTML;
    box.style.removeProperty('--ch'); box.style.removeProperty('--th');
    box.innerHTML = galleryCards(RACERS_ALL);
    let mx = 0, tx = 0;
    for (const c of box.children) { mx = Math.max(mx, c.offsetHeight); const t = c.querySelector('.txt'); if (t) tx = Math.max(tx, t.offsetHeight); }
    // 文字区统一成最长那张的高度，图区拿剩下的空间：每张卡的图和字都同样大，版面对称
    box.style.setProperty('--th', `${tx}px`);
    box.innerHTML = keep;
    // 每页放得下的整行数固定；剩余高度平均分给每行，卡片刚好铺满弹窗，图片区随之变大
    const cs = getComputedStyle(box), gap = parseFloat(cs.rowGap) || 0;
    const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const rows = Math.max(1, Math.floor((room + gap) / (mx + gap)));
    box.style.setProperty('--ch', `${Math.max(mx, Math.floor((room - gap * (rows - 1)) / rows))}px`);
    box.dataset.eq = key;
  }
  function galleryPager() {
    const st = pagers.gallery || (pagers.gallery = { anchor: 0, dir: 0 });
    st.pre = galleryPre;
    return st;
  }
  // 筛选标签：宽屏放在弹窗标题栏，窄屏放在图鉴上方（两份同步，CSS 只显示其中一份）
  function galleryFilterHtml(cls) {
    return `<div class="seg mode-seg gal-filter ${cls}" role="radiogroup" aria-label="按模式筛选运动员">${GALLERY_FILTERS.map(([k, t]) => `<button type="button" role="radio" data-gf="${k}">${t}</button>`).join('')}</div>`;
  }
  function syncGalleryFilter() {
    for (const b of $$('#modal button[data-gf]')) {
      const on = b.dataset.gf === galleryFilter;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
  }
  function setGalleryFilter(k) {
    if (!GALLERY_FILTERS.some(([x]) => x === k)) return;
    galleryFilter = k;
    syncGalleryFilter();
    const m = $('#modal'), box = $('.gallery', m);
    if (!box) return;
    box.innerHTML = galleryCards();
    const n = $('#galCount'); if (n) n.textContent = ` · ${galleryRacers().length} 名`;
    galleryPager().anchor = 0; pagers.gallery.dir = 0;
    paginate('gallery', box, () => $$('.gallery .rcard', m), $('#mPager'));
  }

  /* ---------- 玩法说明（含二代赛道与变数卡） ---------- */
  function rulesHtml() {
    const sched = (k) => (EDITIONS[k] ? EDITIONS[k].schedule.map((t) => (TRACKS[t] ? TRACKS[t].name : t)).join(' → ') : '');
    const modes = Object.keys(EDITIONS).map((k) => `<li>${edBadge(k)} ${esc(EDITIONS[k].desc || edHint(k))}<br><small class="rule-sched">赛程：${esc(sched(k))}</small></li>`).join('');
    const twists = (window.TWISTS || []).map((t) => `<section class="rule-sec tw-card"><p><span class="tw-name">${esc(t.name)}</span>${esc(t.text)}</p></section>`).join('');
    const twistAt = TRACKS.twisty && TRACKS.twisty.twistAt;
    const whirls = TRACKS.whirly && TRACKS.whirly.whirls ? TRACKS.whirly.whirls.map(([a, b]) => `${a}↔${b}`).join('、') : '';
    return `<section class="rule-sec"><h4>当前试玩版</h4><p>支持 <span class="kw">3-6 名选手</span>（含 AI）。两位朋友可以加 1 名 AI 开赛，单人可以直接挑战 AI。开房前可选<span class="kw">一代 / 二代 / 混合</span>三种模式。狂野赛道采用自定义布局；奖牌分值使用下方的递增设置。双人各操控两名运动员的变体尚未加入。</p></section>
        <section class="rule-sec"><h4>三种模式</h4><ul class="rule-modes">${modes}</ul></section>
        <section class="rule-sec"><h4>目标</h4><p>一共比 <span class="kw">4 场</span>赛跑，每场前两名冲线的拿分：冠军拿金杯、亚军拿银牌，越往后的比赛分越高（金 ${GOLD.join('/')}，银 ${SILVER.join('/')}）。四场结束总分最高者获胜，并列就一起庆祝！</p></section>
        <section class="rule-sec"><h4>组建队伍</h4><p>开局掷骰决定顺序，进行两轮<span class="kw">蛇形选秀</span>：翻开人数×2 张运动员卡，按 1→N 再 N→1 的顺序每人挑一张，两轮后每人 4 名运动员。混合模式从 72 名运动员里一起选。</p></section>
        <section class="rule-sec"><h4>比赛</h4><ul>
          <li>每场所有人<span class="kw">同时暗选</span>一名还没上过场的运动员，一起亮牌，放到起点。</li>
          <li>轮到你时掷骰，走对应格数，这叫<span class="kw">主移动</span>。很多技能只对主移动生效。</li>
          <li>有两名运动员冲过终点，比赛立刻结束。下一场由上一场最落后（或最先被淘汰）的人先手。</li>
          <li>赛道顺序由模式决定，见上面的「三种模式」。</li>
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
        <section class="rule-sec"><h4>二代赛道</h4><ul>
          <li><span class="kw">扭扭糖果</span>：没有特殊格，第 ${twistAt ? `${twistAt - 1}、${twistAt}` : '13、14'} 格之间立着变数招牌，本场第一个移动到或经过第 ${twistAt || 14} 格的运动员翻开一张变数卡（每场一次）。</li>
          <li><span class="kw">漩涡乐园</span>：${whirls ? `漩涡两两相连（${esc(whirls)}），` : ''}停在一端就瞬移到另一端，不算移动。</li>
        </ul></section>
        <section class="rule-sec"><h4>二代 · 变数卡</h4><p>二代和混合模式启用，共 ${(window.TWISTS || []).length} 张，翻开后立刻结算；写着「本场之后」的效果持续到本场结束。</p></section>
        ${twists}
        <section class="rule-sec"><h4>联机小贴士</h4><ul>
          <li>把房间码或邀请链接发给朋友；人不够可以加 AI。</li>
          <li>掉线或超时会自动托管，回来点一下「托管」即可接管。</li>
          ${hasKeyboard.matches ? '<li>空格键可以直接掷骰。</li>' : ''}
        </ul></section>`;
  }
  let modalKind = null;
  function fitModal(fresh) {
    const m = $('#modal');
    if (m.hidden || !modalKind) return;
    if (fresh) for (const k of ['gallery', 'rules']) if (pagers[k]) pagers[k].anchor = 0;
    if (modalKind === 'records') return;
    if (modalKind === 'gallery') { galleryPager(); paginate('gallery', $('.gallery', m), () => $$('.gallery .rcard', m), $('#mPager')); }
    else if (modalKind === 'tracks') renderTrackGuide(fresh || !tgTracks().includes(tgKey) ? tgTracks()[0] : tgKey);
    else paginate('rules', $('.rules', m), () => $$('.rules .rule-sec', m), $('#mPager'));
  }

  /* ---------- 赛事纪录：本局已结束的每一场名次与累计分 ---------- */
  function openRecords() {
    if (!vs) return;
    const m = $('#modal');
    const done = raceScores();
    const total = (window.SCHEDULE || []).length || 4;
    const rows = [];
    for (let i = 0; i < total; i++) {
      const rec = done[i];
      const res = ((snap && snap.results) || []).find((x) => x.race === i + 1);
      const trackKey = (res && res.track) || (vs.schedule && vs.schedule[i]) || SCHEDULE[i];
      const tname = (window.TRACKS_ALL || TRACKS)[trackKey]?.name || '';
      if (!rec) { rows.push(`<li class="rec-row pending"><span class="rec-no">第 ${i + 1} 场</span><span class="rec-track">${esc(tname)}</span><span class="rec-wait">${vs.raceNo === i + 1 && vs.phase === 'race' ? '进行中' : '未开始'}</span></li>`); continue; }
      const placed = rec.standings.filter((x) => x.finished).sort((a, b) => a.finished - b.finished).slice(0, 2);
      const medals = placed.map((x) => `<span class="rec-med m${x.finished}" style="--c:${PCOL[x.seat % 6]}"><i>${art(x.rid)}</i><b>${x.finished}</b><em>${esc(pname(vs.players[x.seat]))} · ${esc(R[x.rid].name)}</em></span>`).join('');
      const prev = i > 0 && done[i - 1] ? done[i - 1].scores : vs.players.map(() => 0);
      const gains = vs.players.map((p) => `<span class="rec-g ${p.seat === you ? 'me' : ''}" style="--c:${PCOL[p.seat % 6]}"><i></i>${esc(pname(p))}<b>+${rec.scores[p.seat] - (prev[p.seat] || 0)}</b></span>`).join('');
      rows.push(`<li class="rec-row"><span class="rec-no">第 ${i + 1} 场</span><span class="rec-track">${esc(tname)}</span><span class="rec-meds">${medals}</span><span class="rec-gains">${gains}</span></li>`);
    }
    const totals = vs.players.slice().sort((a, b) => b.score - a.score || a.seat - b.seat).map((p, k) => `<span class="rec-t ${p.seat === you ? 'me' : ''}" style="--c:${PCOL[p.seat % 6]}"><em>${k + 1}</em>${esc(pname(p))}<b>${p.score}</b></span>`).join('');
    m.innerHTML = `<div class="modal-box card modal-records"><div class="modal-head"><h3>赛事纪录</h3><button class="icon-btn" id="mClose" aria-label="关闭"><span class="ico">${icon('close')}</span></button></div><div class="modal-body"><ol class="rec-list">${rows.join('')}</ol><div class="rec-totals"><span class="rec-tl">当前总分</span>${totals}</div></div></div>`;
    m.hidden = false;
    modalKind = 'records';
    const close = () => { m.hidden = true; modalKind = null; };
    $('#mClose').onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
  }

  /* ---------- 地图图鉴 ---------- */
  // 特殊格说明对照 game/engine.js 的 afterStop：只看最后停在哪格（掷骰、技能移动、瞬移都算），路过不触发；
  // 赛道格效果先于所有技能结算；箭头调用 move() 算一次独立移动，后退最多退回起点；石头 trip()；星星 giveChip 铜牌 1 分。
  const TRACK_INTRO = {
    mild: '平平无奇的一圈跑道，没有任何机关，快慢全看运动员技能怎么搞事。',
    wild: '遍地箭头、石头和星星，落点决定命运，一步踩错就前功尽弃。',
    twisty: '二代的糖果跑道，格子上没有机关，但半路立着变数招牌，谁先经过谁翻出一张变数卡。',
    whirly: '十二个漩涡两两相连，停在一端就被吸到另一端，可能一步登天也可能倒退一大截。',
  };
  const TRACK_TINT = { mild: 'var(--green)', wild: 'var(--red)', twisty: 'var(--pink)', whirly: 'var(--blue)' };
  // 地图图鉴里二代格子的说明图标（棋盘画法还没提供时的简化版）
  const GUIDE_GLYPH = {
    whirl: `<circle r="20" fill="#4D9DF7" stroke="${INK}" stroke-width="2.5"/><path d="M0 0 m-1 -2 a3 3 0 1 1 3 4 a7 7 0 1 1 -8 -8 a11 11 0 1 1 13 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    twist: `<rect x="-18" y="-17" width="36" height="26" rx="6" fill="#F27AB8" stroke="${INK}" stroke-width="2.5"/><path d="M0 9 v10" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><text y="3" font-size="17" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">?</text>`,
  };
  let tgKey = 'mild';
  let tgEdition = 'v1';
  // 地图图鉴按模式列赛道：赛程里出现过的赛道，按首次出场顺序
  function tgTracks() { return [...new Set((EDITIONS[editionOf(tgEdition)].schedule || SCHEDULE).filter((k) => TRACKS[k]))]; }
  // 缩略图接口：trackThumbMarkup(key, lay) 返回 <svg viewBox="0 0 W H"> 内部的标记，W×H 取 GEO[lay].vb。
  // 默认复用对局棋盘的 trackSvgMarkup（二代赛道的专门画法补进 trackSvgMarkup 后这里自动生效）；
  // 也可以由别的脚本提供 window.TrackThumbs[key](lay) 单独绘制地图图鉴缩略图，返回空值时退回默认画法。
  function trackThumbMarkup(key, lay) {
    const custom = window.TrackThumbs && typeof window.TrackThumbs[key] === 'function' ? window.TrackThumbs[key](lay) : '';
    return custom || trackSvgMarkup(key, lay, true);
  }
  let tgLay = null, tgResizeBound = false;
  function renderTrackGuide(key, dir = 0) {
    const box = $('#tguide');
    if (!box) return;
    tgKey = key;
    // 横竖屏切换后按新方向重画缩略图（只绑定一次）
    if (!tgResizeBound) {
      tgResizeBound = true;
      window.addEventListener('resize', () => {
        if (modalKind === 'tracks' && tgLay && tgLay !== (innerHeight > innerWidth * 1.05 && innerWidth < 900 ? 'tall' : 'wide')) renderTrackGuide(tgKey);
      });
    }
    const t = TRACKS[key];
    const lay = innerHeight > innerWidth * 1.05 && innerWidth < 900 ? 'tall' : 'wide';
    tgLay = lay;
    const schedule = EDITIONS[editionOf(tgEdition)].schedule || SCHEDULE;
    const races = schedule.map((k, i) => (k === key ? `<li><b>第 ${i + 1} 场</b><span class="tg-medal g">金 ${GOLD[i]}</span><span class="tg-medal s">银 ${SILVER[i]}</span></li>` : '')).join('');
    const at = (pred) => Object.entries(t.spaces).filter(([, sp]) => pred(sp)).map(([p, sp]) => ({ p: Number(p), sp }));
    const fwd = at((sp) => sp.type === 'arrow' && sp.n > 0), back = at((sp) => sp.type === 'arrow' && sp.n < 0);
    const rocks = at((sp) => sp.type === 'rock'), stars = at((sp) => sp.type === 'star');
    const cells = (arr, fmt = (p) => `${p}`) => arr.map(({ p, sp }) => fmt(p, sp)).join('、');
    const glyph = (type, n) => `<svg viewBox="-24 -24 48 48" aria-hidden="true">${spaceGlyph(type, n, 0, 0, 1) || GUIDE_GLYPH[type] || ''}</svg>`;
    const item = (g, name, where, text) => `<li>${g}<div><b>${name}<em>${where}</em></b><p>${text}</p></div></li>`;
    const whirlPairs = Array.isArray(t.whirls) ? t.whirls : [];
    const legend = whirlPairs.length ? `<ul class="tg-legend">
        ${item(glyph('whirl', 0), '漩涡', `${whirlPairs.length} 对 · ${whirlPairs.map(([a, b]) => `${a}↔${b}`).join('、')}`, '停在漩涡一端立刻瞬移到相连的另一端，不算移动、不会超过别人；路过不触发。')}
      </ul><p class="tg-note">只看最后停在哪格：掷骰、技能移动落到漩涡都会被传送；瞬移到另一端后不再连环传送。</p>`
      : t.twistAt ? `<ul class="tg-legend">
        ${item(glyph('twist', 0), '变数招牌', `第 ${t.twistAt - 1}、${t.twistAt} 格之间`, `本场第一个移动到或经过第 ${t.twistAt} 格的运动员翻开一张变数卡，每场只翻一次；13 张变数卡见玩法说明。`)}
      </ul><p class="tg-note">格子本身没有机关，起点后 ${FIN - 1} 格赛道，第 ${FIN} 步冲线。</p>`
      : Object.keys(t.spaces).length ? `<ul class="tg-legend">
        ${fwd.length ? item(glyph('arrow', 2), '前进箭头', `第 ${cells(fwd, (p, sp) => `${p} 格 +${sp.n}`)}`, '停在这格立刻再前进对应格数，算一次独立移动，落到别的特殊格接着结算。') : ''}
        ${back.length ? item(glyph('arrow', -3), '后退箭头', `第 ${cells(back, (p, sp) => `${p} 格 −${Math.abs(sp.n)}`)}`, '停在这格立刻后退对应格数（最多退回起点），同样算一次独立移动。') : ''}
        ${rocks.length ? item(glyph('rock', 0), '石头', `第 ${cells(rocks)} 格`, '停上去就摔倒：下回合跳过主移动不掷骰，技能照常生效。') : ''}
        ${stars.length ? item(glyph('star', 0), '星星', `第 ${cells(stars)} 格`, '停上去立刻拿 1 分铜牌，每次停上都算。') : ''}
      </ul><p class="tg-note">只看最后停在哪格：掷骰、技能移动、瞬移落到这里都触发，路过不算；赛道格效果先于所有技能结算。</p>`
      : `<p class="tg-note tg-plain">没有特殊格。起点后 ${FIN - 1} 格赛道，第 ${FIN} 步冲线，比的就是技能和运气。</p>`;
    const [W, H] = GEO[lay].thumb || GEO[lay].vb;
    const list = tgTracks();
    box.innerHTML = `<div class="tg-tabs n${list.length}" role="tablist" aria-label="选择赛道">${list.map((k) => TRACKS[k]).map((x) => `<button role="tab" data-tg="${x.key}" aria-selected="${x.key === key}" class="${x.key === key ? 'on' : ''}${x.key === 'wild' ? ' wild' : ''} tk-${x.key}">${icon(x.key === 'wild' ? 'rock' : x.key === 'whirly' ? 'swirl' : 'flag')}<span class="tg-full">${esc(x.name)}</span><span class="tg-short">${esc(trackShort(x.key))}</span></button>`).join('')}</div>
      <div class="tg-page tg-${lay}${dir ? (dir > 0 ? ' pg-in-next' : ' pg-in-prev') : ''}" data-fit>
        <div class="tg-map" data-track="${esc(key)}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t.name)}赛道缩略图">${trackThumbMarkup(key, lay)}</svg></div>
        <div class="tg-info">
          <p class="tg-intro"><b style="--c:${TRACK_TINT[key] || 'var(--green)'}">${esc(t.name)}</b>${esc(TRACK_INTRO[key] || '')}</p>
          <div class="tg-facts"><div class="tg-fact"><span>总格数</span><b>${FIN}</b><small>起点后 ${FIN - 1} 格，第 ${FIN} 步冲线</small></div><div class="tg-fact tg-races"><span>出场与奖牌</span><ul>${races}</ul></div></div>
          ${legend}
        </div>
      </div>`;
    fillIcons(box);
    box.querySelector('.tg-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tg]');
      if (!b || b.dataset.tg === tgKey) return;
      const keys = tgTracks();
      Sound.click();
      renderTrackGuide(b.dataset.tg, keys.indexOf(b.dataset.tg) > keys.indexOf(tgKey) ? 1 : -1);
    };
    const page = $('.tg-page', box);
    let sx = 0, sy = 0;
    page.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    page.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const keys = tgTracks(), i = keys.indexOf(tgKey) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < keys.length) { Sound.click(); renderTrackGuide(keys[i], dx < 0 ? 1 : -1); }
    });
  }


  /* ================= 提示 & 彩纸 ================= */
  // 首页/房间显示在底部居中（不挡输入框和标题），对局里贴在顶栏下方（不挡操作栏）。
  // 停留时长按字数和轻重给：错误至少 4 秒，读得完；同一句话重复出现只刷新，不叠罗汉。
  function toast(text, err) {
    const host = $('#toasts');
    if (!host) return;
    placeNotices();
    const ms = Math.min(6500, (err ? 4000 : 2400) + Math.max(0, String(text).length - 14) * 90);
    for (const old of $$('.toast', host)) if (old.dataset.text === text) old.remove();
    while (host.children.length >= 3) host.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = `toast wpd-toast${err ? ' err' : ''}`;
    t.dataset.text = text;
    t.style.setProperty('--toast-ms', `${ms}ms`);
    t.innerHTML = `${err ? `<span class="t-ico">${wpdIcon('alert')}</span>` : ''}<span class="t-text"></span>`;
    $('.t-text', t).textContent = text;
    host.appendChild(t);
    setTimeout(() => t.remove(), ms + 120);
  }
  const confettiState = { parts: [], raf: 0 };
  // 冠军烟花：n 朵，依次在屏幕上方不同位置绽放（圆形火星 + 彩纸尾）
  function fireworks(n = 4, color) {
    if (fast || reducedMotion.matches) return;
    const cols = ['#F27AB8', '#FFC53D', '#33B679', '#4D9DF7', '#F2553C', '#8B6CF0'];
    for (let k = 0; k < n; k++) {
      animationLater(() => {
        const x = innerWidth * (0.18 + 0.64 * ((k * 0.61803 + 0.1) % 1)), y = innerHeight * (0.16 + 0.2 * ((k * 0.37) % 1));
        const c1 = color || cols[(k * 2) % 6], c2 = cols[(k * 2 + 3) % 6];
        playSfx('pop');
        confetti(0, x, y, () => {
          for (let i = 0; i < 46; i++) {
            const a = (i / 46) * Math.PI * 2 + Math.random() * 0.08, sp = 3.2 + Math.random() * 3.4;
            confettiState.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0, vr: 0, w: 2.6, h: 0, c: i % 3 ? c1 : c2, life: 0, max: 62 + Math.random() * 22, spark: true });
          }
        });
      }, k * 380);
    }
  }
  function confetti(n = 150, x, y, extra) {
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
    if (extra) extra();
    if (confettiState.raf) return;
    const ctx = cv.getContext('2d');
    const tick = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const ps = confettiState.parts;
      for (const p of ps) {
        p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
        if (p.spark) {
          // 烟花火星：带拖尾的小圆点，越飞越暗
          p.vy -= 0.1; p.vx *= 0.965; p.vy *= 0.965;
          ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
          ctx.strokeStyle = p.c; ctx.lineWidth = p.w; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.lineTo(p.x, p.y); ctx.stroke();
          continue;
        }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 170);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6)));
        ctx.restore();
      }
      confettiState.parts = ps.filter((p) => p.life < (p.max || 170) && p.y < innerHeight + 40);
      if (confettiState.parts.length) confettiState.raf = requestAnimationFrame(tick);
      else { confettiState.raf = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    };
    confettiState.raf = requestAnimationFrame(tick);
  }

  /* ================= 对局顶栏：手机竖屏的「更多」「快捷聊天」弹层 ================= */
  // 弹层本体就是 #topActions / #emotes（桌面上它们是常驻的，类名 .open 只在手机竖屏 CSS 里生效）
  const TOP_POPS = [['#moreBtn', '#topActions'], ['#chatBtn', '#emotes']];
  function closeTopPops(focusBack) {
    for (const [btn, pop] of TOP_POPS) {
      const b = $(btn), p = $(pop);
      if (!b || !p || !p.classList.contains('open')) continue;
      p.classList.remove('open');
      b.setAttribute('aria-expanded', 'false');
      if (focusBack) b.focus({ preventScroll: true });
    }
  }
  // 弹层贴在触发按钮下面、右对齐按钮（桌面、平板、手机顶栏高度各不相同，不写死 top）
  function placeTopPop(btn, pop) {
    const g = $('#game').getBoundingClientRect(), b = $(btn).getBoundingClientRect();
    $(pop).style.top = `${Math.round(b.bottom - g.top + 8)}px`;
    $(pop).style.right = `${Math.max(8, Math.round(g.right - b.right))}px`;
  }
  function toggleTopPop(which) {
    const [btn, pop] = TOP_POPS[which];
    const opening = !$(pop).classList.contains('open');
    closeTopPops();
    if (!opening) return;
    closePlayerPop();
    Sound.click();
    placeTopPop(btn, pop);
    $(pop).classList.add('open');
    $(btn).setAttribute('aria-expanded', 'true');
    const first = $(`${pop} button:not(:disabled)`);
    if (first && hasKeyboard.matches) first.focus({ preventScroll: true });
  }
  function initTopPops() {
    $('#moreBtn').onclick = () => toggleTopPop(0);
    $('#chatBtn').onclick = () => toggleTopPop(1);
    // 点弹层外面关闭；点赛事纪录 / 玩法说明（会弹出窗口）后顺手收起
    document.addEventListener('pointerdown', (e) => {
      if (!$('#topActions').classList.contains('open') && !$('#emotes').classList.contains('open')) return;
      if (e.target.closest('#topActions, #emotes, #moreBtn, #chatBtn')) return;
      closeTopPops();
    }, true);
    $('#topActions').addEventListener('click', (e) => { if (e.target.closest('#recordsBtn, [data-open]')) closeTopPops(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#topActions').classList.contains('open') && !$('#emotes').classList.contains('open')) return;
      e.preventDefault();
      closeTopPops(true);
    });
    window.addEventListener('resize', () => { if (!MQ_PHONE_PORTRAIT.matches) closeTopPops(); });
  }

  /* ================= 对局顶栏 ================= */
  function initGameBar() {
    // 倍速循环 1 → 1.5 → 2.2 → 1（与 hub.js 的 SPEEDS 一致）：往快里切用「嗖↑」，绕回 1 倍用普通点击
    $('#recordsBtn').onclick = () => { Sound.click(); openRecords(); };
    // 窄屏顶栏放不下纪录按钮：点场次胶囊同样能打开
    $('#races').onclick = (e) => { if (e.target.closest('.race-pill')) { Sound.click(); openRecords(); } };
    $('#speedBtn').onclick = () => { if (!(speed < 2.2 && playSfx('boost'))) Sound.click(); send({ type: 'speed' }); };
    $('#autoBtn').onclick = () => { Sound.click(); send({ type: 'auto', on: !autoFlags[you] }); };
    $('#soundBtn').onclick = () => { Sound.cycleMode(); renderTopButtons(); Sound.click(); };
    initTopPops();
    initPlayerPop();
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
    // 决策遮罩的键盘：Esc = 放弃 / 不用，数字键 = 选对应数字或第 N 个按钮，Enter = 主按钮（焦点不在按钮上时）
    document.addEventListener('keydown', (e) => {
      const p = $('#dock .prompt.decision');
      if (!p || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!$('#modal').hidden || !$('#overlay').hidden) return;
      if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const btns = $$('[data-v]', p).filter((x) => !x.disabled);
      let t = null;
      if (e.key === 'Escape') t = btns.find((x) => NEG_OPT.test(x.dataset.v)) || (btns.length === 2 ? btns[1] : null);
      else if (/^[1-9]$/.test(e.key)) t = p.querySelector('.dc-nums') ? btns.find((x) => x.dataset.v === e.key) : btns[Number(e.key) - 1];
      else if (e.key === 'Enter' && !document.activeElement?.matches('button, a')) t = btns.find((x) => x.classList.contains('primary'));
      if (t) { e.preventDefault(); t.click(); }
    });
  }

  window.__hn = () => ({ pending: snap && snap.pending, phase: vs && vs.phase, playing, queue: queue.length, overlayKind, you, locked, mode: gameMode, gameId, navigationPending, edition: curEdition() });

  /* ================= 二代：赛道、变数卡、新事件与新决策 ================= */
  // 美术全部原创：糖果条纹格、扭扭招牌、漩涡格与管道均为本文件内的 SVG 几何。
  const TWIST_BY = Object.fromEntries((window.TWISTS || []).map((t) => [t.id, t]));
  // 引擎里「本场持续生效」的变数卡（其余一次性结算，或在棋盘上另有标识）
  const TWIST_LASTING = new Set(['bonkbug', 'cursewands', 'conveyor', 'scrying']);
  // 漩涡六对：Okabe–Ito 色盲友好色，同时用字母 A–F 与不同形状角标区分
  const WHIRL_COLS = ['#D55E00', '#0072B2', '#009E73', '#E6B800', '#56B4E9', '#CC79A7'];
  const WHIRL_MARK = ['A', 'B', 'C', 'D', 'E', 'F'];
  // 糖果格：粉、薄荷、柠檬、蓝莓四色循环，逢 5 的格子是樱桃红
  const CANDY = ['#FF8FC7', '#5FD9B0', '#FFD34D', '#9B8CFF'];
  const CANDY_FIVE = '#F2553C';
  const V2_EVENT_TYPES = new Set(['twist', 'coins', 'coin', 'monster', 'curse', 'fixedRoll', 'finale', 'cancel', 'voided', 'rolls', 'cheat', 'wolf', 'stack', 'hog', 'mate', 'control', 'whirl', 'bonkbug']);
  const OUT_FLOAT = { doppel: '被顶包！', bitemark: '被咬了！', monster: '被狼人怪追上！', icarus: '翅膀融化！', speeddemon: '冲出赛道！', scrying: '被水晶球看穿！', timeimp: '穿越到下一场！' };
  let v2uid = 0;
  let whirlRide = null; // 正在坐漩涡管道的运动员：紧接着的瞬移不再画普通弧线
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  const pct = (v, total) => `${(v / total * 100).toFixed(3)}%`;
  function mixHex(a, b, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  }
  // 阿基米德螺线
  function spiralD(cx, cy, rMax, turns = 2.4, start = 0) {
    const pts = [];
    const N = Math.round(turns * 26);
    for (let i = 0; i <= N; i++) {
      const f = i / N, a = start + f * turns * Math.PI * 2, r = 1.2 + f * rMax;
      pts.push(`${f1(cx + r * Math.cos(a))} ${f1(cy + r * Math.sin(a))}`);
    }
    return `M${pts.join(' L')}`;
  }
  // 配对角标的形状：圆、方、三角、菱形、六边形、星
  function markShape(k, cx, cy, r, fill) {
    const st = `fill="${fill}" stroke="${INK}" stroke-width="${f1(r * 0.24)}" stroke-linejoin="round"`;
    const poly = (n, rot, rr = r) => Array.from({ length: n }, (_, i) => { const a = rot + i * Math.PI * 2 / n; return `${f1(cx + rr * Math.cos(a))},${f1(cy + rr * Math.sin(a))}`; }).join(' ');
    switch (k % 6) {
      case 0: return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" ${st}/>`;
      case 1: return `<rect x="${f1(cx - r * 0.86)}" y="${f1(cy - r * 0.86)}" width="${f1(r * 1.72)}" height="${f1(r * 1.72)}" rx="${f1(r * 0.25)}" ${st}/>`;
      case 2: return `<polygon points="${poly(3, -Math.PI / 2, r * 1.18)}" ${st}/>`;
      case 3: return `<polygon points="${poly(4, -Math.PI / 2, r * 1.15)}" ${st}/>`;
      case 4: return `<polygon points="${poly(6, 0, r * 1.02)}" ${st}/>`;
      default: return `<polygon points="${starPts(cx, cy, r * 1.22, r * 0.58)}" ${st}/>`;
    }
  }
  // 漩涡图标（图例、角标、徽标共用）
  function twirlGlyph(k, cx, cy, s = 1) {
    const col = WHIRL_COLS[k % 6];
    return `<g transform="translate(${f1(cx)} ${f1(cy)}) scale(${s})"><circle r="19" fill="${mixHex(col, '#ffffff', 0.72)}" stroke="${INK}" stroke-width="2.5"/>`
      + `<path d="${spiralD(0, 0, 14, 2.2)}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`
      + `<path d="${spiralD(0, 0, 14, 2.2, Math.PI)}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/></g>`;
  }
  function whirlMark(k, cx, cy, r) {
    return `<g class="twl-mark">${markShape(k, cx, cy, r, WHIRL_COLS[k % 6])}<text x="${f1(cx)}" y="${f1(cy + r * 0.42)}" font-size="${f1(r * 1.2)}" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="${f1(r * 0.32)}" paint-order="stroke">${WHIRL_MARK[k % 6]}</text></g>`;
  }

  /* ---------- 漩涡管道：沿内场边缘的「车道」走，避开格子、数字与中央面板 ---------- */
  // 格子朝内场的一侧（拐角格取朝内的那个角）
  function cellPort(G, p) {
    const r = G.rect(p), f = G.inf;
    const above = r.y + r.h <= f.y + 1, below = r.y >= f.y + f.h - 1, left = r.x + r.w <= f.x + 1, right = r.x >= f.x + f.w - 1;
    const nx = left ? 1 : right ? -1 : 0, ny = above ? 1 : below ? -1 : 0;
    return { x: nx > 0 ? r.x + r.w : nx < 0 ? r.x : r.x + r.w / 2, y: ny > 0 ? r.y + r.h : ny < 0 ? r.y : r.y + r.h / 2, nx, ny };
  }
  const pipeCache = {};
  function whirlPipes(lay) {
    if (pipeCache[lay]) return pipeCache[lay];
    const G = GEO[lay], f = G.inf;
    const pairs = (TRACKS.whirly && TRACKS.whirly.whirls) || [];
    if (lay === 'tall') {
      // 蛇形赛道里管道不绕圈：格子上的同色漩涡 + 字母已经说明配对，管道只在传送时亮起，沿两格中心的弧线滑过去
      const out = pairs.map(([a, b], k) => {
        const ra = G.rect(a), rb = G.rect(b);
        const ax = ra.x + ra.w / 2, ay = ra.y + ra.h / 2, bx = rb.x + rb.w / 2, by = rb.y + rb.h / 2;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, bow = Math.min(46, len * 0.22) * (k % 2 ? -1 : 1);
        return { k, a, b, lane: 0, d: `M${f1(ax)} ${f1(ay)} Q${f1((ax + bx) / 2 - dy / len * bow)} ${f1((ay + by) / 2 + dx / len * bow)} ${f1(bx)} ${f1(by)}` };
      });
      pipeCache[lay] = out;
      return out;
    }
    const gutter = lay === 'wide' ? -3 : -2, step = lay === 'wide' ? 12 : 11;
    const lane = (L) => ({ x0: f.x + L, x1: f.x + f.w - L, y0: f.y + L, y1: f.y + f.h - L });
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const onLane = (pt, q) => ({ x: pt.nx > 0 ? q.x0 : pt.nx < 0 ? q.x1 : clamp(pt.x, q.x0, q.x1), y: pt.ny > 0 ? q.y0 : pt.ny < 0 ? q.y1 : clamp(pt.y, q.y0, q.y1) });
    const per = (q) => { const W = q.x1 - q.x0, H = q.y1 - q.y0; return { W, H, P: 2 * W + 2 * H }; };
    const tOf = (pt, q) => {
      const { W, H } = per(q);
      if (Math.abs(pt.y - q.y0) < 0.5) return pt.x - q.x0;
      if (Math.abs(pt.x - q.x1) < 0.5) return W + (pt.y - q.y0);
      if (Math.abs(pt.y - q.y1) < 0.5) return W + H + (q.x1 - pt.x);
      return 2 * W + H + (q.y1 - pt.y);
    };
    // 先在最外圈（格子与内场之间的缝）算每对的走向与区间，再给区间重叠的管道分到更里面的车道
    const base = lane(gutter);
    const info = pairs.map(([a, b], k) => {
      const pa = cellPort(G, a), pb = cellPort(G, b);
      const ta = tOf(onLane(pa, base), base), tb = tOf(onLane(pb, base), base);
      const { P } = per(base);
      const fw = (tb - ta + P) % P;
      const fwd = fw <= P - fw;
      const s = fwd ? ta : tb, len = fwd ? fw : P - fw;
      return { k, a, b, pa, pb, fwd, s, e: s + len, len };
    });
    const P0 = per(base).P;
    const overlap = (x, y) => [-P0, 0, P0].some((sh) => x.s < y.e + sh + 16 && y.s + sh < x.e + 16);
    const lanes = [];
    for (const x of info.slice().sort((m, n) => m.len - n.len)) {
      let L = 0;
      while ((lanes[L] || []).some((y) => overlap(x, y))) L++;
      (lanes[L] ||= []).push(x);
      x.lane = L;
    }
    const out = info.map((x) => {
      const q = lane(gutter + x.lane * step);
      const A = onLane(x.pa, q), B = onLane(x.pb, q);
      const { W, H, P } = per(q);
      const corners = [[0, q.x0, q.y0], [W, q.x1, q.y0], [W + H, q.x1, q.y1], [2 * W + H, q.x0, q.y1]];
      const ta = tOf(A, q), tb = tOf(B, q);
      const pts = [{ x: x.pa.x, y: x.pa.y }, A];
      if (x.fwd) {
        const d = (tb - ta + P) % P;
        for (let i = 0; i < 8; i++) {
          const [ct, cx, cy] = corners[i % 4];
          const rel = (ct - ta + P) % P;
          if (rel > 0.5 && rel < d - 0.5 && !pts.some((p) => p.x === cx && p.y === cy)) pts.push({ x: cx, y: cy, rel });
        }
      } else {
        const d = (ta - tb + P) % P;
        for (let i = 0; i < 8; i++) {
          const [ct, cx, cy] = corners[i % 4];
          const rel = (ta - ct + P) % P;
          if (rel > 0.5 && rel < d - 0.5 && !pts.some((p) => p.x === cx && p.y === cy)) pts.push({ x: cx, y: cy, rel });
        }
      }
      const mid = pts.slice(2).sort((m, n) => m.rel - n.rel);
      const all = [pts[0], pts[1], ...mid, B, { x: x.pb.x, y: x.pb.y }];
      return { k: x.k, a: x.a, b: x.b, lane: x.lane, d: roundPath(all, lay === 'wide' ? 16 : 13) };
    });
    pipeCache[lay] = out;
    return out;
  }
  function roundPath(raw, rad) {
    const pts = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 0.5);
    let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1];
      const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y);
      const r = Math.min(rad, la / 2, lb / 2);
      if (r < 0.8) { d += ` L${f1(p.x)} ${f1(p.y)}`; continue; }
      const p1 = { x: p.x + (a.x - p.x) / la * r, y: p.y + (a.y - p.y) / la * r }, p2 = { x: p.x + (b.x - p.x) / lb * r, y: p.y + (b.y - p.y) / lb * r };
      d += ` L${f1(p1.x)} ${f1(p1.y)} Q${f1(p.x)} ${f1(p.y)} ${f1(p2.x)} ${f1(p2.y)}`;
    }
    const z = pts[pts.length - 1];
    return `${d} L${f1(z.x)} ${f1(z.y)}`;
  }

  // 二代赛道图层：由 trackSvgMarkup 末尾一行调用，不改动既有绘制；格子底色用本图层自带的样式覆盖（:has 作用域，按实例 id 区分）
  function trackV2Layer(trackKey, lay, bedOverride) {
    const t = TRACKS[trackKey];
    if (!t || (trackKey !== 'twisty' && trackKey !== 'whirly')) return '';
    const G = GEO[lay], u = ++v2uid, scope = `svg:has(.twl-u${u})`;
    const bed = bedOverride || G.bed;
    let defs = '', css = '', s = '';
    if (trackKey === 'twisty') {
      CANDY.concat([CANDY_FIVE]).forEach((c, k) => {
        defs += `<pattern id="hnC${u}_${k}" patternUnits="userSpaceOnUse" width="18" height="18" patternTransform="rotate(38)"><rect width="18" height="18" fill="${c}"/><rect width="7" height="18" fill="#fff" opacity="${k === 4 ? 0.22 : 0.34}"/></pattern>`;
      });
      for (let p = 1; p < FIN; p++) css += `${scope} .cell[data-p="${p}"]>rect:first-child{fill:url(#hnC${u}_${p % 5 === 0 ? 4 : (p - 1) % 4})}`;
      css += `${scope}>rect:nth-of-type(2){fill:#FFE4F0}`;
      // 糖果棒外框
      s += `<rect x="${bed.x + 2.5}" y="${bed.y + 2.5}" width="${bed.w - 5}" height="${bed.h - 5}" rx="${bed.rx - 2}" fill="none" stroke="#FF8FC7" stroke-width="3" stroke-dasharray="11 9" opacity=".95"/>`;
      s += twistSignMarkup(G, lay);
    } else {
      WHIRL_COLS.forEach((c, k) => {
        defs += `<pattern id="hnW${u}_${k}" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 60 60" preserveAspectRatio="xMidYMid slice"><rect width="60" height="60" fill="${mixHex(c, '#ffffff', 0.7)}"/>`
          + `<path d="${spiralD(30, 30, 25, 2.3)}" fill="none" stroke="${c}" stroke-width="5.5" stroke-linecap="round"/>`
          + `<path d="${spiralD(30, 30, 25, 2.3, Math.PI)}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".85"/></pattern>`;
      });
      for (const [p, sp] of Object.entries(t.spaces)) if (sp.type === 'whirl') css += `${scope} .cell[data-p="${p}"]>rect:first-child{fill:url(#hnW${u}_${sp.pair})}`;
      css += `${scope}>rect:nth-of-type(2){fill:#D4F1FA}`;
      s += `<rect x="${bed.x + 2.5}" y="${bed.y + 2.5}" width="${bed.w - 5}" height="${bed.h - 5}" rx="${bed.rx - 2}" fill="none" stroke="#7FD6F0" stroke-width="3" stroke-dasharray="4 7" stroke-linecap="round" opacity=".95"/>`;
      // 管道：先画里圈车道，最外圈压在最上面，交叉处像立交
      const pipes = whirlPipes(lay).slice().sort((a, b) => b.lane - a.lane);
      const w = lay === 'wide' ? 1 : 0.9;
      for (const pp of pipes) {
        const col = WHIRL_COLS[pp.k];
        s += `<g class="twl-pipe${lay === 'tall' ? ' twl-ghost' : ''}" data-p="${pp.a} ${pp.b}" data-k="${pp.k}" style="--pc:${col}"><path class="twl-under" d="${pp.d}" fill="none" stroke="${INK}" stroke-width="${f1(8 * w)}" stroke-linecap="round" stroke-linejoin="round"/>`
          + `<path class="twl-core" d="${pp.d}" fill="none" stroke="${col}" stroke-width="${f1(4.6 * w)}" stroke-linecap="round" stroke-linejoin="round"/>`
          + `<path class="twl-shine" d="${pp.d}" fill="none" stroke="#fff" stroke-width="${f1(1.4 * w)}" stroke-dasharray="2 7" stroke-linecap="round" opacity=".75"/></g>`;
      }
      // 每个漩涡格：管道接口 + 右上角配对角标
      for (const [p, sp] of Object.entries(t.spaces)) {
        if (sp.type !== 'whirl') continue;
        const r = G.rect(Number(p)), port = cellPort(G, Number(p));
        const col = WHIRL_COLS[sp.pair % 6];
        if (lay !== 'tall') s += `<circle class="twl-port" cx="${f1(port.x)}" cy="${f1(port.y)}" r="${lay === 'wide' ? 4.6 : 4}" fill="${col}" stroke="${INK}" stroke-width="2"/>`;
        const mr = lay === 'wide' ? 8.5 : 8;
        s += whirlMark(sp.pair, r.x + r.w - mr - 3, r.y + mr + 3, mr);
      }
    }
    return `<g class="twl twl-u${u} twl-${trackKey}" aria-hidden="true"><defs>${defs}</defs><style>${css}</style>${s}</g>`;
  }
  // 扭扭招牌：立在第 13、14 格之间，跨着跑道
  function twistSignMarkup(G, lay) {
    const t = TRACKS.twisty, at = (t && t.twistAt) || 14;
    const a = G.rect(at - 1), b = G.rect(at);
    let cx, cy, vertical;
    if (b.y >= a.y + a.h - 1 || a.y >= b.y + b.h - 1) { cx = (a.x + a.w / 2 + b.x + b.w / 2) / 2; cy = a.y < b.y ? (a.y + a.h + b.y) / 2 : (b.y + b.h + a.y) / 2; vertical = true; }
    else { cx = a.x < b.x ? (a.x + a.w + b.x) / 2 : (b.x + b.w + a.x) / 2; cy = (a.y + a.h / 2 + b.y + b.h / 2) / 2; vertical = false; }
    const w = lay === 'wide' ? 68 : 62, h = lay === 'wide' ? 24 : 21;
    const rot = vertical ? -6 : 84;
    const post = (x) => `<rect x="${f1(x - 3.5)}" y="${f1(-h / 2 - 6)}" width="7" height="${f1(h + 12)}" rx="3.5" fill="#fff" stroke="${INK}" stroke-width="2"/><path d="M${f1(x - 3.5)} ${f1(-h / 2 - 1)} l7 -5 M${f1(x - 3.5)} ${f1(-h / 2 + 7)} l7 -5 M${f1(x - 3.5)} ${f1(h / 2 - 1)} l7 -5 M${f1(x - 3.5)} ${f1(h / 2 + 7)} l7 -5" stroke="#F2553C" stroke-width="3"/>`;
    return `<g class="twist-sign" transform="translate(${f1(cx)} ${f1(cy)}) rotate(${rot})">`
      + `<rect class="tw-glow" x="${f1(-w / 2 - 8)}" y="${f1(-h / 2 - 8)}" width="${w + 16}" height="${h + 16}" rx="14" fill="#FFF3B0"/>`
      + `<rect x="${f1(-w / 2 + 2)}" y="${f1(-h / 2 + 3)}" width="${w}" height="${h}" rx="7" fill="${INK}"/>`
      + `<rect x="${f1(-w / 2)}" y="${f1(-h / 2)}" width="${w}" height="${h}" rx="7" fill="#FFC53D" stroke="${INK}" stroke-width="2.5"/>`
      + post(-w / 2 + 2) + post(w / 2 - 2)
      + `<path d="${spiralD(-w / 2 + 15, 0, 5.5, 1.6)}" fill="none" stroke="#F25CA2" stroke-width="2.4" stroke-linecap="round"/>`
      + `<text x="${f1(5)}" y="${f1(h * 0.2)}" font-size="${lay === 'wide' ? 13 : 12}" font-weight="900" text-anchor="middle" fill="${INK}" letter-spacing="1">TWIST</text></g>`;
  }
  // 地图册 / 首页用的赛道缩略图（另一处 renderTrackGuide 可直接调用）
  function trackThumbSvg(key, lay = 'wide') {
    const G = GEO[lay] || GEO.wide;
    const t = TRACKS[key];
    if (!t) return '';
    return `<svg class="track-thumb" viewBox="0 0 ${(G.thumb || G.vb)[0]} ${(G.thumb || G.vb)[1]}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t.name)}赛道缩略图">${trackSvgMarkup(key, lay, true)}</svg>`;
  }
  window.HN_trackThumbSvg = trackThumbSvg;

  // buildBoard 末尾一行调用：二代赛道的中央说明
  function v2BoardBuilt(trackKey) {
    // 横竖屏切换会重建棋盘：金币、狼人怪、变数徽标要按新坐标重新摆
    if (vs && vs.v2) renderV2();
    const t = TRACKS[trackKey];
    if (!t || (trackKey !== 'twisty' && trackKey !== 'whirly')) return;
    const ct = $('#centerTrack');
    if (trackKey === 'twisty') {
      ct.innerHTML = `<b>${esc(t.name)}</b><small>第 13、14 格之间立着变数招牌 · 本场第一个跑过的人翻变数卡</small>`;
      ct.style.setProperty('--c', '#F25CA2');
    } else {
      ct.innerHTML = `<b>${esc(t.name)}</b><div class="legend"><span><svg viewBox="-24 -24 48 48">${twirlGlyph(1, 0, 0, 1)}</svg>漩涡：停上去，从同色同字母的另一头冒出来</span></div>`;
      ct.style.setProperty('--c', '#0072B2');
    }
  }

  /* ---------- 棋盘上的二代状态：皮纳塔金币、狼人怪、变数徽标、运动员小标签 ---------- */
  function v2Of() {
    if (!vs) return null;
    if (!vs.v2) vs.v2 = { twistDeckCount: 0, twistDone: false, twistDrawn: [], twistActive: [], coins: [], monster: null, fixedRoll: null, mirrored: false, finale: null, extras: [] };
    return vs.v2;
  }
  function freshRaceV2(st) {
    return { ...st, twistDone: false, twistDrawn: [], twistActive: [], coins: [], monster: null, fixedRoll: null, mirrored: false, finale: null };
  }
  function v2Layers() {
    const board = $('#board');
    let layer = $('#v2Layer'), badges = $('#v2Badges');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'v2Layer'; layer.className = 'v2-layer'; layer.setAttribute('aria-hidden', 'true');
      board.insertBefore(layer, $('#floaters'));
    }
    if (!badges) {
      badges = document.createElement('div');
      badges.id = 'v2Badges'; badges.className = 'v2-badges'; badges.hidden = true;
      badges.addEventListener('click', onV2BadgeClick);
      badges.addEventListener('pointerleave', () => { if (matchMedia('(hover: hover)').matches) closeV2Pop(); });
      board.insertBefore(badges, $('#floaters'));
    }
    return { layer, badges };
  }
  const MONSTER_ART = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M12 22 L16 6 L25 17 Q32 13 39 17 L48 6 L52 22 Q60 34 54 46 Q46 60 32 60 Q18 60 10 46 Q4 34 12 22 Z" fill="#6B4FA8" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/><path d="M14 40 l-6 4 M50 40 l6 4 M16 30 l-7 0 M48 30 l7 0" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><ellipse cx="23" cy="31" rx="6" ry="6.5" fill="#FFE27A" stroke="${INK}" stroke-width="2.5"/><ellipse cx="41" cy="31" rx="6" ry="6.5" fill="#FFE27A" stroke="${INK}" stroke-width="2.5"/><circle cx="24" cy="32" r="2.6" fill="${INK}"/><circle cx="40" cy="32" r="2.6" fill="${INK}"/><path d="M20 45 Q32 53 44 45 Q32 49 20 45 Z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><path d="M25 46 l2 4 l2 -3.4 M35 46.5 l2 3.4 l2 -4" fill="#fff" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const TWIST_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="3.5" fill="#FFC53D" stroke="${INK}" stroke-width="2"/><path d="${spiralD(12, 12, 5.2, 1.7)}" fill="none" stroke="#F25CA2" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  function v2Chips(st) {
    const out = [];
    const tw = (id, note = '') => { const t = TWIST_BY[id]; if (t && !out.some((c) => c.id === id)) out.push({ id, name: t.name, text: t.text + note }); };
    for (const id of st.twistActive || []) tw(id);
    if (st.mirrored) tw('mirror', '（赛道已反向）');
    if (st.fixedRoll && vs.players) tw('noluck', ` 本场固定点数：${Object.entries(st.fixedRoll).map(([seat, v]) => `${pname(vs.players[seat])} ${v}`).join('、')}`);
    if (st.finale) tw('finale', st.finale === 'running' ? '（决战进行中）' : '（前两名冲线后开打）');
    if (st.coins && st.coins.length) tw('pinata', `（还剩 ${st.coins.length} 分）`);
    if (st.monster != null) tw('alchemylab', `（狼人怪在第 ${st.monster} 格）`);
    return out;
  }
  // 由 renderAll / 事件播放调用；only 用于新卡飞来前先把徽标位置留出来
  function renderV2(incoming) {
    if (!vs || !$('#board')) return;
    const st = vs.v2;
    const { layer, badges } = v2Layers();
    const on = !!(st && vs.phase !== 'draft' && vs.track && vs.racers && vs.racers.length);
    if (!on) {
      layer.innerHTML = ''; badges.innerHTML = ''; badges.hidden = true;
      $('#board').classList.remove('v2-mirror');
      return;
    }
    const [W, H] = VB();
    // 皮纳塔金币：贴在格子右上角，不压棋子中心
    const coins = new Set(st.coins || []);
    for (const c of $$('.v2-coin', layer)) if (!coins.has(Number(c.dataset.p))) c.remove();
    for (const p of coins) {
      let c = $(`.v2-coin[data-p="${p}"]`, layer);
      if (!c) { c = document.createElement('i'); c.className = 'v2-coin'; c.dataset.p = p; c.textContent = '1'; layer.appendChild(c); }
      const r = cellRect(p);
      c.style.left = pct(r.x + r.w - 11, W); c.style.top = pct(r.y + 11, H);
    }
    // 狼人怪
    let m = $('#v2Monster', layer);
    if (st.monster != null) {
      if (!m) { m = document.createElement('div'); m.id = 'v2Monster'; m.className = 'v2-monster'; m.innerHTML = MONSTER_ART; layer.appendChild(m); }
      const r = cellRect(Math.min(FIN, Math.max(0, st.monster)));
      m.style.left = pct(r.x + 14, W); m.style.top = pct(r.y + 14, H);
    } else if (m) m.remove();
    // 招牌：已经有人翻过卡就暗下去
    const sign = $('#trackSvg .twist-sign');
    if (sign) sign.classList.toggle('used', !!st.twistDone);
    $('#board').classList.toggle('v2-mirror', !!st.mirrored);
    // 变数徽标：生效中的变数卡，点一下 / 悬停看效果
    const chips = v2Chips(st);
    const key = chips.map((c) => `${c.id}:${c.text}`).join('|') + `|${layout}|${incoming || ''}`;
    if (badges.dataset.k !== key) {
      badges.dataset.k = key;
      const open = badges.dataset.open;
      badges.innerHTML = chips.map((c) => `<button type="button" class="v2-chip ${c.id === incoming ? 'incoming' : ''}" data-tw="${c.id}" title="${esc(`${c.name}：${c.text}`)}" aria-label="${esc(`变数卡 ${c.name}：${c.text}`)}"><span class="v2-ci">${TWIST_ICON}</span><b>${esc(c.name)}</b></button>`).join('')
        + (open && chips.some((c) => c.id === open) ? v2PopHtml(chips.find((c) => c.id === open)) : '');
      if (open && !chips.some((c) => c.id === open)) delete badges.dataset.open;
    }
    badges.hidden = !chips.length;
    const tall = layout === 'tall';
    badges.classList.toggle('tall', tall);
    Object.assign(badges.style, tall
      ? { left: '', right: pct(W - 386, W), top: pct(78, H), maxWidth: pct(118, W) }
      : { right: '', left: pct(68, W), top: pct(121, H), maxWidth: pct(552, W) });
    // 运动员小标签：狼人、野猪、灵魂伴侣
    for (const r of vs.racers) {
      const el = tokenOf(r.rid);
      if (!el) continue;
      el.classList.toggle('v2-wolf', !!r.wolf);
      const tags = [];
      if (r.hogs) tags.push(`<i class="v2-hog" title="野猪 ${r.hogs} 头">猪${r.hogs > 1 ? r.hogs : ''}</i>`);
      if (r.mate) tags.push(`<i class="v2-mate" title="灵魂伴侣：${esc(rname(r.mate))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21 C4 15 2 11 2 8 a5 5 0 0 1 10 -1.5 A5 5 0 0 1 22 8 c0 3 -2 7 -10 13 Z" fill="#F25CA2" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/></svg></i>`);
      let box = $('.v2-tags', el);
      if (!tags.length) { if (box) box.remove(); continue; }
      if (!box) { box = document.createElement('div'); box.className = 'v2-tags'; el.appendChild(box); }
      const html = tags.join('');
      if (box.innerHTML !== html) box.innerHTML = html;
    }
  }
  function v2PopHtml(c) { return `<div class="v2-pop" role="tooltip"><b>${esc(c.name)}</b><p>${esc(c.text)}</p></div>`; }
  let v2PopTimer = null;
  function closeV2Pop() {
    const badges = $('#v2Badges');
    if (!badges) return;
    delete badges.dataset.open;
    for (const p of $$('.v2-pop', badges)) p.remove();
    clearTimeout(v2PopTimer);
  }
  function onV2BadgeClick(ev) {
    const b = ev.target.closest('.v2-chip');
    const badges = $('#v2Badges');
    if (!b || !badges) return;
    const id = b.dataset.tw;
    const was = badges.dataset.open;
    closeV2Pop();
    if (was === id) return;
    const c = vs && vs.v2 ? v2Chips(vs.v2).find((x) => x.id === id) : null;
    if (!c) return;
    badges.dataset.open = id;
    badges.insertAdjacentHTML('beforeend', v2PopHtml(c));
    Sound.click();
    v2PopTimer = setTimeout(closeV2Pop, 5000);
  }
  function cellFloat(p, text, cls = '') {
    const c = cellCenter(p), [W, H] = VB();
    const f = document.createElement('div');
    f.className = `floater ${cls}`;
    f.textContent = text;
    f.style.left = pct(c.x, W); f.style.top = pct(c.y, H);
    $('#floaters').appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
  const seatRacer = (seat) => vs && vs.racers && (vs.racers.find((x) => x.seat === seat && !x.finished && !x.out) || vs.racers.find((x) => x.seat === seat));

  /* ---------- 变数卡：招牌闪光 → 翻牌放大 → 飞进徽标 ---------- */
  function twistCardEl(tw, e) {
    const card = document.createElement('div');
    card.className = 'twist-card';
    card.setAttribute('role', 'status');
    const r = e.rid ? vr(e.rid) : null;
    const who = r ? `${pname(vs.players[r.seat])}的${R[r.rid] ? R[r.rid].name : ''}跑过招牌` : '变数招牌';
    card.innerHTML = `<div class="tw-face"><div class="tw-art" aria-hidden="true"><svg viewBox="0 0 120 64">${[0, 1, 2].map((i) => `<path d="${spiralD(24 + i * 36, 32, 14 + (i === 1 ? 6 : 0), 2.1, i)}" fill="none" stroke="${['#F25CA2', '#FFC53D', '#4D9DF7'][i]}" stroke-width="${i === 1 ? 6 : 4.5}" stroke-linecap="round"/>`).join('')}</svg></div>`
      + `<span class="tw-kicker">变数卡</span><b class="tw-name">${esc(tw.name)}</b>${tw.en ? `<em class="tw-en">${esc(tw.en)}</em>` : ''}<p class="tw-text">${esc(tw.text || '')}</p><span class="tw-who">${esc(who)}</span></div>`;
    return card;
  }
  async function playTwist(e, pause) {
    const st = v2Of();
    const tw = TWIST_BY[e.id] || { id: e.id, name: '变数卡', text: '' };
    st.twistDone = true;
    (st.twistDrawn ||= []).push(e.id);
    if (TWIST_LASTING.has(e.id) && !(st.twistActive ||= []).includes(e.id)) st.twistActive.push(e.id);
    if (e.id === 'mirror') st.mirrored = !st.mirrored;
    if (e.id === 'finale' && !st.finale) st.finale = 'armed';
    commentary(`变数卡「${tw.name}」：${tw.text}`);
    const sign = $('#trackSvg .twist-sign');
    if (e.rid) spotlight(e.rid);
    if (fast || reducedMotion.matches) { renderV2(); await pause(400); return; }
    if (sign) restartClass(sign, 'tw-flash', 1200);
    if (!playSfx('twist')) Sound.reveal();
    await pause(420);
    const card = twistCardEl(tw, e);
    document.body.appendChild(card);
    const kill = setTimeout(() => card.remove(), 12000);
    try {
      const face = card.firstElementChild;
      const from = (sign || $('#board')).getBoundingClientRect(), c = face.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (c.left + c.width / 2), dy = from.top + from.height / 2 - (c.top + c.height / 2);
      face.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.16) rotateY(180deg)`, opacity: 0.4 },
        { transform: 'translate(0, 0) scale(1.06) rotateY(0deg)', opacity: 1, offset: 0.72 },
        { transform: 'none', opacity: 1 },
      ], { duration: 640 / speed, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'both' });
      await pause(640);
      playSfx('cardLand');
      await pause(1700);
      // 先把徽标位置排好（新卡位置透明），再让卡片飞进去
      renderV2(e.id);
      const target = $(`#v2Badges [data-tw="${e.id}"]`);
      const tb = target && !$('#v2Badges').hidden ? target.getBoundingClientRect() : null;
      const now = face.getBoundingClientRect();
      if (tb && tb.width) {
        const s = Math.max(0.08, Math.min(0.5, tb.width / now.width));
        face.animate([
          { transform: 'none', opacity: 1 },
          { transform: `translate(${tb.left + tb.width / 2 - (now.left + now.width / 2)}px, ${tb.top + tb.height / 2 - (now.top + now.height / 2)}px) scale(${s}) rotate(-8deg)`, opacity: 0.25 },
        ], { duration: 460 / speed, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'forwards' });
        if (!playSfx('swish')) Sound.card();
        await pause(460);
        target.classList.remove('incoming');
        restartClass(target, 'v2-land', 600);
      } else {
        face.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.9)' }], { duration: 260 / speed, fill: 'forwards' });
        await pause(260);
      }
    } finally {
      clearTimeout(kill);
      card.remove();
      if (vs) renderV2();
    }
  }

  /* ---------- 二代事件播放：由 playEvent 一行调用，返回 true 表示已处理 ---------- */
  const v2Played = {};
  window.__hnV2 = () => ({ played: { ...v2Played }, twistCards: document.querySelectorAll('.twist-card').length, state: vs && vs.v2 ? clone(vs.v2) : null, track: vs && vs.track, built: builtTrack });
  async function playV2Event(e, epoch, pause) {
    if (!vs) return false;
    const pk = e.t === 'space' ? e.space : e.t;
    if (V2_EVENT_TYPES.has(pk)) v2Played[pk] = (v2Played[pk] || 0) + 1;
    switch (e.t) {
      case 'raceIntro':
        if (vs.v2) vs.v2 = freshRaceV2(vs.v2);
        return false;
      case 'reveal':
        // 额外运动员（返场王、时间小鬼）随本场一起上场：并入亮牌与棋子
        if (Array.isArray(e.extras) && e.extras.length) e.picks = e.picks.concat(e.extras.filter((x) => !e.picks.some((p) => p.rid === x.rid)));
        return false;
      case 'twist':
        await playTwist(e, pause);
        return true;
      case 'coins': {
        const st = v2Of();
        st.coins = (e.coins || []).slice();
        renderV2();
        if (!fast) $$('#v2Layer .v2-coin').forEach((c, i) => { c.style.animationDelay = `${Math.min(i * 30, 480)}ms`; restartClass(c, 'pop', 900); });
        Sound.chip();
        commentary(e.text);
        await pause(1000);
        return true;
      }
      case 'coin': {
        const st = v2Of();
        const c = $(`#v2Layer .v2-coin[data-p="${e.pos}"]`);
        if (c && !fast) c.classList.add('take');
        Sound.pop();
        await pause(260);
        st.coins = (st.coins || []).filter((p) => p !== e.pos);
        renderV2();
        return true;
      }
      case 'monster': {
        const st = v2Of();
        if (e.from == null) {
          st.monster = e.to;
          renderV2();
          restartClass($('#v2Monster'), 'pop', 600);
          cellFloat(e.to, '狼人怪出发！', 'bad');
          Sound.chomp();
          commentary(e.text);
          await pause(1000);
          return true;
        }
        setDice(`<div class="die land v2-mdie">${sdie(e.value)}<div class="die-cap">狼人怪</div></div>`, `狼人怪掷出 ${e.value}`);
        Sound.dice();
        await pause(420);
        let i = 0;
        for (let p = e.from + 1; p <= Math.min(e.to, FIN); p++) {
          st.monster = p;
          renderV2();
          restartClass($('#v2Monster'), 'hop', 200);
          Sound.hop(i++);
          await pause(130);
        }
        st.monster = e.to >= FIN ? null : e.to;
        await pause(160);
        renderV2();
        return true;
      }
      case 'curse': {
        const r = seatRacer(e.seat);
        setDice(`<div class="die land v2-curse">${sdie(e.value)}<div class="die-cap">诅咒魔杖</div></div>`, `诅咒魔杖掷出 ${e.value}`);
        Sound.dice();
        if (r) floater(r.rid, `跳过 ${e.value} 人`, 'bad');
        commentary(e.text);
        await pause(900);
        return true;
      }
      case 'fixedRoll': {
        const st = v2Of();
        (st.fixedRoll ||= {})[e.seat] = e.value;
        const r = seatRacer(e.seat);
        setDice(`<div class="die land v2-fixed">${sdie(e.value)}<div class="die-cap">${esc(pname(vs.players[e.seat]))} 定格</div></div>`, `骰子定格 ${e.value}`);
        Sound.dice();
        if (r) floater(r.rid, `骰子定格 ${e.value}`);
        renderV2();
        await pause(650);
        return true;
      }
      case 'finale': {
        const st = v2Of();
        const rids = e.rids || [];
        for (const r of vs.racers) {
          if (rids.includes(r.rid)) { r.finished = 0; r.pos = e.pos; r.tripped = false; r.out = false; }
          else if (!r.out && !r.finished) { r.out = true; r.benched = true; }
        }
        st.finale = 'running';
        layoutTokens();
        renderV2(); renderTurnCard();
        banner('季终决战！', `${rids.map((rid) => R[rid] ? R[rid].name : '').join(' 对 ')} · 第 ${e.pos} 格再跑一次，胜者通吃`, true);
        Sound.reveal();
        for (const rid of rids) spotlight(rid);
        commentary(e.text);
        await pause(1900);
        return true;
      }
      case 'cancel':
        banner('本场取消', `${rname(e.rid)}：不玩了！`, true);
        floater(e.rid, '不玩了！', 'bad');
        knock(e.rid);
        Sound.blocked();
        commentary(e.text);
        await pause(1500);
        return true;
      case 'voided':
        setDice(`<div class="die land v2-void">${sdie(e.value || 6)}<i aria-hidden="true"></i><div class="die-cap">作废</div></div>`, `${e.value || 6} 点作废`);
        if (e.rid) floater(e.rid, `${e.value || 6} 点作废，重掷`, 'bad');
        Sound.blocked();
        await pause(750);
        return true;
      case 'rolls': {
        const dice = Array.isArray(e.dice) ? e.dice : [];
        const counts = {};
        for (const v of dice) counts[v] = (counts[v] || 0) + 1;
        setDice(`<div class="v2-rolls n${dice.length}">${dice.map((v, i) => `<div class="die land ${counts[v] > 1 ? 'dup' : ''}" style="--k:${i}">${sdie(v)}</div>`).join('')}</div>`, `掷出 ${dice.join(' ')}`);
        Sound.dice();
        commentary(e.text);
        await pause(1100);
        return true;
      }
      case 'cheat': {
        const guesser = vs.players[e.seat];
        setDice(`<div class="v2-cheat ${e.hit ? 'hit' : 'miss'}"><div><span>暗定</span><b>${esc(e.set)}</b></div><i>${e.hit ? '=' : '≠'}</i><div><span>${esc(pname(guesser))} 猜</span><b>${esc(e.guess)}</b></div></div>`, e.hit ? '猜中了' : '猜错了');
        if (e.rid) floater(e.rid, e.hit ? '被猜中，原地不动' : `没猜中！走 ${e.set} 格`, e.hit ? 'bad' : 'good');
        Sound.duel();
        commentary(e.text);
        await pause(1300);
        return true;
      }
      case 'wolf': {
        const r = vr(e.rid);
        if (r) r.wolf = true;
        renderV2();
        restartClass(tokenOf(e.rid), 'v2-howl', 1000);
        floater(e.rid, '变身狼人！', 'bad');
        Sound.chomp();
        commentary(e.text);
        await pause(950);
        return true;
      }
      case 'stack': {
        const r = vr(e.rid);
        const powers = (e.powers || []).filter((k) => R[k]);
        if (r) r.stack = (r.stack || []).concat(powers);
        floater(e.rid, `长出「${powers.map((k) => R[k].skill).join('」「')}」`, 'good');
        restartClass(tokenOf(e.rid), 'sk-cast', 900);
        Sound.warp();
        commentary(e.text);
        renderTurnCard();
        await pause(1100);
        return true;
      }
      case 'hog': {
        const to = vr(e.to);
        if (to) to.hogs = (to.hogs || 0) + (e.n || 1);
        if (e.from) {
          const fr = vr(e.from);
          if (fr) fr.hogs = 0;
          const a = tokenOf(e.from), b = tokenOf(e.to);
          if (a && b) drawArc(tokenPt(a), tokenPt(b), 'power', 800, '#C9763B');
        }
        renderV2();
        floater(e.to, e.from ? '抢到野猪！' : '骑上野猪', 'good');
        Sound.pop();
        await pause(e.from ? 800 : 650);
        return true;
      }
      case 'mate': {
        const r = vr(e.rid);
        if (r) r.mate = e.target;
        const a = tokenOf(e.rid), b = tokenOf(e.target);
        if (a && b) drawArc(tokenPt(a), tokenPt(b), 'power', 900, '#F25CA2');
        renderV2();
        floater(e.rid, '灵魂伴侣', 'good');
        Sound.pop();
        commentary(e.text);
        await pause(900);
        return true;
      }
      case 'control': {
        const a = vr(e.a), b = vr(e.b);
        if (a && e.seatA != null) a.seat = e.seatA;
        if (b && e.seatB != null) b.seat = e.seatB;
        for (const r of [a, b]) {
          const el = r && tokenOf(r.rid);
          if (!el) continue;
          el.style.setProperty('--c', PCOL[r.seat % 6]);
          const tag = $('.seat-dot', el);
          if (tag && vs.players[r.seat]) tag.textContent = pname(vs.players[r.seat]);
        }
        const ea = a && tokenOf(a.rid), eb = b && tokenOf(b.rid);
        if (ea && eb) { drawArc(tokenPt(ea), tokenPt(eb), 'swap', 900, PCOL[a.seat % 6]); drawArc(tokenPt(eb), tokenPt(ea), 'swap2', 900, PCOL[b.seat % 6]); }
        if (a) floater(a.rid, '换主人！', 'good');
        Sound.warp();
        commentary(e.text);
        renderPlayers(); renderTurnCard(); layoutTokens();
        await pause(1100);
        return true;
      }
      case 'space':
        if (e.space === 'whirl') { await playWhirl(e, pause); return true; }
        if (e.space === 'bonkbug') {
          pulseCell(e.pos);
          knock(e.rid);
          floater(e.rid, '撞头虫！后退 5 格', 'bad');
          Sound.trip();
          await pause(500);
          return true;
        }
        return false;
      case 'warp': {
        // 漩涡传送：棋子已经顺着管道滑过去了，直接在出口冒出来
        if (!whirlRide || whirlRide.rid !== e.rid) return false;
        whirlRide = null;
        const r = vr(e.rid);
        if (!r) return true;
        const el = tokenEl(r);
        r.pos = e.to;
        layoutTokens(true);
        el.classList.remove('warp-out');
        restartClass(el, 'v2-popin', 450);
        pulseCell(e.to);
        await pause(320);
        return true;
      }
      case 'out': {
        if (!e.cause || !OUT_FLOAT[e.cause]) return false;
        const r = vr(e.rid);
        if (r) r.out = true;
        Sound.chomp();
        floater(e.rid, OUT_FLOAT[e.cause], 'bad');
        commentary(e.text);
        await pause(300);
        layoutTokens();
        await pause(650);
        return true;
      }
      default:
        return false;
    }
  }
  // 漩涡：格子转一下，小球顺着同色管道滑到另一端（棋子先隐身，随后的瞬移在出口现身）
  async function playWhirl(e, pause) {
    whirlRide = { rid: e.rid };
    const pipe = $(`#trackSvg .twl-pipe[data-p~="${e.pos}"]`);
    pulseCell(e.pos);
    if (!playSfx('whirl')) Sound.warp();
    floater(e.rid, `漩涡 → 第 ${e.to} 格`, 'good');
    const el = tokenOf(e.rid);
    if (fast || reducedMotion.matches || !pipe) { await pause(300); return; }
    restartClass(pipe, 'flow', 1100);
    if (el) el.classList.add('warp-out');
    const core = $('.twl-core', pipe);
    const d = core && core.getAttribute('d');
    const k = Number(pipe.dataset.k) || 0;
    if (d) {
      const svg = arcLayer();
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'v2-ball');
      const r = vr(e.rid);
      const ring = r ? PCOL[r.seat % 6] : '#fff';
      g.innerHTML = `<circle r="${layout === 'wide' ? 12 : 11}" fill="${WHIRL_COLS[k]}" stroke="${ring}" stroke-width="4"/><circle r="${layout === 'wide' ? 12 : 11}" fill="none" stroke="${INK}" stroke-width="1.6"/><path d="${spiralD(0, 0, 6.5, 1.5)}" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
      const am = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
      const startsAtA = Number(pipe.dataset.p.split(' ')[0]) === e.pos;
      am.setAttribute('dur', `${Math.round(620 / speed)}ms`);
      am.setAttribute('path', d);
      am.setAttribute('fill', 'freeze');
      am.setAttribute('begin', 'indefinite');
      am.setAttribute('calcMode', 'linear');
      am.setAttribute('keyPoints', startsAtA ? '0;1' : '1;0');
      am.setAttribute('keyTimes', '0;1');
      g.appendChild(am);
      svg.appendChild(g);
      try { am.beginElement(); } catch (err) { /* 不支持 SMIL 时只亮管道 */ }
      setTimeout(() => g.remove(), 620 / speed + 260);
    }
    await pause(640);
  }

  /* ---------- 二代决策 ---------- */
  const V2_SUB = {
    soulmate: '它在 5 格内时，你回合开始会瞬移到它身边',
    understudy: '本场改用它的技能',
    diva: '和它直接交换位置',
    athleteWarp: '瞬移到它的格子，那格的人都会摔倒',
    kingtripper: '被绊倒的人下回合跳过主移动',
    switcharoo: '交换后它归你控制，你的运动员归对方',
    kraken: '所有人瞬移到你的格子并摔倒，每场只能用一次',
    tail: '瞬移到前方最近那名运动员身后一格',
    critic: '它的主移动骰要重掷一次（每回合一次）',
    nemesis: '你也掷一颗：点数相同，等它走完你也前进同样格数',
    cheatahSet: '右手边的玩家会来猜，猜中你就原地不动；猜错按这个数走',
    cheatahGuess: '猜中了它就走不了；猜错它按暗定的数走',
  };
  Object.assign(WAIT_TEXT, {
    soulmate: '在挑灵魂伴侣', understudy: '在挑要学的技能', diva: '在挑换位对象', athleteWarp: '在挑瞬移目标',
    kingtripper: '在考虑绊谁', switcharoo: '在考虑要不要调包', kraken: '在考虑要不要放大海怪', tail: '在考虑要不要跟上',
    critic: '在考虑要不要差评', nemesis: '在考虑要不要跟掷', cheatahSet: '在暗定步数', cheatahGuess: '在猜步数',
    showoff: '在考虑要不要再掷', diceguy: '在挑点数', swapmeet: '在逛跳蚤市场', copycat: '在挑要模仿谁',
  });
  function v2TokenPrompt(d) {
    const map = {};
    for (const o of d.options) if (R[o.v] && vr(o.v) && tokenOf(o.v)) map[o.v] = o.v;
    const pick = d.options.filter((o) => map[o.v]), rest = d.options.filter((o) => !map[o.v]);
    const opts = pick.map((o) => optBtn(o, 1, { d, primary: false, cls: 'sm' })).join('')
      + rest.map((o, k) => optBtn(o, k, { d })).join('');
    if (pick.length) {
      for (const rid of Object.keys(map)) tokenOf(rid).classList.add('selectable');
      tokenPick = { map, fn: (v) => answer(d, v) };
    }
    const tip = V2_SUB[d.kind] || '';
    return { opts, sub: pick.length ? `${tip ? `${tip} · ` : ''}也可以直接点赛道上闪烁的棋子` : tip };
  }
  function v2ButtonPrompt(d) {
    const opts = d.options.map((o, k) => optBtn(o, k, { d })).join('');
    let sub = V2_SUB[d.kind] || '';
    if (d.kind === 'tail' && d.target != null) {
      const c = $(`#trackSvg .cell[data-p="${d.target}"]`);
      if (c) { $('#board').classList.add('picking-cell'); c.classList.add('pick'); c.onclick = () => answer(d, 'yes'); sub += ' · 也可以直接点闪烁的格子'; }
    }
    if ((d.kind === 'critic' || d.kind === 'nemesis') && typeof d.target === 'string' && R[d.target]) {
      const el = tokenOf(d.target);
      if (el) el.classList.add('selectable');
      if (el) tokenPick = { map: { [d.target]: 'yes' }, fn: (v) => answer(d, v) };
      sub = `${rname(d.target)} 掷出了 ${d.roll} · ${sub}`;
    }
    if (d.kind === 'showoff') sub = `已累计 ${d.sum ?? '?'} 格 · 再掷必须比 ${d.roll ?? '上一次'} 大，否则这次主移动不动`;
    if (d.kind === 'diceguy') sub = `${Array.isArray(d.dice) ? `六颗骰子：${d.dice.join(' ')} · ` : ''}只能走出现了不止一次的点数`;
    return { opts, sub };
  }
  function v2NumberPrompt(d) {
    const opts = `<div class="dc-nums">${d.options.map(numBtn).join('')}</div>`;
    return { opts, sub: V2_SUB[d.kind] || '' };
  }
  // 跳蚤市场（同时决策）：两张卡二选一——留下场上的，或换成新抽的
  function showSwapMeetOverlay(d) {
    const mineOpts = d.optionsBySeat[you];
    const answered = d.done.includes(you);
    const sending = !!(submitted && submitted.id === d.id);
    const key = `swap:${d.id}:${answered}:${sending}:${connection}`;
    if (overlayKind === 'pick' && overlayDecision === key) { updatePickStatus(d); return; }
    const canPick = !!mineOpts && !answered && !sending && connection === 'ready';
    const me = seatRacer(you);
    const keep = mineOpts && mineOpts.find((o) => o.v === 'keep');
    const swap = mineOpts && mineOpts.find((o) => o.v === 'swap');
    const curId = me ? (me.power && R[me.power] ? me.power : me.rid) : null;
    const cards = mineOpts && !answered ? [
      curId ? rcard(curId, { cls: canPick ? 'pickable deal' : 'dim', k: 0 }).replace('class="rcard', 'data-v="keep" class="rcard') : '',
      swap && R[swap.card] ? rcard(swap.card, { cls: canPick ? 'pickable deal' : 'dim', k: 1 }).replace('class="rcard', 'data-v="swap" class="rcard') : '',
    ].join('') : '';
    const sub = sending ? '正在提交，等待服务器确认…' : connection !== 'ready' ? '断线中，重连同步后可重新选择' : canPick ? '左边留着场上的运动员，右边换成新抽到的（技能一起换）' : answered ? '你已决定，等待其他人…' : '其他玩家正在暗中决定…';
    if (phoneDraft()) {
      const items = [];
      if (mineOpts && !answered) {
        if (curId && keep) items.push({ v: 'keep', rid: curId, t: skSplit(keep.label)[0], s: skSplit(keep.label)[1] || '留着场上的运动员' });
        if (swap && R[swap.card]) items.push({ v: 'swap', rid: swap.card, t: skSplit(swap.label)[0], s: skSplit(swap.label)[1] || '换成新抽到的' });
      }
      return showChoosePhone({ d, kind: 'pick', decision: key, title: '变数卡 · 跳蚤市场', sub, canPick, answered, sending, verb: '确认', items, extra: [], status: true });
    }
    showOverlay(`<div class="ov-box card v2-swapmeet"><h2>变数卡 · 跳蚤市场</h2><p class="sub">${esc(sub)}</p>
      <div class="ov-cards" id="pickCards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div>
      ${canPick ? `<div class="ov-actions">${keep ? `<button class="btn" data-v="keep">${esc(keep.label)}</button>` : ''}${swap ? `<button class="btn primary" data-v="swap">${esc(swap.label)}</button>` : ''}</div>` : ''}
      <div class="pick-status" id="pickStatus" hidden></div></div>`, 'pick');
    overlayDecision = key;
    updatePickStatus(d);
    fitOverlayCards(true);
    for (const el of $$('#overlay [data-v]')) {
      el.onclick = canPick ? () => { if (answer(d, el.dataset.v)) { Sound.card(); el.classList.add('chosen'); } } : () => { denyCue(); nudge(el); };
    }
    if (canPick) focusFirst('#overlay .ov-actions .sk-btn.primary', `pick:${d.id}`);
  }
  function renderSwapMeetDock(dock, d, mine) {
    const key = `swapmeet:${gameId}:${d.id}:${mine}`;
    if ($('.prompt', dock)?.dataset.k !== key) {
      dock.innerHTML = promptHtml({ seat: you, mine, title: mine ? '跳蚤市场：换不换运动员？' : '等待其他人逛完跳蚤市场', sub: mine ? '在上方二选一，所有人同时揭晓' : '所有人决定后同时揭晓' });
      $('.prompt', dock).dataset.k = key;
    }
    if (mine) { yourTurnPing(d.id); addTimer(); }
  }


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
    if (window.ResizeObserver) new ResizeObserver(syncSpot).observe($('#board'));
    initEmotes();
    if (window.Music) Music.follow(musicScene);
    for (const b of $$('[data-open]')) b.addEventListener('click', () => { Sound.click(); openModal(b.dataset.open); });
    for (const b of $$('[data-sound]')) b.addEventListener('click', () => { Sound.cycleMode(); renderTopButtons(); Sound.click(); });
    renderSoundToggles();
    window.addEventListener('resize', () => { syncSpot(); checkLayout(); hideTip(); placePlayerPop(); fitDraft(); refitPagers(); fitRooms(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && queue.length > 1) fast = true; });
    showScreen(new URLSearchParams(location.search).get('room') ? 'lobby' : 'home');
    connect();
  }
  init();
})();
