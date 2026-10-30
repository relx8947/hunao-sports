'use strict';
const { assert, test, setup, dice, run, turn, move, R, ev, said, pos, twist } = require('./helpers');
const { TRACKS, GOLD, SILVER } = require('../../game/tracks');

// 变数卡、赛道格与通用规则（回合顺序、绊倒、冲线结束、计分、先手、全员出局、规则 8、混合模式）
// 中性运动员：legs / mole / cheatah 只多一个「主移动方式」选项（驱动时默认掷骰），不影响别的结算。

/* ---------- 本文件的小工具 ---------- */
const STOP = { stop: true };
// 从 start 席位跑 raceLoop：比赛结束（g.ended）或第 maxTurns+1 个回合开始前停下。返回依次行动的运动员。
function loop(g, start, answers = {}, maxTurns = Infinity) {
  const take = g.takeTurn;
  let k = 0;
  g.takeTurn = function* (r) { if (k++ >= maxTurns) throw STOP; yield* take.call(this, r); };
  try { run(g, g.raceLoop(start), answers); } catch (e) { if (e !== STOP) throw e; }
  delete g.takeTurn;
  return ev(g, 'turn').map((e) => e.rid);
}
// 和夹具 twist() 一样，但先把招牌标记为已翻过（真实对局里翻卡前就置位），避免结算中越过第 14 格又翻一张。
function draw(ids, list, opts = {}, answers) {
  const g = setup(list, opts);
  g.twistDeck = [].concat(ids);
  g.twistDone = true;
  run(g, g.drawTwist(g.racers[0]), answers);
  return g;
}
const scores = (g) => g.players.map((p) => g.score(p.seat));
const idx = (g, pred) => g.events.findIndex(pred);
const moves = (g) => ev(g, 'move').map((e) => [e.rid, e.from, e.to, e.kind]);
const V1W = { edition: 'v1', track: 'wild' };
const WH = { track: 'whirly' };

/* ================================================================
 * 一、变数卡
 * ================================================================ */

/* ---------- 撞头虫 ---------- */
test('撞头虫：本场之后停在第 28 格后退 5 到 23，停在第 29 格后退 5 到 24', () => {
  const g = draw('bonkbug', [['legs', 14], ['mole', 20], ['cheatah', 25]]);
  assert(g.twistOn('bonkbug'));
  move(g, 'mole', 8);
  assert.strictEqual(R(g, 'mole').pos, 23);
  move(g, 'cheatah', 4);
  assert.strictEqual(R(g, 'cheatah').pos, 24);
  assert.deepStrictEqual(ev(g, 'space').map((e) => [e.space, e.pos]), [['bonkbug', 28], ['bonkbug', 29]]);
  assert.deepStrictEqual(moves(g).filter((m) => m[3] === 'twist').map((m) => [m[1], m[2]]), [[28, 23], [29, 24]]);
});
test('撞头虫：没翻到这张时停在 28 不后退', () => {
  const g = setup([['legs', 14], ['mole', 20]], { track: 'mild' });
  move(g, 'mole', 8);
  assert.strictEqual(R(g, 'mole').pos, 28);
});
test('撞头虫：停在 27 不受影响；从 27 走 5 格越过 28、29 直接冲线', () => {
  const g = draw('bonkbug', [['legs', 14], ['mole', 20], ['cheatah', 27]]);
  move(g, 'mole', 7);
  assert.strictEqual(R(g, 'mole').pos, 27);
  move(g, 'cheatah', 5);
  assert.strictEqual(R(g, 'cheatah').finished, 1);
  assert.strictEqual(ev(g, 'space').length, 0);
});
test('撞头虫：技能移动、单人瞬移停到 28/29 同样后退 5', () => {
  const g = draw('bonkbug', [['legs', 14], ['mole', 25], ['cheatah', 10]]);
  move(g, 'mole', 3, 'power');
  assert.strictEqual(R(g, 'mole').pos, 23);
  run(g, g.warp(R(g, 'cheatah'), 29, '瞬移'));
  assert.strictEqual(R(g, 'cheatah').pos, 24);
});
test('撞头虫：后退 5 格之后的落点照常结算（退到小旅馆的格子要付房费）', () => {
  const g = draw('bonkbug', [['legs', 14], ['mole', 25], ['hotel', 23]]);
  g.giveChip(1, 'bronze', 1);
  move(g, 'mole', 3);
  assert.strictEqual(R(g, 'mole').pos, 23);
  assert.deepStrictEqual(scores(g), [0, 0, 1]);
});
test('[口径] 撞头虫：翻卡时已经站在 28 格的人不后退，之后再停到 29 才后退', () => {
  const g = draw('bonkbug', [['legs', 14], ['mole', 28]]);
  assert.strictEqual(R(g, 'mole').pos, 28);
  move(g, 'mole', 1);
  assert.strictEqual(R(g, 'mole').pos, 24);
});

/* ---------- 镜像世界 ---------- */
test('镜像世界：每人位置 p 变成 30-p；第 15 格不动；已冲线的人不受影响', () => {
  const g = draw('mirror', [['legs', 14], ['mole', 15], ['cheatah', 3], ['hotel', 30, { finished: 1 }]]);
  assert.deepStrictEqual(pos(g), { legs: 16, mole: 15, cheatah: 27, hotel: 30 });
  assert.deepStrictEqual(ev(g, 'warp').map((e) => e.rid).sort(), ['cheatah', 'legs']);
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(g.mirrored, true);
});
test('镜像世界：还在起点的人直接冲线拿名次分；两人同时冲线按回合顺序排名并结束比赛', () => {
  // 第 1 席翻卡：回合顺序 1 → 2 → 0
  const g = setup([['mole', 0], ['legs', 14], ['cheatah', 0]]);
  g.curSeat = 1; g.twistDone = true; g.twistDeck = ['mirror'];
  run(g, g.drawTwist(R(g, 'legs')));
  assert.strictEqual(R(g, 'cheatah').finished, 1);
  assert.strictEqual(R(g, 'mole').finished, 2);
  assert.deepStrictEqual(scores(g), [1, 0, 3]);
  assert.strictEqual(g.ended, true);
});
test('镜像世界：只有一人在起点时他冲线拿金牌，比赛继续', () => {
  const g = draw('mirror', [['legs', 14], ['mole', 0], ['cheatah', 8]]);
  assert.strictEqual(R(g, 'mole').finished, 1);
  assert.strictEqual(g.ended, undefined);
  assert.deepStrictEqual(scores(g), [0, 3, 0]);
});
test('镜像世界 + 皮纳塔：赛道上的分跟着翻转（第 13–29 格的分变到 1–17 格）', () => {
  const g = draw(['chaos', 'pinata', 'mirror'], [['legs', 14], ['mole', 20]]);
  assert.deepStrictEqual(g.coins.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17]);
  assert.deepStrictEqual(pos(g), { legs: 16, mole: 10 });
});
test('[口径] 镜像世界是同时瞬移，翻到 28/29 不触发撞头虫', () => {
  const g = draw(['chaos', 'bonkbug', 'mirror'], [['legs', 14], ['mole', 2], ['cheatah', 1]]);
  assert.deepStrictEqual(pos(g), { legs: 16, mole: 28, cheatah: 29 });
  assert.strictEqual(ev(g, 'space').length, 0);
});
test('[口径] 镜像世界 + 炼金实验室：狼人怪也翻转，从起点翻到 30，下次前进时直接离场', () => {
  const g = draw(['chaos', 'alchemylab', 'mirror'], [['legs', 14], ['mole', 20]]);
  assert.strictEqual(g.monster, 30);
  dice(g, [3]);
  run(g, g.moveMonster());
  assert.strictEqual(g.monster, null);
  assert(!R(g, 'mole').out && !R(g, 'legs').out);
});

