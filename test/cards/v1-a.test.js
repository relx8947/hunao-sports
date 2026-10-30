'use strict';
const { assert, test, setup, dice, run, turn, move, R, ev, said, pos } = require('./helpers');

// 一代卡牌逐句测试（A 组）：alchemist blimp coach babayaga centaur copycat banana cheerleader dicemonger
// duelist genius heckler egg gunk hugebaby flipflop hare hypnotist
// 陪练：双胞胎（twin）、未孵化的神秘蛋（egg）赛中没有任何技能，模仿猫也不会抄它们；
// 大长腿（legs）只在自己回合多一个「走 5 格」选项，turn() 默认掷骰。
const V1 = { edition: 'v1' };
const WILD = { edition: 'v1', track: 'wild' };
const v1 = (list, opts) => setup(list, { ...V1, ...opts });
const used = (g) => assert.strictEqual(g._dice.length, 0, `还有没用掉的骰点：${g._dice}`);
const pw = (g, key) => ev(g, 'power').filter((e) => e.key === key);
const moves = (g, rid) => ev(g, 'move').filter((e) => e.rid === rid).map((e) => [e.from, e.to]);
const idx = (g, pred) => g.events.findIndex(pred);
const optsOf = (d) => d.options.map((o) => o.v);

/* ======================= 炼金术士 alchemist ======================= */
// 主移动掷出 1 或 2 时，可以改为移动 4 格。
test('炼金术士：主移动掷出 1，选择改走 4 格', () => {
  const g = v1([['alchemist', 0], ['twin', 20]]);
  dice(g, [1]);
  const asked = turn(g, 'alchemist', { alchemist: 'yes' });
  assert(asked.includes('alchemist'));
  assert.strictEqual(R(g, 'alchemist').pos, 4);
  assert.strictEqual(pw(g, 'alchemist').length, 1);
  used(g);
});
test('炼金术士：掷出 2 也可以选择不改，照走 2 格', () => {
  const g = v1([['alchemist', 0], ['twin', 20]]);
  dice(g, [2]);
  turn(g, 'alchemist', { alchemist: 'no' });
  assert.strictEqual(R(g, 'alchemist').pos, 2);
  assert.strictEqual(pw(g, 'alchemist').length, 0);
});
test('炼金术士：掷出 3～6 不触发，也不询问', () => {
  for (const v of [3, 4, 5, 6]) {
    const g = v1([['alchemist', 0], ['twin', 20]]);
    dice(g, [v]);
    const asked = turn(g, 'alchemist', { alchemist: 'yes' });
    assert(!asked.includes('alchemist'), `掷 ${v} 不应询问`);
    assert.strictEqual(R(g, 'alchemist').pos, v);
  }
});
test('炼金术士：看重掷后的最终点数（骰子贩子 5→1 可改 4；1→5 就不能改）', () => {
  let g = v1([['alchemist', 0], ['dicemonger', 20]]);
  dice(g, [5, 1]);
  turn(g, 'alchemist', { reroll: 'dice', alchemist: 'yes' });
  assert.strictEqual(R(g, 'alchemist').pos, 4);
  assert.strictEqual(R(g, 'dicemonger').pos, 21);
  g = v1([['alchemist', 0], ['dicemonger', 20]]);
  dice(g, [1, 5]);
  const asked = turn(g, 'alchemist', { reroll: 'dice', alchemist: 'yes' });
  assert(!asked.includes('alchemist'));
  assert.strictEqual(R(g, 'alchemist').pos, 5);
});
test('[口径] 炼金术士：改成的 4 格之后照常吃主移动加减（教练 +1 → 5，黏液怪 -1 → 3）', () => {
  let g = v1([['alchemist', 5], ['coach', 5], ['twin', 20]]);
  dice(g, [1]);
  turn(g, 'alchemist', { alchemist: 'yes' });
  assert.strictEqual(R(g, 'alchemist').pos, 10);
  // 黏液怪减的是格数不是骰面：骰面仍是 2，可以改 4，再 -1
  g = v1([['alchemist', 0], ['gunk', 20]]);
  dice(g, [2]);
  const asked = turn(g, 'alchemist', { alchemist: 'yes' });
  assert(asked.includes('alchemist'));
  assert.strictEqual(R(g, 'alchemist').pos, 3);
});
test('炼金术士：改走 4 格可以直接冲线', () => {
  const g = v1([['alchemist', 27], ['twin', 0]]);
  dice(g, [1]);
  turn(g, 'alchemist', { alchemist: 'yes' });
  assert.strictEqual(R(g, 'alchemist').finished, 1);
  assert.strictEqual(R(g, 'alchemist').pos, 30);
});
test('模仿猫复制炼金术士：掷出 2 也能改走 4 格', () => {
  const g = v1([['copycat', 0], ['alchemist', 10], ['twin', 3]]);
  dice(g, [2]);
  turn(g, 'copycat', { alchemist: 'yes' });
  assert.strictEqual(R(g, 'copycat').pos, 4);
  assert.deepStrictEqual(pw(g, 'alchemist').map((e) => e.rid), ['copycat']);
});
test('[口径] 炼金术士：掷出的 1 被尺蠖作废时，不再询问改走 4 格', () => {
  const g = v1([['alchemist', 0], ['inchworm', 10]]);
  dice(g, [1]);
  const asked = turn(g, 'alchemist', { alchemist: 'yes' });
  assert(!asked.includes('alchemist'));
  assert.strictEqual(R(g, 'alchemist').pos, 0);
  assert.strictEqual(R(g, 'inchworm').pos, 11);
});

