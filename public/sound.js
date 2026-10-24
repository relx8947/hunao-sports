// WebAudio 合成音效：无需音频文件。背景音乐在 music.js，和音效共用同一个 AudioContext。
(function () {
  let ctx = null;
  let master = null;
  // 声音模式：all 音乐+音效 → sfx 仅音效 → off 全部静音；兼容旧版只存了 hn_mute 的设置
  const MODES = ['all', 'sfx', 'off'];
  const UI = {
    all: { icon: 'music', label: '声音：音乐和音效（点击切换为仅音效）' },
    sfx: { icon: 'sound', label: '声音：仅音效（点击切换为全部静音）' },
    off: { icon: 'mute', label: '声音：已静音（点击开启音乐和音效）' },
  };
  let mode = 'all';
  const sources = new Set();
  try {
    const saved = localStorage.getItem('hn_sound');
    if (MODES.includes(saved)) mode = saved;
    else if (localStorage.getItem('hn_mute') === '1') mode = 'off';
  } catch (e) { /* ignore */ }
  const music = () => window.Music;

  function ensure() {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      if (music()) { music().setEnabled(mode === 'all'); music().attach(ctx); }
    }
    // 后台不恢复：切走的页面保持安静，回到前台或下次触摸时再恢复（iOS 可能处于 interrupted）
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().then(() => music() && music().wake(), () => {});
    return ctx;
  }
  function duck() { if (mode === 'all' && music()) music().duck(); }

  function track(source, nodes) {
    sources.add(source);
    source.onended = () => { sources.delete(source); for (const node of nodes) node.disconnect(); };
  }
  function stop() {
    for (const source of sources) { try { source.stop(); } catch (e) { /* already ended */ } }
    sources.clear();
  }

  function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0, attack = 0.005 } = {}) {
    if (mode === 'off' || !ensure()) return;
    duck();
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    track(o, [o, g]);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, { vol = 0.2, at = 0, freq = 2000, q = 1, type = 'bandpass' } = {}) {
    if (mode === 'off' || !ensure()) return;
    duck();
    const t = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    track(src, [src, f, g]);
    src.start(t);
  }

  function setMode(m) {
    if (!MODES.includes(m)) return;
    mode = m;
    if (mode === 'off') stop();
    try {
      localStorage.setItem('hn_sound', mode);
      localStorage.setItem('hn_mute', mode === 'off' ? '1' : '0');
    } catch (e) { /* ignore */ }
    if (music()) music().setEnabled(mode === 'all');
  }

  const S = {
    unlock() { ensure(); },
    stop,
    get muted() { return mode === 'off'; },
    setMuted(m) { setMode(m ? 'off' : 'all'); },
    get mode() { return mode; },
    setMode,
    cycleMode() { setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]); return mode; },
    // 声音按钮的图标名与提示文字
    get ui() { return UI[mode]; },
    click() { tone(660, 0.06, { type: 'triangle', vol: 0.15 }); },
    hover() { tone(880, 0.03, { type: 'sine', vol: 0.04 }); },
    dice() {
      for (let i = 0; i < 7; i++) noise(0.05, { at: i * 0.07 + Math.random() * 0.02, vol: 0.28, freq: 1800 + Math.random() * 1600, q: 3 });
      tone(180, 0.08, { type: 'square', vol: 0.05, at: 0.52 });
    },
    diceLand(v) {
      tone(300 + v * 60, 0.12, { type: 'triangle', vol: 0.22 });
      tone(600 + v * 120, 0.14, { type: 'sine', vol: 0.12, at: 0.05 });
    },
    hop(i = 0) { tone(420 + (i % 8) * 38, 0.08, { type: 'triangle', vol: 0.13, slide: 180 }); },
    back() { tone(520, 0.14, { type: 'triangle', vol: 0.14, slide: -260 }); },
    warp() {
      tone(300, 0.3, { type: 'sine', vol: 0.16, slide: 900 });
      tone(900, 0.25, { type: 'sine', vol: 0.08, at: 0.12, slide: -500 });
    },
    trip() {
      tone(500, 0.18, { type: 'sawtooth', vol: 0.08, slide: -380 });
      noise(0.12, { at: 0.16, vol: 0.25, freq: 300, q: 0.8, type: 'lowpass' });
    },
    power() {
      tone(1046, 0.1, { type: 'sine', vol: 0.09 });
      tone(1318, 0.12, { type: 'sine', vol: 0.08, at: 0.05 });
      tone(1568, 0.16, { type: 'sine', vol: 0.07, at: 0.1 });
    },
    chip() {
      tone(1568, 0.12, { type: 'triangle', vol: 0.14 });
      tone(2093, 0.2, { type: 'sine', vol: 0.1, at: 0.06 });
    },
    lose() { tone(392, 0.2, { type: 'triangle', vol: 0.14, slide: -120 }); tone(262, 0.3, { type: 'triangle', vol: 0.12, at: 0.15 }); },
    chomp() {
      noise(0.1, { vol: 0.35, freq: 220, q: 1.2, type: 'lowpass' });
      tone(140, 0.2, { type: 'square', vol: 0.1, at: 0.04, slide: -60 });
      noise(0.08, { vol: 0.3, freq: 260, q: 1.2, type: 'lowpass', at: 0.2 });
    },
    duel() {
      noise(0.08, { vol: 0.3, freq: 5000, q: 6 });
      noise(0.08, { vol: 0.3, freq: 6000, q: 6, at: 0.14 });
      tone(1760, 0.2, { type: 'triangle', vol: 0.06, at: 0.02 });
    },
    finish(place = 1) {
      const base = place === 1 ? [523, 659, 784, 1046] : [440, 554, 659];
      base.forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.16, at: i * 0.09 }));
      tone(base[base.length - 1] * 2, 0.5, { type: 'sine', vol: 0.08, at: base.length * 0.09 });
    },
    turn() { tone(740, 0.07, { type: 'sine', vol: 0.08 }); tone(988, 0.1, { type: 'sine', vol: 0.07, at: 0.06 }); },
    yourTurn() { [659, 880, 1175].forEach((f, i) => tone(f, 0.14, { type: 'triangle', vol: 0.13, at: i * 0.08 })); },
    card() { noise(0.09, { vol: 0.18, freq: 3500, q: 0.7, type: 'highpass' }); tone(520, 0.06, { type: 'sine', vol: 0.05, at: 0.03 }); },
    reveal() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: 'square', vol: 0.05, at: i * 0.07 })); },
    blocked() { tone(220, 0.12, { type: 'square', vol: 0.07 }); tone(196, 0.16, { type: 'square', vol: 0.07, at: 0.12 }); },
    fanfare() {
      if (mode === 'off' || !ensure()) return;
      // 开着音乐时由 music.js 放整段号角（单场 / 总冠军），不再叠一层音效
      if (mode === 'all' && music() && music().stinger()) return;
      const seq = [523, 523, 659, 784, 659, 784, 1046];
      seq.forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.15, at: i * 0.13 }));
      seq.forEach((f, i) => tone(f / 2, 0.2, { type: 'sine', vol: 0.08, at: i * 0.13 }));
    },
    pop() { tone(900, 0.05, { type: 'sine', vol: 0.1, slide: 500 }); },
  };
  window.Sound = S;
  if (music()) music().setEnabled(mode === 'all');
  // iOS Safari / 微信内置浏览器要在用户手势里启动或恢复 AudioContext；运行起来之后这些监听几乎没有开销
  const wake = () => { if (!ctx || ctx.state !== 'running') ensure(); };
  for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) window.addEventListener(type, wake, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) setTimeout(() => { if (document.hidden && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 200);
    else ensure();
  });
})();