/* ---------- 诅咒魔杖 ---------- */
test('诅咒魔杖：翻卡的那个回合结束就开始掷骰跳人（掷 1 跳过下家）', () => {
  const g = setup([['legs', 13], ['mole', 0], ['cheatah', 27]]);
  g.twistDeck = ['cursewands'];
  dice(g, [1, 1, 3, 1]); // 腿 1 → 14 翻卡；诅咒 1 → 2 号席；豹 3 冲线；诅咒 1 → 1 号席
  const order = loop(g, 0, {}, 3 - 1);
  assert.deepStrictEqual(order, ['legs', 'cheatah']);
  assert.deepStrictEqual(ev(g, 'curse').map((e) => [e.seat, e.value, e.next]), [[0, 1, 2], [2, 1, 1]]);
  assert.strictEqual(R(g, 'cheatah').finished, 1);
});
test('诅咒魔杖：两人局掷 1 跳过对手，又轮到自己；掷 2 才轮到对手', () => {
  const g = setup([['legs', 15], ['mole', 5]]);
  g.twistActive = new Set(['cursewands']);
  dice(g, [1, 1, 1, 2, 1, 2]); // 腿 1、诅咒 1（跳过对手）→ 腿 1、诅咒 2 → 鼹鼠 1、诅咒 2
  assert.deepStrictEqual(loop(g, 0, {}, 3), ['legs', 'legs', 'mole']);
  assert.deepStrictEqual(ev(g, 'curse').map((e) => [e.seat, e.value, e.next]), [[0, 1, 0], [0, 2, 1], [1, 2, 0]]);
});
test('诅咒魔杖：没有翻到时照常按顺序轮流', () => {
  const g = setup([['legs', 15], ['mole', 5], ['cheatah', 5]], { track: 'mild' });
  dice(g, [1, 1, 1]);
  assert.deepStrictEqual(loop(g, 0, {}, 3), ['legs', 'mole', 'cheatah']);
  assert.strictEqual(ev(g, 'curse').length, 0);
});
test('[口径] 诅咒魔杖：已冲线/淘汰的玩家也算在被跳过的人数里', () => {
  const g = setup([['legs', 15], ['mole', 30, { finished: 1 }], ['cheatah', 5]]);
  g.twistActive = new Set(['cursewands']);
  dice(g, [1, 1, 1, 3]); // 腿 1、诅咒 1：跳过已冲线的 1 号席，轮到 2 号席；豹 1、诅咒 3 → 0 号席
  assert.deepStrictEqual(loop(g, 0, {}, 2), ['legs', 'cheatah']);
  assert.deepStrictEqual(ev(g, 'curse')[0].next, 2);
});
test('诅咒魔杖：轮到没有在场运动员的玩家时他没有回合，不该替他掷诅咒骰', () => {
  const g = setup([['legs', 5], ['mole', 30, { finished: 1 }], ['cheatah', 5]], { track: 'mild' });
  g.twistActive = new Set(['cursewands']);
  // 腿掷 1；诅咒掷 3 → 跳过 1、2、0 号席，落到已冲线的 1 号席（他没有回合）；豹掷 1；豹的诅咒 1
  dice(g, [1, 3, 1, 1, 9, 9]);
  const order = loop(g, 0, {}, 2);
  assert.deepStrictEqual(ev(g, 'curse').map((e) => e.seat), [0, 2], '只有真正行动过的玩家回合结束才掷诅咒骰');
  assert.deepStrictEqual(order, ['legs', 'cheatah']);
});
test('[口径] 诅咒魔杖：额外回合前不掷诅咒骰，额外回合结束后才掷', () => {
  const g = setup([['hopfrog', 10], ['mole', 12]]);
  g.twistActive = new Set(['cursewands']);
  dice(g, [1, 4, 2, 1, 1]); // 蛙 1 → 11（前 1 格有人，再来一回合）；蛙 4 → 15；诅咒 2 → 1 号席；鼹鼠 1、诅咒 1
  assert.deepStrictEqual(loop(g, 0, {}, 3), ['hopfrog', 'hopfrog', 'mole']);
  assert.deepStrictEqual(ev(g, 'curse').map((e) => e.seat), [0, 1], '蛙的两个回合之间没有诅咒骰');
});