/* ======================= 飞艇 blimp ======================= */
// 回合开始时若还没过第二个弯道，主移动 +3；过了弯道（含弯道上）则 -1。（第二个弯道 = 第 15 格）
test('飞艇：回合开始在第二个弯道前（第 14 格）主移动 +3', () => {
  const g = v1([['blimp', 14], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 19);
  const calc = ev(g, 'calc')[0];
  assert.deepStrictEqual(calc.mods.map((m) => [m.label, m.v]), [['飞艇', 3]]);
});
test('飞艇：从起点出发也是 +3', () => {
  const g = v1([['blimp', 0], ['twin', 10]]);
  dice(g, [1]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 4);
});
test('飞艇：回合开始正好在第二个弯道上（第 15 格）算过了弯道，-1', () => {
  const g = v1([['blimp', 15], ['twin', 0]]);
  dice(g, [3]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 17);
});
test('飞艇：过了弯道（第 20 格）主移动 -1', () => {
  const g = v1([['blimp', 20], ['twin', 0]]);
  dice(g, [5]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 24);
});
test('飞艇：按回合开始的位置算——第 13 格出发、这一步跨过弯道仍是 +3', () => {
  const g = v1([['blimp', 13], ['twin', 0]]);
  dice(g, [6]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 22);
});
test('[口径] 飞艇：过弯后掷 1，-1 后为 0 格——原地不动、不会倒退（起哄怪照样触发）', () => {
  const g = v1([['blimp', 20], ['heckler', 5]]);
  dice(g, [1]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').pos, 20);
  assert.deepStrictEqual(moves(g, 'blimp'), []);
  assert.strictEqual(ev(g, 'calc')[0].total, 0);
  assert.strictEqual(R(g, 'heckler').pos, 7);
});
test('飞艇：过弯后 -1 仍能冲线（26 格掷 5 → 走 4 格到终点）', () => {
  const g = v1([['blimp', 26], ['twin', 0]]);
  dice(g, [5]);
  turn(g, 'blimp');
  assert.strictEqual(R(g, 'blimp').finished, 1);
});
test('狂野荒原：飞艇 +3 后停到 7 号箭头，再前进 3（箭头移动不加 +3）', () => {
  const g = v1([['blimp', 0], ['twin', 20]], WILD);
  dice(g, [4]);
  turn(g, 'blimp');
  assert.deepStrictEqual(moves(g, 'blimp'), [[0, 7], [7, 10]]);
});
test('模仿猫复制飞艇：按模仿猫自己回合开始的位置判定 +3 / -1', () => {
  let g = v1([['copycat', 10], ['blimp', 20], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 15);
  g = v1([['copycat', 16], ['blimp', 20], ['twin', 0]]);
  dice(g, [4]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 19);
});

/* ======================= 教练 coach ======================= */
// 和我同格的所有运动员主移动 +1，包括我自己。
test('教练：自己主移动 +1（包括我自己）', () => {
  const g = v1([['coach', 3], ['twin', 20]]);
  dice(g, [2]);
  turn(g, 'coach');
  assert.strictEqual(R(g, 'coach').pos, 6);
});
test('教练：同格的其他运动员主移动 +1', () => {
  const g = v1([['twin', 5], ['coach', 5], ['egg', 20]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 8);
  assert.deepStrictEqual(pw(g, 'coach').map((e) => e.targets), [['twin']]);
});
test('教练：不同格（差 1 格）没有加成', () => {
  const g = v1([['twin', 4], ['coach', 5], ['egg', 20]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 6);
  assert.strictEqual(pw(g, 'coach').length, 0);
});
test('教练：按主移动那一刻判定同格——啦啦队长加油离开教练格后没有 +1', () => {
  const g = v1([['cheerleader', 5], ['coach', 5], ['twin', 0]]);
  dice(g, [3]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'cheerleader').pos, 9);
});
test('教练：催眠蛇主移动前把教练拉到身边，催眠蛇主移动就有 +1', () => {
  const g = v1([['hypnotist', 10], ['coach', 3], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'coach' });
  assert.strictEqual(R(g, 'coach').pos, 10);
  assert.strictEqual(R(g, 'hypnotist').pos, 13);
});
test('[口径] 教练：起点也算同格，和教练一起在起点的运动员主移动 +1', () => {
  const g = v1([['twin', 0], ['coach', 0], ['egg', 5]]);
  dice(g, [3]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 4);
});
test('教练：被绊倒的教练照样给同格的人 +1', () => {
  const g = v1([['twin', 5], ['coach', 5, { tripped: true }], ['egg', 20]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 8);
});
test('模仿猫复制教练：两位「教练」同格，主移动 +2', () => {
  const g = v1([['coach', 10], ['copycat', 10], ['twin', 0]]);
  dice(g, [3]);
  turn(g, 'coach');
  assert.strictEqual(R(g, 'coach').pos, 15);
  assert.deepStrictEqual(pw(g, 'coach').map((e) => e.rid).sort(), ['coach', 'copycat']);
});

/* ======================= 芭芭雅嘎 babayaga ======================= */
// 任何停到我格子上的运动员被绊倒；我停到别人格子上时，他们也被绊倒。
test('芭芭雅嘎：主移动停到我格子上的运动员被绊倒，我自己不倒', () => {
  const g = v1([['twin', 0], ['babayaga', 4], ['egg', 20]]);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.strictEqual(R(g, 'babayaga').tripped, false);
  assert.deepStrictEqual(pw(g, 'babayaga').map((e) => e.targets), [['twin']]);
});
test('芭芭雅嘎：只是经过我的格子不会被绊倒', () => {
  const g = v1([['twin', 0], ['babayaga', 2], ['egg', 20]]);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.strictEqual(R(g, 'twin').tripped, false);
});
test('芭芭雅嘎：我停到别人格子上，那格所有人都被绊倒，我自己不倒', () => {
  const g = v1([['babayaga', 0], ['twin', 3], ['egg', 3]]);
  dice(g, [3]);
  turn(g, 'babayaga');
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.strictEqual(R(g, 'egg').tripped, true);
  assert.strictEqual(R(g, 'babayaga').tripped, false);
});
test('芭芭雅嘎：技能移动停到我格子也算（起哄怪前进 2 落到我格子被绊倒）', () => {
  const g = v1([['twin', 10], ['heckler', 3], ['babayaga', 5]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 5);
  assert.strictEqual(R(g, 'heckler').tripped, true);
});
test('芭芭雅嘎：被催眠蛇瞬移过去也算「我停到别人格子」，催眠蛇被绊倒', () => {
  const g = v1([['hypnotist', 10], ['babayaga', 3], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'babayaga' });
  assert.strictEqual(R(g, 'babayaga').pos, 10);
  assert.strictEqual(R(g, 'hypnotist').tripped, true);
});
test('[口径] 主移动前被绊倒（催眠蛇拉来芭芭雅嘎）：这回合照常主移动，下回合才爬起不掷骰', () => {
  const g = v1([['hypnotist', 10], ['babayaga', 3], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'babayaga' });
  assert.strictEqual(R(g, 'hypnotist').pos, 12);
  assert.strictEqual(R(g, 'hypnotist').tripped, true);
  dice(g, []);
  const asked = turn(g, 'hypnotist');
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'hypnotist').pos, 12);
  assert.strictEqual(R(g, 'hypnotist').tripped, false);
});
test('芭芭雅嘎：在起点也生效——被半人马踢回起点的人停到我格子被绊倒', () => {
  const g = v1([['centaur', 0], ['twin', 1], ['babayaga', 0]]);
  dice(g, [3]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 0);
  assert.strictEqual(R(g, 'twin').tripped, true);
});
test('芭芭雅嘎 + 决斗家：决斗家停到我格子、选择不决斗，被绊倒', () => {
  const g = v1([['duelist', 0], ['babayaga', 3], ['twin', 20]]);
  dice(g, [3]);
  turn(g, 'duelist', { duel: '_no' });
  assert.strictEqual(R(g, 'duelist').tripped, true);
});
test('芭芭雅嘎 + 决斗家：决斗家停到我格子后决斗，决斗完照样被绊倒', () => {
  const g = v1([['duelist', 0], ['babayaga', 3], ['twin', 20]]);
  dice(g, [3, 5, 2]); // 主移动 3；决斗：决斗家 5、芭芭雅嘎 2
  turn(g, 'duelist', { duel: 'babayaga' });
  assert.strictEqual(R(g, 'duelist').pos, 5, '决斗家赢了前进 2');
  assert.strictEqual(R(g, 'duelist').tripped, true, '停到芭芭雅嘎格子就该被绊倒');
});
test('[口径] 狂野荒原：停到站在 7 号箭头上的芭芭雅嘎处，先被箭头带走，照样被绊倒（停上去那一刻已触发）', () => {
  const g = v1([['twin', 0], ['babayaga', 7], ['egg', 20]], WILD);
  dice(g, [7]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 10);
  assert.strictEqual(R(g, 'twin').tripped, true);
});
test('[口径] 巨婴停到芭芭雅嘎的格子：芭芭雅嘎被挤到身后一格，巨婴不被绊倒', () => {
  const g = v1([['hugebaby', 0], ['babayaga', 3], ['twin', 20]]);
  dice(g, [3]);
  turn(g, 'hugebaby');
  assert.strictEqual(R(g, 'hugebaby').pos, 3);
  assert.strictEqual(R(g, 'babayaga').pos, 2);
  assert.strictEqual(R(g, 'hugebaby').tripped, false);
});

/* ======================= 半人马 centaur ======================= */
// 我超过谁，谁就后退 2 格。注：最多踢回起点，不会更远。
test('半人马：主移动超过谁，谁就后退 2 格', () => {
  const g = v1([['centaur', 0], ['twin', 3], ['egg', 20]]);
  dice(g, [5]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'centaur').pos, 5);
  assert.strictEqual(R(g, 'twin').pos, 1);
  assert.strictEqual(R(g, 'egg').pos, 20);
});
test('半人马：停在别人格子上不算超过，不踢', () => {
  const g = v1([['centaur', 0], ['twin', 3], ['egg', 20]]);
  dice(g, [3]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 3);
  assert.strictEqual(pw(g, 'centaur').length, 0);
});
test('半人马：一次超过多人，每人各退 2 格', () => {
  const g = v1([['centaur', 0], ['twin', 2], ['egg', 4], ['legs', 20]]);
  dice(g, [6]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 0);
  assert.strictEqual(R(g, 'egg').pos, 2);
  assert.strictEqual(pw(g, 'centaur').length, 2);
});
test('半人马（注释）：第 1 格的人被踢只退到起点', () => {
  const g = v1([['centaur', 0], ['twin', 1], ['egg', 20]]);
  dice(g, [3]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 0);
  assert.deepStrictEqual(moves(g, 'twin'), [[1, 0]]);
});
test('半人马：技能移动超过别人也踢（啦啦队长让垫底的半人马前进 2）', () => {
  const g = v1([['cheerleader', 10], ['centaur', 3], ['twin', 4]]);
  dice(g, [2]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'centaur').pos, 5);
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'cheerleader').pos, 13);
});
test('半人马：瞬移不算超过（被催眠蛇拉到前面，不踢中间的人）', () => {
  const g = v1([['hypnotist', 10], ['centaur', 0], ['twin', 5]]);
  dice(g, [1]);
  turn(g, 'hypnotist', { hypnotist: 'centaur' });
  assert.strictEqual(R(g, 'centaur').pos, 10);
  assert.strictEqual(R(g, 'twin').pos, 5);
});
test('狂野荒原：半人马踩 7 号箭头前进 3，箭头这次移动超过的人也被踢', () => {
  const g = v1([['centaur', 3], ['twin', 8], ['egg', 20]], WILD);
  dice(g, [4]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'centaur').pos, 10);
  assert.strictEqual(R(g, 'twin').pos, 6);
});
test('半人马超过香蕉：香蕉被踢退 2 格，半人马也被绊倒', () => {
  const g = v1([['centaur', 0], ['banana', 2], ['twin', 20]]);
  dice(g, [4]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'banana').pos, 0);
  assert.strictEqual(R(g, 'centaur').tripped, true);
});
test('半人马：冲线那一步超过的多人都后退 2 格', () => {
  const g = v1([['centaur', 26], ['twin', 27], ['egg', 29], ['legs', 0]]);
  dice(g, [5]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'centaur').finished, 1);
  assert.strictEqual(R(g, 'twin').pos, 25);
  assert.strictEqual(R(g, 'egg').pos, 27);
});
test('模仿猫复制半人马：超过别人也踢', () => {
  const g = v1([['copycat', 0], ['centaur', 20], ['twin', 2]]);
  dice(g, [4]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'twin').pos, 0);
});

