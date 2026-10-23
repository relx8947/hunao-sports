'use strict';
// 胡闹运动会 · 对局引擎
// 用生成器串起整局流程：需要玩家决策时 yield 一个决策对象，外部 answer() 后继续。
// 每个动作都会往 events 里推送事件，前端按序播放动画。
const { BY_ID, RACER_IDS, BEFORE_RACE } = require('./racers');
const { FINISH, GOLD, SILVER, TRACKS, SCHEDULE } = require('./tracks');

class RaceEnd extends Error {}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PW_PER_TURN = 30; // 同一技能每回合生效次数兜底上限
const PW_BUDGET = 160; // 每回合技能生效总预算，兜底防止连锁爆炸
const MAX_TURNS = 240; // 单场回合上限兜底

class Game {
  constructor({ players, seed = Date.now() }) {
    if (players.length < 2 || players.length > 6) throw new Error('人数需在 2-6 之间');
    this.rand = mulberry32(seed);
    this.players = players.map((p, i) => ({
      seat: i, name: p.name, ai: !!p.ai, hand: [], used: [], chips: [],
    }));
    this.n = this.players.length;
    this.deck = this.shuffle(RACER_IDS.slice());
    this.faceUp = [];
    this.phase = 'draft';
    this.raceNo = 0; // 1..4
    this.trackKey = SCHEDULE[0];
    this.racers = [];
    this.winners = []; // 往届冠军的运动员卡 id
    this.firstSeat = 0;
    this.curSeat = null;
    this.events = [];
    this.evSeq = 0;
    this.log = [];
    this.pending = null;
    this.decSeq = 0;
    this.results = [];
    this.gen = this.main();
  }

  /* ================= 驱动 ================= */
  start() { this.advance(undefined); }

  advance(val) {
    let r;
    try {
      r = this.gen.next(val);
    } catch (e) {
      this.pending = null;
      throw e;
    }
    if (r.done) { this.pending = null; return; }
    const d = r.value;
    d.id = ++this.decSeq;
    if (d.simul) d.answers = {};
    this.pending = d;
  }

  // 提交决策；返回错误字符串或 null
  answer(seat, decisionId, value) {
    const d = this.pending;
    if (!d) return '当前没有待决策项';
    if (decisionId != null && decisionId !== d.id) return '决策已过期';
    if (d.simul) {
      if (!d.seats.includes(seat)) return '不需要你决策';
      if (d.answers[seat] !== undefined) return '你已经选好了';
      const opts = d.optionsBySeat[seat];
      if (!opts.some((o) => o.v === value)) return '无效选项';
      d.answers[seat] = value;
      this.emit({ t: 'picked', seat });
      if (d.seats.every((s) => d.answers[s] !== undefined)) this.advance(d.answers);
      return null;
    }
    if (d.seat !== seat) return '还没轮到你';
    if (!d.options.some((o) => o.v === value)) return '无效选项';
    this.advance(value);
    return null;
  }

  // 取出并清空待播放事件
  drain() { const e = this.events; this.events = []; return e; }

  emit(ev) {
    // 事件可能包含 results/champions 等内部数组，消费者不得反向改写对局。
    ev = structuredClone(ev);
    ev.seq = ++this.evSeq;
    this.events.push(ev);
    if (ev.text) {
      this.log.push({ seq: ev.seq, text: ev.text, race: this.raceNo });
      if (this.log.length > 300) this.log.shift();
    }
  }

  ask(seat, kind, title, options, extra = {}) {
    return { seat, kind, title, options, ...extra };
  }

  /* ================= 工具 ================= */
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  d6() { return 1 + Math.floor(this.rand() * 6); }
  get track() { return TRACKS[this.trackKey]; }
  nm(r) { return `${this.players[r.seat].name}的${BY_ID[r.rid].name}`; }
  active(r) { return !!r && !r.finished && !r.out; }
  onTrack() { return this.racers.filter((r) => this.active(r)); }
  others(r) { return this.onTrack().filter((o) => o !== r); }
  at(pos, except) { return this.onTrack().filter((o) => o.pos === pos && o !== except); }
  racerOfSeat(seat) { return this.racers.find((r) => r.seat === seat); }
  byRid(rid) { return this.racers.find((r) => r.rid === rid); }
  seatOrder(seat) { return (seat - (this.curSeat ?? 0) + this.n) % this.n; }
  sortByTurn(list) { return list.slice().sort((a, b) => this.seatOrder(a.seat) - this.seatOrder(b.seat)); }

  leaders() {
    const on = this.onTrack();
    if (!on.length) return [];
    const m = Math.max(...on.map((r) => r.pos));
    return on.filter((r) => r.pos === m);
  }
  lasts() {
    const on = this.onTrack();
    if (!on.length) return [];
    const m = Math.min(...on.map((r) => r.pos));
    return on.filter((r) => r.pos === m);
  }

  copyCandidates(r) {
    return this.leaders().filter((x) => x !== r && x.power !== 'copycat' && !BEFORE_RACE.has(x.power));
  }
  copyKey(candidates) { return candidates.map((r) => `${r.rid}:${r.power}`).sort().join('|'); }

  // 查询不修改状态，也不替玩家选择；新并列局面在生成器边界处理。
  power(r) {
    if (!this.active(r)) return null;
    if (r.power !== 'copycat') return r.power;
    const candidates = this.copyCandidates(r);
    if (candidates.length === 1) return candidates[0].power;
    const picked = r.copyChoices?.[this.copyKey(candidates)];
    return candidates.find((x) => x.rid === picked)?.power || null;
  }

