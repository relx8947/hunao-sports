'use strict';
const { assert, test, setup, dice, run, turn, move, R, ev, said, pos, twist } = require('./helpers');
// 二代运动员（上半）按卡牌原文逐句断言：
// bitemark blunderdog cheatah critic diva doppel gloth hogknight hopfrog hotel icarus kingtripper kraken
// saboteur magicalathlete mole diceguy mush
//
// 陪跑运动员：星二代 nepobaby、替补演员 understudy、灵魂伴侣 soulmate（没选伴侣）只有赛前技能，
// 夹具不跑赛前流程，所以它们在回合中不产生任何效果，可以当「普通人」摆盘。
// 扭扭糖果第 14 格会翻变数卡：S() 把本场变数标记为已翻，避免随机变数卡干扰与本卡无关的断言。
const S = (list, opts) => { const g = setup(list, opts); g.twistDone = true; return g; };
const noDice = (g) => { g.d6 = () => { throw new Error('不应掷骰'); }; };
const moves = (g) => ev(g, 'move').map((e) => [e.rid, e.from, e.to]);
void said; void twist;

/* ======================= 咬痕 bitemark ======================= */
test('咬痕·主移动掷出 1：永久变身成狼人', () => {
  const g = S([['bitemark', 0], ['nepobaby', 5]]);
  dice(g, [1]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').wolf, true);
  assert.strictEqual(R(g, 'bitemark').pos, 1);
  assert.strictEqual(ev(g, 'wolf').length, 1);
});
test('咬痕·掷出 2：变身在这一步移动之前完成，这一步超过的人直接淘汰；落点同格的人不算被超过', () => {
  const g = S([['bitemark', 0], ['nepobaby', 1], ['understudy', 2]]);
  dice(g, [2]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').pos, 2);
  assert.deepStrictEqual(ev(g, 'out').map((e) => [e.rid, e.cause, e.by]), [['nepobaby', 'bitemark', 'bitemark']]);
  assert.strictEqual(R(g, 'understudy').out, false);
  const iw = g.events.findIndex((e) => e.t === 'wolf'), im = g.events.findIndex((e) => e.t === 'move');
  assert(iw >= 0 && iw < im, '变身事件应在移动之前');
});
test('咬痕·掷出 3~6 不变身；没变身时超过人也不淘汰', () => {
  for (const v of [3, 4, 5, 6]) {
    const g = S([['bitemark', 0], ['nepobaby', 1], ['understudy', 25]]);
    dice(g, [v]);
    turn(g, 'bitemark');
    assert(!R(g, 'bitemark').wolf, `掷 ${v} 不该变身`);
    assert.strictEqual(R(g, 'bitemark').pos, v);
    assert.strictEqual(R(g, 'nepobaby').out, false);
  }
});
test('咬痕·变身是永久的：之后回合掷 5 超过人照样淘汰，不会重复变身', () => {
  const g = S([['bitemark', 0], ['nepobaby', 3], ['understudy', 20]]);
  dice(g, [1, 5]);
  turn(g, 'bitemark');
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').pos, 6);
  assert.strictEqual(R(g, 'nepobaby').out, true);
  assert.strictEqual(ev(g, 'wolf').length, 1);
});
test('咬痕·狼人用技能移动超过人也淘汰；后退经过的人不算被超过', () => {
  const g = S([['bitemark', 5, { wolf: true }], ['nepobaby', 7], ['understudy', 3]]);
  move(g, 'bitemark', 4, 'power');
  assert.strictEqual(R(g, 'nepobaby').out, true);
  move(g, 'bitemark', -8, 'power');
  assert.strictEqual(R(g, 'bitemark').pos, 1);
  assert.strictEqual(R(g, 'understudy').out, false);
});
test('咬痕·漩涡：踩漩涡口之前超过的人淘汰，传送途经的人不算被超过', () => {
  const g = S([['bitemark', 2, { wolf: true }], ['nepobaby', 3], ['understudy', 5]], { track: 'whirly' });
  dice(g, [2]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').pos, 6, '4 号漩涡口传到 6');
  assert.strictEqual(R(g, 'nepobaby').out, true);
  assert.strictEqual(R(g, 'understudy').out, false);
});
test('咬痕·冲线那一步超过的人也被淘汰', () => {
  const g = S([['bitemark', 26, { wolf: true }], ['nepobaby', 28], ['understudy', 5]]);
  dice(g, [5]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').finished, 1);
  assert.strictEqual(R(g, 'nepobaby').out, true);
  assert.strictEqual(R(g, 'understudy').out, false);
});
test('咬痕·被毒舌家重掷：先前掷出的 2 当作没发生，不变身', () => {
  const g = S([['critic', 0], ['bitemark', 3], ['nepobaby', 20]]);
  dice(g, [2, 4]);
  turn(g, 'bitemark', { critic: 'yes' });
  assert(!R(g, 'bitemark').wolf);
  assert.strictEqual(R(g, 'bitemark').pos, 7);
});
test('咬痕·在空指针前面失去技能：掷 2 不变身，主移动还 -1', () => {
  const g = S([['nul', 0], ['bitemark', 3], ['nepobaby', 20]]);
  dice(g, [2]);
  turn(g, 'bitemark');
  assert(!R(g, 'bitemark').wolf);
  assert.strictEqual(R(g, 'bitemark').pos, 4);
});
test('咬痕·已变身的狼人在空指针前面咬不了人；空指针跑到它前面后恢复咬人', () => {
  const g = S([['nul', 0], ['bitemark', 3, { wolf: true }], ['nepobaby', 5], ['understudy', 8]]);
  move(g, 'bitemark', 3, 'power'); // 3→6 超过 5：技能被屏蔽
  assert.strictEqual(R(g, 'nepobaby').out, false);
  move(g, 'nul', 10, 'power'); // 空指针到 10，狼人回到它身后
  move(g, 'bitemark', 3, 'power'); // 6→9 超过 8
  assert.strictEqual(R(g, 'understudy').out, true);
});
test('[口径] 咬痕·狼人一步超过空指针：超过即失效，空指针和更前面被超过的人都不淘汰', () => {
  const g = S([['bitemark', 0, { wolf: true }], ['nul', 2], ['nepobaby', 4], ['understudy', 20]]);
  move(g, 'bitemark', 6, 'power');
  assert.strictEqual(R(g, 'nul').out, false);
  assert.strictEqual(R(g, 'nepobaby').out, false);
});

/* ======================= 糊涂狗 blunderdog ======================= */
test('糊涂狗·独自最后一名：主移动点数 ×3', () => {
  const g = S([['blunderdog', 0], ['nepobaby', 5]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 6);
  assert.match(ev(g, 'calc')[0].text, /2×3（糊涂狗垫底） = 6/);
});
test('糊涂狗·并列最后一名也算：×3', () => {
  const g = S([['blunderdog', 3], ['nepobaby', 3], ['understudy', 10]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 9);
});
test('糊涂狗·不是最后一名：主移动改为后退，后退时不乘 3', () => {
  const g = S([['blunderdog', 8], ['nepobaby', 0]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 6);
  assert.strictEqual(ev(g, 'calc')[0].reverse, true);
});
test('糊涂狗·后退最多退回起点 0', () => {
  const g = S([['blunderdog', 2], ['nepobaby', 0]]);
  dice(g, [5]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 0);
});
test('糊涂狗·已淘汰/已冲线的人不参与「最后一名」比较', () => {
  const g = S([['blunderdog', 3], ['nepobaby', 0, { out: true }], ['understudy', 30, { finished: 1 }], ['soulmate', 10]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 9);
});
test('糊涂狗·×3 只乘点数，其他修正另加（野猪 +2：2×3+2 = 8）', () => {
  const g = S([['blunderdog', 0, { hogs: 1 }], ['nepobaby', 10]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 8);
});
test('糊涂狗·后退时整段主移动反向（野猪 +2 也一起后退）', () => {
  const g = S([['blunderdog', 10, { hogs: 1 }], ['nepobaby', 0]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 6);
});
test('糊涂狗·两次反向抵消：没垫底（后退）+ 掷 3 被捣蛋鬼反向 → 前进 3', () => {
  const g = S([['blunderdog', 9], ['saboteur', 5]]);
  dice(g, [3]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 12);
  assert.strictEqual(ev(g, 'calc')[0].cancel, true);
});
test('糊涂狗·垫底 ×3 又被捣蛋鬼反向：后退且不乘 3', () => {
  const g = S([['blunderdog', 4], ['saboteur', 5]]);
  dice(g, [3]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 1);
});
test('糊涂狗·三次反向（没垫底 + 两名捣蛋鬼）仍是后退', () => {
  const g = S([['blunderdog', 9], ['saboteur', 5], ['nepobaby', 6, { power: 'saboteur' }]]);
  dice(g, [3]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 6);
});
test('糊涂狗·在空指针前面失去技能：不乘 3 也不后退，只 -1', () => {
  const g = S([['nul', 0], ['blunderdog', 5], ['nepobaby', 10]]);
  dice(g, [4]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').pos, 8);
});
test('糊涂狗·垫底 ×3 一步冲过终点', () => {
  const g = S([['blunderdog', 24], ['nepobaby', 26], ['understudy', 27]]);
  dice(g, [2]);
  turn(g, 'blunderdog');
  assert.strictEqual(R(g, 'blunderdog').finished, 1);
});

/* ======================= 老千豹 cheatah ======================= */
test('老千豹·可以不掷骰：主移动方式多出「暗箱操作」；也可以照常掷骰', () => {
  const g = S([['cheatah', 0], ['nepobaby', 20]]);
  dice(g, [4]);
  let modes;
  turn(g, 'cheatah', { mode: (d) => { modes = d.options.map((o) => o.v); return 'roll'; } });
  assert.deepStrictEqual(modes, ['roll', 'cheat']);
  assert.strictEqual(R(g, 'cheatah').pos, 4);
});
test('老千豹·我定数、上家猜；猜错按这个数主移动，全程不掷骰', () => {
  const g = S([['nepobaby', 0], ['cheatah', 0], ['understudy', 20]]);
  noDice(g);
  const seen = [];
  turn(g, 'cheatah', {
    mode: 'cheat',
    cheatahSet: (d) => { seen.push(['set', d.seat]); return '5'; },
    cheatahGuess: (d) => { seen.push(['guess', d.seat]); return '3'; },
  });
  assert.deepStrictEqual(seen, [['set', 1], ['guess', 0]], '席位 1 定数，上家席位 0 来猜');
  assert.strictEqual(R(g, 'cheatah').pos, 5);
  assert.deepStrictEqual(ev(g, 'cheat').map((e) => [e.set, e.guess, e.hit]), [[5, 3, false]]);
});
test('老千豹·上家猜中：原地不动（主移动修正也不加）', () => {
  const g = S([['nepobaby', 0], ['cheatah', 4, { hogs: 1 }]]);
  noDice(g);
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '4', cheatahGuess: '4' });
  assert.strictEqual(R(g, 'cheatah').pos, 4);
  assert.deepStrictEqual(moves(g), []);
  assert.strictEqual(ev(g, 'cheat')[0].hit, true);
});
test('老千豹·我坐第一席：上家是行动顺序里最后一席的玩家', () => {
  const g = S([['cheatah', 0], ['nepobaby', 0], ['understudy', 0]]);
  noDice(g);
  let gs;
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '2', cheatahGuess: (d) => { gs = d.seat; return '1'; } });
  assert.strictEqual(gs, 2);
  assert.strictEqual(R(g, 'cheatah').pos, 2);
});
test('老千豹·猜错时这一步就是主移动：主移动修正照算（野猪 +2）', () => {
  const g = S([['nepobaby', 0], ['cheatah', 0, { hogs: 1 }]]);
  noDice(g);
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '3', cheatahGuess: '1' });
  assert.strictEqual(R(g, 'cheatah').pos, 5);
});
test('老千豹·定数字不算掷骰：定 3 不被捣蛋鬼反向，身边的电鳗不把它变 1，宿敌也不能跟掷', () => {
  const g = S([['nepobaby', 20], ['cheatah', 5], ['saboteur', 0], ['stunner', 6], ['nemesis', 0]]);
  noDice(g);
  const asked = turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '3', cheatahGuess: '1' });
  assert.strictEqual(R(g, 'cheatah').pos, 8);
  assert(!asked.includes('nemesis'));
});
test('老千豹·定 6 不算掷出 6：派对杀手不作废，叠着伊卡洛斯也不淘汰', () => {
  const g = S([['nepobaby', 0], ['cheatah', 0, { stack: ['icarus'] }], ['pooper', 20]]);
  noDice(g);
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '6', cheatahGuess: '1' });
  assert.strictEqual(R(g, 'cheatah').out, false);
  assert.strictEqual(R(g, 'cheatah').pos, 9, '6 + 伊卡洛斯 3');
  assert.strictEqual(R(g, 'pooper').pos, 20);
  assert.strictEqual(ev(g, 'voided').length, 0);
});
test('老千豹·在空指针前面失去技能：没有暗箱操作可选，照常掷骰再 -1', () => {
  const g = S([['nul', 0], ['cheatah', 5], ['nepobaby', 10]]);
  dice(g, [3]);
  const asked = turn(g, 'cheatah');
  assert(!asked.includes('mode') && asked.includes('roll'));
  assert.strictEqual(R(g, 'cheatah').pos, 7);
});
test('[口径] 老千豹·上家的运动员已经冲线，仍由那位玩家来猜', () => {
  const g = S([['nepobaby', 30, { finished: 1 }], ['cheatah', 0], ['understudy', 0]]);
  noDice(g);
  let gs;
  turn(g, 'cheatah', { mode: 'cheat', cheatahSet: '2', cheatahGuess: (d) => { gs = d.seat; return '2'; } });
  assert.strictEqual(gs, 0);
  assert.strictEqual(R(g, 'cheatah').pos, 0);
});

/* ======================= 毒舌家 critic ======================= */
test('毒舌家·前面的人掷完主移动骰，我可以让他重掷，按新点数走', () => {
  const g = S([['critic', 0], ['nepobaby', 5]]);
  dice(g, [6, 2]);
  const asked = turn(g, 'nepobaby', { critic: 'yes' });
  assert.deepStrictEqual(asked.filter((k) => k === 'critic'), ['critic']);
  assert.strictEqual(R(g, 'nepobaby').pos, 7);
  assert.strictEqual(ev(g, 'roll').filter((e) => e.by === 'critic').length, 1);
});
test('毒舌家·也可以不让重掷：原点数照走', () => {
  const g = S([['critic', 0], ['nepobaby', 5]]);
  dice(g, [6]);
  turn(g, 'nepobaby', { critic: 'no' });
  assert.strictEqual(R(g, 'nepobaby').pos, 11);
});
test('毒舌家·只能针对在我前面的人：同格、在我身后的人掷骰都不问', () => {
  for (const p of [5, 2]) {
    const g = S([['critic', 5], ['nepobaby', p]]);
    dice(g, [3]);
    assert(!turn(g, 'nepobaby', { critic: 'yes' }).includes('critic'), `对方在第 ${p} 格`);
    assert.strictEqual(R(g, 'nepobaby').pos, p + 3);
  }
});
test('毒舌家·每回合一次：重掷之后不能再要求第二次', () => {
  const g = S([['critic', 0], ['nepobaby', 5]]);
  dice(g, [6, 5]);
  const asked = turn(g, 'nepobaby', { critic: 'yes' });
  assert.strictEqual(asked.filter((k) => k === 'critic').length, 1);
  assert.strictEqual(R(g, 'nepobaby').pos, 10);
});
test('毒舌家·每个回合各一次：下一个回合可以再差评', () => {
  const g = S([['critic', 0], ['nepobaby', 5]]);
  dice(g, [6, 1, 6, 2]);
  turn(g, 'nepobaby', { critic: 'yes' });
  turn(g, 'nepobaby', { critic: 'yes' });
  assert.strictEqual(R(g, 'nepobaby').pos, 8);
});
test('毒舌家·之前的点数当作没发生：掷 3 被重掷成 4 就不被捣蛋鬼反向；重掷成 3 才反向', () => {
  let g = S([['critic', 0], ['saboteur', 2], ['nepobaby', 10]]);
  dice(g, [3, 4]);
  turn(g, 'nepobaby', { critic: 'yes' });
  assert.strictEqual(R(g, 'nepobaby').pos, 14);
  g = S([['critic', 0], ['saboteur', 2], ['nepobaby', 10]]);
  dice(g, [4, 3]);
  turn(g, 'nepobaby', { critic: 'yes' });
  assert.strictEqual(R(g, 'nepobaby').pos, 7);
});
test('毒舌家·自己掷骰不能给自己差评', () => {
  const g = S([['critic', 0], ['nepobaby', 5]]);
  dice(g, [4]);
  assert(!turn(g, 'critic').includes('critic'));
  assert.strictEqual(R(g, 'critic').pos, 4);
});
test('毒舌家·不掷骰的主移动（鼹鼠打地洞）没有骰子可重掷', () => {
  const g = S([['critic', 0], ['mole', 5], ['nepobaby', 20]]);
  noDice(g);
  const asked = turn(g, 'mole', { mode: 'mole', critic: 'yes' });
  assert(!asked.includes('critic'));
  assert.strictEqual(R(g, 'mole').pos, 11);
});
test('毒舌家·在空指针前面失去技能：不能差评', () => {
  const g = S([['nul', 0], ['critic', 3], ['nepobaby', 6]]);
  dice(g, [6]);
  assert(!turn(g, 'nepobaby', { critic: 'yes' }).includes('critic'));
  assert.strictEqual(R(g, 'nepobaby').pos, 11);
});
test('[口径] 毒舌家·骰子先生一次掷 6 颗，不能被差评重掷', () => {
  const g = S([['critic', 0], ['diceguy', 5], ['nepobaby', 20]]);
  dice(g, [2, 2, 3, 4, 5, 6]);
  assert(!turn(g, 'diceguy', { critic: 'yes' }).includes('critic'));
  assert.strictEqual(R(g, 'diceguy').pos, 7);
});

/* ======================= 大明星 diva ======================= */
test('大明星·回合开始我是最后一名：和领跑者换位置，换完照常主移动', () => {
  const g = S([['diva', 0], ['nepobaby', 10], ['understudy', 4]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'nepobaby').pos, 0);
  assert.strictEqual(R(g, 'diva').pos, 11);
  assert.strictEqual(R(g, 'understudy').pos, 4);
});
test('大明星·我不是最后一名：和最后一名换位置', () => {
  const g = S([['diva', 5], ['nepobaby', 0], ['understudy', 9]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'nepobaby').pos, 5);
  assert.strictEqual(R(g, 'diva').pos, 1);
  assert.deepStrictEqual(ev(g, 'swap').map((e) => [e.a, e.b]), [['diva', 'nepobaby']]);
});
test('大明星·并列最后一名也算最后：和领跑者换', () => {
  const g = S([['diva', 2], ['nepobaby', 2], ['understudy', 9]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'diva').pos, 10);
  assert.strictEqual(R(g, 'understudy').pos, 2);
  assert.strictEqual(R(g, 'nepobaby').pos, 2);
});
test('大明星·有并列领跑者时由我挑', () => {
  const g = S([['diva', 0], ['nepobaby', 9], ['understudy', 9]]);
  dice(g, [1]);
  let opts;
  turn(g, 'diva', { diva: (d) => { opts = d.options.map((o) => o.v); return 'understudy'; } });
  assert.deepStrictEqual(opts.sort(), ['nepobaby', 'understudy']);
  assert.strictEqual(R(g, 'understudy').pos, 0);
  assert.strictEqual(R(g, 'nepobaby').pos, 9);
  assert.strictEqual(R(g, 'diva').pos, 10);
});
test('大明星·有并列最后一名时由我挑', () => {
  const g = S([['diva', 5], ['nepobaby', 1], ['understudy', 1], ['soulmate', 9]]);
  dice(g, [2]);
  turn(g, 'diva', { diva: 'understudy' });
  assert.strictEqual(R(g, 'understudy').pos, 5);
  assert.strictEqual(R(g, 'nepobaby').pos, 1);
  assert.strictEqual(R(g, 'diva').pos, 3);
});
test('大明星·换位是瞬移不算移动：途经的企鹅不算被超过，没有移动事件', () => {
  const g = S([['diva', 0], ['penguin', 5], ['nepobaby', 10]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'diva').pos, 11);
  assert.strictEqual(R(g, 'penguin').tripped, false);
  assert.deepStrictEqual(moves(g), [['diva', 10, 11]], '只有主移动这一次移动');
});
test('大明星·回合开始就换：我摔倒了也照样先换位，再爬起来不主移动', () => {
  const g = S([['diva', 0, { tripped: true }], ['nepobaby', 10]]);
  noDice(g);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'diva').pos, 10);
  assert.strictEqual(R(g, 'nepobaby').pos, 0);
  assert.strictEqual(R(g, 'diva').tripped, false);
  assert.strictEqual(ev(g, 'recover').length, 1);
});
test('大明星·全员同格（我既是最后也是领跑）时没人可换', () => {
  const g = S([['diva', 3], ['nepobaby', 3]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(ev(g, 'swap').length, 0);
  assert.strictEqual(R(g, 'diva').pos, 4);
});
test('大明星·已冲线的不算领跑者', () => {
  const g = S([['diva', 0], ['nepobaby', 30, { finished: 1 }], ['understudy', 8]]);
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'understudy').pos, 0);
  assert.strictEqual(R(g, 'diva').pos, 9);
  assert.strictEqual(R(g, 'nepobaby').pos, 30);
});
test('大明星·漩涡：换到漩涡口照样被传送（落点照常结算）', () => {
  const g = S([['diva', 0], ['nepobaby', 8], ['understudy', 2]], { track: 'whirly' });
  dice(g, [1]);
  turn(g, 'diva');
  assert.strictEqual(R(g, 'nepobaby').pos, 0);
  assert.strictEqual(R(g, 'diva').pos, 13, '换到 8 → 漩涡到 12 → 主移动 1');
});
test('大明星·在空指针前面失去技能：不换位，主移动 -1', () => {
  const g = S([['nul', 0], ['diva', 5], ['nepobaby', 9]]);
  dice(g, [2]);
  turn(g, 'diva');
  assert.strictEqual(ev(g, 'swap').length, 0);
  assert.strictEqual(R(g, 'diva').pos, 6);
});