/* ======================= 模仿猫 copycat ======================= */
// 我持续拥有当前领跑者的技能；并列领跑时由我挑。注：不会抄「赛前」技能。
test('模仿猫：拥有唯一领跑者的技能（复制野兔，主移动 +2）', () => {
  const g = v1([['copycat', 0], ['hare', 10], ['twin', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'hare');
  dice(g, [3]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 5);
});
test('模仿猫：持续拥有——不在自己回合也生效（复制香蕉，别人超过我被绊倒）', () => {
  const g = v1([['twin', 0], ['copycat', 3], ['banana', 10]]);
  dice(g, [5]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.deepStrictEqual(pw(g, 'banana').map((e) => e.rid), ['copycat']);
});
test('模仿猫：领跑者换人，技能跟着换（野兔被黏液怪超过后，改抄黏液怪）', () => {
  const g = v1([['copycat', 0], ['hare', 10], ['gunk', 8]]);
  const cat = R(g, 'copycat');
  assert.strictEqual(g.power(cat), 'hare');
  dice(g, [5]);
  turn(g, 'gunk');
  assert.strictEqual(R(g, 'gunk').pos, 13);
  assert.strictEqual(g.power(cat), 'gunk');
  dice(g, [4]);
  turn(g, 'copycat');
  assert.strictEqual(cat.pos, 3, '不再有野兔 +2，只吃真黏液怪 -1');
});
test('模仿猫：并列领跑时由我挑（挑野兔 4 格 / 挑黏液怪 2 格）', () => {
  for (const [pick, want] of [['hare', 4], ['gunk', 2]]) {
    const g = v1([['copycat', 0], ['hare', 10], ['gunk', 10]]);
    dice(g, [3]);
    let offered;
    turn(g, 'copycat', { copycat: (d) => { offered = optsOf(d).sort(); return pick; } });
    assert.deepStrictEqual(offered, ['gunk', 'hare']);
    assert.strictEqual(R(g, 'copycat').pos, want, `挑 ${pick}`);
  }
});
test('模仿猫：和唯一另一名领跑者并列时直接抄它，不用挑', () => {
  const g = v1([['copycat', 10], ['hare', 10], ['twin', 0]]);
  dice(g, [3]);
  const asked = turn(g, 'copycat');
  assert(!asked.includes('copycat'));
  assert.strictEqual(R(g, 'copycat').pos, 15, '并列不算独自领跑，野兔 +2 照常');
});
test('模仿猫：自己独自领跑时没有可抄的技能', () => {
  const g = v1([['copycat', 10], ['hare', 5], ['twin', 0]]);
  assert.strictEqual(g.power(R(g, 'copycat')), null);
  dice(g, [3]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 13);
});
test('模仿猫（注释）：神秘蛋孵出的技能不是赛前技能，可以抄（蛋孵出野兔）', () => {
  const g = v1([['copycat', 0], ['egg', 10, { power: 'hare' }], ['twin', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'hare');
  dice(g, [3]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 5);
});
test('[口径] 模仿猫：西西弗斯整张卡算赛前技能，它领跑时「掷 6 回起点」也抄不到', () => {
  const g = v1([['copycat', 0], ['sisyphus', 10], ['twin', 3]]);
  assert.strictEqual(g.power(R(g, 'copycat')), null);
  dice(g, [6]);
  turn(g, 'copycat');
  assert.strictEqual(R(g, 'copycat').pos, 6);
});
test('[口径] 模仿猫：已冲线的运动员不算领跑者，抄场上最前的人', () => {
  const g = v1([['copycat', 5], ['hare', 30, { finished: 1 }], ['gunk', 8]]);
  assert.strictEqual(g.power(R(g, 'copycat')), 'gunk');
});

/* ======================= 香蕉 banana ======================= */
// 任何超过我的运动员都会被绊倒。
test('香蕉：主移动超过我的运动员被绊倒', () => {
  const g = v1([['twin', 0], ['banana', 2], ['egg', 20]]);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.deepStrictEqual(pw(g, 'banana').map((e) => e.targets), [['twin']]);
});
test('香蕉：被绊倒的人下回合不掷骰，只爬起来', () => {
  const g = v1([['twin', 0], ['banana', 2], ['egg', 20]]);
  dice(g, [4]);
  turn(g, 'twin');
  dice(g, []);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.strictEqual(R(g, 'twin').tripped, false);
  assert.strictEqual(ev(g, 'recover').length, 1);
});
test('香蕉：停在我格子或停在我身后都不算超过', () => {
  for (const roll of [2, 1]) {
    const g = v1([['twin', 0], ['banana', 2], ['egg', 20]]);
    dice(g, [roll]);
    turn(g, 'twin');
    assert.strictEqual(R(g, 'twin').tripped, false, `走 ${roll} 格`);
  }
});
test('香蕉：技能移动超过我也绊倒（起哄怪前进 2 格越过香蕉）', () => {
  const g = v1([['twin', 10], ['heckler', 3], ['banana', 4]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 5);
  assert.strictEqual(R(g, 'heckler').tripped, true);
});
test('香蕉：瞬移越过我不算超过（翻翻鱼换位）', () => {
  const g = v1([['flipflop', 0], ['banana', 5], ['twin', 10]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.strictEqual(R(g, 'flipflop').pos, 10);
  assert.strictEqual(R(g, 'flipflop').tripped, false);
});
test('狂野荒原：后退越过香蕉不算超过（16 号箭头退 4 越过 14 格的香蕉）', () => {
  const g = v1([['twin', 15], ['banana', 14], ['egg', 0]], WILD);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 12);
  assert.strictEqual(R(g, 'twin').tripped, false);
});
test('狂野荒原：7 号箭头那次前进越过香蕉也被绊倒', () => {
  const g = v1([['twin', 3], ['banana', 8], ['egg', 20]], WILD);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 10);
  assert.strictEqual(R(g, 'twin').tripped, true);
});

/* ======================= 啦啦队长 cheerleader ======================= */
// 主移动前，可以让最后一名的运动员前进 2 格；这么做的话我前进 1 格。
test('啦啦队长：主移动前最后一名前进 2、我前进 1，然后照常掷骰', () => {
  const g = v1([['cheerleader', 5], ['twin', 2], ['egg', 10]]);
  dice(g, [3]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.strictEqual(R(g, 'cheerleader').pos, 9);
  assert.deepStrictEqual(ev(g, 'move').map((e) => [e.rid, e.from, e.to]), [['twin', 2, 4], ['cheerleader', 5, 6], ['cheerleader', 6, 9]]);
  assert(idx(g, (e) => e.t === 'move' && e.rid === 'cheerleader') < idx(g, (e) => e.t === 'roll'), '加油在掷骰之前');
});
test('啦啦队长：可以选择不加油，谁都不额外移动', () => {
  const g = v1([['cheerleader', 5], ['twin', 2], ['egg', 10]]);
  dice(g, [3]);
  turn(g, 'cheerleader', { cheerleader: 'no' });
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'cheerleader').pos, 8);
  assert.strictEqual(pw(g, 'cheerleader').length, 0);
});
test('[口径] 啦啦队长：并列最后的都前进 2，我仍只走 1', () => {
  const g = v1([['cheerleader', 5], ['twin', 2], ['egg', 2], ['legs', 10]]);
  dice(g, [1]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.strictEqual(R(g, 'egg').pos, 4);
  assert.strictEqual(R(g, 'cheerleader').pos, 7);
});
test('啦啦队长：自己就是最后一名时先走 2 再走 1（两次移动）', () => {
  const g = v1([['cheerleader', 0], ['twin', 6]]);
  dice(g, [2]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.deepStrictEqual(moves(g, 'cheerleader'), [[0, 2], [2, 3], [3, 5]]);
});
test('[口径] 啦啦队长：被绊倒的回合没有主移动，也就不能加油', () => {
  const g = v1([['cheerleader', 5, { tripped: true }], ['twin', 2]]);
  dice(g, []);
  const asked = turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert(!asked.includes('cheerleader'));
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'cheerleader').pos, 5);
});
test('啦啦队长：最后一名被推过终点算冲线，我再前进 1 也冲线，第 2 名到手比赛结束', () => {
  const g = v1([['cheerleader', 29], ['twin', 28], ['egg', 29]]);
  dice(g, []);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'twin').finished, 1);
  assert.strictEqual(R(g, 'cheerleader').finished, 2);
  assert.strictEqual(g.ended, true);
});
test('啦啦队长：被推的最后一名是大嘴怪，停到我格子把我吃掉——我不再前进 1，也不主移动', () => {
  const g = v1([['cheerleader', 5], ['mouth', 3], ['twin', 10]]);
  dice(g, []);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'mouth').pos, 5);
  assert.strictEqual(R(g, 'cheerleader').out, true);
  assert.deepStrictEqual(moves(g, 'cheerleader'), []);
  assert.strictEqual(ev(g, 'roll').length, 0);
});
test('狂野荒原：最后一名被推到 5 号石头上被绊倒', () => {
  const g = v1([['cheerleader', 18], ['twin', 3], ['egg', 20]], WILD);
  dice(g, [2]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.strictEqual(R(g, 'cheerleader').pos, 21);
});

/* ======================= 骰子贩子 dicemonger ======================= */
// 场上每人每回合都可以重掷一次主移动骰；别人这么做时，我前进 1 格。
test('骰子贩子：别人重掷主移动骰，按重掷点数走，我前进 1 格', () => {
  const g = v1([['twin', 0], ['dicemonger', 10]]);
  dice(g, [2, 5]);
  turn(g, 'twin', { reroll: 'dice' });
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'dicemonger').pos, 11);
  used(g);
});
test('骰子贩子：别人不重掷，我不动', () => {
  const g = v1([['twin', 0], ['dicemonger', 10]]);
  dice(g, [2]);
  const asked = turn(g, 'twin', { reroll: 'keep' });
  assert(asked.includes('reroll'));
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'dicemonger').pos, 10);
});
test('骰子贩子：每回合只能重掷一次（重掷后不再询问）', () => {
  const g = v1([['twin', 0], ['dicemonger', 10]]);
  dice(g, [2, 3]);
  const asked = turn(g, 'twin', { reroll: 'dice' });
  assert.strictEqual(asked.filter((k) => k === 'reroll').length, 1);
  assert.strictEqual(R(g, 'twin').pos, 3);
});
test('骰子贩子：每回合一次——下个回合又能重掷，我又前进 1 格', () => {
  const g = v1([['twin', 0], ['dicemonger', 10]]);
  dice(g, [1, 2, 1, 3]);
  turn(g, 'twin', { reroll: 'dice' });
  turn(g, 'twin', { reroll: 'dice' });
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'dicemonger').pos, 12);
  used(g);
});
test('骰子贩子：「每人」包括我自己，但自己重掷不给自己加 1', () => {
  const g = v1([['dicemonger', 0], ['twin', 10]]);
  dice(g, [1, 4]);
  turn(g, 'dicemonger', { reroll: 'dice' });
  assert.strictEqual(R(g, 'dicemonger').pos, 4);
});
test('骰子贩子：我已冲线不在场，别人就不能重掷', () => {
  const g = v1([['twin', 0], ['dicemonger', 30, { finished: 1 }], ['egg', 5]]);
  dice(g, [2]);
  const asked = turn(g, 'twin', { reroll: 'dice' });
  assert(!asked.includes('reroll'));
  assert.strictEqual(R(g, 'twin').pos, 2);
});
test('骰子贩子：只能重掷主移动骰，决斗的骰子不能重掷', () => {
  const g = v1([['duelist', 0], ['twin', 3], ['dicemonger', 20]]);
  dice(g, [3, 2, 5]); // 主移动 3（不重掷）；决斗 2 对 5
  const asked = turn(g, 'duelist', { reroll: 'keep', duel: 'twin' });
  assert.strictEqual(asked.filter((k) => k === 'reroll').length, 1);
  assert.strictEqual(R(g, 'twin').pos, 5);
  used(g);
});

