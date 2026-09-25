/**
 * Push vs. Pull — UI and rendering (Explore mode + shared view for Game mode).
 * Simulation logic lives in engine.js; round logic in game.js.
 *
 * Time: 1× speed = 1 simulated minute per real second.
 */
(function (LSS) {
  'use strict';

  const { initI18n, onLangChange, t, formatNumber } = LSS.i18n;
  const { renderHeader, renderFooter } = LSS.header;
  const { icon } = LSS.icons;
  const { ease } = LSS.motion;
  const { PushPullSim, DEFAULTS, HISTORY_MINUTES } = LSS.PushPull;

  /* ---------- Constants ---------- */
  const SPEEDS = [0.5, 1, 2, 3, 5, 10];
  const DEFAULT_SEED = 20240601;
  const LINES = ['push', 'pull'];
  const TWEEN_MS = 220;
  const TWEEN_MIN_MS = 120;
  const UI_INTERVAL = 250;
  const LIVE_INTERVAL = 1000;
  const PULSE_MS = 1400;
  const FLASH_MS = 320;

  const BASE = {
    demandRate: 1.0, cv: 0.5, mix: 0.6, bias: 0, noise: 0.1, capA: 1.4, capB: 1.3,
    changeover: false, period: 10, safety: 5, cards: [4, 3], holdCost: 1, backorderCost: 5,
    autoRelease: true, schedule: [],
  };
  const PRESETS = [
    { key: 'p1', params: { noise: 0, safety: 6 } },
    { key: 'p2', params: { bias: 0.3, cards: [5, 4] } },
    { key: 'p3', params: { cards: [5, 4], schedule: [{ t: 30.5, type: 'mix' }] } },
    { key: 'p4', params: { cards: [1, 1] } },
    { key: 'p5', params: { noise: 0, safety: 6, cards: [15, 12] } },
  ];

  // Explore parameter controls
  const PARAM_GROUPS = [
    { key: 'demand', items: [
      { key: 'demandRate', min: 0.5, max: 1.5, step: 0.05, fmt: (v) => t('pp.fmt.rate', { v: fmt(v, 2) }) },
      { key: 'cv', min: 0, max: 1, step: 0.05, fmt: (v) => fmt(v, 2) },
      { key: 'mix', min: 0.1, max: 0.9, step: 0.05, fmt: (v) => t('pp.fmt.mix', { a: pct(v), b: pct(1 - v) }) },
    ] },
    { key: 'forecast', items: [
      { key: 'bias', min: -0.5, max: 0.5, step: 0.05, fmt: (v) => formatNumber(v, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }) },
      { key: 'noise', min: 0, max: 0.5, step: 0.05, fmt: (v) => pct(v) },
    ] },
    { key: 'capacity', items: [
      { key: 'capA', min: 0.8, max: 3, step: 0.05, fmt: (v) => t('pp.fmt.rate', { v: fmt(v, 2) }) },
      { key: 'capB', min: 0.8, max: 3, step: 0.05, fmt: (v) => t('pp.fmt.rate', { v: fmt(v, 2) }) },
      { key: 'changeover', type: 'switch' },
    ] },
    { key: 'push', items: [
      { key: 'period', min: 5, max: 30, step: 5, fmt: (v) => t('pp.fmt.min', { v: fmtInt(v) }) },
      { key: 'safety', min: 0, max: 15, step: 1, fmt: (v) => t('pp.fmt.min', { v: fmtInt(v) }) },
    ] },
    { key: 'pull', items: [
      { key: 'cards0', min: 1, max: 20, step: 1, fmt: (v) => fmtInt(v) },
      { key: 'cards1', min: 1, max: 20, step: 1, fmt: (v) => fmtInt(v) },
    ], note: 'sizing' },
    { key: 'cost', items: [
      { key: 'holdCost', min: 0, max: 5, step: 0.5, fmt: (v) => fmt(v, 1) },
      { key: 'backorderCost', min: 0, max: 20, step: 1, fmt: (v) => fmtInt(v) },
    ], note: 'cost' },
  ];

  /* ---------- Formatting ---------- */
  const DASH = '–';
  const fmt = (v, d = 1) => (Number.isFinite(v) ? formatNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);
  const fmtInt = (v) => (Number.isFinite(v) ? formatNumber(v, { maximumFractionDigits: 0 }) : DASH);
  const pct = (v, d = 0) => (Number.isFinite(v) ? formatNumber(v, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  LINES.forEach((line) => {
    $(`lane-${line}`).innerHTML = `
      <div class="lane__head">
        <h2 class="lane__name" data-i18n="pp.lane.${line}"></h2>
        <span class="lane__rule" data-i18n="pp.lane.${line}Rule"></span>
        <span class="lane__pulse" id="pulse-${line}" aria-hidden="true"></span>
      </div>
      <div class="lane__track" id="track-${line}">
        <canvas class="lane__canvas" id="canvas-${line}" role="img"></canvas>
        ${['rm', 'a', 'b', 'fg', 'cust'].map((st) => `
          <div class="station">
            <span class="station__label" data-i18n="pp.st.${st}"></span>
            <div class="station__visual" data-anchor="${st}"></div>
            ${st === 'cust' ? `<span class="bo-badge" id="bo-${line}" hidden></span>` : ''}
          </div>`).join('')}
      </div>
      <div class="scorecard" id="score-${line}">
        <dl class="scorecard__stats">
          ${['fill', 'inv', 'lt', 'bo', 'wrong', 'cost'].map((k) => `<div><dt data-i18n="pp.kpi.${k}"></dt><dd id="k-${line}-${k}"></dd></div>`).join('')}
        </dl>
        <canvas class="scorecard__spark" id="spark-${line}" aria-hidden="true"></canvas>
        <p class="scorecard__hidden" data-i18n="pp.kpiHidden" hidden></p>
      </div>`;
  });

  $('legend').innerHTML = [
    ['square', 'pp.legend.sku1'], ['circle', 'pp.legend.sku2'], ['card', 'pp.legend.card'], ['served', 'pp.legend.served'], ['bo', 'pp.legend.bo'],
  ].map(([cls, key]) => `<li><span class="shape shape--${cls}" aria-hidden="true"></span><span data-i18n="${key}"></span></li>`).join('');

  $('params').innerHTML = PARAM_GROUPS.map((g) => `
    <div class="param-group">
      <p class="eyebrow" data-i18n="pp.group.${g.key}"></p>
      ${g.items.map((it) => (it.type === 'switch'
        ? `<label class="switch"><span data-i18n="pp.param.${it.key}"></span><input type="checkbox" role="switch" id="in-${it.key}"></label>`
        : `<div class="field">
            <div class="field__head">
              <label class="field__label" for="in-${it.key}" data-i18n="pp.param.${it.key}"></label>
              <output class="field__value" for="in-${it.key}" id="out-${it.key}"></output>
            </div>
            <input type="range" id="in-${it.key}" min="${it.min}" max="${it.max}" step="${it.step}">
          </div>`)).join('')}
      ${g.note ? `<p class="param-note" id="note-${g.note}"></p>` : ''}
    </div>`).join('');

  $('preset-list').innerHTML = PRESETS.map((p, i) => `
    <button type="button" class="preset-btn" data-preset="${i}" aria-pressed="false">
      <span class="preset-btn__key" aria-hidden="true">${i + 1}</span><span data-i18n="pp.${p.key}.name"></span>
    </button>`).join('');

  const ui = {
    play: $('btn-play'), reset: $('btn-reset'), seed: $('btn-seed'), speed: $('in-speed'), outSpeed: $('out-speed'),
    seedLabel: $('seed-label'), clock: $('clock'), live: $('live-region'), compare: $('compare'),
    presetBtns: [...document.querySelectorAll('.preset-btn')], presetText: $('preset-text'),
    modeBtns: [...document.querySelectorAll('.mode-switch__btn')],
    explore: $('explore-panel'), game: $('game-panel'), shortcuts: $('shortcuts'),
  };

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;

  /* ---------- Colors (tokens) ---------- */
  let C = {};
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    C = {
      unit: v('--amcor-cyan'), unitStrong: v('--cyan-600'), navy: v('--amcor-navy'), line: v('--neutral-200'),
      station: v('--navy-200'), track: v('--neutral-100'), surface: v('--color-surface'), text: v('--color-text-muted'),
      subtle: v('--color-text-subtle'), success: v('--color-success'), danger: v('--color-danger'), event: v('--color-bottleneck'),
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  /* ---------- State ---------- */
  let params = clone(BASE);
  let seed = DEFAULT_SEED;
  let sim = null;
  let playing = false;
  let speedIndex = Number(ui.speed.value);
  let presetIdx = 0;
  let mode = 'explore';
  let kpisHidden = false;
  let runTarget = Infinity;
  let runDone = null;
  const view = {};           // per line: { sprites, flashUntil, pulseUntil, lastServed, lastRelease }

  function clone(p) { return Object.assign({}, p, { cards: p.cards.slice(), schedule: (p.schedule || []).map((e) => ({ ...e })) }); }

  function newSim(p) {
    params = clone(p);
    sim = new PushPullSim(Object.assign(clone(params), { seed }));
    runTarget = Infinity;
    runDone = null;
    LINES.forEach((l) => { view[l] = { sprites: new Map(), flashUntil: 0, pulseUntil: 0, lastServed: 0, lastRelease: null }; });
    renderUi();
    return sim;
  }

  function loadPreset(i) {
    presetIdx = i;
    newSim(Object.assign(clone(BASE), clone(Object.assign({}, BASE, PRESETS[i].params))));
    setPreset(i);
    syncControls();
  }

  function setPreset(i) {
    presetIdx = i;
    ui.presetBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    // Off-preset (a control changed or an event fired): the scenario guidance no longer applies.
    ui.presetText.textContent = i >= 0 ? t(`pp.${PRESETS[i].key}.obs`) : t('pp.presets.custom');
  }

  function applyParam(key, value) {
    if (key === 'cards0' || key === 'cards1') {
      const cards = params.cards.slice();
      cards[key === 'cards0' ? 0 : 1] = value;
      params.cards = cards;
      sim.setParams({ cards });
    } else {
      params[key] = value;
      sim.setParams({ [key]: value });
    }
    setPreset(-1);
    syncControls();
  }

  /* ---------- Layout per lane ---------- */
  const L = {};
  let dpr = 1;
  let needsLayout = true;

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    LINES.forEach((line) => {
      const track = $(`track-${line}`);
      const canvas = $(`canvas-${line}`);
      const base = track.getBoundingClientRect();
      if (!base.width) return;
      canvas.width = Math.round(base.width * dpr);
      canvas.height = Math.round(base.height * dpr);
      const r = (name) => {
        const e = track.querySelector(`[data-anchor="${name}"]`).getBoundingClientRect();
        return { x: e.left - base.left, y: e.top - base.top, w: e.width, h: e.height };
      };
      const small = base.width < 480;
      const U = small ? 7 : 9;
      const G = small ? 2 : 3;
      const step = U + G;
      const rm = r('rm');
      const cy = rm.y + (small ? 32 : 38);
      const S = Math.min(small ? 26 : 38, rm.w * 0.8);
      const box = (v, align) => ({ x: align === 'right' ? v.x + v.w - S - 2 : v.x + (v.w - S) / 2, y: cy - S / 2, s: S });
      const stationGeom = (v) => {
        const st = box(v, 'right');
        let rows = Math.max(1, Math.floor(((small ? 52 : 64) + G) / step));
        if (rows % 2 === 0) rows--; // odd, so the middle row sits on the flow line
        const cols = Math.max(1, Math.floor((st.x - 6 - v.x) / step));
        return { v, st, q: { x1: st.x - 6, top: cy - U / 2 - Math.floor(rows / 2) * step, rows, cols } };
      };
      const fg = r('fg');
      const fgCols = Math.max(1, Math.floor((fg.w - 4) / step));
      const fgRows = Math.max(1, Math.floor(((small ? 26 : 30) + G) / step));
      L[line] = {
        W: base.width, H: base.height, U, G, step, cy, S, small,
        rm: box(rm, 'center'),
        a: stationGeom(r('a')),
        b: stationGeom(r('b')),
        fg: { v: fg, cols: fgCols, rows: fgRows, x: fg.x + (fg.w - fgCols * step + G) / 2 },
        cust: box(r('cust'), 'center'),
        cardY: cy + (small ? 40 : 46),
      };
    });
  }

  /* ---------- Tweening ---------- */
  let tweenMs = TWEEN_MS;
  let frameId = 0;
  function place(line, key, tx, ty, now, from) {
    const map = view[line].sprites;
    let s = map.get(key);
    if (!s) {
      const [fx, fy] = from || [tx, ty];
      s = { x: fx, y: fy, fx, fy, tx, ty, t0: now };
      map.set(key, s);
    } else if (Math.abs(s.tx - tx) > 0.5 || Math.abs(s.ty - ty) > 0.5) {
      s.fx = s.x; s.fy = s.y; s.tx = tx; s.ty = ty; s.t0 = now;
    }
    if (reduced) { s.x = tx; s.y = ty; } else {
      const e = ease(Math.min(1, (now - s.t0) / tweenMs));
      s.x = s.fx + (s.tx - s.fx) * e;
      s.y = s.fy + (s.ty - s.fy) * e;
    }
    s.seen = frameId;
    return s;
  }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function drawShape(ctx, sku, x, y, U) {
    if (sku === 0) { rrect(ctx, x, y, U, U, 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(x + U / 2, y + U / 2, U / 2, 0, Math.PI * 2); ctx.fill(); }
  }

  /* ---------- Lane drawing ---------- */
  function drawLane(line, now) {
    const g = L[line];
    if (!g) return;
    const ctx = $(`canvas-${line}`).getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.W, g.H);
    const Ln = sim.lines[line];
    const v = view[line];
    const { U, step, cy } = g;

    // Flow line
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(g.rm.x + g.rm.s, cy);
    ctx.lineTo(g.cust.x, cy);
    ctx.stroke();

    // Pull: card return track (FG → raw material), below the flow
    if (line === 'pull') {
      const x0 = g.fg.v.x + g.fg.v.w / 2;
      const x1 = g.rm.x + g.rm.s / 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, cy + 18);
      ctx.lineTo(x0, g.cardY);
      ctx.lineTo(x1, g.cardY);
      ctx.lineTo(x1, g.rm.y + g.rm.s + 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); // arrow head into raw material
      ctx.moveTo(x1 - 4, g.rm.y + g.rm.s + 8);
      ctx.lineTo(x1, g.rm.y + g.rm.s + 2);
      ctx.lineTo(x1 + 4, g.rm.y + g.rm.s + 8);
      ctx.stroke();
    }

    // Raw material box (pulses on push releases)
    const pulsing = now < v.pulseUntil;
    ctx.fillStyle = C.surface;
    ctx.strokeStyle = pulsing ? C.unitStrong : C.station;
    ctx.lineWidth = pulsing ? 2.5 : 1.5;
    ctx.setLineDash([4, 3]);
    rrect(ctx, g.rm.x, g.rm.y, g.rm.s, g.rm.s, 6);
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);

    // Stations A, B
    [g.a, g.b].forEach((sg, i) => {
      const { st } = sg;
      ctx.fillStyle = C.surface;
      ctx.strokeStyle = C.station;
      ctx.lineWidth = 1.5;
      rrect(ctx, st.x, st.y, st.s, st.s, 6);
      ctx.fill(); ctx.stroke();
      const x = Ln.st[i];
      const cx = st.x + st.s / 2;
      const r = st.s * 0.36;
      ctx.strokeStyle = C.track;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      if (x.unit) {
        const frac = Math.min(1, Math.max(0, (sim.t - x.start) / Math.max(1e-9, x.end - x.start)));
        ctx.strokeStyle = C.unitStrong;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
        ctx.lineCap = 'butt';
      }
    });

    // Customer box (flash green when served)
    const flashing = now < v.flashUntil;
    ctx.fillStyle = C.surface;
    ctx.strokeStyle = flashing ? C.success : C.station;
    ctx.lineWidth = flashing ? 2.5 : 1.5;
    rrect(ctx, g.cust.x, g.cust.y, g.cust.s, g.cust.s, 6);
    ctx.fill(); ctx.stroke();

    // Units
    ctx.fillStyle = C.unit;
    ctx.font = `10px ${C.font}`;
    ctx.textBaseline = 'bottom';
    const fromRm = [g.rm.x + (g.rm.s - U) / 2, cy - U / 2];
    const queue = (q, sg) => {
      const cap = sg.q.rows * sg.q.cols;
      const n = Math.min(q.length, cap);
      for (let j = 0; j < n; j++) {
        const col = Math.floor(j / sg.q.rows);
        const k = j % sg.q.rows; // fill each column from the flow line outwards
        const mid = Math.floor((sg.q.rows - 1) / 2);
        const row = mid + (k % 2 ? -Math.ceil(k / 2) : Math.ceil(k / 2));
        const sp = place(line, q[j].id, sg.q.x1 - (col + 1) * step + g.G, sg.q.top + row * step, now, fromRm);
        drawShape(ctx, q[j].sku, sp.x, sp.y, U);
      }
      if (q.length > cap) {
        ctx.fillStyle = C.text;
        ctx.fillText(`+${fmtInt(q.length - cap)}`, sg.v.x, sg.q.top - 2);
        ctx.fillStyle = C.unit;
      }
    };
    queue(Ln.qA, g.a);
    queue(Ln.qB, g.b);
    [g.a, g.b].forEach((sg, i) => {
      const x = Ln.st[i];
      if (!x.unit) return;
      const sp = place(line, x.unit.id, sg.st.x + (sg.st.s - U) / 2, cy - U / 2, now, fromRm);
      drawShape(ctx, x.unit.sku, sp.x, sp.y, U);
    });

    // Finished goods: SKU 1 row(s) above the flow line, SKU 2 below
    for (let s = 0; s < 2; s++) {
      const fgList = Ln.fg[s];
      const cap = g.fg.cols * g.fg.rows;
      const n = Math.min(fgList.length, cap);
      const top = s === 0 ? cy - 4 - g.fg.rows * step + g.G : cy + 4;
      for (let j = 0; j < n; j++) {
        const sp = place(line, fgList[j].id, g.fg.x + (j % g.fg.cols) * step, top + Math.floor(j / g.fg.cols) * step, now, null);
        drawShape(ctx, s, sp.x, sp.y, U);
      }
      if (fgList.length > cap) {
        ctx.fillStyle = C.text;
        ctx.textBaseline = s === 0 ? 'bottom' : 'top';
        ctx.fillText(`+${fmtInt(fgList.length - cap)}`, g.fg.v.x, s === 0 ? top - 2 : top + g.fg.rows * step + 1);
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = C.unit;
      }
    }

    // Pull: kanban cards travelling back
    if (line === 'pull') {
      const x0 = g.fg.v.x + g.fg.v.w / 2;
      const x1 = g.rm.x + g.rm.s / 2;
      const cw = g.small ? 10 : 12;
      const ch = g.small ? 7 : 8;
      for (const c of Ln.cardsInTransit) {
        const p = Math.min(1, Math.max(0, (sim.t - c.depart) / Math.max(1e-9, c.arrive - c.depart)));
        const x = x0 + (x1 - x0) * (reduced ? Math.round(p * 4) / 4 : p) - cw / 2;
        const y = g.cardY - ch / 2;
        ctx.fillStyle = C.surface;
        ctx.strokeStyle = C.unitStrong;
        ctx.lineWidth = 1.5;
        rrect(ctx, x, y, cw, ch, 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.unitStrong;
        const m = 3;
        if (c.sku === 0) ctx.fillRect(x + cw / 2 - m / 2, y + ch / 2 - m / 2, m, m);
        else { ctx.beginPath(); ctx.arc(x + cw / 2, y + ch / 2, m / 2 + 0.3, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    for (const [k, sp] of v.sprites) if (sp.seen !== frameId) v.sprites.delete(k);
  }

  /* ---------- Sparklines ---------- */
  function drawSparks() {
    const x1 = Math.max(HISTORY_MINUTES, sim.t);
    const x0 = x1 - HISTORY_MINUTES;
    let yMax = 1;
    LINES.forEach((l) => { for (const [, v] of sim.lines[l].history) if (v > yMax) yMax = v; });
    yMax *= 1.1;
    LINES.forEach((l) => {
      const c = $(`spark-${l}`);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const X = (tt) => ((tt - x0) / (x1 - x0)) * w;
      const Y = (v) => h - 2 - (v / yMax) * (h - 4);
      ctx.strokeStyle = C.track;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h - 1.5); ctx.lineTo(w, h - 1.5); ctx.stroke();
      ctx.strokeStyle = C.event;
      ctx.lineWidth = 1.5;
      for (const ev of sim.events) if (ev.t >= x0) { ctx.beginPath(); ctx.moveTo(X(ev.t), 0); ctx.lineTo(X(ev.t), h); ctx.stroke(); }
      ctx.strokeStyle = C.unit;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      sim.lines[l].history.forEach(([tt, v], i) => { if (i === 0) ctx.moveTo(X(tt), Y(v)); else ctx.lineTo(X(tt), Y(v)); });
      ctx.stroke();
    });
  }

  /* ---------- KPIs ---------- */
  const KPIS = [
    { key: 'fill', get: (m) => m.fillRate, fmt: (v) => pct(v), better: 'high' },
    { key: 'inv', get: (m) => m.avgInventory, fmt: (v) => fmt(v), better: 'low' },
    { key: 'lt', get: (m) => m.leadTime, fmt: (v) => t('pp.fmt.minShort', { v: fmt(v) }), better: 'low' },
    { key: 'bo', get: (m) => m.backordersTotal, fmt: (v) => fmtInt(v), better: 'low' },
    { key: 'wrong', get: (m) => m.wrongMix, fmt: (v) => fmt(v), better: 'low' },
    { key: 'cost', get: (m) => m.cost, fmt: (v) => fmt(v), better: 'low' },
  ];
  function winner(k, a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const tol = k.key === 'fill' ? 0.005 : Math.max(Math.abs(a), Math.abs(b)) * 0.02;
    if (Math.abs(a - b) <= tol) return null;
    return (k.better === 'high') === (a > b) ? 'push' : 'pull';
  }

  function renderUi() {
    if (!sim) return;
    const m = sim.metrics();
    ui.clock.textContent = t('pp.clock', { t: fmtInt(Math.floor(m.t)) });
    ui.seedLabel.textContent = t('pp.seed', { seed: String(seed) });
    LINES.forEach((l) => {
      const lm = m[l];
      const score = $(`score-${l}`);
      score.querySelector('.scorecard__stats').hidden = kpisHidden;
      score.querySelector('.scorecard__spark').hidden = kpisHidden;
      score.querySelector('.scorecard__hidden').hidden = !kpisHidden;
      KPIS.forEach((k) => {
        const el = $(`k-${l}-${k.key}`);
        el.textContent = k.key === 'bo' ? `${fmtInt(lm.backordersNow)} / ${fmtInt(lm.backordersTotal)}` : k.fmt(k.get(lm));
      });
      const bo = $(`bo-${l}`);
      bo.hidden = lm.backordersNow === 0;
      bo.textContent = fmtInt(lm.backordersNow);
      bo.setAttribute('aria-label', t('pp.boBadge', { n: fmtInt(lm.backordersNow) }));
    });
    // Comparison table
    const better = `<span class="better-mark">${icon('check', { size: 14 })}</span><span class="sr-only">${esc(t('pp.compare.better'))}</span>`;
    ui.compare.hidden = kpisHidden;
    $('compare-note').textContent = kpisHidden ? t('pp.kpiHidden') : t('pp.compare.note');
    ui.compare.innerHTML = `
      <thead><tr><th scope="col">${esc(t('pp.compare.kpi'))}</th><th scope="col">${esc(t('pp.lane.push'))}</th><th scope="col">${esc(t('pp.lane.pull'))}</th></tr></thead>
      <tbody>${KPIS.map((k) => {
        const a = k.get(m.push);
        const b = k.get(m.pull);
        const w = winner(k, a, b);
        const label = k.key === 'cost' ? `${esc(t('pp.kpi.costLong'))}<span class="compare__cost-note">${esc(t('pp.kpi.costNote'))}</span>` : esc(t(`pp.kpi.${k.key}Long`));
        return `<tr><th scope="row">${label}</th>
          <td class="${w === 'push' ? 'is-better' : ''}">${w === 'push' ? better : ''}${esc(k.fmt(a))}</td>
          <td class="${w === 'pull' ? 'is-better' : ''}">${w === 'pull' ? better : ''}${esc(k.fmt(b))}</td></tr>`;
      }).join('')}</tbody>`;
  }

  function renderLive() {
    if (!sim) return;
    const m = sim.metrics();
    const text = kpisHidden ? t('pp.liveHidden', { t: fmtInt(Math.floor(m.t)) }) : t('pp.live', {
      pf: pct(m.push.fillRate), pi: fmt(m.push.avgInventory), pb: fmtInt(m.push.backordersNow),
      qf: pct(m.pull.fillRate), qi: fmt(m.pull.avgInventory), qb: fmtInt(m.pull.backordersNow),
    });
    if (ui.live.textContent !== text) ui.live.textContent = text;
    LINES.forEach((l) => {
      const Ln = sim.lines[l];
      $(`canvas-${l}`).setAttribute('aria-label', t('pp.canvasLabel', {
        line: t(`pp.lane.${l}`), a: fmtInt(Ln.qA.length), b: fmtInt(Ln.qB.length),
        f1: fmtInt(Ln.fg[0].length), f2: fmtInt(Ln.fg[1].length), bo: fmtInt(Ln.backlog[0] + Ln.backlog[1]),
        cards: fmtInt(Ln.cardsInTransit.length),
      }));
    });
  }

  function trackEvents(now) {
    LINES.forEach((l) => {
      const Ln = sim.lines[l];
      const v = view[l];
      const served = Ln.servedNow[0] + Ln.servedNow[1];
      if (served > v.lastServed) v.flashUntil = now + FLASH_MS;
      v.lastServed = served;
      if (Ln.lastRelease && Ln.lastRelease !== v.lastRelease) {
        v.lastRelease = Ln.lastRelease;
        const q = Ln.lastRelease.qty;
        if (q[0] + q[1] > 0) {
          v.pulseUntil = now + PULSE_MS;
          const el = $(`pulse-${l}`);
          el.textContent = t('pp.pulse', { a: fmtInt(q[0]), b: fmtInt(q[1]), t: fmtInt(Ln.lastRelease.t) });
        }
      }
      $(`pulse-${l}`).classList.toggle('is-active', now < v.pulseUntil);
    });
  }

  /* ---------- Controls ---------- */
  function setFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function paramValue(key) {
    if (key === 'cards0') return params.cards[0];
    if (key === 'cards1') return params.cards[1];
    return params[key];
  }

  function syncControls() {
    PARAM_GROUPS.forEach((g) => g.items.forEach((it) => {
      const el = $(`in-${it.key}`);
      if (it.type === 'switch') { el.checked = Boolean(params[it.key]); return; }
      const v = paramValue(it.key);
      el.value = v;
      const text = it.fmt(v);
      $(`out-${it.key}`).textContent = text;
      el.setAttribute('aria-valuetext', text);
      setFill(el);
    }));
    const sp = `${formatNumber(SPEEDS[speedIndex], { maximumFractionDigits: 1 })}×`;
    ui.speed.value = speedIndex;
    ui.outSpeed.textContent = sp;
    ui.speed.setAttribute('aria-valuetext', sp);
    setFill(ui.speed);
    // Kanban sizing rule of thumb: cards ≈ demand × replenishment time + safety (1 unit)
    const rep = DEFAULTS.cardDelay + 1 / params.capA + 1 / params.capB + 1;
    const d = [params.demandRate * params.mix, params.demandRate * (1 - params.mix)];
    $('note-sizing').textContent = t('pp.note.sizing', { a: fmtInt(Math.ceil(d[0] * rep + 1)), b: fmtInt(Math.ceil(d[1] * rep + 1)), rep: fmt(rep) });
    $('note-cost').textContent = t('pp.note.cost');
  }

  function renderPlay() {
    ui.play.innerHTML = `${icon(playing ? 'pause' : 'play', { size: 16 })}<span>${esc(t(playing ? 'pp.pause' : 'pp.play'))}</span>`;
  }

  function renderText() {
    renderPlay();
    ui.reset.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${esc(t('pp.reset'))}</span>`;
    ui.seed.innerHTML = `${icon('shuffle', { size: 16 })}<span>${esc(t('pp.newSeed'))}</span>`;
    ui.shortcuts.innerHTML = t('pp.shortcuts', { space: `<kbd>${esc(t('pp.key.space'))}</kbd>`, r: '<kbd>R</kbd>', keys: '<kbd>1</kbd>–<kbd>5</kbd>' });
    $('learn-icon').innerHTML = icon('chevronDown', { size: 18 });
    ui.modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    setPreset(ui.presetBtns.findIndex((b) => b.getAttribute('aria-pressed') === 'true'));
    syncControls();
    renderUi();
    renderLive();
    if (game) game.render();
    needsLayout = true;
  }

  function setPlaying(on) {
    playing = on;
    renderPlay();
    if (game) game.onPlayingChange(on);
  }

  /* ---------- App API used by game.js ---------- */
  const app = {
    newSim: (p, s) => { if (s !== undefined) seed = s; setPlaying(false); return newSim(p); },
    get sim() { return sim; },
    get playing() { return playing; },
    setPlaying,
    runFor(minutes, done) {
      runTarget = sim.t + minutes;
      runDone = done;
      setPlaying(true);
    },
    setKpisHidden(on) { kpisHidden = on; renderUi(); renderLive(); },
    get speedIndex() { return speedIndex; },
    setSpeed(i) { speedIndex = i; syncControls(); },
    speeds: SPEEDS,
    fmt, fmtInt, pct, esc, KPIS, winner,
    colors: () => C,
  };
  let game = null;

  function setMode(m) {
    mode = m;
    ui.modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    ui.explore.hidden = m !== 'explore';
    ui.game.hidden = m !== 'game';
    setPlaying(false);
    if (m === 'game') {
      game = LSS.PushPullGame.mount(app, ui.game);
    } else {
      if (game) game.unmount();
      game = null;
      kpisHidden = false;
      seed = DEFAULT_SEED;
      loadPreset(0);
    }
    needsLayout = true;
  }

  /* ---------- Events ---------- */
  ui.play.addEventListener('click', () => setPlaying(!playing));
  ui.reset.addEventListener('click', () => { const p = clone(params); newSim(p); });
  ui.seed.addEventListener('click', () => { seed = 1 + Math.floor(Math.random() * 999999); newSim(clone(params)); });
  ui.speed.addEventListener('input', () => { speedIndex = Number(ui.speed.value); syncControls(); });
  document.querySelectorAll('[data-event]').forEach((b) => b.addEventListener('click', () => { sim.applyEvent(b.dataset.event); setPreset(-1); }));
  ui.presetBtns.forEach((b, i) => b.addEventListener('click', () => loadPreset(i)));
  ui.modeBtns.forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== mode) setMode(b.dataset.mode); }));
  PARAM_GROUPS.forEach((g) => g.items.forEach((it) => {
    const el = $(`in-${it.key}`);
    if (it.type === 'switch') el.addEventListener('change', () => applyParam(it.key, el.checked));
    else el.addEventListener('input', () => applyParam(it.key, Number(el.value)));
  }));

  // After a pointer click, release focus so Space keeps meaning play/pause.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.pp button');
    if (b && e.detail > 0) b.blur();
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tgt = e.target;
    const typing = tgt.closest('input[type="number"], select, textarea');
    if (e.key === ' ' || e.code === 'Space') {
      if (typing || tgt.closest('button, a, summary, input[type="checkbox"], input[type="radio"]')) return;
      if (mode === 'game' && !(game && game.canToggle())) return;
      e.preventDefault();
      setPlaying(!playing);
    } else if (mode === 'explore' && !typing && (e.key === 'r' || e.key === 'R')) {
      newSim(clone(params));
    } else if (mode === 'explore' && !typing && /^[1-5]$/.test(e.key)) {
      loadPreset(Number(e.key) - 1);
    }
  });

  reducedQuery.addEventListener('change', (e) => { reduced = e.matches; });
  new ResizeObserver(() => { needsLayout = true; }).observe(document.querySelector('.lanes-card'));

  /* ---------- Frame loop ---------- */
  let last = performance.now();
  let lastUi = 0;
  let lastLive = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (needsLayout) { layout(); needsLayout = false; }
    if (playing && sim) {
      let step = dt * SPEEDS[speedIndex];
      if (sim.t + step >= runTarget) step = Math.max(0, runTarget - sim.t);
      sim.advance(step);
      if (sim.t >= runTarget - 1e-9) {
        const done = runDone;
        runTarget = Infinity;
        runDone = null;
        setPlaying(false);
        if (done) done();
      }
    }
    if (sim) {
      frameId++;
      tweenMs = Math.max(TWEEN_MIN_MS, Math.min(TWEEN_MS, (TWEEN_MS * 2) / SPEEDS[speedIndex]));
      trackEvents(now);
      LINES.forEach((l) => drawLane(l, now));
      if (!kpisHidden) drawSparks();
      if (now - lastUi > UI_INTERVAL) { renderUi(); lastUi = now; }
      if (now - lastLive > LIVE_INTERVAL) { renderLive(); lastLive = now; }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Boot ---------- */
  renderHeader({ variant: 'sim' });
  renderFooter();
  readColors();
  loadPreset(0);
  onLangChange(renderText);
  initI18n();
  const startMode = new URLSearchParams(location.search).get('mode');
  if (startMode === 'game') setMode('game');
  requestAnimationFrame(frame);
})(window.LSS);