/* ---------- 皮纳塔 ---------- */
test('皮纳塔：第 13–29 格中没人的格子各放 1 分；第 12 格及以前、有人的格子不放', () => {
  const g = draw('pinata', [['legs', 14], ['mole', 13], ['cheatah', 29], ['hotel', 12]]);
  assert.deepStrictEqual(g.coins, [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
  assert.strictEqual(ev(g, 'coins').length, 1);
});
test('皮纳塔：停上去拿走 1 分；路过不拿；后来者停同一格没有分', () => {
  const g = draw('pinata', [['legs', 14], ['mole', 10], ['cheatah', 10]]);
  move(g, 'mole', 10);
  assert.deepStrictEqual(scores(g), [0, 1, 0]);
  assert(!g.coins.includes(20));
  for (const c of [13, 15, 16, 17, 18, 19]) assert(g.coins.includes(c), `路过的 ${c} 格分还在`);
  move(g, 'cheatah', 10);
  assert.deepStrictEqual(scores(g), [0, 1, 0]);
});
test('皮纳塔：单人瞬移（跟屁虫）停上去也拿分，之后主移动停到分格再拿', () => {
  const g = draw('pinata', [['legs', 14], ['tail', 10], ['mole', 25]]);
  dice(g, [5]);
  turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(R(g, 'tail').pos, 18);
  assert.strictEqual(g.score(1), 2);
  assert(!g.coins.includes(13) && !g.coins.includes(18));
});
test('[口径] 皮纳塔 + 撞头虫：停到第 28 格分格时先被撞回 23，28 格的分拿不到（23 格的分照拿）', () => {
  const g = draw(['chaos', 'pinata', 'bonkbug'], [['legs', 14], ['mole', 20]]);
  move(g, 'mole', 8);
  assert.strictEqual(R(g, 'mole').pos, 23);
  assert(g.coins.includes(28), '28 格的分还在');
  assert(!g.coins.includes(23));
  assert.strictEqual(g.score(1), 1);
});

/* ---------- 炼金实验室 ---------- */
test('炼金实验室：翻卡回合结束后狼人怪就从起点掷骰前进；被超过的淘汰，同格与起点上的不算', () => {
  const g = setup([['legs', 13], ['mole', 3], ['cheatah', 5], ['hotel', 0]]);
  g.twistDeck = ['alchemylab'];
  dice(g, [1, 5]);
  loop(g, 0, {}, 1);
  assert.strictEqual(g.monster, 5);
  assert.strictEqual(R(g, 'mole').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'monster');
  assert(!R(g, 'cheatah').out, '和狼人怪同格不算被超过');
  assert(!R(g, 'hotel').out, '起点上的人不算被超过');
  assert(idx(g, (e) => e.t === 'turnEnd') < idx(g, (e) => e.t === 'monster' && e.from === 0), '先结束回合，再推进狼人怪');
});
test('炼金实验室：狼人怪冲到终点就离场，之后的回合不再掷骰前进', () => {
  const g = setup([['legs', 5], ['mole', 28], ['cheatah', 29]], { track: 'mild' });
  g.monster = 27;
  dice(g, [1, 4, 2]); // 腿 1；狼人怪 4 → 30（超过 28、29）；腿 2
  loop(g, 0, {}, 2);
  assert(R(g, 'mole').out && R(g, 'cheatah').out);
  assert.strictEqual(g.monster, null);
  assert.strictEqual(ev(g, 'monster').length, 1);
  assert.strictEqual(R(g, 'legs').pos, 8);
});
test('炼金实验室：一个玩家回合里有两名运动员（额外运动员），狼人怪只前进一次', () => {
  const g = setup([['legs', 3], ['cheatah', 10], ['mole', 5, { seat: 0, extra: true }]], { track: 'mild' });
  g.monster = 0;
  dice(g, [1, 1, 1]);
  assert.deepStrictEqual(loop(g, 0, {}, 2), ['legs', 'mole']);
  assert.strictEqual(ev(g, 'monster').length, 1);
});
test('炼金实验室 + 随机停止：狼人怪不是玩家，它的骰子不被固定', () => {
  const g = setup([['legs', 14], ['mole', 3]]);
  g.twistDeck = ['chaos', 'noluck', 'alchemylab']; g.twistDone = true;
  dice(g, [2, 3, 6]); // 随机停止：0 号席 2、1 号席 3；腿主移动固定 2；狼人怪真掷 6
  run(g, g.drawTwist(R(g, 'legs')));
  assert.deepStrictEqual(g.fixedRoll, { 0: 2, 1: 3 });
  loop(g, 0, {}, 1);
  assert.strictEqual(R(g, 'legs').pos, 16);
  assert.strictEqual(g.monster, 6);
  assert.strictEqual(R(g, 'mole').out, true);
});
test('炼金实验室：狼人怪一步超过剩下所有人 → 全员出局（all-out），已冲线者的金牌保留', () => {
  const g = setup([['legs', 28], ['mole', 3], ['cheatah', 4]], { track: 'mild' });
  g.monster = 0;
  dice(g, [2, 6]);
  loop(g, 0);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(g.raceEndReason, 'all-out');
  assert.deepStrictEqual(scores(g), [3, 0, 0]);
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 1, '下一场先手：最先被淘汰的玩家');
});

/* ---------- 粉丝要乱来 ---------- */
test('粉丝要乱来：再连抽两张，依次结算（先烤鸡再镜像，顺序反了结果不同）', () => {
  const g = draw(['chaos', 'roastchicken', 'mirror'], [['legs', 14], ['mole', 2], ['cheatah', 2]]);
  assert.deepStrictEqual(g.twistDrawn, ['chaos', 'roastchicken', 'mirror']);
  assert.deepStrictEqual(ev(g, 'twist').map((e) => e.id), ['chaos', 'roastchicken', 'mirror']);
  assert.deepStrictEqual(pos(g), { legs: 16, mole: 21, cheatah: 21 });
});
test('粉丝要乱来：传送带 + 水晶球叠加——之后掷 3 加 3 = 6 被淘汰，掷 2 加 3 = 5 照走', () => {
  const g = draw(['chaos', 'conveyor', 'scrying'], [['legs', 14], ['mole', 5], ['cheatah', 20]]);
  assert(g.twistOn('conveyor') && g.twistOn('scrying'));
  assert.deepStrictEqual(pos(g), { legs: 1, mole: 1, cheatah: 1 });
  dice(g, [3, 2]);
  turn(g, 'mole');
  assert.strictEqual(R(g, 'mole').out, true);
  turn(g, 'cheatah');
  assert.strictEqual(R(g, 'cheatah').pos, 6);
});
test('粉丝要乱来：时间小鬼 + 烤鸡——翻卡人先被淘汰，烤鸡只给剩下的最后一名', () => {
  const g = draw(['chaos', 'timeimp', 'roastchicken'], [['legs', 14], ['mole', 5], ['cheatah', 5]]);
  assert.strictEqual(R(g, 'legs').out, true);
  assert.deepStrictEqual(pos(g), { legs: 14, mole: 12, cheatah: 12 });
});
test('粉丝要乱来：随机停止 + 诅咒魔杖——诅咒骰也固定为该玩家的点数', () => {
  const g = setup([['legs', 14], ['mole', 5], ['cheatah', 5]]);
  g.twistDeck = ['chaos', 'noluck', 'cursewands']; g.twistDone = true;
  dice(g, [2, 1, 3]);
  run(g, g.drawTwist(R(g, 'legs')));
  assert.deepStrictEqual(g.fixedRoll, { 0: 2, 1: 1, 2: 3 });
  // 之后一颗真骰都不掷：腿走 2、诅咒 2 → 跳过 1、2 号席又轮到自己；再走 2、诅咒 2……
  dice(g, []);
  assert.deepStrictEqual(loop(g, 0, {}, 3), ['legs', 'legs', 'legs']);
  assert.deepStrictEqual(ev(g, 'curse').map((e) => e.value), [2, 2, 2]);
  assert.strictEqual(R(g, 'legs').pos, 20);
});

/* ---------- 传送带 ---------- */
test('传送带：所有在场运动员（含起点上的）瞬移到第 1 格；已冲线的不动', () => {
  const g = draw('conveyor', [['legs', 14], ['mole', 0], ['cheatah', 30, { finished: 1 }]]);
  assert.deepStrictEqual(pos(g), { legs: 1, mole: 1, cheatah: 30 });
  assert.strictEqual(ev(g, 'move').length, 0, '瞬移不是移动');
});
test('传送带：之后所有主移动 +3（不掷骰的迈大步也加），技能移动不加', () => {
  const g = draw('conveyor', [['legs', 14], ['mole', 6]]);
  turn(g, 'legs', { mode: 'legs' });
  assert.strictEqual(R(g, 'legs').pos, 9);
  move(g, 'mole', 2, 'power');
  assert.strictEqual(R(g, 'mole').pos, 3);
});

/* ---------- 水晶球 ---------- */
test('水晶球：之后主移动 5 格照走，6 格被淘汰；掷 6 但树懒 -1 只走 5 不淘汰', () => {
  const g = draw('scrying', [['legs', 14], ['mole', 0], ['cheatah', 0], ['gloth', 0]]);
  dice(g, [5, 6, 6]);
  turn(g, 'mole');
  assert.strictEqual(R(g, 'mole').pos, 5);
  turn(g, 'cheatah');
  assert.strictEqual(R(g, 'cheatah').out, true);
  assert.strictEqual(R(g, 'cheatah').pos, 0, '淘汰不移动');
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 5);
  assert(!R(g, 'gloth').out);
});
test('水晶球：不掷骰的主移动也算（魔法健将掷 1 前进 7 被淘汰）', () => {
  const g = draw('scrying', [['legs', 14], ['magicalathlete', 0]]);
  dice(g, [1]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'scrying');
});
test('水晶球：技能/变数卡移动 7 格不算主移动（烤鸡前进 7 不淘汰）', () => {
  const g = draw(['chaos', 'scrying', 'roastchicken'], [['legs', 14], ['mole', 0]]);
  assert.strictEqual(R(g, 'mole').pos, 7);
  assert(!R(g, 'mole').out);
});
test('[口径] 水晶球：离终点只剩 3 格时掷 6，按点数 6 判定仍被淘汰（不看实际只走 3 格）', () => {
  const g = draw('scrying', [['legs', 14], ['mole', 27]]);
  dice(g, [6]);
  turn(g, 'mole');
  assert.strictEqual(R(g, 'mole').out, true);
  assert.strictEqual(R(g, 'mole').finished, 0);
});
test('[口径] 水晶球：后退 6 格的主移动（糊涂狗不垫底掷 6）不淘汰', () => {
  const g = draw('scrying', [['legs', 14], ['blunderdog', 10], ['mole', 0]]);
  dice(g, [6]);
  turn(g, 'blunderdog');
  assert(!R(g, 'blunderdog').out);
  assert.strictEqual(R(g, 'blunderdog').pos, 4);
});

