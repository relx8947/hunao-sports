'use strict';
// 简单但像样的 AI：每类决策给一个合理的启发式
const { BY_ID } = require('./racers');
const { FINISH } = require('./tracks');

const tier = (id) => (BY_ID[id] ? BY_ID[id].tier : 5);

function decide(game, d, seat) {
  const rnd = game.rand;
  const opts = d.simul ? d.optionsBySeat[seat] : d.options;
  const vals = opts.map((o) => o.v);
  const me = game.racerOfSeat(seat);
  const has = (v) => vals.includes(v);

  switch (d.kind) {
    case 'draft':
    case 'egg': {
      // 按强度挑，带点随机性
      return vals.slice().sort((a, b) => tier(b) + rnd() * 2.5 - (tier(a) + rnd() * 2.5))[0];
    }
    case 'twin':
      return vals.filter((v) => v !== '_skip').sort((a, b) => tier(b) - tier(a))[0] || '_skip';
    case 'copycat':
      return vals.slice().sort((a, b) => tier(game.byRid(b)?.power) - tier(game.byRid(a)?.power))[0];
    case 'pickRacer': {
      // 后面的比赛分更高：先派弱的，强的留到后面
      const sorted = vals.slice().sort((a, b) => tier(a) - tier(b));
      return rnd() < 0.2 ? sorted[Math.floor(rnd() * sorted.length)] : sorted[0];
    }
    case 'roll':
      return vals[0];
    case 'mode': {
      const pos = me ? me.pos : 0;
      let best = 'roll', bestGain = 3.5;
      if (has('legs')) { best = 'legs'; bestGain = 5; }
      for (const v of vals) {
        if (!v.startsWith('flip:')) continue;
        const o = game.byRid(v.slice(5));
        const gain = o.pos - pos;
        if (gain > bestGain + 1) { best = v; bestGain = gain; }
      }
      return best;
    }
    case 'genius':
      return String(1 + Math.floor(rnd() * 6));
    case 'reroll': {
      const roll = d.roll;
      const need = me ? FINISH - me.pos : 99;
      const stickler = me && game.holders('stickler').some((s) => s !== me);
      if (stickler && need <= 6) return roll === need ? 'keep' : (vals.find((v) => v !== 'keep') || 'keep');
      if (roll >= need) return 'keep';
      if (roll <= 2 && has('magic')) return 'magic';
      if (roll <= 2 && has('dice')) return 'dice';
      if (roll === 3 && has('magic') && rnd() < 0.5) return 'magic';
      return 'keep';
    }
    case 'alchemist':
      return 'yes';
    case 'rocket': {
      const need = me ? FINISH - me.pos : 99;
      const base = d.title.match(/把 (\d+) 翻倍/);
      const b = base ? Number(base[1]) : 3;
      if (b * 2 >= need && b < need) return 'yes';
      return b >= 3 ? 'yes' : 'no';
    }
    case 'cheerleader': {
      // 如果自己就是最后一名，或者最后一名不是对手的领先威胁，就喊
      return 'yes';
    }
    case 'hypnotist': {
      // 把跑得最快的对手拉回来（只拉在我前面的）
      const cands = vals.filter((v) => v !== '_no').map((v) => game.byRid(v)).filter((o) => o && me && o.pos > me.pos + 1);
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
    case 'duel':
      return vals.find((v) => v !== '_no') || '_no';
    case 'mastermind': {
      // 预言当前场上最强的运动员（包括自己）
      const on = game.onTrack();
      on.sort((a, b) => tier(b.power) + rnd() - (tier(a.power) + rnd()));
      return on.length ? on[0].rid : vals[0];
    }
    default:
      return vals[0];
  }
}

module.exports = { decide };