/* ======================= 决斗家 duelist ======================= */
// 有人和我同格时，我可以喊「决斗！」：双方掷骰，点大者前进 2 格，平局算我赢。
test('决斗家：停到有人的格子可以决斗，点大者前进 2，平局算我赢', () => {
  for (const [a, b, me, foe] of [[5, 2, 5, 3], [2, 5, 3, 5], [4, 4, 5, 3]]) {
    const g = v1([['duelist', 0], ['twin', 3], ['egg', 20]]);
    dice(g, [3, a, b]); // 主移动 3；决斗家先掷、对手后掷
    turn(g, 'duelist', { duel: 'twin' });
    assert.deepStrictEqual([R(g, 'duelist').pos, R(g, 'twin').pos], [me, foe], `决斗 ${a}:${b}`);
    assert.strictEqual(ev(g, 'duel').length, 1);
    used(g);
  }
});
test('决斗家：可以不喊决斗，不掷决斗骰', () => {
  const g = v1([['duelist', 0], ['twin', 3], ['egg', 20]]);
  dice(g, [3]);
  const asked = turn(g, 'duelist', { duel: '_no' });
  assert(asked.includes('duel'));
  assert.deepStrictEqual([R(g, 'duelist').pos, R(g, 'twin').pos], [3, 3]);
  assert.strictEqual(ev(g, 'duel').length, 0);
});
test('决斗家：别人停到我格子上我也能喊，只能和停过来的人决斗', () => {
  const g = v1([['twin', 0], ['duelist', 3], ['egg', 3]]);
  dice(g, [3, 4, 1]);
  let offered;
  turn(g, 'twin', { duel: (d) => { offered = optsOf(d); return 'twin'; } });
  assert.deepStrictEqual(offered, ['twin', '_no']);
  assert.strictEqual(R(g, 'duelist').pos, 5);
  assert.strictEqual(R(g, 'twin').pos, 3);
});
test('决斗家：格子上有多人时由我挑对象', () => {
  const g = v1([['duelist', 0], ['twin', 3], ['egg', 3]]);
  dice(g, [3, 1, 6]);
  let offered;
  turn(g, 'duelist', { duel: (d) => { offered = optsOf(d); return 'egg'; } });
  assert.deepStrictEqual(offered.slice().sort(), ['_no', 'egg', 'twin']);
  assert.strictEqual(R(g, 'egg').pos, 5);
  assert.strictEqual(R(g, 'twin').pos, 3);
});
test('[口径] 决斗家：一次停格只决斗一次——输掉后格子上还有别人也不能再喊', () => {
  const g = v1([['duelist', 0], ['twin', 3], ['egg', 3]]);
  dice(g, [3, 1, 6]);
  const asked = turn(g, 'duelist', { duel: 'egg' });
  assert.strictEqual(asked.filter((k) => k === 'duel').length, 1);
  assert.deepStrictEqual([R(g, 'duelist').pos, R(g, 'twin').pos], [3, 3]);
  used(g);
});
test('[口径] 决斗家：只在有人停过来/我停过去时能喊，回合开始时本来就同格不能决斗', () => {
  const g = v1([['duelist', 3], ['twin', 3], ['egg', 20]]);
  dice(g, [2]);
  const asked = turn(g, 'duelist', { duel: 'twin' });
  assert(!asked.includes('duel'));
  assert.strictEqual(R(g, 'duelist').pos, 5);
});
test('狂野荒原：踩石头被绊倒照样能决斗，赢了前进 2 踩 7 号箭头再前进 3', () => {
  const g = v1([['duelist', 0], ['twin', 5], ['egg', 20]], WILD);
  dice(g, [5, 6, 1]);
  turn(g, 'duelist', { duel: 'twin' });
  assert.strictEqual(R(g, 'duelist').tripped, true);
  assert.deepStrictEqual(moves(g, 'duelist'), [[0, 5], [5, 7], [7, 10]]);
  assert.strictEqual(R(g, 'twin').tripped, false);
});
test('模仿猫复制决斗家：停到别人格子也能决斗', () => {
  const g = v1([['copycat', 0], ['duelist', 20], ['twin', 3]]);
  dice(g, [3, 6, 1]);
  turn(g, 'copycat', { duel: 'twin' });
  assert.strictEqual(R(g, 'copycat').pos, 5);
  assert.deepStrictEqual(pw(g, 'duelist').map((e) => e.rid), ['copycat']);
});

