// 胡闹运动会 · 版图美术：按实物版图复原（黑底白边的体育场赛道、五色循环格、里程红格、特殊格、领奖台拱门、中央场景）
// 纯函数，返回 SVG 字符串；坐标全部是 app.js 里 GEO 的版图坐标。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BoardArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const INK = '#231F33';
  // 实物格色：1 粉、2 黄、3 绿、4 蓝、5 红（里程格），之后循环
  const CELL = ['#E95DB4', '#FFB81C', '#2FA23C', '#3B86F2', '#F4432A'];
  // 红格上的里程数字颜色：5 蓝 · 10 粉 · 15 黄 · 20 绿 · 25 蓝
  const MILE_INK = { 5: '#3B86F2', 10: '#FF9AD3', 15: '#FFC62E', 20: '#3DBE55', 25: '#3B86F2' };
  const cellColor = (p) => CELL[(p - 1 + 5) % 5];
  const f = (v) => +(+v).toFixed(1);

  // 圆角矩形路径，四角半径 [左上, 右上, 右下, 左下]
  function rrect(x, y, w, h, r) {
    const [a, b, c, d] = r;
    return `M${f(x + a)} ${f(y)}H${f(x + w - b)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + b)}V${f(y + h - c)}Q${f(x + w)} ${f(y + h)} ${f(x + w - c)} ${f(y + h)}H${f(x + d)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - d)}V${f(y + a)}Q${f(x)} ${f(y)} ${f(x + a)} ${f(y)}Z`;
  }

  /* ---------- 特殊格图块：紫框小方块 + 图标 ---------- */
  function arrowShape(n, ang) {
    const fwd = n > 0;
    const col = fwd ? '#2FB36A' : '#F2553C';
    return `<g transform="rotate(${f(ang + (fwd ? 0 : 180))})"><path d="M-17 -7H3V-15L19 0L3 15V7H-17Z" fill="${col}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/></g>`
      + `<text x="${fwd ? -4 : 4}" y="5.5" font-size="14" font-weight="900" text-anchor="middle" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">${Math.abs(n)}</text>`;
  }
  function tile(type, n, ang, cx, cy, s) {
    const half = s / 2;
    let g = `<rect x="${f(-half)}" y="${f(-half)}" width="${f(s)}" height="${f(s)}" rx="7" fill="#F6EEFF" stroke="#6A35B8" stroke-width="3.2"/>`;
    const k = s / 49;
    if (type === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 9 : 21; pts.push(`${f(r * Math.cos(a))},${f(r * Math.sin(a))}`); }
      g += `<g transform="scale(${f(k)})"><polygon points="${pts.join(' ')}" fill="#FFC21A" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><text y="5.5" font-size="15" font-weight="900" text-anchor="middle" fill="${INK}">1</text></g>`;
    } else if (type === 'rock') {
      g += `<g transform="scale(${f(k)})"><path d="M-18 8Q-20 -8 -7 -12Q5 -17 13 -7Q22 0 17 8Z" fill="#A9A2B6" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M-6 -3q6 -4 12 0" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/><text y="19" font-size="9.5" font-weight="900" text-anchor="middle" fill="#F2553C" stroke="#fff" stroke-width="2.4" paint-order="stroke" font-style="italic">TRIP!</text></g>`;
    } else if (type === 'arrow') {
      g += `<g transform="scale(${f(k)})">${arrowShape(n, ang)}</g>`;
    }
    return `<g transform="translate(${f(cx)} ${f(cy)})">${g}</g>`;
  }

  /* ---------- 中央场景 ---------- */
  const petals = (x, y, r, n, col, mid) => {
    let s = '';
    for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n; s += `<circle cx="${f(x + Math.cos(a) * r * .62)}" cy="${f(y + Math.sin(a) * r * .62)}" r="${f(r * .46)}" fill="${col}" stroke="${INK}" stroke-width="1.4"/>`; }
    return s + `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * .38)}" fill="${mid}" stroke="${INK}" stroke-width="1.4"/>`;
  };
  function flower(x, base, h, kind) {
    const y = base - h;
    let s = `<path d="M${f(x)} ${f(base)}Q${f(x + 4)} ${f(base - h / 2)} ${f(x)} ${f(y)}" stroke="#2D8A3E" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M${f(x)} ${f(base - h * .4)}q-9 -7 -13 -2q6 7 13 2Z" fill="#3FAE52" stroke="${INK}" stroke-width="1.2"/>`;
    if (kind === 'tulip') s += `<path d="M${f(x - 11)} ${f(y - 14)}Q${f(x - 12)} ${f(y + 7)} ${f(x)} ${f(y + 8)}Q${f(x + 12)} ${f(y + 7)} ${f(x + 11)} ${f(y - 14)}L${f(x + 5)} ${f(y - 6)}L${f(x)} ${f(y - 15)}L${f(x - 5)} ${f(y - 6)}Z" fill="#fff" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
    else if (kind === 'poppy') s += petals(x, y, 17, 6, '#F4432A', '#7A1E12');
    else if (kind === 'daisy') s += petals(x, y, 17, 8, '#F26FB8', '#FFC62E');
    else if (kind === 'bow') s += `<ellipse cx="${f(x - 9)}" cy="${f(y)}" rx="10" ry="7" fill="#FFD23A" stroke="${INK}" stroke-width="1.5"/><ellipse cx="${f(x + 9)}" cy="${f(y)}" rx="10" ry="7" fill="#FFD23A" stroke="${INK}" stroke-width="1.5"/><circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="#F7A41C" stroke="${INK}" stroke-width="1.4"/>`;
    else s += `<ellipse cx="${f(x)}" cy="${f(y + 2)}" rx="8" ry="10" fill="#9B6BDC" stroke="${INK}" stroke-width="1.6"/><path d="M${f(x - 8)} ${f(y - 6)}l3 -9 l3 7 l2 -9 l3 9 l3 -7 l3 9" stroke="#E9DAFF" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`;
    return s;
  }
  function cat(x, y, flip) {
    const d = flip ? -1 : 1;
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${d} 1)"><ellipse cx="0" cy="0" rx="36" ry="17" fill="#5573DB" stroke="${INK}" stroke-width="2"/><path d="M-12 -14q3 8 0 16M2 -16q3 9 0 18M16 -14q3 8 0 15" stroke="#2D3F9C" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M30 6q22 4 18 -14q-2 8 -14 6" fill="#5573DB" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><circle cx="-30" cy="-8" r="14" fill="#5573DB" stroke="${INK}" stroke-width="2"/><path d="M-40 -19l2 -11l8 7M-24 -22l5 -9l3 11" fill="#5573DB" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><circle cx="-35" cy="-9" r="2.4" fill="${INK}"/><circle cx="-26" cy="-9" r="2.4" fill="${INK}"/><path d="M-36 -2q5 4 10 0" stroke="${INK}" stroke-width="1.8" fill="none" stroke-linecap="round"/></g>`;
  }
  function sceneMild(g) {
    const cx = g.x + g.w / 2, y0 = g.y + g.h;
    let s = `<path d="M${f(g.x + 14)} ${f(y0 - 4)}Q${f(g.x + 40)} ${f(y0 - 62)} ${f(g.x + 200)} ${f(y0 - 58)}H${f(g.x + g.w - 200)}Q${f(g.x + g.w - 40)} ${f(y0 - 62)} ${f(g.x + g.w - 14)} ${f(y0 - 4)}Z" fill="#7FA83A" stroke="${INK}" stroke-width="2"/>`;
    s += `<ellipse cx="${f(cx)}" cy="${f(y0 - 30)}" rx="${f(g.w * .36)}" ry="14" fill="none" stroke="#F0762A" stroke-width="9"/><ellipse cx="${f(cx)}" cy="${f(y0 - 30)}" rx="${f(g.w * .36)}" ry="14" fill="none" stroke="#B94E12" stroke-width="2" stroke-dasharray="5 7"/>`;
    s += cat(g.x + 92, y0 - 38, false) + cat(g.x + g.w - 92, y0 - 38, true);
    const L = [[34, 'daisy', 74], [150, 'tulip', 64], [188, 'poppy', 60], [60, 'thistle', 52]];
    for (const [dx, kind, h] of L) s += flower(g.x + dx, y0 - 8, h, kind);
    const R = [[34, 'bow', 66], [78, 'daisy', 58], [150, 'poppy', 70], [188, 'tulip', 56]];
    for (const [dx, kind, h] of R) s += flower(g.x + g.w - dx, y0 - 8, h, kind);
    return s;
  }
  const tree = (x, base, h) => `<rect x="${f(x - 3)}" y="${f(base - 8)}" width="6" height="9" fill="#6B3F1D"/>` + [0, 1, 2].map((i) => `<path d="M${f(x - h * (.34 - i * .08))} ${f(base - 6 - i * h * .27)}L${f(x)} ${f(base - h * (.55 + i * .27))}L${f(x + h * (.34 - i * .08))} ${f(base - 6 - i * h * .27)}Z" fill="${['#1B6E3A', '#23884A', '#2FA05B'][i]}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`).join('');
  const shroom = (x, y, r, col) => `<rect x="${f(x - r * .25)}" y="${f(y - 2)}" width="${f(r * .5)}" height="${f(r * .8)}" fill="#F3EAD2" stroke="${INK}" stroke-width="1.4"/><path d="M${f(x - r)} ${f(y)}Q${f(x)} ${f(y - r * 1.5)} ${f(x + r)} ${f(y)}Z" fill="${col}" stroke="${INK}" stroke-width="1.6"/><circle cx="${f(x - r * .3)}" cy="${f(y - r * .5)}" r="${f(r * .17)}" fill="#fff"/><circle cx="${f(x + r * .3)}" cy="${f(y - r * .4)}" r="${f(r * .14)}" fill="#fff"/>`;
  function sceneWild(g) {
    const y0 = g.y + g.h;
    let s = `<path d="M${f(g.x + 12)} ${f(y0 - 4)}Q${f(g.x + 40)} ${f(y0 - 48)} ${f(g.x + 150)} ${f(y0 - 44)}Q${f(g.x + g.w / 2)} ${f(y0 - 30)} ${f(g.x + g.w - 150)} ${f(y0 - 44)}Q${f(g.x + g.w - 40)} ${f(y0 - 48)} ${f(g.x + g.w - 12)} ${f(y0 - 4)}Z" fill="#7B3FB8" stroke="${INK}" stroke-width="2"/>`;
    for (const [dx, h] of [[34, 92], [74, 112], [120, 84], [168, 70]]) s += tree(g.x + dx, y0 - 20 - (dx % 3) * 3, h);
    for (const [dx, h] of [[34, 80], [78, 100], [124, 70]]) s += tree(g.x + g.w - dx, y0 - 20 - (dx % 3) * 3, h);
    // 帐篷
    s += `<path d="M${f(g.x + 196)} ${f(y0 - 12)}L${f(g.x + 226)} ${f(y0 - 58)}L${f(g.x + 256)} ${f(y0 - 12)}Z" fill="#EF6AA8" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M${f(g.x + 226)} ${f(y0 - 12)}L${f(g.x + 218)} ${f(y0 - 12)}L${f(g.x + 226)} ${f(y0 - 36)}L${f(g.x + 234)} ${f(y0 - 12)}Z" fill="${INK}"/>`;
    // 蜗牛
    const sx = g.x + 156, sy = y0 - 22;
    s += `<ellipse cx="${f(sx + 14)}" cy="${f(sy + 8)}" rx="22" ry="7" fill="#7FD04A" stroke="${INK}" stroke-width="1.8"/><circle cx="${f(sx)}" cy="${f(sy - 2)}" r="14" fill="#F26FB8" stroke="${INK}" stroke-width="2"/><path d="M${f(sx)} ${f(sy - 2)}m0 -3a3 3 0 1 1 -3 3a6 6 0 1 1 6 6a9 9 0 1 1 -9 -9" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><path d="M${f(sx + 30)} ${f(sy + 4)}l4 -12M${f(sx + 36)} ${f(sy + 5)}l7 -10" stroke="#7FD04A" stroke-width="2.4" stroke-linecap="round"/>`;
    s += shroom(g.x + g.w - 170, y0 - 14, 12, '#F4432A') + shroom(g.x + g.w - 148, y0 - 12, 8, '#FFB81C') + shroom(g.x + 270, y0 - 12, 9, '#F4432A');
    s += `<ellipse cx="${f(g.x + g.w - 236)}" cy="${f(y0 - 14)}" rx="26" ry="8" fill="#6FB6F2" stroke="${INK}" stroke-width="1.8"/><ellipse cx="${f(g.x + g.w - 206)}" cy="${f(y0 - 10)}" rx="10" ry="6" fill="#A9A2B6" stroke="${INK}" stroke-width="1.6"/>`;
    return s;
  }
  function scene(key, g) {
    if (key === 'mild') return sceneMild(g);
    if (key === 'wild') return sceneWild(g);
    return '';
  }

  /* ---------- 领奖台拱门（实物版图左侧：金杯 1ST + 银奖章 2ND + 方格旗底边） ---------- */
  function arch(pod) {
    const { x, y, w, h } = pod, r = w / 2, cx = x + r;
    const rays = [];
    for (let i = 0; i < 14; i++) {
      const a0 = Math.PI + i * Math.PI / 14, a1 = a0 + Math.PI / 28;
      rays.push(`<path d="M${f(cx)} ${f(y + 70)}L${f(cx + Math.cos(a0) * 90)} ${f(y + 70 + Math.sin(a0) * 90)}L${f(cx + Math.cos(a1) * 90)} ${f(y + 70 + Math.sin(a1) * 90)}Z" fill="${i % 2 ? '#F4432A' : '#FFB81C'}"/>`);
    }
    const ty = y + 52;
    let s = `<defs><clipPath id="archClip"><path d="${rrect(x + 3, y + 3, w - 6, h - 6, [r - 3, r - 3, 6, 6])}"/></clipPath><pattern id="chk2" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#fff"/><rect width="7" height="7" fill="${INK}"/><rect x="7" y="7" width="7" height="7" fill="${INK}"/></pattern></defs>`;
    s += `<path d="${rrect(x, y, w, h, [r, r, 8, 8])}" fill="#0D0B14" stroke="#fff" stroke-width="3"/>`;
    s += `<g clip-path="url(#archClip)"><circle cx="${f(cx)}" cy="${f(y + 70)}" r="64" fill="#FFD36B"/>${rays.join('')}<circle cx="${f(cx)}" cy="${f(y + 70)}" r="42" fill="#FFF1B8" stroke="${INK}" stroke-width="2.5"/></g>`;
    // 金杯
    s += `<g transform="translate(${f(cx)} ${f(ty)})"><path d="M-17 -22H17V-8Q17 8 0 10Q-17 8 -17 -8Z" fill="#F5B41A" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/><path d="M-17 -18Q-30 -18 -26 -6Q-23 2 -15 2M17 -18Q30 -18 26 -6Q23 2 15 2" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/><rect x="-4" y="10" width="8" height="8" fill="#F5B41A" stroke="${INK}" stroke-width="2.2"/><rect x="-14" y="18" width="28" height="8" rx="2" fill="#C98A0B" stroke="${INK}" stroke-width="2.2"/><text y="-2" font-size="16" font-weight="900" text-anchor="middle" fill="${INK}">1<tspan font-size="8" dy="-6">ST</tspan></text></g>`;
    // 2ND 奖章
    s += `<g transform="translate(${f(x + w - 30)} ${f(y + 120)})"><path d="M-9 8L-12 24L-4 20L0 26L4 20L12 24L9 8Z" fill="#3B86F2" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><circle r="12" fill="#D6DEE9" stroke="${INK}" stroke-width="2.2"/><text y="4" font-size="11" font-weight="900" text-anchor="middle" fill="${INK}">2</text></g>`;
    return s;
  }

  return { CELL, MILE_INK, cellColor, rrect, tile, scene, arch, arrowShape, INK };
});