/* ======================= 冒牌货 doppel ======================= */
test('冒牌货·本场第一个冲到终点的人改为淘汰、拿不到名次分，我获得它的技能；之后冲线的照常拿第 1', () => {
  const g = S([['doppel', 0], ['icarus', 28], ['nepobaby', 29]]);
  move(g, 'icarus', 2);
  assert.strictEqual(R(g, 'icarus').out, true);
  assert.strictEqual(R(g, 'icarus').finished, 0);
  assert.deepStrictEqual(ev(g, 'out').map((e) => [e.rid, e.cause, e.by]), [['icarus', 'doppel', 'doppel']]);
  assert.deepStrictEqual(R(g, 'doppel').stack, ['icarus']);
  assert.strictEqual(g.score(1), 0);
  assert.strictEqual(g.finishCount, 0);
  move(g, 'nepobaby', 1);
  assert.strictEqual(R(g, 'nepobaby').finished, 1);
  assert.strictEqual(g.score(2), 3);
  assert.deepStrictEqual(R(g, 'doppel').stack, ['icarus'], '只对第一个冲线者生效');
});
test('冒牌货·获得的技能立刻可用：顶包伊卡洛斯后主移动 +3', () => {
  const g = S([['doppel', 0], ['icarus', 28], ['nepobaby', 10]]);
  move(g, 'icarus', 2);
  dice(g, [2]);
  turn(g, 'doppel');
  assert.strictEqual(R(g, 'doppel').pos, 5);
});
test('冒牌货·第一个冲到终点的是我自己：我也被淘汰，下一个冲线的拿第 1', () => {
  const g = S([['doppel', 28], ['nepobaby', 29]]);
  move(g, 'doppel', 2);
  assert.strictEqual(R(g, 'doppel').out, true);
  assert.strictEqual(R(g, 'doppel').finished, 0);
  move(g, 'nepobaby', 1);
  assert.strictEqual(R(g, 'nepobaby').finished, 1);
});
test('冒牌货·已被淘汰出本场就不再顶包', () => {
  const g = S([['doppel', 5, { out: true }], ['nepobaby', 28], ['understudy', 0]]);
  move(g, 'nepobaby', 2);
  assert.strictEqual(R(g, 'nepobaby').finished, 1);
  assert.strictEqual(R(g, 'nepobaby').out, false);
});
test('冒牌货·在空指针前面失去技能：冲线者照常拿第 1', () => {
  const g = S([['nul', 0], ['doppel', 5], ['nepobaby', 28]]);
  move(g, 'nepobaby', 2);
  assert.strictEqual(R(g, 'nepobaby').finished, 1);
  assert(!R(g, 'doppel').stack);
});
test('冒牌货·被顶包的狼人冲线那一步超过的人照样被咬', () => {
  const g = S([['doppel', 0], ['bitemark', 26, { wolf: true }], ['nepobaby', 28]]);
  move(g, 'bitemark', 5);
  assert.strictEqual(R(g, 'bitemark').out, true);
  assert.strictEqual(R(g, 'nepobaby').out, true);
  assert.deepStrictEqual(ev(g, 'out').map((e) => [e.rid, e.cause]), [['bitemark', 'doppel'], ['nepobaby', 'bitemark']]);
});
test('[口径] 冒牌货·冲线者在空指针前面（技能被屏蔽）时，顶包成功但得不到技能', () => {
  const g = S([['doppel', 0], ['nul', 3], ['icarus', 28]]);
  move(g, 'icarus', 2);
  assert.strictEqual(R(g, 'icarus').out, true);
  assert.deepStrictEqual(R(g, 'doppel').stack, []);
});