/* ---------- 跳蚤市场 ---------- */
test('跳蚤市场：在场玩家各抽一张、同时暗选；换的人原地换技能（狼人状态随之清除），不换的卡放回牌堆底', () => {
  const g = setup([['legs', 14], ['bitemark', 10, { wolf: true }]]);
  g.deck = ['mole', 'hotel', 'gloth'];
  g.twistDeck = ['swapmeet']; g.twistDone = true;
  let seen;
  run(g, g.drawTwist(R(g, 'legs')), { swapmeet: (d, s) => { seen = d; return s === 1 ? 'swap' : 'keep'; } });
  assert.strictEqual(seen.simul, true);
  assert.deepStrictEqual(seen.seats, [0, 1]);
  assert.deepStrictEqual([seen.optionsBySeat[0][1].card, seen.optionsBySeat[1][1].card], ['mole', 'hotel']);
  const b = R(g, 'bitemark');
  assert.deepStrictEqual([b.power, b.pos, b.wolf], ['hotel', 10, false]);
  assert.strictEqual(R(g, 'legs').power, 'legs');
  assert.deepStrictEqual(g.deck, ['gloth', 'mole']);
});
test('[口径] 跳蚤市场：已冲线的玩家不抽；一名玩家有两名运动员时只给主运动员一次换的机会', () => {
  const g = setup([['legs', 14], ['mole', 3], ['cheatah', 30, { finished: 1 }], ['hotel', 5, { seat: 0, extra: true }]]);
  g.deck = ['gloth', 'diva', 'icarus'];
  g.twistDeck = ['swapmeet']; g.twistDone = true;
  let seen;
  run(g, g.drawTwist(R(g, 'legs')), { swapmeet: (d) => { seen = d; return 'swap'; } });
  assert.deepStrictEqual(seen.seats, [0, 1]);
  assert.deepStrictEqual([R(g, 'legs').power, R(g, 'hotel').power, R(g, 'mole').power], ['gloth', 'hotel', 'diva']);
});
test('[口径] 跳蚤市场：换成带「赛前」技能的运动员（西西弗斯），赛前技能不补发（不拿 4 分）', () => {
  const g = setup([['legs', 14], ['mole', 3]]);
  g.deck = ['sisyphus', 'hotel'];
  g.twistDeck = ['swapmeet']; g.twistDone = true;
  run(g, g.drawTwist(R(g, 'legs')), { swapmeet: (d, s) => (s === 0 ? 'swap' : 'keep') });
  assert.strictEqual(R(g, 'legs').power, 'sisyphus');
  assert.strictEqual(g.score(0), 0);
});

/* ---------- 季终决战 ---------- */
test('季终决战：前两名冲线时名次分先扣下；两人回第 15 格单挑、其余人下场，原第一名先走，胜者通吃（第 2 场 4+2）', () => {
  const g = setup([['legs', 28], ['mole', 27], ['cheatah', 5]], { raceNo: 2, track: 'mild' });
  g.finale = 'armed';
  dice(g, [2, 3]);
  loop(g, 0);
  assert.strictEqual(g.ended, true);
  assert.deepStrictEqual(scores(g), [0, 0, 0], '名次分暂扣');
  assert.deepStrictEqual(g.finaleHeld.map((r) => r.rid), ['legs', 'mole']);
  const first = g.startFinale();
  assert.strictEqual(first, 0);
  assert.deepStrictEqual([R(g, 'legs').pos, R(g, 'mole').pos, R(g, 'legs').finished, R(g, 'mole').finished], [15, 15, 0, 0]);
  assert(R(g, 'cheatah').out && R(g, 'cheatah').benched);
  g.events = []; g.ended = undefined;
  dice(g, [1, 6, 1, 6, 1, 6]);
  assert.deepStrictEqual(loop(g, first), ['legs', 'mole', 'legs', 'mole', 'legs', 'mole']);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(R(g, 'mole').finished, 1);
  assert.deepStrictEqual(scores(g), [0, GOLD[1] + SILVER[1], 0]);
  assert.strictEqual(g.players[1].chips.length, 1, '只发一枚通吃奖牌');
});
test('季终决战：只有一人冲线（另一人被淘汰、全员出局）就不进决赛，暂扣的名次分照常发', () => {
  const g = setup([['legs', 28], ['mole', 3]], { track: 'mild' });
  g.finale = 'armed';
  move(g, 'legs', 2);
  assert.deepStrictEqual(scores(g), [0, 0]);
  run(g, g.eliminate(R(g, 'mole'), null, 'monster'));
  assert.strictEqual(g.raceEndReason, 'all-out');
  assert.strictEqual(g.startFinale(), null);
  assert.deepStrictEqual(scores(g), [3, 0]);
  assert.strictEqual(g.finale, null);
});
test('[口径] 季终决战后的下一场先手是决赛输家，而不是被请下场、原本落在最后的人', () => {
  const g = setup([['legs', 28], ['mole', 27], ['cheatah', 5]], { track: 'mild' });
  g.finale = 'armed';
  dice(g, [2, 3]);
  loop(g, 0);
  const first = g.startFinale();
  dice(g, [1, 6, 1, 6, 1, 6]);
  loop(g, first);
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 0);
});

/* ---------- 时间小鬼 ---------- */
test('时间小鬼：翻卡的运动员被淘汰，记为下一场的额外运动员（带着当前技能）', () => {
  const g = draw('timeimp', [['legs', 14], ['mole', 5]], { raceNo: 2 });
  assert.strictEqual(R(g, 'legs').out, true);
  assert.strictEqual(ev(g, 'out')[0].cause, 'timeimp');
  assert.deepStrictEqual(g.players[0].extras, [{ rid: 'legs', power: 'legs', keep: false }]);
  assert.deepStrictEqual(g.outOrder.map((r) => r.rid), ['legs']);
});
test('时间小鬼：第 4 场翻到只淘汰，没有下一场可以再上', () => {
  const g = draw('timeimp', [['legs', 14], ['mole', 5]], { raceNo: 4 });
  assert.strictEqual(R(g, 'legs').out, true);
  assert.deepStrictEqual(g.players[0].extras, []);
});
test('时间小鬼：下一场作为额外运动员和本席新派的运动员一起上场，同一玩家回合里跟在后面行动；再下一场不再跟来', () => {
  const g = draw('timeimp', [['legs', 14], ['mole', 5]]);
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 0, '被淘汰的玩家下一场先手');
  g.players[0].hand = ['legs', 'cheatah', 'hotel']; g.players[0].used = ['legs'];
  g.players[1].hand = ['mole', 'gloth', 'diva']; g.players[1].used = ['mole'];
  g.raceNo = 2; g.trackKey = 'mild';
  dice(g, [1, 1]);
  const take = g.takeTurn;
  let k = 0;
  g.takeTurn = function* (r) { if (k++ >= 2) throw STOP; yield* take.call(this, r); };
  try {
    run(g, g.runRace(1), { pickRacer: (d, s) => (s === 0 ? 'cheatah' : 'gloth') });
  } catch (e) { if (e !== STOP) throw e; }
  assert.deepStrictEqual(g.racers.map((r) => [r.rid, r.seat, !!r.extra]), [['cheatah', 0, false], ['gloth', 1, false], ['legs', 0, true]]);
  assert.deepStrictEqual(ev(g, 'turn').slice(0, 2).map((e) => e.rid), ['cheatah', 'legs']);
  assert.deepStrictEqual(g.players[0].extras, [], '只跟来一场');
});
test('[口径] 时间小鬼：冲线那一步越过招牌翻到它时，翻卡人已冲线，不淘汰也不加入下一场', () => {
  const g = setup([['legs', 12], ['mole', 5]]);
  g.twistDeck = ['timeimp'];
  move(g, 'legs', 18);
  assert.strictEqual(ev(g, 'twist')[0].id, 'timeimp');
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert(!R(g, 'legs').out);
  assert.deepStrictEqual(g.players[0].extras, []);
});

