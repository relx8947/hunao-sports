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

  /* ---------- 动效音效用的轻量发声单元 ----------
   * 每次触发只建 2～3 个节点（振荡器/噪声源 + [滤波] + 增益），发声结束即断开。
   * 只在 AudioContext 真正在跑时排程：未解锁、后台挂起、全部静音都直接跳过，
   * 避免挂起期间排进去的音在恢复时一次性补放成一团。离线渲染（测试/自检）不受此限。 */
  const MAX_LIVE = 32; // 动效音效同时在响的声源上限，连发再多也不会叠爆
  let live = 0;
  let bellWave = null, bellCtx = null, noiseBuf = null;
  function ready() {
    if (mode === 'off') return null;
    try {
      const c = ensure();
      if (!c) return null;
      const offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
      if (!offline && c.state !== 'running') return null;
      return live < MAX_LIVE ? c : null;
    } catch (e) { return null; }
  }
  function hold(src, nodes) {
    live++;
    sources.add(src);
    src.onended = () => { live--; sources.delete(src); for (const node of nodes) node.disconnect(); };
  }
  function env(g, t, vol, dur, attack) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  // 'bell'：一个振荡器带 2 倍、4 倍泛音，音色接近背景音乐里的钢片琴，省掉多振荡器叠加
  function voice(t, freq, dur, { type = 'sine', vol = 0.1, to = 0, glide = dur, attack = 0.004 } = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (type === 'bell') {
      if (bellCtx !== ctx) { bellWave = ctx.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.28, 0, 0.06])); bellCtx = ctx; }
      o.setPeriodicWave(bellWave);
    } else o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + glide);
    env(g, t, vol, dur, attack);
    o.connect(g); g.connect(master);
    hold(o, [o, g]);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // 噪声共用一段 1 秒的缓冲，每次从随机位置截一小段，滤波器频率可扫（咻、嗖）
  function hiss(t, dur, { vol = 0.1, freq = 2000, to = 0, q = 1, type = 'bandpass', attack = 0.004 } = {}) {
    if (!noiseBuf || noiseBuf.sampleRate !== ctx.sampleRate) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    env(g, t, vol, dur, attack);
    s.connect(f); f.connect(g); g.connect(master);
    hold(s, [s, f, g]);
    s.start(t, Math.random() * 0.5, dur + 0.02);
  }
  // 包一层：静音/未解锁时跳过；任何合成异常都吞掉，不影响游戏。
  // gap 为节流间隔：两次发声至少相隔 gap 秒。只早到一点点（时钟抖动、动画步长正好等于 gap）的不丢，
  // 顺延到窗口边上再响；早得多的直接丢掉。
  function sfx(fn, gap = 0) {
    let last = -Infinity;
    return function (...args) {
      const c = ready();
      if (!c) return;
      let t = c.currentTime;
      if (gap) {
        if (t < last + gap - 0.015) return;
        t = Math.max(t, last + gap);
      }
      last = t;
      try { duck(); fn(t, ...args); } catch (e) { /* ignore */ }
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || lo));
  // 骰点「叮」：G 大调五声音阶上的 6 个音，点数越大越亮
  const DING = [784, 880, 988, 1175, 1319, 1568];
  // 路径预亮的滴答：G5 起的五声音阶逐格上行，到顶后保持
  const TICK = [784, 880, 988, 1175, 1319, 1568, 1760, 1976];
  // 领奖台：第 3、2、1 名依次是 C5、E5、G5（按 3→2→1 升起正好是 C 大三和弦上行），第 1 名再补一个高八度 C6
  const PILLAR = [784, 659, 523, 392];

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

    /* ---------- 动效音效 ---------- */
    // 技能提示卡弹出：一声小气泡「啵」接钢片琴上行五度「叮—咚」
    callout: sfx((t) => {
      voice(t, 520, 0.05, { vol: 0.065, to: 900 });
      voice(t + 0.03, 784, 0.12, { type: 'bell', vol: 0.09 });
      voice(t + 0.09, 1175, 0.2, { type: 'bell', vol: 0.09 });
    }),
    // 棋子被技能击中：下滑的软「咚」加一小团低通噪声，像打在枕头上；同一时刻多枚棋子被击中只响一次
    hit: sfx((t) => {
      const r = 0.92 + Math.random() * 0.16;
      voice(t, 300 * r, 0.11, { type: 'triangle', vol: 0.057, to: 120 * r });
      hiss(t, 0.05, { vol: 0.097, freq: 900, q: 0.7, type: 'lowpass' });
    }, 0.04),
    // 骰点飞落到棋子上：钢琴棒敲钟琴似的「叮」，基音加一个快速衰减的 2.76 倍泛音，点数越大音越高
    diceLand: sfx((t, n = 1) => {
      const f = DING[clamp(n, 1, 6) - 1];
      voice(t, f, 0.32, { vol: 0.08 });
      voice(t, f * 2.76, 0.08, { vol: 0.03, attack: 0.002 });
    }),
    // 选秀卡飞出：带通噪声由低扫到高的「咻」
    swish: sfx((t) => {
      hiss(t, 0.2, { vol: 0.48, freq: 800, to: 3800, q: 1.4, attack: 0.07 });
    }),
    // 选秀卡落进队伍：纸片「啪」+ 木鱼「嗒」+ 一点钢片琴余音
    cardLand: sfx((t) => {
      hiss(t, 0.05, { vol: 0.3, freq: 1600, q: 0.9 });
      voice(t, 1050, 0.06, { vol: 0.11, attack: 0.002 });
      voice(t + 0.04, 1319, 0.14, { type: 'bell', vol: 0.075 });
    }),
    // 路径逐格预亮：极短的正弦「嗒」，沿五声音阶逐格升高；60ms 内只响一次
    tick: sfx((t, i = 0) => {
      voice(t, TICK[clamp(i, 0, TICK.length - 1)], 0.035, { vol: 0.048, attack: 0.002 });
    }, 0.06),
    // 快进/同步提示：钢片琴「叮—铃」上行四度，再带一声轻回声
    syncChime: sfx((t) => {
      voice(t, 880, 0.16, { type: 'bell', vol: 0.078 });
      voice(t + 0.08, 1319, 0.3, { type: 'bell', vol: 0.078 });
      voice(t + 0.24, 1319, 0.25, { type: 'bell', vol: 0.033 });
    }),
    // 名次上升：三角波向上滑到五度再落一个高八度的钢片琴音
    rankUp: sfx((t) => {
      voice(t, 523, 0.1, { type: 'triangle', vol: 0.105, to: 784 });
      voice(t + 0.08, 1046, 0.2, { type: 'bell', vol: 0.09 });
    }),
    // 名次下降：两声往下滑的「哇—哇」，滑稽不沮丧
    rankDown: sfx((t) => {
      voice(t, 523, 0.14, { type: 'triangle', vol: 0.13, to: 392 });
      voice(t + 0.12, 392, 0.2, { type: 'triangle', vol: 0.11, to: 330 });
    }),
    // 领奖台柱子升起：低八度往上滑的「呜—」托起一个钢片琴音；i 为名次，3→2→1 依次升起是 C-E-G 上行
    pillar: sfx((t, i = 3) => {
      const k = clamp(i, 1, PILLAR.length), f = PILLAR[k - 1];
      voice(t, f / 2, 0.22, { type: 'triangle', vol: 0.068, to: f, glide: 0.16, attack: 0.03 });
      voice(t + 0.15, f, 0.35, { type: 'bell', vol: 0.08 });
      if (k === 1) voice(t + 0.22, 1046, 0.4, { type: 'bell', vol: 0.057 });
    }),
    // 点快进：噪声带通从 600Hz 扫到 5kHz，配一条三角波上滑两个八度的「嗖↑」
    boost: sfx((t) => {
      hiss(t, 0.32, { vol: 0.26, freq: 600, to: 5000, q: 1.2, attack: 0.12 });
      voice(t, 330, 0.3, { type: 'triangle', vol: 0.093, to: 1320, glide: 0.26, attack: 0.05 });
    }),
    // 操作无效：两声柔和的三角波「嗯嗯↓」，小三度下行，不用方波，不吓人
    deny: sfx((t) => {
      voice(t, 392, 0.09, { type: 'triangle', vol: 0.115, to: 370 });
      voice(t + 0.11, 330, 0.16, { type: 'triangle', vol: 0.115, to: 294 });
    }),
    // 二代·变数招牌被触发：一串上行的钢片琴闪光，配一缕由低到高的「唰」
    twist: sfx((t) => {
      hiss(t, 0.28, { vol: 0.12, freq: 1200, to: 6000, q: 1.6, attack: 0.08 });
      [784, 988, 1175, 1568].forEach((f, i) => voice(t + 0.05 + i * 0.065, f, 0.22, { type: 'bell', vol: 0.07 }));
    }),
    // 二代·掉进漩涡：三角波先下旋再上旋的「呜—咻」，带一点带通水声
    whirl: sfx((t) => {
      voice(t, 660, 0.18, { type: 'triangle', vol: 0.09, to: 330, glide: 0.18 });
      voice(t + 0.16, 330, 0.26, { type: 'triangle', vol: 0.09, to: 990, glide: 0.24 });
      hiss(t, 0.4, { vol: 0.07, freq: 500, to: 2400, q: 2.2, attack: 0.06 });
    }, 0.12),
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
