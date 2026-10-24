// 事件动画时长表：前端播放与服务端 AI 节奏共用（UMD）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP = 170;
  // AI 座位回合内（事件带 ai 标记）的跳格更快，但仍能看清每一步
  const AI_STEP = 120;
  // 结算类停留：给人读分数的时间，不随房间倍速缩短（服务端排程与前端播放都单独累加）
  const FIXED = { raceEnd: 4500, gameOver: 2500 };
  // 掷骰前后与技能提示卡的分段（前端播放用，总和与 eventMs 对齐）
  const ROLL = { human: { spin: 560, land: 420 }, ai: { spin: 340, land: 280 } };
  const PATH_PREVIEW = 180; // 主移动先预亮路径与落点，再开始跳格
  const AI_PATH_PREVIEW = 140;
  function previewMs(e) { return e && e.ai ? AI_PATH_PREVIEW : PATH_PREVIEW; }
  function stepMs(e) { return e && e.ai ? AI_STEP : STEP; }
  function eventMs(e) {
    const ai = !!e.ai;
    switch (e.t) {
      case 'move': return (ai ? 100 : 160) + stepMs(e) * Math.max(1, (e.path || []).length) + (e.kind === 'main' ? previewMs(e) : 0);
      case 'warp': return 560;
      case 'swap': return 760;
      case 'roll': return ai ? 640 : 1000;
      case 'rollOff': return 1300;
      case 'calc': return ai ? 600 : 900;
      case 'power': return ai ? 560 : 680;
      case 'trip': return 520;
      case 'recover': return ai ? 360 : 450;
      case 'finish': return 1300;
      case 'out': return 1000;
      case 'chip': return 380;
      case 'duel': return 1500;
      case 'blocked': return 700;
      case 'space': return 380;
      case 'predict': return 900;
      case 'transform': return 1300;
      case 'copy': return 420;
      case 'info': return 420;
      case 'turn': return ai ? 220 : 380;
      case 'extraTurn': return 700;
      case 'drafted': return 620;
      case 'faceUp': return 1100;
      case 'draftStart': return 900;
      case 'firstPlayer': return 900;
      case 'raceIntro': return 1900;
      case 'reveal': return 2600;
      case 'raceEnd': return 600;
      case 'gameOver': return 600;
      default: return 0;
    }
  }
  // 不随倍速缩短的部分
  function fixedMs(e) { return FIXED[e.t] || 0; }
  // speed 缺省为 1：返回该批事件在给定倍速下的总播放时长
  function batchMs(events, speed = 1) {
    let scaled = 0, fixed = 0;
    for (const e of events) { scaled += eventMs(e); fixed += fixedMs(e); }
    return scaled / speed + fixed;
  }
  return { eventMs, fixedMs, batchMs, stepMs, previewMs, STEP, AI_STEP, FIXED, ROLL, PATH_PREVIEW };
});
