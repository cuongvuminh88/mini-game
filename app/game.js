/* =========================================================================
   game.js — Đập Sếp
   Script thường (không dùng type="module") để mở trực tiếp bằng file://.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Cấu hình — mọi thông số nằm ở đây (QT-01…QT-03, TC-42).
     Chỉ khi test: ?round=<ms>&up=<ms> ghi đè ROUND_MS và MOLE_UP_MIN/MAX_MS.
     --------------------------------------------------------------------- */
  const CONFIG = Object.freeze(applyTestOverrides({
    GRID_ROWS: 3,
    GRID_COLS: 3,
    ROUND_MS: 30000,          // thời gian một lượt
    MOLE_UP_MIN_MS: 600,      // sếp hiện ngắn nhất
    MOLE_UP_MAX_MS: 1200,     // sếp hiện lâu nhất
    GAP_MIN_MS: 200,          // nghỉ ngắn nhất giữa hai con
    GAP_MAX_MS: 500,          // nghỉ lâu nhất giữa hai con
    MAX_MOLES: 1,             // số sếp tối đa cùng lúc
    POINTS_PER_HIT: 1,
    WARNING_AT_S: 5,          // đổi màu đồng hồ khi còn ≤ 5 giây
    ANIM_MS: 150,             // thò lên / thụt xuống
    HIT_SHOW_MS: 150,         // giữ hình “bị đập” trước khi thụt
    REPLAY_LOCK_MS: 500,      // khóa nút Chơi lại sau khi kết thúc
    STORAGE_KEY: "dap-sep.highScore"
  }));

  function applyTestOverrides(defaults) {
    const result = Object.assign({}, defaults);
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch (e) {
      return result;
    }
    const round = parsePositiveInt(params.get('round'));
    const up = parsePositiveInt(params.get('up'));
    if (round !== null) result.ROUND_MS = round;
    if (up !== null) {
      result.MOLE_UP_MIN_MS = up;
      result.MOLE_UP_MAX_MS = up;
    }
    return result;
  }

  function parsePositiveInt(raw) {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  const MS_PER_SECOND = 1000;
  const TOTAL_SECONDS = Math.ceil(CONFIG.ROUND_MS / MS_PER_SECOND);
  const HOLE_COUNT = CONFIG.GRID_ROWS * CONFIG.GRID_COLS;

  /* ---------------------------------------------------------------------
     Trạng thái
     --------------------------------------------------------------------- */
  const PHASE = Object.freeze({ START: 'START', PLAYING: 'PLAYING', END: 'END' });
  const MOLE = Object.freeze({ UP: 'UP', HIT: 'HIT', LEAVING: 'LEAVING' });

  const state = {
    phase: PHASE.START,
    roundId: 0,
    score: 0,
    spawned: 0,
    endAt: 0,
    mole: null,          // { id, hole, state, upUntil }
    lastHole: null,
    isNewRecord: false
  };

  let highScore = readHighScore();   // QT-41: đọc một lần khi tải trang
  let moleSeq = 0;
  let rafId = 0;
  let shownSeconds = -1;
  let replayLockedUntil = 0;
  let replayUnlockTimer = 0;
  const roundTimers = new Set();

  /* ---------------------------------------------------------------------
     DOM
     --------------------------------------------------------------------- */
  const $ = function (id) { return document.getElementById(id); };
  const el = {
    screens: Array.prototype.slice.call(document.querySelectorAll('.screen')),
    ruleSeconds: $('rule-seconds'),
    startBest: $('start-best'),
    btnStart: $('btn-start'),
    playTitle: $('play-title'),
    hudScore: $('hud-score'),
    hudTime: $('hud-time'),
    hudTimeWrap: $('hud-time-wrap'),
    grid: $('grid'),
    endScore: $('end-score'),
    endHits: $('end-hits'),
    endSpawned: $('end-spawned'),
    endNewRecord: $('end-new-record'),
    endBest: $('end-best'),
    btnReplay: $('btn-replay'),
    announcer: $('announcer'),
    cellTemplate: $('cell-template')
  };
  const cells = [];

  /* ---------------------------------------------------------------------
     Tiện ích
     --------------------------------------------------------------------- */
  function now() { return performance.now(); }

  // QT-01: số ngẫu nhiên đều trong [min, max]
  function randBetween(min, max) { return min + Math.random() * (max - min); }

  function remainingMs() { return state.endAt - now(); }

  // Hẹn giờ gắn với lượt hiện tại (QT-12)
  function scheduleInRound(fn, ms) {
    const rid = state.roundId;
    const t = setTimeout(function () {
      roundTimers.delete(t);
      if (rid !== state.roundId || state.phase !== PHASE.PLAYING) return;
      fn();
    }, ms);
    roundTimers.add(t);
    return t;
  }

  function clearRoundTimers() {
    roundTimers.forEach(function (t) { clearTimeout(t); });
    roundTimers.clear();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // Chạy lại một animation CSS bằng cách gỡ và gắn lại class
  function restartClass(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  function formatNumber(n) { return n.toLocaleString('vi-VN'); }

  /* ---------------------------------------------------------------------
     Âm thanh — tổng hợp bằng Web Audio, không cần file âm thanh.
     AudioContext được tạo/mở khóa trong cú bấm “Bắt đầu” / “Chơi lại”
     (trình duyệt, nhất là iOS, chỉ cho phát âm thanh sau thao tác người dùng).
     --------------------------------------------------------------------- */
  let audioCtx = null;
  let noiseBuffer = null;

  function unlockAudio() {
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
        noiseBuffer = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.08), audioCtx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      audioCtx = null;   // không có âm thanh thì game vẫn chạy bình thường
    }
  }

  /* ---------------------------------------------------------------------
     Rung khi đập trúng (điện thoại).
     - Android (Chrome, Firefox…): navigator.vibrate.
     - iPhone: Safari không có navigator.vibrate; từ iOS 18, bấm vào một
       <input type="checkbox" switch> tạo một nhịp rung nhẹ — dùng làm dự phòng.
     Máy không hỗ trợ thì bỏ qua, game vẫn chạy bình thường.
     --------------------------------------------------------------------- */
  const VIBRATE_MS = 40;
  let hapticLabel = null;

  function setupHaptics() {
    if (typeof navigator.vibrate === 'function') return;
    try {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      hapticLabel = label;
    } catch (e) {
      hapticLabel = null;
    }
  }

  function vibrateHit() {
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(VIBRATE_MS);
      else if (hapticLabel) hapticLabel.click();
    } catch (e) {
      /* bỏ qua */
    }
  }

  // Một nốt nhạc ngắn: tấn công nhanh, ngân rồi tắt dần
  function playNote(out, type, freq, start, dur, peak) {
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.015);
    g.gain.setValueAtTime(peak, start + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // Tiếng “bắt đầu”: hai nốt ngắn đi lên rồi một nốt cao ngân (“tinh–tinh–TING!”).
  // Gọi ngay trong cú bấm, lúc AudioContext có thể vẫn đang mở khóa (resume
  // chưa xong, nhất là lần bấm đầu trên iOS) → chờ resume rồi mới phát.
  function playStartSound() {
    if (!audioCtx) return;
    const play = function () {
      if (audioCtx.state !== 'running') return;
      try {
        const t = audioCtx.currentTime + 0.02;
        const out = audioCtx.createGain();
        out.gain.value = 0.3;
        out.connect(audioCtx.destination);
        playNote(out, 'square', 587.33, t, 0.08, 0.25);          // Rê5
        playNote(out, 'square', 783.99, t + 0.1, 0.08, 0.25);    // Sol5
        playNote(out, 'triangle', 1174.66, t + 0.2, 0.35, 0.4);  // Rê6
        playNote(out, 'square', 1174.66, t + 0.2, 0.3, 0.1);
      } catch (e) {
        /* bỏ qua lỗi âm thanh */
      }
    };
    if (audioCtx.state === 'running') play();
    else audioCtx.resume().then(play, function () {});
  }

  // Nhạc “victory” khi hiện bảng điểm: đô–mi–sol–đô rồi hợp âm Đô trưởng ngân dài
  function playVictorySound() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    try {
      const t = audioCtx.currentTime + 0.05;
      const out = audioCtx.createGain();
      out.gain.value = 0.35;
      out.connect(audioCtx.destination);

      const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
      const step = 0.12;
      [C5, E5, G5].forEach(function (f, i) {
        playNote(out, 'square', f, t + i * step, 0.11, 0.25);
      });
      playNote(out, 'square', C6, t + 3 * step, 0.22, 0.25);
      playNote(out, 'square', G5, t + 3 * step + 0.24, 0.1, 0.22);
      const chordAt = t + 3 * step + 0.36;
      [C5, E5, G5, C6].forEach(function (f) {
        playNote(out, 'triangle', f, chordAt, 0.9, 0.3);
      });
      playNote(out, 'square', C6, chordAt, 0.9, 0.12);
    } catch (e) {
      /* bỏ qua lỗi âm thanh */
    }
  }

  // Tiếng “bốp”: tiếng gõ ngắn (nhiễu lọc) + tiếng “boing” trượt xuống
  function playHitSound() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    try {
      const t = audioCtx.currentTime;
      const out = audioCtx.createGain();
      out.gain.value = 0.6;
      out.connect(audioCtx.destination);

      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;
      const band = audioCtx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1600;
      band.Q.value = 0.8;
      const noiseGain = audioCtx.createGain();
      noiseGain.gain.setValueAtTime(0.9, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      noise.connect(band).connect(noiseGain).connect(out);
      noise.start(t);
      noise.stop(t + 0.08);

      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(120, t + 0.18);
      const oscGain = audioCtx.createGain();
      oscGain.gain.setValueAtTime(0.0001, t);
      oscGain.gain.exponentialRampToValueAtTime(0.8, t + 0.005);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(oscGain).connect(out);
      osc.start(t);
      osc.stop(t + 0.24);
    } catch (e) {
      /* bỏ qua lỗi âm thanh */
    }
  }

  /* ---------------------------------------------------------------------
     Kỷ lục (QT-40…QT-43)
     --------------------------------------------------------------------- */
  function readHighScore() {
    try {
      const raw = window.localStorage.getItem(CONFIG.STORAGE_KEY);
      if (raw === null || !/^\d+$/.test(raw)) return 0;
      const n = Number(raw);
      return Number.isSafeInteger(n) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function saveHighScore(value) {
    try {
      window.localStorage.setItem(CONFIG.STORAGE_KEY, String(value));
    } catch (e) {
      /* QT-42: im lặng, giữ kỷ lục trong phiên */
    }
  }

  /* ---------------------------------------------------------------------
     Dựng lưới (QT-03)
     --------------------------------------------------------------------- */
  function buildGrid() {
    const root = document.documentElement;
    root.style.setProperty('--grid-cols', String(CONFIG.GRID_COLS));
    root.style.setProperty('--grid-rows', String(CONFIG.GRID_ROWS));
    root.style.setProperty('--anim-ms', CONFIG.ANIM_MS + 'ms');

    const frag = document.createDocumentFragment();
    for (let i = 0; i < HOLE_COUNT; i++) {
      const cell = el.cellTemplate.content.firstElementChild.cloneNode(true);
      cell.dataset.index = String(i);
      cell.setAttribute('aria-label', 'Ô ' + (i + 1));
      cells.push({ node: cell, plus: cell.querySelector('.plus') });
      frag.appendChild(cell);
    }
    el.grid.appendChild(frag);
    el.grid.addEventListener('pointerdown', onGridPointerDown);
  }

  function resetCells() {
    cells.forEach(function (c) {
      c.node.classList.remove('is-up', 'is-hit', 'is-flash');
      c.plus.classList.remove('is-showing');
      c.plus.textContent = '';
    });
  }

  /* ---------------------------------------------------------------------
     Hiển thị
     --------------------------------------------------------------------- */
  function renderPhase() {
    el.screens.forEach(function (s) { s.hidden = s.dataset.phase !== state.phase; });
  }

  function renderScore() { el.hudScore.textContent = formatNumber(state.score); }

  // QT-31, QT-33: chỉ ghi DOM khi số thay đổi
  function renderTime(remaining) {
    let secs = Math.ceil(remaining / MS_PER_SECOND);
    secs = Math.max(0, Math.min(TOTAL_SECONDS, secs));
    if (secs === shownSeconds) return;
    shownSeconds = secs;
    el.hudTime.textContent = formatNumber(secs);
    const warn = secs <= CONFIG.WARNING_AT_S;
    el.hudTimeWrap.classList.toggle('is-warning', warn);
    if (warn) restartClass(el.hudTimeWrap, 'is-pulse');
    else el.hudTimeWrap.classList.remove('is-pulse');
  }

  function renderStart() {
    el.ruleSeconds.textContent = formatNumber(CONFIG.ROUND_MS / MS_PER_SECOND);
    el.startBest.textContent = formatNumber(highScore);
  }

  function renderEnd() {
    el.endScore.textContent = formatNumber(state.score);
    el.endHits.textContent = formatNumber(state.score);
    el.endSpawned.textContent = formatNumber(state.spawned);
    el.endNewRecord.hidden = !state.isNewRecord;
    el.endBest.textContent = formatNumber(highScore);

    const parts = [
      'Hết giờ!',
      'Điểm ' + state.score + '.',
      'Trúng ' + state.score + ' / ' + state.spawned + ' lần sếp ló mặt.'
    ];
    if (state.isNewRecord) parts.push('Kỷ lục mới!');
    parts.push('Kỷ lục: ' + highScore + '.');
    el.announcer.textContent = parts.join(' ');
  }

  /* ---------------------------------------------------------------------
     Vòng đời lượt chơi
     --------------------------------------------------------------------- */
  function startRound() {
    unlockAudio();
    if (state.phase === PHASE.PLAYING) return;                              // QT-11
    if (state.phase === PHASE.END && now() < replayLockedUntil) return;     // QT-53

    playStartSound();
    clearRoundTimers();                                                   // QT-12
    clearTimeout(replayUnlockTimer);
    state.roundId += 1;
    state.score = 0;
    state.spawned = 0;
    state.mole = null;
    state.lastHole = null;
    state.isNewRecord = false;
    state.endAt = now() + CONFIG.ROUND_MS;                                 // QT-30

    resetCells();
    el.announcer.textContent = '';
    shownSeconds = -1;
    renderScore();
    renderTime(CONFIG.ROUND_MS);

    state.phase = PHASE.PLAYING;
    renderPhase();
    el.playTitle.focus({ preventScroll: true });

    scheduleNextSpawn();
    const rid = state.roundId;
    rafId = requestAnimationFrame(function loop() {
      if (rid !== state.roundId || state.phase !== PHASE.PLAYING) return;
      const remaining = remainingMs();
      renderTime(remaining);
      if (remaining <= 0) { endRound(); return; }                          // QT-32
      rafId = requestAnimationFrame(loop);
    });
  }

  function endRound() {
    if (state.phase !== PHASE.PLAYING) return;

    clearRoundTimers();                                                    // QT-13
    state.mole = null;
    resetCells();
    renderTime(0);

    if (state.score > highScore) {                                         // QT-43
      highScore = state.score;
      saveHighScore(highScore);
      state.isNewRecord = true;
    }

    state.phase = PHASE.END;
    renderEnd();
    lockReplay();
    renderPhase();
    playVictorySound();
    el.btnReplay.focus({ preventScroll: true });
  }

  function lockReplay() {
    replayLockedUntil = now() + CONFIG.REPLAY_LOCK_MS;
    el.btnReplay.setAttribute('aria-disabled', 'true');
    clearTimeout(replayUnlockTimer);
    replayUnlockTimer = setTimeout(function () {
      el.btnReplay.removeAttribute('aria-disabled');
    }, CONFIG.REPLAY_LOCK_MS);
  }

  /* ---------------------------------------------------------------------
     Chuột (QT-20…QT-26)
     --------------------------------------------------------------------- */
  function scheduleNextSpawn() {
    scheduleInRound(spawnMole, randBetween(CONFIG.GAP_MIN_MS, CONFIG.GAP_MAX_MS));
  }

  function pickHole() {
    const choices = [];
    for (let i = 0; i < HOLE_COUNT; i++) {
      if (i !== state.lastHole) choices.push(i);
    }
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function spawnMole() {
    if (remainingMs() <= 0) { endRound(); return; }                        // QT-25
    if (state.mole && state.mole.state === MOLE.UP) return;               // MAX_MOLES
    const hole = pickHole();
    const upMs = randBetween(CONFIG.MOLE_UP_MIN_MS, CONFIG.MOLE_UP_MAX_MS);
    const mole = { id: ++moleSeq, hole: hole, state: MOLE.UP, upUntil: now() + upMs };
    state.mole = mole;
    state.lastHole = hole;
    state.spawned += 1;                                                    // QT-26

    const node = cells[hole].node;
    node.classList.remove('is-hit');
    node.classList.add('is-up');

    scheduleInRound(function () { onMoleTimeout(mole.id); }, upMs);        // QT-22
  }

  function onMoleTimeout(id) {
    const m = state.mole;
    if (!m || m.id !== id || m.state !== MOLE.UP) return;
    moleLeave(m);
  }

  function moleLeave(m) {
    m.state = MOLE.LEAVING;
    cells[m.hole].node.classList.remove('is-up');
    scheduleNextSpawn();                                                   // QT-23
    scheduleInRound(function () {
      if (state.mole === m) state.mole = null;                             // → HIDDEN
    }, CONFIG.ANIM_MS);
  }

  function onGridPointerDown(event) {
    const target = event.target.closest('.cell');
    if (!target) return;
    event.preventDefault();

    if (state.phase !== PHASE.PLAYING) return;
    if (remainingMs() <= 0) { endRound(); return; }                        // QT-32

    const hole = Number(target.dataset.index);
    const m = state.mole;
    if (!m || m.hole !== hole || m.state !== MOLE.UP) return;              // QT-20, CN-06

    m.state = MOLE.HIT;                                                    // QT-21
    state.score += CONFIG.POINTS_PER_HIT;
    renderScore();
    playHitSound();
    vibrateHit();

    const cell = cells[hole];
    cell.node.classList.add('is-hit');
    restartClass(cell.node, 'is-flash');
    cell.plus.textContent = '+' + CONFIG.POINTS_PER_HIT;
    restartClass(cell.plus, 'is-showing');

    scheduleNextSpawn();                                                   // QT-23
    scheduleInRound(function () {
      cell.node.classList.remove('is-up');
      scheduleInRound(function () {
        if (state.mole === m) state.mole = null;                           // → HIDDEN
        if (!cell.node.classList.contains('is-up')) cell.node.classList.remove('is-hit');
      }, CONFIG.ANIM_MS);
    }, CONFIG.HIT_SHOW_MS);
  }

  /* ---------------------------------------------------------------------
     Rời tab / quay lại (QT-50)
     --------------------------------------------------------------------- */
  function onVisibilityChange() {
    if (document.hidden || state.phase !== PHASE.PLAYING) return;
    const remaining = remainingMs();
    if (remaining <= 0) { endRound(); return; }
    renderTime(remaining);
    const m = state.mole;
    if (m && m.state === MOLE.UP && now() >= m.upUntil) moleLeave(m);
  }

  /* ---------------------------------------------------------------------
     Khởi động
     --------------------------------------------------------------------- */
  function init() {
    buildGrid();
    setupHaptics();
    renderStart();
    renderPhase();
    el.btnStart.addEventListener('click', startRound);
    el.btnReplay.addEventListener('click', startRound);
    document.addEventListener('visibilitychange', onVisibilityChange);
    el.btnStart.focus({ preventScroll: true });
  }

  init();
})();
