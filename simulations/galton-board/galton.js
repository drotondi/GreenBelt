/**
 * Galton Board simulation.
 *
 * Balls leave a funnel, meet one peg per row and bounce right with probability p.
 * The final bin is the number of right bounces, i.e. Binomial(n, p). Bins are drawn
 * as gradient bars on a fixed scale; the normal approximation N(np, np(1-p)) is
 * overlaid, scaled to the balls already in the bins.
 *
 * Rendering: one <canvas> scaled by devicePixelRatio, a pre-rendered static layer
 * (funnel, pegs, bin walls), a pre-rendered ball sprite and a pooled ball array.
 */
(function (LSS) {
  'use strict';

  const { initI18n, onLangChange, t, formatNumber } = LSS.i18n;
  const { renderHeader, renderFooter } = LSS.header;
  const { icon } = LSS.icons;
  const { ease } = LSS.motion;

  /* ---------- Constants ---------- */
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const PLAY_RATE = 30;     // balls/s released while playing, at 1×
  const BURST_RATE = 200;   // balls/s released by "Drop 100", at 1×
  const HOP_TIME = 0.16;    // s per peg row, at 1×
  const FUNNEL_TIME = 0.14; // s from funnel to first peg, at 1×
  const FALL_TIME = 0.26;   // s from last row to the bin, at 1×
  const FADE_MS = 180;
  const STATS_INTERVAL = 100;
  const LIVE_INTERVAL = 1000;
  const MAX_DPR = 2;
  const MAX_TRAIL_BALLS = 800; // trails add nothing visible beyond this density; keeps 60 fps


  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const canvas = $('galton-canvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    play: $('btn-play'), drop1: $('btn-drop1'), drop100: $('btn-drop100'), reset: $('btn-reset'),
    rows: $('in-rows'), total: $('in-total'), speed: $('in-speed'), p: $('in-p'),
    curve: $('in-curve'), trails: $('in-trails'),
    outRows: $('out-rows'), outTotal: $('out-total'), outSpeed: $('out-speed'), outP: $('out-p'),
    dropped: $('stat-dropped'), mean: $('stat-mean'), sd: $('stat-sd'), tmean: $('stat-tmean'), tsd: $('stat-tsd'),
    live: $('live-region'), shortcuts: $('shortcuts'),
  };

  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = reducedMotionQuery.matches;

  /* ---------- State ---------- */
  const state = {
    rows: Number(ui.rows.value),
    total: Number(ui.total.value),
    speedIndex: Number(ui.speed.value),
    p: Number(ui.p.value),
    curve: ui.curve.checked,
    trails: ui.trails.checked,
    playing: false,
    spawned: 0,
    landed: 0,
    sum: 0,
    sumSq: 0,
    maxBin: 0,
    playAcc: 0,
    burstQueue: 0,
    burstAcc: 0,
  };
  let bins = new Uint32Array(state.rows + 1);
  let disp = new Float32Array(state.rows + 1); // displayed bar heights (px)
  let theory = { mean: 0, sd: 0, pmfMax: 1 };

  const active = [];
  const pool = [];

  let colors = {};
  let L = {};        // layout
  let dpr = 1;
  // Trails live on their own canvas under the main one: the compositor blends them,
  // so there is no full-screen drawImage per frame.
  const trailLayer = document.createElement('canvas');
  trailLayer.className = 'board__trails';
  trailLayer.setAttribute('aria-hidden', 'true');
  board.prepend(trailLayer);
  // Static layer (funnel, pegs, bin walls) is drawn once per layout, also as its own canvas.
  const staticLayer = document.createElement('canvas');
  staticLayer.className = 'board__static';
  staticLayer.setAttribute('aria-hidden', 'true');
  board.prepend(staticLayer);
  let trailCtx = trailLayer.getContext('2d');
  let ballSprite = document.createElement('canvas');
  let trailSprite = document.createElement('canvas');
  let barGradient = null;
  let trailFrames = 0;
  let needsDraw = true;
  let statsDirty = true;

  /* ---------- Theory ---------- */
  function computeTheory() {
    const n = state.rows;
    const p = state.p;
    const q = 1 - p;
    let pmf = Math.pow(q, n);
    let max = pmf;
    for (let k = 1; k <= n; k++) {
      pmf = (pmf * (n - k + 1) * p) / (k * q);
      if (pmf > max) max = pmf;
    }
    theory = { mean: n * p, sd: Math.sqrt(n * p * q), pmfMax: max };
  }

  function normalPdf(x) {
    const z = (x - theory.mean) / theory.sd;
    return Math.exp(-0.5 * z * z) / (theory.sd * Math.sqrt(2 * Math.PI));
  }

  function scaleMax() {
    return Math.max(state.total * theory.pmfMax * 1.1, state.maxBin * 1.04, 1);
  }

  /* ---------- Layout & static layer ---------- */
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    colors = {
      peg: v('--sim-peg'), ball: v('--sim-ball'), highlight: v('--sim-ball-highlight'), edge: v('--sim-ball-edge'),
      curve: v('--sim-curve'), divider: v('--sim-divider'), floor: v('--sim-floor'), label: v('--sim-label'),
      funnel: v('--neutral-300'), g0: v('--sim-gradient-0'), g50: v('--sim-gradient-50'), g100: v('--sim-gradient-100'),
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  function boardHeight(w) {
    const maxH = Math.max(360, window.innerHeight - 120);
    return Math.round(Math.min(Math.max(w * 0.92, 340), maxH));
  }

  function computeLayout(W, H) {
    const n = state.rows;
    const pad = Math.max(10, Math.round(W * 0.02));
    const labelH = 20;
    const floorY = H - pad - labelH;
    const binH = H * 0.3;
    const binTop = floorY - binH;
    const funnelTop = pad;
    const funnelH = Math.max(24, H * 0.07);
    const pegTop = funnelTop + funnelH + Math.max(14, H * 0.03);
    const dy = (binTop - pegTop) / n;
    const dx = Math.min((W - 2 * pad) / (n + 1), dy * 1.7);
    const m = Math.min(dx, dy);
    const pegR = Math.min(4, Math.max(1.5, m * 0.1));
    const ballR = Math.min(6.5, Math.max(2, m * 0.17));
    const cx = W / 2;
    L = {
      W, H, n, pad, labelH, floorY, binH, binTop, funnelTop, funnelH, pegTop, dy, dx, pegR, ballR, cx,
      binsLeft: cx - ((n + 1) / 2) * dx,
      binsRight: cx + ((n + 1) / 2) * dx,
      spawnY: funnelTop + funnelH * 0.55,
      lift: dy * 0.3,
    };
  }

  const pegX = (r, k) => L.cx + (k - r / 2) * L.dx;
  const restY = (r) => (r >= L.n ? L.binTop - L.ballR : L.pegTop + r * L.dy - L.pegR - L.ballR);
  const binX = (k) => L.binsLeft + (k + 0.5) * L.dx;
  const barTopY = (k) => L.floorY - 1 - disp[k];

  function sizeCanvas(c, W, H) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }

  function buildStatic() {
    const { W, H, n } = L;
    sizeCanvas(staticLayer, W, H);
    const s = staticLayer.getContext('2d');
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    s.clearRect(0, 0, W, H);

    // Funnel
    const fw = Math.min(W * 0.12, L.dx * 2.5, 70);
    const exit = L.ballR * 1.8;
    s.strokeStyle = colors.funnel;
    s.lineWidth = 2;
    s.lineCap = 'round';
    s.beginPath();
    s.moveTo(L.cx - fw, L.funnelTop);
    s.lineTo(L.cx - exit, L.funnelTop + L.funnelH);
    s.moveTo(L.cx + fw, L.funnelTop);
    s.lineTo(L.cx + exit, L.funnelTop + L.funnelH);
    s.stroke();

    // Pegs
    s.fillStyle = colors.peg;
    s.beginPath();
    for (let r = 0; r < n; r++) {
      const y = L.pegTop + r * L.dy;
      for (let k = 0; k <= r; k++) {
        const x = pegX(r, k);
        s.moveTo(x + L.pegR, y);
        s.arc(x, y, L.pegR, 0, Math.PI * 2);
      }
    }
    s.fill();

    // Bin walls
    s.strokeStyle = colors.divider;
    s.lineWidth = 1;
    s.beginPath();
    for (let i = 0; i <= n + 1; i++) {
      const x = Math.round(L.binsLeft + i * L.dx) + 0.5;
      s.moveTo(x, L.binTop);
      s.lineTo(x, L.floorY);
    }
    s.stroke();

    // Floor
    s.strokeStyle = colors.floor;
    s.lineWidth = 2;
    s.beginPath();
    s.moveTo(L.binsLeft, L.floorY);
    s.lineTo(L.binsRight, L.floorY);
    s.stroke();

    // Bin index labels
    const every = L.dx >= 18 ? 1 : L.dx >= 9 ? 2 : 4;
    s.fillStyle = colors.label;
    s.font = `11px ${colors.font}`;
    s.textAlign = 'center';
    s.textBaseline = 'top';
    for (let k = 0; k <= n; k += every) s.fillText(formatNumber(k), binX(k), L.floorY + 6);

    // Bars gradient (signature, horizontal)
    barGradient = ctx.createLinearGradient(L.binsLeft, 0, L.binsRight, 0);
    barGradient.addColorStop(0, colors.g0);
    barGradient.addColorStop(0.5, colors.g50);
    barGradient.addColorStop(1, colors.g100);
  }

  function buildSprite() {
    const r = L.ballR;
    const size = Math.ceil((r * 2 + 2) * dpr);
    ballSprite.width = ballSprite.height = size;
    const s = ballSprite.getContext('2d');
    const c = size / 2;
    const rr = r * dpr;
    const g = s.createRadialGradient(c - rr * 0.35, c - rr * 0.4, rr * 0.05, c, c, rr);
    g.addColorStop(0, colors.highlight);
    g.addColorStop(0.45, colors.ball);
    g.addColorStop(1, colors.edge);
    s.clearRect(0, 0, size, size);
    s.fillStyle = g;
    s.beginPath();
    s.arc(c, c, rr, 0, Math.PI * 2);
    s.fill();

    const tr = Math.max(1.5, r * 0.7);
    const ts = Math.ceil(tr * 2 + 2);
    trailSprite.width = trailSprite.height = ts;
    const ts2 = trailSprite.getContext('2d');
    ts2.globalAlpha = 0.35;
    ts2.fillStyle = colors.ball;
    ts2.beginPath();
    ts2.arc(ts / 2, ts / 2, tr, 0, Math.PI * 2);
    ts2.fill();
  }

  function resize() {
    const W = board.clientWidth;
    if (!W) return;
    const H = boardHeight(W);
    board.style.height = `${H}px`;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    sizeCanvas(canvas, W, H);
    trailLayer.width = W; // trails render at 1× to keep the fade pass cheap
    trailLayer.height = H;
    trailCtx = trailLayer.getContext('2d');
    computeLayout(W, H);
    buildStatic();
    buildSprite();
    const unit = L.binH / scaleMax();
    for (let k = 0; k < bins.length; k++) disp[k] = bins[k] * unit;
    needsDraw = true;
  }

  /* ---------- Balls ---------- */
  function land(k) {
    bins[k]++;
    state.landed++;
    state.sum += k;
    state.sumSq += k * k;
    if (bins[k] > state.maxBin) state.maxBin = bins[k];
    statsDirty = true;
    needsDraw = true;
  }

  function sampleBin() {
    let k = 0;
    for (let r = 0; r < state.rows; r++) if (Math.random() < state.p) k++;
    return k;
  }

  function spawn(count) {
    for (let i = 0; i < count; i++) {
      state.spawned++;
      if (reducedMotion || !L.W) {
        land(sampleBin());
        continue;
      }
      const b = pool.pop() || {};
      b.kind = 0;
      b.step = 0;
      b.k = 0;
      b.x0 = b.x1 = L.cx;
      b.y0 = L.spawnY;
      b.y1 = restY(0);
      b.t = 0;
      b.dur = FUNNEL_TIME;
      active.push(b);
    }
    if (count) statsDirty = true;
  }

  /** Move a ball to its next leg. Returns false when it has landed. */
  function advance(b) {
    if (b.kind === 2) {
      land(b.k);
      return false;
    }
    if (b.step < state.rows) {
      const dir = Math.random() < state.p ? 1 : 0;
      b.x0 = pegX(b.step, b.k);
      b.y0 = restY(b.step);
      b.k += dir;
      b.step++;
      b.x1 = pegX(b.step, b.k);
      b.y1 = restY(b.step);
      b.kind = 1;
      b.dur = HOP_TIME;
    } else {
      b.x0 = b.x1 = binX(b.k);
      b.y0 = restY(state.rows);
      b.kind = 2;
      b.dur = FALL_TIME;
    }
    return true;
  }

  // Position of a ball, written to posX/posY (no per-ball allocation).
  let posX = 0;
  let posY = 0;
  function ballPos(b) {
    const t = b.t;
    if (b.kind === 1) {
      posX = b.x0 + (b.x1 - b.x0) * ease(t);
      posY = b.y0 + (b.y1 - b.y0) * t * t - L.lift * Math.sin(Math.PI * t);
      return;
    }
    const y1 = b.kind === 2 ? Math.max(b.y0, barTopY(b.k) - L.ballR) : b.y1;
    posX = b.x0;
    posY = b.y0 + (y1 - b.y0) * t * t;
  }

  function releaseAll() {
    while (active.length) pool.push(active.pop());
  }

  /** Finish every ball in flight instantly (used when reduced motion turns on). */
  function flushActive() {
    for (const b of active) {
      let k = b.k;
      for (let r = b.step; r < state.rows; r++) if (Math.random() < state.p) k++;
      land(k);
    }
    releaseAll();
  }

  /* ---------- Commands ---------- */
  const remaining = () => Math.max(0, state.total - state.spawned - state.burstQueue);

  function setPlaying(on) {
    state.playing = on;
    state.playAcc = 0;
    renderPlayButton();
  }

  function togglePlay() {
    if (state.playing) return setPlaying(false);
    if (remaining() === 0 && active.length === 0) reset(false);
    if (remaining() === 0) return;
    setPlaying(true);
  }

  function drop(n) {
    const k = Math.min(n, remaining());
    if (!k) return;
    if (reducedMotion) spawn(k);
    else state.burstQueue += k;
    updateButtons();
  }

  function reset(keepPlaying) {
    const wasPlaying = state.playing;
    releaseAll();
    bins = new Uint32Array(state.rows + 1);
    disp = new Float32Array(state.rows + 1);
    Object.assign(state, { spawned: 0, landed: 0, sum: 0, sumSq: 0, maxBin: 0, playAcc: 0, burstQueue: 0, burstAcc: 0 });
    computeTheory();
    if (L.W) {
      computeLayout(L.W, L.H);
      buildStatic();
      buildSprite();
    }
    trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    trailCtx.clearRect(0, 0, trailLayer.width, trailLayer.height);
    trailFrames = 0;
    setPlaying(Boolean(keepPlaying && wasPlaying));
    statsDirty = true;
    needsDraw = true;
    lastLiveLanded = -1;
  }

  let fadeTimer = 0;
  function fadeReset() {
    clearTimeout(fadeTimer);
    if (reducedMotion) return reset(true);
    board.classList.add('is-fading');
    fadeTimer = setTimeout(() => {
      reset(true);
      board.classList.remove('is-fading');
    }, FADE_MS);
  }

  /* ---------- Frame loop ---------- */
  let last = performance.now();
  let lastStats = 0;

  function update(dt) {
    const speed = SPEEDS[state.speedIndex];

    if (state.playing) {
      state.playAcc += dt * PLAY_RATE * speed;
      const n = Math.min(state.playAcc | 0, remaining());
      state.playAcc -= n;
      spawn(n);
      if (remaining() === 0) setPlaying(false);
    }
    if (state.burstQueue > 0) {
      state.burstAcc += dt * BURST_RATE * speed;
      const n = Math.min(state.burstAcc | 0, state.burstQueue);
      state.burstAcc -= n;
      state.burstQueue -= n;
      spawn(n);
      if (!state.burstQueue) state.burstAcc = 0;
    }

    const step = dt * speed;
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      b.t += step / b.dur;
      let alive = true;
      while (b.t >= 1) {
        b.t = (b.t - 1) * (b.kind === 2 ? 0 : b.dur); // carry leftover time into the next leg
        if (!advance(b)) { alive = false; break; }
        b.t /= b.dur;
      }
      if (!alive) {
        active[i] = active[active.length - 1];
        active.pop();
        pool.push(b);
      }
    }

    // Bars ease toward their target height
    const unit = L.binH / scaleMax();
    const a = reducedMotion ? 1 : Math.min(1, dt * 10);
    let moving = false;
    for (let k = 0; k < bins.length; k++) {
      const target = bins[k] * unit;
      const d = target - disp[k];
      if (Math.abs(d) > 0.05) {
        disp[k] += d * a;
        moving = true;
      } else disp[k] = target;
    }

    if (active.length || moving) needsDraw = true;
    if (state.trails && (active.length || trailFrames > 0)) needsDraw = true;
  }

  function draw() {
    const { W, H } = L;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Bars
    const gap = L.dx > 8 ? 1.5 : 0.75;
    ctx.fillStyle = barGradient;
    for (let k = 0; k < bins.length; k++) {
      const h = disp[k];
      if (h < 0.5) continue;
      ctx.fillRect(L.binsLeft + k * L.dx + gap, L.floorY - 1 - h, L.dx - gap * 2, h);
    }

    // Theoretical curve (normal approximation), scaled to balls in the bins
    if (state.curve && state.landed > 0 && theory.sd > 0) {
      const unit = L.binH / scaleMax();
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.binsLeft, L.binTop - 2, L.binsRight - L.binsLeft, L.floorY - L.binTop + 2);
      ctx.clip();
      ctx.beginPath();
      for (let px = L.binsLeft; px <= L.binsRight + 1; px += 2) {
        const x = (px - L.binsLeft) / L.dx - 0.5;
        const y = L.floorY - 1 - state.landed * normalPdf(x) * unit;
        if (px === L.binsLeft) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.strokeStyle = colors.curve;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Trails: persistent 1× layer that fades a little each frame
    if (state.trails) {
      const th = trailSprite.width / 2;
      trailCtx.globalCompositeOperation = 'destination-out';
      trailCtx.fillStyle = 'rgba(0,0,0,0.2)';
      trailCtx.fillRect(0, 0, trailLayer.width, trailLayer.height);
      trailCtx.globalCompositeOperation = 'source-over';
      if (active.length) {
        const count = Math.min(active.length, MAX_TRAIL_BALLS);
        for (let i = 0; i < count; i++) {
          ballPos(active[i]);
          trailCtx.drawImage(trailSprite, Math.round(posX - th), Math.round(posY - th));
        }
        trailFrames = 30;
      } else trailFrames--;
    }

    // Balls: blit the sprite at native size on whole device pixels (no resampling)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const h = ballSprite.width / 2;
    for (let i = 0; i < active.length; i++) {
      ballPos(active[i]);
      ctx.drawImage(ballSprite, Math.round(posX * dpr - h), Math.round(posY * dpr - h));
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (L.W) {
      update(dt);
      if (needsDraw) {
        draw();
        needsDraw = false;
      }
    }
    if (statsDirty && now - lastStats > STATS_INTERVAL) {
      renderStats();
      lastStats = now;
      statsDirty = false;
    }
    requestAnimationFrame(frame);
  }

  /* ---------- UI rendering ---------- */
  const fmtInt = (v) => formatNumber(v, { maximumFractionDigits: 0 });
  const fmt2 = (v) => formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const DASH = '–';

  function observed() {
    const n = state.landed;
    const mean = n ? state.sum / n : NaN;
    const sd = n > 1 ? Math.sqrt(Math.max(0, (state.sumSq - n * mean * mean) / (n - 1))) : NaN;
    return { mean, sd };
  }

  function renderStats() {
    const { mean, sd } = observed();
    ui.dropped.textContent = `${fmtInt(state.landed)} / ${fmtInt(state.total)}`;
    ui.mean.textContent = Number.isFinite(mean) ? fmt2(mean) : DASH;
    ui.sd.textContent = Number.isFinite(sd) ? fmt2(sd) : DASH;
    ui.tmean.textContent = fmt2(theory.mean);
    ui.tsd.textContent = fmt2(theory.sd);
    updateButtons();
  }

  let lastLiveLanded = -1;
  function renderLive() {
    if (state.landed === lastLiveLanded) return;
    lastLiveLanded = state.landed;
    const { mean, sd } = observed();
    ui.live.textContent = t('galton.live', {
      dropped: fmtInt(state.landed),
      total: fmtInt(state.total),
      mean: Number.isFinite(mean) ? fmt2(mean) : DASH,
      sd: Number.isFinite(sd) ? fmt2(sd) : DASH,
      tmean: fmt2(theory.mean),
      tsd: fmt2(theory.sd),
    });
    renderCanvasLabel();
  }

  function renderCanvasLabel() {
    canvas.setAttribute('aria-label', t('galton.canvasLabel', {
      rows: fmtInt(state.rows), bins: fmtInt(state.rows + 1), dropped: fmtInt(state.landed),
    }));
  }

  function renderPlayButton() {
    const key = state.playing ? 'galton.pause' : 'galton.play';
    ui.play.innerHTML = `${icon(state.playing ? 'pause' : 'play', { size: 16 })}<span>${t(key)}</span>`;
  }

  function updateButtons() {
    const none = remaining() === 0;
    ui.drop1.disabled = none;
    ui.drop100.disabled = none;
  }

  function setFill(input) {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function renderOutputs() {
    const speed = `${formatNumber(SPEEDS[state.speedIndex], { maximumFractionDigits: 2 })}×`;
    const pText = fmt2(state.p);
    ui.outRows.textContent = fmtInt(state.rows);
    ui.outTotal.textContent = fmtInt(state.total);
    ui.outSpeed.textContent = speed;
    ui.outP.textContent = pText;
    ui.rows.setAttribute('aria-valuetext', fmtInt(state.rows));
    ui.total.setAttribute('aria-valuetext', fmtInt(state.total));
    ui.speed.setAttribute('aria-valuetext', speed);
    ui.p.setAttribute('aria-valuetext', pText);
    [ui.rows, ui.total, ui.speed, ui.p].forEach(setFill);
  }

  function renderStaticText() {
    renderPlayButton();
    ui.drop1.innerHTML = `${icon('arrowDown', { size: 16 })}<span>${t('galton.drop1')}</span>`;
    ui.drop100.innerHTML = `${icon('arrowDownToLine', { size: 16 })}<span>${t('galton.drop100')}</span>`;
    ui.reset.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${t('galton.reset')}</span>`;
    ui.shortcuts.innerHTML = t('galton.shortcuts', {
      space: `<kbd>${t('galton.key.space')}</kbd>`, r: '<kbd>R</kbd>', d: '<kbd>D</kbd>',
    });
    $('about-icon').innerHTML = icon('chevronDown', { size: 18 });
    renderOutputs();
    renderStats();
    renderCanvasLabel();
    lastLiveLanded = -1;
    if (L.W) {
      buildStatic(); // bin labels use locale digits
      needsDraw = true;
    }
  }

  /* ---------- Events ---------- */
  ui.play.addEventListener('click', togglePlay);
  ui.drop1.addEventListener('click', () => drop(1));
  ui.drop100.addEventListener('click', () => drop(100));
  ui.reset.addEventListener('click', () => reset(false));
  // After a pointer click, release focus so Space keeps meaning play/pause.
  // Keyboard activation (detail === 0) keeps focus and native button behavior.
  [ui.play, ui.drop1, ui.drop100, ui.reset].forEach((b) =>
    b.addEventListener('click', (e) => { if (e.detail > 0) b.blur(); })
  );

  ui.rows.addEventListener('input', () => {
    state.rows = Number(ui.rows.value);
    renderOutputs();
    fadeReset();
  });
  ui.p.addEventListener('input', () => {
    state.p = Number(ui.p.value);
    renderOutputs();
    fadeReset();
  });
  ui.total.addEventListener('input', () => {
    state.total = Number(ui.total.value);
    renderOutputs();
    statsDirty = true;
    needsDraw = true;
  });
  ui.speed.addEventListener('input', () => {
    state.speedIndex = Number(ui.speed.value);
    renderOutputs();
  });
  ui.curve.addEventListener('change', () => {
    state.curve = ui.curve.checked;
    needsDraw = true;
  });
  ui.trails.addEventListener('change', () => {
    state.trails = ui.trails.checked;
    trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    trailCtx.clearRect(0, 0, trailLayer.width, trailLayer.height);
    needsDraw = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat && e.key !== 'd' && e.key !== 'D') return;
    const target = e.target;
    if (e.key === ' ' || e.code === 'Space') {
      if (target.closest('button, a, summary, input[type="checkbox"], select, textarea')) return;
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'r' || e.key === 'R') {
      reset(false);
    } else if (e.key === 'd' || e.key === 'D') {
      drop(1);
    }
  });

  reducedMotionQuery.addEventListener('change', (e) => {
    reducedMotion = e.matches;
    if (reducedMotion) {
      state.burstQueue && spawn(state.burstQueue);
      state.burstQueue = 0;
      flushActive();
    }
  });

  new ResizeObserver(() => {
    if (board.clientWidth !== L.W) resize();
  }).observe(board);
  window.addEventListener('resize', () => resize());

  /* ---------- Boot ---------- */
  renderHeader({ variant: 'sim' });
  renderFooter();
  readColors();
  computeTheory();
  onLangChange(renderStaticText);
  initI18n();
  resize();
  setInterval(renderLive, LIVE_INTERVAL);
  requestAnimationFrame(frame);
})(window.LSS);
