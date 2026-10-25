// 胡闹运动会 · 界面皮肤素材：赛道格 / 底座 / 骰子 / 奖牌 / 旗帜 / 绊倒 / 闪光 / 爆花（全部原创 SVG，纯函数返回字符串）
// 配套样式见 skin.css（.sk-btn / .sk-pcard / .sk-banner）。
// 共享 defs：滤镜与 <symbol> 只在页面注入一次（Skin.install()，skin.js 加载时自动执行），
// 单个素材只是 <use> 引用，30 格 + 6 棋子 + 骰子同屏也只有很小的 DOM 与一次滤镜定义。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Skin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const INK = '#231F33';
  const CREAM = '#FBF6EC';
  const FONT = '-apple-system,BlinkMacSystemFont,&quot;PingFang SC&quot;,&quot;HarmonyOS Sans SC&quot;,&quot;Microsoft YaHei&quot;,sans-serif';

  /* ---------- 色彩工具 ---------- */
  const isHex = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  function mix(a, b, t) {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  const lighten = (c, t) => mix(c, '#FFFFFF', t);
  const darken = (c, t) => mix(c, INK, t);
  const num = v => +(+v).toFixed(2);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  /* ---------- 调色板（与 style.css 主色同源，略带纸感） ---------- */
  const CELL_COLORS = {
    red: '#F4684F', yellow: '#FFCB45', green: '#46BE82', blue: '#5AA6F4',
    purple: '#9A7FF2', black: '#3B3748', white: '#FFFDF6',
  };
  const CELL_ORDER = ['red', 'yellow', 'green', 'blue', 'purple', 'black', 'white'];
  const SEAT_COLORS = {
    red: '#EF4B36', blue: '#3D8DEB', green: '#33A86C', yellow: '#F2B01E',
    purple: '#7C5BE3', black: '#3A3647', pink: '#EF6AB0', orange: '#FF8A3D',
  };
  const SEAT_ORDER = ['red', 'blue', 'green', 'yellow', 'purple', 'black'];
  const PIP = '#E5383B';
  const GOLD = { base: '#FFC53D', hi: '#FFE98F', lo: '#C98A0B' };
  const MEDALS = {
    1: GOLD,
    2: { base: '#C8D0DC', hi: '#F4F7FB', lo: '#8793A4' },
    3: { base: '#E08A4C', hi: '#F7BE90', lo: '#A5582A' },
  };

  /* ---------- 基础图元 ---------- */
  const sk = (w = 3, col = INK) => `stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const poly = pts => pts.map(p => `${num(p[0])} ${num(p[1])}`).join(' ');
  function starPath(cx, cy, r, inner = 0.46, n = 5, rot = -Math.PI / 2) {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI / n) * i + rot;
      const rr = i % 2 ? r * inner : r;
      d += `${i ? 'L' : 'M'}${num(cx + rr * Math.cos(a))} ${num(cy + rr * Math.sin(a))}`;
    }
    return d + 'Z';
  }
  // 粗描边线条：先墨色粗线再叠彩色细线（与 art.js TL 同款）
  const tl = (d, col, w = 8, outline = 5) =>
    `<path d="${d}" fill="none" ${sk(w + outline)}/><path d="${d}" fill="none" ${sk(w, col)}/>`;

  /* ================= 共享 defs：滤镜 ================= */
  // sk-paper：低频斑驳 + 高频颗粒（深色麻点 + 浅色纤维），按元素自身形状裁切。
  // 区域取元素包围盒，计算量与元素面积成正比；频率为 user space，随缩放自然变细。
  const FILTERS = `
<filter id="sk-paper" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="3" seed="4" result="b"/>
<feColorMatrix in="b" type="matrix" values="0 0 0 0 .09  0 0 0 0 .07  0 0 0 0 .2  0.85 0 0 0 -.3" result="blot"/>
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 .09  0 0 0 0 .07  0 0 0 0 .2  1.9 0 0 0 -1.08" result="dark"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 2.4 0 -1.4" result="light"/>
<feMerge result="m"><feMergeNode in="blot"/><feMergeNode in="dark"/><feMergeNode in="light"/></feMerge>
<feComposite in="m" in2="SourceAlpha" operator="in"/>
</filter>`;

  /* ================= 赛道格 ================= */
  function cellBody(name) {
    const c = CELL_COLORS[name];
    const hi = lighten(c, 0.5), lo = darken(c, name === 'white' ? 0.25 : 0.45);
    const dark = name === 'black';
    return `<rect x="3" y="3" width="94" height="94" rx="8" fill="${c}"/>` +
      `<rect x="3" y="3" width="94" height="94" rx="8" fill="#000" filter="url(#sk-paper)" opacity="${dark ? 0.55 : name === 'white' ? 0.45 : 0.8}"/>` +
      `<path d="M10 90V10.5H90" fill="none" stroke="${hi}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="${dark ? 0.22 : 0.8}"/>` +
      `<path d="M12 90H90V12" fill="none" stroke="${lo}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="${dark ? 0.5 : 0.32}"/>` +
      `<path d="M83 93.4l5-.9M93.2 83l.8 5M7 12.5l.7-4.5" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round" opacity=".5"/>` +
      `<rect x="3" y="3" width="94" height="94" rx="8" fill="none" ${sk(5)}/>`;
  }

  /* ================= 小图标（赛道格效果标记，64x64） ================= */
  const MARKS = {
    // 得分：厚实的黄星
    score: () => `<path d="${starPath(32, 33, 27, 0.47)}" fill="#FFD23F" ${sk(4)}/>` +
      `<path d="${starPath(32, 33, 15, 0.47)}" fill="#FFF0A8" opacity=".8"/>` +
      `<path d="M20 22l4-4M45 40l1.5 3" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`,
    // 前进：带厚度的箭头
    move: () => `<path d="M8 28h26V14l22 20-22 20V40H8z" transform="translate(0 4)" fill="#C98A0B" ${sk(4)}/>` +
      `<path d="M8 28h26V14l22 20-22 20V40H8z" fill="#FFD23F" ${sk(4)}/>` +
      `<path d="M13 31h24M37 20l11 12" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>`,
    // 绊倒：运动鞋磕到石头
    trip: () => `<path d="M10 54l5-12 11-8 12 2 10 8 6 10z" fill="#9C97AA" ${sk(3.6)}/>` +
      `<path d="M21 38l3 6 8 2" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>` +
      `<g transform="rotate(-24 36 24)">` +
      `<path d="M24 8l13-1 3 15 10 5c4 2 6 5 5 9H22z" fill="#fff" ${sk(3.6)}/>` +
      `<path d="M22 31h33c1 4-1 8-6 9H22z" fill="#4D9DF7" ${sk(3.6)}/>` +
      `<path d="M26 14h8M27 19h9" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/></g>` +
      `<circle cx="8" cy="44" r="4.4" fill="#FFF4DD" ${sk(2.4)}/><circle cx="13" cy="51" r="3.2" fill="#FFF4DD" ${sk(2.4)}/>` +
      `<path d="M50 6l3-4M57 11l5-2M58 20l5 1" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    // 终点：方格旗
    finish: () => FINISH_FLAG,
    // 起点：绿色出发旗
    start: () => FLAG_BODY('#33B679'),
  };

  /* ================= 旗帜 ================= */
  function FLAG_BODY(fill) {
    const hi = lighten(fill, 0.45), lo = darken(fill, 0.3);
    return `<ellipse cx="15" cy="64" rx="11" ry="4.4" fill="${GOLD.lo}" ${sk(3)}/>` +
      `<rect x="12.2" y="8" width="5.6" height="56" rx="2.8" fill="${GOLD.base}" ${sk(3)}/>` +
      `<path d="M13.6 12v48" stroke="${GOLD.hi}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<circle cx="15" cy="7" r="4.6" fill="${GOLD.base}" ${sk(3)}/>` +
      `<path d="M17.8 11C28 4 36 17 49 9.5L45 23l4.6 14.5C37 44 29 31 17.8 38z" fill="${fill}" ${sk(3.6)}/>` +
      `<path d="M21 17c6-2.4 10 1.6 15 1.6" fill="none" stroke="${hi}" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>` +
      `<path d="M21 33c8-3 13 4 24-1" fill="none" stroke="${lo}" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>`;
  }
  const FLAG_SHAPE = 'M17.8 11C28 4 36 17 49 9.5L45 23l4.6 14.5C37 44 29 31 17.8 38z';
  const FINISH_FLAG = (() => {
    let sq = '';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 0) sq += `<rect x="${14 + c * 6}" y="${3 + r * 9}" width="6" height="9" fill="${INK}"/>`;
    return `<ellipse cx="15" cy="64" rx="11" ry="4.4" fill="${GOLD.lo}" ${sk(3)}/>` +
      `<rect x="12.2" y="8" width="5.6" height="56" rx="2.8" fill="${GOLD.base}" ${sk(3)}/>` +
      `<path d="M13.6 12v48" stroke="${GOLD.hi}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<circle cx="15" cy="7" r="4.6" fill="${GOLD.base}" ${sk(3)}/>` +
      `<clipPath id="sk-ffclip"><path d="${FLAG_SHAPE}"/></clipPath>` +
      `<path d="${FLAG_SHAPE}" fill="#fff"/><g clip-path="url(#sk-ffclip)">${sq}</g>` +
      `<path d="${FLAG_SHAPE}" fill="none" ${sk(3.6)}/>`;
  })();

  /* ================= 玩家底座（120x72，厚度 + 高光 + 影子） ================= */
  function seatBody(name) {
    const c = SEAT_COLORS[name];
    const hi = lighten(c, 0.55), mid = darken(c, 0.18), lo = darken(c, 0.5);
    const dark = name === 'black';
    const gr = dark ? 0.4 : 0.6;
    return `<ellipse cx="60" cy="59" rx="53" ry="10" fill="${INK}" opacity=".24"/>` +
      // 侧面厚度
      `<path d="M10 30v15a50 21 0 0 0 100 0V30z" fill="${lo}" ${sk(4.2)}/>` +
      `<path d="M10 30v15a50 21 0 0 0 100 0V30z" fill="${c}" opacity=".55"/>` +
      `<path d="M10 30v15a50 21 0 0 0 100 0V30z" fill="#000" filter="url(#sk-paper)" opacity="${gr}"/>` +
      `<path d="M16 36v8" stroke="${hi}" stroke-width="3.4" stroke-linecap="round" opacity=".6"/>` +
      `<path d="M25 56a50 21 0 0 0 70 0" fill="none" stroke="${INK}" stroke-width="2" opacity=".3" stroke-linecap="round"/>` +
      // 顶面
      `<ellipse cx="60" cy="30" rx="50" ry="22" fill="${c}" ${sk(4.2)}/>` +
      `<ellipse cx="60" cy="30" rx="50" ry="22" fill="#000" filter="url(#sk-paper)" opacity="${gr}"/>` +
      `<path d="M16 24C22 14 38 8 60 8" fill="none" stroke="${hi}" stroke-width="3.4" stroke-linecap="round" opacity=".75"/>` +
      // 凹槽（棋子站立处）
      `<ellipse cx="60" cy="31" rx="38" ry="15.5" fill="${mid}" ${sk(3.2)}/>` +
      `<ellipse cx="60" cy="33" rx="35" ry="12.5" fill="${darken(c, 0.32)}"/>` +
      `<ellipse cx="60" cy="33" rx="35" ry="12.5" fill="#000" filter="url(#sk-paper)" opacity=".4"/>` +
      `<path d="M30 40c10 7 50 7 60 0" fill="none" stroke="${hi}" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>` +
      `<path d="M27 28c2-5 9-9 14-10.4" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity=".45"/>`;
  }

  /* ================= 奖牌（100x112） ================= */
  // 月桂：左右各 7 片叶，沿以圆牌为中心的圆弧排列（下宽上窄），叶尖朝上
  function laurel(m, cx, cy) {
    let out = '';
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const phi = (112 + t * 108) * Math.PI / 180;      // 屏幕角度：自正下偏左，经正左，到左上
        const R = 36 - t * 1.5;
        const lx = cx + R * Math.cos(phi), ly = cy + R * Math.sin(phi);
        const x = side < 0 ? lx : 2 * cx - lx;
        const deg = phi * 180 / Math.PI - 18;              // 长轴沿切线，叶尖略向外翘
        const rot = side < 0 ? deg : -deg;
        out += `<ellipse cx="${num(x)}" cy="${num(ly)}" rx="4.4" ry="9.4" fill="${i % 2 ? m.base : m.hi}" ${sk(2.4)} transform="rotate(${num(rot)} ${num(x)} ${num(ly)})"/>`;
      }
    }
    return out;
  }
  function medalBody(rank) {
    const m = MEDALS[rank] || MEDALS[1];
    const cx = 50, cy = 66;
    const crown = `<path d="M33 30l4-18 9 11 4-15 4 15 9-11 4 18z" fill="${m.base}" ${sk(3)}/>` +
      `<path d="M35 30h30v5H35z" fill="${m.lo}" ${sk(2.6)}/>` +
      `<circle cx="37" cy="12" r="2.6" fill="${m.hi}" ${sk(1.8)}/><circle cx="50" cy="7" r="2.6" fill="${m.hi}" ${sk(1.8)}/><circle cx="63" cy="12" r="2.6" fill="${m.hi}" ${sk(1.8)}/>` +
      `<path d="M40 27l2-8M50 26v-8M60 27l-2-8" stroke="${m.hi}" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`;
    const ribbon = `<path d="M30 94l-6 16 11-4 5 7 6-16z" fill="${rank === 1 ? '#F2553C' : rank === 2 ? '#4D9DF7' : '#33B679'}" ${sk(3)}/>` +
      `<path d="M70 94l6 16-11-4-5 7-6-16z" fill="${rank === 1 ? '#F2553C' : rank === 2 ? '#4D9DF7' : '#33B679'}" ${sk(3)}/>`;
    return ribbon + laurel(m, cx, cy) + crown +
      `<circle cx="${cx}" cy="${cy}" r="29" fill="${m.base}" ${sk(4)}/>` +
      `<circle cx="${cx}" cy="${cy}" r="29" fill="#000" filter="url(#sk-paper)" opacity=".5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="23" fill="${m.hi}" ${sk(2.6)}/>` +
      `<circle cx="${cx}" cy="${cy}" r="23" fill="#000" filter="url(#sk-paper)" opacity=".35"/>` +
      `<path d="M30 56a24 24 0 0 1 14-13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>` +
      `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="36" font-weight="900" font-family="${FONT}" fill="${m.lo}" stroke="${INK}" stroke-width="3.2" paint-order="stroke" stroke-linejoin="round">${rank}</text>`;
  }

  /* ================= VS 爆炸星（140x120） ================= */
  function burstPoly(cx, cy, n, rOut, rIn, wob, rot = 0) {
    const pts = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI / n) * i + rot - Math.PI / 2;
      const r = i % 2 ? rIn + ((i * 7) % 3) * wob * 0.4 : rOut + ((i * 5) % 4) * wob;
      pts.push([cx + r * Math.cos(a) * 1.08, cy + r * Math.sin(a) * 0.96]);
    }
    return poly(pts);
  }
  function vsBody() {
    const cx = 70, cy = 62;
    const outer = burstPoly(cx, cy, 13, 52, 36, 3);
    const mid = burstPoly(cx, cy, 13, 43, 30, 2, 0.1);
    const core = burstPoly(cx, cy, 13, 33, 24, 1.5, 0.22);
    const V = 'M44 45L56 82L68 45';
    const S = 'M106 52C99 42 80 44 80 56C80 68 106 66 106 78C106 90 88 91 78 80';
    return `<polygon points="${outer}" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>` +
      `<polygon points="${outer}" fill="#F2553C" ${sk(5)}/>` +
      `<polygon points="${mid}" fill="#FF8A3D"/>` +
      `<polygon points="${core}" fill="#FFC53D" ${sk(3.4)}/>` +
      `<polygon points="${core}" fill="#000" filter="url(#sk-paper)" opacity=".4"/>` +
      `<g transform="translate(-4 3)" opacity=".28">${tl(V, INK, 14, 0)}${tl(S, INK, 14, 0)}</g>` +
      `<g transform="translate(-3 0) scale(1)">${tl(V, '#FFF1A8', 12, 6)}${tl(S, '#FFF1A8', 12, 6)}` +
      `<path d="M47 49l8 24M104 56c-6-8-20-8-22-2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/></g>` +
      `<path d="${starPath(122, 22, 9, 0.45)}" fill="#FFD23F" ${sk(2.6)}/><path d="${starPath(18, 98, 7, 0.45)}" fill="#FFD23F" ${sk(2.4)}/>` +
      `<path d="M112 12l4-5M130 30l6-1M24 14l-4-5M8 72l-6 1" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  }

  /* ================= 绊倒遮罩：晕眩螺旋眼（120x70） ================= */
  function spiral(cx, cy, r, turns = 2.6) {
    let d = '';
    const T = turns * Math.PI * 2;
    for (let t = 0; t <= T; t += 0.28) {
      const rr = (r * 0.84 * t) / T;
      d += `${t === 0 ? 'M' : 'L'}${num(cx + rr * Math.cos(t))} ${num(cy + rr * Math.sin(t))}`;
    }
    return d;
  }
  function tripMaskBody() {
    return `<ellipse cx="60" cy="38" rx="56" ry="28" fill="${INK}" opacity=".16"/>` +
      `<circle cx="34" cy="40" r="21" fill="#FFFDF6" ${sk(4)}/><circle cx="86" cy="40" r="21" fill="#FFFDF6" ${sk(4)}/>` +
      `<path d="${spiral(34, 40, 21)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>` +
      `<path d="${spiral(86, 40, 21)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" transform="rotate(180 86 40)"/>` +
      `<path d="${starPath(60, 12, 8.5, 0.46)}" fill="#FFD23F" ${sk(2.6)}/>` +
      `<path d="${starPath(12, 14, 6, 0.46)}" fill="#FFD23F" ${sk(2.2)}/>` +
      `<path d="${starPath(108, 14, 6, 0.46)}" fill="#FFD23F" ${sk(2.2)}/>` +
      `<path d="M20 10q10-8 24-5M76 5q14-3 24 5" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 5"/>`;
  }

  /* ================= 能力触发闪光 / 单个爆花（currentColor，100x100） ================= */
  function flashBody() {
    const four = (r, w) => `M50 ${50 - r}Q${50 + w} ${50 - w} ${50 + r} 50Q${50 + w} ${50 + w} 50 ${50 + r}Q${50 - w} ${50 + w} ${50 - r} 50Q${50 - w} ${50 - w} 50 ${50 - r}Z`;
    return `<circle cx="50" cy="50" r="40" fill="currentColor" opacity=".16"/><circle cx="50" cy="50" r="28" fill="currentColor" opacity=".22"/>` +
      `<path d="${four(46, 7)}" fill="currentColor" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>` +
      `<path transform="rotate(45 50 50)" d="${four(30, 5)}" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<circle cx="50" cy="50" r="7" fill="#fff" stroke="${INK}" stroke-width="2.6"/>` +
      `<circle cx="84" cy="16" r="3.2" fill="currentColor" stroke="${INK}" stroke-width="2"/><circle cx="14" cy="80" r="2.6" fill="currentColor" stroke="${INK}" stroke-width="2"/><circle cx="18" cy="20" r="2" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
  }
  function burstBody(rays = 14) {
    let out = '';
    for (let i = 0; i < rays; i++) {
      const a = (Math.PI * 2 * i) / rays - Math.PI / 2;
      const long = i % 2 === 0;
      const r0 = 13, r1 = long ? 40 : 31;
      const w = long ? 0.17 : 0.13;
      const p = (r, da) => `${num(50 + r * Math.cos(a + da))} ${num(50 + r * Math.sin(a + da))}`;
      out += `<path d="M${p(r0, -w)}L${p(r1, 0)}L${p(r0, w)}Z" fill="currentColor" stroke="#fff" stroke-opacity=".55" stroke-width="1.6" stroke-linejoin="round"/>`;
      out += `<path d="M${p(r0 + 3, -w * 0.3)}L${p(r1 - 6, 0)}L${p(r0 + 3, 0)}Z" fill="#fff" opacity=".5"/>`;
      out += `<circle cx="${num(50 + (r1 + 6.5) * Math.cos(a))}" cy="${num(50 + (r1 + 6.5) * Math.sin(a))}" r="${long ? 3.4 : 2.4}" fill="currentColor"/>`;
    }
    return out + `<circle cx="50" cy="50" r="11" fill="currentColor" opacity=".35"/><circle cx="50" cy="50" r="6.5" fill="#fff"/>`;
  }

  /* ================= 登记 symbols ================= */
  const SYM = {};
  const sym = (id, vb, body) => { SYM[id] = { vb, body }; };
  CELL_ORDER.forEach(n => sym('sk-cell-' + n, '0 0 100 100', cellBody(n)));
  Object.keys(SEAT_COLORS).forEach(n => sym('sk-seat-' + n, '0 0 120 72', seatBody(n)));
  [1, 2, 3].forEach(r => sym('sk-medal-' + r, '0 0 100 118', medalBody(r)));
  sym('sk-vs', '0 0 140 120', vsBody());
  sym('sk-trip-mask', '0 0 120 70', tripMaskBody());
  sym('sk-flash', '0 0 100 100', flashBody());
  sym('sk-burst', '0 0 100 100', burstBody(14));
  sym('sk-burst-s', '0 0 100 100', burstBody(10));
  Object.keys(MARKS).forEach(k => sym('sk-ic-' + k, '0 0 64 70', MARKS[k]()));
  sym('sk-flag', '0 0 64 70', FLAG_BODY('#F2553C'));

  function defsInner() {
    let out = `<defs>${FILTERS}`;
    for (const id of Object.keys(SYM)) out += `<symbol id="${id}" viewBox="${SYM[id].vb}" overflow="visible">${SYM[id].body}</symbol>`;
    return out + '</defs>';
  }
  const defs = () => `<svg id="sk-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">${defsInner()}</svg>`;

  function install(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.body) return false;
    if (doc.getElementById('sk-defs')) return true;
    const t = doc.createElement('div');
    t.innerHTML = defs();
    doc.body.insertBefore(t.firstChild, doc.body.firstChild);
    return true;
  }

  /* ================= 对外：统一的 <svg> 外壳 ================= */
  function shell(cls, vb, inner, o = {}) {
    const label = o.title ? ` role="img" aria-label="${esc(o.title)}"` : ' aria-hidden="true" focusable="false"';
    const css = [];
    if (o.size) {
      const [, , w, h] = vb.split(' ').map(Number);
      const W = typeof o.size === 'number' ? o.size : o.size[0];
      const H = typeof o.size === 'number' ? num(o.size * h / w) : o.size[1];
      css.push(`width:${W}px`, `height:${H}px`);
    }
    if (isHex(o.color)) css.push(`color:${o.color}`);
    const style = css.length ? ` style="${css.join(';')}"` : '';
    const standalone = o.standalone ? defsInner() : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="sk ${cls}${o.cls ? ' ' + esc(o.cls) : ''}" viewBox="${vb}"${style}${label}>${standalone}${inner}</svg>`;
  }
  const useOf = id => `<use href="#${id}"/>`;
  const ic = (kind, x, y, s) => `<use href="#sk-ic-${kind}" x="${x}" y="${y}" width="${s}" height="${s * 70 / 64}"/>`;

  /** 赛道格。color: red|yellow|green|blue|purple|black|white（或 0-6 索引）
   *  opts: { num: 5|10|…角标, label: 文字(black 默认「起点」, false 关闭), icon: score|move|trip|finish|start,
   *          size: px, title, cls, standalone } */
  function cell(color = 'red', opts = {}) {
    const name = typeof color === 'number' ? CELL_ORDER[color % 7] : (CELL_COLORS[color] ? color : 'red');
    const c = CELL_COLORS[name];
    let inner = useOf('sk-cell-' + name);
    const icon = opts.icon || (name === 'white' && opts.label !== false && !opts.num ? 'finish' : '');
    if (icon && MARKS[icon]) inner += ic(icon, 22, 18, 56);
    const label = opts.label === false ? '' : (opts.label != null ? opts.label : name === 'black' ? '起点' : '');
    if (label) inner += `<text x="50" y="58" text-anchor="middle" font-size="26" font-weight="900" font-family="${FONT}" fill="${lighten(c, 0.55)}" opacity=".85" letter-spacing="2">${esc(label)}</text>`;
    if (opts.num != null && opts.num !== '') {
      const ink = name === 'black' ? '#fff' : darken(c, 0.55);
      inner += `<text x="89" y="30" text-anchor="end" font-size="${String(opts.num).length > 2 ? 20 : 25}" font-weight="900" font-family="${FONT}" fill="${ink}" stroke="${name === 'black' ? 'none' : lighten(c, 0.55)}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round" opacity=".92">${esc(opts.num)}</text>`;
    }
    return shell('sk-cell sk-cell-' + name, '0 0 100 100', inner, { title: opts.title || (name === 'black' ? '起点' : name === 'white' ? '终点' : ''), ...opts });
  }

  /** 玩家底座。color: red|blue|green|yellow|purple|black（另有 pink|orange），或 0-5 索引 */
  function seat(color = 'red', opts = {}) {
    const name = typeof color === 'number' ? SEAT_ORDER[color % 6] : (SEAT_COLORS[color] ? color : 'red');
    return shell('sk-seat sk-seat-' + name, '0 0 120 72', useOf('sk-seat-' + name), opts);
  }

  /* ---------- 骰子 ---------- */
  const PIPS = {
    1: [[50, 50]],
    2: [[28, 28], [72, 72]],
    3: [[28, 28], [50, 50], [72, 72]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]],
    5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
  };
  const pips = n => {
    const r = n === 1 ? 14 : 9.6;
    return PIPS[n].map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${PIP}"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.32}" r="${num(r * 0.32)}" fill="#fff" opacity=".6"/>`).join('');
  };
  function neighbours(n) {
    const rest = [1, 2, 3, 4, 5, 6].filter(v => v !== n && v !== 7 - n);
    return [rest[0], rest[1]];                 // 互不为对面：rest[0] + rest[3] = 7
  }
  const DICE_STATES = {
    idle: { tilt: -8 },
    rolling: { tilt: 18, rolling: true },
    win: { tilt: -6, win: true },
    dim: { tilt: 0, dim: true },
    flat: { tilt: 0, view: 'flat' },
  };
  /** 骰子。n: 1-6。state: 'idle'|'rolling'|'win'|'dim'|'flat' 或 { tilt:度, view:'cube'|'flat', rolling, win, dim, size, title, cls } */
  function dice(n = 1, state = 'idle') {
    n = Math.min(6, Math.max(1, Math.round(+n) || 1));
    const o = { ...DICE_STATES.idle, ...(typeof state === 'string' ? DICE_STATES[state] : state) };
    const tilt = Math.max(-45, Math.min(45, +o.tilt || 0));
    const cls = `sk-dice${o.view === 'flat' ? ' sk-dice-flat' : ''}${o.rolling ? ' is-rolling' : ''}${o.win ? ' is-win' : ''}${o.dim ? ' is-dim' : ''}`;
    let g;
    if (o.view === 'flat') {
      g = `<ellipse cx="50" cy="92" rx="30" ry="5" fill="${INK}" opacity=".16"/>` +
        `<rect x="12" y="10" width="76" height="76" rx="17" fill="#FFFDF8" ${sk(6)}/>` +
        `<path d="M20 78V28a10 10 0 0 1 10-10h42" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>` +
        `<path d="M24 80h50a10 10 0 0 0 10-10V30" fill="none" stroke="#D9CDB6" stroke-width="4" stroke-linecap="round"/>` +
        `<g transform="translate(18 16) scale(.64)">${pips(n)}</g>`;
      return shell(cls, '0 0 100 100', `<g transform="rotate(${tilt} 50 50)">${g}</g>` + diceFx(o, 100), o);
    }
    const [tp, rp] = neighbours(n);
    const hex = [[14, 34], [32, 16], [102, 16], [102, 86], [84, 104], [14, 104]];
    g = `<ellipse cx="62" cy="112" rx="40" ry="6" fill="${INK}" opacity=".16"/>` +
      `<polygon points="${poly(hex)}" fill="#FFFDF8" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>` +
      `<polygon points="14,34 32,16 102,16 84,34" fill="#FFFFFF"/>` +
      `<polygon points="84,34 102,16 102,86 84,104" fill="#E6DCC8"/>` +
      `<polygon points="14,34 84,34 84,104 14,104" fill="#FFFAF0"/>` +
      `<path d="M20 100V40M22 38h58" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>` +
      `<path d="M80 100H22" fill="none" stroke="#E0D3BB" stroke-width="3.4" stroke-linecap="round"/>` +
      `<path d="M14 34h70v70M84 34l18-18" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<g transform="matrix(.7 0 0 .7 14 34)">${pips(n).replace(/<circle[^>]*opacity=".6"\/>/g, '')}</g>` +
      `<g transform="matrix(.7 0 -.18 .18 32 16)" opacity=".95">${pips(tp)}</g>` +
      `<g transform="matrix(.18 -.18 0 .7 84 34)" opacity=".95">${pips(rp)}</g>`;
    return shell(cls, '0 0 136 136', `<g transform="translate(10 8) rotate(${tilt} 58 60)">${g}</g>` + diceFx(o, 136), o);
  }
  function diceFx(o, S) {
    let fx = '';
    if (o.rolling) {
      fx += `<path d="M4 ${S * 0.42}h${S * 0.12}M0 ${S * 0.52}h${S * 0.18}M6 ${S * 0.62}h${S * 0.1}" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" opacity=".55"/>`;
      fx += `<path d="M${S * 0.9} ${S * 0.18}l${S * 0.06} -${S * 0.05}M${S * 0.94} ${S * 0.3}l${S * 0.05} 0" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".5"/>`;
    }
    if (o.win) {
      fx += `<path d="${starPath(S * 0.9, S * 0.14, S * 0.07, 0.45)}" fill="#FFD23F" ${sk(2.4)}/><path d="${starPath(S * 0.1, S * 0.22, S * 0.05, 0.45)}" fill="#FFD23F" ${sk(2)}/>`;
    }
    return fx;
  }

  /** VS 爆炸星徽标 */
  function vs(opts = {}) { return shell('sk-vs', '0 0 140 120', useOf('sk-vs'), { title: 'VS', ...opts }); }

  /** 结果「+N」徽标。n 可为数字或字符串；负数用红色并显示「-N」。 */
  function plus(n = 1, opts = {}) {
    const neg = typeof n === 'number' ? n < 0 : String(n).trim().startsWith('-');
    const txt = typeof n === 'number' ? (neg ? '−' + Math.abs(n) : '+' + n) : String(n);
    const fill = opts.color && isHex(opts.color) ? opts.color : neg ? '#F2553C' : '#33B679';
    const fs = txt.length > 3 ? 30 : txt.length > 2 ? 36 : 44;
    const body = `<g transform="rotate(-5 60 36)">` +
      `<rect x="9" y="12" width="102" height="56" rx="24" fill="${INK}" opacity=".22" transform="translate(0 4)"/>` +
      `<rect x="8" y="8" width="104" height="56" rx="26" fill="${fill}" ${sk(5)}/>` +
      `<rect x="8" y="8" width="104" height="56" rx="26" fill="#000" filter="url(#sk-paper)" opacity=".7"/>` +
      `<path d="M24 22q14-8 40-8" fill="none" stroke="${lighten(fill, 0.6)}" stroke-width="4" stroke-linecap="round" opacity=".8"/>` +
      `<text x="60" y="${36 + fs * 0.36}" text-anchor="middle" font-size="${fs}" font-weight="900" font-family="${FONT}" fill="#fff" stroke="${INK}" stroke-width="5" paint-order="stroke" stroke-linejoin="round">${esc(txt)}</text></g>` +
      `<path d="${starPath(108, 8, 7, 0.45)}" fill="#FFD23F" ${sk(2.2)}/>`;
    return shell('sk-plus', '0 0 120 76', body, { title: txt, ...opts, color: undefined });
  }

  /** 金色五角星（积分）。opts: { fill, empty, size } */
  function star(opts = {}) {
    const fill = opts.empty ? '#E8E0D0' : isHex(opts.fill) ? opts.fill : '#FFD23F';
    const body = `<path d="${starPath(32, 34, 28, 0.47)}" fill="${fill}" ${sk(4.4)}/>` +
      (opts.empty ? '' : `<path d="${starPath(32, 34, 28, 0.47)}" fill="#000" filter="url(#sk-paper)" opacity=".55"/><path d="M19 24l5-6M34 14l5 8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>`);
    return shell('sk-star', '0 0 64 64', body, opts);
  }

  /** 奖牌 rank_1 / rank_2 风格：1 金、2 银、3 铜（月桂 + 皇冠 + 缎带） */
  function medal(rank = 1, opts = {}) {
    const r = [1, 2, 3].includes(+rank) ? +rank : 1;
    return shell('sk-medal sk-medal-' + r, '0 0 100 118', useOf('sk-medal-' + r), { title: `第${r}名`, ...opts });
  }
  /** 回合旗帜（橙红旗）；opts.color 自定义旗面色 */
  function flag(opts = {}) {
    if (opts.color && isHex(opts.color)) return shell('sk-flag', '0 0 64 70', FLAG_BODY(opts.color), opts);
    return shell('sk-flag', '0 0 64 70', useOf('sk-flag'), opts);
  }
  /** 终点方格旗 / 起点出发旗 */
  const finishFlag = (opts = {}) => shell('sk-flag sk-flag-finish', '0 0 64 70', useOf('sk-ic-finish'), { title: '终点', ...opts });
  const startFlag = (opts = {}) => shell('sk-flag sk-flag-start', '0 0 64 70', useOf('sk-ic-start'), { title: '起点', ...opts });
  /** 赛道格效果标记：score | move | trip | finish | start */
  const mark = (kind = 'score', opts = {}) => shell('sk-mark sk-mark-' + kind, '0 0 64 70', useOf('sk-ic-' + (MARKS[kind] ? kind : 'score')), opts);
  /** 绊倒遮罩图标：晕眩螺旋眼 + 星星，盖在被绊倒的棋子上 */
  const tripMask = (opts = {}) => shell('sk-trip-mask', '0 0 120 70', useOf('sk-trip-mask'), { title: '被绊倒', ...opts });
  /** 能力触发闪光（四角星 + 光晕），color 为光色 */
  const flash = (color = '#FFC53D', opts = {}) => shell('sk-flash', '0 0 100 100', useOf('sk-flash'), { ...opts, color: isHex(color) ? color : '#FFC53D' });
  /** 单个矢量爆花（庆祝烟花可复用），color 为花色。opts.small 用 10 道光芒 */
  const burst = (color = '#F2553C', opts = {}) => shell('sk-burst-fx', '0 0 100 100', useOf(opts.small ? 'sk-burst-s' : 'sk-burst'), { ...opts, color: isHex(color) ? color : '#F2553C' });

  /* ================= HTML 组件助手（样式在 skin.css） ================= */
  /** 提示框：Skin.banner('请选择 飞艇 要进行的回合操作', { round: '1/4' }) */
  function banner(text, opts = {}) {
    const end = opts.round != null && opts.round !== ''
      ? `<span class="sk-banner-end">${flag({ size: 26 })}<b>${esc(opts.round)}</b></span>` : '';
    return `<div class="sk-banner${opts.cls ? ' ' + esc(opts.cls) : ''}" role="status"><span class="sk-banner-text">${esc(text)}</span>${end}</div>`;
  }
  /** 玩家卡。opts: { name, color:'#hex', score, avatar:SVG/HTML字符串, active, tripped, rank } */
  function pcard(opts = {}) {
    const col = isHex(opts.color) ? opts.color : '#F2553C';
    return `<div class="sk-pcard${opts.active ? ' is-active' : ''}${opts.tripped ? ' is-tripped' : ''}" style="--pc:${col}">` +
      `<div class="sk-ava">${opts.avatar || ''}${opts.tripped ? `<span class="sk-ava-trip">${tripMask({ size: 44 })}</span>` : ''}</div>` +
      `<div class="sk-score">${star({ size: 16 })}<b>${esc(opts.score == null ? 0 : opts.score)}</b></div>` +
      `<div class="sk-name">${esc(opts.name || '')}</div>` +
      (opts.rank ? `<span class="sk-rank">${medal(opts.rank, { size: 26 })}</span>` : '') + '</div>';
  }
  /** 双行按钮 HTML：Skin.button('投掷骰子', '根据点数前进', 'primary') */
  const button = (title, sub = '', kind = 'primary', attrs = '') =>
    `<button type="button" class="sk-btn ${kind === 'secondary' ? 'secondary' : 'primary'}" ${attrs}><b class="sk-t">${esc(title)}</b>${sub ? `<small class="sk-s">${esc(sub)}</small>` : ''}</button>`;

  /** 底座凹槽中心（占底座盒宽高的比例），用于把棋子立在底座上 */
  const SEAT_ANCHOR = { x: 0.5, y: 0.43 };

  const api = {
    cell, seat, dice, vs, plus, star, medal, flag, finishFlag, startFlag, mark, tripMask, flash, burst,
    banner, pcard, button, defs, install, mix, lighten, darken,
    CELL_COLORS, CELL_ORDER, SEAT_COLORS, SEAT_ORDER, SEAT_ANCHOR, INK, CREAM,
    symbolIds: () => Object.keys(SYM),
  };
  if (typeof document !== 'undefined') {
    if (document.body) install(document);
    else document.addEventListener('DOMContentLoaded', () => install(document), { once: true });
  }
  return api;
});