  *refreshCopies() {
    for (const r of this.sortByTurn(this.onTrack().filter((o) => o.power === 'copycat'))) {
      const candidates = this.copyCandidates(r);
      const key = this.copyKey(candidates);
      let picked = candidates.length === 1 ? candidates[0].rid : r.copyChoices?.[key];
      if (candidates.length > 1 && !candidates.some((o) => o.rid === picked)) {
        picked = yield this.ask(r.seat, 'copycat', '模仿猫：并列领跑，复制谁的技能？', candidates.map((o) => ({
          v: o.rid, label: `${this.nm(o)} · ${BY_ID[o.power].skill}`,
        })));
        // 当前回合连锁中，同一批领跑者再次出现时沿用选择；下回合可重选。
        r.copyChoices ||= Object.create(null);
        r.copyChoices[key] = picked;
      }
      const eff = candidates.find((o) => o.rid === picked)?.power || null;
      if (r.copyEff !== eff) {
        r.copyEff = eff;
        this.emit({ t: 'copy', rid: r.rid, target: picked || null, power: eff,
          text: eff ? `${this.nm(r)} 复制了「${BY_ID[eff].skill}」` : `${this.nm(r)} 当前没有可复制的领跑技能` });
        // 先保存选择和有效技能，再处理同格排斥；嵌套刷新不会重复询问同一局面。
        if (eff === 'hugebaby') yield* this.shoveByBaby(r);
      }
    }
  }
  has(r, key) { return this.power(r) === key; }
  holders(key) { return this.sortByTurn(this.onTrack().filter((r) => this.power(r) === key)); }

  score(seat) { return this.players[seat].chips.reduce((s, c) => s + c.v, 0); }
  giveChip(seat, kind, v, why) {
    this.players[seat].chips.push({ kind, v, race: this.raceNo });
    this.emit({ t: 'chip', seat, kind, v, text: `${this.players[seat].name} 获得${kind === 'gold' ? '金杯' : kind === 'silver' ? '银牌' : '铜牌'} ${v} 分${why ? `（${why}）` : ''}` });
  }

  /* ================= 主流程 ================= */
  *main() {
    yield* this.draft();
    for (let i = 0; i < 4; i++) {
      this.raceNo = i + 1;
      this.trackKey = SCHEDULE[i];
      yield* this.runRace(i);
    }
    this.phase = 'over';
    this.curSeat = null;
    const scores = this.players.map((p) => ({ seat: p.seat, score: this.score(p.seat) }));
    const top = Math.max(...scores.map((s) => s.score));
    this.champions = scores.filter((s) => s.score === top).map((s) => s.seat);
    this.emit({ t: 'gameOver', scores, champions: this.champions, text: `比赛结束！冠军：${this.champions.map((s) => this.players[s].name).join('、')}` });
  }

  rollOff(reason) {
    let cands = this.players.map((p) => p.seat);
    for (let guard = 0; guard < 20; guard++) {
      const rolls = cands.map((s) => ({ seat: s, v: this.d6() }));
      this.emit({ t: 'rollOff', reason, rolls });
      const m = Math.max(...rolls.map((r) => r.v));
      const top = rolls.filter((r) => r.v === m).map((r) => r.seat);
      if (top.length === 1) return top[0];
      cands = top;
    }
    return cands[0];
  }

  *draft() {
    this.phase = 'draft';
    const start = this.rollOff('draft');
    this.emit({ t: 'draftStart', seat: start, text: `${this.players[start].name} 掷骰最大，第一个选人` });
    for (let round = 0; round < 2; round++) {
      this.faceUp = this.deck.splice(0, this.n * 2);
      const first = (start + round) % this.n;
      const fwd = Array.from({ length: this.n }, (_, k) => (first + k) % this.n);
      const order = fwd.concat(fwd.slice().reverse());
      this.emit({ t: 'faceUp', cards: this.faceUp.slice(), round, order });
      this.draftOrder = order;
      this.draftRound = round;
      for (let k = 0; k < order.length; k++) {
        const seat = order[k];
        this.draftIdx = k;
        this.curSeat = seat;
        const v = yield this.ask(seat, 'draft', '选一名运动员加入你的队伍', this.faceUp.map((id) => ({ v: id, label: BY_ID[id].name })), { pickNo: round * this.n * 2 + k + 1 });
        this.faceUp = this.faceUp.filter((id) => id !== v);
        this.players[seat].hand.push(v);
        this.emit({ t: 'drafted', seat, rid: v, text: `${this.players[seat].name} 选了 ${BY_ID[v].name}` });
      }
    }
    this.faceUp = [];
    this.firstSeat = this.rollOff('race');
    this.emit({ t: 'firstPlayer', seat: this.firstSeat, text: `${this.players[this.firstSeat].name} 掷骰最大，第一场先手` });
  }

  *runRace(idx) {
    this.phase = 'pick';
    this.curSeat = null;
    this.racers = [];
    const seats = this.players.map((p) => p.seat);
    const optionsBySeat = {};
    for (const s of seats) {
      optionsBySeat[s] = this.players[s].hand.filter((id) => !this.players[s].used.includes(id)).map((id) => ({ v: id, label: BY_ID[id].name }));
    }
    this.emit({ t: 'raceIntro', race: this.raceNo, track: this.trackKey, gold: GOLD[idx], silver: SILVER[idx], text: `第 ${this.raceNo} 场 · ${this.track.name}（金 ${GOLD[idx]} 分 / 银 ${SILVER[idx]} 分）` });
    const picks = yield { simul: true, kind: 'pickRacer', title: `第 ${this.raceNo} 场派谁上场？`, seats, optionsBySeat };
    this.phase = 'race';
    this.finishCount = 0;
    this.outOrder = [];
    this.turns = 0;
    this.raceEndReason = 'finished';
    for (const s of seats) {
      const rid = picks[s];
      this.players[s].used.push(rid);
      this.racers.push({ rid, seat: s, pos: 0, power: rid, tripped: false, finished: 0, out: false });
    }
    this.emit({ t: 'reveal', picks: seats.map((s) => ({ seat: s, rid: picks[s] })), text: `上场：${seats.map((s) => `${this.players[s].name}·${BY_ID[picks[s]].name}`).join('，')}` });

    let seat = this.firstSeat;
    let isExtra = false;
    this.skipperNext = null;
    this.extraTurn = false;
    this.resetTurnCounters();
    try {
      yield* this.beforeRace();
      // 额外回合也是完整的新回合，必须经过同一调度循环与全部安全检查。
      for (let guard = 0; guard < 400; guard++) {
        const r = this.racerOfSeat(seat);
        this.extraTurn = false;
        if (this.active(r)) {
          if (isExtra) this.emit({ t: 'extraTurn', rid: r.rid, text: `${this.nm(r)} 再来一回合！` });
          yield* this.takeTurn(r);
        }
        this.checkEnd();
        if (this.turns >= MAX_TURNS) {
          this.raceEndReason = 'turn-limit';
          this.emit({ t: 'info', text: '本场达到回合上限，保留已获得分数并进入结算' });
          throw new RaceEnd();
        }
        const extra = this.extraTurn && this.active(r);
        this.extraTurn = false;
        isExtra = false;
        // 规则书 Genius 注释：猜中1时，后触发的 Skipper 抢走下一回合。
        if (this.skipperNext != null) { seat = this.skipperNext; this.skipperNext = null; }
        else if (extra) isExtra = true;
        else seat = (seat + 1) % this.n;
      }
      this.raceEndReason = 'loop-limit';
      this.emit({ t: 'info', text: '本场达到循环保护上限，保留已获得分数并进入结算' });
      throw new RaceEnd();
    } catch (e) {
      if (!(e instanceof RaceEnd)) throw e;
    }
    // 比赛在技能链或回合上限处结束时，不能把旧场的下一回合带入下一场。
    this.extraTurn = false;
    this.skipperNext = null;
    this.afterRace(idx);
  }