/* ---------- 随机停止 ---------- */
test('随机停止：每位玩家（含已没有在场运动员的）各掷一次；之后主移动、重掷都用固定点数，不再真掷', () => {
  const h = setup([['legs', 14], ['magician', 3], ['cheatah', 30, { finished: 1 }]]);
  h.twistDeck = ['noluck']; h.twistDone = true;
  dice(h, [4, 2, 5]);
  run(h, h.drawTwist(R(h, 'legs')));
  assert.deepStrictEqual(h.fixedRoll, { 0: 4, 1: 2, 2: 5 });
  dice(h, []);
  turn(h, 'magician', { reroll: (d) => (d.options.some((o) => o.v === 'magic') && ev(h, 'roll').length < 3 ? 'magic' : 'keep') });
  assert.deepStrictEqual(ev(h, 'roll').filter((e) => e.rid === 'magician').map((e) => e.value), [2, 2, 2], '魔术象重掷两次仍是 2');
  assert.strictEqual(R(h, 'magician').pos, 5);
  turn(h, 'legs');
  assert.strictEqual(R(h, 'legs').pos, 18);
});
test('随机停止：定点数的那一掷本身也受派对杀手约束（掷出 6 作废重掷）', () => {
  const g = setup([['legs', 14], ['pooper', 3]]);
  g.twistDeck = ['noluck']; g.twistDone = true;
  dice(g, [6, 4, 2]);
  run(g, g.drawTwist(R(g, 'legs')));
  assert.deepStrictEqual(g.fixedRoll, { 0: 4, 1: 2 });
  assert.strictEqual(R(g, 'pooper').pos, 4);
});
test('[口径] 随机停止固定成 6 后又出现派对杀手（如跳蚤市场换来）：只作废一次、派对杀手前进 1，仍按 6 走', () => {
  const g = setup([['legs', 0], ['pooper', 10]], { track: 'mild' });
  g.fixedRoll = { 0: 6, 1: 3 };
  dice(g, []);
  turn(g, 'legs');
  assert.strictEqual(ev(g, 'voided').length, 1);
  assert.strictEqual(R(g, 'pooper').pos, 11);
  assert.strictEqual(R(g, 'legs').pos, 6);
});

/* ---------- 烤鸡 ---------- */
test('烤鸡：最后一名前进 7；翻卡人自己是最后一名也算', () => {
  const g = draw('roastchicken', [['legs', 14], ['mole', 20], ['cheatah', 25]]);
  assert.deepStrictEqual(pos(g), { legs: 21, mole: 20, cheatah: 25 });
});
test('烤鸡：并列最后的都前进 7，按回合顺序依次移动', () => {
  const g = draw('roastchicken', [['legs', 14], ['mole', 2], ['cheatah', 2]]);
  assert.deepStrictEqual(pos(g), { legs: 14, mole: 9, cheatah: 9 });
  assert.deepStrictEqual(moves(g), [['mole', 2, 9, 'twist'], ['cheatah', 2, 9, 'twist']]);
});
test('烤鸡：前进 7 是一次移动——超过香蕉被绊倒；能直接冲线拿名次', () => {
  const g = draw('roastchicken', [['legs', 14], ['banana', 18], ['mole', 25]]);
  assert.strictEqual(R(g, 'legs').pos, 21);
  assert.strictEqual(R(g, 'legs').tripped, true);
  const h = draw('roastchicken', [['legs', 24], ['mole', 26], ['cheatah', 27]]);
  assert.strictEqual(R(h, 'legs').finished, 1);
  assert.deepStrictEqual(scores(h), [3, 0, 0]);
});

/* ================================================================
 * 二、变数招牌（扭扭糖果第 14 格）
 * ================================================================ */
test('变数招牌：从 13 走到 14 就翻；从 14 出发、后退经过、停在 13 都不翻', () => {
  let g = setup([['legs', 13], ['mole', 0]]);
  g.twistDeck = ['scrying'];
  move(g, 'legs', 1);
  assert.deepStrictEqual(ev(g, 'twist').map((e) => [e.id, e.rid]), [['scrying', 'legs']]);
  g = setup([['legs', 14], ['mole', 16], ['cheatah', 10]]);
  g.twistDeck = ['scrying'];
  move(g, 'legs', 1);
  move(g, 'mole', -3);
  move(g, 'cheatah', 3);
  assert.strictEqual(ev(g, 'twist').length, 0);
  assert.strictEqual(g.twistDone, false);
});
test('变数招牌：技能移动越过也翻；每场只翻一次，下一场重置', () => {
  const g = setup([['legs', 12], ['mole', 10]]);
  g.twistDeck = ['scrying', 'bonkbug'];
  move(g, 'legs', 3, 'power');
  assert.deepStrictEqual(ev(g, 'twist').map((e) => e.id), ['scrying']);
  move(g, 'mole', 8);
  assert.strictEqual(ev(g, 'twist').length, 1);
  g.resetRaceState();
  assert.strictEqual(g.twistDone, false);
  assert.strictEqual(g.twistActive, null, '上一场的持续变数卡不带到下一场');
});
test('变数招牌：落点结算（付房费）先完成，再翻卡', () => {
  const g = setup([['legs', 13], ['hotel', 14]]);
  g.giveChip(0, 'bronze', 1);
  g.twistDeck = ['scrying'];
  move(g, 'legs', 1);
  assert.deepStrictEqual(scores(g), [0, 1]);
  assert(idx(g, (e) => e.t === 'chip' && e.seat === 1) < idx(g, (e) => e.t === 'twist'));
});
test('变数招牌：冲线那一步越过也翻，冲线结算在前（烤鸡只给还在场的人）', () => {
  const g = setup([['legs', 12], ['mole', 3], ['cheatah', 3]]);
  g.twistDeck = ['roastchicken'];
  move(g, 'legs', 18);
  assert.strictEqual(R(g, 'legs').finished, 1);
  assert(idx(g, (e) => e.t === 'finish') < idx(g, (e) => e.t === 'twist'));
  assert.deepStrictEqual(pos(g), { legs: 30, mole: 10, cheatah: 10 });
});
test('变数招牌：巨婴把落点挡回第 13 格，不算到达招牌', () => {
  const g = setup([['legs', 12], ['hugebaby', 14]]);
  g.twistDeck = ['scrying'];
  move(g, 'legs', 2);
  assert.strictEqual(R(g, 'legs').pos, 13);
  assert.strictEqual(ev(g, 'twist').length, 0);
});
test('[口径] 变数招牌：瞬移越过第 14 格不翻；之后第一个「移动」越过的人才翻', () => {
  const g = setup([['tail', 10], ['mole', 20], ['legs', 0]]);
  g.twistDeck = ['scrying'];
  dice(g, [1]);
  turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(R(g, 'tail').pos, 20);
  assert.strictEqual(ev(g, 'twist').length, 0);
  move(g, 'legs', 14);
  assert.deepStrictEqual(ev(g, 'twist').map((e) => e.rid), ['legs']);
});
test('变数招牌：一代模式没有变数卡；混合模式里一代运动员越过招牌也翻', () => {
  const v1 = setup([['legs', 13], ['mole', 0]], { edition: 'v1', track: 'twisty' });
  move(v1, 'legs', 1);
  assert.strictEqual(ev(v1, 'twist').length, 0);
  const mix = setup([['legs', 13], ['mole', 0]], { edition: 'mix', track: 'twisty' });
  mix.twistDeck = ['scrying'];
  move(mix, 'legs', 1);
  assert.deepStrictEqual(ev(mix, 'twist').map((e) => e.rid), ['legs']);
  const wild = setup([['legs', 13], ['mole', 0]], { edition: 'mix', track: 'wild' });
  wild.twistDeck = ['scrying'];
  move(wild, 'legs', 1);
  assert.strictEqual(ev(wild, 'twist').length, 0, '狂野荒原没有招牌');
});

/* ================================================================
 * 三、狂野荒原（一代）：箭头 / 星星 / 石头
 * ================================================================ */