/* ======================= 树懒 gloth ======================= */
test('树懒·主移动 -1', () => {
  const g = S([['gloth', 0], ['nepobaby', 20]]);
  dice(g, [4]);
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 3);
});
test('树懒·掷 1 减到 0 就原地不动', () => {
  const g = S([['gloth', 5], ['nepobaby', 20]]);
  dice(g, [1]);
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 5);
  assert.deepStrictEqual(moves(g), []);
});
test('树懒·-1 只减主移动，技能移动不减', () => {
  const g = S([['gloth', 0], ['nepobaby', 20]]);
  move(g, 'gloth', 3, 'power');
  assert.strictEqual(R(g, 'gloth').pos, 3);
});
test('树懒·本场结束时没过第二个弯道（≤15，停在弯道 15 上也算）拿 3 分；过了不拿', () => {
  for (const [p, pts] of [[0, 3], [14, 3], [15, 3], [16, 0], [29, 0]]) {
    const g = S([['gloth', p], ['nepobaby', 20]]);
    g.afterRace(0);
    assert.strictEqual(g.score(0), pts, `第 ${p} 格`);
  }
});
test('树懒·已冲线的不拿 3 分', () => {
  const g = S([['gloth', 30, { finished: 2 }], ['nepobaby', 30, { finished: 1 }]]);
  g.afterRace(0);
  assert.strictEqual(g.score(0), 0);
});
test('[口径] 树懒·被淘汰出本场的不拿 3 分（淘汰时没过第二弯道也不拿）', () => {
  const g = S([['gloth', 5, { out: true }], ['nepobaby', 20]]);
  g.afterRace(0);
  assert.strictEqual(g.score(0), 0);
});
test('树懒·本场结束时在空指针前面（失去技能）不拿 3 分', () => {
  const g = S([['nul', 0], ['gloth', 10], ['nepobaby', 20]]);
  g.afterRace(0);
  assert.strictEqual(g.score(1), 0);
});
test('树懒·漩涡：踩 11 号漩涡被传到 15（第二弯道上），本场结束仍拿 3 分', () => {
  const g = S([['gloth', 9], ['nepobaby', 20]], { track: 'whirly' });
  dice(g, [3]);
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 15);
  g.afterRace(0);
  assert.strictEqual(g.score(0), 3);
});

