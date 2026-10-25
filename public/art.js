// 胡闹运动会 · 手绘矢量美术：36 名运动员、骰子、线性图标（全部原创 SVG，无 emoji）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Art = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const INK = '#231F33';
  const SKIN = '#F6C39B';
  const SW = 3;
  let uid = 0;
  let sn = 0;

  /* ---------- 手绘引擎（仅一代使用；kit 仍导出原版直线图元，二代不受影响） ---------- */
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  // 确定性伪随机：同一坐标永远得到同一抖动，叠层描边才能对齐
  const nz = (x, y, s = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const hex = (a) => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const shade = (h) => { const [r, g, b] = rgb(h); const l = (r + g + b) / 3; const k = l > 200 ? 0.78 : 0.68; return hex([r * k - 4, g * (k - 0.03) - 2, b * (k + 0.02) + 6]); };
  const tint = (h, t = 0.5) => { const [r, g, b] = rgb(h); return hex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]); };

  // 路径抖动：顶点微抖 + 直线段改成轻微弯弓。仅处理 M L Q C Z（绝对坐标）
  function wobble(d, amp = 0.7) {
    if (/[^MLQCZ0-9.,\-\s]/.test(d)) return d;
    const tk = d.match(/[MLQCZ]|-?\d*\.?\d+/g);
    let out = '', i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '';
    const jp = (x, y) => [x + nz(x, y, 1) * amp, y + nz(x, y, 2) * amp];
    const num = () => parseFloat(tk[i++]);
    while (i < tk.length) {
      if (/[MLQCZ]/.test(tk[i])) cmd = tk[i++];
      if (cmd === 'Z') { out += 'Z'; cx = sx; cy = sy; continue; }
      if (cmd === 'M') { const [x, y] = jp(num(), num()); out += `M${f1(x)} ${f1(y)}`; cx = sx = x; cy = sy = y; cmd = 'L'; }
      else if (cmd === 'L') {
        const [x, y] = jp(num(), num());
        const len = Math.hypot(x - cx, y - cy);
        if (len > 9) {
          const b = nz(x + cx, y + cy, 3) * Math.min(len * 0.05, 1.3);
          const mx = (x + cx) / 2 + (-(y - cy) / len) * b, my = (y + cy) / 2 + ((x - cx) / len) * b;
          out += `Q${f1(mx)} ${f1(my)} ${f1(x)} ${f1(y)}`;
        } else out += `L${f1(x)} ${f1(y)}`;
        cx = x; cy = y;
      } else if (cmd === 'Q') {
        const [a, b] = jp(num(), num()); const [x, y] = jp(num(), num());
        out += `Q${f1(a)} ${f1(b)} ${f1(x)} ${f1(y)}`; cx = x; cy = y;
      } else if (cmd === 'C') {
        const [a, b] = jp(num(), num()); const [c, e] = jp(num(), num()); const [x, y] = jp(num(), num());
        out += `C${f1(a)} ${f1(b)} ${f1(c)} ${f1(e)} ${f1(x)} ${f1(y)}`; cx = x; cy = y;
      } else break;
    }
    return out;
  }
  // 闭合平滑曲线（Catmull-Rom → 三次贝塞尔）
  function blob(pts) {
    const n = pts.length; let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
    }
    return d + 'Z';
  }
  function ellipsePath(x, y, rx, ry, rot = 0) {
    const n = Math.max(rx, ry) < 14 ? 8 : 12, ca = Math.cos((rot * Math.PI) / 180), sa = Math.sin((rot * Math.PI) / 180);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n, k = 1 + 0.028 * nz(x + i, y, 5);
      const px = rx * k * Math.cos(a), py = ry * k * Math.sin(a);
      pts.push([x + px * ca - py * sa, y + px * sa + py * ca]);
    }
    return blob(pts);
  }
  const bbox = (d) => {
    const v = d.match(/-?\d*\.?\d+/g).map(Number); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i + 1 < v.length; i += 2) { x0 = Math.min(x0, v[i]); x1 = Math.max(x1, v[i]); y0 = Math.min(y0, v[i + 1]); y1 = Math.max(y1, v[i + 1]); }
    return [x0, y0, x1, y1];
  };
  const st = (w = SW) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  // 核心：粗细变化的轮廓 + 2 层色阶（受光面/背光面）+ 轻颗粒
  function inkShape(d, f, w = SW, noShade = false) {
    const wd = wobble(d);
    if (f === 'none') return `<path d="${wd}" fill="none" ${st(w)}/>`;
    if (!w) return `<path d="${wd}" fill="${f}"/>`;
    const [x0, y0, x1, y1] = bbox(wd), bw = x1 - x0, bh = y1 - y0, size = Math.min(bw, bh);
    if (noShade || size < 15 || !HEX.test(f)) return `<path d="${wd}" fill="${f}" ${st(w)}/>`;
    const id = `h${uid}_${sn++}`, o = Math.min(5, Math.max(2.2, size * 0.12)), sh = shade(f);
    let dots = '';
    const n = Math.min(9, Math.round((bw * bh) / 380));
    if (size >= 22) for (let i = 0; i < n; i++) dots += `M${f1(x0 + (nz(i, x0, 7) * 0.5 + 0.5) * bw)} ${f1(y0 + (nz(i, y0, 8) * 0.5 + 0.5) * bh)}h.01`;
    return `<defs><path id="${id}" d="${wd}"/><clipPath id="${id}c"><use href="#${id}"/></clipPath></defs>` +
      `<g clip-path="url(#${id}c)"><use href="#${id}" fill="${sh}"/><use href="#${id}" fill="${f}" transform="translate(${f1(-o)} ${f1(-o * 1.15)})"/>` +
      (dots ? `<path d="${dots}" stroke="${INK}" stroke-opacity=".3" stroke-width="1.6" stroke-linecap="round" fill="none"/>` : '') + `</g>` +
      `<use href="#${id}" fill="none" ${st(w * 1.08)}/><use href="#${id}" fill="none" ${st(w * 0.55)} transform="translate(.55 .6)"/>`;
  }
  const rrPath = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    return `M${x + r} ${y}L${x + w - r} ${y}Q${x + w} ${y} ${x + w} ${y + r}L${x + w} ${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}L${x + r} ${y + h}Q${x} ${y + h} ${x} ${y + h - r}L${x} ${y + r}Q${x} ${y} ${x + r} ${y}Z`;
  };

  /* ---------- 基础图元：原版（kit 导出、二代沿用）与手绘版（一代内部使用） ---------- */
  const classic = {
    C: (x, y, r, f, w) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" ${st(w)}/>`,
    E: (x, y, rx, ry, f, w, rot) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${f}" ${st(w)}${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}/>`,
    P: (d, f = 'none', w) => `<path d="${d}" fill="${f}" ${st(w)}/>`,
    R: (x, y, w, h, rx, f, sw) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${st(sw)}/>`,
    L: (x1, y1, x2, y2, w = SW, col = INK) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`,
    TL: (d, col, w = 8) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
    shadow: (cx = 50, rx = 28) => `<ellipse cx="${cx}" cy="91" rx="${rx}" ry="4.5" fill="${INK}" opacity=".14"/>`,
  };
  const handPrims = {
    C: (x, y, r, f, w) => { x = +x; y = +y; return (r < 8 && f !== 'none' ? classic.C(x, y, r, f, w) : inkShape(ellipsePath(x, y, r, r), f, w)); },
    E: (x, y, rx, ry, f, w, rot) => inkShape(ellipsePath(+x, +y, rx, ry, rot), f, w),
    P: (d, f = 'none', w) => inkShape(d, f, w),
    R: (x, y, w, h, rx, f, sw) => inkShape(rrPath(x, y, w, h, rx), f, sw),
    L: (x1, y1, x2, y2, w = SW, col = INK) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 9) return classic.L(x1, y1, x2, y2, w, col);
      const b = nz(x1 + x2, y1 + y2, 3) * Math.min(len * 0.05, 1.3);
      const mx = (x1 + x2) / 2 - ((y2 - y1) / len) * b, my = (y1 + y2) / 2 + ((x2 - x1) / len) * b;
      return `<path d="M${f1(x1)} ${f1(y1)}Q${f1(mx)} ${f1(my)} ${f1(x2)} ${f1(y2)}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
    },
    // 四肢：墨边 + 本色 + 背光暗条
    TL: (d, col, w = 8) => {
      const wd = wobble(d, 0.5);
      return `<path d="${wd}" fill="none" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round" stroke-linejoin="round"/><path d="${wd}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` +
        (HEX.test(col) && w >= 4 ? `<path d="${wd}" fill="none" stroke="${shade(col)}" stroke-width="${f1(w * 0.34)}" stroke-linecap="round" transform="translate(${f1(w * 0.24)} ${f1(w * 0.2)})"/>` : '');
    },
    // 脚下地面阴影：硬边双层 + 两笔草痕
    shadow: (cx = 50, rx = 28) => `<ellipse cx="${cx}" cy="91.5" rx="${rx}" ry="4.8" fill="${INK}" opacity=".13"/><ellipse cx="${cx + 2}" cy="91" rx="${f1(rx * 0.7)}" ry="3.2" fill="${INK}" opacity=".16"/><path d="M${cx - rx - 2} 92.5h5M${cx + rx - 3} 92.5h5" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".28"/>`,
  };

  function makeKit(prims) {
    const { C, E, P, R, L, TL, shadow } = prims;
    const dot = (x, y, r, f = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}"/>`;
  function eye(x, y, r = 6, dx = 0.22, dy = 0.08) {
    const pr = r * 0.52;
    const px = x + dx * r, py = y + dy * r;
    return C(x, y, r, '#fff', 2.5) + dot(px, py, pr) + dot(px - pr * 0.35, py - pr * 0.4, pr * 0.34, '#fff');
  }
  // 眯眯眼 / 得意眼
  const lid = (x, y, r = 5) => P(`M${x - r} ${y} Q${x} ${y - r * 0.9} ${x + r} ${y}`, 'none', 2.6);
  const sleepy = (x, y, r = 6) => C(x, y, r, '#fff', 2.5) + dot(x, y + r * 0.3, r * 0.45) + P(`M${x - r} ${y - 0.5} L${x + r} ${y - 0.5}`, 'none', 2.6) + `<path d="M${x - r + 1} ${y - 1} A${r - 1} ${r - 1} 0 0 1 ${x + r - 1} ${y - 1} Z" fill="#D9CBB8"/>`;
  function spiralEye(x, y, r) {
    let d = '';
    const turns = 2.6 * Math.PI;
    for (let t = 0; t <= turns; t += 0.25) {
      const rr = (r * 0.82 * t) / turns;
      d += `${t === 0 ? 'M' : 'L'}${(x + rr * Math.cos(t)).toFixed(1)} ${(y + rr * Math.sin(t)).toFixed(1)}`;
    }
    return C(x, y, r, '#fff', 2.5) + `<path d="${d}" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`;
  }
  function heart(x, y, s, f = '#E5383B', w = 2.2) {
    const k = s / 10;
    const pt = (a, b) => `${(x + a * k).toFixed(1)} ${(y + b * k).toFixed(1)}`;
    return P(`M${pt(0, 8)} C${pt(-12, 0)} ${pt(-8, -10)} ${pt(0, -4)} C${pt(8, -10)} ${pt(12, 0)} ${pt(0, 8)} Z`, f, w);
  }
  function star(x, y, r, f = '#FFD23F', w = 2, n = 5, inner = 0.45) {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI / n) * i - Math.PI / 2;
      const rr = i % 2 ? r * inner : r;
      d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`;
    }
    return P(d + 'Z', f, w);
  }
  const smile = (x, y, w, h = 5) => P(`M${x - w} ${y} Q${x} ${y + h * 2} ${x + w} ${y}`, 'none', 2.6);
  // 张嘴大笑（带舌头）
  const openMouth = (x, y, w, h, tongue = '#FF6B81') =>
    P(`M${x - w} ${y} Q${x} ${y + h * 2.2} ${x + w} ${y} Z`, '#5A1A2E', 2.6) +
    `<path d="M${x - w * 0.45} ${y + h * 0.95} Q${x} ${y + h * 0.35} ${x + w * 0.45} ${y + h * 0.95} Q${x} ${y + h * 1.25} ${x - w * 0.45} ${y + h * 0.95} Z" fill="${tongue}"/>`;
  // 露齿笑
  function teethGrin(x, y, w, h) {
    let t = R(x - w, y, w * 2, h, h / 2.2, '#fff', 2.6);
    const n = Math.max(3, Math.round(w / 3.5));
    for (let i = 1; i < n; i++) {
      const xx = x - w + (w * 2 * i) / n;
      t += L(xx, y + 1.5, xx, y + h - 1.5, 1.5);
    }
    return t + L(x - w + 2, y + h / 2, x + w - 2, y + h / 2, 1.5);
  }
    return { INK, SKIN, C, E, P, R, L, dot, TL, shadow, eye, lid, sleepy, spiralEye, heart, star, smile, openMouth, teethGrin };
  }
  const KIT = makeKit(classic);   // 原版：kit 导出，二代沿用
  const HAND = makeKit(handPrims); // 手绘版：一代内部使用
  const { C, E, P, R, L, TL, dot, shadow, eye, lid, sleepy, spiralEye, heart, star, smile, openMouth, teethGrin } = HAND;

  const wrap = (inner, cls = 'racer-svg') => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="${cls}">${inner}</svg>`;

  /* ---------- 骰子 ---------- */
  const PIPS = {
    1: [[50, 50]], 2: [[30, 30], [70, 70]], 3: [[28, 28], [50, 50], [72, 72]],
    4: [[30, 30], [70, 30], [30, 70], [70, 70]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
    6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
  };
  function dieInner(v) {
    const p = PIPS[v] || PIPS[1];
    return `<rect x="8" y="8" width="84" height="84" rx="18" fill="#fff" stroke="${INK}" stroke-width="6"/>` +
      `<path d="M16 76 Q16 84 26 84 L74 84 Q84 84 84 74" fill="none" stroke="#E6E1F0" stroke-width="5" stroke-linecap="round"/>` +
      p.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${v === 1 ? 10 : 8}" fill="${v === 1 ? '#E5383B' : INK}"/>`).join('');
  }
  const die = (v) => wrap(dieInner(Number(v)), 'die-svg');

  /* ---------- 36 名运动员 ---------- */
  const COLORS = {
    alchemist: '#3FA34D', blimp: '#9AA5B8', coach: '#6CC24A', babayaga: '#FFC93C', centaur: '#E23D4B',
    copycat: '#5B8DEF', banana: '#FFD93D', cheerleader: '#F0483E', dicemonger: '#8E6CEF', duelist: '#6ECFF6',
    genius: '#FF6FAE', heckler: '#FF4FA3', egg: '#F7801E', gunk: '#8AC926', hugebaby: '#F6A5C8',
    flipflop: '#A77CE0', hare: '#8ECAE6', hypnotist: '#2EC4B6', inchworm: '#7B4FD1', legs: '#3BB273',
    mastermind: '#2D6A4F', lackey: '#C77DFF', loser: '#FF5DA2', mouth: '#E63946', leaptoad: '#4CC9F0',
    magician: '#B388EB', partyanimal: '#FFCB47', rocket: '#FF7B54', sisyphus: '#F4A259', suckerfish: '#52C88A',
    romantic: '#FF7EB9', skipper: '#F4845F', thirdwheel: '#FFE66D', scoocher: '#A9713C', stickler: '#FF8FCB',
    twin: '#A7C957',
  };

  const DRAW = {
    alchemist() {
      return shadow(50, 30) +
        P('M50 10 C30 12 22 36 22 58 L17 88 L83 88 L78 58 C78 36 70 12 50 10 Z', '#3FA34D') +
        P('M50 14 C40 18 36 28 36 36', 'none', 2) +
        E(50, 47, 16, 14, '#2B6E35', 2.6) +
        E(50, 49, 13, 11, SKIN, 0) +
        eye(44, 44, 4.6) + eye(56, 44, 4.6) +
        P('M34 50 Q35 70 50 82 Q65 70 66 50 Q58 57 50 55 Q42 57 34 50 Z', '#F28A2E') +
        P('M44 60 Q50 66 56 60', 'none', 2) +
        P('M40 66 L42 72 M50 70 L50 77 M60 66 L58 72', 'none', 1.5) +
        C(50, 51, 3.6, '#F28482', 2.2) +
        R(72, 44, 7, 12, 2, '#E8F1FF', 2.6) +
        C(75.5, 68, 12, '#E8F1FF') +
        `<path d="M64.5 70 A11 11 0 0 0 86.5 70 Z" fill="#B15EF0"/>` + C(75.5, 68, 12, 'none') +
        C(80, 37, 3.2, '#D7B5FF', 2) + C(73, 30, 2.4, '#D7B5FF', 1.8) + C(81, 24, 1.8, '#D7B5FF', 1.6) +
        C(64, 72, 5.5, SKIN, 2.6);
    },
    blimp() {
      return shadow(46, 26) +
        star(88, 50, 10, '#FF9F1C', 2.2, 7, 0.5) + star(88, 50, 5, '#FFE66D', 0, 6, 0.5) +
        P('M70 36 L86 22 L88 40 Z', '#E5383B') + P('M70 62 L86 76 L88 58 Z', '#E5383B') +
        E(46, 49, 36, 21, '#AEB7C8') +
        P('M20 36 Q46 30 76 38', 'none', 2) + P('M16 49 L80 49', 'none', 2) + P('M20 62 Q46 68 76 60', 'none', 2) +
        E(46, 49, 36, 21, 'none') +
        R(36, 70, 20, 9, 4, '#F25C54', 2.6) + L(40, 68, 40, 71, 2) + L(52, 68, 52, 71, 2) +
        `<path d="M24 40 Q46 33 70 40" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="3.4" stroke-linecap="round"/>` +
        dot(42, 52, 1.3) + dot(50, 52, 1.3) + dot(58, 52, 1.3) + dot(66, 51, 1.3) + P('M10 40 L4 36 M10 58 L4 62', 'none', 2.4) +
        eye(22, 44, 6.5, -0.1, 0) + eye(35, 42, 6.5, -0.1, 0) +
        E(27, 57, 4, 5, '#5A1A2E', 2.4) +
        P('M16 36 L22 38 M30 34 L36 36', 'none', 2.2);
    },
    coach() {
      return shadow(50, 26) +
        P('M66 74 Q84 76 88 86 Q76 84 64 82 Z', '#6CC24A') +
        E(48, 66, 22, 22, '#6CC24A') +
        E(48, 72, 13, 14, '#D8F0B8', 2.4) +
        P('M26 60 L20 56 L24 52 M24 70 L18 68 L22 64', '#C5E86C', 2.2) +
        TL('M40 56 L47 68', '#F4F1FF', 1.6) + R(42, 66, 11, 6, 3, '#FFD23F', 2) + dot(46, 69, 1.4) +
        P('M22 40 Q22 22 46 22 Q70 22 70 40 Q70 54 46 54 Q16 54 22 40 Z', '#6CC24A') +
        P('M20 38 Q14 42 20 48 L30 50', '#6CC24A', 2.6) +
        P('M22 30 Q44 6 68 28 Z', '#E63946') +
        P('M62 28 L86 30 Q84 36 64 34 Z', '#C1121F') +
        dot(44, 18, 2.4, '#fff') +
        eye(38, 38, 5.5, 0.3, 0.1) + eye(52, 38, 5.5, 0.3, 0.1) +
        P('M30 48 Q40 44 50 48', 'none', 2.4) +
        P('M60 56 L68 52 L92 36 L92 78 L68 64 Z', '#FF6FB5') + E(92, 57, 4, 21, '#FFB3D9', 2.6) +
        C(62, 60, 6, '#6CC24A', 2.6);
    },
    babayaga() {
      return shadow(50, 26) +
        TL('M38 68 L34 86', '#F4A259', 4) + TL('M62 68 L66 86', '#F4A259', 4) +
        TL('M26 88 L34 86 L40 90 M34 86 L32 92', '#F4A259', 3) + TL('M60 90 L66 86 L74 88 M66 86 L68 92', '#F4A259', 3) +
        R(24, 38, 52, 34, 3, '#FFC93C') +
        L(24, 48, 76, 48, 1.6, '#C98A1B') + L(24, 58, 76, 58, 1.6, '#C98A1B') + R(24, 38, 52, 34, 3, 'none') +
        C(70, 8, 4, '#EFEAF7', 1.8) + C(77, 3.5, 3, '#EFEAF7', 1.6) +
        R(64, 12, 8, 16, 1.5, '#9C6644', 2.6) +
        P('M16 42 L50 12 L84 42 Z', '#E63946') + P('M28 32 L50 18 L72 32', 'none', 1.8) +
        R(31, 44, 13, 12, 2, '#fff', 2.6) + dot(39, 51, 3.2) +
        R(56, 44, 13, 12, 2, '#fff', 2.6) + dot(64, 51, 3.2) +
        P('M43 72 L43 64 Q50 56 57 64 L57 72 Z', '#7A3E1D', 2.6) + dot(54, 66, 1.3, '#FFC93C');
    },
    centaur() {
      return shadow(54, 32) +
        star(92, 76, 6.5, '#FFD23F', 1.8, 8, 0.45) + C(88, 89, 3, '#E9E4F2', 1.8) + C(94, 90, 2.4, '#E9E4F2', 1.6) +
        TL('M40 70 L36 88', '#C1121F', 5) + TL('M50 72 L50 88', '#C1121F', 5) + TL('M68 72 L70 88', '#C1121F', 5) + TL('M78 68 L84 86', '#C1121F', 5) +
        P('M82 56 Q98 50 94 68 Q92 80 84 72 Q90 66 84 62 Z', '#fff', 2.6) +
        E(60, 60, 26, 14, '#E23D4B') +
        E(36, 89, 5.5, 2.8, INK, 0) + E(50, 89, 5.5, 2.8, INK, 0) + E(70, 89, 5.5, 2.8, INK, 0) + E(84, 87, 5.5, 2.8, INK, 0) +
        P('M34 18 Q56 6 64 22 Q76 30 78 48 Q68 40 62 42 Q64 32 50 28 Z', '#fff') +
        P('M24 66 Q18 46 28 38 L48 38 Q56 50 48 66 Z', '#F4A259') +
        C(37, 26, 12, '#F4A259') +
        P('M25 22 Q29 10 42 13 Q50 16 49 23 Q40 16 25 22 Z', '#fff', 2.4) +
        lid(32, 28, 3.6) + lid(42, 28, 3.6) +
        P('M33 34 Q38 37 43 33', 'none', 2.2) +
        P('M22 46 Q36 40 50 46 L50 54 Q36 48 22 54 Z', '#F4A259', 2.6) + L(36, 44, 36, 51, 1.8);
    },
    copycat() {
      const cat = (cx, flip) =>
        P(`M${cx - 14} ${50} L${cx - 16} ${26} L${cx - 4} ${36} Z`, '#5B8DEF', 2.6) +
        P(`M${cx + 14} ${50} L${cx + 16} ${26} L${cx + 4} ${36} Z`, '#5B8DEF', 2.6) +
        P(`M${cx - 6} 74 L${cx} 70 L${cx + 6} 74 L${cx + 3} 88 L${cx} 90 L${cx - 3} 88 Z`, '#9D4EDD', 2.2) +
        L(cx - 4, 79, cx + 4, 77, 2, '#FFD23F') + L(cx - 4, 85, cx + 4, 83, 2, '#FFD23F') +
        E(cx, 52, 19, 18, '#5B8DEF') +
        E(cx, 32, 9, 2.5, '#7B2CBF', 2.4) + P(`M${cx - 6} 32 Q${cx - 6} 22 ${cx} 22 Q${cx + 6} 22 ${cx + 6} 32 Z`, '#7B2CBF', 2.4) +
        eye(cx - 7, 50, 5, flip ? -0.2 : 0.2) + eye(cx + 7, 50, 5, flip ? -0.2 : 0.2) +
        P(`M${cx - 3} 57 L${cx + 3} 57 L${cx} 61 Z`, '#2EC47E', 2) +
        P(`M${cx - 6} 64 Q${cx - 3} 67 ${cx} 64 Q${cx + 3} 67 ${cx + 6} 64`, 'none', 2) +
        L(cx - 22, 58, cx - 12, 60, 1.6) + L(cx + 22, 58, cx + 12, 60, 1.6);
      return shadow(50, 38) + cat(71, true) + cat(29, false);
    },
    banana() {
      return shadow(56, 26) +
        P('M34 16 C14 38 18 72 52 86 C66 92 80 88 86 80 C62 78 46 64 43 44 C42 32 46 22 50 16 Z', '#FFD93D') +
        P('M36 24 C26 42 28 64 48 78', 'none', 1.8) +
        P('M84 80 L90 78 L88 84 Z', '#7A4E1D', 2.2) +
        E(42, 16, 13, 3.4, '#231F33', 2.2) + P('M35 16 L36 5 Q42 2 48 5 L49 16 Z', '#2B2640', 2.2) + L(36, 12, 48, 12, 2, '#E63946') +
        eye(29, 44, 5.5, 0.35, 0.1) + eye(39, 42, 5.5, 0.35, 0.1) +
        P('M26 36 L32 38 M36 35 L42 36', 'none', 2) +
        P('M30 56 Q36 62 42 56', 'none', 2.6) +
        P('M22 60 Q20 50 24 46', 'none', 0);
    },
    cheerleader() {
      let fur = '';
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 * i) / 18;
        const r1 = 24, r2 = 29;
        fur += `L${(50 + (i % 2 ? r1 : r2) * Math.cos(a)).toFixed(1)} ${(54 + (i % 2 ? r1 : r2) * Math.sin(a)).toFixed(1)}`;
      }
      const pom = (x, y) => {
        let s = '';
        for (let i = 0; i < 10; i++) {
          const a = (Math.PI * 2 * i) / 10;
          s += C((x + 7 * Math.cos(a)).toFixed(1), (y + 7 * Math.sin(a)).toFixed(1), 5.5, '#9D4EDD', 2);
        }
        return s + C(x, y, 7, '#B77CF0', 0);
      };
      return shadow(50, 28) +
        E(38, 86, 9, 5, '#fff', 2.6) + E(62, 86, 9, 5, '#fff', 2.6) +
        pom(14, 44) + pom(86, 44) +
        P('M' + fur.slice(1) + 'Z', '#F0483E') +
        eye(42, 42, 6.5, 0, -0.35) + eye(58, 42, 6.5, 0, -0.35) +
        E(50, 56, 11, 8.5, '#7B2CBF') + dot(46, 53, 2.2, '#B77CF0') +
        P('M36 64 Q50 80 64 64 Q50 70 36 64 Z', '#5A1A2E', 2.4) + R(44, 65, 12, 4, 1, '#fff', 0);
    },
    dicemonger() {
      return shadow(48, 26) +
        P('M26 88 Q22 56 48 50 Q74 54 72 88 Z', '#D62839') + L(48, 56, 48, 88, 2) + C(42, 66, 2, '#FFD23F', 1.5) + C(42, 76, 2, '#FFD23F', 1.5) +
        E(48, 42, 20, 17, '#8E6CEF') +
        P('M34 30 L38 12 L58 12 L62 30 Z', '#D62828') + L(48, 12, 60, 8, 2) + C(61, 8, 2.8, '#FFD23F', 2) +
        R(31, 36, 15, 9, 4, INK, 0) + R(50, 36, 15, 9, 4, INK, 0) + L(44, 39, 52, 39, 2.4) +
        L(34, 38, 39, 38, 1.5, '#8E8AA8') + L(53, 38, 58, 38, 1.5, '#8E8AA8') +
        P('M40 51 Q50 57 58 49', 'none', 2.6) + L(56, 50, 57, 53, 2) +
        `<g transform="translate(60 50) rotate(-14) scale(.3)">${dieInner(5)}</g>` +
        C(64, 72, 6, '#8E6CEF', 2.6);
    },
    duelist() {
      return shadow(46, 26) +
        L(66, 64, 94, 16, 3) + L(62, 58, 72, 70, 3.5) + C(66, 64, 3.5, '#FFD23F', 2) +
        P('M28 88 Q24 58 46 54 Q66 56 64 88 Z', '#3D5A98') + C(46, 66, 2, '#E63946', 1.6) + C(46, 76, 2, '#E63946', 1.6) +
        P('M36 54 Q46 62 56 54 Q52 50 46 52 Q40 50 36 54 Z', '#fff', 2.2) +
        E(46, 42, 17, 15, '#6ECFF6') +
        E(42, 26, 24, 5.5, '#3D5A98') + P('M28 26 Q30 8 46 10 Q58 12 58 26 Z', '#3D5A98') +
        P('M54 14 Q72 2 84 12 Q72 12 62 20 Z', '#fff', 2.2) +
        eye(40, 38, 5, -0.2) + eye(52, 38, 5, -0.2) +
        C(34, 46, 5, '#E63946', 2.4) +
        P('M36 52 Q30 50 28 46 M42 52 Q48 52 50 48', 'none', 2.2) +
        C(66, 64, 5.5, '#6ECFF6', 2.6);
    },
    genius() {
      return shadow(48, 26) +
        P('M28 88 Q24 64 48 62 Q72 64 68 88 Z', '#E63946') + P('M40 64 L48 72 L56 64', 'none', 2.2) + P('M44 66 L48 69 L52 66 L52 72 L44 72 Z', '#4CC9F0', 2) +
        P('M22 40 L18 26 L28 30 L28 14 L38 24 L44 8 L50 22 L60 10 L62 26 L74 18 L70 32 L80 34 L72 42 Z', '#3A86FF') +
        C(48, 44, 22, '#FF6FAE') +
        C(39, 40, 8, '#fff', 3.4) + C(57, 40, 8, '#fff', 3.4) + L(46, 39, 50, 39, 3) +
        `<circle cx="39" cy="40" r="8" fill="none" stroke="#7B2CBF" stroke-width="2.4"/><circle cx="57" cy="40" r="8" fill="none" stroke="#7B2CBF" stroke-width="2.4"/>` +
        dot(40, 41, 3.6) + dot(58, 41, 3.6) +
        teethGrin(48, 51, 13, 8) +
        R(66, 60, 20, 26, 3, '#C9CED9', 2.6) + R(69, 63, 14, 7, 1, '#B8F2A8', 2) +
        dot(71, 75, 1.8) + dot(76, 75, 1.8) + dot(81, 75, 1.8) + dot(71, 81, 1.8) + dot(76, 81, 1.8) + dot(81, 81, 1.8) +
        C(64, 70, 5.5, '#FF6FAE', 2.6);
    },
    heckler() {
      return shadow(52, 28) +
        P('M26 34 L10 6 L40 24 Z', '#FF4FA3') + P('M22 28 L14 12 L32 24 Z', '#C9184A', 0) +
        P('M74 34 L90 6 L60 24 Z', '#FF4FA3') + P('M78 28 L86 12 L68 24 Z', '#C9184A', 0) +
        P('M34 88 Q30 60 52 58 Q76 60 72 88 Z', '#FF4FA3') +
        C(50, 44, 24, '#FF4FA3') +
        dot(34, 36, 3, '#9E1F63') + dot(66, 30, 2.6, '#9E1F63') + dot(70, 52, 3.4, '#9E1F63') + dot(46, 76, 3, '#9E1F63') + dot(62, 80, 2.4, '#9E1F63') +
        P('M68 16 Q72 8 78 14', '#FFD23F', 2) +
        eye(42, 38, 6, -0.4, 0.2) + eye(58, 38, 6, -0.4, 0.2) +
        P('M36 32 L46 34 M64 32 L54 34', 'none', 2.4) +
        C(50, 46, 4.5, '#E63946', 2.4) +
        P('M34 52 Q50 70 66 52 Q50 58 34 52 Z', '#5A1A2E', 2.4) +
        P('M39 54 L42 60 L45 55 M55 55 L58 60 L61 54', '#fff', 1.6) +
        TL('M34 66 L12 60', '#FF4FA3', 6) + TL('M12 60 L4 58', '#FF4FA3', 3.5);
    },
    egg() {
      return shadow(50, 26) +
        P('M22 58 Q22 88 50 88 Q78 88 78 58 L72 62 L66 57 L60 62 L54 57 L48 62 L42 57 L36 62 L30 57 Z', '#F7801E') +
        dot(34, 74, 3, '#FFB36B') + dot(62, 78, 4, '#FFB36B') +
        E(50, 50, 21, 13, '#8FB8FF') +
        spiralEye(41, 48, 6.5) + spiralEye(59, 48, 6.5) +
        C(50, 56, 4, '#E63946', 2.2) +
        P('M20 36 Q22 8 50 8 Q78 10 80 34 L73 30 L67 36 L60 30 L53 36 L46 30 L39 36 L32 30 L26 36 Z', '#F7801E') +
        eye(40, 22, 5.5, 0.1, 0.25) + eye(58, 22, 5.5, 0.1, 0.25) +
        dot(66, 14, 3, '#FFB36B');
    },
    gunk() {
      return shadow(50, 32) +
        E(50, 86, 36, 6, '#6A9E1F', 2.6) +
        P('M22 84 C16 70 24 62 30 52 C34 36 38 20 52 20 C68 20 70 36 72 50 C80 60 86 72 80 84 Q74 78 70 86 Q64 80 58 86 Q52 78 46 86 Q40 80 34 86 Q28 78 22 84 Z', '#8AC926') +
        P('M40 30 Q46 24 52 26', 'none', 2) + dot(64, 62, 2.5, '#C6F07A') + dot(34, 68, 3, '#C6F07A') +
        eye(44, 42, 7.5, 0.1, 0.3) + eye(60, 45, 5.5, -0.2, 0.3) +
        openMouth(52, 58, 10, 6) +
        P('M26 62 Q24 70 28 74', 'none', 2);
    },
    hugebaby() {
      return shadow(50, 34) +
        E(50, 74, 32, 17, '#F6A5C8') +
        P('M24 80 Q50 96 76 80 Q72 70 50 72 Q28 70 24 80 Z', '#fff', 2.6) + L(62, 78, 64, 82, 2) +
        C(18, 66, 6, '#F6A5C8', 2.6) + C(82, 66, 6, '#F6A5C8', 2.6) +
        C(24, 36, 6, '#F6A5C8', 2.6) + C(76, 36, 6, '#F6A5C8', 2.6) +
        C(50, 38, 26, '#F6A5C8') +
        P('M48 12 Q44 4 52 6 Q58 8 54 14', 'none', 2.4) +
        dot(40, 34, 3.2) + dot(60, 34, 3.2) + dot(39, 33, 1, '#fff') + dot(59, 33, 1, '#fff') +
        E(34, 42, 5, 3, '#FF8FB8', 0) + E(66, 42, 5, 3, '#FF8FB8', 0) +
        E(50, 49, 10, 6, '#E63946', 2.6) + C(50, 50, 4.5, '#4CC9F0', 2.4) + C(50, 55, 3, 'none', 2);
    },
    flipflop() {
      return shadow(48, 30) +
        E(48, 86, 34, 6, '#90DBF4', 2.4) + P('M20 88 Q32 84 44 88 M54 88 Q66 84 78 88', 'none', 1.8) +
        L(50, 40, 38, 16, 3) + L(52, 38, 52, 10, 3) + L(56, 40, 68, 16, 3) +
        C(50, 62, 25, '#A77CE0') +
        P('M62 50 Q72 56 70 66', 'none', 2) + P('M34 74 Q42 80 52 78', 'none', 2) +
        eye(36, 14, 6.5, 0, 0.2) + eye(52, 9, 6.5, 0.2, 0.2) + eye(68, 14, 6.5, 0.3, 0.2) +
        P('M36 58 L6 80 L10 82 L40 68 Z', '#F9C80E') + L(10, 80, 38, 63, 1.6) +
        dot(40, 54, 2.2);
    },
    hare() {
      return shadow(52, 26) +
        L(8, 58, 20, 58, 2.4) + L(6, 68, 22, 68, 2.4) + L(10, 78, 24, 78, 2.4) +
        E(40, 20, 7, 18, '#8ECAE6', 3, -12) + E(40, 22, 3.2, 12, '#FFB3C6', 0, -12) +
        E(62, 18, 7, 18, '#8ECAE6', 3, 14) + E(62, 20, 3.2, 12, '#FFB3C6', 0, 14) +
        E(54, 70, 22, 18, '#8ECAE6') + E(54, 74, 12, 11, '#E3F4FB', 2.2) +
        E(38, 86, 9, 5, '#8ECAE6', 2.6) + E(68, 86, 9, 5, '#8ECAE6', 2.6) +
        C(52, 44, 19, '#8ECAE6') +
        eye(44, 40, 6, 0.3, 0.1) + eye(60, 40, 6, 0.3, 0.1) +
        C(54, 49, 4.5, '#E63946', 2.4) +
        P('M46 53 Q54 58 62 53', 'none', 2.2) + R(49, 54, 10, 8, 1.5, '#fff', 2.2) + L(54, 55, 54, 61, 1.6);
    },
    hypnotist() {
      const body = 'M22 86 C6 80 10 64 30 64 C54 64 74 74 74 58 C74 48 62 46 54 46';
      return shadow(46, 30) +
        `<path d="${body}" fill="none" stroke="${INK}" stroke-width="19" stroke-linecap="round"/>` +
        `<path d="${body}" fill="none" stroke="#2EC4B6" stroke-width="13" stroke-linecap="round"/>` +
        `<path d="${body}" fill="none" stroke="#3A5BD9" stroke-width="13" stroke-dasharray="7 9" stroke-linecap="butt"/>` +
        P('M50 50 Q20 48 22 26 Q28 8 50 10 Q72 8 78 26 Q80 48 50 50 Z', '#2EC4B6') +
        P('M50 50 Q32 46 32 28 Q34 16 50 16 Q66 16 68 28 Q68 46 50 50 Z', '#3A5BD9') +
        P('M34 24 Q50 14 66 24', 'none', 2) +
        spiralEye(42, 28, 7) + spiralEye(58, 28, 7) +
        P('M37 38 Q50 46 63 38', 'none', 2.4) + P('M43 40 L44 45 M57 40 L56 45', '#fff', 1.6) +
        P('M50 46 L50 54 L46 60 M50 54 L54 60', 'none', 2.4) + `<path d="M50 46 L50 54 L46 60 M50 54 L54 60" fill="none" stroke="#E63946" stroke-width="1.6" stroke-linecap="round"/>` +
        L(84, 4, 84, 20, 2) + C(84, 4, 2, '#FFD23F', 1.6) +
        C(84, 28, 9, '#FFD23F') + C(84, 28, 5.5, '#fff', 1.8) + P('M84 28 L84 24 M84 28 L87 29', 'none', 1.6) + R(82, 17, 4, 4, 1, '#FFD23F', 1.6) +
        P('M70 50 Q74 54 82 52 M94 36 Q96 44 92 50', 'none', 1.4);
    },
    inchworm() {
      const seg = [[14, 80], [22, 70], [30, 60], [40, 52], [51, 50], [61, 56], [69, 66]];
      let s = '';
      seg.forEach(([x, y], i) => { s += C(x, y, 11, i % 2 ? '#4895EF' : '#7B4FD1'); });
      return shadow(46, 34) +
        seg.map(([x]) => L(x, 86, x, 89, 3)).filter((_, i) => i === 0 || i === 6).join('') +
        s +
        P('M78 58 Q76 50 82 52 Q80 44 86 48 Q88 42 92 48', '#80B918', 2.2) +
        C(80, 72, 13, '#7B4FD1') +
        eye(76, 68, 5, 0.3, 0) + eye(87, 68, 5, 0.3, 0) +
        smile(82, 78, 5, 2.5) +
        L(14, 88, 14, 91, 3) + L(80, 85, 80, 90, 3);
    },
    legs() {
      const leg = (d) => TL(d, '#3BB273', 8) + `<path d="${d}" fill="none" stroke="#1E7F4F" stroke-width="8" stroke-dasharray="3 6"/>`;
      return shadow(50, 36) +
        leg('M45 54 L22 82') + leg('M55 54 L78 82') +
        E(17, 86, 10, 5, '#E63946', 2.6) + E(83, 86, 10, 5, '#E63946', 2.6) +
        TL('M37 38 Q27 44 25 55', '#F4F1FF', 4) + TL('M63 38 Q73 44 75 55', '#F4F1FF', 4) +
        C(25, 58, 4.2, '#FFD23F', 2.4) + C(75, 58, 4.2, '#FFD23F', 2.4) +
        P('M35 34 Q50 28 65 34 L62 57 Q50 61 38 57 Z', '#F4F1FF') +
        P('M44 44 L56 44 M43 50 L57 50', 'none', 1.6) +
        E(50, 19, 15, 13, '#FFD23F') +
        P('M45 7 Q49 1 53 7 M50 6 Q56 2 58 8', 'none', 2.2) +
        eye(44, 16, 5, 0.1, 0.1) + eye(56, 16, 5, 0.1, 0.1) +
        teethGrin(50, 23, 7, 5) +
        P('M50 33 L40 27 L40 39 Z M50 33 L60 27 L60 39 Z', '#E63946', 2.2) + C(50, 33, 2.8, '#E63946', 2);
    },
    mastermind() {
      return shadow(50, 30) +
        P('M14 88 Q14 54 50 50 Q86 54 86 88 Z', '#2D6A4F') + P('M50 54 L50 88', 'none', 2) + P('M30 66 Q34 76 30 86 M70 66 Q66 76 70 86', 'none', 1.6) +
        P('M22 54 Q16 14 50 10 Q84 14 78 54 Q64 46 50 48 Q36 46 22 54 Z', '#1F5A40') +
        E(50, 36, 18, 16, '#14221B', 2.6) +
        E(42, 36, 6, 5.5, '#FFE66D', 2) + E(58, 36, 6, 5.5, '#FFE66D', 2) + dot(43.5, 37, 2.8) + dot(59.5, 37, 2.8) +
        P('M33 28 L47 33 M67 28 L53 33', 'none', 3) +
        P('M50 38 L66 47 L52 48 Z', '#F6C39B', 2.4) +
        P('M40 52 Q50 58 60 52', 'none', 2.4) + P('M45 54 L46 58 L48 55 M52 55 L54 58 L56 54', '#fff', 1.4) +
        C(73, 66, 13, '#BDE0FE') + P('M64 62 Q66 56 73 55', 'none', 2.2) + star(73, 67, 6, '#FFD23F', 1.6) +
        P('M63 78 L83 78 L80 86 L66 86 Z', '#7A4E1D', 2.4) +
        C(58, 72, 5.4, '#F6C39B', 2.4);
    },
    lackey() {
      return shadow(50, 30) +
        P('M16 88 Q12 52 42 38 Q70 30 80 54 Q84 72 80 88 Z', '#C77DFF') +
        R(24, 60, 12, 12, 1.5, '#4CC9F0', 2.2) + P('M26 62 L34 70 M34 62 L26 70', 'none', 1.4) +
        P('M58 78 L66 74 M60 84 L70 80', 'none', 1.8) +
        P('M36 50 Q34 28 56 26 Q76 26 78 46', 'none', 3) +
        E(57, 47, 18, 16, '#80B918') +
        P('M68 44 Q90 46 94 62 Q80 62 68 56 Z', '#80B918') +
        eye(50, 41, 6, 0.4, -0.2) + eye(63, 39, 5.5, 0.4, -0.2) +
        P('M44 34 Q49 30 54 33', 'none', 2.2) +
        P('M45 52 Q57 70 71 55 Q58 61 45 52 Z', '#5A1A2E', 2.4) + R(54, 57, 4.5, 4, 1, '#fff', 1.2) +
        C(46, 74, 6, '#80B918', 2.6) + C(55, 75, 6, '#80B918', 2.6);
    },
    loser() {
      let sp = '';
      const turns = 3 * Math.PI;
      for (let t = 0; t <= turns; t += 0.3) {
        const rr = 20 * (1 - t / turns);
        sp += `${t === 0 ? 'M' : 'L'}${(40 + rr * Math.cos(t + Math.PI)).toFixed(1)} ${(56 + rr * Math.sin(t + Math.PI)).toFixed(1)}`;
      }
      return shadow(50, 36) +
        P('M12 86 Q10 78 20 78 L66 78 Q72 60 72 46 Q72 36 80 36 Q90 36 88 50 Q86 66 80 80 Q78 88 66 88 L18 88 Q12 88 12 86 Z', '#7CC65A') +
        L(76, 38, 72, 22, 2.6) + L(84, 38, 88, 22, 2.6) +
        eye(72, 22, 5, 0, 0.3) + eye(88, 22, 5, 0, 0.3) +
        P('M69 30 Q68 38 71 38 Q74 38 71 30 Z', '#4CC9F0', 1.6) +
        P('M76 56 Q80 52 84 56', 'none', 2.4) +
        C(40, 56, 23, '#FF5DA2') + `<path d="${sp}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` +
        L(64, 70, 58, 62, 2.2) +
        C(56, 60, 3, '#FFD23F', 1.6) + C(52, 57, 3, '#fff', 1.6) + C(56, 55, 3, '#fff', 1.6) + C(60, 57, 3, '#fff', 1.6) + C(56, 64, 3, '#fff', 1.6) + C(52, 62, 3, '#fff', 1.6) + C(60, 62, 3, '#fff', 1.6) + C(56, 60, 2.6, '#FFD23F', 1.4) +
        C(66, 72, 4.5, '#7CC65A', 2.4);
    },
    mouth() {
      let teeth = '';
      for (let i = 0; i < 5; i++) teeth += R(30 + i * 8, 46, 8, 9, 1.5, '#fff', 2);
      for (let i = 0; i < 4; i++) teeth += R(34 + i * 8, 64, 8, 8, 1.5, '#fff', 2);
      return shadow(50, 34) +
        L(38, 80, 34, 88, 3.5) + L(62, 80, 66, 88, 3.5) + E(32, 89, 6, 3, '#4CC9F0', 2.2) + E(68, 89, 6, 3, '#4CC9F0', 2.2) +
        P('M10 56 Q14 34 34 38 Q42 32 50 38 Q58 32 66 38 Q86 34 90 56 Q86 84 50 82 Q14 84 10 56 Z', '#E63946') +
        P('M20 56 Q30 44 50 46 Q70 44 80 56 Q70 72 50 72 Q30 72 20 56 Z', '#5A1020', 2.6) +
        teeth +
        P('M18 46 Q24 42 30 44', 'none', 2) +
        eye(42, 24, 6.5, 0, 0.2) + eye(58, 24, 6.5, 0, 0.2) +
        TL('M12 60 L4 52', '#4CC9F0', 4) + TL('M88 60 L96 52', '#4CC9F0', 4);
    },
    leaptoad() {
      return shadow(46, 30) +
        TL('M40 70 Q26 78 12 88', '#4CC9F0', 7) + P('M8 84 L14 92 L4 92 Z', '#4CC9F0', 2.4) +
        TL('M58 70 Q66 82 56 90', '#4CC9F0', 7) +
        E(50, 58, 24, 17, '#4CC9F0', 3, -20) + E(52, 62, 13, 9, '#C9F2FF', 2.2, -20) +
        TL('M68 50 L86 40', '#4CC9F0', 5) + C(88, 38, 4, '#4CC9F0', 2.4) +
        C(44, 34, 13, '#fff') + C(68, 30, 13, '#fff') +
        dot(48, 36, 5.5) + dot(72, 32, 5.5) + dot(46, 34, 1.8, '#fff') + dot(70, 30, 1.8, '#fff') +
        `<g transform="rotate(-18 56 14)">` + E(56, 18, 16, 4, '#2B9348', 2.6) + P('M46 18 L48 2 L64 2 L66 18 Z', '#2B9348', 2.6) + L(47, 13, 65, 13, 2.4, '#FFD23F') + `</g>` +
        P('M36 52 Q54 62 72 46', 'none', 2.6);
    },
    magician() {
      return shadow(50, 32) +
        P('M30 88 Q28 66 50 64 Q72 66 70 88 Z', '#E63946') + P('M44 66 L50 72 L56 66', '#fff', 2) +
        E(22, 48, 14, 19, '#B388EB', 3, -12) + E(22, 49, 8, 12, '#E2CCFF', 0, -12) +
        E(78, 48, 14, 19, '#B388EB', 3, 12) + E(78, 49, 8, 12, '#E2CCFF', 0, 12) +
        C(50, 48, 20, '#B388EB') +
        P('M44 56 Q42 72 50 80 Q56 84 58 78 Q52 76 52 70 L54 56 Z', '#B388EB', 2.8) +
        eye(42, 44, 5, 0.1, 0.1) + eye(58, 44, 5, 0.1, 0.1) +
        P('M38 38 L46 40 M62 38 L54 40', 'none', 2) +
        E(50, 30, 22, 5, '#3A86FF') + R(38, 6, 24, 24, 3, '#3A86FF') + L(38, 24, 62, 24, 3, '#E63946') +
        L(72, 76, 93, 62, 4.5) + L(87, 66, 93, 62, 4.5, '#fff') +
        star(92, 52, 5, '#FFD23F', 1.6) + star(84, 88, 3.5, '#FFD23F', 1.4) +
        C(72, 76, 5, '#B388EB', 2.4);
    },
    partyanimal() {
      return shadow(50, 26) +
        TL('M34 70 L20 44', '#FFCB47', 6) + TL('M20 44 L18 34', '#FFCB47', 3) +
        TL('M66 70 L80 44', '#FFCB47', 6) + TL('M80 44 L82 34', '#FFCB47', 3) +
        P('M30 88 Q26 64 50 62 Q74 64 70 88 Z', '#FF4FA3') + P('M32 72 Q50 76 68 72 M30 82 Q50 86 70 82', 'none', 3) + `<path d="M32 72 Q50 76 68 72 M30 82 Q50 86 70 82" fill="none" stroke="#3BB273" stroke-width="2.4"/>` +
        C(34, 30, 7, '#FFCB47') + C(66, 30, 7, '#FFCB47') + C(34, 30, 3, '#E0A020', 0) + C(66, 30, 3, '#E0A020', 0) +
        C(50, 46, 19, '#FFCB47') +
        `<g transform="rotate(14 56 20)">` + P('M46 26 L56 2 L66 26 Z', '#9D4EDD') + P('M50 18 L62 18 M48 22 L64 22', 'none', 0) + `<path d="M52 14 L60 14 M49 21 L63 21" stroke="#3BB273" stroke-width="3"/>` + C(56, 2, 3, '#FFD23F', 2) + `</g>` +
        eye(43, 42, 5, 0, -0.2) + eye(57, 42, 5, 0, -0.2) +
        E(50, 52, 9, 7, '#FFE9A8', 2.4) + dot(50, 49, 2.6) +
        openMouth(50, 54, 6, 3.5);
    },
    rocket() {
      return shadow(50, 32) +
        P('M22 88 Q20 60 46 58 Q70 60 68 88 Z', '#F5F5F5') + L(45, 60, 45, 88, 2) + P('M38 60 L45 70 L52 60', 'none', 2.2) +
        P('M18 44 L14 30 L24 32 L22 16 L34 24 L40 10 L46 22 L56 12 L58 26 L70 22 L66 34 L76 40 L66 46 Z', '#FFB703') +
        E(44, 44, 16, 15, '#F6C39B') +
        R(28, 34, 32, 11, 5.5, '#3A86FF', 2.6) + C(37, 39.5, 5, '#BDE0FE', 2.2) + C(51, 39.5, 5, '#BDE0FE', 2.2) + dot(38, 40, 2) + dot(52, 40, 2) +
        E(44, 53, 5, 4, '#5A1A2E', 2.4) +
        P('M70 88 Q60 90 62 80 Q54 80 58 72 Q66 70 70 76 Z', '#E9E4F2', 2) +
        P('M70 84 L70 48 Q78 32 86 48 L86 84 Z', '#E63946') + C(78, 56, 4, '#BDE0FE', 2.2) +
        P('M70 70 L62 82 L70 82 Z M86 70 L94 82 L86 82 Z', '#FFD23F', 2.2) + P('M72 84 L76 92 L80 86 L84 92 L84 84 Z', '#FF9F1C', 2) +
        C(66, 64, 5.5, '#F6C39B', 2.6);
    },
    sisyphus() {
      return shadow(56, 36) +
        C(66, 50, 29, '#A6A6B2') + P('M54 32 L62 44 L58 52 M76 60 L84 66 M70 30 L74 38', 'none', 2.2) + dot(78, 42, 3, '#8A8A96') + dot(56, 66, 4, '#8A8A96') +
        TL('M30 72 L22 88', '#F4A259', 5) + TL('M38 72 L40 88', '#F4A259', 5) +
        P('M20 76 Q18 54 32 50 Q44 52 44 76 Z', '#fff') + P('M26 56 L40 74', 'none', 1.8) +
        TL('M36 58 L44 50', '#F4A259', 5) + TL('M34 66 L42 62', '#F4A259', 5) +
        C(28, 38, 12, '#F4A259') +
        eye(26, 36, 4.5, 0.3, -0.2) + eye(35, 35, 4.5, 0.3, -0.2) +
        P('M22 30 L28 32 M32 30 L38 30', 'none', 2) +
        E(31, 44, 3.5, 2.5, '#5A1A2E', 2) +
        P('M16 28 Q14 34 17 34 Q20 34 16 28 Z', '#4CC9F0', 1.6) + P('M18 42 Q16 46 18 46 Q21 46 18 42 Z', '#4CC9F0', 1.4);
    },
    suckerfish() {
      return shadow(50, 32) +
        P('M76 52 L94 34 L92 54 L94 74 Z', '#E63946') +
        E(48, 54, 32, 22, '#52C88A') +
        P('M40 34 Q52 22 64 34', '#3E9E6C', 2.4) +
        P('M54 60 Q60 72 70 66 Q64 60 54 60 Z', '#3E9E6C', 2.2) +
        P('M58 44 Q62 54 58 64 M66 44 Q70 54 66 64', 'none', 1.6) +
        E(18, 58, 7, 9, '#E63946') + L(12, 58, 24, 58, 2) +
        eye(30, 46, 8, -0.3, 0.1) +
        E(42, 32, 13, 3.5, '#E63946', 2.4) + P('M32 32 Q34 20 44 20 Q52 22 52 32 Z', '#E63946', 2.4) + L(40, 22, 50, 26, 1.6, '#fff');
    },
    romantic() {
      let teeth = '';
      for (let i = 0; i < 5; i++) teeth += P(`M${50 + i * 7} 42 L${53.5 + i * 7} 47 L${57 + i * 7} 42 Z`, '#fff', 1.6);
      return shadow(46, 30) +
        P('M22 88 Q20 60 44 58 Q68 60 66 88 Z', '#FFD23F') + P('M34 60 L44 70 L54 60 Z', '#E63946', 2.4) + dot(56, 76, 2.5, '#E63946') +
        P('M24 42 Q24 24 42 24 L84 30 Q94 34 90 42 Q84 48 60 48 Q42 58 30 54 Q22 50 24 42 Z', '#FF7EB9') +
        teeth + L(46, 42, 88, 40, 2) +
        dot(86, 34, 1.8) +
        C(34, 24, 9, '#FF7EB9') + C(50, 22, 9, '#FF7EB9') +
        heart(34, 24, 7.5) + heart(50, 22, 7.5) +
        P('M26 74 L44 70 L44 86 L26 88 Z', '#fff', 2.4) + P('M44 70 L62 74 L62 88 L44 86 Z', '#fff', 2.4) + heart(53, 79, 4) + L(30, 76, 40, 75, 1.4) + L(30, 80, 40, 79, 1.4) +
        C(24, 80, 5, '#FF7EB9', 2.4) + C(64, 80, 5, '#FF7EB9', 2.4);
    },
    skipper() {
      let spokes = '';
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        spokes += L(50 + 8 * Math.cos(a), 74 + 8 * Math.sin(a), 50 + 23 * Math.cos(a), 74 + 23 * Math.sin(a), 4) + C((50 + 23 * Math.cos(a)).toFixed(1), (74 + 23 * Math.sin(a)).toFixed(1), 3, '#B07D4F', 2);
      }
      return shadow(50, 30) +
        P('M26 72 Q24 54 50 52 Q76 54 74 72 Z', '#FFD166') +
        spokes + C(50, 74, 17, 'none', 5) + `<circle cx="50" cy="74" r="17" fill="none" stroke="#B07D4F" stroke-width="2.5"/>` + C(50, 74, 6, '#B07D4F', 2.6) +
        C(46, 38, 17, '#F4845F') +
        P('M22 34 Q24 12 48 12 Q70 12 72 30 Q84 30 86 38 Q70 38 60 30 Q50 26 30 34 Z', '#FFD166') +
        eye(37, 35, 4.8, 0.3, 0) + eye(49, 34, 4.8, 0.3, 0) +
        E(58, 45, 10, 7.5, '#F25C54') + dot(55, 42, 2, '#FFB4A2') +
        P('M40 49 Q46 52 50 50', 'none', 2.4) +
        L(42, 51, 26, 57, 3.2) + R(18, 50, 9, 10, 2.5, '#7A4E1D', 2.4) + P('M20 46 Q18 42 22 40 M25 45 Q27 41 24 38', 'none', 1.6);
    },
    thirdwheel() {
      let sp = '';
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; sp += L(50, 78, 50 + 11 * Math.cos(a), 78 + 11 * Math.sin(a), 1.6); }
      return shadow(50, 22) +
        C(50, 78, 13, '#fff') + sp + C(50, 78, 13, 'none', 4) + C(50, 78, 3, INK, 0) +
        L(50, 62, 50, 76, 3.5) + R(42, 58, 16, 5, 2.5, INK, 0) +
        TL('M40 56 L44 70', '#FFE66D', 4) + TL('M60 56 L56 70', '#FFE66D', 4) +
        TL('M38 46 L16 30', '#FFE66D', 5) + TL('M62 46 L84 28', '#FFE66D', 5) +
        E(50, 50, 16, 12, '#FF4F79') +
        `<path d="M36 46 Q50 50 64 46 M35 53 Q50 57 65 53" stroke="#fff" stroke-width="3" fill="none"/>` + E(50, 50, 16, 12, 'none') +
        C(50, 28, 15, '#FFE66D') +
        P('M35 24 Q50 8 65 24 L64 28 Q50 20 36 28 Z', '#F9C80E', 2.6) + P('M64 25 L78 18 L76 30 Z', '#F9C80E', 2.2) +
        eye(44, 30, 4.8, 0.2, 0.1) + eye(56, 30, 4.8, 0.2, 0.1) +
        smile(50, 36, 5, 2.4);
    },
    scoocher() {
      let fur = 'M20 84 Q14 60 30 46 Q38 40 50 40 Q66 40 72 50 Q82 62 80 84 ';
      fur += 'L74 80 L70 86 L64 81 L58 87 L52 81 L46 87 L40 81 L34 87 L28 81 Z';
      return shadow(50, 32) +
        P(fur, '#A9713C') +
        P('M36 60 Q40 66 36 72 M60 62 Q64 68 60 74', 'none', 1.8) +
        C(50, 36, 18, '#A9713C') +
        P('M34 30 Q18 32 16 52 Q16 62 24 60 Q30 48 36 40 Z', '#7A4E26') +
        P('M66 30 Q82 32 84 52 Q84 62 76 60 Q70 48 64 40 Z', '#7A4E26') +
        sleepy(43, 32, 5.5) + sleepy(57, 32, 5.5) +
        E(50, 42, 5, 3.5, '#5A2A1A', 2.2) +
        P('M46 48 Q50 64 56 58 Q58 50 54 46 Z', '#FF4F6D', 2.4) + L(51, 49, 52, 56, 1.4);
    },
    stickler() {
      return shadow(50, 32) +
        E(50, 78, 32, 11, '#FF8FCB') + P('M26 76 Q50 84 74 76', 'none', 1.6) +
        E(50, 64, 27, 10, '#FF8FCB') + P('M30 62 Q50 70 70 62', 'none', 1.6) +
        E(50, 51, 22, 9, '#FF8FCB') +
        C(50, 32, 16, '#FF8FCB') +
        P('M36 22 Q42 16 48 22 M52 22 Q58 16 64 22', 'none', 2.4) +
        C(43, 31, 5.5, '#fff', 2.2) + C(57, 31, 5.5, '#fff', 2.2) + L(48, 31, 52, 31, 2.2) +
        `<circle cx="43" cy="31" r="5.5" fill="none" stroke="#3A86FF" stroke-width="1.6"/><circle cx="57" cy="31" r="5.5" fill="none" stroke="#3A86FF" stroke-width="1.6"/>` +
        dot(43, 32, 2.4) + dot(57, 32, 2.4) +
        E(50, 41, 4, 3, '#5A1A2E', 2.2) +
        P('M62 52 L80 46 L84 60 L66 66 Z', '#E63946', 2.6) + L(65, 55, 79, 50, 1.6, '#fff') +
        C(62, 56, 5, '#FF8FCB', 2.4) + TL('M32 50 L26 40', '#FF8FCB', 4) + C(25, 38, 3.5, '#FF8FCB', 2);
    },
    twin() {
      const frog = (cx, patch) =>
        P(`M${cx - 16} 88 Q${cx - 18} 62 ${cx} 60 Q${cx + 18} 62 ${cx + 16} 88 Z`, patch ? '#fff' : '#FF4F79') +
        (patch ? `<path d="M${cx - 15} 70 L${cx + 15} 70 M${cx - 16} 78 L${cx + 16} 78 M${cx - 16} 86 L${cx + 16} 86" stroke="${INK}" stroke-width="3.5"/>` : '') +
        E(cx, 48, 18, 15, '#A7C957') +
        C(cx - 8, 34, 7, '#A7C957') + C(cx + 8, 34, 7, '#A7C957') +
        (patch
          ? eye(cx + 8, 34, 5, patch ? 0.3 : -0.3) + C(cx - 8, 34, 5.5, INK, 0) + L(cx - 18, 26, cx + 2, 40, 2)
          : eye(cx - 8, 34, 5, -0.3) + eye(cx + 8, 34, 5, -0.3) + P(`M${cx + 3} 25 Q${cx + 8} 20 ${cx + 13} 24`, 'none', 2.2)) +
        P(`M${cx - 11} 50 Q${cx} 60 ${cx + 11} 50 Z`, '#5A1A2E', 2.4) + R(cx - 5, 50, 4, 4, 1, '#fff', 1.2) + R(cx + 1, 50, 4, 4, 1, '#fff', 1.2);
      return shadow(50, 38) + frog(70, false) + frog(30, true);
    },
  };

  function unknown() {
    return shadow(50, 22) + E(50, 58, 20, 26, '#C9C3D9') + eye(43, 48, 5) + eye(57, 48, 5) +
      P('M42 22 Q42 12 50 12 Q58 12 58 20 Q58 26 50 28 L50 32', 'none', 3.4) + dot(50, 38, 2.4) + smile(50, 64, 6, 2);
  }

  // 一代 36 名有 APK 原画 PNG（public/img/racers/<id>.png，256×256 透明底）；页面加 ?art=svg 可切回自绘 SVG
  const PHOTO = new Set('alchemist blimp coach babayaga centaur copycat banana cheerleader dicemonger duelist genius heckler egg gunk hugebaby flipflop hare hypnotist inchworm legs mastermind lackey loser mouth leaptoad magician partyanimal rocket sisyphus suckerfish romantic skipper thirdwheel scoocher stickler twin'.split(' '));
  const usePhoto = !(typeof location !== 'undefined' && /[?&]art=svg\b/.test(location.search));
  function racer(id) {
    if (usePhoto && PHOTO.has(id)) return wrap(`<image href="img/racers/${id}.png" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/>`, 'racer-svg racer-photo');
    const f = DRAW[id];
    uid++; sn = 0;
    return wrap(f ? f() : unknown());
  }
  function color(id) { return COLORS[id] || '#C9C3D9'; }

  /* ---------- 线性图标 24x24 ---------- */
  const IC = {
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 20h8M9.5 17h5v3h-5z"/>',
    medal: '<path d="M8 3l2.5 6M16 3l-2.5 6"/><circle cx="12" cy="15" r="5.5"/><path d="M12 12.5v5M10.8 13.5l1.2-1"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    rock: '<path d="M3.5 18.5l2-6 4-4.5 5 1 4 3.5 2 6z"/><path d="M9.5 8l1 4 4 1.5M3.5 18.5h17"/>',
    arrowR: '<path d="M4 12h15M13 6l6 6-6 6"/>',
    arrowL: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    music: '<path d="M9 17.5V5.5l10-2v12"/><path d="M9 9.5l10-2"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
    bolt: '<path d="M13.5 3L5.5 13.5H12L10.5 21l8-10.5H12z"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4.5M9.5 13h.01M14.5 13h.01M9.5 16.2h5M3 12.5v3M21 12.5v3"/><circle cx="12" cy="4" r="1"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.2a6 6 0 0 1 3.5 5.3"/>',
    play: '<path d="M7.5 4.5v15l12-7.5z"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    door: '<path d="M5 20.5h14M7 20.5V4.5h8.5v16"/><path d="M15.5 6.5l3.5 1.5v12.5M12.5 12.5h.01"/>',
    book: '<path d="M4 5.5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2z"/><path d="M4 19.5a2 2 0 0 0 2 2h13v-4M8 7.5h7"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    crown: '<path d="M3.5 8l4.2 4.5L12 5l4.3 7.5L20.5 8l-1.8 10H5.3z"/><path d="M5.5 21h13"/>',
    flag: '<path d="M5 21V4M5 4.5h11l-2 4 2 4H5"/>',
    swirl: '<path d="M12 12.5a1.5 1.5 0 1 1 1.5-1.5 3 3 0 0 1-3 3 4.5 4.5 0 0 1-4.5-4.5A6 6 0 0 1 12 3.5a7.5 7.5 0 0 1 7.5 7.5A9 9 0 0 1 10.5 20"/>',
    chomp: '<path d="M20 7.5A9 9 0 1 0 20 16.5L12 12z"/><circle cx="11.5" cy="7.5" r="1" fill="currentColor"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>',
    chat: '<path d="M4.5 6.5a2.5 2.5 0 0 1 2.5-2.5h10a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4H7a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M9 9.5h6M9 12.5h3.5"/>',
    map: '<path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  };
  function icon(name, cls = 'icon') {
    const body = IC[name] || IC.star;
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="${cls}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  // 扩展钩子：art2.js 等通过 register 追加运动员画法与主色，kit 暴露同一套基础图元
  const ids = Object.keys(DRAW);
  function register(id, fn, col) {
    if (!DRAW[id]) ids.push(id);
    DRAW[id] = fn;
    if (col) COLORS[id] = col;
  }
  const kit = Object.assign({}, KIT, { dieInner, hand: HAND });
  return { racer, color, die, icon, ids, INK, register, kit };
});
