// 语音开麦：WebRTC 两两直连，服务端 /ws 只转发信令；直连不通时走服务端下发的 TURN 中继。
// 只要两人里有一方开着麦就建立连接；都闭麦一段时间后断开省带宽。连接里固定一条双向音频，
// 开闭麦只换发送轨道（replaceTrack），不需要重新协商。
(function () {
  const IDLE_CLOSE = 20000; // 双方都闭麦后多久断开
  const TALK_LEVEL = 0.03; // 两次采样之间的平均音量（0~1）超过算在说话
  const TALK_HOLD = 500; // 说话标记保持多久，避免字与字之间闪烁
  const supported = !!window.RTCPeerConnection;
  let hooks = { send: () => false, toast: () => {} };
  let you = null, myPid = null, mySeat = -1;
  let peers = new Map(); // 连接 id -> { id, pid, seat, name, mic }
  let ice = [];
  const conns = new Map(); // 连接 id -> { sid, pc, sender, audio, queue, out, offered }
  const retryAt = new Map(); // 连接失败后的重连退避 { at, n }
  let stream = null, opening = false, wantMic = false, micPending = false, micSentFor = null;
  let inRoom = false; // 断线重连期间 you 为空但仍在房间里，麦克风不关
  let deaf = false;
  try { deaf = localStorage.getItem('hn_voice_deaf') === '1'; } catch (e) { /* ignore */ }
  let actx = null, analyser = null, levelBuf = null;
  let timer = null, ticking = false, lastSync = 0, blocked = false;
  const talking = new Set(); // 正在说话的连接 id（自己用 you）
  const heardAt = new Map(); // 连接 id -> 最近一次音量过线的时间
  let audioBox = null, talkChip = null;

  const sid = () => Math.random().toString(36).slice(2, 10);
  const signal = (to, data) => hooks.send({ type: 'rtc', to, data });
  const micOnline = () => !!stream && !!peers.get(you) && peers.get(you).mic;

  function ensureBox() {
    if (audioBox) return audioBox;
    audioBox = document.createElement('div');
    audioBox.hidden = true;
    document.body.appendChild(audioBox);
    return audioBox;
  }
  function play(audio) {
    const p = audio.play();
    if (p && p.catch) p.catch(() => {
      // 浏览器拦了自动播放：等下一次点按屏幕再放
      if (!blocked) { blocked = true; hooks.toast('点一下屏幕就能听到语音'); }
    });
  }
  function unblock() {
    if (!blocked) return;
    blocked = false;
    for (const c of conns.values()) if (c.audio.srcObject) play(c.audio);
  }
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unblock, { capture: true, passive: true });

  /* ---------- 连接 ---------- */
  function createConn(id, session) {
    const pc = new RTCPeerConnection({ iceServers: ice });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.muted = deaf;
    ensureBox().appendChild(audio);
    const c = { id, sid: session, pc, sender: null, audio, queue: [], out: [], offered: false, idleSince: 0 };
    pc.onicecandidate = (e) => {
      if (!e.candidate || conns.get(id) !== c) return;
      const cand = e.candidate.toJSON();
      if (c.offered) signal(id, { sid: c.sid, ice: cand }); else c.out.push(cand);
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      play(audio);
    };
    pc.onconnectionstatechange = () => {
      if (conns.get(id) !== c) return;
      if (pc.connectionState === 'failed') {
        const r = retryAt.get(id) || { n: 0 };
        retryAt.set(id, { n: r.n + 1, at: Date.now() + Math.min(1000 * 2 ** r.n, 15000) });
        close(c, true); // 通知对方也拆掉，由发起方退避后重连
      } else if (pc.connectionState === 'connected') retryAt.delete(id);
    };
    conns.set(id, c);
    loop();
    return c;
  }
  function close(c, bye) {
    if (conns.get(c.id) === c) conns.delete(c.id);
    if (bye) signal(c.id, { sid: c.sid, bye: true });
    try { c.pc.close(); } catch (e) { /* ignore */ }
    c.audio.srcObject = null;
    c.audio.remove();
    talking.delete(c.id);
    heardAt.delete(c.id);
  }
  function closeAll() {
    for (const c of [...conns.values()]) close(c, false);
    retryAt.clear();
    talking.clear();
    heardAt.clear();
  }
  function flush(c) {
    c.offered = true;
    for (const cand of c.out.splice(0)) signal(c.id, { sid: c.sid, ice: cand });
  }
  async function drain(c) {
    for (const cand of c.queue.splice(0)) { try { await c.pc.addIceCandidate(cand); } catch (e) { /* 过期候选 */ } }
  }
  async function offer(id) {
    const c = createConn(id, sid());
    try {
      c.sender = c.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (stream) await c.sender.replaceTrack(stream.getAudioTracks()[0]);
      await c.pc.setLocalDescription(await c.pc.createOffer());
      if (conns.get(id) !== c) return;
      const d = c.pc.localDescription;
      signal(id, { sid: c.sid, sdp: { type: d.type, sdp: d.sdp } });
      flush(c);
    } catch (e) { close(c, false); }
  }
  async function onSignal(msg) {
    if (!supported || !msg || typeof msg.from !== 'string' || !msg.data) return;
    const from = msg.from, d = msg.data;
    let c = conns.get(from);
    try {
      if (d.bye) { if (c && c.sid === d.sid) close(c, false); return; }
      if (d.sdp && d.sdp.type === 'offer') {
        if (c && c.sid !== d.sid) { close(c, false); c = null; } // 对方重建了连接
        c ||= createConn(from, d.sid);
        await c.pc.setRemoteDescription(d.sdp);
        const tr = c.pc.getTransceivers()[0];
        if (!tr) throw new Error('对方没有音频');
        tr.direction = 'sendrecv';
        c.sender = tr.sender;
        if (stream) await c.sender.replaceTrack(stream.getAudioTracks()[0]);
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        if (conns.get(from) !== c) return;
        const a = c.pc.localDescription;
        signal(from, { sid: c.sid, sdp: { type: a.type, sdp: a.sdp } });
        flush(c);
        await drain(c);
      } else if (d.sdp && d.sdp.type === 'answer') {
        if (!c || c.sid !== d.sid || c.pc.signalingState !== 'have-local-offer') return;
        await c.pc.setRemoteDescription(d.sdp);
        await drain(c);
      } else if (d.ice) {
        if (!c || c.sid !== d.sid) return;
        if (c.pc.remoteDescription) await c.pc.addIceCandidate(d.ice); else c.queue.push(d.ice);
      }
    } catch (e) {
      if (c) close(c, true);
    }
  }

  // 按名单决定该连谁：自己和对方都闭麦就不连；同一身份的其他标签页不连（同一台设备会回声）
  function wanted(p) { return p.id !== you && p.pid !== myPid && (p.mic || micOnline() || (!!stream && micPending)); }
  function sync() {
    if (!supported || !you) return;
    const t = Date.now();
    for (const c of [...conns.values()]) {
      const p = peers.get(c.id);
      if (!p) { close(c, false); continue; }
      if (wanted(p)) c.idleSince = 0;
      else if (!c.idleSince) c.idleSince = t;
      else if (t - c.idleSince > IDLE_CLOSE) close(c, true);
    }
    for (const p of peers.values()) {
      // 两人之间由连接 id 小的一方发起，避免双方同时发 offer
      if (conns.has(p.id) || !wanted(p) || you > p.id) continue;
      const r = retryAt.get(p.id);
      if (r && t < r.at) continue;
      offer(p.id);
    }
  }

  /* ---------- 名单与开麦 ---------- */
  function onRoster(msg) {
    if (!supported || !msg || !Array.isArray(msg.peers)) return;
    if (msg.you !== you) { closeAll(); you = msg.you; }
    inRoom = true;
    ice = Array.isArray(msg.ice) ? msg.ice : [];
    peers = new Map(msg.peers.map((p) => [p.id, p]));
    const mine = peers.get(you);
    myPid = mine ? mine.pid : null;
    mySeat = mine ? mine.seat : -1;
    if (mine && stream) {
      if (mine.mic) micPending = false;
      else if (!micPending) {
        // 重连换了连接：补发一次开麦；本连接已经开过却被关掉，说明在别的标签页开了麦
        if (micSentFor !== you) requestMic();
        else { stopMic(); hooks.toast('你在另一个页面开了麦，这里先关掉了'); }
      }
    }
    // 闭麦的人立刻去掉说话标记，不等保持时间
    for (const id of [...talking]) if (!audible(id)) { talking.delete(id); heardAt.delete(id); }
    sync();
    render();
  }
  function requestMic() {
    micSentFor = you;
    micPending = true;
    if (!hooks.send({ type: 'voice', mic: true })) micPending = false;
  }
  async function startMic() {
    if (stream || opening) return;
    if (!supported) return hooks.toast('这个浏览器不支持语音，换 Chrome / Safari / Edge 试试', true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return hooks.toast(window.isSecureContext ? '这个浏览器不能用麦克风' : '需要用 https 打开页面才能开麦', true);
    }
    opening = true;
    wantMic = true;
    render();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = e && e.name;
      hooks.toast(name === 'NotAllowedError' ? '没有麦克风权限：请在浏览器地址栏左侧允许使用麦克风' : name === 'NotFoundError' ? '没找到麦克风' : '麦克风打不开，可能被别的应用占用了', true);
    }
    opening = false;
    if (!stream) return render();
    if (!wantMic || !inRoom) { stopMic(false); return; } // 等权限的时候又点了闭麦，或已经离开房间
    const track = stream.getAudioTracks()[0];
    track.onended = () => stopMic(true); // 拔掉耳机麦、系统收回权限
    for (const c of conns.values()) if (c.sender) c.sender.replaceTrack(track).catch(() => {});
    watchLocal();
    requestMic();
    sync();
    render();
  }
  function stopMic(tell = true) {
    wantMic = false;
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    micPending = false;
    analyser = null;
    heardAt.delete(you);
    for (const c of conns.values()) if (c.sender) c.sender.replaceTrack(null).catch(() => {});
    if (tell && you) hooks.send({ type: 'voice', mic: false });
    talking.delete(you);
    render();
  }
  function watchLocal() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      actx ||= new AC();
      if (actx.state !== 'running') actx.resume().catch(() => {});
      analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      levelBuf = new Float32Array(analyser.fftSize);
      actx.createMediaStreamSource(stream).connect(analyser);
    } catch (e) { analyser = null; }
  }
  function toggleMic() { if (stream || opening) stopMic(); else startMic(); }
  function toggleDeaf() {
    deaf = !deaf;
    try { localStorage.setItem('hn_voice_deaf', deaf ? '1' : '0'); } catch (e) { /* ignore */ }
    for (const c of conns.values()) c.audio.muted = deaf;
    if (!deaf) unblock();
    hooks.toast(deaf ? '已关闭语音收听' : '已打开语音收听');
    render();
  }

  /* ---------- 说话检测与界面 ---------- */
  function loop() {
    if (timer) return;
    timer = setInterval(tick, 200);
  }
  // 用 getStats 的 totalAudioEnergy 增量算两次采样之间的平均音量，不会漏掉夹在采样间隔里的短句；
  // 自己的音量取发送端 media-source，一个连接都没有时退回本地分析器
  function energyLevel(prev, r) {
    if (!r || typeof r.totalAudioEnergy !== 'number' || typeof r.totalSamplesDuration !== 'number') return 0;
    const dE = r.totalAudioEnergy - (prev.e ?? r.totalAudioEnergy), dD = r.totalSamplesDuration - (prev.d ?? r.totalSamplesDuration);
    prev.e = r.totalAudioEnergy; prev.d = r.totalSamplesDuration;
    return dD > 0 ? Math.sqrt(Math.max(0, dE) / dD) : 0;
  }
  // 这个人现在还能被听到：自己要开着麦，别人要开着麦且连接还在
  function audible(id) { return id === you ? micOnline() : conns.has(id) && !!peers.get(id) && peers.get(id).mic && !deaf; }
  async function tick() {
    if (!conns.size && !stream) { clearInterval(timer); timer = null; talking.clear(); heardAt.clear(); paint(); return; }
    if (ticking) return;
    ticking = true;
    const t = Date.now();
    let local = 0, localSeen = false;
    for (const c of [...conns.values()]) {
      let stats;
      try { stats = await c.pc.getStats(); } catch (e) { continue; }
      c.lv ||= { in: {}, src: {} };
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          const p = peers.get(c.id);
          if (energyLevel(c.lv.in, r) > TALK_LEVEL && p && p.mic && !deaf) heardAt.set(c.id, t);
        } else if (r.type === 'media-source' && r.kind === 'audio' && micOnline()) {
          localSeen = true;
          local = Math.max(local, energyLevel(c.lv.src, r));
        }
      });
    }
    if (!localSeen && analyser && micOnline()) {
      analyser.getFloatTimeDomainData(levelBuf);
      let sum = 0;
      for (const v of levelBuf) sum += v * v;
      local = Math.sqrt(sum / levelBuf.length);
    }
    if (micOnline() && local > TALK_LEVEL) heardAt.set(you, t);
    ticking = false;
    const was = [...talking].join();
    talking.clear();
    let remote = false;
    for (const [id, at] of heardAt) {
      if (t - at > TALK_HOLD || !audible(id)) { heardAt.delete(id); continue; }
      talking.add(id);
      if (id !== you) remote = true;
    }
    // 有人说话时把背景音乐压低
    if (remote && window.Music && Music.duck) Music.duck();
    if (t - lastSync > 1000) { lastSync = t; sync(); }
    if ([...talking].join() !== was) paint();
  }
  // 座位上的状态：mic-on 开着麦，talking 正在说话（app.js 重绘玩家栏/座位后会调 paint 补上）
  function seatClass(seat) {
    let cls = '';
    for (const p of peers.values()) {
      if (p.seat !== seat) continue;
      const mine = p.id === you;
      if (mine ? micOnline() : p.mic) cls = cls || ' mic-on';
      if (talking.has(p.id)) return ' mic-on talking';
    }
    return cls;
  }
  function paint() {
    for (const el of document.querySelectorAll('.prow[data-seat], #seats .seat[data-seat]')) {
      const cls = seatClass(Number(el.dataset.seat));
      el.classList.toggle('mic-on', cls.includes('mic-on'));
      el.classList.toggle('talking', cls.includes('talking'));
    }
    // 观众没有座位：说话的人名字浮在屏幕上方
    const names = [...talking].map((id) => peers.get(id)).filter((p) => p && p.seat < 0).map((p) => (p.id === you ? '你' : p.name));
    if (!talkChip) {
      talkChip = document.createElement('div');
      talkChip.className = 'voice-talk';
      talkChip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(talkChip);
    }
    talkChip.hidden = !names.length;
    if (names.length) talkChip.innerHTML = `${icon('mic')}<span>${names.map(esc).join('、')}</span>`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const icon = (n) => (window.Art && Art.icon ? Art.icon(n) : '');
  function render() {
    const on = !!stream, busy = opening || (on && micPending);
    for (const b of document.querySelectorAll('[data-voice-mic]')) {
      b.hidden = !supported || !you;
      b.classList.toggle('on', on);
      b.classList.toggle('busy', busy);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const label = opening ? '正在打开麦克风' : on ? '闭麦' : '开麦';
      b.title = on ? '麦克风已打开，点击闭麦' : '点击开麦，和房间里的人语音';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `<span class="ico">${icon(on ? 'mic' : 'micOff')}</span><span class="lbl">${label}</span>`;
    }
    for (const b of document.querySelectorAll('[data-voice-ear]')) {
      b.hidden = !supported || !you;
      b.classList.toggle('off', deaf);
      b.title = deaf ? '语音收听已关闭，点击打开' : '语音收听已打开，点击关闭';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `<span class="ico">${icon(deaf ? 'earOff' : 'ear')}</span><span class="lbl">${deaf ? '语音已静音' : '收听语音'}</span>`;
    }
    paint();
  }

  // 断线：连接全部作废，麦克风保留，重连拿到新名单后自动补发开麦
  function offline() { closeAll(); you = null; peers = new Map(); render(); }
  // 离开房间：连麦克风一起关掉
  function leave() { stopMic(false); micSentFor = null; inRoom = false; offline(); }
  function denied() { if (micPending) stopMic(false); }

  function init(h) {
    hooks = { ...hooks, ...h };
    for (const b of document.querySelectorAll('[data-voice-mic]')) b.addEventListener('click', toggleMic);
    for (const b of document.querySelectorAll('[data-voice-ear]')) b.addEventListener('click', toggleDeaf);
    render();
  }
  window.Voice = {
    init, roster: onRoster, signal: onSignal, offline, leave, denied, paint,
    state: () => ({ you, mic: !!stream, micOnline: micOnline(), deaf, peers: [...peers.values()], conns: [...conns.values()].map((c) => ({ id: c.id, state: c.pc.connectionState })), talking: [...talking] }),
  };
})();
