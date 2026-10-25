// 胡闹运动会 · 二代 36 名运动员手绘矢量头像（全部原创 SVG，无 emoji）
// 加载在 art.js 之后：复用 Art.kit 的同一套墨线图元，经 Art.register 并入 Art.racer / Art.color
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./art.js'));
  else factory(root.Art);
})(typeof self !== 'undefined' ? self : this, function (Art) {
  if (!Art || !Art.register) return Art;
  const { INK, SKIN, L, dot, eye, lid, spiralEye, smile, openMouth, teethGrin, dieInner } = Art.kit;

  /* ---------- 手绘质感层 ----------
     与一代共用墨线语言，但在此基础上给每个够大的色块叠：
       1) 下右偏移的加粗墨边（像套印错位，线条粗细不均）；
       2) 2~3 层色阶：本色 + 同色相偏冷的阴影月牙（深色块反过来给上左亮边）；
       3) 极淡的纸纹颗粒（按 clipPath 限制在色块内，28px 小图上不可见）；
       4) 深底角色外圈一道奶油色「贴纸边」，保证小图剪影；脚下两层地面阴影。
     所有图元都是纯 SVG 矢量，无位图、无 filter。 */
  let cid = 0;
  let cur = null; // 当前正在绘制的角色上下文：{ rim, defs, ground, rimBuf }
  const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const rgb = (h) => { let s = h.slice(1); if (s.length === 3) s = s.replace(/./g, (c) => c + c); return [0, 2, 4].map((i) => parseInt(s.substr(i, 2), 16)); };
  const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lum = (h) => { const [r, gg, b] = rgb(h); return (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255; };
  const shadeOf = (f) => mix(f, '#4B2A6E', lum(f) > 0.6 ? 0.2 : 0.27);
  const RIM = '#FFF6DF';
  const grainId = (dark) => {
    const k = dark ? 'gd' : 'gl';
    if (!cur[k]) {
      cur[k] = `g${++cid}`;
      const c = dark ? '#fff' : INK;
      cur.defs += `<pattern id="${cur[k]}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.5" r=".5" fill="${c}" opacity=".2"/><circle cx="4.6" cy="3.1" r=".4" fill="${c}" opacity=".18"/><circle cx="2.7" cy="5.8" r=".45" fill="${c}" opacity=".2"/><circle cx="6.1" cy="6.3" r=".35" fill="${c}" opacity=".16"/></pattern>`;
    }
    return cur[k];
  };
  // 通用上色块：tag/属性串/填充/线宽/包围盒尺寸/元素自带 transform
  const shape = (tag, a, f, w, bw, bh, tf = '') => {
    const m = Math.min(bw, bh);
    const ta = tf ? ` transform="${tf}"` : '';
    const el = (extra) => `<${tag} ${a}${ta} ${extra}/>`;
    if (w === 0) return el(`fill="${f}"`);
    const sw = w == null ? (m >= 26 ? 3.4 : 3) : w;
    const stroke = `stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"`;
    if (cur && cur.rim && m >= 7) cur.rimBuf += el(`fill="${RIM}" stroke="${RIM}" stroke-width="${sw + 5}" stroke-linejoin="round"`);
    if (!HEX.test(f) || f.toUpperCase() === INK || m < 10) return el(`fill="${f}" ${stroke}`);
    let out = '';
    if (m >= 14) out += `<g transform="translate(.7 1.1)">${el(`fill="${INK}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"`)}</g>`;
    const id = `k${++cid}`;
    const dark = lum(f) < 0.13;
    const d = Math.max(1.8, Math.min(5, m * 0.13)) * (dark ? 0.8 : 1);
    const sg = dark ? 1 : -1;
    const base = dark ? mix(f, '#A9B4F0', 0.4) : shadeOf(f);
    const grain = m >= 22 ? `<rect width="100" height="100" fill="url(#${grainId(dark)})"/>` : '';
    return out + `<clipPath id="${id}"><${tag} ${a}${ta}/></clipPath><g clip-path="url(#${id})">${el(`fill="${base}"`)}<g transform="translate(${(sg * d * 0.8).toFixed(1)} ${(sg * d).toFixed(1)})">${el(`fill="${f}"`)}</g>${grain}</g>` + el(`fill="none" ${stroke}`);
  };
  const rotT = (x, y, rot) => (rot ? `rotate(${rot} ${x} ${y})` : '');
  const C = (x, y, r, f, w) => shape('circle', `cx="${x}" cy="${y}" r="${r}"`, f, w, 2 * r, 2 * r);
  const E = (x, y, rx, ry, f, w, rot) => shape('ellipse', `cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"`, f, w, 2 * rx, 2 * ry, rotT(x, y, rot));
  const R = (x, y, w, h, rx, f, sw) => shape('rect', `x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"`, f, sw, w, h);
  const P = (d, f = 'none', w) => {
    if (f === 'none') return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w == null ? 3 : w}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const n = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
    return shape('path', `d="${d}"`, f, w, x1 - x0, y1 - y0);
  };
  // 描边粗线条：墨色粗线 + 彩色细线 + 偏移的阴影细线
  const TL = (d, col, w = 8) => {
    if (cur && cur.rim) cur.rimBuf += `<path d="${d}" fill="none" stroke="${RIM}" stroke-width="${w + 10}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const sh = w >= 5 && HEX.test(col) ? `<path d="${d}" fill="none" stroke="${lum(col) < 0.13 ? mix(col, '#A9B4F0', 0.4) : shadeOf(col)}" stroke-width="${(w * 0.36).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${lum(col) < 0.13 ? '-' : ''}.9 ${lum(col) < 0.13 ? '-' : ''}1.2)"/>` : '';
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 5}" stroke-linecap="round" stroke-linejoin="round" transform="translate(.5 .8)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>` + sh;
  };
  const shadow = (cx = 50, rx = 28) => {
    cur.ground = `<ellipse cx="${cx}" cy="91.5" rx="${(rx * 1.08).toFixed(1)}" ry="5" fill="${INK}" opacity=".1"/><ellipse cx="${cx}" cy="91" rx="${(rx * 0.74).toFixed(1)}" ry="3.3" fill="${INK}" opacity=".17"/>`;
    return '';
  };
  function star(x, y, r, f = '#FFD23F', w = 2, n = 5, inner = 0.45) {
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI / n) * i - Math.PI / 2;
      const rr = i % 2 ? r * inner : r;
      d += `${i ? 'L' : 'M'}${(x + rr * Math.cos(a)).toFixed(1)} ${(y + rr * Math.sin(a)).toFixed(1)}`;
    }
    return P(d + 'Z', f, w);
  }
  function heart(x, y, s, f = '#E5383B', w = 2.2) {
    const k = s / 10;
    const pt = (a, b) => `${(x + a * k).toFixed(1)} ${(y + b * k).toFixed(1)}`;
    return P(`M${pt(0, 8)} C${pt(-12, 0)} ${pt(-8, -10)} ${pt(0, -4)} C${pt(8, -10)} ${pt(12, 0)} ${pt(0, 8)} Z`, f, w);
  }
  // 手绘小零件：一撮短排线（毛发/布纹/速度感）、散点颗粒
  const hatch = (x, y, n, dx, dy, len, ang, col = INK, w = 1.6) => {
    let d = '';
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let i = 0; i < n; i++) d += `M${(x + i * dx).toFixed(1)} ${(y + i * dy).toFixed(1)} l${(len * ca).toFixed(1)} ${(len * sa).toFixed(1)}`;
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  // 平头虚线条纹（豹纹尾巴、浣熊尾、蛙腿横纹）
  const DS = (d, col, w, dash) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="butt"/>`;
  const specks = (pts, col = INK, r = 1) => pts.map(([x, y, rr]) => dot(x, y, rr || r, col)).join('');
  const g = (t, s) => `<g transform="${t}">${s}</g>`;
  // 彩色描线（无填充）
  const S = (d, col, w = 2.4, extra = '') => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  const drop = (x, y, f = '#4CC9F0') => P(`M${x} ${y} Q${x - 4} ${y + 7} ${x} ${y + 8} Q${x + 4} ${y + 7} ${x} ${y} Z`, f, 1.8);
  const bolt = (x, y, k = 1, f = '#FFE27A') => P(`M${x + 2 * k} ${y - 10 * k} L${x - 5 * k} ${y + 1 * k} L${x} ${y + 1 * k} L${x - 2 * k} ${y + 10 * k} L${x + 5 * k} ${y - 2 * k} L${x} ${y - 2 * k} Z`, f, 2);
  const BODY = (f, cx = 50, top = 62) => P(`M${cx - 24} 88 Q${cx - 26} ${top + 2} ${cx} ${top} Q${cx + 26} ${top + 2} ${cx + 24} 88 Z`, f);

  // 二代主色（卡面底色）：色相与明度和一代错开，二代内部尽量拉开
  const COL = {
    bitemark: '#4B3A8C', blunderdog: '#FFB89A', cheatah: '#1F8C6C', critic: '#8E3A67', diva: '#B64BD6',
    doppel: '#6D7589', gloth: '#9DB89A', hogknight: '#7E8F38', hopfrog: '#D3E35A', hotel: '#74B9F0',
    icarus: '#FFC27A', kingtripper: '#2A8C8C', kraken: '#2B6CB3', saboteur: '#D8613A', magicalathlete: '#1C9BE0',
    mole: '#C9A06A', diceguy: '#23493F', mush: '#F3E3B5', nemesis: '#7B3FA0', nepobaby: '#D4C2F2',
    nul: '#3B4252', overtaker: '#8FE0B0', pooper: '#F2B8E6', penguin: '#BDEBD6', rerunner: '#D4A21C',
    showoff: '#D93FB0', soulmate: '#2E4A8C', speeddemon: '#146C78', spoilsport: '#E25C82', stepdad: '#D3D8E0',
    streaker: '#6B6BD6', stunner: '#2E3358', switcharoo: '#A0522D', tail: '#B8E6A0', hose: '#7FE0D8',
    understudy: '#8E2340',
  };

  const DRAW = {
    // 咬痕：满月下半变身的狼人，竖瞳 + 獠牙 + 撕裂的衬衫，领口两个咬痕
    bitemark() {
      const fur = '#A9ADCC', furD = '#6F73A0';
      return shadow(50, 28) +
        C(80, 22, 14, '#FFE27A') + C(75, 18, 2.8, '#F2C94C', 0) + C(85, 27, 3.4, '#F2C94C', 0) + C(87, 14, 1.8, '#F2C94C', 0) + C(73, 28, 1.8, '#F2C94C', 0) +
        BODY(fur) +
        P('M27 88 Q27 76 33 70 L38 79 L44 72 L50 83 L56 72 L62 79 L67 70 Q73 76 73 88 Z', '#EDE6CF', 2.6) +
        dot(35, 75, 1.6, '#E63946') + dot(38.5, 77, 1.6, '#E63946') + S('M60 84 L64 78 M66 86 L69 81', '#C9BFA0', 1.6) +
        E(23, 86, 8, 5, fur, 2.8) + E(77, 86, 8, 5, fur, 2.8) + hatch(18, 85, 3, 3.6, 0, 4, Math.PI / 2, INK, 1.6) + hatch(72, 85, 3, 3.6, 0, 4, Math.PI / 2, INK, 1.6) +
        P('M27 44 L22 10 L45 30 Z', fur) + P('M29 36 L26 19 L38 30 Z', '#E8A0B4', 0) +
        P('M73 44 L78 10 L55 30 Z', fur) + P('M71 36 L74 19 L62 30 Z', '#E8A0B4', 0) +
        P('M24 46 Q22 24 50 24 Q78 24 76 46 L87 49 L78 55 L83 63 L71 62 Q64 74 50 74 Q36 74 29 62 L17 63 L22 55 L13 49 Z', fur) +
        S('M45 27 L47 34 M50 26 L50 33 M55 27 L53 34', furD, 2) + S('M24 52 L30 54 M76 52 L70 54', furD, 1.8) +
        E(50, 59, 14, 10, '#ECE9F4', 2.6) + E(50, 52, 6, 4, INK, 0) + dot(48.5, 51, 1.3, '#fff') +
        P('M39 60 Q50 73 61 60 Q50 64 39 60 Z', '#5A1A2E', 2.4) + E(50, 66.5, 4, 2.2, '#FF6B81', 0) +
        P('M41 60.5 L43.5 67 L46.5 62 Z', '#fff', 1.6) + P('M53.5 62 L56.5 67 L59 60.5 Z', '#fff', 1.6) +
        C(38, 42, 6, '#FFE27A', 2.6) + E(38, 42, 1.8, 4.4, INK, 0) + dot(36, 40, 1.3, '#fff') +
        C(62, 42, 6, '#FFE27A', 2.6) + E(62, 42, 1.8, 4.4, INK, 0) + dot(60, 40, 1.3, '#fff') +
        P('M29 33 L44 39 M71 33 L56 39', 'none', 3.4) +
        P('M65 29 L69 42', 'none', 2.2) + S('M63 33 L67.5 31.5 M64.5 38 L69.5 36.5', '#fff', 1.4);
    },
    // 糊涂狗：蚊香眼、吐舌、头顶绕圈的星星，尾巴乱甩
    blunderdog() {
      const fur = '#FFF6E6', ear = '#B96A35', earD = '#8A4A22';
      return shadow(50, 28) +
        E(50, 15, 27, 7, 'none', 2) +
        TL('M68 82 Q86 82 88 66', fur, 6) + S('M93 62 Q97 68 94 76', INK, 2) + S('M96 58 Q101 66 98 74', INK, 1.6) +
        BODY(fur, 50, 66) + E(37, 88, 8, 4.5, fur, 2.6) + E(63, 88, 8, 4.5, fur, 2.6) + hatch(34, 85.5, 2, 3.4, 0, 3.4, Math.PI / 2, INK, 1.4) + hatch(60, 85.5, 2, 3.4, 0, 3.4, Math.PI / 2, INK, 1.4) +
        hatch(40, 80, 4, 5, 0, 5, 1.3, '#E3D2B8', 1.6) +
        R(35, 66, 30, 7, 3.5, '#E63946', 2.6) + R(46.5, 72, 7, 8, 3.5, '#FFD23F', 2) + L(50, 75, 50, 77.5, 1.4) +
        E(50, 47, 26, 21, fur) + E(61, 44, 11, 10, '#F3CC9B', 0) +
        spiralEye(39, 44, 7.5) + spiralEye(61, 44, 7.5) +
        E(22, 50, 8.5, 18, ear, 3, 18) + E(78, 50, 8.5, 18, ear, 3, -18) + S('M20 42 L24 54 M80 42 L76 54', earD, 2) +
        P('M47 21 Q43 13 50 14 Q57 14 53 21', 'none', 2.4) +
        E(30, 56, 4.5, 2.8, '#FFB3C0', 0) +
        E(50, 56, 6, 4.2, INK, 0) + dot(48.5, 54.8, 1.4, '#fff') +
        P('M41 60 Q45.5 64.5 50 60 Q54.5 64.5 59 60', 'none', 2.6) +
        P('M51 62 Q50 77 57 77 Q64 76 60 62 Z', '#FF6B81', 2.4) + L(55.5, 64, 55.8, 72, 1.5) + dot(53.5, 70, 1.3, '#FFC1CC') +
        star(24, 15, 6, '#FFD23F', 2) + star(74, 12, 5.5, '#FFD23F', 2) + star(50, 8, 4, '#FFD23F', 1.8);
    },
    // 老千豹：眨眼的猎豹，手里一把扑克，尾巴从身后绕出来
    cheatah() {
      const y = '#F7C548', sp = '#7A4A1E';
      const spots = (pts) => pts.map(([x, yy, r]) => dot(x, yy, r, sp)).join('');
      const card = (rot, suit) => g(`rotate(${rot} 76 88)`, R(67, 52, 18, 25, 3, '#fff', 2.6) + suit + dot(70.5, 57, 1.1) + dot(81.5, 72, 1.1));
      return shadow(48, 30) +
        TL('M24 82 Q6 82 7 66 Q8 54 17 52', y, 6.5) + DS('M24 82 Q6 82 7 66 Q8 54 17 52', sp, 6.5, '3 5.5') +
        BODY(y, 46, 62) + spots([[32, 76, 2.6], [40, 84, 2.2], [56, 74, 2.4], [60, 84, 2.8], [47, 72, 2]]) +
        E(46, 82, 9, 7, '#FFF1D0', 0) +
        C(28, 26, 8.5, y) + C(28, 26, 3.8, '#E08A2E', 0) + C(66, 26, 8.5, y) + C(66, 26, 3.8, '#E08A2E', 0) +
        E(47, 44, 24, 20, y) + spots([[32, 35, 2.6], [41, 28, 2.2], [57, 29, 2.4], [64, 38, 2.6], [27, 47, 2.2], [67, 49, 2], [47, 25, 2]]) +
        eye(38, 42, 6, 0.3) + P('M51 42 Q57 37 63 42', 'none', 3) + P('M50 36 L62 34', 'none', 2.4) +
        P('M37 49 Q34 55 37 60', 'none', 2.8) + P('M57 48 Q60 54 57 59', 'none', 2.8) +
        E(47, 55, 10, 6.5, '#FFF1D0', 2.4) + P('M43.5 51 L50.5 51 L47 54.5 Z', INK, 1.6) + S('M39 56 L31 54 M39 58 L31 59 M55 56 L63 54 M55 58 L63 59', INK, 1.4) +
        P('M41 58 Q49 64 56 56', 'none', 2.6) + dot(56, 56, 1.6, INK) +
        card(-24, heart(76, 64, 5)) + card(-5, P('M76 58 L81 64.5 L76 71 L71 64.5 Z', '#E63946', 1.8)) + card(14, star(76, 64, 6, INK, 0)) +
        C(67, 79, 6.5, y, 2.6) + S('M63 76 L65 80 M67 75 L68 80', INK, 1.4);
    },
    // 毒舌家：奶白高领 + 单片眼镜、翘鼻子、倒竖大拇指，另一手夹着打满红叉的记事本
    critic() {
      const skin = '#F6D6C2', knit = '#F4E9CF', hair = '#2B2140';
      return shadow(48, 28) +
        g('rotate(-9 16 70)', R(5, 55, 23, 29, 3, '#fff', 2.8) + S('M10 63 L22 63 M10 68.5 L22 68.5', '#B8C0D8', 1.8) + S('M11 73 L22 83 M22 73 L11 83', '#E63946', 3.6)) +
        BODY(knit, 46, 60) + S('M29 72 Q46 77 63 72 M28 80 Q46 85 64 80', '#CDBF98', 2) +
        TL('M34 76 L25 78', knit, 7) + C(24, 78, 5, skin, 2.6) +
        R(35, 51, 22, 12, 5, knit) + S('M40 52.5 L40 62 M46 53 L46 62.5 M52 52.5 L52 62', '#CDBF98', 1.6) +
        TL('M57 77 L68 62', knit, 8) +
        E(46, 37, 17, 20, skin) +
        P('M28 34 Q26 11 48 12 Q67 12 64 30 Q56 19 42 24 Q33 27 28 34 Z', hair) + S('M34 20 Q40 15 46 16', '#5B4A82', 1.8) +
        P('M32 28 Q38 23 44 28', 'none', 3) + L(51, 29, 62, 29, 3) +
        lid(38, 38, 4.8) +
        C(57, 38, 7.5, '#DFF4FF', 3) + dot(58, 39, 2.8) + S('M63 42 Q71 52 64 63', '#E0B040', 2, ' stroke-dasharray="2.5 2"') +
        P('M45 39 L61 46 L46 50 Z', skin, 2.6) +
        P('M41 57 Q46 67 52 57 Z', hair, 2) +
        P('M37 55.5 Q43 51 50 54.5', 'none', 3) +
        P('M63 52 Q63 45 69 45 L81 45 Q87 45 87 51 L87 61 Q87 67 81 67 L69 67 Q63 67 63 61 Z', skin, 2.8) +
        L(69, 46, 69, 53, 2) + L(75, 46, 75, 53, 2) + L(81, 46, 81, 53, 2) +
        P('M70 64 L70 82 Q75 89 80 82 L80 64 Z', skin, 2.8) + S('M72.5 72 L72.5 80', '#D9A98F', 1.4);
    },
    // 大明星：五角星身子、粉色墨镜、麦克风，手套 + 闪光
    diva() {
      const gold = '#FFD23F';
      return shadow(50, 28) +
        L(72, 56, 84, 32, 7) + L(72, 56, 84, 32, 3, '#8E8AA8') +
        star(50, 54, 40, gold, 3.4, 5, 0.52) +
        S('M28 40 L35 28 M24 47 L26 43', '#FFF6C2', 2.6) +
        R(30, 45, 17, 12, 6, '#E0408F', 2.8) + R(53, 45, 17, 12, 6, '#E0408F', 2.8) + L(47, 50, 53, 50, 2.6) +
        S('M33 49 L38 47', '#FFC2E0', 2) + S('M56 49 L61 47', '#FFC2E0', 2) +
        P('M30 46 L25 41 M70 46 L75 41 M31 44 L28 38', 'none', 2.4) +
        E(50, 67, 7, 4.2, '#E63946', 2.4) + L(43.5, 67, 56.5, 67, 1.5) + dot(66, 63, 1.1) +
        E(35, 61, 4.5, 2.8, '#FF8FB8', 0) + E(65, 61, 4.5, 2.8, '#FF8FB8', 0) +
        C(85, 31, 8, '#C9CED9', 2.8) + S('M80 28 L90 32 M81 34 L89 25', '#8E8AA8', 1.4) +
        C(74, 51, 6.5, '#fff', 2.6) + S('M71 49 L77 49', '#D8DCE8', 1.6) +
        C(12, 43, 5.5, '#fff', 2.6) +
        star(15, 18, 6, '#fff', 2) + star(88, 76, 4.5, '#fff', 1.8) + S('M6 28 L10 24 M22 12 L22 8', '#fff', 2) ;
    },
    // 冒牌货：礼帽西装 + 举着笑脸面具，身后一道替身残影
    doppel() {
      const suit = '#33384C', hat = '#22263A', skin = '#E8D8C8';
      const fig = BODY('#DDE3EE', 50, 60) + E(50, 44, 16, 16, '#DDE3EE') + E(50, 30, 27, 6.5, '#DDE3EE') + P('M35 30 Q35 11 50 11 Q65 11 65 30 Z', '#DDE3EE');
      return shadow(44, 34) +
        `<g transform="translate(-15 3)" opacity=".42">${fig}</g>` +
        BODY(suit, 50, 60) + P('M42 61 L50 78 L58 61', '#fff', 2.2) + P('M48 64 L52 64 L53.5 76 L50 80 L46.5 76 Z', '#E63946', 1.8) +
        P('M61 69 L67 66.5 L67.5 72.5 Z', '#FFD23F', 1.6) + dot(44, 82, 1.4, '#9AA3BC') + dot(56, 82, 1.4, '#9AA3BC') +
        C(28, 80, 5.5, '#fff', 2.6) +
        E(50, 44, 16, 16, skin) +
        P('M35 37 Q35 59 50 61 Q65 59 65 37 Q50 32 35 37 Z', '#fff', 2.8) +
        E(43, 44, 4.6, 3.2, INK, 0) + E(57, 44, 4.6, 3.2, INK, 0) + dot(41.5, 43, 1, '#fff') + dot(55.5, 43, 1, '#fff') + P('M38.5 39.5 L47 41.5 M61.5 39.5 L53 41.5', 'none', 2) + P('M41 51 Q50 59 59 51', 'none', 2.6) +
        E(36.5, 50, 3, 2, '#FF8FB8', 0) + E(63.5, 50, 3, 2, '#FF8FB8', 0) +
        E(50, 30, 27, 6.5, hat) + P('M35 30 Q35 11 50 11 Q65 11 65 30 Z', hat) + L(36, 25, 64, 25, 4, '#E63946') + R(46.5, 21.5, 7, 6.5, 1.5, '#FFD23F', 1.8) + P('M44 14 Q50 18 56 14', 'none', 2) + S('M39 17 L40 22', '#4A5070', 2) +
        L(63, 57, 74, 76, 3.2) + C(75, 78, 6, '#fff', 2.6) + S('M72 76 L78 76', '#C9CED9', 1.4);
    },
    // 树懒：倒挂树枝、黑眼圈、慢吞吞的 zZ，毛上长着青苔
    gloth() {
      const fur = '#B89C80', furD = '#8E7458', face = '#F2E4CE', patch = '#5A4434';
      return shadow(50, 22) +
        TL('M3 17 Q50 7 97 13', '#7A5230', 6) + S('M12 12 L16 10 M44 12 L48 11 M78 11 L82 11', '#4E3320', 1.8) + E(86, 7, 7, 3.5, '#6BAF5A', 2.2, 20) + E(16, 10, 7, 3.5, '#6BAF5A', 2.2, -20) + E(60, 8, 5, 2.6, '#8CCB6C', 2, -10) +
        TL('M36 50 L30 15', fur, 10) + TL('M64 50 L70 12', fur, 10) +
        S('M25 13 L27 19 M30 12 L31 18 M35 12 L34 18', INK, 2.4) + S('M65 10 L66 16 M70 9 L70 15 M75 9 L73 15', INK, 2.4) +
        hatch(33, 34, 3, 0, 5, 4, 2.4, furD, 1.6) + hatch(67, 32, 3, 0, 5, 4, 0.8, furD, 1.6) +
        TL('M41 80 L39 88', fur, 8) + TL('M59 80 L61 88', fur, 8) +
        E(50, 62, 25, 24, fur) + E(34, 66, 7, 4.5, '#8DB57A', 0, -25) + E(66, 70, 6, 4, '#8DB57A', 0, 25) +
        hatch(30, 76, 3, 2.5, 0.6, 4, 2.2, furD, 1.6) + hatch(62, 79, 3, 2.5, 0.6, 4, 0.9, furD, 1.6) +
        P('M33 74 Q38 80 44 76 M56 76 Q62 80 67 74', 'none', 2) +
        E(50, 54, 18, 13.5, face) +
        E(42, 53, 7, 5, patch, 0, -18) + E(58, 53, 7, 5, patch, 0, 18) +
        S('M38.5 52.5 Q42 55.5 45.5 52.5', '#fff', 2.2) + S('M54.5 52.5 Q58 55.5 61.5 52.5', '#fff', 2.2) +
        E(50, 59, 3.6, 2.6, INK, 0) + P('M45 63.5 Q50 66.5 55 63.5', 'none', 2.4) + dot(53.5, 66.5, 1.2, '#B8E6F8') +
        P('M43 39 L50 42.5 L43 46 Z M57 39 L50 42.5 L57 46 Z', '#4A2A6A', 2) + dot(50, 42.5, 2.2) +
        P('M73 30 L80 30 L73 37 L80 37', 'none', 2.8) + P('M84 21 L89 21 L84 26 L89 26', 'none', 2.4);
    },
    // 野猪骑士：骑着獠牙野猪、挺着长枪的小骑士，盾牌 + 马衣 + 枪上小旗
    hogknight() {
      const boar = '#8A5A3C', dark = '#5A3824', steel = '#CDD4E0';
      return shadow(54, 40) +
        TL('M42 74 L40 88', dark, 5) + TL('M52 76 L52 88', dark, 5) + TL('M70 76 L72 88', dark, 5) + TL('M80 72 L84 87', dark, 5) +
        E(40, 89, 4, 2, INK, 0) + E(53, 89, 4, 2, INK, 0) + E(73, 89, 4, 2, INK, 0) + E(85, 88.5, 4, 2, INK, 0) +
        P('M88 62 Q97 58 94 68', 'none', 2.8) +
        E(60, 66, 30, 15, boar) + specks([[78, 70, 1.4], [84, 66, 1.2], [74, 76, 1.4], [66, 77, 1.2]], '#5A3824') +
        P('M36 57 L40 46 L45 54 L50 43 L55 53 L60 44 L65 53 L70 47 L74 56 Z', dark, 2.4) +
        C(28, 62, 13, boar) + P('M26 50 L21 40 L33 47 Z', boar, 2.4) +
        E(16, 66, 7, 6, '#E2A486', 2.6) + dot(14, 65, 1.5) + dot(18.5, 65, 1.5) +
        P('M20 72 Q11 75 9 65 Q15 70 22 68 Z', '#fff', 2) +
        eye(28, 58, 4.2, -0.3) + P('M22 53 L33 56', 'none', 2.8) + hatch(34, 66, 3, 0, 3.4, 5, 0.3, dark, 1.4) +
        P('M47 57 Q60 52 73 57 L75 73 L45 73 Z', '#E63946', 2.4) + L(45.8, 71, 74.2, 71, 2.2, '#FFD23F') +
        P('M50 58 Q48 38 60 36 Q72 38 70 58 Z', steel) + L(60, 40, 60, 56, 1.8) +
        TL('M64 48 L15 29', '#E9D8A6', 3.5) + P('M4.5 25 L15.7 25.8 L12.5 33.2 Z', steel, 2.2) + P('M33 36 L30 27 L41.5 32.6 Z', '#FFD23F', 2) +
        P('M44 44 Q44 57 52 61 Q60 57 60 44 Z', '#3F8EE8', 2.6) + star(52, 50, 3.4, '#FFD23F', 1.2) +
        C(64, 48, 4.6, steel, 2.4) +
        C(60, 27, 11, steel) + R(50, 24, 20, 5, 2.5, INK, 0) + dot(56, 26.5, 1.6, '#FFE27A') + dot(64, 26.5, 1.6, '#FFE27A') +
        P('M60 16 Q66 2 82 6 Q73 11 68 19 Z', '#E63946', 2.4);
    },
    // 蹦蹦蛙：腾空张开四肢的毒箭蛙（橙红带黑斑），指尖吸盘
    hopfrog() {
      const f = '#FF6A2E', belly = '#FFD3AE';
      return shadow(50, 24) +
        S('M24 14 Q50 0 76 14', INK, 2.2, ' stroke-dasharray="3 4"') + S('M10 70 L6 78 M92 70 L96 78', INK, 2) +
        TL('M40 60 L25 69 L21 83', f, 7) + DS('M40 60 L25 69 L21 83', INK, 5, '2 9') + E(19, 86, 9, 4, f, 2.6) + dot(12, 86.5, 2.4, '#FFE0C2') + dot(19, 89, 2.4, '#FFE0C2') + dot(26, 86.5, 2.4, '#FFE0C2') +
        TL('M60 60 L75 69 L79 83', f, 7) + DS('M60 60 L75 69 L79 83', INK, 5, '2 9') + E(81, 86, 9, 4, f, 2.6) + dot(74, 86.5, 2.4, '#FFE0C2') + dot(81, 89, 2.4, '#FFE0C2') + dot(88, 86.5, 2.4, '#FFE0C2') +
        TL('M35 44 L20 25', f, 6) + C(18, 22, 5, f, 2.6) + dot(14, 18, 1.8, '#FFE0C2') + dot(19, 16.5, 1.8, '#FFE0C2') +
        TL('M65 44 L80 25', f, 6) + C(82, 22, 5, f, 2.6) + dot(86, 18, 1.8, '#FFE0C2') + dot(81, 16.5, 1.8, '#FFE0C2') +
        E(50, 50, 21, 18, f) + E(50, 57, 12.5, 10, belly, 2.4) + specks([[45, 55, 1.3], [53, 60, 1.3], [57, 54, 1.1]], '#E0A070') +
        dot(35, 46, 3.4) + dot(66, 44, 3) + dot(61, 36, 2) + dot(44, 64, 2.4) + dot(31, 54, 2.2) + dot(69, 54, 2.4) + dot(48, 41, 1.8) +
        C(40, 33, 9, f) + C(60, 33, 9, f) + eye(40, 32, 6, 0, -0.2) + eye(60, 32, 6, 0, -0.2) +
        P('M39 47 Q50 56 61 47', 'none', 2.8) + E(50, 53.5, 5, 2.2, '#FF9B6B', 0);
    },
    // 小旅馆：窗户当眼睛、条纹雨篷、门口一枚房费金币，招牌三颗星 + 花盆
    hotel() {
      const wall = '#FF9F8E', awn = '#2E8F86';
      return shadow(50, 32) +
        L(36, 22, 36, 28, 2.4) + L(64, 22, 64, 28, 2.4) +
        R(27, 8, 46, 16, 5, '#FFE27A') + star(38, 16, 4, '#FF9F1C', 1.4) + star(50, 16, 4.6, '#FF9F1C', 1.4) + star(62, 16, 4, '#FF9F1C', 1.4) +
        R(22, 26, 56, 62, 4, wall) + hatch(26, 52, 4, 14, 0, 6, 0.1, '#D9806F', 1.6) + hatch(30, 57, 4, 14, 0, 6, 0.1, '#D9806F', 1.6) +
        R(26, 29, 23, 21, 3, '#8E4A3A', 0) + R(51, 29, 23, 21, 3, '#8E4A3A', 0) +
        R(29, 32, 17, 15, 3, '#fff') + R(54, 32, 17, 15, 3, '#fff') + dot(39, 41, 3.8) + dot(64, 41, 3.8) + dot(37.8, 39.8, 1.1, '#fff') + dot(62.8, 39.8, 1.1, '#fff') +
        L(29, 36, 46, 36, 2) + L(54, 36, 71, 36, 2) +
        smile(50, 51, 7, 3) +
        P('M24 61 L76 61 L80 69 Q76 74 72 69 Q68 74 64 69 Q60 74 56 69 Q52 74 48 69 Q44 74 40 69 Q36 74 32 69 Q28 74 24 69 Q20 74 20 69 Z', awn, 2.6) +
        S('M34 62 L32 68 M44 62 L43.5 68 M56 62 L56.5 68 M66 62 L68 68', '#fff', 3.2) +
        R(41, 73, 18, 15, 2, '#7A3E1D') + L(50, 73, 50, 88, 1.4) + dot(47, 81, 1.6, '#FFD23F') + dot(53, 81, 1.6, '#FFD23F') +
        R(23, 80, 13, 8, 2, '#C0643A', 2.2) + dot(26, 77, 3, '#FF6FAE', 1.6) + dot(32, 76, 3.2, '#FFD23F', 1.6) + S('M29 80 L29 77', '#3E8E3A', 1.8) +
        C(86, 77, 10, '#FFD23F') + C(86, 77, 6, 'none', 2) + L(86, 73, 86, 81, 2.6) + S('M81 72 L83 70', '#fff', 1.8);
    },
    // 伊卡洛斯：羽毛蜡翼、头顶太阳、蜡油滴落，翅膀边缘已经烧起来
    icarus() {
      const wing = '#FFFFFF', tunic = '#3F8EE8';
      const wl = 'M42 56 Q26 30 4 30 Q8 37 13 39 Q4 43 6 49 Q13 51 16 53 Q8 58 13 63 Q21 63 26 65 Q24 71 31 73 Q38 66 44 62 Z';
      const wr = 'M58 56 Q74 30 96 30 Q92 37 87 39 Q96 43 94 49 Q87 51 84 53 Q92 58 87 63 Q79 63 74 65 Q76 71 69 73 Q62 66 56 62 Z';
      let rays = '';
      for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i; rays += L(50 + 11 * Math.cos(a), 12 + 11 * Math.sin(a), 50 + 15 * Math.cos(a), 12 + 15 * Math.sin(a), 2.8, '#FF9F1C'); }
      const flame = (x, y, k = 1) => P(`M${x} ${y} Q${x - 4 * k} ${y - 5 * k} ${x - 1 * k} ${y - 11 * k} Q${x + 1 * k} ${y - 7 * k} ${x + 3 * k} ${y - 8 * k} Q${x + 6 * k} ${y - 3 * k} ${x + 2 * k} ${y} Z`, '#FF8A1C', 1.8);
      return shadow(50, 24) +
        rays + C(50, 12, 8, '#FF9F1C', 2.8) + dot(47, 9.5, 2, '#FFE27A') +
        P(wl, wing) + P('M14 40 Q28 42 38 51 M14 52 Q26 54 38 59 M22 64 Q30 62 38 62', 'none', 1.8) + drop(27, 71, '#FFC94A') + flame(7, 31, 1) + flame(15, 38, 0.8) +
        P(wr, wing) + P('M86 40 Q72 42 62 51 M86 52 Q74 54 62 59 M78 64 Q70 62 62 62', 'none', 1.8) + drop(80, 76, '#FFC94A') + flame(93, 31, 1) + flame(85, 38, 0.8) +
        TL('M45 78 L43 88', SKIN, 5) + TL('M55 78 L57 88', SKIN, 5) + S('M40 85 L47 84 M53 84 L60 85', '#C9803A', 1.8) +
        P('M36 81 Q36 60 50 58 Q64 60 64 81 Z', tunic) + L(38, 70, 62, 70, 2.8, '#FFD23F') + S('M41 76 L59 76', '#2A6CC0', 1.6) +
        C(50, 44, 13, SKIN) +
        P('M37 43 Q35 30 44 30 Q46 25 52 27 Q59 25 61 31 Q67 33 63 43 Q58 36 50 37 Q42 36 37 43 Z', '#8A5A2B') + P('M36 36 L63 36', 'none', 2.2) +
        eye(45, 46, 4.4, 0.1, -0.35) + eye(55, 46, 4.4, 0.1, -0.35) + S('M41 41 L48 43 M59 41 L52 43', INK, 2) +
        E(50, 53, 2.6, 3, '#5A1A2E', 2.2) + E(38, 51, 3, 1.8, '#FF9DB0', 0) + E(62, 51, 3, 1.8, '#FF9DB0', 0) + drop(66, 36);
    },
    // 绊脚王：歪戴王冠、拄弯钩手杖、伸出一只靴子使绊，翘胡子
    kingtripper() {
      const robe = '#E0483E', gold = '#FFD23F';
      return shadow(50, 38) +
        TL('M18 88 L18 40 Q18 28 27 28 Q35 28 35 37', '#8A5A2B', 4) + C(35, 37, 3, gold, 1.8) + S('M18 80 L18 76 M18 70 L18 66', '#B07A4A', 1.8) +
        TL('M56 81 L82 83', '#3D2A5C', 6) +
        P('M79 76 Q92 75 95 81 Q93 88 79 87 Z', '#7A3E1D', 2.6) + P('M94 79 Q98 74 94 71', 'none', 2.4) + L(80, 86.5, 93, 87.5, 2, '#4A2A14') + star(98, 68, 3.4, gold, 1.2) +
        BODY(robe, 45, 60) + E(45, 62, 18, 5.5, '#fff') + dot(37, 62, 1.5) + dot(45, 63, 1.5) + dot(53, 62, 1.5) + dot(40, 64.8, 1.2) + dot(50, 65, 1.2) +
        S('M33 72 L33 84 M57 72 L57 84', '#B02F2A', 2) + dot(45, 78, 2, gold) + dot(45, 84, 2, gold) +
        TL('M30 68 L21 62', robe, 6) + C(19, 61, 5.5, SKIN, 2.6) +
        C(46, 44, 15, SKIN) +
        g('rotate(-14 46 28)', P('M31 33 L31 15 L38.5 24 L46 11 L53.5 24 L61 15 L61 33 Z', gold) + C(46, 27, 2.6, '#4CC9F0', 1.6) + L(31, 31, 61, 31, 2, '#E0A020')) +
        eye(40, 45, 4.6, 0.45, 0.05) + eye(52, 45, 4.6, 0.45, 0.05) + P('M35 43 L45 43 M47 43 L57 43', 'none', 2.6) +
        P('M36 52 Q41 49 46 52 Q51 49 56 53 Q58 56 54 54 Q50 52.5 46 54 Q42 52.5 38 55 Q35 56 36 52 Z', '#5A3A1E', 1.6) +
        P('M39 56 Q46 59 53 55', 'none', 2.6);
    },
    // 大海怪：大圆脑袋的章鱼怪，触手卷着气泡，吸盘一圈圈
    kraken() {
      const k = '#EC5A86', spot = '#FFB8D0';
      const t = (d) => TL(d, k, 8);
      const suck = (x, y) => C(x, y, 2.1, spot, 1.4);
      return shadow(50, 40) +
        t('M72 48 Q90 40 90 26 Q90 17 82 19') +
        t('M30 56 Q14 64 12 78 Q12 86 20 84') + t('M39 62 Q31 76 35 87') + t('M50 64 Q51 78 46 88') + t('M61 62 Q69 76 65 87') + t('M70 56 Q86 64 88 78 Q88 86 80 84') +
        suck(15, 71) + suck(13, 79) + suck(33, 73) + suck(34, 82) + suck(49.5, 75) + suck(48, 83) + suck(66, 73) + suck(65, 82) + suck(85, 71) + suck(88, 79) + suck(90, 33) + suck(88, 24) +
        P('M24 58 Q20 13 50 11 Q80 13 76 58 Q62 66 50 64 Q38 66 24 58 Z', k) +
        C(39, 22, 3.4, spot, 0) + C(61, 19, 2.6, spot, 0) + C(67, 31, 3.6, spot, 0) + C(31, 34, 2.4, spot, 0) + S('M32 20 Q36 14 44 13', '#FFD0E0', 2.4) +
        eye(38, 42, 8, 0.1, 0.1) + eye(62, 42, 8, -0.1, 0.1) + P('M28 31 L45 36 M72 31 L55 36', 'none', 3.4) +
        P('M41 54 Q50 60 59 54', 'none', 2.8) + P('M45 56 L47 60 L49 57.5 M51 57.5 L53 60 L55 56', 'none', 1.6) +
        C(14, 16, 3.8, 'none', 2) + C(21, 7, 2.6, 'none', 1.8) + C(9, 30, 2, 'none', 1.6) + S('M12 14 L13 13', '#fff', 1.4);
    },
    // 捣蛋鬼：贝雷帽、条纹衫、小胡子，扛着扳手，另一手拎着冒火星的小炸弹
    saboteur() {
      const beret = '#E63946', metal = '#BAC3D0';
      const body = 'M26 88 Q24 62 48 60 Q72 62 70 88 Z';
      return shadow(48, 28) +
        P(body, '#fff') + L(28.5, 67, 67.5, 67, 4.2) + L(26.6, 74.5, 69.4, 74.5, 4.2) + L(26, 82, 70, 82, 4.2) + P(body) +
        P('M38 59 Q48 65 58 59 L56 55 L40 55 Z', beret, 2.4) + P('M54 61 L60 73 L53 71 Z', beret, 2.2) +
        TL('M30 72 L22 78', '#fff', 6) + C(15, 82, 8.5, '#2E2A40') + L(15, 74, 18, 70, 2.4) + S('M18 70 Q21 66 24 68', '#C9803A', 1.8) + star(26, 66, 4, '#FFD23F', 1.4) + dot(11.5, 79, 1.8, '#8E8AA8') + C(22, 80, 4.4, SKIN, 2.6) +
        C(47, 44, 15, SKIN) +
        E(44, 30, 19, 7, beret, 3, -10) + P('M43 23 L44 18', 'none', 3) +
        P('M35 38 L44 40.5 M59 38 L50 40.5', 'none', 2.8) + eye(40, 45, 4.6, 0.45) + eye(54, 45, 4.6, 0.45) +
        P('M37 52 Q42 48 47 51 Q52 48 57 52 Q59 57 55 55 Q51 53 47 54 Q43 53 39 55 Q35 57 37 52 Z', INK, 1.6) + P('M43 57 Q48 60 53 56', 'none', 2.4) +
        TL('M66 76 L84 46', metal, 5) +
        P('M76 42 L76 33 Q76 24 83 24 L83 32 L88 32 L88 24 Q95 24 95 33 L95 42 Q90 48 85.5 48 Q81 48 76 42 Z', metal, 2.6) + S('M79 28 L79 38', '#EEF2F8', 1.8) +
        C(66, 76, 6, SKIN, 2.6);
    },
    // 魔法健将：巫师尖帽 + 运动背心 + 奖牌，手托一颗六点骰，星星拖尾
    magicalathlete() {
      const hat = '#3346C8', top = '#FFD23F';
      return shadow(50, 28) +
        BODY(top, 50, 62) + S('M30 72 L30 86 M70 72 L70 86', '#2A5CE0', 2.6) + S('M33 76 L33 86 M67 76 L67 86', '#fff', 1.6) +
        P('M41 62 L47.5 73 L52.5 73 L59 62', '#E63946', 2.2) + C(50, 77, 6.5, '#FFB020', 2.6) + star(50, 77, 3.6, '#FFE9A0', 0) +
        C(50, 49, 14, SKIN) + E(40, 55, 3, 1.8, '#FF9DB0', 0) + E(60, 55, 3, 1.8, '#FF9DB0', 0) +
        eye(45, 50, 4.6, 0.1, 0.1) + eye(55, 50, 4.6, 0.1, 0.1) + openMouth(50, 56, 6, 3) +
        E(50, 37, 25, 6.5, hat) + P('M34 37 Q41 19 51 7 Q57 2 66 7 Q59 9 59 16 Q62 27 66 37 Z', hat) + L(35, 35, 65, 35, 2.4, '#FFD23F') +
        star(50, 27, 5, top, 1.8) + star(61, 15, 3.4, top, 1.4) + dot(41, 32, 1.8, '#fff') +
        g('translate(64 50) rotate(14) scale(.29)', dieInner(6)) + C(68, 72, 6, SKIN, 2.6) + R(63, 68, 9, 3.4, 1.5, '#E63946', 1.6) +
        star(86, 44, 4.5, '#fff', 1.8) + star(16, 58, 4, '#fff', 1.6) + S('M80 34 L84 30 M20 46 L24 42', '#fff', 2);
    },
    // 鼹鼠：戴矿灯安全帽的星鼻鼹，从土堆里钻出来，头灯射出光束
    mole() {
      const fur = '#5E4E5C', soil = '#7E5130', soilL = '#B07A4A';
      return shadow(50, 40) +
        `<path d="M50 26 L36 2 L64 2 Z" fill="#FFF7C2" opacity=".5"/>` +
        P('M29 72 Q27 32 50 30 Q73 32 71 72 Z', fur) + hatch(34, 46, 3, 0, 5, 5, 1.4, '#7C6A7A', 1.6) + hatch(66, 46, 3, 0, 5, 5, 1.7, '#7C6A7A', 1.6) +
        P('M31 38 Q31 17 50 17 Q69 17 69 38 Z', '#FFD23F') + R(25, 35, 50, 6.5, 3.2, '#FFD23F') + C(50, 26, 5.5, '#FFF7C2', 2.6) + L(50, 18, 50, 33, 1.8, '#E0A020') +
        P('M39 49 Q42 46.5 45 49 M55 49 Q58 46.5 61 49', 'none', 2.8) +
        star(50, 57, 8, '#FF8FAB', 2.4, 8, 0.55) + R(47, 63, 6, 4.5, 1, '#fff', 1.8) + L(50, 63, 50, 67.5, 1.2) +
        S('M36 58 L24 56 M36 62 L25 64 M64 58 L76 56 M64 62 L75 64', INK, 1.4) +
        P('M8 88 Q12 66 32 64 Q50 70 68 64 Q88 66 92 88 Z', soil) +
        dot(23, 79, 2.8, soilL) + dot(72, 80, 3.2, soilL) + dot(48, 83, 2.4, soilL) + dot(35, 74, 1.8, soilL) + dot(62, 75, 2, soilL) +
        E(30, 66, 10, 6.5, '#FFB3C6', 2.6) + P('M23 62 L21 57 M29 61 L28 56 M35 62 L36 57', 'none', 2.6) +
        E(70, 66, 10, 6.5, '#FFB3C6', 2.6) + P('M65 62 L64 57 M71 61 L72 56 M77 62 L79 57', 'none', 2.6) +
        C(14, 52, 3, soilL, 2) + C(87, 47, 2.6, soilL, 1.8) + C(10, 62, 1.8, soilL, 1.4) +
        TL('M86 87 Q84 78 90 74', '#F29B9B', 3) + dot(91, 73, 1.6, INK);
    },
    // 骰子先生：骰子脑袋、八字胡、领结 + 白手套，身边抛着小骰子
    diceguy() {
      const suit = '#E8453C';
      const mini = (x, y, rot, v) => g(`translate(${x} ${y}) rotate(${rot}) scale(.17)`, dieInner(v));
      return shadow(50, 30) +
        BODY(suit, 48, 64) + P('M40 63 L48 80 L56 63 Z', '#fff', 2.2) + P('M40 62 L48 66 L40 70 Z M56 62 L48 66 L56 70 Z', '#FFD23F', 2.2) + C(48, 66, 2.6, '#FFD23F', 1.8) + dot(48, 74, 1.4) + dot(48, 79, 1.4) +
        P('M24 24 L37 11 L81 11 L68 24 Z', '#E9E4F3') + P('M68 24 L81 11 L81 50 L68 63 Z', '#CFC6E3') +
        R(24, 24, 44, 39, 7, '#fff') +
        dot(46, 17.5, 2.4) + dot(62, 17.5, 2.4) + dot(74.5, 30, 2.4) + dot(74.5, 44, 2.4) +
        eye(37, 38, 5.2) + eye(55, 38, 5.2) + P('M31 31 L41 33 M60 31 L51 33', 'none', 2.6) +
        P('M35 51 Q40.5 46 46 49.5 Q51.5 46 57 51 Q53 55.5 46 53 Q39 55.5 35 51 Z', INK, 1.6) +
        P('M41 57 Q46 60 51 57', 'none', 2.4) +
        C(22, 72, 6, '#fff', 2.6) + S('M19 70 L25 70', '#D3D9E6', 1.6) + C(74, 72, 6, '#fff', 2.6) + S('M71 70 L77 70', '#D3D9E6', 1.6) +
        mini(3, 46, -18, 3) + mini(84, 56, 16, 5) + mini(6, 3, 10, 2) + S('M10 36 L14 34 M90 48 L93 46', '#FFE27A', 2);
    },
    // 蘑菇：红伞白点的大蘑菇，菌褶 + 孢子，伞顶又冒出一颗紫色小蘑菇
    mush() {
      const cap = '#E5484D', stem = '#FFF2DA';
      return shadow(50, 24) +
        P('M33 56 Q29 82 35 88 L65 88 Q71 82 67 56 Z', stem) + hatch(36, 74, 3, 0, 4, 6, 1.5, '#E0CDA8', 1.6) + hatch(62, 72, 3, 0, 4, 6, 1.5, '#E0CDA8', 1.6) +
        TL('M33 76 L25 80', stem, 4.5) + TL('M67 76 L75 80', stem, 4.5) +
        eye(43, 70, 4.8, 0, 0.1) + eye(57, 70, 4.8, 0, 0.1) + smile(50, 77, 5, 2.4) +
        E(37, 76, 3.6, 2.2, '#FF9DB0', 0) + E(63, 76, 3.6, 2.2, '#FF9DB0', 0) +
        P('M9 55 Q9 15 50 13 Q91 15 91 55 Q72 61 50 61 Q28 61 9 55 Z', cap) +
        C(29, 33, 6.5, '#fff', 2.4) + C(51, 25, 5, '#fff', 2.4) + C(73, 40, 6.5, '#fff', 2.4) + C(46, 46, 4.2, '#fff', 2.2) + C(19, 48, 3.2, '#fff', 2) + C(83, 24, 2.6, '#fff', 0) +
        S('M18 24 Q24 17 34 15', '#FF9B9E', 2.8) +
        P('M22 58 Q36 63 50 62.5 Q64 63 78 58', 'none', 1.8) + S('M30 59 L29 62 M40 61 L40 64 M50 62 L50 65 M60 61 L60 64 M70 59 L71 62', INK, 1.2) +
        R(70, 8, 6, 11, 2, stem, 2.4) + P('M62 11 Q63 0 73 0 Q83 0 84 11 Z', '#9B5DE5', 2.6) + dot(69, 6, 1.8, '#fff') + dot(77, 5, 1.6, '#fff') +
        star(90, 8, 3.6, '#fff', 1.6) + dot(12, 66, 1.6, '#fff') + dot(8, 72, 1.2, '#fff') + dot(90, 66, 1.6, '#fff') + dot(94, 74, 1.2, '#fff');
    },
    // 宿敌：兜帽斗篷下一双发红的怒眼，旁边炸开电光（斗篷提亮帽沿 + 奶油贴纸边，深紫底上也清楚）
    nemesis() {
      const cloak = '#3A2650', hole = '#120D1A', glow = '#FF5A5A', lining = '#8A63B0';
      return shadow(50, 30) +
        bolt(84, 22, 1.25, '#FFD23F') + bolt(14, 32, 1.05, '#FFD23F') +
        P('M18 88 Q16 56 30 34 Q40 14 50 8 Q60 14 70 34 Q84 56 82 88 Z', cloak) +
        S('M31 36 Q40 17 50 11 Q60 17 69 36', lining, 2.6) +
        P('M33 88 Q32 72 40 66 M67 88 Q68 72 60 66 M24 80 Q27 70 30 62 M76 80 Q73 70 70 62', 'none', 2) +
        E(50, 46, 17, 19, hole, 2.6) +
        E(41, 44, 8, 5, glow, 0) + E(59, 44, 8, 5, glow, 0) +
        `<path d="M35 39 L47 44 L37 48 Z M65 39 L53 44 L63 48 Z" fill="#FFF0A0"/>` + dot(40.5, 44.2, 1.5, '#C0182B') + dot(59.5, 44.2, 1.5, '#C0182B') +
        S('M39 56 L43 61 L47 56 L51 61 L55 56 L59 61 L62 56', '#fff', 2.4) +
        C(50, 76, 3.8, '#FFD23F', 1.8) +
        E(70, 70, 7, 6, '#E8D2C2', 2.8) + TL('M66 66 L64 59', '#E8D2C2', 3) + TL('M70 64 L70 56', '#E8D2C2', 3) + TL('M74 66 L77 59', '#E8D2C2', 3) + L(66, 71, 74, 71, 1.4);
    },
    // 星二代：含着金汤匙、戴墨镜的富贵宝宝，金链条 + 钻石耳钉
    nepobaby() {
      const skin = '#FFDCC0', gold = '#FFC93C';
      return shadow(50, 28) +
        E(50, 79, 21, 11, skin) + P('M31 80 Q50 96 69 80 Q50 86 31 80 Z', '#fff', 2.6) + C(58, 84, 2.4, gold, 1.6) + S('M42 88 L44 92 M56 90 L58 93', INK, 1.6) +
        S('M33 73 Q50 80 67 73', gold, 3.4, ' stroke-dasharray="3 2.4"') + C(50, 78, 4.2, gold, 2) + S('M48.5 76.5 L48.5 79.5 M51.5 76.5 L51.5 79.5', INK, 1.2) +
        C(27, 72, 6.5, skin, 2.6) + C(73, 72, 6.5, skin, 2.6) +
        C(50, 45, 25, skin) + P('M48 20 Q43 12 51 12 Q58 14 54 21', 'none', 2.8) +
        E(25, 48, 3.4, 4.2, skin, 2.4) + E(75, 48, 3.4, 4.2, skin, 2.4) + star(25, 53, 2.6, '#8FE3FF', 1.2, 4, 0.4) + star(75, 53, 2.6, '#8FE3FF', 1.2, 4, 0.4) +
        R(29, 38, 19, 12, 4.5, INK, 2.4) + R(52, 38, 19, 12, 4.5, INK, 2.4) + L(47, 42, 53, 42, 2.8) +
        S('M32 42 L38 41', '#fff', 2) + S('M55 42 L61 41', '#fff', 2) + S('M41 47 L44 46', '#7A8BD0', 1.6) + S('M64 47 L67 46', '#7A8BD0', 1.6) +
        E(31, 56, 4.8, 3, '#FF9DB0', 0) + E(69, 56, 4.8, 3, '#FF9DB0', 0) +
        TL('M54 60 L79 71', gold, 3.5) + E(49, 59.5, 6.5, 4.6, gold, 2.6) + S('M62 63 L70 67', '#FFF6C2', 1.4) + dot(47, 58, 1.2, '#FFF6C2');
    },
    // 空指针：花屏显示器，X 眼 + 空集符号嘴，RGB 错位的故障描边 + 扫描线
    nul() {
      const casing = '#D6DBE5', screen = '#1D2233', ok = '#7CFF6B';
      return shadow(50, 26) +
        `<rect x="11.5" y="20" width="72" height="56" rx="10" fill="none" stroke="#FF4FD8" stroke-width="2.6" opacity=".9"/><rect x="16.5" y="20" width="72" height="56" rx="10" fill="none" stroke="#3DF5E0" stroke-width="2.6" opacity=".9"/>` +
        L(42, 21, 33, 7, 2.6) + L(58, 21, 67, 7, 2.6) + C(33, 6, 3, '#FF4FD8', 2) + C(67, 6, 3, '#3DF5E0', 2) +
        P('M40 74 L36 85 L64 85 L60 74 Z', '#AEB5C4') + R(28, 83, 44, 6, 3, '#AEB5C4', 2.6) +
        R(14, 20, 72, 56, 10, casing) + dot(80, 71, 1.6, '#E63946') + dot(74, 71, 1.6, '#FFD23F') +
        R(21, 27, 58, 41, 7, screen, 2.6) +
        S('M31 37 L40 46 M40 37 L31 46', ok, 3.6) + S('M60 37 L69 46 M69 37 L60 46', ok, 3.6) +
        `<circle cx="50" cy="57" r="5.5" fill="none" stroke="${ok}" stroke-width="2.8"/>` + S('M43 64 L57 50', ok, 2.8) +
        S('M24 31 L27 29 M70 63 L76 63', '#fff', 1.6) + S('M62 29 L70 34 L66 38 L74 43', '#3DF5E0', 1.4) +
        R(6, 38, 9, 5, 0, '#FF4FD8', 1.6) + R(84, 52, 10, 5, 0, '#3DF5E0', 1.6) + R(80, 28, 7, 4, 0, '#FF4FD8', 1.6) + R(8, 60, 7, 4, 0, '#3DF5E0', 1.6) +
        `<rect x="54" y="30" width="18" height="3" fill="#FF4FD8" opacity=".85"/><rect x="26" y="60" width="12" height="3" fill="#3DF5E0" opacity=".85"/><rect x="23" y="49" width="54" height="1.4" fill="#fff" opacity=".14"/><rect x="23" y="53.5" width="54" height="1.4" fill="#fff" opacity=".14"/>`;
    },
    // 超车王：压低身子的赛车，车手头盔，尾气烟圈 + 速度线 + 格子尾翼
    overtaker() {
      const car = '#2F6FE8';
      return shadow(52, 42) +
        L(3, 50, 15, 50, 2.8) + L(1, 60, 12, 60, 2.8) + L(4, 70, 13, 70, 2.8) + C(9, 78, 4, '#fff', 2) + C(3, 84, 2.6, '#fff', 1.8) +
        C(61, 38, 11, '#E63946') + P('M61 33 L72 33 Q74 40 69 43 L61 43 Z', '#3D405B', 2.2) + S('M64 35 L70 35', '#9EC4FF', 1.8) + S('M54 31 Q57 27 62 27', '#FF9B9E', 2.2) +
        R(10, 43, 15, 5, 2, car, 2.4) + R(10, 43, 15, 2.6, 1, '#fff', 0) + L(17, 48, 19, 57, 3) +
        P('M14 75 L16 61 Q18 56 26 56 L41 54 L49 43 Q51 41 56 44 L70 44 Q73 44 75 47 L79 55 L90 58 Q97 62 95 70 L93 75 Z', car) +
        S('M19 66 L92 66', '#fff', 3.6) + C(36, 63, 6.5, '#fff', 2.4) + L(36, 59.5, 36, 66.5, 2.4) + S('M45 51 L52 46', '#9EC4FF', 2) +
        C(28, 77, 10.5, '#2E2A40') + C(28, 77, 4.6, '#C9CED9', 2) + C(78, 77, 10.5, '#2E2A40') + C(78, 77, 4.6, '#C9CED9', 2) + S('M28 72 L28 82 M23 77 L33 77 M73 77 L83 77 M78 72 L78 82', '#8E96AA', 1.2) +
        eye(88, 62, 3.6, 0.4);
    },
    // 派对杀手：顶着歪派对帽的乌云，下雨浇灭一颗六点骰，闪电 + 蔫掉的拉花
    pooper() {
      const cloud = '#9AA3BC', hat = '#FF6FAE';
      return shadow(50, 28) +
        drop(24, 64) + drop(36, 74) + drop(18, 78) + drop(44, 62) + drop(12, 66) +
        g('translate(54 64) rotate(10) scale(.25)', dieInner(6)) + S('M56 66 L78 88 M78 66 L56 88', '#E63946', 4.5) +
        P('M22 58 Q8 58 9 45 Q10 32 24 34 Q26 19 42 20 Q52 11 64 20 Q76 16 82 28 Q95 30 92 45 Q92 58 78 58 Z', cloud) + S('M16 40 Q18 36 22 36 M70 24 Q76 22 80 26', '#C9CFE0', 2.4) +
        P('M70 56 L64 66 L70 66 L66 76 L77 62 L71 62 L75 56 Z', '#FFE27A', 1.8) +
        g('rotate(22 70 20)', P('M62 22 L70 1 L78 22 Z', hat) + S('M64.5 15 L75.5 15', '#FFE27A', 2.6) + C(70, 1, 3, '#FFE27A', 2)) +
        S('M86 8 Q92 14 88 20 M92 4 L95 7', '#4CC9F0', 2) + dot(80, 6, 1.6, '#FFD23F') + dot(95, 18, 1.6, '#FF6FAE') +
        C(39, 41, 5.5, '#fff', 2.4) + dot(39, 43, 2.6) + L(33.5, 40, 44.5, 40, 2.8) +
        C(59, 41, 5.5, '#fff', 2.4) + dot(59, 43, 2.6) + L(53.5, 40, 64.5, 40, 2.8) +
        P('M32 33 L44 36 M68 33 L56 36', 'none', 2.8) +
        P('M41 52 Q50 46 59 52', 'none', 2.8) + E(30, 48, 4, 2.4, '#C9CFE0', 0) + E(70, 48, 4, 2.4, '#C9CFE0', 0);
    },
    // 攀滚企鹅：肚皮着地一路滑行的企鹅，红围巾向后飘，雪沫四溅
    penguin() {
      const blk = '#2E2A40', org = '#FF9F1C';
      return shadow(50, 42) +
        L(2, 58, 12, 58, 2.8) + L(1, 68, 10, 68, 2.8) + L(4, 78, 12, 78, 2.8) + C(6, 84, 3.4, '#fff', 2) + C(14, 86, 2.6, '#fff', 1.8) + C(22, 85, 2, '#fff', 1.6) +
        E(17, 62, 7, 3.8, org, 2.4, -20) + E(16, 73, 7, 3.8, org, 2.4, 14) +
        P('M46 58 Q38 40 26 40 Q32 50 38 60 Z', blk, 2.6) +
        E(48, 68, 34, 16, blk, 3, -6) +
        E(51, 74, 27, 8.5, '#fff', 2.4, -6) + S('M34 74 Q46 79 60 75', '#CBD6EA', 2) +
        P('M64 52 Q54 48 44 54 Q40 58 36 56 Q42 66 52 60 Q60 56 66 58 Z', '#E63946', 2.4) + S('M60 52 L58 58 M52 51 L50 57', '#FFE0E0', 1.8) +
        C(80, 57, 14, blk) + E(82, 59, 10, 9, '#fff', 0) + E(67.5, 58, 4, 9, '#E63946', 2.4, 12) +
        eye(78, 55, 4, 0.4, 0) + eye(87, 55, 3.6, 0.4, 0) +
        P('M88 61 L99 63.5 L88 67 Z', org, 2.2) + E(77, 63, 3, 2, '#FF9DB0', 0) + P('M72 49 L78 46', 'none', 2.2) +
        star(30, 28, 4.5, '#fff', 1.8) + star(62, 30, 3, '#fff', 1.4) + dot(18, 40, 1.6, '#fff') + dot(8, 46, 1.2, '#fff');
    },
    // 返场王：绕身一圈的「再来一次」大箭头 + 戴红白头带、背号带循环箭头的大号小跑者
    rerunner() {
      const arrow = '#FFFFFF', shirt = '#E8453C', navy = '#2F4AA8';
      return shadow(50, 30) +
        TL('M77.6 26.9 A37 37 0 1 0 81.2 70', arrow, 7) + P('M88 58 L90.5 73.5 L74 69.6 Z', arrow, 3) +
        TL('M45 68 L35 77 L29 73', SKIN, 5.5) + TL('M56 68 L64 77 L61 87', SKIN, 5.5) +
        R(36, 63, 16, 11, 4, navy, 2.6) + R(51, 64, 15, 10, 4, navy, 2.6) +
        E(26, 73, 7.5, 4.4, '#fff', 2.6, -25) + L(21, 75, 29, 70, 2.4, '#E63946') + E(62, 88, 7.5, 4.2, '#fff', 2.6) + L(57, 88.5, 67, 88.5, 2.4, '#E63946') +
        TL('M40 45 L29 52 L25 43', SKIN, 5) + C(24, 41, 4.4, SKIN, 2.4) + TL('M60 45 L70 38 L77 42', SKIN, 5) + C(78, 42, 4.6, SKIN, 2.4) +
        E(50, 55, 16, 17, shirt) + R(42, 48, 16, 14, 2.5, '#fff', 2.4) +
        `<path d="M46 56 A4.4 4.4 0 1 1 51 59" fill="none" stroke="${navy}" stroke-width="2.2" stroke-linecap="round"/>` + P('M50 61 L53.5 58.5 L49.5 56.5 Z', navy, 1.2) +
        C(50, 29, 13, SKIN) + P('M37.5 23 Q40 12 51 13 Q61 13 62.5 24 Q55 18 49 20 Q42 18 37.5 23 Z', '#2B2140') +
        P('M37.5 27 Q50 21 62.5 27 L62 32 Q50 26 38 32 Z', '#E63946', 2.4) + L(40, 29.5, 60, 29.5, 1.6, '#fff') +
        S('M38.5 28 L29 22 M38.5 30 L30 33', '#E63946', 3.2) +
        eye(46, 33, 3.8, 0.35) + eye(55, 33, 3.8, 0.35) + openMouth(51, 38.5, 3.8, 1.6);
    },
    // 显摆王：墨镜金链、双臂秀肌肉（二头肌反光），周身闪光
    showoff() {
      const skin = '#E8A56F', top = '#FFD23F';
      return shadow(50, 30) +
        TL('M36 62 L18 58 L14 36', skin, 10) + C(23, 54, 8, skin, 2.8) + S('M17 50 Q22 46 28 50', '#FFE2C0', 2.2) + C(14, 31, 7.5, skin) + S('M10 29 L14 27', '#7A4A2A', 1.6) +
        TL('M64 62 L82 58 L86 36', skin, 10) + C(77, 54, 8, skin, 2.8) + S('M72 50 Q78 46 83 50', '#FFE2C0', 2.2) + C(86, 31, 7.5, skin) + S('M82 29 L86 27', '#7A4A2A', 1.6) +
        P('M28 88 Q27 62 50 56 Q73 62 72 88 Z', skin) + P('M36 88 L38 67 Q50 72 62 67 L64 88 Z', top, 2.6) + S('M45 76 L45 86 M55 76 L55 86', '#E0A020', 1.6) +
        S('M41 60 Q50 68 59 60', '#FFC93C', 3.4, ' stroke-dasharray="3 2"') + star(50, 68, 5, '#FFC93C', 1.8) +
        C(50, 40, 13, skin) +
        P('M38 31 Q38 17 50 17 Q62 17 64 29 Q56 22 50 27 Q44 22 38 31 Z', '#3B2A20', 2.4) + S('M44 20 Q50 17 56 19', '#6B4A38', 1.8) +
        P('M36 36 L64 36 L62 42 Q57 46 52.5 41 L47.5 41 Q43 46 38 42 Z', INK, 2) + S('M40 38.5 L44 38.5', '#fff', 1.8) + S('M54 38.5 L58 38.5', '#fff', 1.4) +
        teethGrin(50, 46, 6.5, 4) + dot(46, 48, 1.1, '#FFD23F') +
        star(7, 14, 5.5, '#fff', 2) + star(93, 14, 5.5, '#fff', 2) + star(50, 7, 4, '#fff', 1.6) + S('M20 12 L24 8 M80 12 L76 8', '#fff', 2);
    },
    // 灵魂伴侣：一大一小两只手牵手的小幽灵，头顶一颗爱心，小幽灵戴蝴蝶结
    soulmate() {
      const a = '#F5F1FF', b = '#FFD3E6';
      const ghost = (cx, top, w, f) => P(`M${cx - w} 82 L${cx - w} ${top + w} Q${cx - w} ${top} ${cx} ${top} Q${cx + w} ${top} ${cx + w} ${top + w} L${cx + w} 82 Q${cx + w * 0.66} 89 ${cx + w * 0.33} 82 Q${cx} 89 ${cx - w * 0.33} 82 Q${cx - w * 0.66} 89 ${cx - w} 82 Z`, f);
      return shadow(50, 36) +
        ghost(33, 30, 18, a) + ghost(68, 38, 15, b) +
        S('M20 72 Q24 76 26 72 M44 74 Q47 78 50 74', '#D8D0F0', 1.8) +
        E(50, 64, 8, 4.5, a, 2.4) + E(55, 64, 6, 4, b, 2.4) +
        lid(26, 50, 3.6) + lid(39, 50, 3.6) + E(23, 56, 3.4, 2, '#FF8FB8', 0) + E(43, 56, 3.4, 2, '#FF8FB8', 0) + smile(32.5, 56, 3.2, 1.8) +
        lid(62, 55, 3.2) + lid(73, 55, 3.2) + E(59, 60, 3, 1.8, '#FF6F9C', 0) + E(77, 60, 3, 1.8, '#FF6F9C', 0) + smile(67.5, 60, 2.8, 1.6) +
        P('M68 40 L61 35 L61 45 Z M68 40 L75 35 L75 45 Z', '#FF6FAE', 1.8) + C(68, 40, 2.2, '#E63946', 1.4) +
        P('M30 80 L33 76 L36 80 Z', '#7BA7FF', 1.6) +
        heart(51, 18, 11, '#E63946', 2.8) + heart(14, 34, 4, '#FF8FB8', 1.6) + heart(88, 52, 4.5, '#FF8FB8', 1.6) + S('M46 14 L49 11', '#fff', 1.8);
    },
    // 飙车魔：额头推着护目镜的小恶魔，身后喷火，双手握着方向盘
    speeddemon() {
      const red = '#E8402F', flame = '#FF8A1C', flameIn = '#FFE27A';
      return shadow(54, 30) +
        P('M38 40 Q22 28 4 33 Q16 39 14 44 Q3 48 2 57 Q16 54 20 58 Q10 66 13 73 Q27 64 40 67 Z', flame) +
        P('M38 47 Q26 40 14 43 Q22 49 19 55 Q29 54 38 61 Z', flameIn, 0) + S('M8 40 L13 41 M6 60 L12 58', INK, 1.6) +
        P('M72 83 Q91 85 88 69', 'none', 3) + P('M83 68 L92 62 L91 73 Z', red, 2.2) +
        BODY(red, 56, 66) + L(56, 68, 56, 88, 3, '#FFF1D0') + L(50, 70, 50, 88, 2, '#FFF1D0') + L(62, 70, 62, 88, 2, '#FFF1D0') +
        P('M41 33 L35 11 L52 26 Z', '#FFF1D0') + P('M71 33 L77 11 L60 26 Z', '#FFF1D0') + S('M38 24 L41 27 M73 24 L70 27', '#D9C79E', 1.6) +
        E(56, 47, 23, 19, red) +
        L(34, 34, 78, 34, 3.5) + C(48, 34, 7, '#8FE3FF', 2.8) + C(64, 34, 7, '#8FE3FF', 2.8) + S('M45 32 L48 30', '#fff', 1.8) + S('M61 32 L64 30', '#fff', 1.8) +
        eye(48, 49, 5, 0.35) + eye(64, 49, 5, 0.35) + P('M41 43 L53 45 M71 43 L59 45', 'none', 3) +
        teethGrin(57, 56, 10, 6) +
        TL('M40 84 A10 10 0 1 0 60 84 A10 10 0 1 0 40 84', '#3D405B', 3.2) + S('M42 82 L58 86 M50 76 L50 84', '#8E96AA', 1.6) + C(50, 84, 3, '#FFD23F', 1.6) +
        C(41, 80, 4.4, red, 2.4) + C(59, 80, 4.4, red, 2.4);
    },
    // 搅局鬼：抱臂撅嘴吐舌头，头顶冒烟，一旁的棋子被掀翻、棋盘翘起
    spoilsport() {
      const body = '#44C2B8';
      return shadow(48, 34) +
        g('rotate(-14 86 66)', R(75, 50, 22, 24, 2.5, '#F4E9CF', 2.6) + R(75, 50, 11, 12, 0, '#4A3A5C', 0) + R(86, 62, 11, 12, 0, '#4A3A5C', 0) + R(75, 50, 22, 24, 2.5, 'none', 2.6)) +
        g('translate(84 85) rotate(84)', P('M-6 7 L-4 -7 L4 -7 L6 7 Z', '#fff', 2.6) + R(-8, 6, 16, 3.5, 1.5, '#fff', 2.4) + E(0, -8, 5, 1.8, '#fff', 2) + C(0, -13.5, 5, '#fff')) + S('M92 70 L96 66 M80 94 L84 96', INK, 1.8) +
        E(36, 88, 8, 4.2, body, 2.6) + E(58, 88, 8, 4.2, body, 2.6) + S('M30 91 L27 93 M64 91 L67 93', INK, 1.8) +
        E(47, 58, 27, 29, body) + E(47, 70, 17, 16, '#7FDDD3', 0) +
        P('M44 30 Q41 21 48 23 Q50 16 55 23', 'none', 2.8) + C(60, 14, 3, '#fff', 1.6) + C(66, 8, 2.2, '#fff', 1.4) + C(54, 10, 2, '#fff', 1.2) +
        P('M23 70 Q47 61 71 71 Q69 80 47 76 Q27 80 23 70 Z', body, 2.6) + L(47, 65, 47, 76, 2.2) + S('M30 72 L36 74 M58 74 L64 72', '#2E9A90', 1.8) +
        P('M32 43 L40 47 L32 51', 'none', 3.2) + P('M62 43 L54 47 L62 51', 'none', 3.2) + P('M27 40 L40 43 M67 40 L54 43', 'none', 2.6) +
        E(29, 56, 4.8, 3.2, '#FF8FB8', 0) + E(65, 56, 4.8, 3.2, '#FF8FB8', 0) +
        P('M41 56 Q47 53 53 56', 'none', 2.6) + P('M43 56 Q43 65 47 65 Q51 65 51 56 Z', '#FF6B81', 2.4) + L(47, 58, 47, 62, 1.2) +
        S('M68 25 Q72 29 68 33 M75 25 Q71 29 75 33', '#E63946', 3);
    },
    // 后爸：鸭舌帽、八字胡、Polo 衫 + 围裙，举着烤肉铲，铲上一块汉堡肉
    stepdad() {
      const polo = '#2F8F5B', cap = '#E8453C';
      return shadow(50, 28) +
        BODY(polo, 50, 60) + P('M40 61 L50 69 L60 61 L57 57 L43 57 Z', '#fff', 2.2) +
        P('M36 72 L64 72 L66 88 L34 88 Z', '#F4E9CF', 2.6) + L(36, 76, 64, 76, 2, '#E8453C') + L(35, 82, 65, 82, 2, '#E8453C') + R(43, 78, 14, 8, 2, '#E8453C', 1.8) + S('M38 72 L42 62 M62 72 L58 62', INK, 2) +
        C(34, 66, 4.5, SKIN, 2.4) +
        C(50, 42, 16, SKIN) +
        P('M34 38 Q34 22 50 22 Q66 22 66 38 Z', cap) + P('M60 36 Q77 33 86 40 Q74 45 58 41 Z', cap, 2.6) + dot(50, 23, 2.2) + S('M40 28 Q44 25 48 25', '#FF9B9E', 2) +
        eye(44, 44, 4.2, 0.2) + eye(56, 44, 4.2, 0.2) + P('M39 38 L47 40 M61 38 L53 40', 'none', 2.4) +
        P('M37 53 Q43 47 50 51 Q57 47 63 53 Q59 59 50 56 Q41 59 37 53 Z', '#7A4E26', 2.2) + P('M44 59 Q50 62 56 59', 'none', 2.4) +
        TL('M70 75 L83 48', '#7A4E26', 3.5) + P('M78 46 L84 30 L94 34 L88 50 Z', '#C9CED9', 2.6) + L(84.5, 36, 88, 37.5, 1.6) + L(83, 41, 86.5, 42.5, 1.6) +
        E(87, 27, 8, 3.2, '#E8B060', 2) + E(87, 31, 8, 2.4, '#6A3A1A', 1.8) + E(87, 24.5, 5, 1.6, '#FFE0A0', 0) + S('M80 20 Q78 16 81 12 M91 18 Q93 14 91 10', '#fff', 2) +
        C(70, 75, 6, SKIN, 2.6);
    },
    // 裸奔侠：只套一只木桶的狂奔小子，挥舞双臂，头发倒竖、满头汗珠
    streaker() {
      const barrel = '#B9773F', rim = '#D9A066';
      return shadow(50, 28) +
        L(3, 54, 15, 54, 2.8) + L(1, 64, 12, 64, 2.8) + L(4, 74, 13, 74, 2.8) + C(8, 85, 3, '#fff', 1.8) + C(16, 87, 2.2, '#fff', 1.6) +
        TL('M42 76 L33 88', SKIN, 5) + TL('M58 76 L69 84', SKIN, 5) + E(31, 89, 5.5, 3, SKIN, 2.4) + E(71, 85, 5.5, 3, SKIN, 2.4) +
        TL('M32 52 L17 34', SKIN, 4.5) + C(15, 31, 4.5, SKIN, 2.4) + TL('M68 52 L84 38', SKIN, 4.5) + C(86, 36, 4.5, SKIN, 2.4) +
        P('M29 46 Q27 62 31 80 L69 80 Q73 62 71 46 Z', barrel) + hatch(34, 60, 3, 0, 5, 7, 1.57, '#8E5A2C', 1.4) + hatch(62, 62, 2, 0, 5, 7, 1.57, '#8E5A2C', 1.4) +
        P('M29.5 53 Q50 57 70.5 53 M30 72 Q50 76 70 72', '#9AA3B0', 3.4) + P('M29.5 53 Q50 57 70.5 53 M30 72 Q50 76 70 72', 'none', 1.2) + L(42, 49, 42, 79, 1.6) + L(58, 49, 58, 79, 1.6) +
        dot(33, 55, 1.1, '#fff') + dot(67, 55, 1.1, '#fff') + dot(34, 73.5, 1.1, '#fff') + dot(66, 73.5, 1.1, '#fff') +
        E(50, 46, 21, 4.8, rim, 2.6) +
        C(50, 31, 12.5, SKIN) +
        P('M37.5 29 Q33 22 38 18 Q39 12 45 15 Q48 8 53 14 Q60 10 62 18 Q67 22 62.5 29 Q57 24 50 25 Q43 24 37.5 29 Z', '#7A4E26', 2.4) +
        eye(45, 31, 3.8, 0.2) + lid(56, 32, 3.6) + openMouth(50, 37, 4.6, 2.4) + P('M40 26 L46 28 M60 26 L54 28', 'none', 1.8) +
        E(41, 36, 3, 1.8, '#FF9DB0', 0) + E(59, 36, 3, 1.8, '#FF9DB0', 0) + drop(70, 22) + drop(27, 20) + S('M74 14 L77 11 M24 12 L21 9', INK, 1.8);
    },
    // 电鳗：闪电形身子的鳗鱼，周身噼啪放电（亮蓝身体 + 黄色肚带 + 奶油贴纸边）
    stunner() {
      const eel = '#52C4FF', zig = 'M50 50 L68 62 L38 72 L62 84 L52 88';
      return shadow(50, 26) +
        TL(zig, eel, 13) + S(zig, '#FFE27A', 3.4, ' stroke-dasharray="4 6"') +
        P('M28 30 L14 20 L20 38 Z', eel, 2.4) + P('M70 30 L84 20 L78 38 Z', eel, 2.4) + P('M38 18 L42 8 L48 17 L53 7 L58 18', eel, 2.4) +
        E(49, 36, 25, 18, eel) + E(49, 45, 14, 7, '#BDEBFF', 0) +
        eye(39, 32, 7, 0, 0) + eye(59, 32, 7, 0, 0) + P('M31 24 L45 27 M67 24 L53 27', 'none', 3) +
        openMouth(49, 43, 9, 3.6) + P('M41 44 L43 48 L45 44.5 M53 44.5 L55 48 L57 44', '#fff', 1.4) +
        S('M18 44 L8 46 M80 44 L90 46', '#BDEBFF', 2) +
        bolt(12, 18, 1, '#FFE27A') + bolt(88, 14, 1, '#FFE27A') + bolt(88, 62, 0.85) + bolt(14, 64, 0.85);
    },
    // 调包精：戴「蒙面」花纹的浣熊，环纹大尾巴，脚边两只对换的箭头
    switcharoo() {
      const fur = '#A2A8B8', mask = '#2E2A40', light = '#ECEEF4';
      const tail = 'M64 80 Q90 82 90 60 Q90 46 80 44';
      return shadow(50, 32) +
        TL(tail, fur, 10) + DS(tail, mask, 10, '5 6') +
        BODY(fur, 46, 62) + E(46, 77, 10, 9, light, 2.2) + hatch(30, 74, 3, 3, 0, 5, 1.5, '#8890A4', 1.6) + hatch(58, 74, 3, 3, 0, 5, 1.5, '#8890A4', 1.6) +
        E(30, 87, 6, 3.4, mask, 2.4) + E(62, 87, 6, 3.4, mask, 2.4) +
        C(28, 27, 8.5, fur) + C(28, 27, 3.8, mask, 0) + C(64, 27, 8.5, fur) + C(64, 27, 3.8, mask, 0) +
        P('M20 46 Q20 26 46 26 Q72 26 72 46 Q72 61 46 63 Q20 61 20 46 Z', fur) +
        P('M22 44 Q28 33 38 37 Q46 41 54 37 Q64 33 70 44 Q64 52 54 48 Q46 46 38 48 Q28 52 22 44 Z', mask, 2) +
        C(36, 43, 4.8, '#fff', 2) + dot(38, 43.5, 2.5) + dot(37, 42.5, 0.9, '#fff') + C(56, 43, 4.8, '#fff', 2) + dot(58, 43.5, 2.5) + dot(57, 42.5, 0.9, '#fff') +
        E(46, 55, 8.5, 6, light, 2.2) + E(46, 51.5, 3.6, 2.5, INK, 0) + P('M42 57.5 Q46 60 51 56.5', 'none', 2.2) + S('M37 56 L28 54 M37 58 L28 60 M55 56 L64 54 M55 58 L64 60', INK, 1.4) +
        TL('M10 74 Q22 64 34 72', '#FFD23F', 3) + P('M30 66 L38 74 L28 76 Z', '#FFD23F', 2) +
        TL('M34 86 Q22 94 10 84', '#FF6FAE', 3) + P('M14 79 L7 87 L16 90 Z', '#FF6FAE', 2);
    },
    // 跟屁虫：探头往前瞄的小甲虫，壳上高光，身后一串小脚印
    tail() {
      const shell = '#F2545B', head = '#2E2A40';
      return shadow(52, 30) +
        dot(6, 86, 1.8) + dot(11, 82, 1.8) + dot(16, 86, 1.8) + dot(21, 82, 1.8) + dot(26, 86, 1.4) +
        L(38, 80, 32, 89, 3) + L(52, 84, 52, 91, 3) + L(66, 80, 72, 89, 3) + L(32, 89, 28, 89, 2.4) + L(72, 89, 76, 89, 2.4) +
        S('M77 48 Q73 36 66 33', INK, 2.8) + dot(66, 33, 3.2) + S('M85 48 Q89 36 95 33', INK, 2.8) + dot(95, 33, 3.2) +
        C(80, 60, 13, head) + S('M72 52 Q75 49 80 49', '#7A74A0', 2) +
        E(52, 66, 27, 21, shell) + L(52, 46, 52, 87, 2.8) +
        dot(41, 58, 4.4) + dot(63, 58, 4.4) + dot(39, 74, 3.6) + dot(65, 74, 3.6) + dot(45, 80, 2.2) + dot(59, 80, 2.2) +
        S('M33 54 Q38 47 46 47', '#fff', 2.8) + S('M31 62 Q31 59 32 57', '#fff', 2) +
        eye(77, 58, 5, 0.45) + eye(88, 58, 4.6, 0.45) + smile(84, 66, 3.6, 1.8) + S('M71 54 L76 55 M92 55 L88 55', INK, 1.8);
    },
    // 水龙头：拧红把手的水龙头，哗哗出水溅一地，管口滴水 + 铬面高光
    hose() {
      const chrome = '#CBD3E1', water = '#4CC9F0';
      return shadow(46, 34) +
        E(77, 88, 17, 4, '#B5EEFF', 2.2) + S('M66 88 Q77 91 88 88', '#fff', 1.4) +
        P('M73 58 Q71 74 68 87 L83 87 Q80 74 82 58 Z', water, 2.4) + S('M75 62 Q74 74 72 84', '#C9F1FF', 2) + C(60, 80, 2.6, water, 1.8) + C(92, 78, 2.4, water, 1.6) + C(63, 70, 2, water, 1.6) + C(94, 86, 1.6, water, 1.2) +
        R(22, 82, 32, 6, 3, '#AEB5C4') + R(27, 66, 18, 17, 3, chrome) + S('M30 69 L30 80', '#fff', 2) + dot(32, 85, 1, INK) + dot(44, 85, 1, INK) +
        L(36, 40, 36, 28, 4.5) + R(21, 21, 30, 8, 4, '#E63946', 2.8) + C(36, 25, 3.4, '#fff', 1.8) + S('M25 24 L30 24', '#FF9B9E', 1.8) +
        P('M48 43 L76 43 Q86 43 86 53 L86 59 L71 59 L71 56 Q71 54 69 54 L48 54 Z', chrome) + S('M52 46 L74 46', '#fff', 2) + R(70, 58, 17, 4, 1.5, '#AEB5C4', 2) +
        R(14, 38, 42, 32, 12, chrome) +
        S('M20 46 Q21 42 26 41', '#fff', 2.6) + S('M20 64 Q24 67 30 67', '#AEB5C4', 1.8) +
        eye(28, 52, 4.8, 0.3) + eye(42, 52, 4.8, 0.3) + smile(35, 60, 5, 2.4) + E(22, 58, 2.4, 1.6, '#FF9DB0', 0) + E(48, 58, 2.4, 1.6, '#FF9DB0', 0);
    },
    // 替补演员：大皱领、羽毛帽的莎剧演员，手握台词卷轴，腰间挂着一副金面具
    understudy() {
      const doublet = '#6A2C91', skin = SKIN;
      let pleats = '';
      for (let i = 0; i < 9; i++) { const a = Math.PI * (0.06 + i * 0.11); pleats += L(50 - 14 * Math.cos(a), 62 + 3 * Math.sin(a), 50 - 24 * Math.cos(a), 62 + 7.5 * Math.sin(a), 1.6); }
      return shadow(50, 28) +
        BODY(doublet, 52, 62) + dot(52, 72, 2, '#FFD23F') + dot(52, 79, 2, '#FFD23F') + P('M38 70 L42 80 M66 70 L62 80', 'none', 2) +
        C(76, 70, 7, '#8B45B8', 2.6) + S('M72 66 L80 74 M70 70 L78 77', '#5A1E7A', 1.6) +
        E(70, 82, 5, 5.5, '#FFD23F', 2.2) + dot(68, 81, 1.2) + dot(72, 81, 1.2) + P('M67.5 84 Q70 86 72.5 84', 'none', 1.4) +
        E(50, 62, 26, 8.5, '#fff') + pleats +
        E(50, 43, 14, 16, skin) +
        P('M44 53 L50 62 L56 53 Z', '#7A4E26', 2.2) + P('M42 51 Q46 48 50 51 Q54 48 58 51', 'none', 2.4) +
        eye(44.5, 42, 4.4, 0, -0.35) + eye(55.5, 42, 4.4, 0, -0.35) + P('M39 34 Q44 31 48 34 M52 34 Q56 31 61 34', 'none', 2.6) +
        P('M34 33 Q35 20 50 20 Q66 20 67 31 Q52 27 34 33 Z', '#2E2A40') + P('M60 24 Q76 4 90 9 Q78 14 67 28 Z', '#FFD23F', 2.4) + P('M66 22 Q76 12 86 11', 'none', 1.6) +
        R(9, 57, 18, 26, 2, '#FFF1D0', 2.6) + E(18, 57, 10, 3.2, '#FFF1D0', 2.4) + E(18, 83, 10, 3.2, '#FFF1D0', 2.4) +
        L(13, 64, 23, 64, 1.6) + L(13, 69, 23, 69, 1.6) + L(13, 74, 20, 74, 1.6) +
        C(28, 72, 5.5, skin, 2.6) + C(82, 56, 4.4, skin, 2.4);
    },
  };

  // 深底卡面（亮度低）的角色自动加奶油色贴纸边；个别可用 RIM 覆盖
  const RIM_FORCE = { nemesis: true, showoff: true };
  for (const id of Object.keys(DRAW)) {
    const fn = DRAW[id];
    const rim = id in RIM_FORCE ? RIM_FORCE[id] : lum(COL[id]) < 0.3;
    Art.register(id, () => {
      cur = { rim, defs: '', ground: '', rimBuf: '' };
      try {
        const body = fn();
        return (cur.defs ? `<defs>${cur.defs}</defs>` : '') + cur.ground + cur.rimBuf + body;
      } finally { cur = null; }
    }, COL[id]);
  }
  return Art;
});