test('狂野荒原：五个箭头 7:+3 11:+1 16:-4 23:+2 24:-2、星星 1/13、石头 5/17/26', () => {
  const sp = TRACKS.wild.spaces;
  assert.deepStrictEqual(Object.keys(sp).map(Number).filter((k) => sp[k].type === 'arrow').map((k) => [k, sp[k].n]), [[7, 3], [11, 1], [16, -4], [23, 2], [24, -2]]);
  assert.deepStrictEqual(Object.keys(sp).map(Number).filter((k) => sp[k].type === 'star'), [1, 13]);
  assert.deepStrictEqual(Object.keys(sp).map(Number).filter((k) => sp[k].type === 'rock'), [5, 17, 26]);
  for (const [to, end] of [[7, 10], [11, 12], [16, 12], [23, 25], [24, 22]]) {
    const g = setup([['legs', 0], ['mole', 29]], V1W);
    move(g, 'legs', to);
    assert.strictEqual(R(g, 'legs').pos, end, `停在 ${to} 应到 ${end}`);
    assert.deepStrictEqual(moves(g)[1].slice(1), [to, end, 'arrow']);
  }
});
test('狂野荒原：路过箭头、星星、石头都不结算', () => {
  const g = setup([['legs', 0], ['mole', 29]], V1W);
  move(g, 'legs', 6);
  move(g, 'legs', 6);
  move(g, 'legs', 6);
  assert.strictEqual(R(g, 'legs').pos, 18);
  assert.strictEqual(R(g, 'legs').tripped, false);
  assert.deepStrictEqual(scores(g), [0, 0]);
  assert.strictEqual(ev(g, 'space').length, 0);
});
test('狂野荒原：技能移动停到箭头也结算（被半人马踢回第 7 格再前进 3）', () => {
  const g = setup([['centaur', 7], ['mole', 9], ['legs', 29]], V1W);
  move(g, 'centaur', 3); // 7 → 10，超过 9 格的鼹鼠；鼹鼠后退 2 到 7 → 箭头 +3 → 10
  assert.strictEqual(R(g, 'mole').pos, 10);
  assert.deepStrictEqual(moves(g).slice(1), [['mole', 9, 7, 'power'], ['mole', 7, 10, 'arrow']]);
});
test('狂野荒原：单人瞬移停到箭头也结算（催眠蛇在第 7 格把人拉过来，那人再前进 3）', () => {
  const g = setup([['hypnotist', 7], ['mole', 0], ['legs', 20]], V1W);
  dice(g, [1]);
  turn(g, 'hypnotist', { hypnotist: 'mole' });
  assert.strictEqual(R(g, 'mole').pos, 10);
  assert.strictEqual(R(g, 'hypnotist').pos, 8);
});
test('狂野荒原：箭头是一次独立移动——经过香蕉被绊倒；半人马借箭头超车照样踢人', () => {
  const g = setup([['legs', 4], ['banana', 9], ['mole', 29]], V1W);
  move(g, 'legs', 3);
  assert.strictEqual(R(g, 'legs').pos, 10);
  assert.strictEqual(R(g, 'legs').tripped, true);
  const h = setup([['centaur', 4], ['mole', 8], ['legs', 29]], V1W);
  move(h, 'centaur', 3);
  assert.strictEqual(R(h, 'centaur').pos, 10);
  assert.strictEqual(R(h, 'mole').pos, 6);
});
test('狂野荒原：后退箭头（24 → 22）经过别人不算超过', () => {
  const g = setup([['legs', 23], ['banana', 23], ['mole', 0]], V1W);
  move(g, 'legs', 1); // 和香蕉同格出发，前进 1 到 24（没超过谁），箭头退回 22 时经过 23 的香蕉
  assert.strictEqual(R(g, 'legs').pos, 22);
  assert.strictEqual(R(g, 'legs').tripped, false, '24 → 22 是后退，不是超过香蕉');
});
test('狂野荒原：箭头连锁——23 → 25 被巨婴挡到 24，再踩 24 的箭头退到 22', () => {
  const g = setup([['legs', 20], ['hugebaby', 25], ['mole', 0]], V1W);
  move(g, 'legs', 3);
  assert.deepStrictEqual(moves(g), [['legs', 20, 23, 'main'], ['legs', 23, 24, 'arrow'], ['legs', 24, 22, 'arrow']]);
});
test('狂野荒原：箭头连锁——跳跳蛙踩 7 前进 3 跳过有人的 10 落到 11，再踩箭头到 12', () => {
  const g = setup([['leaptoad', 4], ['mole', 10], ['legs', 29]], V1W);
  move(g, 'leaptoad', 3);
  assert.deepStrictEqual(moves(g), [['leaptoad', 4, 7, 'main'], ['leaptoad', 7, 11, 'arrow'], ['leaptoad', 11, 12, 'arrow']]);
});
test('狂野荒原：16 后退 4 被巨婴挡到 11，11 的箭头 +1 又被巨婴挡住，原地不动', () => {
  const g = setup([['legs', 14], ['hugebaby', 12], ['mole', 0]], V1W);
  move(g, 'legs', 2);
  assert.strictEqual(R(g, 'legs').pos, 11);
  assert.strictEqual(ev(g, 'blocked').length, 1);
});
test('狂野荒原：星星每次停上去拿 1 分铜牌（1 格、13 格；不会被拿走，后来者照拿）', () => {
  const g = setup([['legs', 0], ['mole', 10], ['cheatah', 12]], V1W);
  move(g, 'legs', 1);
  move(g, 'mole', 3);
  move(g, 'cheatah', 1);
  assert.deepStrictEqual(scores(g), [1, 1, 1]);
  assert(g.players.every((p) => p.chips.every((c) => c.kind === 'bronze' && c.v === 1)));
});
test('狂野荒原：换位（翻翻鱼）换到星星上也拿分；被踢回到第 1 格的星星也拿分', () => {
  const g = setup([['flipflop', 2], ['mole', 13], ['legs', 20]], V1W);
  turn(g, 'flipflop', { mode: 'flip:mole' });
  assert.deepStrictEqual(pos(g), { flipflop: 13, mole: 2, legs: 20 });
  assert.deepStrictEqual(scores(g), [1, 0, 0]);
  const h = setup([['centaur', 2], ['mole', 3], ['legs', 20]], V1W);
  move(h, 'centaur', 2);
  assert.strictEqual(R(h, 'mole').pos, 1);
  assert.deepStrictEqual(scores(h), [0, 1, 0]);
});
test('狂野荒原：停到石头被绊倒，下回合不掷骰只爬起来，再下回合正常；路过石头不绊', () => {
  const g = setup([['legs', 3], ['mole', 0]], V1W);
  dice(g, [2, 1, 5, 2]); // 腿 3 → 5 石头；鼹鼠 0 → 1 星星；腿爬起来；鼹鼠 1 → 6（路过 5）；腿 5 → 7 → 箭头 10
  assert.deepStrictEqual(loop(g, 0, {}, 5), ['legs', 'mole', 'legs', 'mole', 'legs']);
  assert.strictEqual(ev(g, 'recover').length, 1);
  assert.deepStrictEqual(ev(g, 'roll').map((e) => e.rid), ['legs', 'mole', 'mole', 'legs']);
  assert.deepStrictEqual(pos(g), { legs: 10, mole: 6 });
  assert.strictEqual(R(g, 'mole').tripped, false);
  assert.deepStrictEqual(scores(g), [0, 1]);
});
test('狂野荒原：技能移动停到石头也绊倒（被半人马踢回第 5 格）；已经绊倒的人再绊不叠加', () => {
  const g = setup([['centaur', 3], ['mole', 7], ['legs', 29]], V1W);
  move(g, 'centaur', 5);
  assert.strictEqual(R(g, 'mole').pos, 5);
  assert.strictEqual(R(g, 'mole').tripped, true);
  g.trip(R(g, 'mole'), '再绊一次');
  assert.strictEqual(ev(g, 'trip').length, 1);
});
test('[口径] 绊倒时机：主移动前阶段（啦啦队长自己前进 1 踩石头）摔倒，本回合照常主移动，下回合才跳过', () => {
  const g = setup([['cheerleader', 4], ['mole', 0], ['legs', 20]], V1W);
  dice(g, [2]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'cheerleader').pos, 10, '5 → 掷 2 → 7 → 箭头 10');
  assert.strictEqual(R(g, 'cheerleader').tripped, true);
  assert(/下回合跳过主移动/.test(ev(g, 'trip')[0].text));
  dice(g, []);
  turn(g, 'cheerleader');
  assert.strictEqual(R(g, 'cheerleader').tripped, false);
  assert.strictEqual(ev(g, 'recover').length, 1);
});
test('[口径] 绊倒时机：回合开始阶段（混合模式大明星换到石头上）摔倒，本回合就爬起来不主移动', () => {
  const g = setup([['diva', 10], ['mole', 5], ['cheatah', 20]], { edition: 'mix', track: 'wild' });
  dice(g, []);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'diva').pos, 5);
  assert.strictEqual(R(g, 'diva').tripped, false);
  assert(/这回合不能主移动/.test(ev(g, 'trip')[0].text));
  assert.strictEqual(ev(g, 'roll').length, 0);
});
test('[口径] 同时瞬移不结算落点格：魔法健将在星星上掷 2 把最后一名传过来，那人不拿星星分', () => {
  const g = setup([['magicalathlete', 13], ['mole', 3], ['legs', 20]], { edition: 'mix', track: 'wild' });
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'mole').pos, 13);
  assert.deepStrictEqual(scores(g), [0, 0, 0]);
});
test('[口径] 赛道格先结算：停到站着芭芭雅嘎的箭头格，先被箭头带走，但停上去那一刻已触发，照样被绊倒', () => {
  const g = setup([['legs', 4], ['babayaga', 7], ['mole', 29]], V1W);
  move(g, 'legs', 3);
  assert.strictEqual(R(g, 'legs').pos, 10);
  assert.strictEqual(R(g, 'legs').tripped, true);
  const h = setup([['legs', 6], ['babayaga', 8], ['mole', 29]], V1W);
  move(h, 'legs', 2);
  assert.strictEqual(R(h, 'legs').tripped, true, '普通格照常被绊倒');
});
test('规则 8：箭头 + 浪漫鳄在 22 ↔ 24 之间往返，同一局面再次出现时走完一遍就停', () => {
  const g = setup([['legs', 20], ['romantic', 22], ['mole', 0]], V1W);
  move(g, 'legs', 2);
  assert.deepStrictEqual(moves(g), [['legs', 20, 22, 'main'], ['romantic', 22, 24, 'power'], ['romantic', 24, 22, 'arrow']]);
  assert.deepStrictEqual(pos(g), { legs: 22, romantic: 22, mole: 0 });
  assert.strictEqual(said(g, /无限循环/).length, 1);
});