  checkEnd() {
    if (this.finishCount >= 2 || this.onTrack().length === 0) throw new RaceEnd();
  }

  *beforeRace() {
    this.curSeat = this.firstSeat;
    for (const r of this.sortByTurn(this.racers)) yield* this.applyBeforeRace(r, r.power, 0);
    yield* this.refreshCopies();
  }

  // Egg / Twin 拿到的技能若也是「赛前」技能，同样生效
  *applyBeforeRace(r, key, depth) {
    if (depth > 3) return;
    if (key === 'sisyphus') {
      for (let i = 0; i < 4; i++) this.players[r.seat].chips.push({ kind: 'bronze', v: 1, race: this.raceNo, sis: true });
      this.emit({ t: 'chip', seat: r.seat, kind: 'bronze', v: 4, text: `${this.nm(r)} 赛前拿到 4 分` });
      yield* this.pw(r, 'sisyphus');
    } else if (key === 'egg') {
      const draw = this.deck.splice(0, 3);
      if (!draw.length) return;
      const v = yield this.ask(r.seat, 'egg', '神秘蛋：从 3 名运动员中挑一个技能', draw.map((id) => ({ v: id, label: BY_ID[id].name })));
      this.deck.push(...draw.filter((id) => id !== v));
      r.power = v;
      r.via = v;
      this.emit({ t: 'transform', rid: r.rid, power: v, text: `${this.nm(r)} 孵出了 ${BY_ID[v].name} 的技能「${BY_ID[v].skill}」` });
      yield* this.pw(r, 'egg');
      yield* this.applyBeforeRace(r, v, depth + 1);
    } else if (key === 'twin') {
      const opts = [...new Set(this.winners)].filter((id) => id !== 'twin');
      if (!opts.length) {
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 还没有往届冠军可以复制` });
        return;
      }
      const v = yield this.ask(r.seat, 'twin', '双胞胎：复制哪位往届冠军的技能？', opts.map((id) => ({ v: id, label: BY_ID[id].name })).concat([{ v: '_skip', label: '不复制' }]));
      if (v === '_skip') return;
      r.power = v;
      r.via = v;
      this.emit({ t: 'transform', rid: r.rid, power: v, text: `${this.nm(r)} 化身 ${BY_ID[v].name}，获得「${BY_ID[v].skill}」` });
      yield* this.pw(r, 'twin');
      yield* this.applyBeforeRace(r, v, depth + 1);
    }
  }

  afterRace(idx) {
    this.phase = 'between';
    const placed = this.racers.filter((r) => r.finished).sort((a, b) => a.finished - b.finished);
    const first = placed.find((r) => r.finished === 1);
    if (first) this.winners.push(first.rid);
    // 下一场先手：落后最多（或最先被淘汰）的运动员
    let next;
    if (this.outOrder.length) next = this.outOrder[0];
    else {
      const rest = this.racers.filter((r) => !r.finished);
      if (rest.length) {
        const m = Math.min(...rest.map((r) => r.pos));
        next = this.sortByTurn(rest.filter((r) => r.pos === m))[0];
      } else next = placed[placed.length - 1];
    }
    if (next) this.firstSeat = next.seat;
    const res = {
      race: this.raceNo, track: this.trackKey, turns: this.turns, reason: this.raceEndReason,
      standings: this.racers.map((r) => ({ seat: r.seat, rid: r.rid, pos: r.pos, finished: r.finished, out: r.out, bonus: r.bonusSecond || false })),
      scores: this.players.map((p) => this.score(p.seat)),
    };
    this.results.push(res);
    this.emit({ t: 'raceEnd', ...res, nextFirst: this.firstSeat, text: `第 ${this.raceNo} 场结束` });
    this.curSeat = null;
  }

  /* ================= 技能生效 & 蹭蹭狗 ================= */
  *pw(r, key, times = 1) {
    yield* this.refreshCopies();
    for (let i = 0; i < times; i++) {
      const k = `${r.rid}:${key}`;
      const c = (this.pwCount.get(k) || 0) + 1;
      this.pwCount.set(k, c);
      // 规则 8：同一技能在完全相同的局面下再次触发 = 进入无限循环，走完一遍就停
      const sig = `${k}|${this.racers.map((o) => `${o.pos}${o.tripped ? 't' : ''}${o.finished || o.out ? 'x' : ''}`).join(',')}`;
      const looped = this.pwSeen.has(sig);
      this.pwSeen.add(sig);
      if (c > PW_PER_TURN || ++this.pwTotal > PW_BUDGET) return;
      this.emit({ t: 'power', rid: r.rid, key });
      const scoochers = this.holders('scoocher').filter((s) => s !== r);
      if (looped && scoochers.length) {
        if (!this.loopNoted) { this.loopNoted = true; this.emit({ t: 'info', text: '触发了无限循环，按规则走完一遍就停' }); }
        return;
      }
      // 其他运动员的技能每生效一次，蹭蹭狗前进 1
      for (const s of scoochers) {
        if (s === r) continue;
        this.emit({ t: 'info', rid: s.rid, text: `${this.nm(s)} 蹭了一格` });
        yield* this.move(s, 1, 'power');
        yield* this.pw(s, 'scoocher');
      }
    }
  }

  /* ================= 状态变化 ================= */
  trip(r, why) {
    if (!this.active(r)) return;
    r.tripped = true;
    this.emit({ t: 'trip', rid: r.rid, text: `${this.nm(r)} 被绊倒了${why ? `（${why}）` : ''}，下回合跳过主移动` });
  }

  *eliminate(r, by) {
    if (!this.active(r)) return;
    r.out = true;
    this.outOrder.push(r);
    this.emit({ t: 'out', rid: r.rid, by: by?.rid, text: `${this.nm(r)} 被${by ? this.nm(by) : ''}一口吞掉，淘汰出本场！` });
    this.checkEnd();
  }

  finish(r) {
    if (r.finished) return;
    // 主谋预言检查（在冲线者技能失效前完成）
    let mmEnd = null;
    if (this.finishCount === 0) {
      for (const m of this.onTrack()) {
        if (this.power(m) === 'mastermind' && m.mmPredict === r.rid) { mmEnd = m; break; }
      }
    }
    const place = ++this.finishCount;
    r.finished = place;
    const idx = this.raceNo - 1;
    this.emit({ t: 'finish', rid: r.rid, place, text: `${this.nm(r)} 冲线，第 ${place} 名！` });
    this.giveChip(r.seat, place === 1 ? 'gold' : 'silver', place === 1 ? GOLD[idx] : SILVER[idx], `第 ${this.raceNo} 场第 ${place} 名`);
    if (mmEnd) {
      this.emit({ t: 'power', rid: mmEnd.rid, key: 'mastermind' });
      this.finishCount = 2;
      if (mmEnd === r) {
        r.bonusSecond = true;
        this.emit({ t: 'finish', rid: r.rid, place: 2, text: `${this.nm(r)} 预言了自己夺冠，第 2 名也归他！` });
      } else {
        mmEnd.finished = 2;
        this.emit({ t: 'finish', rid: mmEnd.rid, place: 2, text: `${this.nm(mmEnd)} 预言成真，比赛立刻结束，拿下第 2 名！` });
      }
      this.giveChip(mmEnd.seat, 'silver', SILVER[idx], '主谋预言成真');
    }
    if (this.finishCount >= 2) throw new RaceEnd();
  }

  // 巨婴：落点不能和巨婴同格（起点除外），改放到巨婴身后一格
  babyAdjust(r, pos) {
    for (let g = 0; g < 6; g++) {
      if (pos <= 0 || pos >= FINISH) return pos;
      const baby = this.holders('hugebaby').find((b) => b !== r && b.pos === pos);
      if (!baby) return pos;
      pos = pos - 1;
      this.babyPushed = baby;
    }
    return pos;
  }

  // 普通巨婴停格和模仿猫切换技能共用；挤人不算移动，但校正后必须结算停格。
  *shoveByBaby(r) {
    if (!this.active(r) || !this.has(r, 'hugebaby') || r.pos <= 0 || r.pos >= FINISH) return;
    const from = r.pos;
    const shoved = [];
    for (const o of this.sortByTurn(this.at(from, r))) {
      this.babyPushed = null;
      const to = this.babyAdjust(o, from - 1);
      const baby = this.babyPushed;
      o.pos = to;
      this.emit({ t: 'warp', rid: o.rid, from, to, text: `${this.nm(o)} 被${this.nm(r)}挤到后面` });
      shoved.push({ racer: o, to, baby });
    }
    if (!shoved.length) return;
    yield* this.pw(r, 'hugebaby');
    for (const { racer: o, to, baby } of shoved) {
      if (baby) yield* this.pw(baby, 'hugebaby');
      if (this.active(o) && o.pos === to) yield* this.afterStop(o, from, to, { passed: [], moved: false, sharedBefore: [] });
    }
  }

  /* ================= 移动 ================= */
  // kind: main | power | arrow
  *move(r, amount, kind = 'power') {
    if (!this.active(r) || !amount) return;
    yield* this.refreshCopies();
    if (++this.depth > 60) { this.depth--; return; }
    try {
      const from = r.pos;
      const dir = Math.sign(amount);
      let steps = Math.abs(amount);
      let pos = from;
      const path = [];
      const leap = this.has(r, 'leaptoad');
      let skipped = 0;
      while (steps > 0) {
        pos += dir;
        if (pos <= 0) { pos = 0; path.push(0); steps = 0; break; }
        if (pos >= FINISH) { pos = FINISH; path.push(FINISH); steps--; break; }
        path.push(pos);
        if (leap && this.at(pos, r).length) { skipped++; continue; }
        steps--;
      }
      // 较真怪：冲线必须步数正好
      if (pos === FINISH && steps > 0) {
        const st = this.holders('stickler').find((s) => s !== r);
        if (st) {
          this.emit({ t: 'blocked', rid: r.rid, by: st.rid, text: `${this.nm(st)}：「其实吧……步数不对，不能冲线。」${this.nm(r)} 原地不动` });
          yield* this.pw(st, 'stickler');
          return;
        }
      }
      if (pos === from) return; // 移动 0 不算移动
      this.babyPushed = null;
      const final = this.babyAdjust(r, pos);
      const baby = this.babyPushed;
      if (final === from) {
        this.emit({ t: 'blocked', rid: r.rid, text: `${this.nm(r)} 被巨婴挡住，原地不动` });
        if (baby) yield* this.pw(baby, 'hugebaby');
        return;
      }
      if (final !== pos) {
        while (path.length && path[path.length - 1] !== final && (dir > 0 ? path[path.length - 1] > final : path[path.length - 1] < final)) path.pop();
        if (path[path.length - 1] !== final) path.push(final);
      }
      const passed = dir > 0 ? this.others(r).filter((o) => o.pos > from && o.pos < final) : [];
      const sharedBefore = this.at(from, r);
      r.pos = final;
      this.emit({ t: 'move', rid: r.rid, from, to: final, path, kind });
      if (final === FINISH) {
        this.finish(r);
        if (skipped) yield* this.pw(r, 'leaptoad', skipped);
        yield* this.afterFinishMove(r, from, sharedBefore);
        return;
      }
      if (skipped) yield* this.pw(r, 'leaptoad', skipped);
      if (baby) {
        this.emit({ t: 'info', rid: baby.rid, text: `${this.nm(baby)} 太大了，${this.nm(r)} 只能停在它身后` });
        yield* this.pw(baby, 'hugebaby');
      }
      yield* this.afterStop(r, from, final, { passed, moved: true, sharedBefore });
    } finally {
      this.depth--;
    }
  }

  // 冲线也算一次移动：同格的吸盘鱼可以跟着冲线
  *afterFinishMove(r, from, sharedBefore) {
    yield* this.refreshCopies();
    for (const sf of this.holders('suckerfish')) {
      if (sf === r || !sharedBefore.includes(sf) || sf.pos !== from) continue;
      const ok = yield this.ask(sf.seat, 'suckerfish', `吸盘鱼：跟着 ${this.nm(r)} 一起冲线？`, [{ v: 'yes', label: '黏上去！' }, { v: 'no', label: '算了' }]);
      if (ok !== 'yes' || !this.active(sf)) continue;
      yield* this.move(sf, FINISH - sf.pos, 'power');
      yield* this.pw(sf, 'suckerfish');
    }
  }

  *warp(r, to, why) {
    if (!this.active(r) || r.pos === to) return;
    const from = r.pos;
    this.babyPushed = null;
    const final = this.babyAdjust(r, to);
    const baby = this.babyPushed;
    r.pos = final;
    this.emit({ t: 'warp', rid: r.rid, from, to: final, text: why ? `${this.nm(r)} ${why}` : undefined });
    if (baby) yield* this.pw(baby, 'hugebaby');
    if (final !== from) yield* this.afterStop(r, from, final, { passed: [], moved: false, sharedBefore: [] });
  }

  // 停在某格之后的连锁：赛道格 → 当前玩家 → 其他玩家（顺时针）
  *afterStop(r, from, final, { passed, moved, sharedBefore }) {
    if (!this.active(r)) return;
    yield* this.refreshCopies();
    // 前置连锁可能改变落点；只跳过位置相关触发，原移动的超车/同格历史仍须结算。
    // 巨婴落到有人的格子：把他们挤到身后一格（不算移动，视为停在那里）
    if (r.pos === final) yield* this.shoveByBaby(r);
    const trig = [];
    const add = (order, fn) => trig.push({ order, fn });
    const sp = this.track.spaces[final];

    if (sp && final > 0 && final < FINISH) {
      add(-1, function* () {
        if (r.pos !== final || !this.active(r)) return;
        if (sp.type === 'arrow') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'arrow', text: `${this.nm(r)} 踩到箭头，${sp.n > 0 ? '前进' : '后退'} ${Math.abs(sp.n)} 格` });
          yield* this.move(r, sp.n, 'arrow');
        } else if (sp.type === 'rock') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'rock' });
          this.trip(r, '踩到石头');
        } else if (sp.type === 'star') {
          this.emit({ t: 'space', rid: r.rid, pos: final, space: 'star' });
          this.giveChip(r.seat, 'bronze', 1, '踩到星星');
        }
      });
    }

    // 香蕉：超过我的人被绊倒
    for (const b of passed) {
      if (this.power(b) !== 'banana') continue;
      add(this.seatOrder(b.seat), function* () {
        if (!this.active(r) || !this.active(b)) return;
        this.trip(r, `超过了${this.nm(b)}`);
        yield* this.pw(b, 'banana');
      });
    }
    // 半人马：被我超过的人后退 2
    if (moved && passed.length && this.power(r) === 'centaur') {
      add(this.seatOrder(r.seat), function* () {
        for (const o of this.sortByTurn(passed)) {
          if (!this.active(o) || !this.active(r)) continue;
          this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 一记后蹄踢飞 ${this.nm(o)}` });
          yield* this.move(o, -2, 'power');
          yield* this.pw(r, 'centaur');
        }
      });
    }

    const here = r.pos === final ? this.at(final, r) : [];
    // 芭芭雅嘎
    if (this.power(r) === 'babayaga' && here.length) {
      add(this.seatOrder(r.seat), function* () {
        const hit = this.at(final, r);
        if (r.pos !== final || !hit.length) return;
        for (const o of hit) this.trip(o, `和${this.nm(r)}同格`);
        yield* this.pw(r, 'babayaga');
      });
    }
    for (const by of here) {
      if (this.power(by) !== 'babayaga') continue;
      add(this.seatOrder(by.seat), function* () {
        if (r.pos !== final || by.pos !== final || !this.active(by)) return;
        this.trip(r, `停到了${this.nm(by)}的格子`);
        yield* this.pw(by, 'babayaga');
      });
    }
    // 大嘴怪
    if (this.power(r) === 'mouth' && here.length === 1) {
      add(this.seatOrder(r.seat), function* () {
        const hit = this.at(final, r);
        if (r.pos !== final || hit.length !== 1 || !this.active(r)) return;
        yield* this.eliminate(hit[0], r);
        yield* this.pw(r, 'mouth');
      });
    }
    // 浪漫鳄：恰好两人同格
    if (here.length === 1) {
      for (const ro of this.holders('romantic')) {
        add(this.seatOrder(ro.seat), function* () {
          if (!this.active(ro)) return;
          this.emit({ t: 'info', rid: ro.rid, text: `${this.nm(ro)}：啊，爱情！前进 2 格` });
          yield* this.move(ro, 2, 'power');
          yield* this.pw(ro, 'romantic');
        });
      }
    }
    // 决斗家
    if (here.length) {
      if (this.power(r) === 'duelist') {
        add(this.seatOrder(r.seat), function* () { yield* this.duelOffer(r, final); });
      }
      for (const d of here) {
        if (this.power(d) !== 'duelist') continue;
        add(this.seatOrder(d.seat), function* () { yield* this.duelOffer(d, final, r); });
      }
    }
    // 吸盘鱼：同格的人移动了，可以跟过去
    if (moved) {
      for (const sf of sharedBefore) {
        if (this.power(sf) !== 'suckerfish') continue;
        add(this.seatOrder(sf.seat), function* () {
          if (!this.active(sf) || sf.pos !== from || !this.active(r) || r.pos === sf.pos) return;
          const ok = yield this.ask(sf.seat, 'suckerfish', `吸盘鱼：跟着 ${this.nm(r)} 移动到第 ${r.pos} 格？`, [{ v: 'yes', label: '黏上去！' }, { v: 'no', label: '算了' }], { target: r.pos });
          if (ok !== 'yes' || !this.active(sf) || !this.active(r)) return;
          yield* this.move(sf, r.pos - sf.pos, 'power');
          yield* this.pw(sf, 'suckerfish');
        });
      }
    }

    trig.sort((a, b) => a.order - b.order);
    for (const t of trig) yield* t.fn.call(this);
  }

  *duelOffer(d, pos, only) {
    if (!this.active(d) || d.pos !== pos) return;
    const foes = (only ? [only] : this.at(pos, d)).filter((o) => this.active(o) && o.pos === pos);
    if (!foes.length) return;
    const opts = foes.map((o) => ({ v: o.rid, label: `和${this.nm(o)}决斗` })).concat([{ v: '_no', label: '不决斗' }]);
    const v = yield this.ask(d.seat, 'duel', '决斗家：要喊「决斗！」吗？', opts);
    if (v === '_no') return;
    const o = this.byRid(v);
    if (!this.active(o) || o.pos !== d.pos) return;
    const a = this.d6(), b = this.d6();
    const win = a >= b ? d : o;
    this.emit({ t: 'duel', a: d.rid, b: o.rid, ra: a, rb: b, win: win.rid, text: `决斗！${this.nm(d)} 掷 ${a}，${this.nm(o)} 掷 ${b}，${this.nm(win)} 胜出前进 2 格` });
    yield* this.move(win, 2, 'power');
    yield* this.pw(d, 'duelist');
  }

  /* ================= 回合 ================= */
  resetTurnCounters() {
    this.pwCount = new Map();
    this.pwSeen = new Set();
    this.pwTotal = 0;
    this.depth = 0;
    this.loopNoted = false;
    // 缓存仅覆盖本回合技能连锁；清空后 power() 在新选择完成前返回 null。
    for (const r of this.racers) delete r.copyChoices;
  }

  *takeTurn(r) {
    this.curSeat = r.seat;
    this.turns++;
    this.resetTurnCounters();
    yield* this.refreshCopies();
    this.emit({ t: 'turn', seat: r.seat, rid: r.rid });
    const startPos = r.pos;
    let skipMain = false;

    if (r.tripped) {
      r.tripped = false;
      skipMain = true;
      this.emit({ t: 'recover', rid: r.rid, text: `${this.nm(r)} 爬起来了，本回合不掷骰` });
    }
    if (this.has(r, 'mastermind') && !r.mmDone) {
      r.mmDone = true;
      const opts = this.onTrack().map((o) => ({ v: o.rid, label: o === r ? '我自己' : this.nm(o) }));
      const v = yield this.ask(r.seat, 'mastermind', '主谋：预言谁会夺冠？', opts);
      r.mmPredict = v;
      this.emit({ t: 'predict', rid: r.rid, target: v, text: `${this.nm(r)} 预言：${v === r.rid ? '我自己' : this.nm(this.byRid(v))} 会夺冠` });
      yield* this.pw(r, 'mastermind');
    }
    if (!skipMain && this.active(r) && this.has(r, 'hare')) {
      const lead = this.leaders();
      if (lead.length === 1 && lead[0] === r && this.onTrack().length > 1) {
        skipMain = true;
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 独自领跑，骄傲地睡了一觉（跳过主移动）` });
        yield* this.pw(r, 'hare');
      }
    }
    if (!skipMain && this.active(r)) yield* this.mainMove(r, startPos);

    // 起哄怪按回合实际位移触发：第一名技能失效不抹去本回合的移动事实。
    if (!r.out && this.finishCount < 2 && Math.abs(r.pos - startPos) <= 1) {
      for (const h of this.holders('heckler')) {
        if (!this.active(h)) continue;
        this.emit({ t: 'info', rid: h.rid, text: `${this.nm(h)}：哈哈哈，原地踏步！前进 2 格` });
        yield* this.move(h, 2, 'power');
        yield* this.pw(h, 'heckler');
      }
    }
    this.emit({ t: 'turnEnd', seat: r.seat });
  }

  *mainMove(r, startPos) {
    yield* this.refreshCopies();
    const yn = (yes, no) => [{ v: 'yes', label: yes }, { v: 'no', label: no }];
    // ---- 主移动前 ----
    if (this.has(r, 'cheerleader')) {
      const v = yield this.ask(r.seat, 'cheerleader', '啦啦队长：让最后一名前进 2 格，自己前进 1 格？', yn('加油加油！', '不了'));
      if (v === 'yes' && this.active(r)) {
        const ls = this.sortByTurn(this.lasts());
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 为最后一名加油！` });
        for (const l of ls) yield* this.move(l, 2, 'power');
        yield* this.move(r, 1, 'power');
        yield* this.pw(r, 'cheerleader');
      }
    }
    if (this.active(r) && this.has(r, 'loser')) {
      const ls = this.lasts();
      if (ls.length === 1 && ls[0] === r) {
        this.giveChip(r.seat, 'bronze', 1, '可爱废柴独自垫底');
        yield* this.pw(r, 'loser');
      }
    }
    if (this.active(r) && this.has(r, 'hypnotist')) {
      const cands = this.others(r).filter((o) => o.pos !== r.pos);
      if (cands.length) {
        const opts = cands.map((o) => ({ v: o.rid, label: `${this.nm(o)}（第 ${o.pos} 格）` })).concat([{ v: '_no', label: '不催眠' }]);
        const v = yield this.ask(r.seat, 'hypnotist', '催眠蛇：把谁瞬移到你身边？', opts);
        const o = this.byRid(v);
        if (v !== '_no' && this.active(o) && this.active(r)) {
          yield* this.warp(o, r.pos, `被${this.nm(r)}催眠，瞬移过来`);
          yield* this.pw(r, 'hypnotist');
        }
      }
    }
    let partyBonus = 0;
    if (this.active(r) && this.has(r, 'partyanimal')) {
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 开派对！所有人朝它靠近 1 格` });
      for (const o of this.sortByTurn(this.others(r))) {
        if (!this.active(o) || !this.active(r) || o.pos === r.pos) continue;
        yield* this.move(o, o.pos < r.pos ? 1 : -1, 'power');
      }
      if (this.active(r)) {
        partyBonus = this.at(r.pos, r).length;
        yield* this.pw(r, 'partyanimal');
      }
    }
    if (this.active(r) && this.has(r, 'thirdwheel')) {
      const counts = {};
      for (const o of this.onTrack()) counts[o.pos] = (counts[o.pos] || 0) + 1;
      const spaces = Object.keys(counts).map(Number).filter((p) => counts[p] === 2 && p !== r.pos);
      if (spaces.length) {
        const opts = spaces.sort((a, b) => b - a).map((p) => ({ v: `s${p}`, label: `第 ${p} 格` })).concat([{ v: '_no', label: '不挤了' }]);
        const v = yield this.ask(r.seat, 'thirdwheel', '电灯泡：挤进哪个两人格？', opts);
        if (v !== '_no' && this.active(r)) {
          yield* this.warp(r, Number(v.slice(1)), '硬挤进了两人世界');
          yield* this.pw(r, 'thirdwheel');
        }
      }
    }
    if (!this.active(r)) return;

    // ---- 主移动方式 ----
    const modes = [{ v: 'roll', label: '掷骰子' }];
    if (this.has(r, 'legs')) modes.push({ v: 'legs', label: '迈大步：直接走 5 格' });
    if (this.has(r, 'flipflop')) {
      for (const o of this.others(r)) if (o.pos !== r.pos) modes.push({ v: `flip:${o.rid}`, label: `和${this.nm(o)}换位（第 ${o.pos} 格）` });
    }
    let mode = 'roll';
    if (modes.length > 1) mode = yield this.ask(r.seat, 'mode', '这回合怎么走？', modes);
    else mode = yield this.ask(r.seat, 'roll', '轮到你了，掷骰子！', modes);
    if (!this.active(r)) return;

    if (mode.startsWith('flip:')) {
      const o = this.byRid(mode.slice(5));
      if (!this.active(o)) return;
      const a = r.pos, b = o.pos;
      r.pos = b; o.pos = a;
      this.emit({ t: 'swap', a: r.rid, b: o.rid, pa: b, pb: a, text: `${this.nm(r)} 和 ${this.nm(o)} 乾坤大挪移，交换了位置` });
      yield* this.pw(r, 'flipflop');
      yield* this.afterStop(r, a, b, { passed: [], moved: false, sharedBefore: [] });
      yield* this.afterStop(o, b, a, { passed: [], moved: false, sharedBefore: [] });
      return;
    }

    let base, roll = null;
    if (mode === 'legs') {
      base = 5;
      this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 迈开大长腿，直接走 5 格` });
      yield* this.pw(r, 'legs');
    } else {
      let predict = null;
      if (this.has(r, 'genius')) {
        predict = Number(yield this.ask(r.seat, 'genius', '天才：预言你这次会掷出几点？', [1, 2, 3, 4, 5, 6].map((k) => ({ v: String(k), label: String(k) }))));
        this.emit({ t: 'predict', rid: r.rid, value: predict, text: `${this.nm(r)} 预言会掷出 ${predict}` });
      }
      roll = this.d6();
      this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: roll, text: `${this.nm(r)} 掷出 ${roll}` });
      let magic = this.has(r, 'magician') ? 2 : 0;
      let diceUsed = false;
      for (let g = 0; g < 4; g++) {
        const opts = [{ v: 'keep', label: `就用 ${roll}` }];
        if (magic > 0) opts.push({ v: 'magic', label: `魔术重掷（还剩 ${magic} 次）` });
        const dealers = !diceUsed ? this.holders('dicemonger') : [];
        if (dealers.length) opts.push({ v: 'dice', label: '骰子交易：重掷一次' });
        if (opts.length === 1) break;
        const v = yield this.ask(r.seat, 'reroll', `掷出了 ${roll}，要重掷吗？`, opts, { roll });
        if (v === 'keep' || !this.active(r)) break;
        roll = this.d6();
        this.emit({ t: 'roll', rid: r.rid, seat: r.seat, value: roll, reroll: true, text: `${this.nm(r)} 重掷出 ${roll}` });
        if (v === 'magic') { magic--; yield* this.pw(r, 'magician'); } else {
          diceUsed = true;
          // 机会共享一次；本次交易触发的所有有效贩子依回合顺序结算奖励。
          for (const dm of dealers) {
            if (!this.active(dm)) continue;
            if (dm !== r) {
              this.emit({ t: 'info', rid: dm.rid, text: `${this.nm(dm)} 做成一笔骰子生意，前进 1 格` });
              yield* this.move(dm, 1, 'power');
            }
            yield* this.pw(dm, 'dicemonger');
          }
        }
      }
      if (!this.active(r)) return;
      if (predict != null && predict === roll) {
        this.extraTurn = true;
        this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 算到了！回合结束后再来一回合` });
        yield* this.pw(r, 'genius');
      }
      // 掷骰触发
      let skip = false;
      if (roll === 1) {
        for (const w of this.holders('inchworm')) {
          if (w === r) continue;
          skip = true;
          this.emit({ t: 'info', rid: w.rid, text: `${this.nm(w)} 扭一扭：${this.nm(r)} 这步作废` });
          yield* this.move(w, 1, 'power');
          yield* this.pw(w, 'inchworm');
        }
        const sk = this.holders('skipper')[0];
        if (sk && this.active(sk)) {
          this.skipperNext = sk.seat;
          this.emit({ t: 'info', rid: sk.rid, text: sk === r ? `${this.nm(sk)} 掷出 1，老水手再来一回合！` : `${this.nm(sk)}：掷出 1 了？下一个轮到老水手我！` });
          yield* this.pw(sk, 'skipper');
        }
      }
      if (roll === 6) {
        if (this.has(r, 'sisyphus')) {
          skip = true;
          const chips = this.players[r.seat].chips;
          const i = chips.findIndex((c) => c.kind === 'bronze' && c.v > 0);
          const j = i >= 0 ? i : chips.reduce((best, c, k) => c.v > 0 && (best < 0 || c.v < chips[best].v) ? k : best, -1);
          if (j >= 0) {
            const [lost] = chips.splice(j, 1);
            if (lost.v > 1) chips.push({ ...lost, v: lost.v - 1 });
          }
          if (j >= 0) this.emit({ t: 'chip', seat: r.seat, kind: 'lose', v: -1, text: `${this.nm(r)} 掷出 6，石头滚回起点，失去 1 分` });
          else this.emit({ t: 'info', rid: r.rid, text: `${this.nm(r)} 掷出 6，石头滚回起点；当前没有分数可失去` });
          yield* this.warp(r, 0);
          yield* this.pw(r, 'sisyphus');
        }
        for (const l of this.holders('lackey')) {
          if (l === r || !this.active(l)) continue;
          this.emit({ t: 'info', rid: l.rid, text: `${this.nm(l)}：遵命老爷！抢先 2 格` });
          yield* this.move(l, 2, 'power');
          yield* this.pw(l, 'lackey');
        }
      }
      if (skip || !this.active(r)) return;
      base = roll;
      if (this.has(r, 'alchemist') && (roll === 1 || roll === 2)) {
        const v = yield this.ask(r.seat, 'alchemist', `炼金术士：把 ${roll} 变成 4？`, yn('点石成金！', `就走 ${roll}`));
        if (v === 'yes') { base = 4; yield* this.pw(r, 'alchemist'); }
      }
      if (this.active(r) && this.has(r, 'rocket')) {
        const v = yield this.ask(r.seat, 'rocket', `火箭科学家：把 ${base} 翻倍成 ${base * 2}？（之后会摔倒）`, yn('咔嘣！点火！', '稳一点'));
        if (v === 'yes') { base *= 2; r.rocketTrip = true; yield* this.pw(r, 'rocket'); }
      }
    }
    if (!this.active(r)) return;

    // ---- 加减值 ----
    const mods = [];
    for (const c of this.holders('coach')) if (c.pos === r.pos) { mods.push({ label: '教练', v: 1 }); yield* this.pw(c, 'coach'); }
    for (const gk of this.holders('gunk')) if (gk !== r) { mods.push({ label: '黏液怪', v: -1 }); yield* this.pw(gk, 'gunk'); }
    if (this.has(r, 'hare')) { mods.push({ label: '野兔', v: 2 }); yield* this.pw(r, 'hare'); }
    if (this.has(r, 'blimp')) { const v = startPos < this.track.secondCorner ? 3 : -1; mods.push({ label: '飞艇', v }); yield* this.pw(r, 'blimp'); }
    if (partyBonus) mods.push({ label: '派对', v: partyBonus });
    if (!this.active(r)) return;
    const total = Math.max(0, base + mods.reduce((s, m) => s + m.v, 0));
    if (mods.length) this.emit({ t: 'calc', rid: r.rid, base, mods, total, text: `${this.nm(r)} 主移动：${base}${mods.map((m) => `${m.v > 0 ? '+' : ''}${m.v}（${m.label}）`).join('')} = ${total}` });
    yield* this.move(r, total, 'main');
    if (r.rocketTrip) {
      r.rocketTrip = false;
      this.trip(r, '火箭过载');
    }
  }

  /* ================= 对外快照 ================= */
  snapshot(viewerSeat) {
    const d = this.pending;
    const internal = viewerSeat === undefined;
    let pending = null;
    if (d) {
      if (d.simul) {
        const optionsBySeat = internal ? d.optionsBySeat :
          (d.seats.includes(viewerSeat) ? { [viewerSeat]: d.optionsBySeat[viewerSeat] } : {});
        pending = { id: d.id, kind: d.kind, title: d.title, simul: true, seats: d.seats,
          done: Object.keys(d.answers).map(Number), optionsBySeat };
      } else {
        pending = { id: d.id, kind: d.kind, title: d.title, seat: d.seat,
          options: internal || viewerSeat === d.seat ? d.options : [], roll: d.roll, target: d.target };
      }
    }
    // 包括 chips、results、pending options、计分常量都必须与引擎脱离引用。
    return structuredClone({
      phase: this.phase,
      raceNo: this.raceNo,
      track: this.trackKey,
      gold: GOLD, silver: SILVER,
      curSeat: this.curSeat,
      firstSeat: this.firstSeat,
      faceUp: this.faceUp,
      draft: this.phase === 'draft' && this.draftOrder ? { order: this.draftOrder, idx: this.draftIdx, round: this.draftRound } : null,
      deckCount: this.deck.length,
      winners: this.winners,
      players: this.players.map((p) => ({ seat: p.seat, name: p.name, ai: p.ai, hand: p.hand, used: p.used, chips: p.chips, score: this.score(p.seat) })),
      racers: this.racers.map((r) => ({ rid: r.rid, seat: r.seat, pos: r.pos, tripped: r.tripped, finished: r.finished, out: r.out, power: r.power, eff: this.power(r), mmPredict: r.mmPredict })),
      results: this.results,
      log: this.log.slice(-60),
      champions: this.champions || null,
      pending,
      seq: this.evSeq,
    });
  }
}

module.exports = { Game, FINISH };