/* ======================= 天才 genius ======================= */
// 主移动前预言自己会掷出几点；猜中的话，本回合结束后我再来一回合。
test('天才：掷骰前预言，猜中就再来一回合', () => {
  const g = v1([['genius', 0], ['twin', 20]]);
  dice(g, [4]);
  turn(g, 'genius', { genius: '4' });
  assert.strictEqual(g.extraTurn, true);
  assert.strictEqual(R(g, 'genius').pos, 4);
  assert(idx(g, (e) => e.t === 'predict') < idx(g, (e) => e.t === 'roll'), '预言在掷骰之前');
});
test('天才：猜错没有额外回合', () => {
  const g = v1([['genius', 0], ['twin', 20]]);
  dice(g, [4]);
  turn(g, 'genius', { genius: '3' });
  assert.strictEqual(g.extraTurn, false);
  assert.strictEqual(pw(g, 'genius').length, 0);
});
test('天才：猜中后本回合结束再来一个完整回合，之后才轮到下家', () => {
  const g = v1([['genius', 23], ['legs', 29]]);
  dice(g, [1, 6]);
  const guesses = ['1', '6'];
  run(g, g.raceLoop(0), { genius: () => guesses.shift(), mode: 'legs' });
  assert.deepStrictEqual(ev(g, 'turn').map((e) => e.rid), ['genius', 'genius', 'legs']);
  assert.strictEqual(ev(g, 'extraTurn').length, 1);
  assert.strictEqual(R(g, 'genius').finished, 1, '额外回合掷 6 冲线');
  assert.strictEqual(R(g, 'legs').finished, 2);
  used(g);
});
test('天才：预言看骰面，黏液怪 -1 不影响猜中', () => {
  const g = v1([['genius', 0], ['gunk', 20]]);
  dice(g, [4]);
  turn(g, 'genius', { genius: '4' });
  assert.strictEqual(g.extraTurn, true);
  assert.strictEqual(R(g, 'genius').pos, 3);
});
test('[口径] 天才：有重掷时比的是重掷后的最终点数', () => {
  let g = v1([['genius', 0], ['dicemonger', 20]]);
  dice(g, [2, 5]);
  turn(g, 'genius', { genius: '5', reroll: 'dice' });
  assert.strictEqual(g.extraTurn, true);
  g = v1([['genius', 0], ['dicemonger', 20]]);
  dice(g, [2, 5]);
  turn(g, 'genius', { genius: '2', reroll: 'dice' });
  assert.strictEqual(g.extraTurn, false);
});
test('天才：被绊倒的回合不主移动，不预言也没有额外回合', () => {
  const g = v1([['genius', 5, { tripped: true }], ['twin', 0]]);
  dice(g, []);
  const asked = turn(g, 'genius', { genius: '1' });
  assert(!asked.includes('genius'));
  assert.strictEqual(g.extraTurn, false);
});
test('模仿猫复制天才：猜中也再来一回合', () => {
  const g = v1([['copycat', 0], ['genius', 10], ['twin', 3]]);
  dice(g, [2]);
  turn(g, 'copycat', { genius: '2' });
  assert.strictEqual(g.extraTurn, true);
});