/* ======================= 野猪骑士 hogknight ======================= */
test('野猪骑士·赛前骑上一头野猪', () => {
  const g = S([['hogknight', 0], ['nepobaby', 0]]);
  run(g, g.applyBeforeRace(R(g, 'hogknight'), 'hogknight', 0));
  assert.strictEqual(R(g, 'hogknight').hogs, 1);
  assert.deepStrictEqual(ev(g, 'hog').map((e) => [e.to, e.n]), [['hogknight', 1]]);
});
test('野猪骑士·骑猪的运动员主移动 +2；技能移动不加', () => {
  const g = S([['hogknight', 0, { hogs: 1 }], ['nepobaby', 20]]);
  dice(g, [3]);
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 5);
  move(g, 'hogknight', 2, 'power');
  assert.strictEqual(R(g, 'hogknight').pos, 7);
});
test('野猪骑士·一人可以骑好几头：两头野猪主移动 +4', () => {
  const g = S([['hogknight', 0, { hogs: 2 }], ['nepobaby', 20]]);
  dice(g, [1]);
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 5);
});
test('野猪骑士·有人停到骑猪者的格子就把野猪全抢走，加成跟着野猪走', () => {
  const g = S([['hogknight', 5, { hogs: 2 }], ['nepobaby', 2]]);
  dice(g, [3, 1, 1]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').hogs, 2);
  assert.strictEqual(R(g, 'hogknight').hogs, 0);
  assert.deepStrictEqual(ev(g, 'hog').map((e) => [e.from, e.to, e.n]), [['hogknight', 'nepobaby', 2]]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 10, '1 + 4');
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 6, '没猪了只走 1');
});
test('野猪骑士·只经过骑猪者不抢', () => {
  const g = S([['hogknight', 5, { hogs: 1 }], ['nepobaby', 2]]);
  dice(g, [4]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 6);
  assert.strictEqual(R(g, 'hogknight').hogs, 1);
});
test('野猪骑士·骑猪者自己停到别人的格子不会丢猪', () => {
  const g = S([['hogknight', 0, { hogs: 1 }], ['nepobaby', 5]]);
  dice(g, [3]);
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 5);
  assert.strictEqual(R(g, 'hogknight').hogs, 1);
  assert(!R(g, 'nepobaby').hogs);
});
test('野猪骑士·同格多名骑猪者的野猪一起抢走', () => {
  const g = S([['hogknight', 5, { hogs: 1 }], ['nepobaby', 5, { hogs: 1 }], ['understudy', 2]]);
  dice(g, [3]);
  turn(g, 'understudy');
  assert.strictEqual(R(g, 'understudy').hogs, 2);
  assert.strictEqual(R(g, 'hogknight').hogs, 0);
  assert.strictEqual(R(g, 'nepobaby').hogs, 0);
});
test('[口径] 野猪骑士·骑猪者在空指针前面（技能被屏蔽）仍有野猪 +2', () => {
  const g = S([['nul', 0], ['hogknight', 5, { hogs: 1 }], ['nepobaby', 20]]);
  dice(g, [3]);
  turn(g, 'hogknight');
  assert.strictEqual(R(g, 'hogknight').pos, 9, '3 + 2 - 1');
});
test('[口径] 野猪骑士·漩涡传送落到骑猪者的格子也算停到，抢走野猪', () => {
  const g = S([['hogknight', 6, { hogs: 1 }], ['nepobaby', 2]], { track: 'whirly' });
  dice(g, [2]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 6);
  assert.strictEqual(R(g, 'nepobaby').hogs, 1);
  assert.strictEqual(R(g, 'hogknight').hogs, 0);
});

/* ======================= 蹦蹦蛙 hopfrog ======================= */
test('蹦蹦蛙·回合结束时正好有人在我前面 1 格：再来一回合', () => {
  const g = S([['hopfrog', 0], ['nepobaby', 3]]);
  dice(g, [2]);
  turn(g, 'hopfrog');
  assert.strictEqual(g.extraTurn, true);
});
test('蹦蹦蛙·前面 2 格、同格、身后 1 格都不算', () => {
  for (const p of [4, 2, 1]) {
    const g = S([['hopfrog', 0], ['nepobaby', p]]);
    dice(g, [2]);
    turn(g, 'hopfrog');
    assert.strictEqual(g.extraTurn, false, `对方在第 ${p} 格`);
  }
});
test('蹦蹦蛙·看回合结束时的位置：回合开始时前 1 格有人、走完不再是就不算', () => {
  const g = S([['hopfrog', 2], ['nepobaby', 3]]);
  dice(g, [2]);
  turn(g, 'hopfrog');
  assert.strictEqual(g.extraTurn, false);
});
test('蹦蹦蛙·已冲线的人不算「在我前面」', () => {
  const g = S([['hopfrog', 27], ['nepobaby', 30, { finished: 1 }], ['understudy', 0]]);
  dice(g, [2]);
  turn(g, 'hopfrog');
  assert.strictEqual(R(g, 'hopfrog').pos, 29);
  assert.strictEqual(g.extraTurn, false);
});
test('蹦蹦蛙·摔倒爬起来没有主移动，回合结束照样检查', () => {
  const g = S([['hopfrog', 5, { tripped: true }], ['nepobaby', 6]]);
  noDice(g);
  turn(g, 'hopfrog');
  assert.strictEqual(g.extraTurn, true);
});
test('蹦蹦蛙·额外回合在比赛循环里真的会进行：连走两回合后才轮到下家', () => {
  const g = S([['hopfrog', 26], ['nepobaby', 28]]);
  dice(g, [1, 4, 2]);
  run(g, g.raceLoop(0));
  assert(g.ended);
  assert.deepStrictEqual(ev(g, 'turn').map((e) => e.rid), ['hopfrog', 'hopfrog', 'nepobaby']);
  assert.strictEqual(ev(g, 'extraTurn').length, 1);
  assert.strictEqual(R(g, 'hopfrog').finished, 1);
  assert.strictEqual(R(g, 'nepobaby').finished, 2);
});
test('蹦蹦蛙·漩涡：按传送后的落点判断', () => {
  const g = S([['hopfrog', 2], ['nepobaby', 7]], { track: 'whirly' });
  dice(g, [2]);
  turn(g, 'hopfrog');
  assert.strictEqual(R(g, 'hopfrog').pos, 6);
  assert.strictEqual(g.extraTurn, true);
});
test('蹦蹦蛙·在空指针前面失去技能；本回合超过空指针也立刻失效', () => {
  let g = S([['nul', 0], ['hopfrog', 3], ['nepobaby', 6]]);
  dice(g, [3]);
  turn(g, 'hopfrog');
  assert.strictEqual(R(g, 'hopfrog').pos, 5);
  assert.strictEqual(g.extraTurn, false);
  g = S([['hopfrog', 2], ['nul', 3], ['nepobaby', 6]]);
  dice(g, [3]);
  turn(g, 'hopfrog');
  assert.strictEqual(R(g, 'hopfrog').pos, 5);
  assert.strictEqual(g.extraTurn, false);
});