/* ================================================================
 * 四、漩涡乐园（二代）
 * ================================================================ */
test('漩涡乐园：技能移动停到漩涡口也传送；单人瞬移（跟屁虫）停到漩涡口也传送', () => {
  const g = setup([['legs', 0], ['mole', 29]], WH);
  move(g, 'legs', 4, 'power');
  assert.strictEqual(R(g, 'legs').pos, 6);
  const h = setup([['tail', 0], ['mole', 9]], WH);
  dice(h, [1]);
  turn(h, 'tail', { tail: 'yes' }); // 0 → 8（漩涡）→ 12，再掷 1 → 13
  assert.deepStrictEqual(ev(h, 'space').map((e) => [e.pos, e.to]), [[8, 12]]);
  assert.strictEqual(R(h, 'tail').pos, 13);
});
test('漩涡乐园：传送不算移动——不超过中间的人（香蕉不绊、裸奔侠不得分），到另一端不被吸回', () => {
  const g = setup([['streaker', 0], ['banana', 5], ['mole', 29]], WH);
  move(g, 'streaker', 4);
  assert.strictEqual(R(g, 'streaker').pos, 6);
  assert.strictEqual(R(g, 'streaker').tripped, false);
  assert.deepStrictEqual(scores(g), [0, 0, 0]);
  assert.strictEqual(ev(g, 'move').length, 1);
  assert.strictEqual(ev(g, 'space').length, 1);
});
test('漩涡乐园：28 号口传回 24（向后传），也不会再从 24 传回 28', () => {
  const g = setup([['legs', 25], ['mole', 0]], WH);
  move(g, 'legs', 3);
  assert.strictEqual(R(g, 'legs').pos, 24);
  assert.strictEqual(ev(g, 'warp').length, 1);
});
test('漩涡乐园：传送到的另一端照常结算同格效果（抢走骑猪者的野猪）', () => {
  const g = setup([['legs', 0], ['hogknight', 12, { hogs: 1 }]], WH);
  move(g, 'legs', 8);
  assert.strictEqual(R(g, 'legs').pos, 12);
  assert.deepStrictEqual([R(g, 'legs').hogs, R(g, 'hogknight').hogs], [1, 0]);
});
test('漩涡乐园：直接走到被巨婴占住的 12 格，被挡到 11 号漩涡口，照常传送到 15', () => {
  const g = setup([['legs', 0], ['hugebaby', 12], ['mole', 29]], WH);
  move(g, 'legs', 12);
  assert.strictEqual(R(g, 'legs').pos, 15);
});
test('漩涡乐园：从 8 号口传往 12，被 12 格的巨婴挡到 11 号口（另一对漩涡），应继续传送到 15', () => {
  const g = setup([['legs', 0], ['hugebaby', 12], ['mole', 29]], WH);
  move(g, 'legs', 8);
  assert.strictEqual(R(g, 'legs').pos, 15);
});
test('[口径] 漩涡乐园：大海怪把所有人卷到漩涡口（同时瞬移）不触发传送', () => {
  const g = setup([['kraken', 4], ['mole', 10], ['legs', 20]], WH);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.deepStrictEqual([R(g, 'mole').pos, R(g, 'legs').pos], [4, 4]);
  assert.strictEqual(ev(g, 'space').length, 0);
});

/* ================================================================
 * 五、通用规则
 * ================================================================ */