/* ======================= 起哄怪 heckler ======================= */
// 有运动员结束回合时离回合开始位置不超过 1 格，我前进 2 格。
test('起哄怪：别人这回合只前进 1 格，回合结束时我前进 2', () => {
  const g = v1([['twin', 0], ['heckler', 10]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 12);
  assert(idx(g, (e) => e.t === 'move' && e.rid === 'heckler') > idx(g, (e) => e.t === 'move' && e.rid === 'twin'));
});
test('起哄怪：别人前进 2 格就不触发', () => {
  const g = v1([['twin', 0], ['heckler', 10]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 10);
});
test('起哄怪（规则书补充）：被绊倒爬起来、原地不动也触发', () => {
  const g = v1([['twin', 5, { tripped: true }], ['heckler', 10]]);
  dice(g, []);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 12);
});
test('狂野荒原：按回合结束时的位置算——前进 4 又被 16 号箭头退回原地，也触发', () => {
  const g = v1([['twin', 12], ['heckler', 2]], WILD);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 12);
  assert.strictEqual(R(g, 'heckler').pos, 4);
});
test('狂野荒原：后退超过 1 格也不触发（15 走 1 到 16 号箭头退到 12）', () => {
  const g = v1([['twin', 15], ['heckler', 2]], WILD);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 12);
  assert.strictEqual(R(g, 'heckler').pos, 2);
});
test('起哄怪：翻翻鱼换位后离开始位置只差 1 格，也触发', () => {
  const g = v1([['flipflop', 10], ['twin', 11], ['heckler', 3]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.strictEqual(R(g, 'flipflop').pos, 11);
  assert.strictEqual(R(g, 'heckler').pos, 5);
});
test('[口径] 起哄怪：自己回合只前进 1 格，也给自己前进 2', () => {
  const g = v1([['heckler', 0], ['twin', 20]]);
  dice(g, [1]);
  turn(g, 'heckler');
  assert.strictEqual(R(g, 'heckler').pos, 3);
});
test('模仿猫复制起哄怪：两只一起前进 2', () => {
  const g = v1([['twin', 0], ['heckler', 10], ['copycat', 5]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'heckler').pos, 12);
  assert.strictEqual(R(g, 'copycat').pos, 7);
});

/* ======================= 神秘蛋 egg ======================= */
// 赛前从牌堆抽 3 名新运动员选 1 名，我获得它的技能。
test('神秘蛋：赛前从牌堆顶抽 3 名、挑 1 名获得技能，其余放回牌堆', () => {
  const g = v1([['egg', 0], ['twin', 0]]);
  g.deck = ['hare', 'gunk', 'coach', 'legs'];
  let offered;
  run(g, g.applyBeforeRace(R(g, 'egg'), 'egg', 0), { egg: (d) => { offered = optsOf(d); return 'gunk'; } });
  assert.deepStrictEqual(offered, ['hare', 'gunk', 'coach']);
  assert.strictEqual(R(g, 'egg').power, 'gunk');
  assert.strictEqual(R(g, 'egg').rid, 'egg', '还是神秘蛋的棋子');
  assert.deepStrictEqual(g.deck.slice().sort(), ['coach', 'hare', 'legs']);
});
test('神秘蛋：正式赛前流程孵出野兔，比赛中主移动 +2', () => {
  const g = v1([['egg', 0], ['twin', 10]]);
  g.deck = ['legs', 'hare', 'gunk'];
  run(g, g.beforeRace(), { egg: 'hare' });
  dice(g, [3]);
  turn(g, 'egg');
  assert.strictEqual(R(g, 'egg').pos, 5);
});
test('神秘蛋（规则书补充）：可以获得赛前技能并立刻生效（孵出西西弗斯，赛前拿 4 分）', () => {
  const g = v1([['egg', 0], ['twin', 0]]);
  g.deck = ['sisyphus', 'hare', 'gunk'];
  run(g, g.applyBeforeRace(R(g, 'egg'), 'egg', 0), { egg: 'sisyphus' });
  assert.strictEqual(R(g, 'egg').power, 'sisyphus');
  assert.strictEqual(g.score(0), 4);
});
test('神秘蛋：孵出双胞胎，接着挑往届冠军的技能', () => {
  const g = v1([['egg', 0], ['twin', 0]]);
  g.deck = ['twin', 'gunk', 'coach'];
  g.winners = ['hare'];
  run(g, g.applyBeforeRace(R(g, 'egg'), 'egg', 0), { egg: 'twin', twin: 'hare' });
  assert.strictEqual(R(g, 'egg').power, 'hare');
});
test('神秘蛋：牌堆不足 3 张时有几张抽几张', () => {
  const g = v1([['egg', 0], ['twin', 0]]);
  g.deck = ['hare'];
  let offered;
  run(g, g.applyBeforeRace(R(g, 'egg'), 'egg', 0), { egg: (d) => { offered = optsOf(d); return 'hare'; } });
  assert.deepStrictEqual(offered, ['hare']);
  assert.strictEqual(R(g, 'egg').power, 'hare');
});
test('[口径] 神秘蛋：牌堆空了就孵不出技能，不询问', () => {
  const g = v1([['egg', 0], ['twin', 0]]);
  g.deck = [];
  const asked = run(g, g.applyBeforeRace(R(g, 'egg'), 'egg', 0));
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'egg').power, 'egg');
});