/* ======================= 小旅馆 hotel ======================= */
test('小旅馆·停到我格子上的运动员付给我 1 分', () => {
  const g = S([['nepobaby', 0], ['hotel', 5]]);
  g.giveChip(0, 'bronze', 1); g.giveChip(0, 'bronze', 1);
  move(g, 'nepobaby', 5);
  assert.strictEqual(g.score(0), 1);
  assert.strictEqual(g.score(1), 1);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('小旅馆·付不出（0 分）就被绊倒，下回合跳过主移动', () => {
  const g = S([['nepobaby', 0], ['hotel', 5]]);
  move(g, 'nepobaby', 5);
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(g.score(1), 0);
  noDice(g);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 5);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('小旅馆·只经过不付', () => {
  const g = S([['nepobaby', 0], ['hotel', 5]]);
  g.giveChip(0, 'bronze', 1);
  move(g, 'nepobaby', 7);
  assert.strictEqual(g.score(0), 1);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('小旅馆·旅馆自己停到别人的格子不收费', () => {
  const g = S([['hotel', 0], ['nepobaby', 5]]);
  g.giveChip(1, 'bronze', 1);
  move(g, 'hotel', 5);
  assert.strictEqual(g.score(1), 1);
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('小旅馆·每停一次付一次（离开再退回来又付）', () => {
  const g = S([['nepobaby', 0], ['hotel', 5]]);
  g.giveChip(0, 'bronze', 1); g.giveChip(0, 'bronze', 1);
  move(g, 'nepobaby', 5);
  move(g, 'nepobaby', 1);
  move(g, 'nepobaby', -1, 'power');
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(g.score(1), 2);
});
test('小旅馆·付房费只扣 1 分：手上只有 3 分金杯时变成 2 分', () => {
  const g = S([['nepobaby', 0], ['hotel', 5]]);
  g.giveChip(0, 'gold', 3);
  move(g, 'nepobaby', 5);
  assert.strictEqual(g.score(0), 2);
  assert.strictEqual(g.score(1), 1);
});
test('小旅馆·在空指针前面失去技能：停过来不付也不绊倒', () => {
  const g = S([['nul', 0], ['hotel', 5], ['nepobaby', 2]]);
  move(g, 'nepobaby', 3);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('[口径] 小旅馆·同一玩家的另一名运动员停过来不付也不绊倒', () => {
  const g = S([['hotel', 5], ['nepobaby', 0, { seat: 0, extra: true }], ['understudy', 0, { seat: 1 }]], { players: 2 });
  move(g, 'nepobaby', 5);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});

test('[口径] 小旅馆·瞬移落到旅馆格算不算「停到」：魔法健将掷 3 瞬移过来要付；被大海怪卷过来不付', () => {
  let g = S([['magicalathlete', 0], ['hotel', 9], ['nepobaby', 20]]);
  g.giveChip(0, 'bronze', 1);
  dice(g, [3]);
  turn(g, 'magicalathlete', { athleteWarp: 'hotel' });
  assert.strictEqual(R(g, 'magicalathlete').pos, 9);
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(g.score(1), 1);
  g = S([['kraken', 5], ['hotel', 5], ['nepobaby', 0]]);
  g.giveChip(2, 'bronze', 1);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.strictEqual(R(g, 'nepobaby').pos, 5);
  assert.strictEqual(g.score(2), 1);
  assert.strictEqual(g.score(1), 0);
});

/* ======================= 伊卡洛斯 icarus ======================= */
test('伊卡洛斯·主移动 +3', () => {
  const g = S([['icarus', 0], ['nepobaby', 20]]);
  dice(g, [2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').pos, 5);
});
test('伊卡洛斯·主移动掷出 6：被淘汰，不移动', () => {
  const g = S([['icarus', 3], ['nepobaby', 20]]);
  dice(g, [6]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, true);
  assert.strictEqual(R(g, 'icarus').pos, 3);
  assert.deepStrictEqual(ev(g, 'out').map((e) => e.cause), ['icarus']);
  assert.deepStrictEqual(moves(g), []);
});
test('伊卡洛斯·+3 只加主移动，技能移动不加', () => {
  const g = S([['icarus', 0], ['nepobaby', 20]]);
  move(g, 'icarus', 2, 'power');
  assert.strictEqual(R(g, 'icarus').pos, 2);
});
test('伊卡洛斯·所有重掷结束后才判定：派对杀手作废掉的 6 不算', () => {
  const g = S([['icarus', 0], ['pooper', 20]]);
  dice(g, [6, 2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, false);
  assert.strictEqual(R(g, 'icarus').pos, 5);
});
test('伊卡洛斯·毒舌家把 2 重掷成 6：最终是 6，淘汰；把 6 重掷成 1：不淘汰', () => {
  let g = S([['critic', 0], ['icarus', 3], ['nepobaby', 20]]);
  dice(g, [2, 6]);
  turn(g, 'icarus', { critic: 'yes' });
  assert.strictEqual(R(g, 'icarus').out, true);
  g = S([['critic', 0], ['icarus', 3], ['nepobaby', 20]]);
  dice(g, [6, 1]);
  turn(g, 'icarus', { critic: 'yes' });
  assert.strictEqual(R(g, 'icarus').out, false);
  assert.strictEqual(R(g, 'icarus').pos, 7);
});
test('伊卡洛斯·身边有电鳗：掷出的 6 算 1，不淘汰', () => {
  const g = S([['icarus', 5], ['stunner', 6], ['nepobaby', 20]]);
  dice(g, [6]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, false);
  assert.strictEqual(R(g, 'icarus').pos, 9);
});
test('伊卡洛斯·在空指针前面失去技能：没有 +3，掷 6 也不淘汰', () => {
  const g = S([['nul', 0], ['icarus', 5], ['nepobaby', 20]]);
  dice(g, [6]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, false);
  assert.strictEqual(R(g, 'icarus').pos, 10);
});
test('伊卡洛斯·+3 帮它冲线', () => {
  const g = S([['icarus', 25], ['nepobaby', 20]]);
  dice(g, [2]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').finished, 1);
});
test('伊卡洛斯·淘汰后本回合后续技能都不再结算（叠着蹦蹦蛙也不会再来一回合）', () => {
  const g = S([['icarus', 0, { stack: ['hopfrog'] }], ['nepobaby', 10]]);
  dice(g, [6]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').out, true);
  assert.strictEqual(g.extraTurn, false);
});

/* ======================= 绊脚王 kingtripper ======================= */
test('绊脚王·回合开始可以绊倒一名领跑者（主移动之前），被绊者下回合跳过主移动', () => {
  const g = S([['kingtripper', 0], ['nepobaby', 9], ['understudy', 4]]);
  dice(g, [1]);
  let opts;
  turn(g, 'kingtripper', { kingtripper: (d) => { opts = d.options.map((o) => o.v); return 'nepobaby'; } });
  assert.deepStrictEqual(opts, ['nepobaby', '_no'], '只能选领跑者');
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'understudy').tripped, false);
  const it = g.events.findIndex((e) => e.t === 'trip'), ir = g.events.findIndex((e) => e.t === 'roll');
  assert(it >= 0 && it < ir, '绊人在掷骰之前');
  turn(g, 'nepobaby'); // 不给骰点：掷骰就会报错
  assert.strictEqual(R(g, 'nepobaby').pos, 9);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('绊脚王·可以选择不绊', () => {
  const g = S([['kingtripper', 0], ['nepobaby', 9]]);
  dice(g, [1]);
  turn(g, 'kingtripper', { kingtripper: '_no' });
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
  assert.strictEqual(ev(g, 'trip').length, 0);
});
test('绊脚王·并列领跑时任选一名，只绊一名', () => {
  const g = S([['kingtripper', 0], ['nepobaby', 9], ['understudy', 9]]);
  dice(g, [1]);
  let opts;
  turn(g, 'kingtripper', { kingtripper: (d) => { opts = d.options.map((o) => o.v); return 'understudy'; } });
  assert.deepStrictEqual(opts, ['nepobaby', 'understudy', '_no']);
  assert.strictEqual(R(g, 'understudy').tripped, true);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('绊脚王·我自己独自领跑时没人可绊，不询问', () => {
  const g = S([['kingtripper', 9], ['nepobaby', 4]]);
  dice(g, [1]);
  assert(!turn(g, 'kingtripper').includes('kingtripper'));
});
test('绊脚王·我和别人并列领跑：可以绊那个人（不会绊自己）', () => {
  const g = S([['kingtripper', 9], ['nepobaby', 9]]);
  dice(g, [1]);
  let opts;
  turn(g, 'kingtripper', { kingtripper: (d) => { opts = d.options.map((o) => o.v); return 'nepobaby'; } });
  assert.deepStrictEqual(opts, ['nepobaby', '_no']);
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'kingtripper').tripped, false);
});
test('绊脚王·已经摔倒的领跑者不再列入；已冲线的不算领跑者', () => {
  const g = S([['kingtripper', 0], ['nepobaby', 9, { tripped: true }], ['understudy', 9], ['soulmate', 30, { finished: 1 }]]);
  dice(g, [1]);
  let opts;
  turn(g, 'kingtripper', { kingtripper: (d) => { opts = d.options.map((o) => o.v); return '_no'; } });
  assert.deepStrictEqual(opts, ['understudy', '_no']);
});
test('绊脚王·我摔倒了，回合开始照样能绊人，然后爬起来不主移动', () => {
  const g = S([['kingtripper', 0, { tripped: true }], ['nepobaby', 9]]);
  noDice(g);
  turn(g, 'kingtripper', { kingtripper: 'nepobaby' });
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'kingtripper').tripped, false);
  assert.strictEqual(R(g, 'kingtripper').pos, 0);
});
test('绊脚王·在空指针前面失去技能：不询问', () => {
  const g = S([['nul', 0], ['kingtripper', 3], ['nepobaby', 9]]);
  dice(g, [2]);
  assert(!turn(g, 'kingtripper').includes('kingtripper'));
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});

/* ======================= 大海怪 kraken ======================= */
test('大海怪·回合开始把其他所有人瞬移到我的格子并全部绊倒（原本就在我格子的也绊），我照常主移动', () => {
  const g = S([['kraken', 3], ['nepobaby', 9], ['understudy', 0], ['soulmate', 3]]);
  dice(g, [2]);
  turn(g, 'kraken', { kraken: 'yes' });
  for (const id of ['nepobaby', 'understudy', 'soulmate']) {
    assert.strictEqual(R(g, id).pos, 3, id);
    assert.strictEqual(R(g, id).tripped, true, id);
  }
  assert.strictEqual(R(g, 'kraken').pos, 5);
  assert.strictEqual(R(g, 'kraken').tripped, false);
  const iw = g.events.findIndex((e) => e.t === 'warp'), ir = g.events.findIndex((e) => e.t === 'roll');
  assert(iw >= 0 && iw < ir, '在主移动之前');
});
test('大海怪·被卷过来绊倒的人下回合跳过主移动', () => {
  const g = S([['kraken', 3], ['nepobaby', 9]]);
  dice(g, [2]);
  turn(g, 'kraken', { kraken: 'yes' });
  turn(g, 'nepobaby'); // 不给骰点
  assert.strictEqual(R(g, 'nepobaby').pos, 3);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
});
test('大海怪·可以选择先不用；不用不算用掉，下回合还能用', () => {
  const g = S([['kraken', 3], ['nepobaby', 9]]);
  dice(g, [1, 1]);
  turn(g, 'kraken', { kraken: 'no' });
  assert.strictEqual(R(g, 'nepobaby').pos, 9);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
  assert(turn(g, 'kraken', { kraken: 'yes' }).includes('kraken'));
  assert.strictEqual(R(g, 'nepobaby').pos, 4);
});
test('大海怪·每场限一次：用过之后不再询问', () => {
  const g = S([['kraken', 3], ['nepobaby', 9]]);
  dice(g, [1, 1]);
  turn(g, 'kraken', { kraken: 'yes' });
  R(g, 'nepobaby').pos = 20;
  assert(!turn(g, 'kraken', { kraken: 'yes' }).includes('kraken'));
  assert.strictEqual(R(g, 'nepobaby').pos, 20);
});
test('大海怪·瞬移不算移动：被卷过来的裸奔侠途经别人也不得分', () => {
  const g = S([['kraken', 10], ['streaker', 0], ['nepobaby', 5]]);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.strictEqual(R(g, 'streaker').pos, 10);
  assert.strictEqual(g.score(1), 0);
  assert.deepStrictEqual(moves(g), [['kraken', 10, 11]]);
});
test('大海怪·在起点也能用：所有人被卷回起点', () => {
  const g = S([['kraken', 0], ['nepobaby', 9], ['understudy', 5]]);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.deepStrictEqual(pos(g), { kraken: 1, nepobaby: 0, understudy: 0 });
});
test('大海怪·已冲线的人不会被卷回来', () => {
  const g = S([['kraken', 3], ['nepobaby', 30, { finished: 1 }], ['understudy', 9]]);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.strictEqual(R(g, 'nepobaby').pos, 30);
  assert.strictEqual(R(g, 'nepobaby').tripped, false);
  assert.strictEqual(R(g, 'understudy').pos, 3);
});
test('大海怪·在空指针前面失去技能：不询问', () => {
  const g = S([['nul', 0], ['kraken', 5], ['nepobaby', 9]]);
  dice(g, [2]);
  assert(!turn(g, 'kraken', { kraken: 'yes' }).includes('kraken'));
});
test('大海怪·其他人都已在我格子时也可以发动：全部绊倒', () => {
  const g = S([['kraken', 0], ['nepobaby', 0], ['understudy', 0]]);
  dice(g, [1]);
  const asked = turn(g, 'kraken', { kraken: 'yes' });
  assert(asked.includes('kraken'), '应询问是否发动');
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'understudy').tripped, true);
});
test('[口径] 大海怪·被卷到我格子不结算停格：我骑着野猪也不会被抢走', () => {
  const g = S([['kraken', 5, { hogs: 1 }], ['nepobaby', 0]]);
  dice(g, [1]);
  turn(g, 'kraken', { kraken: 'yes' });
  assert.strictEqual(R(g, 'kraken').hogs, 1);
  assert(!R(g, 'nepobaby').hogs);
  assert.strictEqual(R(g, 'kraken').pos, 8, '5 + 1 + 野猪 2');
});

/* ======================= 捣蛋鬼 saboteur ======================= */
test('捣蛋鬼·别人主移动掷出 3：这次主移动改为后退', () => {
  const g = S([['saboteur', 0], ['nepobaby', 10]]);
  dice(g, [3]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 7);
  assert.strictEqual(ev(g, 'calc')[0].reverse, true);
});
test('捣蛋鬼·我自己掷出 3 不反向', () => {
  const g = S([['saboteur', 10], ['nepobaby', 0]]);
  dice(g, [3]);
  turn(g, 'saboteur');
  assert.strictEqual(R(g, 'saboteur').pos, 13);
});
test('捣蛋鬼·掷出其他点数不反向', () => {
  for (const v of [1, 2, 4, 5, 6]) {
    const g = S([['saboteur', 0], ['nepobaby', 10]]);
    dice(g, [v]);
    turn(g, 'nepobaby');
    assert.strictEqual(R(g, 'nepobaby').pos, 10 + v, `掷 ${v}`);
  }
});
test('捣蛋鬼·整段主移动改为后退：修正值一起反向（伊卡洛斯 3+3 退 6、树懒 3-1 退 2）', () => {
  let g = S([['saboteur', 0], ['icarus', 10]]);
  dice(g, [3]);
  turn(g, 'icarus');
  assert.strictEqual(R(g, 'icarus').pos, 4);
  g = S([['saboteur', 0], ['gloth', 10]]);
  dice(g, [3]);
  turn(g, 'gloth');
  assert.strictEqual(R(g, 'gloth').pos, 8);
});
test('捣蛋鬼·后退最多退到起点 0', () => {
  const g = S([['saboteur', 0], ['nepobaby', 2]]);
  dice(g, [3]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 0);
});
test('捣蛋鬼·两名捣蛋鬼：两次反向互相抵消', () => {
  const g = S([['saboteur', 0], ['nepobaby', 0, { power: 'saboteur' }], ['understudy', 10]]);
  dice(g, [3]);
  turn(g, 'understudy');
  assert.strictEqual(R(g, 'understudy').pos, 13);
  assert.strictEqual(ev(g, 'calc')[0].cancel, true);
});
test('捣蛋鬼·后退途经的人不算被超过（狼人不咬、企鹅不摔）', () => {
  const g = S([['saboteur', 0], ['bitemark', 10, { wolf: true }], ['penguin', 8]]);
  dice(g, [3]);
  turn(g, 'bitemark');
  assert.strictEqual(R(g, 'bitemark').pos, 7);
  assert.strictEqual(R(g, 'penguin').out, false);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('捣蛋鬼·漩涡：后退停到漩涡口照样传送', () => {
  const g = S([['saboteur', 0], ['nepobaby', 9]], { track: 'whirly' });
  dice(g, [3]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 4, '9 退 3 到 6 号漩涡口，传到 4');
});
test('捣蛋鬼·在空指针前面失去技能：不反向', () => {
  const g = S([['nul', 0], ['saboteur', 5], ['nepobaby', 8]]);
  dice(g, [3]);
  turn(g, 'nepobaby');
  assert.strictEqual(R(g, 'nepobaby').pos, 10, '3 - 1 = 2，向前');
});

/* ======================= 魔法健将 magicalathlete ======================= */
test('魔法健将·掷 1：前进 7', () => {
  const g = S([['magicalathlete', 0], ['nepobaby', 20]]);
  dice(g, [1]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 7);
});
test('魔法健将·掷 2：把最后一名（含并列）都传送到我的格子，本回合不再主移动', () => {
  const g = S([['magicalathlete', 8], ['nepobaby', 2], ['understudy', 2], ['soulmate', 20]]);
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.deepStrictEqual(pos(g), { magicalathlete: 8, nepobaby: 8, understudy: 8, soulmate: 20 });
  assert.deepStrictEqual(moves(g), []);
});
test('魔法健将·掷 2：我自己就是最后一名时没人可传，也不主移动', () => {
  const g = S([['magicalathlete', 0], ['nepobaby', 5]]);
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.deepStrictEqual(pos(g), { magicalathlete: 0, nepobaby: 5 });
});
test('魔法健将·掷 2：传送不算移动，途经的企鹅不摔', () => {
  const g = S([['magicalathlete', 8], ['nepobaby', 0], ['penguin', 4]]);
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'nepobaby').pos, 8);
  assert.strictEqual(R(g, 'penguin').tripped, false);
});
test('魔法健将·掷 3：瞬移到任一运动员的格子并绊倒那格所有人，本回合不再主移动', () => {
  const g = S([['magicalathlete', 0], ['nepobaby', 9], ['understudy', 9], ['soulmate', 4]]);
  dice(g, [3]);
  let opts;
  turn(g, 'magicalathlete', { athleteWarp: (d) => { opts = d.options.map((o) => o.v); return 'nepobaby'; } });
  assert.deepStrictEqual(opts.sort(), ['nepobaby', 'soulmate', 'understudy']);
  assert.strictEqual(R(g, 'magicalathlete').pos, 9);
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'understudy').tripped, true);
  assert.strictEqual(R(g, 'soulmate').tripped, false);
  assert.strictEqual(R(g, 'magicalathlete').tripped, false);
  assert.deepStrictEqual(moves(g), []);
});
test('魔法健将·掷 3：也可以瞬移到身后的人那里', () => {
  const g = S([['magicalathlete', 10], ['nepobaby', 2], ['understudy', 20]]);
  dice(g, [3]);
  turn(g, 'magicalathlete', { athleteWarp: 'nepobaby' });
  assert.strictEqual(R(g, 'magicalathlete').pos, 2);
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
});
test('魔法健将·掷 4：前进 4 并再来一回合', () => {
  const g = S([['magicalathlete', 0], ['nepobaby', 20]]);
  dice(g, [4]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 4);
  assert.strictEqual(g.extraTurn, true);
});
test('魔法健将·掷 5：领跑者（含并列）都后退 5，最多退到起点；我本回合不再主移动', () => {
  let g = S([['magicalathlete', 0], ['nepobaby', 12], ['understudy', 12], ['soulmate', 3]]);
  dice(g, [5]);
  turn(g, 'magicalathlete');
  assert.deepStrictEqual(pos(g), { magicalathlete: 0, nepobaby: 7, understudy: 7, soulmate: 3 });
  g = S([['magicalathlete', 0], ['nepobaby', 3], ['understudy', 1]]);
  dice(g, [5]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'nepobaby').pos, 0);
});
test('[口径] 魔法健将·掷 5：我自己也是（并列）领跑者时只有别人后退，我不退', () => {
  const g = S([['magicalathlete', 12], ['nepobaby', 12], ['understudy', 3]]);
  dice(g, [5]);
  turn(g, 'magicalathlete');
  assert.deepStrictEqual(pos(g), { magicalathlete: 12, nepobaby: 7, understudy: 3 });
});
test('魔法健将·掷 6：前进 6 并绊倒被我超过的人（落点同格的不绊）', () => {
  const g = S([['magicalathlete', 0], ['nepobaby', 3], ['understudy', 6]]);
  dice(g, [6]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 6);
  assert.strictEqual(R(g, 'nepobaby').tripped, true);
  assert.strictEqual(R(g, 'understudy').tripped, false);
});
test('魔法健将·掷 2/3/5 不主移动：主移动修正（野猪 +2）也不生效', () => {
  const g = S([['magicalathlete', 5, { hogs: 1 }], ['nepobaby', 12], ['understudy', 0]]);
  dice(g, [5]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 5);
  assert.strictEqual(R(g, 'nepobaby').pos, 7);
});
test('魔法健将·在空指针前面失去技能：掷 2 就是普通主移动 2-1', () => {
  const g = S([['nul', 0], ['magicalathlete', 5], ['nepobaby', 20]]);
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'magicalathlete').pos, 6);
  assert.strictEqual(R(g, 'nul').pos, 0);
});
test('[口径] 魔法健将·掷 2 被传过来的人不算「停到」我的格子：我骑的野猪不会被抢', () => {
  const g = S([['magicalathlete', 8, { hogs: 1 }], ['nepobaby', 2], ['understudy', 20]]);
  dice(g, [2]);
  turn(g, 'magicalathlete');
  assert.strictEqual(R(g, 'nepobaby').pos, 8);
  assert.strictEqual(R(g, 'magicalathlete').hogs, 1);
});

/* ======================= 鼹鼠 mole ======================= */
test('鼹鼠·身边 1 格内没有其他运动员：可以不掷骰直接主移动 6 格（隔 2 格就行）', () => {
  const g = S([['mole', 0], ['nepobaby', 2]]);
  noDice(g);
  let modes;
  turn(g, 'mole', { mode: (d) => { modes = d.options.map((o) => o.v); return 'mole'; } });
  assert.deepStrictEqual(modes, ['roll', 'mole']);
  assert.strictEqual(R(g, 'mole').pos, 6);
});
test('鼹鼠·身边 1 格内有人（前 1 格、后 1 格、同格）：不能打地洞', () => {
  for (const p of [6, 4, 5]) {
    const g = S([['mole', 5], ['nepobaby', p]]);
    dice(g, [1]);
    const asked = turn(g, 'mole');
    assert(!asked.includes('mode') && asked.includes('roll'), `对方在第 ${p} 格`);
    assert.strictEqual(R(g, 'mole').pos, 6);
  }
});
test('鼹鼠·也可以照常掷骰', () => {
  const g = S([['mole', 0], ['nepobaby', 10]]);
  dice(g, [3]);
  turn(g, 'mole', { mode: 'roll' });
  assert.strictEqual(R(g, 'mole').pos, 3);
});
test('鼹鼠·打地洞也是主移动：主移动修正照算（野猪 +2 → 8）', () => {
  const g = S([['mole', 0, { hogs: 1 }], ['nepobaby', 20]]);
  noDice(g);
  turn(g, 'mole', { mode: 'mole' });
  assert.strictEqual(R(g, 'mole').pos, 8);
});
test('鼹鼠·不掷骰：直接走 6 不会被派对杀手当成掷出 6', () => {
  const g = S([['mole', 0], ['pooper', 20]]);
  noDice(g);
  turn(g, 'mole', { mode: 'mole' });
  assert.strictEqual(R(g, 'mole').pos, 6);
  assert.strictEqual(R(g, 'pooper').pos, 20);
});
test('鼹鼠·已淘汰的人不算身边有人；打地洞冲线', () => {
  const g = S([['mole', 26], ['nepobaby', 27, { out: true }], ['understudy', 0]]);
  noDice(g);
  turn(g, 'mole', { mode: 'mole' });
  assert.strictEqual(R(g, 'mole').finished, 1);
});
test('鼹鼠·漩涡：打地洞落到漩涡口照样传送', () => {
  const g = S([['mole', 2], ['nepobaby', 20]], { track: 'whirly' });
  noDice(g);
  turn(g, 'mole', { mode: 'mole' });
  assert.strictEqual(R(g, 'mole').pos, 12);
});
test('鼹鼠·在空指针前面失去技能：没有打地洞选项', () => {
  const g = S([['nul', 0], ['mole', 5], ['nepobaby', 20]]);
  dice(g, [2]);
  const asked = turn(g, 'mole');
  assert(!asked.includes('mode'));
  assert.strictEqual(R(g, 'mole').pos, 6);
});
test('[口径] 鼹鼠·起点也算格子：大家都在起点 0 时身边有人，不能打地洞', () => {
  const g = S([['mole', 0], ['nepobaby', 0]]);
  dice(g, [2]);
  assert(!turn(g, 'mole').includes('mode'));
});

/* ======================= 骰子先生 diceguy ======================= */
test('骰子先生·一次掷 6 颗：只有一种点数重复时直接走它', () => {
  const g = S([['diceguy', 0], ['nepobaby', 20]]);
  dice(g, [1, 4, 4, 2, 5, 6]);
  const asked = turn(g, 'diceguy');
  assert(!asked.includes('diceguy'));
  assert.deepStrictEqual(ev(g, 'rolls')[0].dice, [1, 4, 4, 2, 5, 6]);
  assert.strictEqual(R(g, 'diceguy').pos, 4);
});
test('骰子先生·多种点数重复时由我挑', () => {
  const g = S([['diceguy', 0], ['nepobaby', 20]]);
  dice(g, [2, 2, 5, 5, 1, 3]);
  let opts;
  turn(g, 'diceguy', { diceguy: (d) => { opts = d.options.map((o) => o.v); return '2'; } });
  assert.deepStrictEqual(opts.sort(), ['2', '5']);
  assert.strictEqual(R(g, 'diceguy').pos, 2);
});
test('骰子先生·三颗相同也算「出现了不止一次」', () => {
  const g = S([['diceguy', 0], ['nepobaby', 20]]);
  dice(g, [6, 6, 6, 1, 2, 4]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 6);
});
test('骰子先生·6 颗全都不一样就不动', () => {
  const g = S([['diceguy', 5], ['nepobaby', 20]]);
  dice(g, [6, 5, 4, 3, 2, 1]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 5);
  assert.deepStrictEqual(moves(g), []);
});
test('骰子先生·走的点数照常加主移动修正（野猪 +2）', () => {
  const g = S([['diceguy', 0, { hogs: 1 }], ['nepobaby', 20]]);
  dice(g, [4, 4, 1, 2, 3, 5]);
  turn(g, 'diceguy');
  assert.strictEqual(R(g, 'diceguy').pos, 6);
});
test('骰子先生·身边有电鳗：6 颗都算 1，只能走 1', () => {
  const g = S([['diceguy', 5], ['stunner', 6], ['nepobaby', 20]]);
  dice(g, [2, 3, 4, 5, 6, 2]);
  turn(g, 'diceguy');
  assert.deepStrictEqual(ev(g, 'rolls')[0].dice, [1, 1, 1, 1, 1, 1]);
  assert.strictEqual(R(g, 'diceguy').pos, 6);
});
test('骰子先生·在空指针前面失去技能：只掷 1 颗骰', () => {
  const g = S([['nul', 0], ['diceguy', 5], ['nepobaby', 20]]);
  dice(g, [4]);
  turn(g, 'diceguy');
  assert.strictEqual(ev(g, 'rolls').length, 0);
  assert.strictEqual(R(g, 'diceguy').pos, 8);
});

/* ======================= 蘑菇 mush ======================= */
test('蘑菇·掷出 1：从牌堆抽一名运动员，技能叠加到我身上，先长再移动（树懒 -1 当场生效）', () => {
  const g = S([['mush', 0], ['nepobaby', 20]]);
  g.deck = ['gloth', 'icarus'];
  dice(g, [1]);
  turn(g, 'mush');
  assert.deepStrictEqual(R(g, 'mush').stack, ['gloth']);
  assert.deepStrictEqual(g.deck, ['icarus']);
  assert.strictEqual(R(g, 'mush').pos, 0, '1 - 1 = 0');
});
test('蘑菇·掷出 2：同样抽一名；新技能本回合就生效（长出蹦蹦蛙，回合结束再来一回合）', () => {
  const g = S([['mush', 0], ['nepobaby', 3]]);
  g.deck = ['hopfrog'];
  dice(g, [2]);
  turn(g, 'mush');
  assert.deepStrictEqual(R(g, 'mush').stack, ['hopfrog']);
  assert.strictEqual(R(g, 'mush').pos, 2);
  assert.strictEqual(g.extraTurn, true);
});
test('蘑菇·掷 3~6 不抽', () => {
  for (const v of [3, 4, 5, 6]) {
    const g = S([['mush', 0], ['nepobaby', 20]]);
    g.deck = ['icarus'];
    dice(g, [v]);
    turn(g, 'mush');
    assert(!R(g, 'mush').stack, `掷 ${v}`);
    assert.deepStrictEqual(g.deck, ['icarus']);
    assert.strictEqual(R(g, 'mush').pos, v);
  }
});
test('蘑菇·技能可以一直叠加，本场持续有效', () => {
  const g = S([['mush', 0], ['nepobaby', 25]]);
  g.deck = ['icarus', 'gloth'];
  dice(g, [1, 2, 4]);
  turn(g, 'mush');
  assert.strictEqual(R(g, 'mush').pos, 4, '1 + 伊卡洛斯 3');
  turn(g, 'mush');
  assert.deepStrictEqual(R(g, 'mush').stack, ['icarus', 'gloth']);
  assert.strictEqual(R(g, 'mush').pos, 8, '2 + 3 - 1');
  turn(g, 'mush');
  assert.strictEqual(R(g, 'mush').pos, 14, '4 + 3 - 1，没再抽');
});
test('蘑菇·牌堆空了就什么也不长，照常移动', () => {
  const g = S([['mush', 0], ['nepobaby', 20]]);
  g.deck = [];
  dice(g, [2]);
  turn(g, 'mush');
  assert(!R(g, 'mush').stack || !R(g, 'mush').stack.length);
  assert.strictEqual(R(g, 'mush').pos, 2);
});
test('蘑菇·长出咬痕：这一掷就变身，这一步超过的人被淘汰', () => {
  const g = S([['mush', 0], ['nepobaby', 1], ['understudy', 20]]);
  g.deck = ['bitemark'];
  dice(g, [2]);
  turn(g, 'mush');
  assert.strictEqual(R(g, 'mush').wolf, true);
  assert.strictEqual(R(g, 'nepobaby').out, true);
});
test('蘑菇·被毒舌家把 1 重掷成 4：之前的 1 当作没发生，不抽', () => {
  const g = S([['critic', 0], ['mush', 3], ['nepobaby', 20]]);
  g.deck = ['icarus'];
  dice(g, [1, 4]);
  turn(g, 'mush', { critic: 'yes' });
  assert(!R(g, 'mush').stack);
  assert.strictEqual(R(g, 'mush').pos, 7);
});
test('蘑菇·在空指针前面失去技能：不抽；已叠加的技能也一并被屏蔽', () => {
  let g = S([['nul', 0], ['mush', 5], ['nepobaby', 20]]);
  g.deck = ['icarus'];
  dice(g, [2]);
  turn(g, 'mush');
  assert.deepStrictEqual(g.deck, ['icarus']);
  assert.strictEqual(R(g, 'mush').pos, 6);
  g = S([['nul', 0], ['mush', 5, { stack: ['icarus'] }], ['nepobaby', 20]]);
  dice(g, [4]);
  turn(g, 'mush');
  assert.strictEqual(R(g, 'mush').pos, 8, '4 - 1，没有伊卡洛斯 +3');
});
test('蘑菇·赛前技能抽到也没用：抽到野猪骑士就白抽，不会再抽下一张', () => {
  const g = S([['mush', 0], ['nepobaby', 20]]);
  g.deck = ['hogknight', 'icarus'];
  dice(g, [2]);
  turn(g, 'mush');
  assert(!g.has(R(g, 'mush'), 'icarus'), '不应拿到下一张伊卡洛斯');
  assert.strictEqual(R(g, 'mush').pos, 2);
  assert(g.deck.includes('icarus'), '伊卡洛斯应留在牌堆里');
});
test('[口径] 蘑菇·抽到赛场外技能（返场王）或自己已有的技能也白抽，放回牌堆底', () => {
  const g = S([['mush', 0, { stack: ['gloth'] }], ['nepobaby', 20]]);
  g.deck = ['rerunner', 'gloth', 'icarus'];
  dice(g, [2]);
  turn(g, 'mush');
  assert.deepStrictEqual(R(g, 'mush').stack, ['gloth']);
  assert.deepStrictEqual(g.deck, ['gloth', 'icarus', 'rerunner']);
  const h = S([['mush', 0, { stack: ['gloth'] }], ['nepobaby', 20]]);
  h.deck = ['gloth', 'icarus'];
  dice(h, [2]);
  turn(h, 'mush');
  assert.deepStrictEqual(R(h, 'mush').stack, ['gloth'], '已经有的技能');
});