test('回合顺序：从起始席位依次轮流；同一玩家的额外运动员紧跟在他的主运动员之后行动', () => {
  const g = setup([['legs', 0], ['mole', 0], ['cheatah', 0], ['hotel', 0, { seat: 1, extra: true }]], { track: 'mild' });
  dice(g, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(loop(g, 1, {}, 5), ['mole', 'hotel', 'cheatah', 'legs', 'mole']);
});
test('额外回合：蹦蹦蛙回合结束正好有人在前 1 格，同一名运动员马上再来一回合；不满足就交给下家', () => {
  const g = setup([['hopfrog', 10], ['mole', 12]], { track: 'mild' });
  dice(g, [1, 4, 1]);
  assert.deepStrictEqual(loop(g, 0, {}, 3), ['hopfrog', 'hopfrog', 'mole']);
  assert.strictEqual(ev(g, 'extraTurn').length, 1);
  const h = setup([['hopfrog', 10], ['mole', 12]], { track: 'mild' });
  dice(h, [2, 1]);
  assert.deepStrictEqual(loop(h, 0, {}, 2), ['hopfrog', 'mole']);
});
test('额外回合：冲线的运动员不再获得额外回合（天才猜中冲线）', () => {
  const g = setup([['genius', 27], ['mole', 5], ['cheatah', 5]], { track: 'mild' });
  dice(g, [3, 1]);
  assert.deepStrictEqual(loop(g, 0, { genius: '3' }, 2), ['genius', 'mole']);
  assert.strictEqual(R(g, 'genius').finished, 1);
  assert.strictEqual(ev(g, 'extraTurn').length, 0);
});
test('两人冲线比赛立即结束，后面的人不再行动；第 3 场金 5 银 3', () => {
  const g = setup([['legs', 28], ['mole', 29], ['cheatah', 0]], { raceNo: 3, track: 'mild' });
  dice(g, [2, 1]);
  assert.deepStrictEqual(loop(g, 0), ['legs', 'mole']);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(g.raceEndReason, 'finished');
  assert.deepStrictEqual(scores(g), [5, 3, 0]);
  assert.deepStrictEqual(g.players[0].chips.map((c) => c.kind), ['gold']);
  assert.deepStrictEqual(g.players[1].chips.map((c) => c.kind), ['silver']);
});
test('只有一人冲线比赛继续；第 2 名冲线才结束', () => {
  const g = setup([['legs', 28], ['mole', 0], ['cheatah', 25]], { track: 'mild' });
  dice(g, [2, 1, 6]);
  assert.deepStrictEqual(loop(g, 0), ['legs', 'mole', 'cheatah']);
  assert.deepStrictEqual(scores(g), [3, 0, 1]);
});
test('金银牌分值随场次：金 3/4/5/6，银 1/2/3/4', () => {
  assert.deepStrictEqual(GOLD, [3, 4, 5, 6]);
  assert.deepStrictEqual(SILVER, [1, 2, 3, 4]);
  for (let n = 1; n <= 4; n++) {
    const g = setup([['legs', 29], ['mole', 29], ['cheatah', 0]], { raceNo: n, track: 'mild' });
    move(g, 'legs', 1);
    move(g, 'mole', 1);
    assert.deepStrictEqual(scores(g), [GOLD[n - 1], SILVER[n - 1], 0], `第 ${n} 场`);
  }
});
test('下一场先手：没人淘汰时是落在最后的运动员', () => {
  const g = setup([['legs', 30, { finished: 1 }], ['mole', 30, { finished: 2 }], ['cheatah', 8], ['hotel', 5]], { track: 'mild' });
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 3);
});
test('下一场先手：有人被淘汰时是最先被淘汰的玩家，即使他位置不是最后', () => {
  const g = setup([['legs', 30, { finished: 1 }], ['mole', 20], ['cheatah', 8], ['hotel', 2]], { track: 'mild' });
  run(g, g.eliminate(R(g, 'mole'), null, 'monster'));
  run(g, g.eliminate(R(g, 'cheatah'), null, 'monster'));
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 1);
});
test('下一场先手：两人都冲线、场上没人时是第 2 名', () => {
  const g = setup([['legs', 28], ['mole', 29]], { track: 'mild' });
  move(g, 'mole', 1);
  move(g, 'legs', 2);
  g.afterRace(0);
  assert.strictEqual(g.firstSeat, 0);
});
test('[口径] 下一场先手：并列最后时按「结束比赛那一回合」起算的回合顺序取第一个', () => {
  const mk = (cur) => {
    const g = setup([['legs', 30, { finished: 1 }], ['mole', 30, { finished: 2 }], ['cheatah', 5], ['hotel', 5]], { track: 'mild' });
    g.curSeat = cur;
    g.afterRace(0);
    return g.firstSeat;
  };
  assert.strictEqual(mk(1), 2);
  assert.strictEqual(mk(3), 3);
});
test('全员出局：场上最后一名运动员被淘汰（时间小鬼）→ 比赛结束，原因 all-out，已冲线者的分保留', () => {
  const g = setup([['legs', 30, { finished: 1 }], ['mole', 13]]);
  g.finishCount = 1;
  g.twistDeck = ['timeimp'];
  move(g, 'mole', 1);
  assert.strictEqual(g.ended, true);
  assert.strictEqual(g.raceEndReason, 'all-out');
  const h = setup([['legs', 5], ['mole', 13]]);
  run(h, h.eliminate(R(h, 'legs'), null, 'monster'));
  assert.strictEqual(h.ended, undefined, '还有人在场就不结束');
});
test('规则 8：同一回合同一运动员在完全相同局面下重复同一移动 → 第二次直接停止（moveSeen）', () => {
  const g = setup([['legs', 5], ['mole', 0]], { track: 'mild' });
  move(g, 'legs', 2, 'power');
  R(g, 'legs').pos = 5;
  move(g, 'legs', 2, 'power');
  assert.strictEqual(R(g, 'legs').pos, 5);
  assert.strictEqual(said(g, /无限循环/).length, 1);
  g.resetTurnCounters();
  move(g, 'legs', 2, 'power');
  assert.strictEqual(R(g, 'legs').pos, 7, '新回合重新计数');
});
test('规则 8：同一技能在完全相同局面下再次生效，蹭蹭狗不再跟着蹭（pwSeen）；局面不同照常蹭', () => {
  const g = setup([['scoocher', 4], ['legs', 0], ['mole', 10]], { track: 'mild' });
  run(g, g.pw(R(g, 'legs'), 'legs'));
  assert.strictEqual(R(g, 'scoocher').pos, 5);
  run(g, g.pw(R(g, 'legs'), 'legs'));
  assert.strictEqual(R(g, 'scoocher').pos, 6, '蹭蹭狗位置变了，局面不同');
  R(g, 'scoocher').pos = 5; // 回到第二次生效时的局面
  run(g, g.pw(R(g, 'legs'), 'legs'));
  assert.strictEqual(R(g, 'scoocher').pos, 5);
  assert.strictEqual(said(g, /无限循环/).length, 1);
});
test('被绊倒只跳过主移动：回合结束的技能照常（水龙头照样掷骰滋人）', () => {
  const g = setup([['hose', 5, { tripped: true }], ['mole', 7], ['legs', 20]], { track: 'mild' });
  dice(g, [3]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 5);
  assert.strictEqual(R(g, 'hose').tripped, false);
  assert.strictEqual(R(g, 'mole').tripped, true);
  assert.strictEqual(R(g, 'legs').tripped, false);
});
test('混合模式：空指针屏蔽在它前面的一代运动员（野兔失去 +2 并 -1）；在它身后的照常', () => {
  const g = setup([['hare', 10], ['nul', 5], ['mole', 20]], { edition: 'mix', track: 'mild' });
  dice(g, [3]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 12);
  const h = setup([['hare', 3], ['nul', 5], ['mole', 20]], { edition: 'mix', track: 'mild' });
  dice(h, [3]);
  turn(h, 'hare');
  assert.strictEqual(R(h, 'hare').pos, 8);
});
test('混合模式：空指针前面的香蕉失去技能，超过它不被绊倒；香蕉在空指针身后照常绊人', () => {
  const g = setup([['legs', 4], ['banana', 6], ['nul', 2]], { edition: 'mix', track: 'mild' });
  move(g, 'legs', 4);
  assert.strictEqual(R(g, 'legs').tripped, false);
  const h = setup([['legs', 4], ['banana', 6], ['nul', 7]], { edition: 'mix', track: 'mild' });
  move(h, 'legs', 4);
  assert.strictEqual(R(h, 'legs').tripped, true);
});
test('混合模式：电鳗让身边的一代运动员掷骰算 1；二代运动员借一代箭头超车照样拿裸奔侠分', () => {
  const g = setup([['hare', 10], ['stunner', 11], ['mole', 20]], { edition: 'mix', track: 'mild' });
  dice(g, [5]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 13, '5 算 1，野兔 +2');
  const h = setup([['streaker', 4], ['mole', 8], ['legs', 29]], { edition: 'mix', track: 'wild' });
  move(h, 'streaker', 3);
  assert.strictEqual(R(h, 'streaker').pos, 10);
  assert.deepStrictEqual(scores(h), [1, 0, 0]);
});
