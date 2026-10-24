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
    for (let level = 0; level <= 4; level++) {
      home.dataset.tight = level;
      paginate('rooms', list, () => $$('#roomList .room-list-item'), $('#roomPager'));
      if (list.scrollHeight <= list.clientHeight + 1 && inner.scrollHeight <= inner.clientHeight + 1) break;
    }
    // 房间列表被挤压时要连同首页收紧级别一起重算，单独重排分页会和收紧级别打架
    pagers.rooms.refit = fitRooms;
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
    $('#watchBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'watch', ai: watchN }); };
    $('#quickBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'quick', ai: aiN }); };
    $('#createBtn').onclick = () => { Sound.click(); ensureName(); send({ type: 'create' }); };
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
          const sl = (SLOTS[Math.min(n, 6)] || SLOTS[6])[k % 6];
          const f = crowd && layout === 'tall' ? 1.1 : 1;
          [dx, dy] = layout === 'wide' ? sl : [sl[1] * f, sl[0] * f];
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
  // 顶栏标题只讲「现在是什么局面」：场次 + 轮到谁 + 离你还有几位（手机上场次名会让位给后两项）
  function renderTitle() {
    if (!vs) return;
    const el = $('#topTitle');
    const part = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
    let html = '', plain = '';
    if (vs.phase === 'draft') {
      plain = isParticipant() ? '选秀：组建你的 4 人队伍' : 'AI 选秀：自动组建队伍';
      html = esc(plain);
    } else if (vs.phase === 'pick') {
      plain = `第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name} · ${isParticipant() ? '派谁上场？' : 'AI 正在暗选出战'}`;
      html = esc(plain);
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
    } else if (vs.phase === 'between') { plain = `第 ${vs.raceNo} 场结束`; html = esc(plain); }
    else if (vs.phase === 'over') { plain = '比赛结束'; html = esc(plain); }
    if (el.dataset.plain === plain) return;
    el.dataset.plain = plain;
    el.innerHTML = html;
    el.title = plain;
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
    $('#soundBtn').innerHTML = `<span class="ico">${icon(Sound.ui.icon)}</span>`;
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
  function fitPlayerNames() {
    const box = $('#players');
    if (!box) return;
    const first = $('.prow', box);
    const narrow = !!first && first.getBoundingClientRect().width > 0 && first.getBoundingClientRect().width < 118 && matchMedia('(max-width: 1000px) and (orientation: portrait)').matches;
    box.classList.toggle('pf-stack', narrow);
    for (const nm of $$('.prow .pnm', box)) {
      nm.style.fontSize = '';
      nm.classList.remove('clip');
      for (const fs of [11.5, 10.5]) {
        if (nm.scrollWidth <= nm.clientWidth + 1) break;
        nm.style.fontSize = `${fs}px`;
      }
      if (nm.scrollWidth > nm.clientWidth + 1) nm.classList.add('clip');
    }
  }

  function renderPlayers() {
    if (!vs) return;
    const d = snap && snap.pending;
    const racing = vs.phase === 'race' || vs.phase === 'between';
    const ahead = vs.phase === 'race' ? turnsAhead() : null;
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
      const tags = `${p.seat === you ? '<span class="you">你</span>' : ''}${(autoFlags[p.seat] || offline) && !p.ai ? `<span class="auto">${modeLabel}</span>` : ''}${p.ai ? '<span class="auto ai">AI</span>' : ''}`;
      // 快轮到你：你的选手下一个行动时，你的玩家卡轻轻脉冲
      const soon = p.seat === you && ahead === 1 && !think;
      return `<div class="prow ${vs.curSeat === p.seat && vs.phase === 'race' ? 'cur' : ''} ${p.seat === you ? 'me' : ''} ${soon ? 'soon' : ''} ${p.ai ? 'is-ai' : ''}" data-seat="${p.seat}" data-fly-target="seat-${p.seat}" style="--c:${c}" title="${esc(p.name)}">
        <div class="pav" ${cur && racing ? `data-tip="${cur.rid}"` : ''}>${ava}</div>
        <div class="pn"><b><span class="pnm">${esc(pname(p))}</span>${tags}</b>${line}<div class="hand">${hand}</div></div>
        <div class="sc" title="${scoreTitle}"><b data-score="${p.seat}">${p.score}</b><span>分</span></div>${think}${soon ? '<span class="soon-tag">下一个是你</span>' : ''}</div>`;
    }).join('');
    fitPlayerNames();
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
    const cards = $$('#draftCards .rcard');
    for (const el of cards) {
      el.classList.toggle('pickable', mine);
      el.classList.remove('tap-hint');
      el.onclick = mine ? () => {
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
        el.innerHTML = `<span class="sr"></span><span class="sa">${art(r.rid)}</span><span class="sn"><b>${esc(R[r.rid].name)}</b><i>${esc(pname(vs.players[r.seat]))}${r.seat === you && isParticipant() ? '<em class="st-you">你</em>' : ''}</i></span><span class="ss"></span><span class="sbar"><em></em></span>`;
        el.style.transition = 'none';
        box.appendChild(el);
      }
      el.style.width = `${w}px`;
      el.style.transform = `translateX(${x0 + i * (w + gap)}px)`;
      const sr = $('.sr', el);
      sr.textContent = r.finished ? (r.finished === 1 ? '冠' : '亚') : r.out ? '出' : rank;
      sr.className = `sr ${r.finished ? `rk${r.finished}` : r.out ? 'rko' : ''}`;
      // 名次条直接写「还差几格到终点」，格数位置放在悬停说明里
      const ss = $('.ss', el), left = FIN - r.pos;
      ss.innerHTML = r.finished ? '已冲线' : r.out ? '被吃掉' : `${r.tripped ? '摔倒 · ' : ''}差 <b>${left}</b> 格`;
      ss.title = r.finished || r.out ? '' : `在第 ${r.pos} 格，离终点还差 ${left} 格`;
      ss.classList.toggle('bad', !!r.tripped && !r.finished);
      $('.sbar em', el).style.width = `${r.finished ? 100 : r.out ? 0 : Math.round(r.pos / FIN * 100)}%`;
      el.classList.toggle('cur', vs.curSeat === r.seat && vs.phase === 'race' && !r.finished && !r.out);
      el.classList.toggle('me', r.seat === you && isParticipant());
      el.classList.toggle('gone', !!r.out);
      if (fresh) { void el.offsetWidth; el.style.transition = ''; }
    });
  }

  // 行动卡：谁在行动（头像、玩家、选手）→ 他的技能 → 位置进度 + 接下来的行动顺序；右上角标签告诉你还有几位轮到你
  let tcRid = null, tcSoonSaid = null;
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
    const pos = r.tripped
      ? '<span class="tc-pos bad">摔倒中 · 本回合爬起来，不掷骰</span>'
      : `<span class="tc-pos" title="在第 ${r.pos} 格，离终点还差 ${left} 格">第 <b>${r.pos}</b> 格 · 差 <b>${left}</b> 格</span>`;
    // 行动顺序：当前行动者在最前，最多显示 4 位，你的选手标「你」
    const order = turnOrder();
    const q = order.slice(0, 4).map((x, k) => `<i class="tq ${k === 0 ? 'now' : ''} ${x.seat === you && isParticipant() ? 'me' : ''}" style="--c:${PCOL[x.seat % 6]}" title="${k === 0 ? '正在行动' : `第 ${k} 位`}：${esc(pname(vs.players[x.seat]))}的${esc(R[x.rid].name)}">${art(x.rid)}${x.seat === you && isParticipant() ? '<em>你</em>' : ''}</i>`).join('<span class="tq-arr" aria-hidden="true"></span>');
    const more = order.length > 4 ? `<span class="tq-more">+${order.length - 4}</span>` : '';
    const cue = ahead == null ? '' : `<span class="tc-cue ${ahead === 0 ? 'mine' : ahead === 1 ? 'soon' : ''}">${aheadText(ahead)}</span>`;
    tc.hidden = false;
    tc.style.setProperty('--c', PCOL[r.seat % 6]);
    tc.style.setProperty('--rc', rcol(r.rid));
    tc.innerHTML = `${cue}<div class="tc-head"><div class="tc-ava">${art(r.rid)}</div><div class="tc-who"><span class="tc-player">${esc(pname(p))}${r.seat === you ? ' · 你' : p.ai ? ' · AI' : ''}</span><b>${esc(base.name)}</b></div></div>
      <div class="tc-bar" aria-hidden="true"><em style="width:${Math.round(r.pos / FIN * 100)}%"></em></div>
      <div class="tc-skill"><span class="sk">${esc((pw || base).skill)}</span>${pw ? `<em>借自${esc(pw.name)}</em>` : ''}<p>${esc((pw || base).text)}</p></div>
      <div class="tc-st ${r.tripped ? 'bad' : ''}">${pos}${order.length > 1 ? `<span class="tc-q" aria-label="行动顺序">${q}${more}</span>` : ''}</div>`;
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
      const col = info.seat != null ? `style="--c:${PCOL[info.seat % 6]}"` : '';
      html = `<span class="com-skill" ${col}><small class="cs-tag">技能</small><b class="cs-name">「${esc(info.skill)}」</b><i class="cs-who">${esc(info.who)}${info.borrowed ? `（借自${esc(info.borrowed)}）` : ''}</i><em class="cs-eff${[...String(info.effect)].length <= 14 ? ' nw' : ''}">${esc(info.effect)}</em></span>`;
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
        }
        renderPlayers();
        // 被选走的卡先被「拎起」，再飞向该玩家的队伍栏/玩家卡；找不到落点就原地淡出
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
          if (el) el.classList.add('gone');
          await pause(560);
        }
        vs.faceUp = vs.faceUp.filter((id) => id !== e.rid);
        if (el) removeDraftCard(el);
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
        setDice(`<div class="die rolling">${die(1 + Math.floor(Math.random() * 6))}</div>`, '掷骰中');
        Sound.dice();
        const spin = setInterval(() => { if (epoch !== animationEpoch) return; const d = $('#diceZone .die.rolling'); if (d) d.innerHTML = die(1 + Math.floor(Math.random() * 6)); }, 90);
        animationIntervals.add(spin);
        await pause(T.spin);
        clearInterval(spin); animationIntervals.delete(spin);
        setDice(`<div class="die land" style="--c:${r ? PCOL[r.seat % 6] : INK}">${die(e.value)}<div class="die-cap">${cap}</div></div>`, `掷出 ${e.value} 点`);
        // 「叮」响在点数落到棋子上的那一刻：后面跟着 calc 的，由 calc 的飞点落地时响；没有加减值的，定格的骰点就是最终点数
        if (!fast && !calcFollows(e)) playSfx('diceLand', e.value);
        await pause(T.land);
        break;
      }
      case 'calc': {
        const mods = e.mods.map((m) => `<span class="m ${m.v < 0 ? 'neg' : 'pos'}">${esc(m.label)} ${m.v > 0 ? '+' : ''}${m.v}</span>`).join('');
        setDice(`<div class="calc"><div class="die" style="width:calc(56*var(--u));height:calc(56*var(--u))">${e.base <= 6 ? die(e.base) : ''}</div>${e.base > 6 ? `<b>${e.base}</b>` : ''}${mods}<span>=</span><span class="eq">${e.total}</span></div>`, `主移动 ${e.total} 格`);
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
  // 技能提示卡的落点：在棋盘坐标里挑一个不压行动卡、骰子、解说和被影响棋子的位置。
  // 优先贴着发动者（上/下带小尖角）；贴不下就放到棋盘空白处，另画一条引线连回发动者。
  function calloutSpot(card, pt, cw, hitEls) {
    const [W, H] = VB();
    const fl = $('#floaters');
    const box = fl.getBoundingClientRect();
    const k = W / (box.width || 1);
    const ch = card.offsetHeight * k || 90;
    const vbRect = (r, pad = 0) => ({ x: (r.left - box.left) * k - pad, y: (r.top - box.top) * k - pad, w: r.width * k + pad * 2, h: r.height * k + pad * 2 });
    const obs = [];
    const add = (el, wgt, pad) => { if (!el) return; const r = el.getBoundingClientRect(); if (r.width && r.height) obs.push({ ...vbRect(r, pad), wgt }); };
    const tc = $('#turnCard');
    if (tc && !tc.hidden) add(tc, 6, 4);
    // 骰子区：骰子可能稍后才出现，按中央区域中间一块预留
    const main = $('#center .center-main');
    if (main) {
      const m = vbRect(main.getBoundingClientRect());
      const dw = Math.min(m.w, 230), dh = Math.min(m.h, 130);
      obs.push({ x: m.x + (m.w - dw) / 2, y: m.y + (m.h - dh) / 2 - 8, w: dw, h: dh, wgt: 4 });
      obs.push({ x: m.x, y: m.y + m.h - 64, w: m.w, h: 64, wgt: 1.5 });
    }
    for (const d of $$('#diceZone > *')) add(d, 4, 4);
    for (const t of hitEls) add(t, 8, 6);
    for (const t of $$('#tokens .token')) if (!hitEls.includes(t)) add(t, 1.5, 0);
    const tok = 30;
    obs.push({ x: pt.x - tok, y: pt.y - tok, w: tok * 2, h: tok * 2, wgt: 8 });
    const area = cw * ch;
    const cost = (x, y) => {
      let c = 0;
      for (const o of obs) {
        const ix = Math.min(x + cw, o.x + o.w) - Math.max(x, o.x), iy = Math.min(y + ch, o.y + o.h) - Math.max(y, o.y);
        if (ix > 0 && iy > 0) c += o.wgt * ix * iy / area * 100;
      }
      return c;
    };
    const clampX = (x) => Math.max(6, Math.min(W - cw - 6, x));
    const clampY = (y) => Math.max(6, Math.min(H - ch - 6, y));
    const off = layout === 'tall' ? 30 : 34;
    let best = null;
    const consider = (x, y, side, extra) => {
      const c = cost(x, y) + extra;
      if (!best || c < best.c) best = { x, y, side, c };
    };
    // 1) 贴着发动者：上方或下方，尖角在卡片宽度内滑动
    for (const side of ['above', 'below']) {
      const y = side === 'above' ? pt.y - off - ch : pt.y + off;
      if (y < 4 || y + ch > H - 4) continue;
      for (let f = 0; f <= 1.0001; f += 0.125) {
        const x = clampX(pt.x - 18 - f * (cw - 36));
        if (pt.x - x < 16 || pt.x - x > cw - 16) continue;
        consider(x, y, side, Math.abs(f - 0.5) * 2);
      }
    }
    // 2) 棋盘内任意空白处（带引线），离发动者越远代价越高
    if (best && best.c > 3) {
      for (let y = 6; y <= H - ch - 6; y += 12) {
        for (let x = 6; x <= W - cw - 6; x += 16) {
          const cx = Math.max(x, Math.min(x + cw, pt.x)), cy = Math.max(y, Math.min(y + ch, pt.y));
          consider(x, y, 'free', 4 + Math.hypot(cx - pt.x, cy - pt.y) / 18);
        }
      }
    }
    if (!best) best = { x: clampX(pt.x - cw / 2), y: clampY(pt.y < H * 0.3 ? pt.y + off : pt.y - off - ch), side: pt.y < H * 0.3 ? 'below' : 'above' };
    return { x: best.x, y: best.y, w: cw, h: ch, side: best.side, ax: Math.max(16, Math.min(cw - 16, pt.x - best.x)) };
  }
  function calloutLeader(spot, pt, color, life) {
    if (reducedMotion.matches) return;
    const svg = arcLayer();
    // 从卡片边缘离发动者最近的点连到棋子边缘
    const ex = Math.max(spot.x + 10, Math.min(spot.x + spot.w - 10, pt.x)), ey = Math.max(spot.y + 8, Math.min(spot.y + spot.h - 8, pt.y));
    const d = Math.hypot(pt.x - ex, pt.y - ey);
    if (d < 32) return;
    const r = (layout === 'tall' ? 25 : 29) + 2;
    const tx = pt.x - (pt.x - ex) / d * r, ty = pt.y - (pt.y - ey) / d * r;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'sk-arc skc-lead');
    g.style.setProperty('--ac', color);
    const p = `M${ex.toFixed(1)} ${ey.toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)}`;
    g.innerHTML = `<path class="under" d="${p}" pathLength="1"/><path class="over" d="${p}" pathLength="1"/><circle class="dot" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="6"/>`;
    svg.appendChild(g);
    animationLater(() => g.classList.add('out'), life);
    animationLater(() => g.remove(), life + 320);
  }
  // 技能提示卡
  function skillCallout(rid, key, targets = []) {
    const info = R[key];
    if (!info || fast) return false;
    const el = tokenOf(rid);
    const r = vr(rid);
    const [W, H] = VB();
    const fl = $('#floaters');
    for (const old of $$('.skc', fl)) { old.classList.add('out'); setTimeout(() => old.remove(), 220); }
    const owner = r && vs.players[r.seat] ? vs.players[r.seat].name.replace(/（AI）$/, '') : '';
    const col = r ? PCOL[r.seat % 6] : INK;
    const who = R[rid] ? R[rid].name : '';
    const card = document.createElement('div');
    card.className = 'skc';
    card.style.setProperty('--c', col);
    card.innerHTML = `<div class="skc-av">${art(rid)}</div><div class="skc-tx"><b>${esc(info.skill)}</b><span>${esc(owner ? `${owner} · ${who}` : who)}${key !== rid ? `（借用${esc(info.name)}）` : ''}</span><i>${esc(info.text)}</i></div>`;
    const cw = layout === 'tall' ? 280 : 330;
    const pt = el && el.style.left ? tokenPt(el) : { x: W / 2, y: H / 2 };
    card.classList.add(layout === 'tall' ? 'tall' : 'wide');
    card.style.visibility = 'hidden';
    fl.appendChild(card);
    const spot = calloutSpot(card, pt, cw, targets.filter((t) => t !== rid).map(tokenOf).filter(Boolean));
    card.style.left = `${spot.x / W * 100}%`;
    card.style.top = `${spot.y / H * 100}%`;
    card.style.setProperty('--ax', spot.ax);
    card.classList.add(spot.side);
    card.style.visibility = '';
    // 卡片没贴在发动者旁边时（为了避开行动卡/骰子），用一条引线连回发动者
    if (spot.side === 'free') calloutLeader(spot, pt, col, Math.max(1000, 1700 / speed));
    const voiced = playSfx('callout');
    const life = reducedMotion.matches ? 1200 : Math.max(1000, 1700 / speed);
    animationLater(() => card.classList.add('out'), life);
    animationLater(() => card.remove(), life + 260);
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
  // 移走选秀卡，其余卡用 FLIP 平滑补位（分页可能重排，先量旧位置）
  function removeDraftCard(el) {
    const box = $('#draftCards');
    const smooth = !fast && !reducedMotion.matches && box && box.contains(el);
    const first = smooth ? new Map($$('#draftCards .rcard').filter((c) => c !== el && !c.hidden).map((c) => [c, c.getBoundingClientRect()])) : null;
    el.remove();
    if (!smooth) return;
    fitDraft();
    for (const c of $$('#draftCards .rcard')) {
      if (c.hidden) continue;
      const f = first.get(c);
      const l = c.getBoundingClientRect();
      if (!f) { c.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' }); continue; }
      const dx = f.left - l.left, dy = f.top - l.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.3, .7, .4, 1)' });
    }
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
    showOverlay(`<div class="ov-box card"><h2>第 ${vs.raceNo} 场 · 选手登场</h2><p class="sub">${TRACKS[vs.track].name}</p><div class="reveal-grid">${cards}</div><div style="height:30px"></div></div>`, 'reveal');
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
    finalReadyAt = performance.now() + (now ? 0 : (window.Timing ? Timing.eventMs({ t: 'gameOver' }) : 2000) / Math.max(1, speed));
    syncFinalActions();
    $('#toHome').onclick = () => { Sound.click(); if (navigate('leave', $('#toHome'))) $('#toHome').classList.add('is-loading'); };
    $('#ovClose').onclick = () => { Sound.click(); hideOverlay(); };
    if (hasKeyboard.matches) { const f = $('#again:not(:disabled)') || $('#toHome'); if (f) f.focus({ preventScroll: true }); }
  }

  function showPickOverlay(d) {
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
    showOverlay(`<div class="ov-box card"><h2>第 ${vs.raceNo} 场 · ${TRACKS[vs.track].name}</h2>
      <p class="sub">冠军 ${GOLD[idx]} 分 · 亚军 ${SILVER[idx]} 分 · ${sending ? '正在提交，等待服务器确认…' : connection !== 'ready' ? '断线中，重连同步后可重新选择' : canPick ? `派谁上场？${hint}` : answered ? '你的出牌已确认，等待其他人…' : '等待其他人出牌…'}</p>
      <div class="ov-cards" id="pickCards" data-fit>${cards}</div><div class="pager ov-pager" id="ovPager" hidden></div><div class="pick-status" id="pickStatus"></div></div>`, 'pick');
    overlayDecision = key;
    updatePickStatus(d);
    fitOverlayCards(true);
    for (const el of $$('#pickCards .rcard')) {
      el.onclick = canPick ? () => { if (answer(d, el.dataset.id)) { Sound.card(); el.classList.add('chosen'); } } : () => { denyCue(); nudge(el); };
    }
    if (canPick) focusFirst('#pickCards .rcard.pickable:not([hidden])', `pick:${d.id}`);
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
    const cardOpts = d.options.filter((o) => R[o.v]);
    const cards = cardOpts.map((o, k) => rcard(o.v, { cls: 'pickable deal', k })).join('');
    // 只有一张候选时，主操作就是「复制它 / 孵出它」，不用让人去猜要点卡牌
    const verb = d.kind === 'twin' ? '复制' : d.kind === 'egg' ? '孵出' : '选';
    const main = cardOpts.length === 1 ? `<button class="btn primary big wpc-main" data-v="${esc(cardOpts[0].v)}"><span class="ico">${icon(d.kind === 'twin' ? 'copy' : 'check')}</span>${verb}「${esc(R[cardOpts[0].v].name)}」</button>` : '';
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
      dock.innerHTML = promptHtml({ seat: you, mine: false, title: '比赛结束', sub: spectator && !host ? '等房主开启下一场 AI 对局…' : '四场胡闹已落幕', opts: `<button class="btn" data-x="show">查看成绩</button>${host ? `<button class="btn primary" data-x="again" data-navigation="${again}" ${navigationPending ? 'disabled' : ''}>${spectator ? '再看一局' : '再来一局'}</button>` : ''}<button class="btn" data-x="home">回到首页</button>` });
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
    const r = vs.racers.find((x) => x.seat === you);
    switch (d.kind) {
      case 'draft':
        dock.innerHTML = promptHtml({ seat: you, mine: true, title: '轮到你选人了！', sub: '点击上方任意一张卡牌，把它招进你的队伍' });
        addTimer();
        return;
      case 'roll':
        opts = `<button class="btn roll-btn" data-v="roll"><span class="ico">${icon('dice')}</span>掷骰子</button>`;
        sub = r ? `${R[r.rid].name} 在第 ${r.pos} 格${hasKeyboard.matches ? ' · 按空格也能掷' : ''}` : '';
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
    for (const b of $$('#dock [data-v]')) {
      b.onclick = () => {
        Sound.click();
        if (!answer(d, b.dataset.v)) nudge(b);
      };
    }
    addTimer();
    if (hasKeyboard.matches) focusFirst('#dock .prompt.mine .btn.primary, #dock .prompt.mine [data-v]', `dock:${d.id}`);
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
      opts = `<button class="btn primary wpc-skip ${sending ? 'is-loading' : ''}" data-x="skip" ${sending || connection !== 'ready' ? 'disabled' : ''}><span class="ico">${icon('bolt')}</span><span class="lbl">${sending ? '正在快进…' : '快进到结算'}</span></button>`;
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

  function promptHtml({ seat, mine, title, sub, opts, busy, cls }) {
    const r = vs.racers.find((x) => x.seat === seat);
    const c = PCOL[seat % 6] || '#ccc';
    const ava = r && vs.phase === 'race' ? art(r.rid) : '';
    return `<div class="prompt ${mine ? 'mine' : 'wait'} ${busy ? 'busy' : ''} ${cls || ''}" style="--c:${c}">${ava ? `<div class="p-ava">${ava}</div>` : ''}<div class="p-txt" title="${esc(sub ? `${title}\n${sub}` : title)}"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>${opts ? `<div class="p-opts">${opts}</div>` : ''}<div class="timer" hidden></div></div>`;
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
          ${hasKeyboard.matches ? '<li>空格键可以直接掷骰。</li>' : ''}
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
    // 倍速循环 1 → 1.5 → 2.2 → 1（与 hub.js 的 SPEEDS 一致）：往快里切用「嗖↑」，绕回 1 倍用普通点击
    $('#speedBtn').onclick = () => { if (!(speed < 2.2 && playSfx('boost'))) Sound.click(); send({ type: 'speed' }); };
    $('#autoBtn').onclick = () => { Sound.click(); send({ type: 'auto', on: !autoFlags[you] }); };
    $('#soundBtn').onclick = () => { Sound.cycleMode(); renderTopButtons(); Sound.click(); };
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
    if (window.Music) Music.follow(musicScene);
    for (const b of $$('[data-open]')) b.addEventListener('click', () => { Sound.click(); openModal(b.dataset.open); });
    for (const b of $$('[data-sound]')) b.addEventListener('click', () => { Sound.cycleMode(); renderTopButtons(); Sound.click(); });
    renderSoundToggles();
    window.addEventListener('resize', () => { checkLayout(); renderStandings(); hideTip(); refitPagers(); fitRooms(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && queue.length > 1) fast = true; });
    showScreen(new URLSearchParams(location.search).get('room') ? 'lobby' : 'home');
    connect();
  }
  init();
})();
