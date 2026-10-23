// 事件动画时长表：前端播放与服务端 AI 节奏共用（UMD）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP = 170;
  function eventMs(e) {
    switch (e.t) {
      case 'move': return 160 + STEP * Math.max(1, (e.path || []).length);
      case 'warp': return 560;
      case 'swap': return 760;
      case 'roll': return 1000;
      case 'rollOff': return 1300;
      case 'calc': return 900;
      case 'power': return 260;
      case 'trip': return 520;
      case 'recover': return 450;
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
      case 'turn': return 380;
      case 'extraTurn': return 700;
      case 'drafted': return 520;
      case 'faceUp': return 1100;
      case 'draftStart': return 900;
      case 'firstPlayer': return 900;
      case 'raceIntro': return 1600;
      case 'reveal': return 2600;
      case 'raceEnd': return 3600;
      case 'gameOver': return 2000;
      default: return 0;
    }
  }
  function batchMs(events) { return events.reduce((s, e) => s + eventMs(e), 0); }
  return { eventMs, batchMs, STEP };
});