/* ======================= 黏液怪 gunk ======================= */
// 其他运动员主移动 -1。
test('黏液怪：其他运动员主移动 -1', () => {
  const g = v1([['twin', 0], ['gunk', 20]]);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 3);
  assert.deepStrictEqual(pw(g, 'gunk').map((e) => e.targets), [['twin']]);
});
test('黏液怪：自己主移动不减', () => {
  const g = v1([['gunk', 0], ['twin', 20]]);
  dice(g, [4]);
  turn(g, 'gunk');
  assert.strictEqual(R(g, 'gunk').pos, 4);
});
test('黏液怪：只减主移动，技能移动不减（起哄怪照走 2 格）', () => {
  const g = v1([['twin', 0], ['heckler', 10], ['gunk', 20]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 1);
  assert.strictEqual(R(g, 'heckler').pos, 12);
});
test('[口径] 黏液怪：掷 1 减到 0 格，原地不动而不是后退', () => {
  const g = v1([['twin', 5], ['gunk', 20]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.deepStrictEqual(moves(g, 'twin'), []);
});
test('黏液怪：被绊倒时照样让别人 -1', () => {
  const g = v1([['twin', 0], ['gunk', 20, { tripped: true }]]);
  dice(g, [4]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 3);
});
test('黏液怪：减 1 后不够冲线就停在终点前', () => {
  const g = v1([['twin', 27], ['gunk', 0]]);
  dice(g, [3]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 29);
  assert.strictEqual(R(g, 'twin').finished, 0);
});
test('模仿猫复制黏液怪：第三人 -2，真黏液怪也被模仿猫 -1', () => {
  const g = v1([['twin', 0], ['gunk', 10], ['copycat', 5]]);
  dice(g, [5]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 3);
  dice(g, [4]);
  turn(g, 'gunk');
  assert.strictEqual(R(g, 'gunk').pos, 13);
});

/* ======================= 巨婴 hugebaby ======================= */
// 除起点外，谁也不能和我同格；要落到我格子上的运动员改放到我身后一格。
test('巨婴：要落到我格子上的运动员改放到我身后一格', () => {
  const g = v1([['twin', 0], ['hugebaby', 5]]);
  dice(g, [5]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 4);
  assert.deepStrictEqual(pw(g, 'hugebaby').map((e) => e.targets), [['twin']]);
});
test('巨婴：起点除外——被半人马踢回起点可以和我同格', () => {
  const g = v1([['centaur', 0], ['twin', 1], ['hugebaby', 0]]);
  dice(g, [3]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 0);
  assert.strictEqual(R(g, 'hugebaby').pos, 0);
});
test('狂野荒原：我落到有人的格子，那人被放到我身后，视为停在那里（5 号石头绊倒）', () => {
  const g = v1([['hugebaby', 0], ['twin', 6], ['egg', 20]], WILD);
  dice(g, [6]);
  turn(g, 'hugebaby');
  assert.strictEqual(R(g, 'hugebaby').pos, 6);
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'twin').tripped, true);
  assert.deepStrictEqual(moves(g, 'twin'), [], '被挤开不算移动');
});
test('狂野荒原：要落到我格子的人被放到身后，落点是 5 号石头照样绊倒', () => {
  const g = v1([['twin', 0], ['hugebaby', 6], ['egg', 20]], WILD);
  dice(g, [6]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'twin').tripped, true);
});
test('巨婴：身后一格就是出发格时原地不动（起哄怪因此触发）', () => {
  const g = v1([['twin', 5], ['hugebaby', 6], ['heckler', 20]]);
  dice(g, [1]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.deepStrictEqual(moves(g, 'twin'), []);
  assert.strictEqual(R(g, 'heckler').pos, 22);
});
test('巨婴：在 29 格挡不住冲线；走不到终点的会停在我身后', () => {
  let g = v1([['twin', 27], ['hugebaby', 29], ['egg', 0]]);
  dice(g, [2]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').pos, 28);
  g = v1([['twin', 27], ['hugebaby', 29], ['egg', 0]]);
  dice(g, [3]);
  turn(g, 'twin');
  assert.strictEqual(R(g, 'twin').finished, 1);
});
test('巨婴：催眠蛇把我拉过去，催眠蛇被挤到身后一格，再从那里主移动', () => {
  const g = v1([['hypnotist', 10], ['hugebaby', 3], ['twin', 0]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'hugebaby' });
  assert.strictEqual(R(g, 'hugebaby').pos, 10);
  assert.deepStrictEqual(ev(g, 'warp').filter((e) => e.rid === 'hypnotist').map((e) => [e.from, e.to]), [[10, 9]]);
  assert.strictEqual(R(g, 'hypnotist').pos, 11);
});
test('巨婴：后退落到我格子也不行，再往后放一格（被半人马踢回）', () => {
  const g = v1([['centaur', 4], ['hugebaby', 3], ['twin', 5], ['egg', 20]]);
  dice(g, [2]);
  turn(g, 'centaur');
  assert.strictEqual(R(g, 'twin').pos, 2);
  assert.strictEqual(R(g, 'hugebaby').pos, 3);
});
test('巨婴：被翻翻鱼换到有人的格子，把那人挤到身后', () => {
  const g = v1([['flipflop', 10], ['twin', 10], ['hugebaby', 3], ['egg', 0]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:hugebaby' });
  assert.strictEqual(R(g, 'flipflop').pos, 3);
  assert.strictEqual(R(g, 'hugebaby').pos, 10);
  assert.strictEqual(R(g, 'twin').pos, 9);
});

/* ======================= 翻翻鱼 flipflop ======================= */
// 可以不掷骰，改为和另一名运动员交换位置。注：交换是瞬移，不算移动。
test('翻翻鱼：不掷骰，和另一名运动员交换位置（不产生移动）', () => {
  const g = v1([['flipflop', 0], ['twin', 20], ['egg', 5]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.deepStrictEqual(pos(g), { flipflop: 20, twin: 0, egg: 5 });
  assert.strictEqual(ev(g, 'move').length, 0);
  assert.strictEqual(ev(g, 'swap').length, 1);
});
test('翻翻鱼：也可以照常掷骰', () => {
  const g = v1([['flipflop', 0], ['twin', 20]]);
  dice(g, [3]);
  turn(g, 'flipflop', { mode: 'roll' });
  assert.deepStrictEqual(pos(g), { flipflop: 3, twin: 20 });
});
test('翻翻鱼：同格的运动员不在可交换名单里', () => {
  const g = v1([['flipflop', 5], ['twin', 5], ['egg', 10]]);
  dice(g, [1]);
  let offered;
  turn(g, 'flipflop', { mode: (d) => { offered = optsOf(d); return 'roll'; } });
  assert.deepStrictEqual(offered, ['roll', 'flip:egg']);
});
test('翻翻鱼：可以和后面的人换（往回换）', () => {
  const g = v1([['flipflop', 10], ['twin', 2]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.deepStrictEqual(pos(g), { flipflop: 2, twin: 10 });
});
test('翻翻鱼：换过去照样结算落点——换到芭芭雅嘎所在格被绊倒', () => {
  const g = v1([['flipflop', 0], ['twin', 8], ['babayaga', 8]]);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.strictEqual(R(g, 'flipflop').pos, 8);
  assert.strictEqual(R(g, 'flipflop').tripped, true);
  assert.strictEqual(R(g, 'twin').pos, 0);
});
test('狂野荒原：换到 7 号箭头格，照样前进 3', () => {
  const g = v1([['flipflop', 0], ['twin', 7], ['egg', 20]], WILD);
  dice(g, []);
  turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.strictEqual(R(g, 'flipflop').pos, 10);
  assert.strictEqual(R(g, 'twin').pos, 0);
});
test('翻翻鱼：被绊倒的回合没有主移动，不能交换', () => {
  const g = v1([['flipflop', 0, { tripped: true }], ['twin', 10]]);
  dice(g, []);
  const asked = turn(g, 'flipflop', { mode: 'flip:twin' });
  assert.deepStrictEqual(asked, []);
  assert.deepStrictEqual(pos(g), { flipflop: 0, twin: 10 });
});
test('模仿猫复制翻翻鱼：也能换位', () => {
  const g = v1([['copycat', 0], ['flipflop', 10], ['twin', 5]]);
  dice(g, []);
  turn(g, 'copycat', { mode: 'flip:flipflop' });
  assert.deepStrictEqual(pos(g), { copycat: 10, flipflop: 0, twin: 5 });
});

/* ======================= 野兔 hare ======================= */
// 主移动 +2。回合开始时如果我独自领跑，就跳过主移动。
test('野兔：主移动 +2', () => {
  const g = v1([['hare', 0], ['twin', 10]]);
  dice(g, [3]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 5);
});
test('野兔：回合开始独自领跑，跳过主移动（不掷骰）', () => {
  const g = v1([['hare', 10], ['twin', 0]]);
  dice(g, []);
  const asked = turn(g, 'hare');
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(R(g, 'hare').pos, 10);
  assert.strictEqual(said(g, /独自领跑/).length, 1);
});
test('野兔：并列领跑不算独自，照常主移动', () => {
  const g = v1([['hare', 10], ['twin', 10]]);
  dice(g, [1]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 13);
});
test('野兔：跳过主移动等于原地不动，起哄怪前进 2', () => {
  const g = v1([['hare', 10], ['heckler', 5]]);
  dice(g, []);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'heckler').pos, 7);
});
test('野兔：+2 只加主移动，被啦啦队长推的 2 格不加', () => {
  const g = v1([['cheerleader', 10], ['hare', 0], ['twin', 5]]);
  dice(g, [1]);
  turn(g, 'cheerleader', { cheerleader: 'yes' });
  assert.strictEqual(R(g, 'hare').pos, 2);
});
test('野兔：+2 帮助冲线（27 格掷 1）', () => {
  const g = v1([['hare', 27], ['twin', 28]]);
  dice(g, [1]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').finished, 1);
});
test('[口径] 野兔：已冲线的人不算领跑，我在场上最前就是独自领跑', () => {
  const g = v1([['hare', 10], ['twin', 30, { finished: 1 }], ['egg', 5]]);
  dice(g, []);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 10);
});
test('[口径] 野兔：场上只剩我一人时不算独自领跑，照常主移动', () => {
  const g = v1([['hare', 10], ['twin', 30, { finished: 1 }]]);
  dice(g, [2]);
  turn(g, 'hare');
  assert.strictEqual(R(g, 'hare').pos, 14);
});

/* ======================= 催眠蛇 hypnotist ======================= */
// 主移动前，可以把一名运动员瞬移到我的格子。
test('催眠蛇：主移动前把一名运动员瞬移到我的格子，然后照常主移动', () => {
  const g = v1([['hypnotist', 5], ['twin', 20], ['egg', 0]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'twin' });
  assert.strictEqual(R(g, 'twin').pos, 5);
  assert.strictEqual(R(g, 'hypnotist').pos, 7);
  assert.deepStrictEqual(moves(g, 'twin'), [], '瞬移不是移动');
  assert(idx(g, (e) => e.t === 'warp' && e.rid === 'twin') < idx(g, (e) => e.t === 'roll'));
});
test('催眠蛇：可以不催眠', () => {
  const g = v1([['hypnotist', 5], ['twin', 20]]);
  dice(g, [2]);
  const asked = turn(g, 'hypnotist', { hypnotist: '_no' });
  assert(asked.includes('hypnotist'));
  assert.deepStrictEqual(pos(g), { hypnotist: 7, twin: 20 });
});
test('催眠蛇：已经和我同格的人不在名单里', () => {
  const g = v1([['hypnotist', 5], ['twin', 5], ['egg', 8]]);
  dice(g, [1]);
  let offered;
  turn(g, 'hypnotist', { hypnotist: (d) => { offered = optsOf(d); return '_no'; } });
  assert.deepStrictEqual(offered, ['egg', '_no']);
});
test('催眠蛇：把后面的人拉上来，瞬移越过香蕉不被绊倒', () => {
  const g = v1([['hypnotist', 10], ['twin', 2], ['banana', 5]]);
  dice(g, [1]);
  turn(g, 'hypnotist', { hypnotist: 'twin' });
  assert.strictEqual(R(g, 'twin').pos, 10);
  assert.strictEqual(R(g, 'twin').tripped, false);
});
test('催眠蛇：在起点也能把前面的人拉回起点', () => {
  const g = v1([['hypnotist', 0], ['twin', 10]]);
  dice(g, [2]);
  turn(g, 'hypnotist', { hypnotist: 'twin' });
  assert.deepStrictEqual(pos(g), { hypnotist: 2, twin: 0 });
});
test('[口径] 狂野荒原：被拉到星星格（13）上，被拉的人拿 1 分', () => {
  const g = v1([['hypnotist', 13], ['twin', 2]], WILD);
  dice(g, [1]);
  turn(g, 'hypnotist', { hypnotist: 'twin' });
  assert.strictEqual(g.score(1), 1);
  assert.strictEqual(g.score(0), 0);
  assert.strictEqual(R(g, 'hypnotist').pos, 14);
});
test('催眠蛇：拉来大嘴怪被它吃掉，淘汰后不再主移动', () => {
  const g = v1([['hypnotist', 10], ['mouth', 3], ['twin', 0]]);
  dice(g, []);
  turn(g, 'hypnotist', { hypnotist: 'mouth' });
  assert.strictEqual(R(g, 'hypnotist').out, true);
  assert.strictEqual(R(g, 'mouth').pos, 10);
  assert.strictEqual(ev(g, 'roll').length, 0);
});
test('[口径] 催眠蛇：被绊倒的回合没有主移动，也就不能催眠', () => {
  const g = v1([['hypnotist', 5, { tripped: true }], ['twin', 10]]);
  dice(g, []);
  const asked = turn(g, 'hypnotist', { hypnotist: 'twin' });
  assert(!asked.includes('hypnotist'));
  assert.strictEqual(R(g, 'twin').pos, 10);
});
