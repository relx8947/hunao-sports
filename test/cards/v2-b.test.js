'use strict';
const { assert, test, setup, dice, run, turn, move, R, ev, said, pos, twist } = require('./helpers');
const { diceLeft } = require('./helpers');

// 二代运动员（下半）逐句规则测试：
// nemesis nepobaby nul overtaker pooper penguin rerunner showoff soulmate
// speeddemon spoilsport stepdad streaker stunner switcharoo tail hose understudy

/* ---------- 本文件小工具 ---------- */
// 扭扭糖果第 14 格有变数招牌：默认关掉变数卡，免得越过 14 格时抽到随机变数卡干扰断言
const S = (list, opts) => { const g = setup(list, opts); g.twistDone = true; return g; };
const used = (g) => assert.strictEqual(diceLeft(g), 0, '骰点应全部用完');
// 依次给出回答，用完后一直重复最后一个
const seq = (...xs) => () => (xs.length > 1 ? xs.shift() : xs[0]);
const count = (list, k) => list.filter((x) => x === k).length;
const tripped = (g) => Object.fromEntries(g.racers.map((r) => [r.rid, r.tripped]));

/* ================= 宿敌 nemesis ================= */
// 其他运动员掷主移动骰时，我可以跟着掷一颗；点数相同的话，等它走完我也前进同样的格数。
test('宿敌：别人掷主移动骰时可以跟掷；点数相同，等对方走完再前进同样格数', () => {
  const g = S([['nemesis', 3], ['hotel', 5]]);
  dice(g, [4, 4]);
  const asked = turn(g, 'hotel', { nemesis: 'yes' });
  assert(asked.includes('nemesis'));
  assert.deepStrictEqual(pos(g), { nemesis: 7, hotel: 9 });
  assert.deepStrictEqual(ev(g, 'move').map((e) => [e.rid, e.kind]), [['hotel', 'main'], ['nemesis', 'power']]);
  used(g);
});
test('宿敌：跟掷点数不同就不动', () => {
  const g = S([['nemesis', 3], ['hotel', 5]]);
  dice(g, [4, 3]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.deepStrictEqual(pos(g), { nemesis: 3, hotel: 9 });
  assert.deepStrictEqual(ev(g, 'roll').filter((e) => e.purpose === 'nemesis').map((e) => e.value), [3]);
  used(g);
});
test('宿敌：可以选择不跟——不掷骰也不动', () => {
  const g = S([['nemesis', 3], ['hotel', 5]]);
  dice(g, [4]);
  turn(g, 'hotel', { nemesis: 'no' });
  assert.deepStrictEqual(pos(g), { nemesis: 3, hotel: 9 });
  used(g);
});
test('宿敌：只跟「其他」运动员——自己掷主移动骰时不跟自己', () => {
  const g = S([['nemesis', 0], ['hotel', 10]]);
  dice(g, [3]);
  const asked = turn(g, 'nemesis');
  assert(!asked.includes('nemesis'));
  assert.strictEqual(R(g, 'nemesis').pos, 3);
  used(g);
});
test('宿敌：对方没掷主移动骰（摔倒跳过 / 鼹鼠直接走 6 / 老千豹暗定数字）时没有跟掷机会', () => {
  let g = S([['nemesis', 0], ['hotel', 5, { tripped: true }]]);
  dice(g, []);
  let asked = turn(g, 'hotel');
  assert(!asked.includes('nemesis'));
  assert.deepStrictEqual(pos(g), { nemesis: 0, hotel: 5 });
  g = S([['nemesis', 10], ['mole', 0]]);
  dice(g, []);
  asked = turn(g, 'mole', { mode: 'mole' });
  assert(!asked.includes('nemesis'));
  assert.deepStrictEqual(pos(g), { nemesis: 10, mole: 6 });
  // 老千豹暗定数字不算掷骰
  g = S([['nemesis', 10], ['cheatah', 0]]);
  dice(g, []);
  asked = turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '3', cheatahGuess: '1' });
  assert(!asked.includes('nemesis'));
  assert.deepStrictEqual(pos(g), { nemesis: 10, cheatah: 3 });
});
test('[口径] 宿敌：「同样的格数」按对方掷出的点数算，不含对方的加减值（后爸 +2）', () => {
  const g = S([['stepdad', 20], ['hotel', 0], ['nemesis', 0]]);
  dice(g, [3, 3]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.strictEqual(R(g, 'hotel').pos, 5, '3 + 后爸 2');
  assert.strictEqual(R(g, 'nemesis').pos, 3, '宿敌只走点数 3');
});
test('宿敌 × 电鳗：对方被电麻算 1，宿敌掷出 1 就配上，跟进 1 格', () => {
  const g = S([['stunner', 4], ['hotel', 5], ['nemesis', 0]]);
  dice(g, [5, 1]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.deepStrictEqual(pos(g), { stunner: 4, hotel: 6, nemesis: 1 });
  used(g);
});
test('宿敌 × 派对杀手：跟掷出的 6 也作废重掷，重掷后再比', () => {
  const g = S([['pooper', 20], ['hotel', 2], ['nemesis', 0]]);
  dice(g, [4, 6, 4]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.deepStrictEqual(pos(g), { pooper: 21, hotel: 6, nemesis: 4 });
  assert.deepStrictEqual(ev(g, 'voided').map((e) => e.rid), ['nemesis']);
  used(g);
});
test('宿敌：配上点数后在对方移动途中被淘汰（被狼人超过），就不再前进', () => {
  const g = S([['bitemark', 0, { wolf: true }], ['nemesis', 2], ['hotel', 20]]);
  dice(g, [4, 4]);
  turn(g, 'bitemark', { nemesis: 'yes' });
  assert.strictEqual(R(g, 'nemesis').out, true);
  assert.strictEqual(R(g, 'nemesis').pos, 2);
  assert.deepStrictEqual(ev(g, 'move').map((e) => e.rid), ['bitemark']);
});
test('宿敌：对方这一步冲线后照样跟进，宿敌也能借此冲线', () => {
  const g = S([['hotel', 27], ['nemesis', 26], ['gloth', 0]]);
  dice(g, [4, 4]);
  turn(g, 'hotel', { nemesis: 'yes' });
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(R(g, 'nemesis').finished, 2);
  assert(g.ended);
});
test('宿敌：被空指针屏蔽时没有跟掷机会', () => {
  const g = S([['nul', 0], ['nemesis', 3], ['hotel', 5]]);
  dice(g, [3]);
  const asked = turn(g, 'hotel');
  assert(!asked.includes('nemesis'));
  assert.strictEqual(R(g, 'hotel').pos, 7, '3 - 空指针 1');
  used(g);
});
test('[口径] 宿敌 × 显摆王：只和第一颗骰比较、只走第一颗的点数；显摆失败没动时宿敌照样前进', () => {
  let g = S([['showoff', 0], ['nemesis', 10]]);
  dice(g, [2, 5, 2]);
  turn(g, 'showoff', { showoff: seq('more', 'stop'), nemesis: 'yes' });
  assert.strictEqual(R(g, 'showoff').pos, 7, '2 + 5');
  assert.strictEqual(R(g, 'nemesis').pos, 12, '宿敌按第一颗 2 配上，走 2');
  g = S([['showoff', 0], ['nemesis', 10]]);
  dice(g, [3, 2, 3]);
  turn(g, 'showoff', { showoff: 'more', nemesis: 'yes' });
  assert.strictEqual(R(g, 'showoff').pos, 0, '显摆失败不动');
  assert.strictEqual(R(g, 'nemesis').pos, 13, '对方没走，宿敌仍前进 3');
});
test('[口径] 宿敌 × 伊卡洛斯：对方掷出 6 被淘汰、没有走，配上了也不前进', () => {
  const g = S([['icarus', 0], ['nemesis', 10], ['hotel', 20]]);
  dice(g, [6, 6]);
  turn(g, 'icarus', { nemesis: 'yes' });
  assert.strictEqual(R(g, 'icarus').out, true);
  assert.strictEqual(R(g, 'nemesis').pos, 10);
});

/* ================= 星二代 nepobaby ================= */
// 直接从第一个弯道（第 12 格）开始比赛。注：是直接摆过去，不算移动也不算瞬移。
test('星二代：赛前直接摆到第一个弯道第 12 格，没有移动事件', () => {
  const g = S([['nepobaby', 0], ['hotel', 0]]);
  run(g, g.applyBeforeRace(R(g, 'nepobaby'), 'nepobaby', 0));
  assert.deepStrictEqual(pos(g), { nepobaby: 12, hotel: 0 });
  assert.strictEqual(ev(g, 'move').length, 0);
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to, e.place]), [[0, 12, true]]);
});
test('星二代：摆放不算移动——不算超过谁（企鹅不摔），也不算停到别人格子（不付房费、不抢野猪）', () => {
  const g = S([['nepobaby', 0], ['penguin', 5], ['hotel', 12], ['hogknight', 12, { hogs: 1 }]]);
  run(g, g.applyBeforeRace(R(g, 'nepobaby'), 'nepobaby', 0));
  assert.strictEqual(R(g, 'nepobaby').pos, 12);
  assert.strictEqual(R(g, 'penguin').tripped, false);
  assert.strictEqual(R(g, 'nepobaby').tripped, false, '付不起房费也不会被绊');
  assert.strictEqual(g.score(2), 0);
  assert.strictEqual(R(g, 'hogknight').hogs, 1);
  assert(!R(g, 'nepobaby').hogs);
});
test('星二代：漩涡乐园第 12 格是漩涡口，摆上去也不会被传走', () => {
  const g = S([['nepobaby', 0], ['hotel', 0]], { track: 'whirly' });
  run(g, g.applyBeforeRace(R(g, 'nepobaby'), 'nepobaby', 0));
  assert.strictEqual(R(g, 'nepobaby').pos, 12);
  assert.strictEqual(ev(g, 'space').length, 0);
});
test('星二代：在比赛开始的赛前流程里生效，之后从第 12 格照常掷骰', () => {
  const g = S([['hotel', 0], ['nepobaby', 0]]);
  run(g, g.beforeRace());
  assert.deepStrictEqual(pos(g), { hotel: 0, nepobaby: 12 });
  dice(g, [3]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 15);
});

