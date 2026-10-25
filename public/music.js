// 胡闹运动会 · 背景音乐：Web Audio 实时合成的原创曲目，无音频文件
// 三个循环场景（首页/房间、选秀/暗选、比赛）与两段号角（单场冲线、总冠军）。
// 调度按 AudioContext 时钟提前排程：定时器每 60ms 醒一次，只负责把未来 0.3s 内的音符排进去。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Music = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 乐理工具 ---------- */
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(name);
    if (!m) throw new Error(`音名无效：${name}`);
    return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 一小节 16 个十六分音符："A4:2 C5:2 r:4" → [{ at, len, m }]
  function parseBar(str) {
    let at = 0;
    const notes = [];
    for (const tok of str.trim().split(/\s+/)) {
      const [n, d] = tok.split(':');
      const len = Number(d);
      if (!(len > 0)) throw new Error(`时值无效：${tok}`);
      if (n !== 'r') notes.push({ at, len, m: midi(n) });
      at += len;
    }
    return { notes, total: at };
  }
  const QUAL = { '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10] };
  function chord(name) {
    const m = /^([A-G])(#|b)?(m7|m|7)?$/.exec(name);
    if (!m) throw new Error(`和弦无效：${name}`);
    const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
    return { name, root, tones: QUAL[m[3] || ''].map((i) => (root + i) % 12) };
  }
  // 把音级放进 [lo, lo+12) 这个八度
  const near = (pc, lo) => lo + (((pc - lo) % 12) + 12) % 12;

  /* ---------- 曲目（全部原创） ---------- */
  // 首页/房间：F 大调，100 BPM，轻摇摆。木琴主旋律 + 拨弦低音 + 柔和后拍和弦，像开赛前在看台闲逛。
  const HOME = {
    bpm: 100, swing: 0.34, gain: 1.25,
    chords: [
      'F', 'F', 'Bb', 'F', 'Gm7', 'C7', 'F', 'C7',
      'F', 'F', 'Bb', 'Bbm', 'F', 'D7', 'Gm7 C7', 'F',
      'Bb', 'Bb', 'F', 'F', 'G7', 'G7', 'C', 'C7',
      'F', 'A7', 'Dm', 'F7', 'Bb', 'C7', 'F', 'C7',
    ],
    melody: [
      'A4:2 C5:2 F5:4 E5:2 F5:2 G5:4', 'A5:4 G5:2 F5:2 C5:6 r:2',
      'D5:2 F5:2 Bb5:4 A5:2 G5:2 F5:4', 'A5:6 r:2 C5:2 A4:2 C5:4',
      'Bb4:2 D5:2 F5:2 D5:2 G5:4 F5:2 D5:2', 'E5:2 G5:2 Bb5:4 A5:2 G5:2 E5:4',
      'F5:4 A5:2 C6:6 r:4', 'Bb5:2 A5:2 G5:2 E5:2 C5:4 r:4',
      'A4:2 C5:2 F5:4 E5:2 F5:2 A5:4', 'C6:4 A5:2 F5:2 C5:6 r:2',
      'D5:2 F5:2 Bb5:4 C6:2 Bb5:2 A5:4', 'Db6:4 C6:2 Bb5:2 F5:6 r:2',
      'A5:2 G5:2 F5:2 C5:2 A4:4 C5:4', 'F#5:2 A5:2 C6:4 A5:2 F#5:2 D5:4',
      'Bb5:4 G5:4 E5:4 G5:4', 'F5:6 r:2 C5:2 D5:2 E5:4',
      'F5:1 r:1 F5:2 D5:2 F5:2 Bb5:4 r:4', 'A5:2 Bb5:2 C6:2 Bb5:2 A5:2 F5:2 D5:4',
      'C5:1 r:1 C5:2 A4:2 C5:2 F5:4 r:4', 'E5:2 F5:2 G5:2 F5:2 E5:2 C5:2 A4:4',
      'B4:2 D5:2 F5:2 G5:2 B5:4 A5:2 G5:2', 'F5:2 G5:2 A5:2 B5:2 D6:4 B5:4',
      'C6:4 G5:2 E5:2 C5:4 E5:2 G5:2', 'Bb5:4 A5:2 G5:2 F5:2 E5:2 D5:2 C5:2',
      'A4:2 C5:2 F5:4 E5:2 F5:2 G5:4', 'A5:4 G5:2 E5:2 C#5:6 r:2',
      'D5:2 F5:2 A5:4 G5:2 F5:2 D5:4', 'C6:2 A5:2 F5:2 A5:2 Eb6:4 r:4',
      'D6:4 C6:2 Bb5:2 F5:4 D5:4', 'E5:2 G5:2 Bb5:2 C6:2 E6:4 r:2 C6:2',
      'A5:2 F5:2 C5:2 A4:2 F4:4 r:4', 'r:8 C5:2 Bb4:2 G4:2 E4:2',
    ],
    groove(v, b, s, c) {
      const walk = b >= 16 && b < 24;
      if (s === 0 || (c.split && s === 8)) v.pad(c.chord, c.split ? 8 : 16);
      if (s === 0) v.pluck(near(c.chord.root, 41), 0.5);
      else if (s === 8) v.pluck(c.split ? near(c.chord.root, 41) : near(c.chord.root, 41) + 7, 0.42);
      else if (walk && s === 4) v.pluck(near(c.chord.tones[1], 41), 0.36);
      else if (walk && s === 12) v.pluck(near((c.chord.root + 9) % 12, 41), 0.36);
      if (s === 4 || s === 12) v.stab(c.chord, 57, 0.2, 0.12);
      if (s % 2 === 0) v.shaker(s % 4 === 2 ? 0.2 : 0.11);
      if (s === 14 && b % 2 === 1) v.wood(0.22, b % 4 === 3);
      if (walk && (s === 0 || s === 8)) v.kick(0.32);
      for (const n of c.notes) {
        v.mallet(n.m, n.len, 0.5);
        if ((b >= 8 && b < 16 && n.len >= 4) || b >= 24) v.glock(n.m + 12, 0.07);
      }
    },
  };

  // 选秀/暗选：D 小调，116 BPM，踮脚走路式的拨弦与弹舌，单簧管带一点坏笑，后半段钢片琴加进来。
  const DRAFT = {
    bpm: 116, swing: 0, gain: 1.05,
    chords: [
      'Dm', 'Dm', 'Gm', 'Dm', 'Bb', 'A7', 'Dm', 'A7',
      'Dm', 'Dm', 'Gm', 'Gm', 'Eb', 'A7', 'Dm', 'A7',
    ],
    melody: [
      'D5:2 r:2 E5:1 F5:1 r:2 A5:4 r:4', 'G#5:1 A5:3 F5:2 D5:2 E5:2 F5:2 r:4',
      'D5:2 r:2 Eb5:1 D5:1 r:2 Bb5:4 A5:2 G5:2', 'F5:2 E5:2 D5:2 r:2 A4:6 r:2',
      'F5:2 r:2 G5:1 F5:1 r:2 D5:4 Bb4:4', 'C#5:2 E5:2 G5:2 A5:2 Bb5:4 A5:4',
      'F5:2 D5:2 A4:2 F4:2 D4:4 r:4', 'r:4 E5:2 r:2 C#5:2 r:2 A4:4',
      'D5:2 r:2 E5:1 F5:1 r:2 A5:4 r:4', 'G#5:1 A5:3 C6:2 A5:2 F5:2 E5:2 r:4',
      'Bb5:2 r:2 A5:1 G5:1 r:2 D5:4 G5:4', 'Bb5:2 A5:2 G5:2 F5:2 D5:4 r:4',
      'Eb5:2 G5:2 Bb5:4 G5:2 Eb5:2 Bb4:4', 'C#5:2 r:2 E5:2 r:2 G5:2 F5:2 E5:4',
      'D5:2 F5:2 A5:2 D6:2 C#6:2 D6:2 r:4', 'r:2 A4:1 Bb4:1 B4:1 C5:1 C#5:2 E5:2 G5:2 r:4',
    ],
    repeat: 2, // 16 小节旋律走两遍，第二遍换配器，32 小节才完整循环
    groove(v, b, s, c) {
      const second = b >= 16;
      const lo = 38;
      if (s === 0) v.pluck(near(c.chord.root, lo), 0.5, 1.2);
      if (s === 4 || s === 12) v.pluck(near(c.chord.root, lo) + 7 - (near(c.chord.root, lo) + 7 > 52 ? 12 : 0), 0.38, 1.2);
      if (s === 8) v.pluck(near(c.chord.root, lo) + (second ? 12 : 0), 0.42, 1.2);
      if (s === 14 && c.next && c.next.root !== c.chord.root) v.pluck(near(c.next.root, lo) - 1, 0.3, 1);
      if (s === 6 || s === 14) v.stab(c.chord, 55, 0.13, 0.07);
      if (s === 4 || s === 12) v.snap(0.36);
      if (second && s % 4 === 2) v.hat(0.1);
      if (second && s === 0) v.pad(c.chord, 16, 0.05);
      if (s === 0 && b % 4 === 0) v.timp(near(c.chord.root, 38), 0.32);
      for (const n of c.notes) {
        v.reed(n.m, n.len, second ? 0.3 : 0.38);
        if (second) v.celesta(n.m + 12, 0.16);
      }
    },
  };

  // 比赛：降 B 大调，152 BPM 马戏团加洛普。大号「嘭」、和弦「恰」、铜管领奏；有人逼近终点时逐级加鼓和钟琴。
  const RACE = {
    bpm: 152, swing: 0, gain: 0.82,
    chords: [
      'Bb', 'Bb', 'F7', 'F7', 'F7', 'F7', 'Bb', 'Bb',
      'Bb', 'Bb', 'Eb', 'Eb', 'Bb', 'F7', 'Bb', 'Bb',
      'Gm', 'Gm', 'Cm', 'F7', 'Bb', 'G7', 'Cm', 'F7',
      'Eb', 'Eb', 'Bb', 'Bb', 'C7', 'C7', 'F7', 'F7',
    ],
    melody: [
      'F5:2 D5:2 F5:2 D5:2 F5:2 Bb5:2 A5:2 Bb5:2', 'C6:2 Bb5:2 A5:2 G5:2 F5:4 r:4',
      'Eb5:2 C5:2 Eb5:2 C5:2 Eb5:2 A5:2 G5:2 A5:2', 'Bb5:2 A5:2 G5:2 F5:2 Eb5:4 r:4',
      'C5:2 F5:2 A5:2 C6:2 Eb6:4 C6:4', 'A5:2 F5:2 Eb5:2 C5:2 A4:4 r:4',
      'Bb4:2 D5:2 F5:2 Bb5:2 D6:4 Bb5:2 F5:2', 'D5:4 F5:4 Bb4:4 r:4',
      'F5:2 D5:2 F5:2 D5:2 F5:2 Bb5:2 A5:2 Bb5:2', 'C6:2 D6:2 Eb6:2 D6:2 C6:2 Bb5:2 A5:2 G5:2',
      'G5:2 Eb5:2 G5:2 Eb5:2 G5:2 Bb5:2 C6:2 Bb5:2', 'G5:4 F5:2 Eb5:2 D5:4 C5:4',
      'D5:2 F5:2 Bb5:2 F5:2 D6:4 Bb5:4', 'C6:2 A5:2 F5:2 A5:2 Eb6:4 C6:4',
      'Bb5:2 F5:2 D5:2 F5:2 Bb5:4 r:4', 'Bb5:4 r:4 D5:2 E5:2 F#5:2 G5:2',
      'Bb5:3 A5:1 G5:2 D5:2 G5:2 Bb5:2 D6:4', 'C6:2 Bb5:2 A5:2 G5:2 F#5:4 D5:4',
      'Eb5:3 D5:1 C5:2 G4:2 C5:2 Eb5:2 G5:4', 'A5:2 G5:2 F5:2 Eb5:2 C5:4 A4:4',
      'D5:3 C5:1 Bb4:2 F4:2 Bb4:2 D5:2 F5:4', 'B4:2 D5:2 F5:2 G5:2 B5:4 G5:4',
      'C6:2 G5:2 Eb5:2 G5:2 C6:2 D6:2 Eb6:4', 'D6:2 C6:2 A5:2 F5:2 Eb5:2 C5:2 A4:2 F4:2',
      'G5:2 G5:2 Bb5:2 G5:2 Eb6:4 D6:2 C6:2', 'Bb5:2 G5:2 Eb5:2 G5:2 Bb5:4 r:4',
      'F5:2 F5:2 Bb5:2 F5:2 D6:4 C6:2 Bb5:2', 'A5:2 Bb5:2 C6:2 D6:2 Bb5:4 r:4',
      'C5:2 E5:2 G5:2 Bb5:2 C6:4 Bb5:2 G5:2', 'E5:2 G5:2 Bb5:2 C6:2 E6:4 C6:4',
      'F5:2 A5:2 C6:2 A5:2 Eb6:4 C6:2 A5:2', 'F5:2 G5:2 A5:2 Bb5:2 C6:2 Eb6:2 r:2 F5:2',
    ],
    groove(v, b, s, c, level) {
      const root = near(c.chord.root, 34);
      if (s === 0 || s === 8) v.tuba(root, 0.55);
      if (s === 4 || s === 12) v.tuba(root + 7 > 47 ? root - 5 : root + 7, 0.48);
      if (s % 4 === 2) v.stab(c.chord, 58, 0.17, 0.09);
      if (s === 0 || s === 8 || (level >= 1 && (s === 4 || s === 12))) v.kick(s === 0 ? 0.55 : 0.42);
      if (s === 4 || s === 12) v.snare(0.32);
      if (level >= 2 && (s === 7 || s === 15)) v.snare(0.1);
      if (level >= 1 && b % 4 === 3 && s >= 12) v.snare(0.12 + (s - 12) * 0.05);
      if (s % 2 === 0) v.hat(s % 4 === 2 ? 0.16 : 0.09);
      else if (level >= 1) v.hat(0.06);
      if (level >= 1 && (s === 4 || s === 12)) v.tamb(0.15);
      if (s === 0 && b % 8 === 0) v.crash(0.16);
      for (const n of c.notes) {
        v.brass(n.m, n.len, 0.42);
        if (level >= 1 || b >= 24) v.glock(n.m + 12 > 100 ? n.m : n.m + 12, 0.08);
        if (level >= 2) v.reed(n.m - 12, n.len, 0.15);
      }
    },
  };

  const SCENES = { home: HOME, draft: DRAFT, race: RACE };
  for (const def of Object.values(SCENES)) {
    def.bars = def.melody.length * (def.repeat || 1);
    def.parsed = def.melody.map(parseBar);
    def.chordList = def.chords.map((str) => str.split(' ').map(chord));
    def.loopSeconds = def.bars * 16 * (60 / def.bpm / 4);
  }

  // 号角：拍数 → [起拍, 时值, 音名...]
  const STINGERS = {
    race: {
      bpm: 132, length: 6,
      brass: [[0, 1 / 3, 'F5'], [1 / 3, 1 / 3, 'F5'], [2 / 3, 1 / 3, 'F5'], [1, 1.5, 'Bb5', 'D5'], [2.5, 0.5, 'A5', 'C5'], [3, 2.6, 'Bb5', 'F5', 'D6']],
      bass: [[1, 1, 'Bb2'], [3, 2.6, 'Bb2']],
      timp: [[1, 'Bb2'], [3, 'F2'], [3.5, 'Bb2']],
      glock: [[3, 'D6'], [3.25, 'F6'], [3.5, 'Bb6']],
      roll: [[0, 1, 0.08, 0.3]], crash: [3],
    },
    final: {
      bpm: 120, length: 9,
      brass: [[2, 1, 'Bb5', 'F5', 'D6'], [3, 0.5, 'Bb5', 'G5', 'Eb6'], [3.5, 0.5, 'A5', 'C6', 'Eb6'], [4, 1 / 3, 'Bb5', 'D6'], [4 + 1 / 3, 1 / 3, 'Bb5', 'D6'], [4 + 2 / 3, 1 / 3, 'Bb5', 'D6'], [5, 3.4, 'Bb5', 'D6', 'F6', 'F5']],
      bass: [[2, 1, 'Bb2'], [3, 0.5, 'Eb2'], [3.5, 0.5, 'F2'], [5, 3.4, 'Bb1']],
      timp: [[2, 'Bb2'], [3, 'Eb2'], [3.5, 'F2'], [5, 'Bb2']],
      glock: [[5, 'Bb5'], [5.25, 'D6'], [5.5, 'F6'], [5.75, 'Bb6'], [6, 'D7']],
      roll: [[0, 2, 0.04, 0.34]], crash: [2, 5],
    },
  };

  /* ---------- 音频引擎（同一套代码给实时播放和离线渲染用） ---------- */
  function rng(seed) {
    let x = seed >>> 0 || 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  }
  function createEngine(ac, out) {
    const rand = rng(20261024);
    const E = { ac, rand };
    const g = (v) => { const n = ac.createGain(); n.gain.value = v; return n; };
    E.g = g;
    // 噪声缓冲只生成一次，打击乐每次从随机位置截一段
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;
    E.noise = nb;
    // 混响：程序生成的立体声衰减脉冲，前面低通一点让尾音更暖
    const len = Math.floor(ac.sampleRate * 1.5);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((rand() * 2 - 1) - lp) * 0.45;
        d[i] = lp * Math.pow(1 - i / len, 3.2) * (i < ac.sampleRate * 0.008 ? i / (ac.sampleRate * 0.008) : 1);
      }
    }
    E.bus = g(1);
    E.duck = g(1);
    E.vol = g(0);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.25;
    E.bus.connect(E.duck); E.duck.connect(E.vol); E.vol.connect(comp); comp.connect(out);
    E.dry = g(1); E.dry.connect(E.bus);
    E.revIn = g(1);
    const conv = ac.createConvolver(); conv.normalize = true; conv.buffer = ir;
    const revOut = g(0.42);
    E.revIn.connect(conv); conv.connect(revOut); revOut.connect(E.bus);
    // 两路不同长度的反馈延迟，左右分开，给领奏一点空间感
    E.dlIn = g(1);
    const dlOut = g(0.5); dlOut.connect(E.bus);
    for (const [time, pan] of [[0.27, -0.45], [0.4, 0.45]]) {
      const d = ac.createDelay(1); d.delayTime.value = time;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const fb = g(0.26);
      E.dlIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      const p = panner(ac, pan); lp.connect(p); p.connect(dlOut);
    }
    return E;
  }
  function panner(ac, v) {
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = v; return p; }
    const p = ac.createGain(); return p;
  }

  const CHANNELS = {
    lead: { pan: -0.12, rev: 0.2, dl: 0.12, gain: 1 },
    harm: { pan: 0.28, rev: 0.24, dl: 0, gain: 1 },
    bass: { pan: 0, rev: 0.05, dl: 0, gain: 1 },
    drums: { pan: 0.06, rev: 0.12, dl: 0, gain: 1 },
    sparkle: { pan: 0.45, rev: 0.34, dl: 0.16, gain: 1 },
    counter: { pan: -0.4, rev: 0.24, dl: 0.05, gain: 1 },
  };
  // 每个场景（或号角）一组独立的通道和推子，淡入淡出时连混响和延迟的送量一起推
  function makeMixer(E, level) {
    const ac = E.ac;
    const out = E.g(level), rev = E.g(level), dl = E.g(level);
    out.connect(E.dry); rev.connect(E.revIn); dl.connect(E.dlIn);
    const ch = {};
    for (const [name, c] of Object.entries(CHANNELS)) {
      const input = E.g(c.gain);
      const p = panner(ac, c.pan);
      input.connect(p); p.connect(out);
      const rs = E.g(c.rev); p.connect(rs); rs.connect(rev);
      if (c.dl) { const ds = E.g(c.dl); p.connect(ds); ds.connect(dl); }
      ch[name] = input;
    }
    return { out, rev, dl, ch, faders: [out.gain, rev.gain, dl.gain] };
  }
  function fade(mixer, to, t, dur) {
    for (const p of mixer.faders) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(to, t + dur);
    }
  }
  function releaseMixer(mixer) {
    for (const n of [mixer.out, mixer.rev, mixer.dl]) { try { n.disconnect(); } catch (e) { /* ignore */ } }
  }

  /* ---------- 音色 ---------- */
  function voices(E, mixer, sec) {
    const ac = E.ac, ch = mixer.ch;
    let t = 0;
    const osc = (type, f, at) => { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at); return o; };
    const amp = () => ac.createGain();
    const filt = (type, f, q = 0.7) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    // 打击型包络：快速起音后指数衰减，decay 约为衰减到 2% 的时间
    function perc(gain, at, peak, decay, attack = 0.004) {
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + attack);
      gain.gain.setTargetAtTime(0, at + attack, decay / 4);
      return at + attack + decay * 1.1;
    }
    function play(nodes, at, end) { for (const n of nodes) { n.start(at); n.stop(end); } }
    function noise(at, dur) {
      const src = ac.createBufferSource();
      src.buffer = E.noise;
      src.start(at, E.rand() * 1.6, dur + 0.05);
      return src;
    }
    const V = {
      set time(v) { t = v; },
      get time() { return t; },
      mallet(m, len, vel) {
        const f = hz(m), d = Math.min(0.9, 0.25 + 160 / f);
        const a = osc('sine', f, t), b = osc('sine', f * 3.93, t);
        const ga = amp(), gb = amp();
        const end = perc(ga, t, vel * 0.32, d);
        perc(gb, t, vel * 0.07, 0.06, 0.002);
        a.connect(ga); b.connect(gb); ga.connect(ch.lead); gb.connect(ch.lead);
        play([a, b], t, end);
      },
      glock(m, vel) {
        const f = hz(m);
        const parts = [[1, 1, 0.9], [2.76, 0.3, 0.22], [5.4, 0.12, 0.08]];
        for (const [r, v, d] of parts) {
          const o = osc('sine', f * r, t), ga = amp();
          const end = perc(ga, t, vel * v * 0.3, d, 0.002);
          o.connect(ga); ga.connect(ch.sparkle); play([o], t, end);
        }
      },
      celesta(m, vel) {
        const f = hz(m);
        for (const [r, v, d] of [[1, 1, 0.7], [2, 0.28, 0.25], [4, 0.06, 0.08]]) {
          const o = osc('sine', f * r, t), ga = amp();
          const end = perc(ga, t, vel * v * 0.3, d, 0.006);
          o.connect(ga); ga.connect(ch.sparkle); play([o], t, end);
        }
      },
      pluck(m, vel, decay = 1) {
        const f = hz(m);
        const o = osc('triangle', f, t), s = osc('sine', f, t);
        const lp = filt('lowpass', f * 6, 0.9);
        lp.frequency.setValueAtTime(f * 6, t);
        lp.frequency.setTargetAtTime(f * 1.6, t, 0.05);
        const ga = amp();
        const end = perc(ga, t, vel * 0.42, 0.32 * decay);
        o.connect(lp); s.connect(lp); lp.connect(ga); ga.connect(ch.bass);
        play([o, s], t, end);
      },
      tuba(m, vel) {
        const f = hz(m), len = sec * 1.7;
        const o = osc('sawtooth', f, t), s = osc('sine', f, t);
        const lp = filt('lowpass', Math.min(800, f * 3.4), 0.8);
        const ga = amp(), gs = amp();
        ga.gain.setValueAtTime(0, t);
        ga.gain.linearRampToValueAtTime(vel * 0.16, t + 0.012);
        ga.gain.setTargetAtTime(vel * 0.1, t + 0.012, 0.05);
        ga.gain.setTargetAtTime(0, t + len, 0.025);
        gs.gain.setValueAtTime(0, t);
        gs.gain.linearRampToValueAtTime(vel * 0.3, t + 0.01);
        gs.gain.setTargetAtTime(0, t + len, 0.03);
        o.connect(lp); lp.connect(ga); s.connect(gs); ga.connect(ch.bass); gs.connect(ch.bass);
        play([o, s], t, t + len + 0.2);
      },
      brass(m, len, vel, at = t, out = ch.lead) {
        const f = hz(m), dur = Math.max(0.08, len * sec - 0.02);
        const a = osc('sawtooth', f, at), b = osc('sawtooth', f, at);
        a.detune.value = -6; b.detune.value = 6;
        const lp = filt('lowpass', 500, 1.1);
        lp.frequency.setValueAtTime(450, at);
        lp.frequency.linearRampToValueAtTime(Math.min(4200, f * 5), at + 0.05);
        lp.frequency.setTargetAtTime(Math.min(2600, f * 3), at + 0.05, 0.12);
        const ga = amp();
        ga.gain.setValueAtTime(0, at);
        ga.gain.linearRampToValueAtTime(vel * 0.13, at + 0.025);
        ga.gain.setTargetAtTime(vel * 0.1, at + 0.025, 0.08);
        ga.gain.setTargetAtTime(0, at + dur, 0.03);
        const nodes = [a, b];
        if (dur > 0.32) {
          const lfo = osc('sine', 5.4, at), lg = amp();
          lg.gain.setValueAtTime(0, at);
          lg.gain.linearRampToValueAtTime(9, at + 0.3);
          lfo.connect(lg); lg.connect(a.detune); lg.connect(b.detune);
          nodes.push(lfo);
        }
        a.connect(lp); b.connect(lp); lp.connect(ga); ga.connect(out);
        play(nodes, at, at + dur + 0.25);
      },
      reed(m, len, vel) {
        const f = hz(m), dur = Math.max(0.06, len * sec - 0.03);
        const o = osc('square', f, t);
        const lp = filt('lowpass', Math.min(2200, f * 3), 0.5);
        const ga = amp();
        ga.gain.setValueAtTime(0, t);
        ga.gain.linearRampToValueAtTime(vel * 0.12, t + 0.022);
        ga.gain.setTargetAtTime(vel * 0.09, t + 0.022, 0.1);
        ga.gain.setTargetAtTime(0, t + dur, 0.025);
        o.connect(lp); lp.connect(ga); ga.connect(ch.counter);
        play([o], t, t + dur + 0.2);
      },
      stab(c, lo, vel, decay) {
        const tones = c.tones.slice(0, 4);
        for (const pc of tones) {
          const f = hz(near(pc, lo));
          const o = osc('sawtooth', f, t);
          const lp = filt('lowpass', 1500, 0.6);
          const ga = amp();
          const end = perc(ga, t, (vel * 0.22) / tones.length, decay, 0.006);
          o.connect(lp); lp.connect(ga); ga.connect(ch.harm);
          play([o], t, end);
        }
      },
      pad(c, steps, vel = 0.07) {
        const dur = steps * sec;
        for (const pc of c.tones.slice(0, 3)) {
          const f = hz(near(pc, 53));
          const o = osc('triangle', f, t);
          const lp = filt('lowpass', 1000, 0.5);
          const ga = amp();
          ga.gain.setValueAtTime(0, t);
          ga.gain.linearRampToValueAtTime(vel * 0.4, t + Math.min(0.3, dur * 0.4));
          ga.gain.setValueAtTime(vel * 0.4, t + dur - 0.12);
          ga.gain.linearRampToValueAtTime(0, t + dur + 0.25);
          o.connect(lp); lp.connect(ga); ga.connect(ch.harm);
          play([o], t, t + dur + 0.3);
        }
      },
      kick(vel) {
        const o = osc('sine', 110, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
        const ga = amp();
        const end = perc(ga, t, vel * 0.55, 0.24, 0.003);
        o.connect(ga); ga.connect(ch.drums); play([o], t, end);
      },
      snare(vel) {
        const n = noise(t, 0.2), bp = filt('bandpass', 1900, 0.7), ga = amp();
        perc(ga, t, vel * 0.45, 0.13, 0.002);
        n.connect(bp); bp.connect(ga); ga.connect(ch.drums);
        const o = osc('triangle', 185, t), go = amp();
        const end = perc(go, t, vel * 0.25, 0.06, 0.002);
        o.connect(go); go.connect(ch.drums); play([o], t, end);
      },
      hat(vel, open = false) {
        const n = noise(t, 0.2), hp = filt('highpass', 7600, 0.7), ga = amp();
        perc(ga, t, vel * 0.3, open ? 0.2 : 0.035, 0.001);
        n.connect(hp); hp.connect(ga); ga.connect(ch.drums);
      },
      shaker(vel) {
        const n = noise(t, 0.12), bp = filt('bandpass', 5200, 1.4), ga = amp();
        perc(ga, t, vel * 0.32, 0.055, 0.012);
        n.connect(bp); bp.connect(ga); ga.connect(ch.drums);
      },
      tamb(vel) {
        for (const off of [0, 0.022]) {
          const n = noise(t + off, 0.15), hp = filt('highpass', 8500, 0.8), ga = amp();
          perc(ga, t + off, vel * 0.3, 0.09, 0.001);
          n.connect(hp); hp.connect(ga); ga.connect(ch.sparkle);
        }
      },
      wood(vel, high) {
        const f = high ? 1400 : 1050;
        for (const [r, v, d] of [[1, 1, 0.05], [2.4, 0.4, 0.025]]) {
          const o = osc('sine', f * r, t), ga = amp();
          const end = perc(ga, t, vel * v * 0.4, d, 0.001);
          o.connect(ga); ga.connect(ch.drums); play([o], t, end);
        }
      },
      snap(vel) {
        const n = noise(t, 0.08), bp = filt('bandpass', 2600, 3), ga = amp();
        perc(ga, t, vel * 0.7, 0.04, 0.001);
        n.connect(bp); bp.connect(ga); ga.connect(ch.drums);
      },
      crash(vel, at = t) {
        const n = noise(at, 2), hp = filt('highpass', 4200, 0.6), ga = amp();
        perc(ga, at, vel * 0.32, 1.7, 0.002);
        n.connect(hp); hp.connect(ga); ga.connect(ch.sparkle);
      },
      timp(m, vel, at = t) {
        const f = hz(m);
        const o = osc('sine', f * 1.05, at);
        o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
        const ga = amp();
        const end = perc(ga, at, vel * 0.6, 0.9, 0.004);
        o.connect(ga); ga.connect(ch.bass); play([o], at, end);
        const n = noise(at, 0.1), lp = filt('lowpass', 320, 0.7), gn = amp();
        perc(gn, at, vel * 0.3, 0.08, 0.002);
        n.connect(lp); lp.connect(gn); gn.connect(ch.bass);
      },
    };
    return V;
  }

  /* ---------- 场景播放器 ---------- */
  function makePlayer(E, key, t0, opts = {}) {
    const def = SCENES[key];
    const mixer = makeMixer(E, 0);
    const sec = 60 / def.bpm / 4;
    const P = { key, def, mixer, sec, v: voices(E, mixer, sec), bar: opts.startBar || 0, step: 0, next: t0, stopAt: Infinity, level: 0 };
    return P;
  }
  function chordAt(def, bar, step) {
    const list = def.chordList[bar % def.chordList.length];
    return list.length > 1 && step >= 8 ? list[1] : list[0];
  }
  function playStep(P, heat) {
    const { def, bar, step, sec } = P;
    if (step === 0) P.level = heat >= 0.85 ? 2 : heat >= 0.6 ? 1 : 0; // 强度只在小节线上变
    let t = P.next;
    if (def.swing && step % 4 === 2) t += def.swing * sec * 2 * 0.5;
    else if (def.swing && step % 2 === 1) t += def.swing * sec * 0.5;
    P.v.time = t;
    const list = def.chordList[bar % def.chordList.length];
    const mel = def.parsed[bar % def.parsed.length];
    const nextBar = (bar + 1) % def.bars;
    const c = {
      chord: chordAt(def, bar, step),
      split: list.length > 1,
      next: def.chordList[nextBar % def.chordList.length][0],
      notes: mel.notes.filter((n) => n.at === step),
    };
    def.groove(P.v, bar, step, c, P.level);
  }
  function advance(P) {
    P.next += P.sec;
    if (++P.step === 16) { P.step = 0; P.bar = (P.bar + 1) % P.def.bars; }
  }
  function scheduleUntil(P, until, heat) {
    while (P.next < until && P.next < P.stopAt) { playStep(P, heat); advance(P); }
  }

  function playStinger(E, kind, t0) {
    const S = STINGERS[kind];
    const mixer = makeMixer(E, 1);
    const beat = 60 / S.bpm;
    const V = voices(E, mixer, beat / 4);
    const at = (b) => t0 + b * beat;
    for (const [b, len, ...names] of S.brass) for (const n of names) V.brass(midi(n), len * 4, 0.55 / Math.sqrt(names.length) * 1.3, at(b));
    for (const [b, len, n] of S.bass) V.brass(midi(n), len * 4, 0.5, at(b), mixer.ch.bass);
    for (const [b, n] of S.timp) V.timp(midi(n), 0.5, at(b));
    for (const [b, n] of S.glock) { V.time = at(b); V.glock(midi(n), 0.16); }
    for (const [b, len, from, to] of S.roll) {
      const hits = Math.round(len * beat / 0.045);
      for (let i = 0; i < hits; i++) { V.time = at(b) + i * 0.045; V.snare(from + (to - from) * (i / hits)); }
    }
    for (const b of S.crash) V.crash(0.3, at(b));
    const end = t0 + S.length * beat;
    return { mixer, end };
  }

  /* ---------- 实时控制 ---------- */
  // 总音量：比音效的 100ms 短时响度（约 -36 dBFS）低约 7 dB，只做背景
  const LOOKAHEAD = 0.3, TICK = 60, XFADE = 1.4, VOLUME = 0.065;
  let E = null, enabled = false, follower = null, timer = 0;
  let players = [], current = null, heat = 0;
  let want = 'home', pending = null, pendingSince = 0;
  let stinger = null, lastStinger = { kind: null, at: -10 };
  const sceneKey = (name) => (name === 'over' ? 'home' : SCENES[name] ? name : 'home');
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  const running = () => !!(E && enabled && !hidden() && E.ac.state === 'running');

  function readFollower() {
    if (!follower) return want;
    try {
      const r = follower() || {};
      const name = typeof r.scene === 'string' ? r.scene : 'home';
      heat = Number.isFinite(r.heat) ? Math.max(0, Math.min(1, r.heat)) : 0;
      if (name !== want) {
        // 场景要稳定 150ms 才切，避免快照重放时来回抖
        if (pending !== name) { pending = name; pendingSince = Date.now(); }
        if (Date.now() - pendingSince >= 150) { want = name; pending = null; }
      } else pending = null;
      return name;
    } catch (e) { return want; /* 读状态失败就保持当前场景 */ }
  }
  function startScene(key, now, fadeIn) {
    for (const P of players) {
      if (P.stopAt === Infinity) { fade(P.mixer, 0, now, fadeIn); P.stopAt = now + fadeIn; }
    }
    const P = makePlayer(E, key, now + 0.06);
    fade(P.mixer, P.def.gain, now + 0.06, fadeIn);
    players.push(P);
    current = P;
  }
  function tick() {
    timer = 0;
    if (!running()) return;
    const now = E.ac.currentTime;
    readFollower();
    const key = sceneKey(want);
    if (stinger) {
      if (now >= stinger.end - 0.25) {
        const s = stinger; stinger = null;
        setTimeout(() => releaseMixer(s.mixer), 4000);
        startScene(key, now, 0.8);
      }
    } else if (!current || current.key !== key) startScene(key, now, current ? XFADE : 0.9);
    for (const P of players) {
      // 主线程卡住时跳过已经错过的拍子，不把音符挤在一起补
      while (P.next < now - 0.02 && P.next < P.stopAt) advance(P);
      scheduleUntil(P, now + LOOKAHEAD, heat);
    }
    players = players.filter((P) => {
      if (P.next < P.stopAt || now < P.stopAt + 0.5) return true;
      releaseMixer(P.mixer);
      return false;
    });
    timer = setTimeout(tick, TICK);
  }
  function wake() {
    if (!timer && running()) timer = setTimeout(tick, 0);
  }
  function stopAll(dur = 0.4) {
    if (!E) return;
    const now = E.ac.currentTime;
    for (const P of players) if (P.stopAt === Infinity) { fade(P.mixer, 0, now, dur); P.stopAt = now + dur; }
    if (stinger) { fade(stinger.mixer, 0, now, dur); const s = stinger; setTimeout(() => releaseMixer(s.mixer), 2000); stinger = null; }
    current = null;
  }
  function setVol(to, dur) {
    if (!E) return;
    const p = E.vol.gain, now = E.ac.currentTime;
    p.cancelScheduledValues(now); p.setValueAtTime(p.value, now); p.linearRampToValueAtTime(to, now + dur);
  }

  if (typeof document !== 'undefined') {
    // 调度循环在 AudioContext 瞬间不是 running（设备切换、iOS interrupted、标签页短暂隐藏）时会自己停下；
    // 这里每秒兜底叫醒一次（已在跑时 wake 什么都不做），不用再靠开关音乐来重启
    setInterval(() => { if (enabled && E && !timer) wake(); }, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!E) return;
      if (document.hidden) { setVol(0, 0.12); clearTimeout(timer); timer = 0; }
      else if (enabled) { setVol(VOLUME, 0.6); wake(); }
    });
  }

  const M = {
    // sound.js 在首次用户手势里建好 AudioContext 后交给这里
    attach(ac) {
      if (E && E.ac === ac) return;
      E = createEngine(ac, ac.destination);
      if (enabled) { setVol(VOLUME, 0.8); wake(); }
    },
    setEnabled(on) {
      on = !!on;
      if (on === enabled) { if (on) wake(); return; }
      enabled = on;
      if (!E) return;
      if (on) { setVol(VOLUME, 0.8); wake(); } else { setVol(0, 0.4); stopAll(0.4); }
    },
    get enabled() { return enabled; },
    // app.js 注册一个只读函数：返回 { scene: 'home'|'draft'|'race'|'over', heat: 0..1 }
    follow(fn) { follower = typeof fn === 'function' ? fn : null; wake(); },
    // AudioContext 恢复运行后由 sound.js 叫醒调度
    wake,
    // 单场冲线 / 总冠军号角；返回 false 表示没在放音乐，由调用方改放普通音效
    stinger(kind) {
      if (!running()) return false;
      const now0 = readFollower();
      const k = kind === 'race' || kind === 'final' ? kind : now0 === 'over' ? 'final' : 'race';
      const now = E.ac.currentTime;
      // 同一种号角 1.5s 内只放一次（快进补播时）；总冠军号角总能盖过刚响的单场号角
      if (lastStinger.kind === k && now - lastStinger.at < 1.5) return true;
      lastStinger = { kind: k, at: now };
      stopAll(0.25);
      stinger = playStinger(E, k, now + 0.08);
      wake();
      return true;
    },
    // 音效响起时把音乐压低一点，0.2s 后慢慢回来
    duck() {
      if (!E || !enabled) return;
      const p = E.duck.gain, now = E.ac.currentTime;
      if (M._lastDuck && now - M._lastDuck < 0.05) return;
      M._lastDuck = now;
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.setTargetAtTime(0.62, now, 0.015);
      p.setTargetAtTime(1, now + 0.18, 0.22);
    },
    state() {
      return { enabled, attached: !!E, running: running(), want, playing: current ? current.key : null, bar: current ? current.bar : null, level: current ? current.level : 0, stinger: !!stinger, players: players.length };
    },
    // 离线渲染（测试与自检用）：name 为场景名或 'stinger-race' / 'stinger-final'；场景按 heatAt(秒) 变化强度，可从指定小节开始
    async render(name, seconds, opts = {}) {
      const OAC = (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext));
      const rate = opts.sampleRate || 44100;
      const ac = new OAC(2, Math.ceil(rate * seconds), rate);
      const e = createEngine(ac, ac.destination);
      e.vol.gain.value = VOLUME;
      const sting = /^stinger-(race|final)$/.exec(name);
      if (sting) playStinger(e, sting[1], 0.05);
      else {
        const P = makePlayer(e, name, 0.05, { startBar: opts.startBar || 0 });
        P.mixer.faders.forEach((p) => { p.value = P.def.gain; });
        const heatAt = opts.heatAt || (() => 0);
        while (P.next < seconds) { playStep(P, heatAt(P.next)); advance(P); }
      }
      return ac.startRendering();
    },
    VOLUME,
    _test: { SCENES, STINGERS, parseBar, chord, midi, near, sceneKey },
  };
  return M;
});
