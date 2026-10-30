'use strict';
// 对局日志：每局一个 NDJSON 文件，边打边追加（服务重启也不丢已经发生的部分），用来事后复盘规则 bug。
// 一行一条记录：
//   start  局信息（种子、模式、玩家、引擎版本）——同一份代码可以按种子 + 答案逐步重放
//   ans    一次被接受的决策：席位、决策 id/种类、选项值、由谁做出（human / ai / auto / timeout）
//   ev     一批引擎事件（与推给客户端的完全一致）
//   end    结束原因与比分
// 只保留最近 retentionDays 天；单文件与总量都有上限，写满了先删最旧的，不会把盘撑满。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 24 * 60 * 60 * 1000;
const ENGINE_FILES = ['engine.js', 'racers.js', 'tracks.js', 'ai.js'];

// 引擎代码的指纹：重放前对比，指纹不同说明规则代码已改，按种子重放可能对不上
function engineVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ENGINE_FILES) {
    try { h.update(fs.readFileSync(path.join(__dirname, '..', 'game', f))); } catch { /* 缺文件也给出指纹 */ }
  }
  return h.digest('hex').slice(0, 12);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
function stamp(t) {
  const d = new Date(t);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const NOOP = { answer() {}, events() {}, report() {}, end() {}, file: null };

function createGameLog({ dir, now = Date.now, retentionDays = 30, maxFileBytes = 8 * 1024 * 1024, maxTotalBytes = 1024 * 1024 * 1024, log = console } = {}) {
  if (!dir) return { begin: () => NOOP, prune() {}, dir: null };
  let ready = false, warned = false;
  const version = engineVersion();
  function warn(err) {
    if (warned) return;
    warned = true;
    log.error('对局日志写入失败（之后不再提示）：', err.message);
  }
  function ensureDir() {
    if (ready) return true;
    try { fs.mkdirSync(dir, { recursive: true }); ready = true; } catch (err) { warn(err); }
    return ready;
  }

  function prune() {
    if (!ensureDir()) return;
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.ndjson')).map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { f, mtime: st.mtimeMs, size: st.size };
      }).sort((a, b) => a.mtime - b.mtime);
    } catch (err) { warn(err); return; }
    const cutoff = now() - retentionDays * DAY;
    let total = files.reduce((s, x) => s + x.size, 0);
    for (const x of files) {
      if (x.mtime >= cutoff && total <= maxTotalBytes) break;
      try { fs.unlinkSync(path.join(dir, x.f)); total -= x.size; } catch (err) { warn(err); }
    }
  }

  function begin({ gameId, room, mode, edition, seed, players }) {
    if (!ensureDir()) return NOOP;
    const t0 = now();
    const safeRoom = String(room || 'XXXX').replace(/[^A-Z0-9]/gi, '').slice(0, 8) || 'XXXX';
    const file = path.join(dir, `${stamp(t0)}_${safeRoom}_${String(gameId).slice(0, 8)}.ndjson`);
    let bytes = 0, closed = false, truncated = false;
    function write(rec) {
      if (closed || truncated) return;
      let line = JSON.stringify(rec) + '\n';
      if (bytes + Buffer.byteLength(line) > maxFileBytes) {
        truncated = true;
        line = JSON.stringify({ k: 'truncated', t: now() - t0, bytes }) + '\n';
      }
      try { fs.appendFileSync(file, line); bytes += Buffer.byteLength(line); } catch (err) { warn(err); closed = true; }
    }
    write({ k: 'start', v: 1, at: new Date(t0).toISOString(), gameId, room: safeRoom, mode, edition, seed, engine: version, players });
    return {
      file,
      // by：human 真人点的 / ai AI 席位 / auto 托管或离线代打 / timeout 超时代打
      answer(seat, d, value, by) { write({ k: 'ans', t: now() - t0, seat, id: d.id, kind: d.kind, value, by }); },
      events(list) { if (list.length) write({ k: 'ev', t: now() - t0, events: list }); },
      // 玩家点「反馈问题」：seq 是他画面上播放到的事件序号，latest 是服务端当时最新的序号
      report(rec) { write({ k: 'report', t: now() - t0, ...rec }); },
      end(reason, extra = {}) { write({ k: 'end', t: now() - t0, reason, ...extra }); closed = true; },
    };
  }

  prune();
  return { begin, prune, dir };
}

module.exports = { createGameLog, engineVersion };
