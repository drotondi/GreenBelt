/**
 * Little's Law — UI and rendering. All simulation logic lives in engine.js;
 * this file only drives the clock, draws the line and charts, and binds controls.
 *
 * Time: 1× speed = 1 simulated minute per real second.
 */
(function (LSS) {
  'use strict';

  const { initI18n, onLangChange, t, formatNumber } = LSS.i18n;
  const { renderHeader, renderFooter } = LSS.header;
  const { icon } = LSS.icons;
  const { ease } = LSS.motion;
  const { LittleEngine, HISTORY_MINUTES } = LSS.LittleEngine;

  /* ---------- Constants ---------- */
  const SPEEDS = [0.5, 1, 2, 3, 5, 10];
  const SIM_MINUTES_PER_SECOND = 1;
  const DEFAULT_SEED = 20240601;
  const TWEEN_MS = 220;     // at ≤ 2×; shortens with speed, never below 120 ms
  const TWEEN_MIN_MS = 120;
  const UNIT = 10;          // unit square size (px)
  const GAP = 3;
  const SINK_COLS = 6;
  const SINK_ROWS = 4;
  const UI_INTERVAL = 200;
  const LIVE_INTERVAL = 1000;
  const AVG_SAMPLE = 0.5;   // simulated minutes between running-average samples
  const BOTTLENECK_MARGIN = 0.03; // utilization lead needed to name a bottleneck
  const BOTTLENECK_KEEP = 0.01;   // hysteresis: keep the current one within this gap

  const SCENARIOS = [
    { key: 's1', params: { lambda: 1.5, mu: [2, 2, 2], cv: 0.2, policy: 'push', wipCap: 8 } },
    { key: 's2', params: { lambda: 1.5, mu: [2.5, 1.7, 2.5], cv: 0.5, policy: 'push', wipCap: 8 } },
    { key: 's3', params: { lambda: 2.0, mu: [2.5, 1.7, 2.5], cv: 0.3, policy: 'push', wipCap: 8 } },
    { key: 's4', params: { lambda: 1.5, mu: [2, 2, 2], cv: 1.0, policy: 'push', wipCap: 8 } },
    { key: 's5', params: { lambda: 2.0, mu: [2.5, 1.7, 2.5], cv: 0.3, policy: 'pull', wipCap: 8 } },
  ];

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const flow = $('flow');
  const flowCanvas = $('flow-canvas');
  const fctx = flowCanvas.getContext('2d');
  const processNodes = [...document.querySelectorAll('.node--process')];
  const sinkVisual = document.querySelector('[data-anchor="sink"]');
  const tip = $('sink-tip');
  flow.appendChild(tip); // position tooltip in flow coordinates

  processNodes.forEach((node, i) => {
    node.querySelector('.node__controls').innerHTML = `
      <div class="field">
        <div class="field__head">
          <label class="field__label" for="in-mu${i}" data-i18n-cap="${i + 1}"></label>
          <output class="field__value" for="in-mu${i}" id="out-mu${i}"></output>
        </div>
        <input type="range" id="in-mu${i}" min="0.5" max="6" step="0.1" value="2">
        <p class="node__hint" id="cycle-${i}"></p>
      </div>
      <dl class="mini-stats">
        <div class="mini-stats__util">
          <dt data-i18n="ll.util"></dt>
          <dd><span id="util-${i}"></span><span class="util-bar" aria-hidden="true"><span class="util-bar__fill" id="utilbar-${i}"></span></span></dd>
        </div>
        <div><dt data-i18n="ll.queueNow"></dt><dd id="q-${i}"></dd></div>
        <div><dt data-i18n="ll.queueAvg"></dt><dd id="qa-${i}"></dd></div>
      </dl>`;
  });

  const ui = {
    play: $('btn-play'), reset: $('btn-reset'), seed: $('btn-seed'),
    lambda: $('in-lambda'), outLambda: $('out-lambda'), lambdaInterval: $('lambda-interval'),
    mu: [0, 1, 2].map((i) => $(`in-mu${i}`)), outMu: [0, 1, 2].map((i) => $(`out-mu${i}`)), cycle: [0, 1, 2].map((i) => $(`cycle-${i}`)),
    util: [0, 1, 2].map((i) => $(`util-${i}`)), utilBar: [0, 1, 2].map((i) => $(`utilbar-${i}`)),
    q: [0, 1, 2].map((i) => $(`q-${i}`)), qa: [0, 1, 2].map((i) => $(`qa-${i}`)),
    speed: $('in-speed'), outSpeed: $('out-speed'), cv: $('in-cv'), outCv: $('out-cv'),
    cap: $('in-cap'), outCap: $('out-cap'), policyBtns: [...document.querySelectorAll('.segmented__btn')],
    eqWip: $('eq-wip'), eqTh: $('eq-th'), eqLt: $('eq-lt'), eqWipSub: $('eq-wip-sub'), eqThSub: $('eq-th-sub'), eqLtSub: $('eq-lt-sub'),
    chip: $('eq-chip'), chipIcon: $('eq-chip-icon'), chipText: $('eq-chip-text'), product: $('eq-product'),
    live: $('live-region'), backlog: $('backlog-text'), done: $('done-count'),
    seedLabel: $('seed-label'), clock: $('clock-label'), shortcuts: $('shortcuts'),
    scenList: $('scen-list'), scenText: $('scen-observe-text'),
    chartWip: $('chart-wip'), chartLt: $('chart-lt'),
  };
  ui.scenList.innerHTML = SCENARIOS.map((s, i) => `
    <button type="button" class="scen-btn" data-scen="${i}" aria-pressed="false">
      <span class="scen-btn__key" aria-hidden="true">${i + 1}</span><span data-i18n="ll.${s.key}.name"></span>
    </button>`).join('');
  const scenBtns = [...ui.scenList.querySelectorAll('.scen-btn')];

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;
  const verticalQuery = matchMedia('(max-width: 719px)');

  /* ---------- Colors (from tokens) ---------- */
  let C = {};
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    C = {
      unit: v('--amcor-cyan'), unitStrong: v('--cyan-600'), navy: v('--amcor-navy'), line: v('--neutral-200'),
      station: v('--navy-200'), track: v('--neutral-100'), bottleneck: v('--color-bottleneck'), text: v('--color-text-muted'),
      subtle: v('--color-text-subtle'), grid: v('--neutral-100'), band: v('--neutral-50'), surface: v('--color-surface'),
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  /* ---------- Formatting ---------- */
  const DASH = '–';
  const fmt = (v, d = 2) => (Number.isFinite(v) ? formatNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);
  const fmtMax = (v, d = 1) => (Number.isFinite(v) ? formatNumber(v, { maximumFractionDigits: d }) : DASH);
  const fmtInt = (v) => formatNumber(v, { maximumFractionDigits: 0 });
  const fmtPct = (v, d = 0) => (Number.isFinite(v) ? formatNumber(v, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);

  /* ---------- State ---------- */
  let params = clone(SCENARIOS[0].params);
  let seed = DEFAULT_SEED;
  let engine = null;
  let playing = false;
  let speedIndex = Number(ui.speed.value);
  let scenarioIdx = 0;
  let bands = [];           // warm-up intervals [start, end] for the charts
  let avgHist = { wip: [], lt: [] };
  let nextAvgSample = 0;
  let bottleneck = -1;
  let metrics = null;
  let selectedDone = null;  // id of the sink unit shown in the tooltip

  function clone(p) { return Object.assign({}, p, { mu: p.mu.slice() }); }

  function newEngine() {
    engine = new LittleEngine(Object.assign(clone(params), { seed }));
    bands = [[engine.measureStart, engine.warmupEnd]];
    avgHist = { wip: [], lt: [] };
    nextAvgSample = 0;
    bottleneck = -1;
    sprites.clear();
    selectedDone = null;
    hideTip();
    metrics = engine.metrics();
  }

  function applyParams(partial) {
    Object.assign(params, partial);
    if (partial.mu) params.mu = partial.mu.slice();
    engine.setParams(partial);
    const last = bands[bands.length - 1];
    if (last && engine.measureStart <= last[1]) last[1] = engine.warmupEnd;
    else bands.push([engine.measureStart, engine.warmupEnd]);
    avgHist.wip.push([engine.t, NaN]);
    avgHist.lt.push([engine.t, NaN]);
    setScenario(-1);
    syncControls();
    metrics = engine.metrics();
    renderUi();
  }

  function loadScenario(i) {
    params = clone(SCENARIOS[i].params);
    newEngine();
    setScenario(i);
    syncControls();
    renderUi();
  }

  function setScenario(i) {
    if (i >= 0) scenarioIdx = i;
    scenBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    ui.scenText.textContent = t(`ll.${SCENARIOS[scenarioIdx].key}.obs`);
  }

  /* ---------- Layout (canvas geometry measured from the DOM) ---------- */
  let L = null;
  let dpr = 1;

  function rectOf(el, base) {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  }

  function layout() {
    const base = flow.getBoundingClientRect();
    const W = base.width;
    const H = base.height;
    if (!W || !H) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    flowCanvas.width = Math.round(W * dpr);
    flowCanvas.height = Math.round(H * dpr);
    const vertical = verticalQuery.matches;
    const step = UNIT + GAP;
    const anchor = (name) => rectOf(flow.querySelector(`[data-anchor="${name}"]`), base);

    // Source: box plus backlog grid below it
    const sv = anchor('source');
    const sb = Math.min(40, sv.w * 0.5);
    const source = { x: sv.x + (sv.w - sb) / 2, y: sv.y + 4, s: sb };
    const blTop = source.y + sb + 10;
    const blCols = Math.max(1, Math.floor((sv.w - 8) / step));
    const blRows = Math.max(0, Math.floor((sv.y + sv.h - blTop) / step));
    const backlog = { x: sv.x + (sv.w - blCols * step) / 2, y: blTop, cols: blCols, rows: blRows };

    const stations = [0, 1, 2].map((i) => {
      const v = anchor(`p${i}`);
      const S = Math.min(52, v.h * 0.42, v.w * (vertical ? 0.55 : 0.34));
      if (!vertical) {
        const st = { x: v.x + v.w - S - 4, y: v.y + (v.h - S) / 2, s: S };
        const qx0 = v.x + 2;
        const qx1 = st.x - 8;
        const rows = Math.max(1, Math.floor((v.h - 20) / step)); // leave room for the "+N" label
        const cols = Math.max(1, Math.floor((qx1 - qx0) / step));
        return { v, st, q: { x0: qx0, x1: qx1, cy: st.y + S / 2, rows, cols, top: st.y + S / 2 - (rows * step - GAP) / 2 } };
      }
      const st = { x: v.x + (v.w - S) / 2, y: v.y + v.h - S - 2, s: S };
      const qy0 = v.y + 2;
      const qy1 = st.y - 8;
      const cols = Math.max(1, Math.floor((v.w - 4) / step));
      const rows = Math.max(1, Math.floor((qy1 - qy0) / step));
      return { v, st, q: { y0: qy0, y1: qy1, cx: v.x + v.w / 2, rows, cols } };
    });

    const kv = anchor('sink');
    const sink = {
      x: kv.x + (kv.w - SINK_COLS * step + GAP) / 2,
      y: kv.y + (kv.h - SINK_ROWS * step + GAP) / 2,
      v: kv,
    };

    L = { W, H, vertical, source, backlog, stations, sink, step };
  }

  function queueSlot(i, j) {
    const { q } = L.stations[i];
    const step = L.step;
    if (!L.vertical) {
      const col = Math.floor(j / q.rows);
      const row = j % q.rows;
      return [q.x1 - (col + 1) * step + GAP, q.cy - (q.rows * step - GAP) / 2 + row * step];
    }
    const row = Math.floor(j / q.cols);
    const col = j % q.cols;
    return [q.cx - (q.cols * step - GAP) / 2 + col * step, q.y1 - (row + 1) * step + GAP];
  }
  const queueCapacity = (i) => L.stations[i].q.rows * L.stations[i].q.cols;
  const stationSlot = (i) => {
    const { st } = L.stations[i];
    return [st.x + (st.s - UNIT) / 2, st.y + (st.s - UNIT) / 2];
  };
  const sinkSlot = (k) => [L.sink.x + (k % SINK_COLS) * L.step, L.sink.y + Math.floor(k / SINK_COLS) * L.step];
  const backlogSlot = (j) => [L.backlog.x + (j % L.backlog.cols) * L.step, L.backlog.y + Math.floor(j / L.backlog.cols) * L.step];
  const sourceSlot = () => [L.source.x + (L.source.s - UNIT) / 2, L.source.y + (L.source.s - UNIT) / 2];

  /* ---------- Unit tweening ---------- */
  const sprites = new Map();
  let frameId = 0;

  let tweenMs = TWEEN_MS;
  function place(id, tx, ty, now, fromSource) {
    let s = sprites.get(id);
    if (!s) {
      const [sx, sy] = fromSource ? sourceSlot() : [tx, ty];
      s = { x: sx, y: sy, fx: sx, fy: sy, tx, ty, t0: now };
      sprites.set(id, s);
    } else if (Math.abs(s.tx - tx) > 0.5 || Math.abs(s.ty - ty) > 0.5) {
      s.fx = s.x;
      s.fy = s.y;
      s.tx = tx;
      s.ty = ty;
      s.t0 = now;
    }
    if (reduced) {
      s.x = tx;
      s.y = ty;
    } else {
      const e = ease(Math.min(1, (now - s.t0) / tweenMs));
      s.x = s.fx + (s.tx - s.fx) * e;
      s.y = s.fy + (s.ty - s.fy) * e;
    }
    s.seen = frameId;
    return s;
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  /* ---------- Flow drawing ---------- */
  function drawFlow(now) {
    if (!L) return;
    frameId++;
    tweenMs = Math.max(TWEEN_MIN_MS, Math.min(TWEEN_MS, (TWEEN_MS * 2) / SPEEDS[speedIndex]));
    const ctx = fctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    const e = engine;

    // Connector through the line
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const src = L.source;
    const pts = [[src.x + src.s / 2, src.y + src.s / 2]];
    L.stations.forEach(({ st }) => pts.push([st.x + st.s / 2, st.y + st.s / 2]));
    pts.push([L.sink.v.x + L.sink.v.w / 2, L.sink.v.y + L.sink.v.h / 2]);
    if (!L.vertical) {
      const y = pts[1][1];
      ctx.moveTo(pts[0][0] + src.s / 2, y);
      ctx.lineTo(L.sink.x - 8, y);
    } else {
      const x = pts[1][0];
      ctx.moveTo(x, pts[0][1] + src.s / 2);
      ctx.lineTo(x, L.sink.y - 8);
    }
    ctx.stroke();

    // Source box
    ctx.fillStyle = C.surface;
    ctx.strokeStyle = C.station;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    rrect(ctx, src.x, src.y, src.s, src.s, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // Stations
    L.stations.forEach(({ st }, i) => {
      const isB = i === bottleneck;
      ctx.fillStyle = C.surface;
      ctx.strokeStyle = isB ? C.bottleneck : C.station;
      ctx.lineWidth = isB ? 2.5 : 1.5;
      rrect(ctx, st.x, st.y, st.s, st.s, 6);
      ctx.fill();
      ctx.stroke();
      const cx = st.x + st.s / 2;
      const cy = st.y + st.s / 2;
      const r = st.s * 0.34;
      ctx.strokeStyle = C.track;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const s = e.stations[i];
      if (s.unit) {
        const frac = Math.min(1, Math.max(0, (e.t - s.start) / Math.max(1e-9, s.end - s.start)));
        ctx.strokeStyle = C.unitStrong;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    });

    // Units
    ctx.fillStyle = C.unit;
    const drawUnit = (sp) => { rrect(ctx, sp.x, sp.y, UNIT, UNIT, 2); ctx.fill(); };
    ctx.font = `11px ${C.font}`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < 3; i++) {
      const q = e.queues[i];
      const cap = queueCapacity(i);
      const n = Math.min(q.length, cap);
      for (let j = 0; j < n; j++) {
        const [x, y] = queueSlot(i, j);
        drawUnit(place(q[j].id, x, y, now, i === 0));
      }
      if (q.length > cap) {
        const { q: g } = L.stations[i];
        ctx.fillStyle = C.text;
        const label = `+${fmtInt(q.length - cap)}`;
        if (!L.vertical) ctx.fillText(label, g.x0, g.top - 16);
        else ctx.fillText(label, L.stations[i].v.x, g.y0 - 2);
        ctx.fillStyle = C.unit;
      }
      const s = e.stations[i];
      if (s.unit) {
        const [x, y] = stationSlot(i);
        drawUnit(place(s.unit.id, x, y, now, i === 0));
      }
    }

    // Backlog (pull): outlined units, outside the line
    const blCap = L.backlog.cols * L.backlog.rows;
    if (e.backlog.length && blCap) {
      ctx.strokeStyle = C.unitStrong;
      ctx.lineWidth = 1.5;
      const n = Math.min(e.backlog.length, blCap);
      for (let j = 0; j < n; j++) {
        // Stable slot per unit: backlog ids are consecutive, so id % capacity never collides.
        const [x, y] = backlogSlot(e.backlog[j].id % blCap);
        const sp = place(e.backlog[j].id, x, y, now, true);
        rrect(ctx, sp.x + 0.75, sp.y + 0.75, UNIT - 1.5, UNIT - 1.5, 2);
        ctx.stroke();
      }
    }

    // Sink: last completed units in stable slots
    const rec = e.recent;
    const firstIndex = e.completedTotal - rec.length;
    for (let k = 0; k < rec.length; k++) {
      const slot = (firstIndex + k) % (SINK_COLS * SINK_ROWS);
      const [x, y] = sinkSlot(slot);
      const sp = place(rec[k].id, x, y, now, false);
      ctx.fillStyle = C.unit;
      drawUnit(sp);
      if (rec[k].id === selectedDone) {
        ctx.strokeStyle = C.navy;
        ctx.lineWidth = 2;
        rrect(ctx, sp.x - 2, sp.y - 2, UNIT + 4, UNIT + 4, 3);
        ctx.stroke();
      }
    }

    for (const [id, sp] of sprites) if (sp.seen !== frameId) sprites.delete(id);
  }

  /* ---------- Sink tooltip (hover, tap, keyboard) ---------- */
  function sinkUnitAt(px, py) {
    const rec = engine.recent;
    const firstIndex = engine.completedTotal - rec.length;
    for (let k = rec.length - 1; k >= 0; k--) {
      const [x, y] = sinkSlot((firstIndex + k) % (SINK_COLS * SINK_ROWS));
      if (px >= x - 2 && px <= x + UNIT + 2 && py >= y - 2 && py <= y + UNIT + 2) return rec[k];
    }
    return null;
  }

  function showTip(unit) {
    if (!unit) return hideTip();
    selectedDone = unit.id;
    const rec = engine.recent;
    const k = rec.indexOf(unit);
    const [x, y] = sinkSlot((engine.completedTotal - rec.length + k) % (SINK_COLS * SINK_ROWS));
    tip.textContent = t('ll.node.tooltip', { id: fmtInt(unit.id), lt: fmtMax(unit.leadTime, 2) });
    const left = Math.min(Math.max(x + UNIT / 2, 90), L.W - 90);
    tip.style.left = `${left}px`;
    tip.style.top = `${y}px`;
    tip.hidden = false;
  }
  function hideTip() {
    selectedDone = null;
    tip.hidden = true;
  }

  function flowPoint(e) {
    const r = flow.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  sinkVisual.addEventListener('pointermove', (e) => showTip(sinkUnitAt(...flowPoint(e))));
  sinkVisual.addEventListener('pointerdown', (e) => showTip(sinkUnitAt(...flowPoint(e))));
  sinkVisual.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
  sinkVisual.addEventListener('focus', () => { const r = engine.recent; if (r.length) showTip(r[r.length - 1]); });
  sinkVisual.addEventListener('blur', hideTip);
  sinkVisual.addEventListener('keydown', (e) => {
    const r = engine.recent;
    if (!r.length) return;
    let k = r.findIndex((u) => u.id === selectedDone);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') k = Math.max(0, (k < 0 ? r.length : k) - 1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') k = Math.min(r.length - 1, k + 1);
    else if (e.key === 'Escape') return hideTip();
    else return;
    e.preventDefault();
    showTip(r[k]);
  });

  /* ---------- Charts ---------- */
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  function drawChart(canvas, series, avg, { dots }) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 34, r: 8, t: 6, b: 18 };
    const x1 = Math.max(HISTORY_MINUTES, engine.t);
    const x0 = x1 - HISTORY_MINUTES;
    let max = 0;
    for (const [tt, v] of series) if (tt >= x0 && v > max) max = v;
    for (const [tt, v] of avg) if (tt >= x0 && v > max) max = v;
    const yMax = niceMax(max * 1.1);
    const X = (tt) => pad.l + ((tt - x0) / (x1 - x0)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v / yMax) * (h - pad.t - pad.b);

    // Warm-up bands
    ctx.fillStyle = C.band;
    for (const [a, b] of bands) {
      const aa = Math.max(a, x0);
      const bb = Math.min(b, engine.t);
      if (bb > aa) ctx.fillRect(X(aa), pad.t, X(bb) - X(aa), h - pad.t - pad.b);
    }

    // Grid and labels
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.subtle;
    ctx.font = `11px ${C.font}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      if (k % 2 === 0) ctx.fillText(fmtMax(v, 1), pad.l - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let tt = Math.ceil(x0 / 50) * 50; tt <= x1; tt += 50) {
      ctx.fillText(`${fmtInt(tt)} ${t('ll.charts.xUnit')}`, Math.min(Math.max(X(tt), pad.l + 16), w - 20), h - pad.b + 4);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t - 2, w - pad.l - pad.r, h - pad.t - pad.b + 4);
    ctx.clip();

    // Series
    if (dots) {
      ctx.fillStyle = C.unit;
      for (const [tt, v] of series) {
        if (tt < x0) continue;
        ctx.beginPath();
        ctx.arc(X(tt), Y(v), 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = C.unit;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const [tt, v] of series) {
        if (tt < x0) continue;
        if (!started) { ctx.moveTo(X(tt), Y(v)); started = true; } else ctx.lineTo(X(tt), Y(v));
      }
      ctx.stroke();
    }

    // Running average (dashed)
    ctx.strokeStyle = C.navy;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    let pen = false;
    for (const [tt, v] of avg) {
      if (tt < x0 || !Number.isFinite(v)) { pen = false; continue; }
      if (!pen) { ctx.moveTo(X(tt), Y(v)); pen = true; } else ctx.lineTo(X(tt), Y(v));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function sampleAverages() {
    while (nextAvgSample <= engine.t) {
      const m = engine.metrics({ percentiles: false });
      avgHist.wip.push([nextAvgSample, m.warm ? m.wipAvg : NaN]);
      avgHist.lt.push([nextAvgSample, m.completedInWindow ? m.leadTime : NaN]);
      nextAvgSample += AVG_SAMPLE;
    }
    const cut = engine.t - HISTORY_MINUTES;
    for (const k of ['wip', 'lt']) {
      let n = 0;
      while (n < avgHist[k].length && avgHist[k][n][0] < cut) n++;
      if (n) avgHist[k].splice(0, n);
    }
  }

  function drawCharts() {
    drawChart(ui.chartWip, engine.history.wip, avgHist.wip, { dots: false });
    drawChart(ui.chartLt, engine.history.lt, avgHist.lt, { dots: true });
  }

  /* ---------- UI text & state ---------- */
  function pickBottleneck(m) {
    if (!m.stable && params.policy === 'push') {
      // Overloaded: the lowest-capacity process is the constraint.
      return params.mu.indexOf(Math.min(...params.mu));
    }
    const early = m.t - engine.measureStart < 5;
    const u = m.stations.map((s, i) => (early ? params.lambda / params.mu[i] : (m.warm ? s.util : s.utilSinceStart)));
    const order = [0, 1, 2].sort((a, b) => u[b] - u[a]);
    const [top, second] = order;
    if (bottleneck >= 0) {
      const others = [0, 1, 2].filter((i) => i !== bottleneck).map((i) => u[i]);
      const lead = u[bottleneck] - Math.max(...others);
      if (u[bottleneck] >= u[top] - BOTTLENECK_KEEP && lead > BOTTLENECK_MARGIN / 2) return bottleneck;
    }
    return u[top] - u[second] >= BOTTLENECK_MARGIN ? top : -1;
  }

  function chipState(m) {
    if (!m.stable) return 'unstable';
    if (!m.warm) return 'stabilizing';
    if (m.completedInWindow < 10 || !Number.isFinite(m.littleDiff)) return 'waiting';
    return m.littleDiff <= 0.05 ? 'ok' : 'converging';
  }

  function renderUi() {
    const m = metrics;
    ui.eqWip.textContent = fmt(m.wipAvg);
    ui.eqTh.textContent = fmt(m.throughput);
    ui.eqLt.textContent = fmt(m.leadTime);
    ui.eqWipSub.textContent = t('ll.eq.wipNow', { value: fmtInt(m.wip) });
    ui.eqThSub.textContent = t('ll.eq.thRolling', { value: fmt(m.throughputRolling) });
    ui.eqLtSub.textContent = t('ll.eq.ltP90', { value: fmt(m.leadTimeP90, 1) });

    const state = chipState(m);
    ui.chip.dataset.state = state === 'waiting' ? 'stabilizing' : state;
    ui.chipIcon.innerHTML = icon(state === 'ok' ? 'check' : state === 'unstable' ? 'alert' : state === 'converging' ? 'info' : 'loader', { size: 16 });
    const diff = fmtPct(m.littleDiff, 1);
    ui.chipText.textContent =
      state === 'unstable' ? t('ll.chip.unstable')
        : state === 'stabilizing' ? t('ll.chip.stabilizing', { min: fmtInt(Math.ceil(m.warmupRemaining)) })
          : state === 'waiting' ? t('ll.chip.waiting')
            : state === 'ok' ? t('ll.chip.ok', { diff }) : t('ll.chip.converging', { diff });
    ui.product.textContent = Number.isFinite(m.littleProduct) ? t('ll.chip.product', { value: fmt(m.littleProduct) }) : '';

    bottleneck = pickBottleneck(m);
    processNodes.forEach((node, i) => {
      const s = m.stations[i];
      const u = m.warm ? s.util : s.utilSinceStart;
      ui.util[i].textContent = fmtPct(u);
      ui.utilBar[i].style.width = `${Number.isFinite(u) ? Math.min(100, u * 100) : 0}%`;
      ui.q[i].textContent = fmtInt(s.queue);
      ui.qa[i].textContent = fmt(s.avgQueue, 1);
      const isB = i === bottleneck;
      node.classList.toggle('is-bottleneck', isB);
      node.querySelector('.bottleneck-badge').hidden = !isB;
    });

    const showBacklog = params.policy === 'pull' || m.backlog > 0;
    ui.backlog.hidden = !showBacklog;
    ui.backlog.textContent = t('ll.node.backlog', { n: fmtInt(m.backlog) });
    ui.done.textContent = t('ll.node.completed', { n: fmtInt(m.completedTotal) });
    ui.clock.textContent = t('ll.clock', { t: fmtInt(Math.floor(m.t)) });
    ui.seedLabel.textContent = t('ll.seed', { seed: String(seed) });
  }

  function renderLive() {
    const m = metrics;
    const state = chipState(m);
    const diff = fmtPct(m.littleDiff, 1);
    const status = state === 'ok' ? t('ll.live.ok', { diff })
      : state === 'unstable' ? t('ll.live.unstable')
        : state === 'converging' ? t('ll.live.converging', { diff }) : t('ll.live.stabilizing');
    const text = t('ll.live', { wip: fmt(m.wipAvg), th: fmt(m.throughput), lt: fmt(m.leadTime), status });
    if (ui.live.textContent !== text) ui.live.textContent = text;
    flowCanvas.setAttribute('aria-label', t('ll.flowCanvasLabel', {
      q1: fmtInt(m.stations[0].queue), q2: fmtInt(m.stations[1].queue), q3: fmtInt(m.stations[2].queue), done: fmtInt(m.completedTotal),
    }));
    ui.chartWip.setAttribute('aria-label', t('ll.charts.wipLabel', { wip: fmtInt(m.wip), avg: fmt(m.wipAvg) }));
    const last = engine.recent[engine.recent.length - 1];
    ui.chartLt.setAttribute('aria-label', t('ll.charts.ltLabel', { lt: fmt(last ? last.leadTime : NaN), avg: fmt(m.leadTime) }));
  }

  function setFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function syncControls() {
    const rate = (v) => t('ll.rateValue', { value: fmt(v, 1) });
    ui.lambda.value = params.lambda;
    ui.outLambda.textContent = rate(params.lambda);
    ui.lambda.setAttribute('aria-valuetext', rate(params.lambda));
    ui.lambdaInterval.textContent = t('ll.interval', { value: fmtMax(60 / params.lambda, 1) });
    params.mu.forEach((mu, i) => {
      ui.mu[i].value = mu;
      ui.outMu[i].textContent = rate(mu);
      ui.mu[i].setAttribute('aria-valuetext', rate(mu));
      ui.cycle[i].textContent = t('ll.cycle', { value: fmtMax(60 / mu, 1) });
    });
    const sp = `${formatNumber(SPEEDS[speedIndex], { maximumFractionDigits: 1 })}×`;
    ui.speed.value = speedIndex;
    ui.outSpeed.textContent = sp;
    ui.speed.setAttribute('aria-valuetext', sp);
    ui.cv.value = params.cv;
    ui.outCv.textContent = fmt(params.cv);
    ui.cv.setAttribute('aria-valuetext', fmt(params.cv));
    ui.cap.value = params.wipCap;
    const pull = params.policy === 'pull';
    ui.cap.disabled = !pull;
    ui.outCap.textContent = pull ? fmtInt(params.wipCap) : t('ll.wipCapOff');
    ui.cap.setAttribute('aria-valuetext', pull ? fmtInt(params.wipCap) : t('ll.wipCapOff'));
    ui.policyBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.policy === params.policy)));
    [ui.lambda, ...ui.mu, ui.speed, ui.cv, ui.cap].forEach(setFill);
  }

  function renderPlay() {
    ui.play.innerHTML = `${icon(playing ? 'pause' : 'play', { size: 16 })}<span>${t(playing ? 'll.pause' : 'll.play')}</span>`;
  }

  function renderText() {
    document.querySelectorAll('[data-i18n-process]').forEach((el) => { el.textContent = t('ll.node.process', { n: el.dataset.i18nProcess }); });
    document.querySelectorAll('[data-i18n-cap]').forEach((el) => { el.textContent = t('ll.capacity', { n: el.dataset.i18nCap }); });
    renderPlay();
    ui.reset.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${t('ll.reset')}</span>`;
    ui.seed.innerHTML = `${icon('shuffle', { size: 16 })}<span>${t('ll.newSeed')}</span>`;
    ui.shortcuts.innerHTML = t('ll.shortcuts', {
      space: `<kbd>${t('ll.key.space')}</kbd>`, r: '<kbd>R</kbd>', keys: '<kbd>1</kbd>–<kbd>5</kbd>',
    });
    $('learn-icon').innerHTML = icon('chevronDown', { size: 18 });
    setScenario(scenBtns.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
    syncControls();
    renderUi();
    renderLive();
    hideTip();
    needsLayout = true;
  }

  /* ---------- Commands ---------- */
  function setPlaying(on) {
    playing = on;
    renderPlay();
  }
  function reset() {
    newEngine();
    renderUi();
  }
  function newSeed() {
    seed = 1 + Math.floor(Math.random() * 999999);
    reset();
  }

  /* ---------- Events ---------- */
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.reset.addEventListener('click', reset);
  ui.seed.addEventListener('click', newSeed);
  ui.lambda.addEventListener('input', () => applyParams({ lambda: Number(ui.lambda.value) }));
  ui.mu.forEach((el, i) => el.addEventListener('input', () => {
    const mu = params.mu.slice();
    mu[i] = Number(el.value);
    applyParams({ mu });
  }));
  ui.cv.addEventListener('input', () => applyParams({ cv: Number(ui.cv.value) }));
  ui.cap.addEventListener('input', () => applyParams({ wipCap: Number(ui.cap.value) }));
  ui.speed.addEventListener('input', () => { speedIndex = Number(ui.speed.value); syncControls(); });
  ui.policyBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.policy !== params.policy) applyParams({ policy: b.dataset.policy }); }));
  scenBtns.forEach((b, i) => b.addEventListener('click', () => loadScenario(i)));

  // After a pointer click, release focus so Space keeps meaning play/pause.
  document.querySelectorAll('.ll button').forEach((b) =>
    b.addEventListener('click', (e) => { if (e.detail > 0) b.blur(); })
  );

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (e.target.closest('button, a, summary, input[type="checkbox"], select, textarea')) return;
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.key === 'r' || e.key === 'R') {
      reset();
    } else if (/^[1-5]$/.test(e.key)) {
      loadScenario(Number(e.key) - 1);
    }
  });

  reducedQuery.addEventListener('change', (e) => { reduced = e.matches; });

  let needsLayout = true;
  new ResizeObserver(() => { needsLayout = true; }).observe(flow);
  verticalQuery.addEventListener('change', () => { needsLayout = true; sprites.clear(); });

  /* ---------- Frame loop ---------- */
  let last = performance.now();
  let lastUi = 0;
  let lastLive = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (needsLayout) {
      layout();
      needsLayout = false;
    }
    if (playing) {
      engine.advance(dt * SPEEDS[speedIndex] * SIM_MINUTES_PER_SECOND);
      sampleAverages();
    }
    drawFlow(now);
    drawCharts();
    if (now - lastUi > UI_INTERVAL) {
      metrics = engine.metrics();
      renderUi();
      lastUi = now;
    }
    if (now - lastLive > LIVE_INTERVAL) {
      renderLive();
      lastLive = now;
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Boot ---------- */
  renderHeader({ variant: 'sim' });
  renderFooter();
  readColors();
  newEngine();
  setScenario(0);
  onLangChange(renderText);
  initI18n();
  requestAnimationFrame(frame);
})(window.LSS);
