'use strict';
// 简单但像样的 AI：每类决策给一个合理的启发式
const { BY_ID } = require('./racers');
const { FINISH } = require('./tracks');

const tier = (id) => (BY_ID[id] ? BY_ID[id].tier : 5);

function decide(game, d, seat) {
  const rnd = game.rand;
  const opts = d.simul ? d.optionsBySeat[seat] : d.options;
  const vals = opts.map((o) => o.v);
  // 二代的决策会带上发起技能的运动员 rid（一名玩家可能控制多名运动员）
  const me = (d.rid && game.byRid(d.rid)) || game.racerOfSeat(seat);
  const has = (v) => vals.includes(v);
  // 运动员本身带的技能（不管眼下有没有被空指针屏蔽：挪了位置可能就恢复了）
  const innate = (o, k) => game.power(o) === k || !!(o.stack && o.stack.includes(k));
  // 从 pos 走 n 格实际停在哪（算上箭头）
  const landing = (pos, n) => { const sp = game.track && game.track.spaces[pos + n]; return pos + n + (sp && sp.type === 'arrow' ? sp.n : 0); };
  // 主移动常见的固定加成（传送带、野猪、伊卡洛斯、野兔、飙车魔、后爸）
  const lift = () => {
    if (!me) return 0;
    let n = 0;
    if (game.twistOn('conveyor')) n += 3;
    if (me.hogs) n += 2 * me.hogs;
    if (game.has(me, 'icarus')) n += 3;
    if (game.has(me, 'hare')) n += 2;
    if (game.has(me, 'speeddemon')) n += game.score(me.seat);
    if (game.holders('stepdad').some((sd) => sd !== me && game.stepchild(sd) === me)) n += 2;
    return n;
  };
  // 水晶球：主移动达到 6 格直接淘汰。这次主移动的点数最多能到几还不出局（没有水晶球时不设上限）
  const scryCap = () => (!me || !game.twistOn('scrying') ? Infinity : 5 - lift());
  // 停在 pos 实际相当于在哪：箭头、漩涡照走；石头会摔一跤（按少走 3 格算）；撞头虫区后退 5；冲线最好
  const spot = (pos) => {
    if (pos >= FINISH) return FINISH + 1;
    if (pos <= 0) return 0;
    const sp = game.track && game.track.spaces[pos];
    let at = pos;
    if (sp && sp.type === 'arrow') at = pos + sp.n;
    else if (sp && sp.type === 'whirl') at = sp.to;
    else if (sp && sp.type === 'rock') at = pos - 3;
    else if (sp && sp.type === 'star') at = pos + 0.5;
    if (game.twistOn('bonkbug') && at >= FINISH - 2 && at < FINISH) at -= 5;
    return at;
  };

  switch (d.kind) {
    case 'draft':
    case 'egg': {
      // 按强度挑，带点随机性
      return vals.slice().sort((a, b) => tier(b) + rnd() * 2.5 - (tier(a) + rnd() * 2.5))[0];
    }
    case 'twin':
      return vals.filter((v) => v !== '_skip').sort((a, b) => tier(b) - tier(a))[0] || '_skip';
    case 'copycat': {
      // 主谋的预言我已经做过了，再抄它没用
      const worth = (v) => { const pw = game.byRid(v)?.power; return tier(pw) - (pw === 'mastermind' && me && me.mmDone ? 4 : 0); };
      return vals.slice().sort((a, b) => worth(b) - worth(a))[0];
    }
    case 'pickRacer': {
      // 返场王越早派越值（之后每场都多一名运动员，第 4 场派就白费了）
      if (vals.includes('rerunner') && game.raceNo < 4) return 'rerunner';
      // 后面的比赛分更高：先派弱的，强的留到后面
      const sorted = vals.slice().sort((a, b) => tier(a) - tier(b));
      return rnd() < 0.2 ? sorted[Math.floor(rnd() * sorted.length)] : sorted[0];
    }
    case 'roll':
      return vals[0];
    case 'mode': {
      const pos = me ? me.pos : 0;
      const cap = scryCap();
      // 定步数的走法看实际落点（石头、漩涡、箭头、撞头虫）
      const fixed = (n) => spot(pos + n + lift()) - pos;
      let best = 'roll', bestGain = 3.5;
      if (has('cheat')) { best = 'cheat'; bestGain = 4.2; }
      if (has('legs') && cap >= 5 && fixed(5) > bestGain) { best = 'legs'; bestGain = fixed(5); }
      if (has('mole') && cap >= 6 && fixed(6) > bestGain) { best = 'mole'; bestGain = fixed(6); }
      // 翻翻鱼：先挑换过去实际位置最远的，明显更好才换
      let flip = null, flipGain = -Infinity;
      for (const v of vals) {
        if (!v.startsWith('flip:')) continue;
        const gain = spot(game.byRid(v.slice(5)).pos) - pos;
        if (gain > flipGain) { flip = v; flipGain = gain; }
      }
      return flip && flipGain > bestGain + 1 ? flip : best;
    }
    case 'genius':
      return String(1 + Math.floor(rnd() * 6));
    case 'reroll': {
      const roll = d.roll;
      const need = me ? FINISH - me.pos : 99;
      // 伊卡洛斯掷出 6、水晶球下加上加成到 6，都是直接出局（冲线也救不了）：能重掷就重掷
      const again = vals.find((v) => v !== 'keep');
      if (again && ((me && game.has(me, 'icarus') && roll === 6) || roll > scryCap())) return again;
      // 西西弗斯掷出 6 要回起点还丢分：除非手上就是 6，否则别冒险重掷
      if (me && game.has(me, 'sisyphus')) return roll === 6 && again ? again : 'keep';
      const stickler = me && game.holders('stickler').some((s) => s !== me);
      if (stickler && need <= 6) return roll === need ? 'keep' : (vals.find((v) => v !== 'keep') || 'keep');
      if (roll >= need) return 'keep';
      if (roll <= 2 && has('magic')) return 'magic';
      if (roll <= 2 && has('dice')) return 'dice';
      if (roll === 3 && has('magic') && rnd() < 0.5) return 'magic';
      return 'keep';
    }
    case 'alchemist': {
      // 看实际落点再决定要不要把 1/2 变成 4（4 可能正好踩到退回去的箭头）
      const m = d.title && d.title.match(/把 (\d+) 变成 4/);
      const roll = m ? Number(m[1]) : 1;
      if (!me) return 'yes';
      if (4 > scryCap()) return 'no';
      const at = (n) => spot(me.pos + n + lift());
      return at(4) >= at(roll) ? 'yes' : 'no';
    }
    case 'rocket': {
      const need = me ? FINISH - me.pos : 99;
      const base = d.title.match(/把 (\d+) 翻倍/);
      const b = base ? Number(base[1]) : 3;
      if (b * 2 > scryCap()) return 'no';
      if (b * 2 >= need && b < need) return 'yes';
      return b >= 3 ? 'yes' : 'no';
    }
    case 'cheerleader': {
      // 最后一名先各走 2 格（我也垫底就跟着走）：大嘴怪要是停到我那格，可能把我吃掉，稳妥起见不喊
      if (!me) return 'yes';
      const lasts = game.lasts();
      const mine = lasts.includes(me) ? landing(me.pos, 2) : me.pos;
      return lasts.some((l) => l !== me && landing(l.pos, 2) === mine && innate(l, 'mouth')) ? 'no' : 'yes';
    }
    case 'hypnotist': {
      // 把跑得最快的对手拉回来（只拉在我前面的）；大嘴怪、芭芭雅嘎停到我格子上会吃掉/绊倒我，不拉。
      // 模仿猫随时抄领跑者的技能，场上有这两种技能就也别拉它
      const harmful = (o) => innate(o, 'mouth') || innate(o, 'babayaga');
      const risky = (o) => harmful(o) || (o.power === 'copycat' && game.onTrack().some((x) => x.power !== 'copycat' && harmful(x)));
      const cands = vals.filter((v) => v !== '_no').map((v) => game.byRid(v)).filter((o) => o && me && o.pos > me.pos + 1 && !risky(o));
      if (!cands.length) return '_no';
      cands.sort((a, b) => b.pos - a.pos);
      return cands[0].rid;
    }
    case 'thirdwheel': {
      const best = vals.filter((v) => v !== '_no').map((v) => Number(v.slice(1))).sort((a, b) => b - a)[0];
      return me && best != null && best >= me.pos + 3 ? `s${best}` : '_no';
    }
    case 'suckerfish': {
      if (d.target == null) return 'yes';
      return me && d.target > me.pos ? 'yes' : 'no';
    }
    case 'duel': {
      // 前进 2 格正好踩到退回本格的箭头：谁赢都会回到原地再决斗，没完没了（和大嘴怪这样决斗还会被它吃掉）
      if (me && landing(me.pos, 2) === me.pos) return '_no';
      return vals.find((v) => v !== '_no') || '_no';
    }
    case 'mastermind': {
      // 预言当前场上最强的运动员（包括自己）
      const on = game.onTrack();
      on.sort((a, b) => tier(b.power) + rnd() - (tier(a.power) + rnd()));
      return on.length ? on[0].rid : vals[0];
    }
    /* ---------- 二代 ---------- */
    case 'soulmate': {
      // 挑跑得最快（位置最靠前、强度最高）的对手做伴
      const cands = vals.map((v) => game.byRid(v)).filter(Boolean);
      cands.sort((a, b) => (tier(b.power) + b.pos * 0.3 + rnd()) - (tier(a.power) + a.pos * 0.3 + rnd()));
      return cands.length ? cands[0].rid : vals[0];
    }
    case 'understudy':
      return vals.slice().sort((a, b) => tier(game.byRid(b)?.power) + rnd() - tier(game.byRid(a)?.power) - rnd())[0];
    case 'diva':
      return vals[0];
    case 'kingtripper': {
      const foe = vals.find((v) => v !== '_no' && game.byRid(v) && game.byRid(v).seat !== seat);
      return foe || '_no';
    }
    case 'kraken': {
      if (!me) return 'no';
      const gain = game.others(me).reduce((s, o) => s + (o.pos - me.pos), 0);
      return gain >= 3 ? 'yes' : 'no';
    }
    case 'tail':
      // 贴过去的格子是退回去的漩涡、箭头或石头就算了
      return !me || d.target == null || spot(d.target) > me.pos ? 'yes' : 'no';
    case 'cheatahSet': {
      // 在不出局的点数里挑落点好的，带点随机免得被猜中（能冲线的点数一样好，随机挑）
      const cap = Math.min(6, scryCap());
      const pool = cap < 6 ? [1, 2, 3, 4, 5].filter((n) => n <= Math.max(1, cap)) : [3, 4, 5, 6];
      const pos = me ? me.pos : 0;
      const score = (n) => (me ? spot(pos + n + lift()) : n) + rnd() * 1.5;
      return String(pool.map((n) => [n, score(n)]).sort((a, b) => b[1] - a[1])[0][0]);
    }
    case 'cheatahGuess':
      return String(rnd() < 0.8 ? 4 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3));
    case 'critic': {
      const target = d.target && game.byRid(d.target);
      if (!target || target.seat === seat) return 'no';
      // 它这一步本来是后退（糊涂狗没垫底、掷 3 碰上捣蛋鬼），重掷反而帮了它
      let back = game.has(target, 'blunderdog') && !game.lasts().includes(target);
      if (d.roll === 3) for (const sb of game.holders('saboteur')) if (sb !== target) back = !back;
      return !back && (d.roll || 0) >= 4 ? 'yes' : 'no';
    }
    case 'nemesis':
      return 'yes';
    case 'showoff': {
      // 水晶球下再掷很容易累加过 6 出局，停下最稳
      if (scryCap() < Infinity) return 'stop';
      if (me) {
        const at = me.pos + (d.sum || d.roll || 0) + lift();
        if (at >= FINISH) return 'stop';
        // 停下来反而吃亏（撞头虫、退回去的箭头/漩涡）：再掷失败也只是不动
        if (spot(at) <= me.pos) return 'more';
      }
      return (d.roll || 6) <= 2 ? 'more' : 'stop';
    }
    case 'diceguy': {
      let nums = vals.map(Number);
      const need = me ? FINISH - me.pos : 99;
      // 水晶球：只在不出局的点数里挑；全都会出局就挑最小的
      const cap = scryCap();
      nums = nums.some((v) => v <= cap) ? nums.filter((v) => v <= cap) : [Math.min(...nums)];
      if (nums.includes(need)) return String(need);
      if (!me) return String(Math.max(...nums));
      // 按实际落点挑（石头、漩涡、撞头虫），一样好就挑大的
      const at = (v) => spot(me.pos + v + lift());
      return String(nums.sort((a, b) => at(b) - at(a) || b - a)[0]);
    }
    case 'athleteWarp': {
      // 瞬移到实际位置最远的那格（落到漩涡口会被传走）
      const cands = vals.map((v) => game.byRid(v)).filter(Boolean);
      cands.sort((a, b) => spot(b.pos) - spot(a.pos));
      return cands.length ? cands[0].rid : vals[0];
    }
    case 'switcharoo': {
      if (!me) return '_no';
      const better = vals.filter((v) => v !== '_no').map((v) => game.byRid(v)).filter((o) => o && o.pos > me.pos);
      return better.length ? better[0].rid : '_no';
    }
    case 'swapmeet': {
      const swap = opts.find((o) => o.v === 'swap');
      const cur = game.racers.find((r) => r.seat === seat && !r.finished && !r.out);
      if (!swap || !swap.card) return 'keep';
      return tier(swap.card) > tier(cur ? cur.power : null) + 1 ? 'swap' : 'keep';
    }
    default:
      return vals[0];
  }
}

module.exports = { decide };