/* ================= 空指针 nul ================= */
// 在我前面的运动员主移动 -1，并且失去技能。注：一超过我就立刻失效；赛场外的技能（如返场王）不受影响。
test('空指针：在它前面的运动员主移动 -1', () => {
  const g = S([['nul', 3], ['hotel', 5]]);
  dice(g, [4]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 8);
  assert.deepStrictEqual(ev(g, 'calc')[0].mods.map((m) => [m.label, m.v]), [['空指针', -1]]);
});
test('空指针：同格和身后的运动员不受影响，空指针自己也不 -1', () => {
  const g = S([['nul', 3], ['hotel', 3], ['pooper', 1]]);
  assert.deepStrictEqual(g.powers(R(g, 'hotel')), ['hotel']);
  assert.deepStrictEqual(g.powers(R(g, 'pooper')), ['pooper']);
  dice(g, [4, 2, 2]);
  turn(g, 'hotel');
  turn(g, 'pooper');
  turn(g, 'nul');
  assert.deepStrictEqual(pos(g), { nul: 5, hotel: 7, pooper: 3 });
  assert.strictEqual(ev(g, 'calc').length, 0);
});
test('空指针：前面的运动员失去技能（派对杀手不再作废 6）', () => {
  const g = S([['nul', 0], ['pooper', 5], ['hotel', 2]]);
  assert.deepStrictEqual(g.powers(R(g, 'pooper')), []);
  dice(g, [6]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 7, '6 照样有效，再 -1');
  assert.strictEqual(R(g, 'pooper').pos, 5);
  assert.strictEqual(ev(g, 'voided').length, 0);
});
test('[口径] 空指针：-1 之后最少为 0，掷 1 时原地不动而不是后退', () => {
  const g = S([['nul', 0], ['hotel', 5]]);
  dice(g, [1]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 5);
  assert.strictEqual(ev(g, 'calc')[0].total, 0);
});
test('空指针：一超过它就立刻失去技能——越过空指针的水龙头，回合结束不再掷骰', () => {
  let g = S([['hose', 2], ['nul', 4], ['hotel', 20]]);
  dice(g, [3]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 5);
  assert.strictEqual(ev(g, 'roll').filter((e) => e.purpose === 'hose').length, 0);
  used(g);
  // 对照：没越过空指针时照常掷水龙头
  g = S([['hose', 2], ['nul', 9], ['hotel', 20]]);
  dice(g, [3, 1]);
  turn(g, 'hose');
  assert.strictEqual(ev(g, 'roll').filter((e) => e.purpose === 'hose').length, 1);
  used(g);
});
test('空指针：它超过前面的人，那人立刻恢复技能', () => {
  const g = S([['nul', 3], ['pooper', 5], ['hotel', 0]]);
  assert(!g.has(R(g, 'pooper'), 'pooper'));
  dice(g, [4]);
  turn(g, 'nul');
  assert.strictEqual(R(g, 'nul').pos, 7);
  assert(g.has(R(g, 'pooper'), 'pooper'));
  dice(g, [6, 2]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').pos, 6, '6 又被作废，派对杀手前进 1');
  assert.strictEqual(R(g, 'hotel').pos, 2);
});
test('空指针：自己被更后面的空指针屏蔽时失效（前面的人只 -1）；两名空指针同格互不屏蔽（-2）', () => {
  // 替补演员学到空指针，成了第二名空指针
  let g = S([['understudy', 0, { power: 'nul' }], ['nul', 3], ['hotel', 5]]);
  assert.deepStrictEqual(g.powers(R(g, 'nul')), []);
  dice(g, [4]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 8, '5 + 4 - 1');
  g = S([['understudy', 0, { power: 'nul' }], ['nul', 0], ['hotel', 5]]);
  dice(g, [4]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 7, '5 + 4 - 2');
});
test('空指针：赛场外技能（返场王）不受影响，比赛结束照样成为额外运动员', () => {
  const g = S([['nul', 0], ['rerunner', 5]]);
  assert.deepStrictEqual(g.powers(R(g, 'rerunner')), ['rerunner']);
  g.afterRace(0);
  assert.deepStrictEqual(g.players[1].extras.map((x) => x.rid), ['rerunner']);
});
test('空指针：被淘汰离场后不再屏蔽任何人', () => {
  const g = S([['nul', 3], ['icarus', 5], ['hotel', 0]]);
  assert(!g.has(R(g, 'icarus'), 'icarus'));
  run(g, g.eliminate(R(g, 'nul'), null, 'monster')); // 被狼人怪追上
  assert(g.has(R(g, 'icarus'), 'icarus'));
  dice(g, [2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').pos, 10, '5 + 2 + 伊卡洛斯 3，不再 -1');
});
test('[口径] 空指针：越过空指针的那一步就已失去技能——狼人一口气越过别人和空指针，谁也咬不到', () => {
  const g = S([['bitemark', 0, { wolf: true }], ['hotel', 2], ['nul', 4], ['gloth', 20]]);
  run(g, g.move(R(g, 'bitemark'), 6, 'main'));
  assert.strictEqual(R(g, 'bitemark').pos, 6);
  assert.strictEqual(R(g, 'hotel').out, false);
  assert.strictEqual(R(g, 'nul').out, false);
});
test('[口径] 空指针：它超过的人当场恢复技能——被它超过的攀滚企鹅照样摔倒', () => {
  const g = S([['nul', 3], ['penguin', 5], ['hotel', 20]]);
  assert(!g.has(R(g, 'penguin'), 'penguin'));
  run(g, g.move(R(g, 'nul'), 4, 'main'));
  assert.strictEqual(R(g, 'penguin').tripped, true);
});
test('[口径] 空指针 × 冒牌货：冲线者冲线时在空指针前面、技能已失效，冒牌货顶包拿不到技能', () => {
  const g = S([['doppel', 0], ['hotel', 29], ['nul', 0], ['gloth', 0]]);
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(R(g, 'hotel').out, true);
  assert.deepStrictEqual(R(g, 'doppel').stack || [], []);
});

/* ================= 超车王 overtaker ================= */
// 前面每有一名还在比赛的运动员，我主移动 +1。
test('超车王：前面每有一名在场运动员主移动 +1', () => {
  const g = S([['overtaker', 0], ['hotel', 5], ['gloth', 9], ['pooper', 12]]);
  dice(g, [1]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 4, '1 + 3');
  assert.deepStrictEqual(ev(g, 'calc')[0].mods.map((m) => [m.label, m.v]), [['超车王', 3]]);
});
test('超车王：同格和身后的运动员不算；前面没人时不加', () => {
  const g = S([['overtaker', 5], ['hotel', 5], ['gloth', 2]]);
  dice(g, [3]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 8);
  assert.strictEqual(ev(g, 'calc').length, 0);
});
test('超车王：已冲线或已淘汰的运动员不算「还在比赛」', () => {
  const g = S([['overtaker', 0], ['hotel', 30, { finished: 1 }], ['gloth', 9, { out: true }], ['pooper', 5]]);
  dice(g, [2]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 3, '只有派对杀手算');
});
test('超车王：额外运动员也是一名在场运动员', () => {
  const g = S([['overtaker', 0], ['hotel', 5], ['rerunner', 7, { seat: 1, extra: true }]]);
  dice(g, [1]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 3);
});
test('超车王：人数在掷骰之后、移动之前清点（派对杀手因 6 前进到它前面也算）', () => {
  const g = S([['overtaker', 5], ['pooper', 5], ['hotel', 10]]);
  dice(g, [6, 2]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'pooper').pos, 6);
  assert.strictEqual(R(g, 'overtaker').pos, 9, '2 + 2');
});
test('超车王：冲线那一步照样加', () => {
  const g = S([['overtaker', 26], ['hotel', 28], ['gloth', 29]]);
  dice(g, [2]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').finished, 1);
});
test('超车王：被空指针屏蔽时没有加成，还要 -1', () => {
  const g = S([['nul', 0], ['overtaker', 3], ['hotel', 9]]);
  dice(g, [3]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 5);
});
test('超车王 × 电鳗：点数先算成 1 再加人数', () => {
  const g = S([['stunner', 1], ['overtaker', 0], ['hotel', 9]]);
  dice(g, [5]);
  turn(g, 'overtaker');
  assert.strictEqual(R(g, 'overtaker').pos, 3, '1 + 2');
});

/* ================= 派对杀手 pooper ================= */
// 任何人掷出的 6 都必须重掷；每发生一次，我前进 1 格。
test('派对杀手：别人掷出 6 作废重掷；派对杀手先前进 1 格，再重掷', () => {
  const g = S([['pooper', 0], ['hotel', 5]]);
  dice(g, [6, 3]);
  turn(g, 'hotel');
  assert.deepStrictEqual(pos(g), { pooper: 1, hotel: 8 });
  const order = g.events.filter((e) => ['voided', 'move', 'roll'].includes(e.t)).map((e) => `${e.t}:${e.rid}`);
  assert.deepStrictEqual(order, ['voided:hotel', 'move:pooper', 'roll:hotel', 'move:hotel']);
  used(g);
});
test('派对杀手：自己掷出的 6 也要重掷，自己照样前进 1 格', () => {
  const g = S([['pooper', 0], ['hotel', 20]]);
  dice(g, [6, 2]);
  turn(g, 'pooper');
  assert.strictEqual(R(g, 'pooper').pos, 3, '1 + 2');
  assert.strictEqual(ev(g, 'voided').length, 1);
});
test('派对杀手：不只主移动骰——水龙头回合结束掷的 6 也作废', () => {
  const g = S([['hose', 0], ['pooper', 20], ['hotel', 3], ['gloth', 5]]);
  dice(g, [1, 6, 2]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'pooper').pos, 21);
  assert.deepStrictEqual(ev(g, 'roll').filter((e) => e.purpose === 'hose').map((e) => e.value), [2]);
  assert.strictEqual(R(g, 'hotel').tripped, true);
  assert.strictEqual(R(g, 'gloth').tripped, false, '按重掷的 2 算距离');
});
test('派对杀手 × 显摆王：追加掷出的 6 也作废——掷出 5 之后再也不可能显摆成功', () => {
  const g = S([['showoff', 0], ['pooper', 20]]);
  dice(g, [5, 6, 3]);
  turn(g, 'showoff', { showoff: 'more' });
  assert.strictEqual(R(g, 'pooper').pos, 21);
  assert.strictEqual(R(g, 'showoff').pos, 0, '重掷的 3 不比 5 大，这次不动');
});
test('派对杀手：前进 1 格冲过终点就离场，之后再掷出的 6 不再作废', () => {
  const g = S([['pooper', 29], ['hotel', 0], ['gloth', 0]]);
  dice(g, [6, 6]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').finished, 1);
  assert.strictEqual(g.score(0), 3);
  assert.strictEqual(R(g, 'hotel').pos, 6);
  assert.strictEqual(ev(g, 'voided').length, 1);
});
test('派对杀手：前进 1 格踩到漩涡口照常被传送', () => {
  const g = S([['pooper', 3], ['hotel', 25]], { track: 'whirly' });
  dice(g, [6, 2]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').pos, 6, '4 号漩涡通到 6');
  assert.strictEqual(R(g, 'hotel').pos, 27);
});
test('[口径] 派对杀手 × 电鳗：被电鳗算成 1 的 6 不再作废', () => {
  const g = S([['stunner', 4], ['hotel', 5], ['pooper', 20]]);
  dice(g, [6]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 6);
  assert.strictEqual(R(g, 'pooper').pos, 20);
  assert.strictEqual(ev(g, 'voided').length, 0);
});
test('[口径] 派对杀手 × 随机停止：点数固定成 6 时只作废一次，派对杀手前进 1，6 照走', () => {
  const g = S([['pooper', 0], ['hotel', 5]]);
  g.fixedRoll = { 0: 6, 1: 6 };
  dice(g, []);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').pos, 1);
  assert.strictEqual(R(g, 'hotel').pos, 11);
  assert.strictEqual(ev(g, 'voided').length, 1);
});
test('[口径] 派对杀手：炼金实验室的狼人怪（不是运动员）掷出的 6 不作废', () => {
  const g = S([['pooper', 20], ['hotel', 10]]);
  g.monster = 0;
  dice(g, [6]);
  run(g, g.moveMonster());
  assert.strictEqual(g.monster, 6);
  assert.strictEqual(R(g, 'pooper').pos, 20);
  assert.strictEqual(ev(g, 'voided').length, 0);
});

/* ================= 攀滚企鹅 penguin ================= */
// 被超过时我会摔倒；但摔倒时我照样掷骰，而且主移动翻倍，不用跳过。注：主移动走完才爬起来。
test('攀滚企鹅：被超过时摔倒；只是落到同格、或后退经过都不算超过', () => {
  let g = S([['hotel', 0], ['penguin', 3]]);
  run(g, g.move(R(g, 'hotel'), 5, 'main'));
  assert.strictEqual(R(g, 'penguin').tripped, true);
  g = S([['hotel', 0], ['penguin', 3]]);
  run(g, g.move(R(g, 'hotel'), 3, 'main'));
  assert.strictEqual(R(g, 'penguin').tripped, false, '同格不算超过');
  g = S([['hotel', 5], ['penguin', 3]]);
  run(g, g.move(R(g, 'hotel'), -4, 'power'));
  assert.strictEqual(R(g, 'hotel').pos, 1);
  assert.strictEqual(R(g, 'penguin').tripped, false, '后退经过不算超过');
});
test('攀滚企鹅：摔倒时照样掷骰，主移动翻倍；走完才爬起来', () => {
  const g = S([['penguin', 3, { tripped: true }], ['hotel', 20]]);
  dice(g, [4]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 11);
  assert.strictEqual(R(g, 'penguin').tripped, false);
  const order = g.events.filter((e) => e.t === 'move' || e.t === 'recover').map((e) => e.t);
  assert.deepStrictEqual(order, ['move', 'recover'], '先移动再爬起来');
  assert.strictEqual(ev(g, 'calc')[0].total, 8);
});
test('攀滚企鹅：没摔倒时正常移动，不翻倍', () => {
  const g = S([['penguin', 3], ['hotel', 20]]);
  dice(g, [4]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 7);
});
test('[口径] 攀滚企鹅：翻倍只乘骰子点数，加减值（后爸 +2）在翻倍之后再加', () => {
  const g = S([['stepdad', 20], ['penguin', 3, { tripped: true }]]);
  dice(g, [3]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 11, '3×2+2=8，而不是 (3+2)×2=10');
});
test('攀滚企鹅 × 电鳗：摔倒时被电麻算 1，翻倍后走 2', () => {
  const g = S([['stunner', 4], ['penguin', 3, { tripped: true }]]);
  dice(g, [5]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 5);
});
test('攀滚企鹅：瞬移越过它不算超过（灵魂伴侣瞬移过去，企鹅不摔）', () => {
  const g = S([['soulmate', 0, { mate: 'pooper' }], ['penguin', 3], ['pooper', 5]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 6);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('攀滚企鹅：漩涡传送越过它不算超过；走到漩涡口之前已经越过它则照样摔倒', () => {
  let g = S([['hotel', 3], ['penguin', 5]], { track: 'whirly' });
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(R(g, 'hotel').pos, 6, '4 → 6');
  assert.strictEqual(R(g, 'penguin').tripped, false);
  g = S([['hotel', 2], ['penguin', 3]], { track: 'whirly' });
  run(g, g.move(R(g, 'hotel'), 2, 'main'));
  assert.strictEqual(R(g, 'hotel').pos, 6);
  assert.strictEqual(R(g, 'penguin').tripped, true);
});
test('攀滚企鹅：被空指针屏蔽时，被超过不摔；已经摔倒就照常跳过主移动', () => {
  let g = S([['nul', 0], ['penguin', 3], ['hotel', 1]]);
  run(g, g.move(R(g, 'hotel'), 4, 'main'));
  assert.strictEqual(R(g, 'penguin').tripped, false);
  g = S([['nul', 0], ['penguin', 3, { tripped: true }]]);
  dice(g, []);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 3);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('攀滚企鹅：自己回合开始、主移动前摔倒（瞬移到付不起房费的小旅馆）当回合就照样掷骰翻倍', () => {
  const g = S([['penguin', 3, { stack: ['soulmate'], mate: 'hotel' }], ['hotel', 6]]);
  dice(g, [2]);
  turn(g, 'penguin');
  assert.match(ev(g, 'trip')[0].text, /这回合照样掷骰，主移动翻倍/);
  assert.strictEqual(R(g, 'penguin').pos, 10, '6 + 2×2');
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('[口径] 攀滚企鹅：趴着滑到付不起房费的小旅馆格子，不会「再摔一次」，走完照样爬起来', () => {
  const g = S([['penguin', 3, { tripped: true }], ['hotel', 7]]);
  dice(g, [2]);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 7);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('攀滚企鹅 × 宿敌：企鹅主移动走完就爬起来，之后「等它走完」才前进的宿敌超过它，要再摔倒', () => {
  const g = S([['penguin', 3, { tripped: true }], ['nemesis', 6]]);
  dice(g, [2, 2]);
  turn(g, 'penguin', { nemesis: 'yes' });
  assert.deepStrictEqual(pos(g), { penguin: 7, nemesis: 8 });
  assert.strictEqual(R(g, 'penguin').tripped, true, '宿敌在企鹅走完、爬起来之后超过了它');
});

/* ================= 返场王 rerunner ================= */
// 我第一次上场之后，后面每一场都作为额外运动员跟着上场。注：这是赛场外的技能，不会被复制或屏蔽。
test('返场王：第一次上场后进入额外运动员名单；就算本场被淘汰也一样', () => {
  const g = S([['hotel', 4], ['rerunner', 9, { out: true }]]);
  g.afterRace(0);
  assert.deepStrictEqual(g.players[1].extras, [{ rid: 'rerunner', power: 'rerunner', keep: true }]);
  assert.deepStrictEqual(g.players[0].extras, []);
});
test('返场王：第 4 场（最后一场）之后没有下一场，不再登记', () => {
  const g = S([['rerunner', 4], ['hotel', 9]], { raceNo: 4 });
  g.afterRace(3);
  assert.deepStrictEqual(g.players[0].extras, []);
});
test('返场王：之后每一场都跟着上场——跑完第 2 场仍留在名单里，且不会重复登记', () => {
  const g = setup([['rerunner', 4], ['hotel', 9]]);
  g.afterRace(0);
  g.players[0].hand = ['rerunner', 'gloth']; g.players[0].used = ['rerunner'];
  g.players[1].hand = ['hotel', 'pooper']; g.players[1].used = ['hotel'];
  g.raceNo = 2; g.trackKey = 'twisty'; g.twistDeck = []; g.twistDiscard = [];
  g.d6 = () => 5;
  run(g, g.runRace(1), { pickRacer: (d, s) => d.optionsBySeat[s][0].v });
  const st = g.results[1].standings.map((x) => [x.rid, x.seat, !!x.extra]);
  assert.deepStrictEqual(st, [['gloth', 0, false], ['pooper', 1, false], ['rerunner', 0, true]]);
  assert.deepStrictEqual(g.players[0].extras, [{ rid: 'rerunner', power: 'rerunner', keep: true }]);
});
test('返场王：赛场外技能不能被替补演员学走', () => {
  const g = S([['understudy', 0], ['rerunner', 0], ['hotel', 0]]);
  let opts = null;
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: (d) => { opts = d.options.map((o) => o.v); return 'hotel'; } });
  assert.deepStrictEqual(opts, ['hotel']);
});
test('返场王：冒牌货顶包时拿不到返场王的技能，返场王下一场照样返场', () => {
  const g = S([['doppel', 0], ['rerunner', 29], ['hotel', 0]]);
  run(g, g.move(R(g, 'rerunner'), 1, 'main'));
  assert.strictEqual(R(g, 'rerunner').out, true);
  assert(!(R(g, 'doppel').stack || []).includes('rerunner'));
  g.afterRace(0);
  assert.deepStrictEqual(g.players[1].extras.map((x) => x.rid), ['rerunner']);
});
test('[口径] 返场王：被调包精换走控制权后，之后的场次跟着当前控制它的玩家上场', () => {
  const g = S([['switcharoo', 0], ['rerunner', 1]]);
  dice(g, [1]);
  turn(g, 'switcharoo', { switcharoo: 'rerunner' });
  assert.strictEqual(R(g, 'rerunner').seat, 0);
  g.afterRace(0);
  assert.deepStrictEqual(g.players[0].extras.map((x) => x.rid), ['rerunner']);
  assert.deepStrictEqual(g.players[1].extras, []);
});
test('返场王：赛场外技能不会被复制——混合模式下返场王领跑时，模仿猫不应复制到「再跑一次」', () => {
  const g = setup([['copycat', 0], ['rerunner', 5]], { edition: 'mix' });
  run(g, g.refreshCopies());
  assert.notStrictEqual(g.power(R(g, 'copycat')), 'rerunner');
  assert(!g.powers(R(g, 'copycat')).includes('rerunner'));
});

/* ================= 显摆王 showoff ================= */
// 掷完主移动骰后，可以继续掷并累加；每次都必须比上一次大，否则这次主移动不动。
test('显摆王：可以不继续掷，就按第一颗走', () => {
  const g = S([['showoff', 0], ['hotel', 20]]);
  dice(g, [3]);
  const asked = turn(g, 'showoff', { showoff: 'stop' });
  assert(asked.includes('showoff'));
  assert.strictEqual(R(g, 'showoff').pos, 3);
  used(g);
});
test('显摆王：每次都比上一次大就一直累加（1+3+5）', () => {
  const g = S([['showoff', 0], ['hotel', 20]]);
  dice(g, [1, 3, 5]);
  const asked = turn(g, 'showoff', { showoff: seq('more', 'more', 'stop') });
  assert.strictEqual(count(asked, 'showoff'), 3);
  assert.strictEqual(R(g, 'showoff').pos, 9);
});
test('显摆王：追加掷出和上一次相同的点数也算失败，这次不动', () => {
  const g = S([['showoff', 0], ['hotel', 20]]);
  dice(g, [3, 3]);
  turn(g, 'showoff', { showoff: 'more' });
  assert.strictEqual(R(g, 'showoff').pos, 0);
});
test('显摆王：已经累加过，再追加失败时整次作废（1+4 之后掷 2，不动）', () => {
  const g = S([['showoff', 0], ['hotel', 20]]);
  dice(g, [1, 4, 2]);
  turn(g, 'showoff', { showoff: 'more' });
  assert.strictEqual(R(g, 'showoff').pos, 0);
  assert.strictEqual(ev(g, 'move').length, 0);
});
test('显摆王：掷出 6 后没有更大的点数，不再询问', () => {
  const g = S([['showoff', 0], ['hotel', 20]]);
  dice(g, [6]);
  const asked = turn(g, 'showoff');
  assert(!asked.includes('showoff'));
  assert.strictEqual(R(g, 'showoff').pos, 6);
});
test('显摆王：先累加再算加减值（后爸 +2）；累加的总数可以冲线', () => {
  let g = S([['stepdad', 20], ['showoff', 0]]);
  dice(g, [2, 4]);
  turn(g, 'showoff', { showoff: seq('more', 'stop') });
  assert.strictEqual(R(g, 'showoff').pos, 8, '2+4+2');
  g = S([['showoff', 22], ['hotel', 0], ['gloth', 0]]);
  dice(g, [3, 5]);
  turn(g, 'showoff', { showoff: seq('more', 'stop') });
  assert.strictEqual(R(g, 'showoff').finished, 1);
});
test('显摆王 × 电鳗：每颗都算 1，追加必然失败', () => {
  const g = S([['stunner', 1], ['showoff', 0]]);
  dice(g, [5, 6]);
  turn(g, 'showoff', { showoff: 'more' });
  assert.deepStrictEqual(ev(g, 'roll').map((e) => e.value), [1, 1]);
  assert.strictEqual(R(g, 'showoff').pos, 0);
});
test('显摆王：被空指针屏蔽时不能继续掷，还要 -1', () => {
  const g = S([['nul', 0], ['showoff', 3]]);
  dice(g, [4]);
  const asked = turn(g, 'showoff');
  assert(!asked.includes('showoff'));
  assert.strictEqual(R(g, 'showoff').pos, 6);
});

/* ================= 灵魂伴侣 soulmate ================= */
// 赛前选一名对手的运动员；回合开始时如果和它相距 5 格以内，就瞬移到它的格子。注：瞬移后照常主移动。
test('灵魂伴侣：赛前只能从对手（其他玩家）的运动员里选', () => {
  const g = S([['soulmate', 0], ['hotel', 0], ['gloth', 0], ['rerunner', 0, { seat: 0, extra: true }]]);
  let opts = null;
  const asked = run(g, g.applyBeforeRace(R(g, 'soulmate'), 'soulmate', 0), { soulmate: (d) => { opts = d.options.map((o) => o.v); return 'gloth'; } });
  assert.deepStrictEqual(asked, ['soulmate']);
  assert.deepStrictEqual(opts, ['hotel', 'gloth'], '自己玩家的额外运动员不能选');
  assert.strictEqual(R(g, 'soulmate').mate, 'gloth');
  assert.deepStrictEqual(ev(g, 'mate').map((e) => e.target), ['gloth']);
});
test('灵魂伴侣：回合开始相距恰好 5 格就瞬移过去，然后照常主移动；相距 6 格不瞬移', () => {
  let g = S([['soulmate', 0, { mate: 'pooper' }], ['pooper', 5]]);
  dice(g, [2]);
  turn(g, 'soulmate');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[0, 5]]);
  assert.strictEqual(R(g, 'soulmate').pos, 7);
  g = S([['soulmate', 0, { mate: 'pooper' }], ['pooper', 6]]);
  dice(g, [2]);
  turn(g, 'soulmate');
  assert.strictEqual(ev(g, 'warp').length, 0);
  assert.strictEqual(R(g, 'soulmate').pos, 2);
});
test('灵魂伴侣：伴侣在身后 5 格以内也会瞬移过去（往回）', () => {
  const g = S([['soulmate', 10, { mate: 'pooper' }], ['pooper', 6]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[10, 6]]);
  assert.strictEqual(R(g, 'soulmate').pos, 7);
});
test('灵魂伴侣：已经同格时不瞬移；不是伴侣的人再近也不瞬移', () => {
  let g = S([['soulmate', 5, { mate: 'hotel' }], ['hotel', 5]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(ev(g, 'warp').length, 0);
  g = S([['soulmate', 0, { mate: 'hotel' }], ['hotel', 20], ['gloth', 2]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(ev(g, 'warp').length, 0);
  assert.strictEqual(R(g, 'soulmate').pos, 1);
});
test('灵魂伴侣：伴侣已冲线或已被淘汰，就不再瞬移', () => {
  let g = S([['soulmate', 26, { mate: 'hotel' }], ['hotel', 30, { finished: 1 }], ['gloth', 0]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 27);
  g = S([['soulmate', 6, { mate: 'hotel' }], ['hotel', 8, { out: true }], ['gloth', 0]]);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 7);
});
test('灵魂伴侣：瞬移落到小旅馆伴侣的格子要付房费；付不起被绊倒，这回合就不能主移动', () => {
  let g = S([['soulmate', 2, { mate: 'hotel' }], ['hotel', 5]]);
  g.giveChip(0, 'bronze', 1);
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.deepStrictEqual([g.score(0), g.score(1)], [0, 1]);
  assert.strictEqual(R(g, 'soulmate').pos, 6);
  g = S([['soulmate', 2, { mate: 'hotel' }], ['hotel', 5]]);
  dice(g, []);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 5);
  assert.strictEqual(ev(g, 'recover').length, 1);
});
test('[口径] 灵魂伴侣：瞬移到伴侣所在的漩涡口（伴侣刚从漩涡冒出来）会被漩涡传走', () => {
  const g = S([['soulmate', 3, { mate: 'hotel' }], ['hotel', 6]], { track: 'whirly' });
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[3, 6], [6, 4]]);
  assert.strictEqual(R(g, 'soulmate').pos, 5);
});
test('[口径] 灵魂伴侣：瞬移越过第 14 格变数招牌不抽变数卡', () => {
  const g = setup([['soulmate', 12, { mate: 'pooper' }], ['pooper', 16]]);
  g.twistDeck = ['roastchicken'];
  dice(g, [1]);
  turn(g, 'soulmate');
  assert.strictEqual(R(g, 'soulmate').pos, 17);
  assert.deepStrictEqual(g.twistDrawn, []);
});
test('灵魂伴侣：被空指针屏蔽时不瞬移', () => {
  const g = S([['nul', 0], ['soulmate', 2, { mate: 'hotel' }], ['hotel', 5]]);
  dice(g, [3]);
  turn(g, 'soulmate');
  assert.strictEqual(ev(g, 'warp').length, 0);
  assert.strictEqual(R(g, 'soulmate').pos, 4, '2 + 3 - 1');
});

/* ================= 飙车魔 speeddemon ================= */
// 我的玩家每有 1 分，主移动 +1；回合开始时如果我领先其他所有人至少 4 格，我被淘汰。
test('飙车魔：玩家每有 1 分主移动 +1；0 分不加', () => {
  let g = S([['speeddemon', 0], ['hotel', 3]]);
  dice(g, [2]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').pos, 2);
  g = S([['speeddemon', 0], ['hotel', 3]]);
  g.giveChip(0, 'gold', 3);
  g.giveChip(0, 'bronze', 1);
  dice(g, [2]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').pos, 6);
  assert.deepStrictEqual(ev(g, 'calc')[0].mods.map((m) => [m.label, m.v]), [['飙车魔', 4]]);
});
test('飙车魔：回合开始领先其他所有人恰好 4 格就被淘汰，不再掷骰', () => {
  const g = S([['speeddemon', 10], ['hotel', 6], ['gloth', 2]]);
  dice(g, []);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, true);
  assert.strictEqual(R(g, 'speeddemon').pos, 10);
  assert.deepStrictEqual(ev(g, 'out').map((e) => e.cause), ['speeddemon']);
  assert.strictEqual(ev(g, 'turnEnd').length, 1);
});
test('飙车魔：只领先 3 格不淘汰；有任何一人差距不足 4 格也不淘汰', () => {
  let g = S([['speeddemon', 9], ['hotel', 6]]);
  dice(g, [1]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, false);
  assert.strictEqual(R(g, 'speeddemon').pos, 10);
  g = S([['speeddemon', 10], ['hotel', 2], ['gloth', 7]]);
  dice(g, [1]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, false);
});
test('飙车魔：只在自己回合开始时检查——这一步拉开 4 格当场不淘汰，下回合开始才淘汰', () => {
  const g = S([['speeddemon', 5], ['hotel', 5]]);
  dice(g, [4]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').pos, 9);
  assert.strictEqual(R(g, 'speeddemon').out, false);
  dice(g, []);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, true);
});
test('[口径] 飙车魔：已冲线的运动员不算在「其他所有人」里', () => {
  const g = S([['speeddemon', 20], ['hotel', 30, { finished: 1 }], ['gloth', 15]]);
  dice(g, []);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, true, '只和场上的树懒比，领先 5 格');
});
test('[口径] 飙车魔：场上只剩自己时不会因「领先所有人」被淘汰', () => {
  const g = S([['speeddemon', 20], ['hotel', 30, { finished: 1 }], ['gloth', 3, { out: true }]]);
  dice(g, [1]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, false);
  assert.strictEqual(R(g, 'speeddemon').pos, 21);
});
test('飙车魔：被空指针屏蔽时既不会被淘汰，也没有分数加成', () => {
  const g = S([['nul', 0], ['speeddemon', 10]]);
  g.giveChip(1, 'bronze', 2);
  dice(g, [3]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').out, false);
  assert.strictEqual(R(g, 'speeddemon').pos, 12, '10 + 3 - 1');
});
test('飙车魔：「我的玩家」看当前控制者——被调包精换走后按新玩家的分数加成', () => {
  const g = S([['switcharoo', 0], ['speeddemon', 2]]);
  g.giveChip(0, 'bronze', 5);
  dice(g, [1]);
  turn(g, 'switcharoo', { switcharoo: 'speeddemon' });
  assert.strictEqual(R(g, 'speeddemon').seat, 0);
  dice(g, [1]);
  turn(g, 'speeddemon');
  assert.strictEqual(R(g, 'speeddemon').pos, 8, '2 + 1 + 5');
});

/* ================= 搅局鬼 spoilsport ================= */
// 回合开始时，如果其他运动员都领先我至少 5 格，本场比赛取消，我拿 3 分。注：已经冲线的名次分照常保留。
test('搅局鬼：其他人都领先至少 5 格（恰好 5 也算）→ 本场取消，拿 3 分，不再掷骰', () => {
  const g = S([['spoilsport', 0], ['hotel', 5], ['gloth', 9]]);
  dice(g, []);
  turn(g, 'spoilsport');
  assert(g.ended);
  assert.strictEqual(g.raceEndReason, 'cancelled');
  assert.strictEqual(g.score(0), 3);
  assert.strictEqual(ev(g, 'cancel').length, 1);
  assert.strictEqual(R(g, 'spoilsport').pos, 0);
});
test('搅局鬼：有一人只领先 4 格就不取消，照常掷骰', () => {
  const g = S([['spoilsport', 1], ['hotel', 5], ['gloth', 20]]);
  dice(g, [2]);
  turn(g, 'spoilsport');
  assert(!g.ended);
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(R(g, 'spoilsport').pos, 3);
});
test('搅局鬼：只在自己回合开始时判断——别人回合里落后 5 格不会取消', () => {
  const g = S([['spoilsport', 0], ['hotel', 5], ['gloth', 9]]);
  dice(g, [1]);
  turn(g, 'hotel');
  assert(!g.ended);
});
test('搅局鬼：已冲线和已淘汰的运动员不参与判断；已冲线的名次分照常保留', () => {
  const g = S([['spoilsport', 2], ['hotel', 29], ['gloth', 3, { out: true }], ['pooper', 8]]);
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(g.score(1), 3);
  dice(g, []);
  turn(g, 'spoilsport');
  assert(g.ended);
  assert.strictEqual(g.raceEndReason, 'cancelled');
  assert.strictEqual(g.score(1), 3, '金牌保留');
  assert.strictEqual(g.score(0), 3);
});
test('搅局鬼：比赛循环里轮到它就取消本场，结算记为「取消」', () => {
  const g = S([['hotel', 5], ['pooper', 9], ['spoilsport', 0]]);
  dice(g, [1, 1]);
  run(g, g.raceLoop(0));
  assert(g.ended);
  assert.strictEqual(g.turns, 3);
  g.afterRace(0);
  assert.strictEqual(g.results[0].reason, 'cancelled');
  assert.strictEqual(g.score(2), 3);
});
test('搅局鬼：季终决战暂扣的名次分，在比赛取消时照常发放', () => {
  const g = S([['spoilsport', 0], ['hotel', 29], ['gloth', 9]]);
  g.finale = 'armed';
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(g.score(1), 0, '名次分暂扣');
  dice(g, []);
  turn(g, 'spoilsport');
  assert(g.ended);
  assert.strictEqual(g.startFinale(), null, '比赛取消不进行决战');
  assert.strictEqual(g.score(1), 3);
  assert.strictEqual(g.score(0), 3);
});
test('[口径] 搅局鬼：场上只剩自己时不取消（已冲线的人不算「领先我」）', () => {
  const g = S([['spoilsport', 20], ['hotel', 30, { finished: 1 }], ['gloth', 3, { out: true }]]);
  dice(g, [1]);
  turn(g, 'spoilsport');
  assert(!g.ended);
  assert.strictEqual(R(g, 'spoilsport').pos, 21);
});
test('搅局鬼 × 星二代：两人局星二代赛前摆到第 12 格，搅局鬼第一个回合开始就取消本场', () => {
  const g = S([['spoilsport', 0], ['nepobaby', 0]]);
  run(g, g.beforeRace());
  dice(g, []);
  turn(g, 'spoilsport');
  assert(g.ended);
  assert.strictEqual(g.raceEndReason, 'cancelled');
  assert.strictEqual(g.score(0), 3);
});

/* ================= 后爸 stepdad ================= */
// 我下家的运动员主移动 +2；它拿第一名时，我拿 3 分。
// 注：下家是行动顺序里排在我后面的那位玩家；下家没有在场的运动员就再往后找。
test('后爸：下家（座位 +1）的运动员主移动 +2；其他人和后爸自己不加', () => {
  const g = S([['stepdad', 0], ['hotel', 0], ['pooper', 0]]);
  dice(g, [1, 1, 1]);
  turn(g, 'hotel');
  turn(g, 'pooper');
  turn(g, 'stepdad');
  assert.deepStrictEqual(pos(g), { stepdad: 1, hotel: 3, pooper: 1 });
  assert.deepStrictEqual(ev(g, 'calc').map((e) => [e.rid, e.mods.map((m) => m.label)]), [['hotel', ['后爸']]]);
});
test('后爸：坐在最后一席时，下家绕回第 0 席', () => {
  const g = S([['hotel', 0], ['pooper', 0], ['stepdad', 0]]);
  dice(g, [1, 1]);
  turn(g, 'hotel');
  turn(g, 'pooper');
  assert.deepStrictEqual(pos(g), { hotel: 3, pooper: 1, stepdad: 0 });
});
test('后爸：下家没有在场的运动员（已冲线/中途被淘汰）就再往后找', () => {
  let g = S([['stepdad', 0], ['hotel', 30, { finished: 1 }], ['pooper', 0]]);
  dice(g, [1]);
  turn(g, 'pooper');
  assert.strictEqual(R(g, 'pooper').pos, 3);
  g = S([['stepdad', 0], ['hotel', 5], ['pooper', 0]]);
  assert.strictEqual(g.stepchild(R(g, 'stepdad')), R(g, 'hotel'));
  run(g, g.eliminate(R(g, 'hotel'), null, 'monster')); // 被狼人怪追上
  assert.strictEqual(g.stepchild(R(g, 'stepdad')), R(g, 'pooper'));
});
test('后爸：继子拿第一名时后爸拿 3 分；继子只拿第二名则没有', () => {
  let g = S([['stepdad', 0], ['hotel', 29], ['pooper', 0]]);
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.deepStrictEqual([g.score(0), g.score(1)], [3, 3]);
  g = S([['stepdad', 0], ['hotel', 28], ['pooper', 29]]);
  run(g, g.move(R(g, 'pooper'), 1, 'main'));
  run(g, g.move(R(g, 'hotel'), 2, 'main'));
  assert.strictEqual(R(g, 'hotel').finished, 2);
  assert.strictEqual(g.score(0), 0);
});
test('后爸：继子靠技能移动（派对杀手前进 1）冲线拿第一也算', () => {
  const g = S([['stepdad', 0], ['pooper', 29], ['hotel', 0]]);
  dice(g, [6, 2]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'pooper').finished, 1);
  assert.strictEqual(g.score(0), 3);
});
test('后爸：继子主移动 +2 冲线拿第一，后爸拿 3 分', () => {
  const g = S([['stepdad', 0], ['hotel', 26], ['pooper', 0]]);
  dice(g, [2]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(g.score(0), 3);
});
test('后爸：被空指针屏蔽时继子没有 +2，夺冠也不给分', () => {
  const g = S([['stepdad', 5], ['hotel', 3], ['nul', 0]]);
  dice(g, [3]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 5, '3 + 3 - 1，没有 +2');
  R(g, 'hotel').pos = 29;
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(R(g, 'hotel').finished, 1);
  assert.strictEqual(g.score(0), 0);
});
test('[口径] 后爸：下家同时控制主运动员和额外运动员时，只有主运动员算继子；主运动员离场后改由额外运动员接替', () => {
  const g = S([['stepdad', 0], ['hotel', 0], ['rerunner', 0, { seat: 1, extra: true }]]);
  dice(g, [1, 1]);
  turn(g, 'hotel');
  turn(g, 'rerunner');
  assert.deepStrictEqual(pos(g), { stepdad: 0, hotel: 3, rerunner: 1 });
  R(g, 'hotel').finished = 1;
  assert.strictEqual(g.stepchild(R(g, 'stepdad')), R(g, 'rerunner'));
});
test('[口径] 后爸 × 季终决战：继子先冲线就当场拿 3 分，不等决战结果', () => {
  const g = S([['stepdad', 0], ['hotel', 29], ['pooper', 0]]);
  g.finale = 'armed';
  run(g, g.move(R(g, 'hotel'), 1, 'main'));
  assert.strictEqual(g.score(1), 0, '继子的金牌暂扣到决战');
  assert.strictEqual(g.score(0), 3, '后爸的 3 分当场发放');
});

/* ================= 裸奔侠 streaker ================= */
// 每次移动只要超过了别人，我就拿 1 分。注：一次超过好几人也只拿 1 分；瞬移不算。
test('裸奔侠：主移动超过人拿 1 分；一次超过好几人也只拿 1 分', () => {
  const g = S([['streaker', 0], ['hotel', 1], ['gloth', 2]]);
  dice(g, [4]);
  turn(g, 'streaker');
  assert.strictEqual(g.score(0), 1);
  assert.strictEqual(said(g, /裸奔侠一闪而过/).length, 1);
});
test('裸奔侠：只是落到别人同格不算超过，不拿分', () => {
  const g = S([['streaker', 0], ['hotel', 3]]);
  run(g, g.move(R(g, 'streaker'), 3, 'main'));
  assert.strictEqual(g.score(0), 0);
});
test('裸奔侠：「每次移动」——技能移动也算，每次超过分别拿分', () => {
  const g = S([['streaker', 0], ['hotel', 1], ['gloth', 3]]);
  run(g, g.move(R(g, 'streaker'), 2, 'power'));
  run(g, g.move(R(g, 'streaker'), 2, 'power'));
  assert.strictEqual(R(g, 'streaker').pos, 4);
  assert.strictEqual(g.score(0), 2);
});
test('裸奔侠：后退经过别人不算超过', () => {
  const g = S([['streaker', 5], ['hotel', 3]]);
  run(g, g.move(R(g, 'streaker'), -4, 'power'));
  assert.strictEqual(R(g, 'streaker').pos, 1);
  assert.strictEqual(g.score(0), 0);
});
test('裸奔侠：瞬移不算——漩涡传送越过人不拿分，走到漩涡口之前越过人照样拿分', () => {
  let g = S([['streaker', 9], ['hotel', 13]], { track: 'whirly' });
  run(g, g.move(R(g, 'streaker'), 2, 'main'));
  assert.strictEqual(R(g, 'streaker').pos, 15, '11 → 15');
  assert.strictEqual(g.score(0), 0);
  g = S([['streaker', 2], ['hotel', 3]], { track: 'whirly' });
  run(g, g.move(R(g, 'streaker'), 2, 'main'));
  assert.strictEqual(R(g, 'streaker').pos, 6, '4 → 6');
  assert.strictEqual(g.score(0), 1);
});
test('裸奔侠：已淘汰的人不算被超过', () => {
  const g = S([['streaker', 0], ['hotel', 2, { out: true }], ['gloth', 10]]);
  run(g, g.move(R(g, 'streaker'), 4, 'main'));
  assert.strictEqual(g.score(0), 0);
});
test('裸奔侠：冲线那一步超过人也拿分', () => {
  const g = S([['streaker', 26], ['hotel', 28], ['gloth', 0]]);
  dice(g, [5]);
  turn(g, 'streaker');
  assert.strictEqual(R(g, 'streaker').finished, 1);
  assert.strictEqual(g.score(0), 1 + 3);
});
test('裸奔侠：被空指针屏蔽时超过人不拿分', () => {
  const g = S([['nul', 0], ['streaker', 2], ['hotel', 4]]);
  run(g, g.move(R(g, 'streaker'), 3, 'main'));
  assert.strictEqual(g.score(1), 0);
});
test('[口径] 裸奔侠：这一步越过空指针就立刻失去技能，即使先越过了别人，这一步也不拿分', () => {
  let g = S([['streaker', 0], ['hotel', 2], ['nul', 4]]);
  run(g, g.move(R(g, 'streaker'), 6, 'main'));
  assert.strictEqual(g.score(0), 0);
  // 对照：没越过空指针就照常拿分
  g = S([['streaker', 0], ['hotel', 2], ['nul', 9]]);
  run(g, g.move(R(g, 'streaker'), 6, 'main'));
  assert.strictEqual(g.score(0), 1);
});

/* ================= 电鳗 stunner ================= */
// 离我 1 格以内的其他运动员，掷出的骰子一律算 1。
test('电鳗：在它身后 1 格、同格、前面 1 格的运动员掷骰都算 1', () => {
  for (const p of [4, 5, 6]) {
    const g = S([['stunner', 5], ['hotel', p]]);
    dice(g, [5]);
    turn(g, 'hotel');
    assert.strictEqual(R(g, 'hotel').pos, p + 1, `第 ${p} 格`);
  }
});
test('电鳗：相距 2 格就不受影响', () => {
  for (const p of [3, 7]) {
    const g = S([['stunner', 5], ['hotel', p]]);
    dice(g, [5]);
    turn(g, 'hotel');
    assert.strictEqual(R(g, 'hotel').pos, p + 5, `第 ${p} 格`);
  }
});
test('电鳗：只管「其他」运动员，自己掷骰不受影响', () => {
  const g = S([['stunner', 5], ['hotel', 5]]);
  dice(g, [5]);
  turn(g, 'stunner');
  assert.strictEqual(R(g, 'stunner').pos, 10);
});
test('电鳗：不只主移动骰——水龙头回合结束掷的骰也算 1', () => {
  const g = S([['hose', 4], ['stunner', 5], ['hotel', 6], ['gloth', 7]]);
  dice(g, [3, 4]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 5);
  assert.deepStrictEqual(ev(g, 'roll').map((e) => e.value), [1, 1]);
  assert.deepStrictEqual(tripped(g), { hose: false, stunner: false, hotel: true, gloth: false });
});
test('电鳗：按掷骰那一刻的距离判断（主移动被电麻，走远后回合结束的骰不受影响）', () => {
  const g = S([['hose', 6], ['stunner', 5], ['hotel', 8], ['gloth', 9]]);
  dice(g, [3, 2]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 7);
  assert.deepStrictEqual(ev(g, 'roll').map((e) => e.value), [1, 2]);
  assert.deepStrictEqual(tripped(g), { hose: false, stunner: false, hotel: true, gloth: true });
});
test('电鳗：算成 1 会触发「掷出 1」的技能（咬痕变身狼人）', () => {
  const g = S([['bitemark', 4], ['stunner', 5]]);
  dice(g, [5]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').wolf, true);
  assert.strictEqual(R(g, 'bitemark').pos, 5);
});
test('电鳗：被空指针屏蔽时失效', () => {
  const g = S([['nul', 0], ['stunner', 5], ['hotel', 4]]);
  dice(g, [5]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 8, '5 - 1');
});

/* ================= 调包精 switcharoo ================= */
// 回合结束时，可以和 1 格以内另一位玩家的运动员交换控制权：之后我归对方，它归我的玩家。
test('调包精：回合结束（主移动之后）和 1 格以内另一位玩家的运动员交换控制权', () => {
  const g = S([['switcharoo', 0], ['hotel', 4]]);
  dice(g, [5]);
  const asked = turn(g, 'switcharoo', { switcharoo: 'hotel' });
  assert.strictEqual(asked[asked.length - 1], 'switcharoo');
  assert.strictEqual(R(g, 'switcharoo').pos, 5);
  assert.deepStrictEqual([R(g, 'switcharoo').seat, R(g, 'hotel').seat], [1, 0]);
  assert.deepStrictEqual(g.seatRacers(0).map((r) => r.rid), ['hotel']);
  assert.deepStrictEqual(g.seatRacers(1).map((r) => r.rid), ['switcharoo']);
});
test('调包精：相距 2 格没有机会，不询问', () => {
  const g = S([['switcharoo', 0], ['hotel', 3]]);
  dice(g, [1]);
  const asked = turn(g, 'switcharoo');
  assert(!asked.includes('switcharoo'));
  assert.strictEqual(R(g, 'switcharoo').seat, 0);
});
test('调包精：可以选择不调包', () => {
  const g = S([['switcharoo', 0], ['hotel', 2]]);
  dice(g, [1]);
  const asked = turn(g, 'switcharoo', { switcharoo: '_no' });
  assert(asked.includes('switcharoo'));
  assert.deepStrictEqual([R(g, 'switcharoo').seat, R(g, 'hotel').seat], [0, 1]);
  assert.strictEqual(ev(g, 'control').length, 0);
});
test('调包精：自己玩家的其他运动员（额外运动员）不能当对象', () => {
  const g = S([['switcharoo', 0], ['hotel', 10], ['rerunner', 2, { seat: 0, extra: true }]]);
  dice(g, [1]);
  const asked = turn(g, 'switcharoo');
  assert(!asked.includes('switcharoo'));
});
test('调包精：换完后由新控制者行动，名次分也归新控制者（比赛循环）', () => {
  const g = S([['switcharoo', 27], ['pooper', 28]]);
  dice(g, [1, 2, 2]);
  run(g, g.raceLoop(0), { switcharoo: 'pooper' });
  assert(g.ended);
  assert.deepStrictEqual(ev(g, 'turn').map((e) => [e.seat, e.rid]), [[0, 'switcharoo'], [1, 'switcharoo'], [0, 'pooper']]);
  assert.deepStrictEqual([R(g, 'switcharoo').finished, R(g, 'pooper').finished], [1, 2]);
  assert.deepStrictEqual([g.score(0), g.score(1)], [1, 3]);
});
test('调包精：主移动冲线离场后，回合结束不再调包', () => {
  const g = S([['switcharoo', 28], ['hotel', 29], ['gloth', 0]]);
  dice(g, [2]);
  const asked = turn(g, 'switcharoo');
  assert(!asked.includes('switcharoo'));
  assert.strictEqual(R(g, 'switcharoo').seat, 0);
});
test('调包精：被空指针屏蔽时不能调包', () => {
  const g = S([['nul', 0], ['switcharoo', 3], ['hotel', 5]]);
  dice(g, [2]);
  const asked = turn(g, 'switcharoo');
  assert.strictEqual(R(g, 'switcharoo').pos, 4);
  assert(!asked.includes('switcharoo'));
});

/* ================= 跟屁虫 tail ================= */
// 回合开始时，可以瞬移到前方最近那名运动员身后一格。
test('跟屁虫：回合开始瞬移到前方最近那名运动员身后一格，然后照常主移动', () => {
  const g = S([['tail', 0], ['hotel', 6], ['gloth', 4]]);
  dice(g, [1]);
  const asked = turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(asked[0], 'tail');
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[0, 3]]);
  assert.strictEqual(R(g, 'tail').pos, 4);
});
test('跟屁虫：可以选择不跟', () => {
  const g = S([['tail', 0], ['hotel', 6]]);
  dice(g, [1]);
  turn(g, 'tail', { tail: 'no' });
  assert.strictEqual(ev(g, 'warp').length, 0);
  assert.strictEqual(R(g, 'tail').pos, 1);
});
test('跟屁虫：已经紧贴在最近者身后、或前方没人时不询问', () => {
  let g = S([['tail', 3], ['hotel', 4]]);
  dice(g, [2]);
  let asked = turn(g, 'tail');
  assert(!asked.includes('tail'));
  g = S([['tail', 10], ['hotel', 4]]);
  dice(g, [2]);
  asked = turn(g, 'tail');
  assert(!asked.includes('tail'));
});
test('跟屁虫：同格的人不算「前方」，已冲线的人也不算', () => {
  let g = S([['tail', 3], ['hotel', 3], ['gloth', 8]]);
  dice(g, [1]);
  turn(g, 'tail', { tail: 'yes' });
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[3, 7]]);
  g = S([['tail', 20], ['hotel', 30, { finished: 1 }], ['gloth', 5]]);
  dice(g, [1]);
  const asked = turn(g, 'tail');
  assert(!asked.includes('tail'));
});
test('跟屁虫：摔倒时也能在回合开始瞬移，随后照常跳过主移动', () => {
  const g = S([['tail', 0, { tripped: true }], ['hotel', 6]]);
  dice(g, []);
  turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(R(g, 'tail').pos, 5);
  assert.strictEqual(R(g, 'tail').tripped, false);
});
test('[口径] 跟屁虫：瞬移越过第 14 格变数招牌不抽变数卡', () => {
  const g = setup([['tail', 10], ['hotel', 17]]);
  g.twistDeck = ['roastchicken'];
  dice(g, [1]);
  turn(g, 'tail', { tail: 'yes' });
  assert.strictEqual(R(g, 'tail').pos, 17);
  assert.deepStrictEqual(g.twistDrawn, []);
});
test('[口径] 跟屁虫：瞬移落到漩涡口会被传走（可能反而跑到目标前面）', () => {
  const g = S([['tail', 0], ['hotel', 5]], { track: 'whirly' });
  dice(g, [1]);
  turn(g, 'tail', { tail: 'yes' });
  assert.deepStrictEqual(ev(g, 'warp').map((e) => [e.from, e.to]), [[0, 4], [4, 6]]);
  assert.strictEqual(R(g, 'tail').pos, 7);
});
test('跟屁虫：被空指针屏蔽时不能瞬移', () => {
  const g = S([['nul', 0], ['tail', 2], ['hotel', 8]]);
  dice(g, [2]);
  const asked = turn(g, 'tail');
  assert(!asked.includes('tail'));
  assert.strictEqual(R(g, 'tail').pos, 3);
});

/* ================= 水龙头 hose ================= */
// 回合结束时掷一颗骰，前方这个距离以内的运动员全部绊倒。
test('水龙头：回合结束按主移动后的位置掷骰，前方这个距离以内的全部绊倒（恰好等于也算）；身后、同格、更远的不绊', () => {
  const g = S([['hose', 2], ['pooper', 1], ['streaker', 3], ['gloth', 6], ['overtaker', 7]]);
  dice(g, [1, 3]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 3);
  assert.deepStrictEqual(tripped(g), { hose: false, pooper: false, streaker: false, gloth: true, overtaker: false });
  assert.strictEqual(ev(g, 'trip').length, 1);
});
test('水龙头：前方距离内的好几个人全部绊倒', () => {
  const g = S([['hose', 0], ['hotel', 2], ['gloth', 4], ['pooper', 5]]);
  dice(g, [1, 4]);
  turn(g, 'hose');
  assert.deepStrictEqual(tripped(g), { hose: false, hotel: true, gloth: true, pooper: true });
});
test('水龙头：自己摔倒跳过主移动时，回合结束照样掷骰', () => {
  const g = S([['hose', 0, { tripped: true }], ['hotel', 2]]);
  dice(g, [3]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 0);
  assert.strictEqual(R(g, 'hotel').tripped, true);
  used(g);
});
test('水龙头：主移动冲线离场后不再掷骰', () => {
  const g = S([['hose', 28], ['hotel', 0], ['gloth', 0]]);
  dice(g, [2]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').finished, 1);
  used(g);
});
test('水龙头：被空指针屏蔽时不掷骰', () => {
  const g = S([['nul', 0], ['hose', 3], ['hotel', 5]]);
  dice(g, [2]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'hose').pos, 4);
  assert.strictEqual(R(g, 'hotel').tripped, false);
  used(g);
});
test('水龙头：被绊倒的攀滚企鹅下回合照样掷骰并翻倍', () => {
  const g = S([['hose', 0], ['penguin', 3]]);
  dice(g, [1, 4, 2]);
  turn(g, 'hose');
  assert.strictEqual(R(g, 'penguin').tripped, true);
  turn(g, 'penguin');
  assert.strictEqual(R(g, 'penguin').pos, 7);
});
test('水龙头：回合结束的骰不是主移动骰，宿敌不能跟', () => {
  const g = S([['hose', 0], ['nemesis', 20], ['hotel', 3]]);
  dice(g, [1, 2]);
  const asked = turn(g, 'hose', { nemesis: 'no' });
  assert.strictEqual(count(asked, 'nemesis'), 1, '只在主移动骰时问一次');
  assert.strictEqual(R(g, 'hotel').tripped, true);
});
test('水龙头：额外回合结束时也掷（跳山羊再来一回合，冲线后不再掷）', () => {
  const g = S([['hose', 26, { stack: ['hopfrog'] }], ['hotel', 29]]);
  dice(g, [2, 1, 2, 1]);
  run(g, g.raceLoop(0));
  assert(g.ended);
  assert.deepStrictEqual(ev(g, 'turn').map((e) => e.rid), ['hose', 'hose', 'hotel', 'hotel']);
  assert.strictEqual(ev(g, 'extraTurn').length, 1);
  assert.strictEqual(ev(g, 'roll').filter((e) => e.purpose === 'hose').length, 1);
  assert.deepStrictEqual([R(g, 'hose').finished, R(g, 'hotel').finished], [1, 2]);
});

/* ================= 替补演员 understudy ================= */
// 赛前挑一名对手的运动员，本场使用它的技能。注：学到赛前技能也会立刻生效。
test('替补演员：只能从对手的运动员里挑（不含自己玩家的、别的替补演员、赛场外技能）', () => {
  const g = S([['understudy', 0], ['hotel', 0], ['rerunner', 0], ['pooper', 0, { power: 'understudy' }], ['gloth', 0, { seat: 0, extra: true }]]);
  let opts = null;
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: (d) => { opts = d.options.map((o) => o.v); return 'hotel'; } });
  assert.deepStrictEqual(opts, ['hotel']);
  assert.strictEqual(R(g, 'understudy').power, 'hotel');
});
test('替补演员：学到后本场使用该技能，对手仍保留自己的技能', () => {
  const g = S([['understudy', 4], ['stunner', 20], ['hotel', 5]]);
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: 'stunner' });
  assert(g.has(R(g, 'understudy'), 'stunner'));
  assert(g.has(R(g, 'stunner'), 'stunner'));
  dice(g, [5]);
  turn(g, 'hotel');
  assert.strictEqual(R(g, 'hotel').pos, 6, '在替补演员 1 格内被电麻');
});
test('替补演员：学到赛前技能立刻生效（星二代：直接摆到第 12 格）', () => {
  const g = S([['understudy', 0], ['nepobaby', 0]]);
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: 'nepobaby' });
  assert.strictEqual(R(g, 'understudy').pos, 12);
  assert.strictEqual(ev(g, 'move').length, 0);
});
test('替补演员：在比赛开始的赛前流程里，学来的赛前技能和原主各自生效', () => {
  const g = S([['understudy', 0], ['nepobaby', 0]]);
  run(g, g.beforeRace(), { understudy: 'nepobaby' });
  assert.deepStrictEqual(pos(g), { understudy: 12, nepobaby: 12 });
});
test('替补演员：学到灵魂伴侣，立刻再选一名对手当伴侣', () => {
  const g = S([['understudy', 0], ['soulmate', 0], ['hotel', 0]]);
  const asked = run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: 'soulmate', soulmate: 'hotel' });
  assert.deepStrictEqual(asked, ['understudy', 'soulmate']);
  assert.strictEqual(R(g, 'understudy').mate, 'hotel');
});
test('替补演员：没有可学的对手技能（对手只有返场王）时不询问，保持原样', () => {
  const g = S([['understudy', 0], ['rerunner', 0]]);
  const asked = run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0));
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'understudy').power, 'understudy');
  assert.strictEqual(said(g, /没有可以学的对手技能/).length, 1);
});
test('替补演员：学来的技能同样会被空指针屏蔽', () => {
  const g = S([['understudy', 0], ['icarus', 0], ['nul', 0]]);
  run(g, g.applyBeforeRace(R(g, 'understudy'), 'understudy', 0), { understudy: 'icarus' });
  R(g, 'understudy').pos = 3;
  dice(g, [2]);
  turn(g, 'understudy');
  assert.strictEqual(R(g, 'understudy').pos, 4, '3 + 2 - 1，没有伊卡洛斯 +3');
});
test('替补演员：学来的技能只用「本场」——被时间小鬼送到下一场时，要重新挑对手学技能', () => {
  const g = setup([['understudy', 5, { power: 'icarus', via: 'icarus' }], ['hotel', 3], ['gloth', 0]]);
  g.twistDeck = ['timeimp'];
  run(g, g.drawTwist(R(g, 'understudy')));
  assert.strictEqual(R(g, 'understudy').out, true);
  g.afterRace(0);
  g.players[0].hand = ['understudy', 'pooper']; g.players[0].used = ['understudy'];
  g.players[1].hand = ['hotel', 'streaker']; g.players[1].used = ['hotel'];
  g.players[2].hand = ['gloth', 'overtaker']; g.players[2].used = ['gloth'];
  g.raceNo = 2; g.trackKey = 'twisty'; g.twistDeck = []; g.twistDiscard = [];
  g.d6 = () => 5;
  const asked = run(g, g.runRace(1), { pickRacer: (d, s) => d.optionsBySeat[s][0].v, understudy: 'streaker' });
  assert(asked.includes('understudy'), '下一场赛前应重新挑对手');
});
