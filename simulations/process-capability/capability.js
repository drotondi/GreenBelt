/**
 * Process capability — UI and rendering (Explore, Process; Challenge via challenge.js).
 * Statistics live in engine.js and spc.js; charts use shared/sim/chart.js.
 */
(function (LSS) {
  'use strict';

  const { initI18n, onLangChange, t, formatNumber } = LSS.i18n;
  const { renderHeader, renderFooter } = LSS.header;
  const { icon } = LSS.icons;
  const { capability, CONTEXTS, ProcessSim, WINDOW, STATE_WINDOW } = LSS.Capability;
  const CH = LSS.chart;

  /* ---------- Constants ---------- */
  const SPEEDS = [0.5, 1, 2, 5, 10, 20];      // subgroups per second
  const DEFAULT_SEED = 20240601;
  const CHART_SUBGROUPS = 50;
  const ROLL_SUBGROUPS = 100;
  const RESULT_AFTER = 25;
  const UI_INTERVAL = 200;
  const LIVE_INTERVAL = 1000;

  // Presets relative to the context: c = center, h = half tolerance
  const PRESETS = [
    { key: 'p1', make: (c, h) => ({ mu: c, sigma: h / 5, lsl: c - h, usl: c + h, target: c, lslOn: true, uslOn: true }) },
    { key: 'p2', make: (c, h) => ({ mu: c + h / 2, sigma: 0.15 * h, lsl: c - h, usl: c + h, target: c, lslOn: true, uslOn: true }) },
    { key: 'p3', make: (c, h) => ({ mu: c, sigma: 0.4 * h, lsl: c - h, usl: c + h, target: c, lslOn: true, uslOn: true }) },
    { key: 'p4', make: (c, h) => ({ mu: c, sigma: h / 3, lsl: c - h, usl: c + h, target: c, lslOn: true, uslOn: true }) },
    { key: 'p5', make: (c, h) => ({ mu: c, sigma: h / 4, lsl: c - h, usl: c + h, target: c, lslOn: true, uslOn: false }) },
  ];

  /* ---------- Formatting ---------- */
  const DASH = '–';
  const num = (v, d) => (Number.isFinite(v) ? formatNumber(v, { minimumFractionDigits: d, maximumFractionDigits: d }) : DASH);
  const fmtIdx = (v, na) => (na ? t('pc.na') : num(v, 2));
  const fmtPPM = (v) => (Number.isFinite(v) ? formatNumber(v, { maximumFractionDigits: v < 10 ? 1 : 0 }) : DASH);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const ui = {
    modes: [...document.querySelectorAll('.pc-modes .segmented__btn')],
    kpiList: $('kpi-list'), stateChip: $('state-chip'), stateIcon: $('state-icon'), stateText: $('state-text'),
    bandChip: $('band-chip'), bandIcon: $('band-icon'), bandText: $('band-text'), kpiNote: $('kpi-note'), live: $('live-region'),
    dist: $('dist'), distCanvas: $('dist-canvas'), distHint: $('dist-hint'), distLegend: $('dist-legend'),
    handles: { lsl: $('handle-lsl'), mu: $('handle-mu'), usl: $('handle-usl') },
    histField: $('hist-field'), histWindow: $('hist-window'),
    exploreNote: $('explore-note'), viewSpc: $('view-spc'), viewRoll: $('view-rolling'),
    xbar: $('xbar-canvas'), rc: $('r-canvas'), roll: $('roll-canvas'), spcHint: $('spc-hint'), rollHint: $('roll-hint'),
    showSpecs: $('show-specs'), recalc: $('btn-recalc'), specNote: $('spec-note'), signals: $('signals'), tip: $('pc-tip'),
    params: $('params-panel'), paramGrid: $('param-grid'), run: $('run-row'), events: $('events-row'), presetsRow: $('presets-row'),
    play: $('btn-play'), step: $('btn-step'), reset: $('btn-reset'), seed: $('btn-seed'), seedLabel: $('seed-label'),
    predictOn: $('predict-on'), predict: $('predict'), presetList: $('preset-list'), presetText: $('preset-text'),
    challenge: $('challenge-panel'), shortcuts: $('shortcuts'),
  };

  const KPIS = ['cp', 'cpk', 'pp', 'ppk', 'ppmExp', 'ppmObs'];
  ui.kpiList.innerHTML = KPIS.map((k) => `<div class="kpi" id="kpi-${k}"><dt data-i18n="pc.kpi.${k}"></dt><dd><span id="kv-${k}"></span><span class="kpi__sub" id="ks-${k}"></span></dd></div>`).join('');
  ui.presetList.innerHTML = PRESETS.map((p, i) => `<button type="button" class="preset-btn" data-preset="${i}" aria-pressed="false"><span class="preset-btn__key" aria-hidden="true">${i + 1}</span><span data-i18n="pc.${p.key}.name"></span></button>`).join('');
  const presetBtns = [...ui.presetList.querySelectorAll('.preset-btn')];

  const PARAM_FIELDS = ['mu', 'sigma', 'lsl', 'usl', 'target'];
  ui.paramGrid.innerHTML = `
    ${PARAM_FIELDS.map((k) => `
      <div class="param-cell">
        <div class="field">
          <div class="field__head"><label class="field__label" for="in-${k}" data-i18n="pc.param.${k}"></label><output class="field__value" for="in-${k}" id="out-${k}"></output></div>
          <input type="range" id="in-${k}">
        </div>
        ${k === 'lsl' || k === 'usl' ? `<label class="switch"><span data-i18n="pc.param.${k}On"></span><input type="checkbox" role="switch" id="on-${k}" checked></label>` : ''}
      </div>`).join('')}
    <div class="param-cell" data-process>
      <div class="field">
        <div class="field__head"><label class="field__label" for="in-n" data-i18n="pc.param.n"></label><output class="field__value" for="in-n" id="out-n"></output></div>
        <input type="range" id="in-n" min="2" max="10" step="1" value="5">
      </div>
      <p class="param-note" data-i18n="pc.param.nNote"></p>
    </div>
    <div class="param-cell" data-process>
      <div class="field">
        <div class="field__head"><label class="field__label" for="in-speed" data-i18n="pc.param.speed"></label><output class="field__value" for="in-speed" id="out-speed"></output></div>
        <input type="range" id="in-speed" min="0" max="5" step="1" value="2">
      </div>
    </div>
    <div class="param-cell" data-process>
      <div class="field"><label class="field__label" for="in-shift" data-i18n="pc.param.shiftSize"></label><input class="num-input" type="number" id="in-shift" min="0.25" max="4" step="0.25" value="1.5"></div>
      <div class="field" style="margin-top: var(--space-2)"><label class="field__label" for="in-drift" data-i18n="pc.param.drift"></label><input class="num-input" type="number" id="in-drift" min="0.01" max="1" step="0.01" value="0.1"></div>
    </div>
    <div class="param-cell">
      <div class="field"><label class="field__label" for="in-context" data-i18n="pc.param.context"></label>
        <select class="pc-select" id="in-context">${Object.keys(CONTEXTS).map((k) => `<option value="${k}" data-i18n="pc.ctx.${k}"></option>`).join('')}</select>
      </div>
      <p class="param-note" data-i18n="pc.param.contextNote"></p>
    </div>
    <div class="param-cell">
      <div class="field"><label class="field__label" for="in-threshold" data-i18n="pc.param.threshold"></label><input class="num-input" type="number" id="in-threshold" min="0.5" max="3" step="0.01" value="1.33"></div>
      <p class="param-note" data-i18n="pc.param.thresholdNote"></p>
    </div>`;

  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedQuery.matches;

  /* ---------- Colors ---------- */
  let C = {};
  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (n) => css.getPropertyValue(n).trim();
    C = {
      navy: v('--amcor-navy'), cyan: v('--amcor-cyan'), cyanStrong: v('--cyan-600'), grid: v('--neutral-100'), axis: v('--neutral-300'),
      subtle: v('--color-text-subtle'), muted: v('--color-text-muted'), danger: v('--color-danger'), success: v('--color-success'),
      event: v('--color-bottleneck'), band: v('--neutral-50'), hist: v('--navy-100'), histStroke: v('--navy-200'), specAlt: v('--navy-500'),
      g0: v('--sim-gradient-0'), g50: v('--sim-gradient-50'), g100: v('--sim-gradient-100'), surface: v('--color-surface'),
      font: getComputedStyle(document.body).fontFamily,
    };
  }

  /* ---------- State ---------- */
  const S = {
    mode: 'explore',
    ctxKey: 'generic',
    p: null,
    n: 5,
    speedIdx: 2,
    threshold: 1.33,
    seed: DEFAULT_SEED,
    sim: null,
    playing: false,
    acc: 0,
    runLeft: Infinity,
    runDone: null,
    histWindow: '100',
    showSpecs: false,
    rules: { 1: true, 2: true, 3: true, 4: true },
    shiftSize: 1.5,
    drift: 0.1,
    presetIdx: 0,
    pending: null,       // prediction waiting for 25 subgroups
    lastResult: null,
    disp: null,          // animated curve parameters
    dirty: true,
  };
  const ctxOf = () => CONTEXTS[S.ctxKey];
  const dec = () => ctxOf().decimals;
  const fmtV = (v, extra = 0) => num(v, dec() + extra);
  const unit = () => t(`pc.unit.${S.ctxKey}`);

  function range(key) {
    const { center: c, half: h } = ctxOf();
    return {
      mu: [c - 2 * h, c + 2 * h, h / 100],
      sigma: [0.05 * h, 0.8 * h, h / 200],
      lsl: [c - 2.5 * h, c + h, h / 100],
      usl: [c - h, c + 2.5 * h, h / 100],
      target: [c - 2 * h, c + 2 * h, h / 100],
    }[key];
  }

  /* ---------- Parameters ---------- */
  function setParam(key, value, { fromHandle = false } = {}) {
    const [min, max, step] = range(key);
    let v = Math.min(max, Math.max(min, Math.round(value / step) * step));
    const gap = ctxOf().half / 10;
    if (key === 'lsl' && S.p.uslOn) v = Math.min(v, S.p.usl - gap);
    if (key === 'usl' && S.p.lslOn) v = Math.max(v, S.p.lsl + gap);
    S.p[key] = v;
    if (S.sim && key !== 'target') {
      if (key === 'mu' && fromHandle) S.sim.setParams({ mu: v - S.sim.offset });
      else S.sim.setParams({ [key]: v });
    }
    if (S.mode === 'explore') setPreset(-1);
    syncControls();
    S.dirty = true;
  }

  function loadPreset(i) {
    const { center: c, half: h } = ctxOf();
    S.p = PRESETS[i].make(c, h);
    setPreset(i);
    if (S.sim) newSim();
    syncControls();
    S.dirty = true;
  }

  function setPreset(i) {
    S.presetIdx = i;
    presetBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    ui.presetText.textContent = i >= 0 ? t(`pc.${PRESETS[i].key}.obs`) : t('pc.presets.custom');
  }

  function setContext(key) {
    const old = ctxOf();
    S.ctxKey = key;
    const nw = ctxOf();
    const map = (v) => nw.center + ((v - old.center) / old.half) * nw.half;
    S.p = { ...S.p, mu: map(S.p.mu), lsl: map(S.p.lsl), usl: map(S.p.usl), target: map(S.p.target), sigma: (S.p.sigma / old.half) * nw.half };
    if (S.sim) newSim();
    S.disp = null;
    syncControls();
    S.dirty = true;
  }

  /* ---------- Process ---------- */
  function newSim(params) {
    if (params) S.p = { ...S.p, ...params };
    S.sim = new ProcessSim({
      ...S.p, n: S.n, seed: S.seed, rules: { ...S.rules }, shiftSize: S.shiftSize, driftPerSubgroup: S.drift,
    });
    S.pending = null;
    S.lastResult = null;
    S.acc = 0;
    S.runLeft = Infinity;
    S.runDone = null;
    ui.predict.hidden = true;
    ui.predict.innerHTML = '';
    S.dirty = true;
    return S.sim;
  }

  function stepOnce() {
    S.sim.step();
    if (S.pending && S.sim.subgroups.length - S.pending.at >= RESULT_AFTER) finishPrediction();
    if (Number.isFinite(S.runLeft)) {
      S.runLeft--;
      if (S.runLeft <= 0) {
        const done = S.runDone;
        S.runLeft = Infinity;
        S.runDone = null;
        setPlaying(false);
        if (done) done();
      }
    }
    S.dirty = true;
  }

  function setPlaying(on) {
    S.playing = on;
    renderPlay();
  }

  function applyEvent(type, prediction) {
    const w = S.sim.windowStats();
    const size = type === 'shift' ? S.shiftSize : type === 'drift' ? S.drift : undefined;
    S.sim.event(type, size);
    if (prediction) {
      S.pending = { type, at: S.sim.subgroups.length, cpkBefore: w ? w.cpk : NaN, pred: prediction };
      renderPredictWaiting();
    }
    if (!S.playing) setPlaying(true);
    S.dirty = true;
  }

  function finishPrediction() {
    const pd = S.pending;
    S.pending = null;
    const w = S.sim.windowStats();
    const after = w ? w.cpk : NaN;
    const delta = after - pd.cpkBefore;
    const dir = Math.abs(delta) < 0.1 ? 'same' : delta > 0 ? 'up' : 'down';
    const first = S.sim.firstFlagFrom(pd.at);
    S.lastResult = { ...pd, after, dir, detected: first >= 0 ? 'yes' : 'no', delay: first >= 0 ? first - pd.at + 1 : null };
    renderPredictResult();
  }

  /* ---------- Metrics ---------- */
  function metrics() {
    const p = S.p;
    const oneSided = !(p.lslOn && p.uslOn);
    if (S.mode === 'explore' || !S.sim) {
      const c = capability(p);
      return { theory: true, oneSided, cp: c.cp, cpk: c.cpk, pp: c.cp, ppk: c.cpk, ppmExp: c.ppmTotal, ppmObs: NaN, cpu: c.cpu, cpl: c.cpl, mu: p.mu, sigma: p.sigma, state: 'theory' };
    }
    const w = S.sim.windowStats();
    const histN = S.histWindow === 'all' ? 0 : Number(S.histWindow);
    const state = S.sim.state();
    if (!w) return { oneSided, cp: NaN, cpk: NaN, pp: NaN, ppk: NaN, ppmExp: NaN, ppmObs: NaN, state, empty: true };
    return { oneSided, cp: w.cp, cpk: w.cpk, pp: w.pp, ppk: w.ppk, ppmExp: w.ppmExpected, ppmObs: S.sim.observedPPM(histN), cpu: w.cpu, cpl: w.cpl, mu: w.mean, sigma: w.sigmaWithin, state, subgroups: w.subgroups };
  }

  /* ---------- KPI strip ---------- */
  function renderKpis() {
    const m = metrics();
    const invalid = m.state === 'out';
    const set = (k, v, sub) => {
      $(`kv-${k}`).textContent = v;
      $(`ks-${k}`).textContent = sub || '';
    };
    const within = m.theory ? t('pc.kpi.theory') : t('pc.kpi.within');
    const overall = m.theory ? t('pc.kpi.theory') : t('pc.kpi.overall');
    set('cp', fmtIdx(m.cp, m.oneSided), within);
    set('cpk', fmtIdx(m.cpk, false), within);
    set('pp', fmtIdx(m.pp, m.oneSided), overall);
    set('ppk', fmtIdx(m.ppk, false), overall);
    set('ppmExp', fmtPPM(m.ppmExp), t('pc.kpi.ppmExpSub'));
    set('ppmObs', m.theory ? t('pc.na') : fmtPPM(m.ppmObs), m.theory ? t('pc.kpi.ppmObsNa') : t(`pc.kpi.ppmObsSub.${S.histWindow}`));
    ['cp', 'cpk'].forEach((k) => {
      const el = $(`kpi-${k}`);
      el.classList.toggle('is-invalid', invalid);
      el.title = invalid ? t('pc.kpi.invalidTip') : '';
      el.querySelector('dd').setAttribute('aria-description', invalid ? t('pc.kpi.invalidTip') : '');
    });

    // Process state chip
    let st = m.state;
    let text;
    let ic;
    if (st === 'theory') { text = t('pc.state.theory'); ic = 'info'; st = ''; }
    else if (st === 'baseline') { text = t('pc.state.baseline', { k: String(Math.min(S.sim.subgroups.length - S.sim.limitsFrom, S.sim.params.baseline)), n: String(S.sim.params.baseline) }); ic = 'loader'; st = ''; }
    else if (st === 'in') { text = t('pc.state.in'); ic = 'check'; }
    else { text = t('pc.state.out'); ic = 'alert'; }
    ui.stateChip.dataset.state = st;
    ui.stateIcon.innerHTML = icon(ic, { size: 16 });
    ui.stateText.textContent = text;

    // Cpk band chip
    const thr = S.threshold;
    const cpk = m.cpk;
    ui.bandChip.hidden = !Number.isFinite(cpk);
    const band = cpk >= thr - 1e-9 ? 'met' : cpk >= 1 ? 'mid' : 'poor';
    ui.bandChip.dataset.state = band === 'met' && invalid ? '' : band === 'mid' ? '' : band;
    ui.bandIcon.innerHTML = icon(band === 'met' ? 'check' : band === 'mid' ? 'info' : 'alert', { size: 16 });
    ui.bandText.textContent = t(`pc.band.${band}`, { thr: num(thr, 2) });

    ui.kpiNote.textContent = m.theory ? t('pc.kpi.noteTheory') : t('pc.kpi.noteProcess', { w: String(WINDOW), s: String(STATE_WINDOW) });
  }

  function renderLive() {
    const m = metrics();
    const text = t('pc.live', {
      cp: fmtIdx(m.cp, m.oneSided), cpk: fmtIdx(m.cpk, false), pp: fmtIdx(m.pp, m.oneSided), ppk: fmtIdx(m.ppk, false),
      ppm: fmtPPM(m.ppmExp),
      state: m.state === 'in' ? t('pc.state.in') : m.state === 'out' ? t('pc.state.out') : m.state === 'baseline' ? t('pc.state.baselineShort') : t('pc.state.theory'),
    });
    if (ui.live.textContent !== text) ui.live.textContent = text;
  }

  /* ---------- View A: distribution ---------- */
  const pdf = (x, mu, sd) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  let distScale = null;

  function drawDist(dt) {
    const { ctx, w, h } = CH.setup(ui.distCanvas);
    const { center: c, half: hh } = ctxOf();
    const p = S.p;
    const trueMu = S.sim && S.mode !== 'explore' ? S.sim.trueMean() : p.mu;
    const trueSd = S.sim && S.mode !== 'explore' ? S.sim.trueSigma() : p.sigma;
    if (!S.disp) S.disp = { mu: trueMu, sd: trueSd, lsl: p.lsl, usl: p.usl };
    const k = reduced ? 1 : Math.min(1, dt * 14);
    const D = S.disp;
    D.mu += (trueMu - D.mu) * k;
    D.sd += (trueSd - D.sd) * k;
    D.lsl += (p.lsl - D.lsl) * k;
    D.usl += (p.usl - D.usl) * k;
    const settling = Math.abs(trueMu - D.mu) > 1e-4 * hh || Math.abs(trueSd - D.sd) > 1e-4 * hh || Math.abs(p.lsl - D.lsl) > 1e-4 * hh || Math.abs(p.usl - D.usl) > 1e-4 * hh;

    const pad = { l: 16, r: 16, t: 58, b: 76 };
    const x = CH.scale(c - 2.4 * hh, c + 2.4 * hh, pad.l, w - pad.r);
    distScale = x;
    const base = h - pad.b;
    const yMax = Math.max(pdf(D.mu, D.mu, D.sd), pdf(0, 0, 0.3 * hh)) * 1.08;
    const y = CH.scale(0, yMax, base, pad.t);

    // Histogram (Process / Challenge)
    if (S.sim && S.mode !== 'explore' && S.sim.individuals.length) {
      const xs = S.histWindow === 'all' ? S.sim.individuals : S.sim.individuals.slice(-Number(S.histWindow));
      const binW = hh / 6;
      const d0 = x.domain[0];
      const bins = new Map();
      for (const v of xs) { const b = Math.floor((v - d0) / binW); bins.set(b, (bins.get(b) || 0) + 1); }
      ctx.fillStyle = C.hist;
      ctx.strokeStyle = C.histStroke;
      ctx.lineWidth = 1;
      for (const [b, cnt] of bins) {
        const x0 = x(d0 + b * binW);
        const x1 = x(d0 + (b + 1) * binW);
        if (x1 < pad.l || x0 > w - pad.r) continue;
        const top = y(Math.min(yMax * 1.05, cnt / (xs.length * binW)));
        ctx.fillRect(x0 + 0.5, top, x1 - x0 - 1, base - top);
        ctx.strokeRect(x0 + 0.5, top, x1 - x0 - 1, base - top);
      }
    }

    // Curve areas: inside spec (signature gradient), outside (magenta)
    const curvePath = (a, b) => {
      const steps = 120;
      ctx.beginPath();
      ctx.moveTo(x(a), base);
      for (let i = 0; i <= steps; i++) {
        const v = a + ((b - a) * i) / steps;
        ctx.lineTo(x(v), y(Math.min(yMax, pdf(v, D.mu, D.sd))));
      }
      ctx.lineTo(x(b), base);
      ctx.closePath();
    };
    const [d0, d1] = x.domain;
    const inA = p.lslOn ? Math.max(D.lsl, d0) : d0;
    const inB = p.uslOn ? Math.min(D.usl, d1) : d1;
    const grad = ctx.createLinearGradient(pad.l, 0, w - pad.r, 0);
    grad.addColorStop(0, C.g0); grad.addColorStop(0.5, C.g50); grad.addColorStop(1, C.g100);
    ctx.save();
    ctx.globalAlpha = S.mode === 'explore' ? 0.38 : 0.22;
    if (inB > inA) { curvePath(inA, inB); ctx.fillStyle = grad; ctx.fill(); }
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = C.danger;
    if (p.lslOn && D.lsl > d0) { curvePath(d0, Math.min(D.lsl, d1)); ctx.fill(); }
    if (p.uslOn && D.usl < d1) { curvePath(Math.max(D.usl, d0), d1); ctx.fill(); }
    ctx.restore();

    // Curve line
    const pts = [];
    for (let i = 0; i <= 240; i++) { const v = d0 + ((d1 - d0) * i) / 240; pts.push([x(v), y(Math.min(yMax, pdf(v, D.mu, D.sd)))]); }
    CH.polyline(ctx, pts, { color: C.cyan, width: 2 });

    // Axis
    CH.line(ctx, pad.l, base + 0.5, w - pad.r, base + 0.5, { color: C.axis });
    const ticks = CH.niceTicks(d0, d1, w < 480 ? 4 : 8);
    ticks.forEach((v) => CH.text(ctx, num(v, v % 1 ? dec() : 0), x(v), base + 14, { color: C.subtle, font: C.font, align: 'center' }));
    CH.text(ctx, unit(), w - pad.r, base + 28, { color: C.subtle, font: C.font, align: 'right' });

    // ±3σ markers
    [-3, 3].forEach((s) => {
      const px = x(D.mu + s * D.sd);
      if (px < pad.l || px > w - pad.r) return;
      CH.line(ctx, px, base - 6, px, base + 4, { color: C.cyanStrong, width: 1.5 });
      CH.text(ctx, s < 0 ? '−3σ' : '+3σ', px, base - 10, { color: C.cyanStrong, font: C.font, align: 'center' });
    });

    // Target (dashed), μ (thin cyan), specs (solid navy)
    CH.line(ctx, x(p.target), pad.t - 12, x(p.target), base, { color: C.navy, dash: [4, 4] });
    CH.text(ctx, t('pc.dist.targetShort'), x(p.target) + 4, pad.t - 4, { color: C.navy, font: C.font });
    CH.line(ctx, x(D.mu), pad.t + 4, x(D.mu), base, { color: C.cyan, width: 1.5 });
    if (p.lslOn) CH.line(ctx, x(D.lsl), 24, x(D.lsl), base, { color: C.navy, width: 2 });
    if (p.uslOn) CH.line(ctx, x(D.usl), 24, x(D.usl), base, { color: C.navy, width: 2 });

    // Cpk ruler: distance μ → each spec in units of 3σ; the shorter one is Cpk
    const m = metrics();
    const rulerY = base + 50;
    if (Number.isFinite(m.mu) && Number.isFinite(m.sigma)) {
      const sides = [];
      if (p.lslOn) sides.push({ key: 'cpl', to: p.lsl, v: m.cpl });
      if (p.uslOn) sides.push({ key: 'cpu', to: p.usl, v: m.cpu });
      const minV = Math.min(...sides.map((s) => s.v));
      sides.forEach((s) => {
        const hi = s.v === minV;
        const col = hi ? C.cyanStrong : C.axis;
        const a = x(m.mu);
        const b = x(s.to);
        CH.line(ctx, a, rulerY, b, rulerY, { color: col, width: hi ? 3 : 2 });
        CH.line(ctx, b, rulerY - 6, b, rulerY + 6, { color: col, width: hi ? 3 : 2 });
        const dir = s.to > m.mu ? 1 : -1;
        for (let u = 1; u * 3 * m.sigma < Math.abs(s.to - m.mu); u++) {
          const px = x(m.mu + dir * u * 3 * m.sigma);
          CH.line(ctx, px, rulerY - 4, px, rulerY + 4, { color: col, width: 1 });
        }
        CH.text(ctx, t(`pc.dist.${s.key}`, { v: num(s.v, 2) }) + (hi && sides.length > 1 ? ` · ${t('pc.dist.min')}` : ''), (a + b) / 2, rulerY - 8, { color: hi ? C.navy : C.subtle, font: C.font, align: 'center', weight: hi ? '700' : '' });
      });
      CH.line(ctx, x(m.mu), rulerY - 7, x(m.mu), rulerY + 7, { color: C.cyanStrong, width: 2 });
    }

    // Handles
    const place = (key, v, on) => {
      const el = ui.handles[key];
      el.hidden = !on;
      el.style.left = `${Math.min(w - 18, Math.max(18, x(v)))}px`;
    };
    place('lsl', D.lsl, p.lslOn);
    place('usl', D.usl, p.uslOn);
    place('mu', D.mu, true);
    ui.distCanvas.setAttribute('aria-label', t('pc.dist.aria', { mu: fmtV(trueMu), sd: fmtV(trueSd, 1), lsl: p.lslOn ? fmtV(p.lsl) : t('pc.na'), usl: p.uslOn ? fmtV(p.usl) : t('pc.na'), ppm: fmtPPM(m.ppmExp) }));
    return settling;
  }

  /* ---------- Handles: drag (mouse/touch) and keyboard ---------- */
  function handleValue(key) {
    if (key === 'mu' && S.sim && S.mode !== 'explore') return S.sim.trueMean();
    return S.p[key];
  }
  Object.entries(ui.handles).forEach(([key, el]) => {
    let dragging = false;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released pointer */ }
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging || !distScale) return;
      const r = ui.dist.getBoundingClientRect();
      setParam(key, distScale.invert(e.clientX - r.left), { fromHandle: true });
    });
    const end = () => { dragging = false; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const [min, max, step] = range(key);
      const big = e.shiftKey ? 10 : 1;
      let v = handleValue(key);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= step * big;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += step * big;
      else if (e.key === 'Home') v = min;
      else if (e.key === 'End') v = max;
      else return;
      e.preventDefault();
      setParam(key, v, { fromHandle: true });
    });
  });

  function syncHandles() {
    Object.entries(ui.handles).forEach(([key, el]) => {
      const [min, max] = range(key);
      const v = handleValue(key);
      el.textContent = t(`pc.handle.${key}`);
      el.setAttribute('aria-label', t(`pc.handle.${key}Aria`));
      el.setAttribute('aria-valuemin', String(min));
      el.setAttribute('aria-valuemax', String(max));
      el.setAttribute('aria-valuenow', String(v));
      el.setAttribute('aria-valuetext', `${fmtV(v)} ${unit()}`);
    });
  }

  /* ---------- View B: X̄-R chart ---------- */
  let xbarGeom = null;
  function drawSpc() {
    const sim = S.sim;
    const draw = (canvas, key) => {
      const { ctx, w, h } = CH.setup(canvas);
      const pad = { l: 44, r: w < 480 ? 64 : 104, t: 10, b: 20 };
      const N = sim.subgroups.length;
      const i0 = Math.max(0, N - CHART_SUBGROUPS);
      const x = CH.scale(i0 - 0.5, i0 + CHART_SUBGROUPS - 0.5, pad.l, w - pad.r);
      const L = sim.limits;
      const vals = sim.subgroups.slice(i0).map((s) => (key === 'x' ? s.mean : s.range));
      let lo = Math.min(...vals, Infinity);
      let hi = Math.max(...vals, -Infinity);
      if (L) {
        lo = Math.min(lo, key === 'x' ? L.lclX : L.lclR);
        hi = Math.max(hi, key === 'x' ? L.uclX : L.uclR);
      }
      if (key === 'x' && S.showSpecs) {
        if (S.p.lslOn) lo = Math.min(lo, S.p.lsl);
        if (S.p.uslOn) hi = Math.max(hi, S.p.usl);
      }
      if (!Number.isFinite(lo)) { lo = key === 'x' ? S.p.mu - S.p.sigma : 0; hi = key === 'x' ? S.p.mu + S.p.sigma : S.p.sigma * 4; }
      const padY = (hi - lo) * 0.12 || 1;
      const y = CH.scale(key === 'r' ? Math.max(0, lo - padY) : lo - padY, hi + padY, h - pad.b, pad.t);
      // baseline band
      const bEnd = L ? sim.limitsFrom + sim.params.baseline : N;
      const b0 = x(Math.max(sim.limitsFrom, i0) - 0.5);
      const b1 = x(Math.min(bEnd, i0 + CHART_SUBGROUPS) - 0.5);
      if (b1 > b0) { ctx.fillStyle = C.band; ctx.fillRect(b0, pad.t, b1 - b0, h - pad.t - pad.b); }
      CH.gridY(ctx, y, CH.niceTicks(y.domain[0], y.domain[1], 4), pad.l, w - pad.r, C.grid);
      CH.niceTicks(y.domain[0], y.domain[1], 4).forEach((v) => CH.text(ctx, num(v, dec()), pad.l - 6, y(v) + 4, { color: C.subtle, font: C.font, align: 'right' }));
      for (let i = Math.ceil(i0 / 10) * 10; i < i0 + CHART_SUBGROUPS; i += 10) CH.text(ctx, String(i + 1), x(i), h - 5, { color: C.subtle, font: C.font, align: 'center' });
      // spec overlay (X̄ only)
      if (key === 'x' && S.showSpecs) {
        [['lsl', S.p.lslOn], ['usl', S.p.uslOn]].forEach(([k, on]) => {
          if (!on) return;
          CH.line(ctx, pad.l, y(S.p[k]), w - pad.r, y(S.p[k]), { color: C.specAlt, width: 1.5, dash: [10, 3, 2, 3] });
          CH.text(ctx, t(`pc.spc.${k}Ind`), w - pad.r + 4, y(S.p[k]) + 4, { color: C.specAlt, font: C.font });
        });
      }
      // limits
      if (L) {
        const cl = key === 'x' ? L.xbarbar : L.rbar;
        const ucl = key === 'x' ? L.uclX : L.uclR;
        const lcl = key === 'x' ? L.lclX : L.lclR;
        CH.line(ctx, pad.l, y(cl), w - pad.r, y(cl), { color: C.navy, width: 1 });
        CH.line(ctx, pad.l, y(ucl), w - pad.r, y(ucl), { color: C.navy, width: 1.5, dash: [6, 4] });
        if (key === 'x' || lcl > 0) CH.line(ctx, pad.l, y(lcl), w - pad.r, y(lcl), { color: C.navy, width: 1.5, dash: [6, 4] });
        CH.text(ctx, `${t('pc.spc.ucl')} ${num(ucl, dec() + 1)}`, w - pad.r + 4, y(ucl) + 4, { color: C.navy, font: C.font });
        CH.text(ctx, `${key === 'x' ? t('pc.spc.clX') : t('pc.spc.clR')} ${num(cl, dec() + 1)}`, w - pad.r + 4, y(cl) + 4, { color: C.navy, font: C.font });
        if (key === 'x' || lcl > 0) CH.text(ctx, `${t('pc.spc.lcl')} ${num(lcl, dec() + 1)}`, w - pad.r + 4, y(lcl) + 4, { color: C.navy, font: C.font });
      } else {
        CH.text(ctx, t('pc.spc.establishing', { k: String(N - sim.limitsFrom), n: String(sim.params.baseline) }), pad.l + 8, pad.t + 12, { color: C.subtle, font: C.font });
      }
      CH.vmarkers(ctx, sim.events.map((e) => e.i - 0.5), x, pad.t, h - pad.b, { color: C.event, width: 2 });
      const pts = vals.map((v, j) => [x(i0 + j), y(v)]);
      CH.polyline(ctx, pts, { color: C.cyan, width: 1.5 });
      CH.dots(ctx, pts, { color: C.cyan, r: 2.5 });
      const flags = key === 'x' ? sim.flagsX : sim.flagsR;
      const flagged = [];
      pts.forEach(([px, py], j) => {
        const f = flags[i0 + j];
        if (!f || !f.length) return;
        ctx.strokeStyle = C.danger;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 5.5, 0, Math.PI * 2); ctx.stroke();
        CH.text(ctx, f.join(','), px, py - 9, { color: C.danger, font: C.font, align: 'center', weight: '700' });
        flagged.push({ px, py, i: i0 + j, rules: f, key });
      });
      canvas.setAttribute('aria-label', t(key === 'x' ? 'pc.spc.xAria' : 'pc.spc.rAria', { n: String(N), s: String(flagged.length) }));
      return { flagged, canvas };
    };
    xbarGeom = [draw(ui.xbar, 'x'), draw(ui.rc, 'r')];
    renderSignals();
  }

  const ruleText = (r, chart) => `${t(chart === 'x' ? 'pc.spc.onX' : 'pc.spc.onR')}: ${t(`pc.rule.${r}`)}`;
  function renderSignals() {
    const sim = S.sim;
    const out = [];
    for (let i = sim.subgroups.length - 1; i >= 0 && out.length < 4; i--) {
      if (sim.flagsX[i] && sim.flagsX[i].length) out.push({ i, chart: 'x', rules: sim.flagsX[i] });
      if (out.length < 4 && sim.flagsR[i] && sim.flagsR[i].length) out.push({ i, chart: 'r', rules: sim.flagsR[i] });
    }
    const html = out.length
      ? out.map((s) => `<li><span class="sw sw--signal" aria-hidden="true"></span><span>${esc(t('pc.spc.subgroup', { i: String(s.i + 1) }))} · ${esc(s.rules.map((r) => ruleText(r, s.chart)).join(' · '))}</span></li>`).join('')
      : `<li>${esc(t('pc.spc.noSignals'))}</li>`;
    if (ui.signals.innerHTML !== html) ui.signals.innerHTML = html;
  }

  function onChartPointer(e, idx) {
    if (!xbarGeom) return;
    const g = xbarGeom[idx];
    const r = g.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = null;
    for (const f of g.flagged) { const d = Math.hypot(f.px - px, f.py - py); if (d < 14 && (!best || d < best.d)) best = { ...f, d }; }
    if (!best) { ui.tip.hidden = true; return; }
    const vr = ui.viewSpc.getBoundingClientRect();
    ui.tip.textContent = `${t('pc.spc.subgroup', { i: String(best.i + 1) })}: ${best.rules.map((rr) => ruleText(rr, best.key)).join(' · ')}`;
    ui.tip.style.left = `${Math.min(vr.width - 140, Math.max(140, r.left - vr.left + best.px))}px`;
    ui.tip.style.top = `${r.top - vr.top + best.py}px`;
    ui.tip.hidden = false;
  }
  [ui.xbar, ui.rc].forEach((cv, idx) => {
    cv.addEventListener('pointermove', (e) => onChartPointer(e, idx));
    cv.addEventListener('pointerdown', (e) => onChartPointer(e, idx));
    cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') ui.tip.hidden = true; });
  });

  /* ---------- View C: rolling Cpk ---------- */
  function drawRolling() {
    const sim = S.sim;
    const { ctx, w, h } = CH.setup(ui.roll);
    const pad = { l: 44, r: w < 480 ? 64 : 104, t: 10, b: 20 };
    const N = sim.subgroups.length;
    const i0 = Math.max(0, N - ROLL_SUBGROUPS);
    const x = CH.scale(i0 - 0.5, i0 + ROLL_SUBGROUPS - 0.5, pad.l, w - pad.r);
    const series = sim.rolling.filter(([i]) => i >= i0);
    const maxV = Math.max(2.5, ...series.map(([, v]) => (Number.isFinite(v) ? v : 0)));
    const y = CH.scale(0, maxV * 1.08, h - pad.b, pad.t);
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = C.success;
    ctx.fillRect(pad.l, pad.t, w - pad.l - pad.r, y(S.threshold) - pad.t);
    ctx.restore();
    CH.gridY(ctx, y, CH.niceTicks(0, maxV * 1.08, 4), pad.l, w - pad.r, C.grid);
    CH.niceTicks(0, maxV * 1.08, 4).forEach((v) => CH.text(ctx, num(v, 1), pad.l - 6, y(v) + 4, { color: C.subtle, font: C.font, align: 'right' }));
    CH.line(ctx, pad.l, y(S.threshold), w - pad.r, y(S.threshold), { color: C.success, width: 1.5, dash: [6, 4] });
    CH.text(ctx, t('pc.roll.threshold', { v: num(S.threshold, 2) }), w - pad.r + 4, y(S.threshold) + 4, { color: C.navy, font: C.font });
    CH.line(ctx, pad.l, y(1), w - pad.r, y(1), { color: C.axis, width: 1, dash: [3, 3] });
    CH.text(ctx, num(1, 2), w - pad.r + 4, y(1) + 4, { color: C.subtle, font: C.font });
    for (let i = Math.ceil(i0 / 20) * 20; i < i0 + ROLL_SUBGROUPS; i += 20) CH.text(ctx, String(i + 1), x(i), h - 5, { color: C.subtle, font: C.font, align: 'center' });
    CH.vmarkers(ctx, sim.events.map((e) => e.i - 0.5), x, pad.t, h - pad.b, { color: C.event, width: 2 });
    CH.polyline(ctx, series.map(([i, v]) => [x(i), y(v)]), { color: C.cyan, width: 2 });
    const last = series[series.length - 1];
    ui.roll.setAttribute('aria-label', t('pc.roll.aria', { v: last ? num(last[1], 2) : DASH, thr: num(S.threshold, 2) }));
  }

  /* ---------- Prediction (Process mode) ---------- */
  const choice = (name, value, key) => `<label class="choice"><input type="radio" name="${name}" value="${value}" required> ${esc(t(key))}</label>`;
  function askPrediction(type) {
    ui.predict.hidden = false;
    ui.predict.innerHTML = `<form id="predict-form">
      <h3>${esc(t('pc.predict.title', { e: t(`pc.events.${type}`) }))}</h3>
      <fieldset class="choice-group"><legend>${esc(t('pc.predict.q1'))}</legend>
        <div class="choices">${choice('cpk', 'up', 'pc.predict.up')}${choice('cpk', 'down', 'pc.predict.down')}${choice('cpk', 'same', 'pc.predict.same')}</div></fieldset>
      <fieldset class="choice-group"><legend>${esc(t('pc.predict.q2'))}</legend>
        <div class="choices">${choice('det', 'yes', 'pc.predict.yes')}${choice('det', 'no', 'pc.predict.no')}</div></fieldset>
      <div class="actions">
        <button type="submit" class="btn btn--primary">${esc(t('pc.predict.apply'))}</button>
        <button type="button" class="btn" id="predict-cancel">${esc(t('pc.predict.cancel'))}</button>
      </div></form>`;
    const f = ui.predict.querySelector('form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!f.elements.cpk.value || !f.elements.det.value) return;
      applyEvent(type, { cpk: f.elements.cpk.value, det: f.elements.det.value });
    });
    ui.predict.querySelector('#predict-cancel').addEventListener('click', () => { ui.predict.hidden = true; ui.predict.innerHTML = ''; });
    f.querySelector('input').focus();
  }

  function renderPredictWaiting() {
    const pd = S.pending;
    ui.predict.hidden = false;
    ui.predict.innerHTML = `<p>${esc(t('pc.predict.waiting', { n: String(RESULT_AFTER), e: t(`pc.events.${pd.type}`) }))}</p>`;
  }

  function renderPredictResult() {
    const r = S.lastResult;
    if (!r) return;
    const ok = `<span class="ok-mark">${icon('check', { size: 14 })}</span>`;
    const dirName = (d) => t(`pc.predict.${d}`);
    const detName = (d) => t(`pc.predict.${d}`);
    ui.predict.hidden = false;
    ui.predict.innerHTML = `<h3>${esc(t('pc.predict.resultTitle', { e: t(`pc.events.${r.type}`) }))}</h3>
      <table class="result-table"><thead><tr><th></th><th>${esc(t('pc.predict.you'))}</th><th>${esc(t('pc.predict.result'))}</th></tr></thead><tbody>
        <tr><th scope="row">${esc(t('pc.predict.q1'))}</th><td>${esc(dirName(r.pred.cpk))}</td><td>${r.pred.cpk === r.dir ? ok : ''}${esc(dirName(r.dir))} (${esc(num(r.cpkBefore, 2))} → ${esc(num(r.after, 2))})</td></tr>
        <tr><th scope="row">${esc(t('pc.predict.q2'))}</th><td>${esc(detName(r.pred.det))}</td><td>${r.pred.det === r.detected ? ok : ''}${esc(detName(r.detected))}${r.delay ? ` · ${esc(t('pc.predict.delay', { n: String(r.delay) }))}` : ''}</td></tr>
      </tbody></table>`;
  }

  /* ---------- Controls ---------- */
  function setFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  }

  function syncControls() {
    PARAM_FIELDS.forEach((k) => {
      const el = $(`in-${k}`);
      const [min, max, step] = range(k);
      el.min = String(min); el.max = String(max); el.step = String(step);
      el.value = String(S.p[k]);
      const text = `${fmtV(S.p[k], k === 'sigma' ? 1 : 0)} ${unit()}`;
      $(`out-${k}`).textContent = text;
      el.setAttribute('aria-valuetext', text);
      setFill(el);
    });
    $('in-lsl').disabled = !S.p.lslOn;
    $('in-usl').disabled = !S.p.uslOn;
    $('on-lsl').checked = S.p.lslOn;
    $('on-usl').checked = S.p.uslOn;
    $('in-n').value = String(S.n);
    $('out-n').textContent = String(S.n);
    setFill($('in-n'));
    const sp = `${formatNumber(SPEEDS[S.speedIdx], { maximumFractionDigits: 1 })}/s`;
    $('in-speed').value = String(S.speedIdx);
    $('out-speed').textContent = sp;
    $('in-speed').setAttribute('aria-valuetext', t('pc.param.speedValue', { v: sp }));
    setFill($('in-speed'));
    $('in-context').value = S.ctxKey;
    ui.seedLabel.textContent = t('pc.seed', { seed: String(S.seed) });
    syncHandles();
  }

  function renderPlay() {
    ui.play.innerHTML = `${icon(S.playing ? 'pause' : 'play', { size: 16 })}<span>${esc(t(S.playing ? 'pc.pause' : 'pc.play'))}</span>`;
  }

  function renderLegend() {
    const items = [['in', 'pc.legend.in'], ['out', 'pc.legend.out'], ['spec', 'pc.legend.spec'], ['target', 'pc.legend.target'], ['mu', 'pc.legend.mu']];
    if (S.mode !== 'explore') items.push(['hist', 'pc.legend.hist']);
    ui.distLegend.innerHTML = items.map(([c, k]) => `<li><span class="sw sw--${c}" aria-hidden="true"></span>${esc(t(k))}</li>`).join('');
    ui.distHint.textContent = t(S.mode === 'explore' ? 'pc.dist.hintExplore' : 'pc.dist.hintProcess', { ctx: t(`pc.ctx.${S.ctxKey}`) });
    ui.spcHint.textContent = t('pc.spc.hint', { n: String(S.n), b: '25' });
    ui.rollHint.textContent = t('pc.roll.hint', { w: String(WINDOW) });
  }

  function renderText() {
    renderPlay();
    ui.step.innerHTML = `${icon('arrowRight', { size: 16 })}<span>${esc(t('pc.step'))}</span>`;
    ui.reset.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${esc(t('pc.reset'))}</span>`;
    ui.seed.innerHTML = `${icon('shuffle', { size: 16 })}<span>${esc(t('pc.newSeed'))}</span>`;
    ui.recalc.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${esc(t('pc.spc.recalc'))}</span>`;
    ui.shortcuts.innerHTML = t('pc.shortcuts', { space: `<kbd>${esc(t('pc.key.space'))}</kbd>`, s: '<kbd>S</kbd>', r: '<kbd>R</kbd>', keys: '<kbd>1</kbd>–<kbd>5</kbd>' });
    $('learn-icon').innerHTML = icon('chevronDown', { size: 18 });
    ui.modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === S.mode)));
    setPreset(S.presetIdx);
    renderLegend();
    syncControls();
    if (S.lastResult) renderPredictResult();
    if (challenge) challenge.render();
    S.dirty = true;
  }

  /* ---------- Modes ---------- */
  let challenge = null;
  function setMode(m) {
    S.mode = m;
    setPlaying(false);
    ui.modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    const explore = m === 'explore';
    ui.exploreNote.hidden = !explore;
    ui.viewSpc.hidden = explore;
    ui.viewRoll.hidden = explore;
    ui.histField.hidden = explore;
    ui.params.hidden = m === 'challenge';
    ui.challenge.hidden = m !== 'challenge';
    ui.run.hidden = m !== 'process';
    ui.events.hidden = m !== 'process';
    ui.presetsRow.hidden = !explore;
    document.querySelectorAll('[data-process]').forEach((el) => { el.hidden = m !== 'process'; });
    if (challenge) { challenge.unmount(); challenge = null; }
    if (m === 'explore') { S.sim = null; }
    else if (m === 'process') { newSim(); }
    else { challenge = LSS.CapabilityChallenge.mount(app, ui.challenge); }
    S.disp = null;
    renderLegend();
    syncControls();
    S.dirty = true;
  }

  /* ---------- App API for challenge.js ---------- */
  const app = {
    get sim() { return S.sim; },
    get threshold() { return S.threshold; },
    set threshold(v) { S.threshold = v; $('in-threshold').value = String(v); S.dirty = true; },
    get playing() { return S.playing; },
    setPlaying,
    newProcess(params, seed) {
      S.ctxKey = 'generic';
      S.seed = seed;
      S.p = { ...params };
      newSim();
      S.disp = null;
      syncControls();
      renderLegend();
      return S.sim;
    },
    runSubgroups(k, done) { S.runLeft = k; S.runDone = done; setPlaying(true); },
    setSpec(lsl, usl) { S.p.lsl = lsl; S.p.usl = usl; S.sim.setParams({ lsl, usl }); S.dirty = true; },
    setMu(mu) { S.p.mu = mu; S.sim.setParams({ mu }); S.dirty = true; },
    setSigma(sigma) { S.p.sigma = sigma; S.sim.setParams({ sigma }); S.dirty = true; },
    get p() { return S.p; },
    num, esc, fmtIdx, metrics,
  };

  /* ---------- Events ---------- */
  ui.modes.forEach((b) => b.addEventListener('click', () => { if (b.dataset.mode !== S.mode) setMode(b.dataset.mode); }));
  PARAM_FIELDS.forEach((k) => $(`in-${k}`).addEventListener('input', (e) => setParam(k, Number(e.target.value))));
  ['lsl', 'usl'].forEach((k) => $(`on-${k}`).addEventListener('change', (e) => {
    const other = k === 'lsl' ? 'uslOn' : 'lslOn';
    if (!e.target.checked && !S.p[other]) { e.target.checked = true; return; } // keep at least one limit
    S.p[`${k}On`] = e.target.checked;
    if (S.sim) S.sim.setParams({ [`${k}On`]: e.target.checked });
    if (S.mode === 'explore') setPreset(-1);
    syncControls();
    S.dirty = true;
  }));
  $('in-n').addEventListener('input', (e) => { S.n = Number(e.target.value); if (S.sim) newSim(); syncControls(); renderLegend(); });
  $('in-speed').addEventListener('input', (e) => { S.speedIdx = Number(e.target.value); syncControls(); });
  $('in-shift').addEventListener('change', (e) => { S.shiftSize = Math.max(0.25, Math.min(4, Number(e.target.value) || 1.5)); e.target.value = String(S.shiftSize); });
  $('in-drift').addEventListener('change', (e) => { S.drift = Math.max(0.01, Math.min(1, Number(e.target.value) || 0.1)); e.target.value = String(S.drift); });
  $('in-context').addEventListener('change', (e) => setContext(e.target.value));
  $('in-threshold').addEventListener('change', (e) => { S.threshold = Math.max(0.5, Math.min(3, Number(e.target.value) || 1.33)); e.target.value = String(S.threshold); S.dirty = true; });
  ui.histWindow.addEventListener('change', (e) => { S.histWindow = e.target.value; S.dirty = true; });
  ui.showSpecs.addEventListener('change', (e) => { S.showSpecs = e.target.checked; ui.specNote.hidden = !S.showSpecs; S.dirty = true; });
  ui.recalc.addEventListener('click', () => { if (S.sim) { S.sim.recalcLimits(); S.dirty = true; } });
  document.querySelectorAll('[data-rule]').forEach((cb) => cb.addEventListener('change', () => {
    S.rules[cb.dataset.rule] = cb.checked;
    if (S.sim) S.sim.setParams({ rules: { [cb.dataset.rule]: cb.checked } });
    S.dirty = true;
  }));
  ui.play.addEventListener('click', () => setPlaying(!S.playing));
  ui.step.addEventListener('click', () => { if (S.sim) stepOnce(); });
  ui.reset.addEventListener('click', () => { setPlaying(false); newSim(); });
  ui.seed.addEventListener('click', () => { S.seed = 1 + Math.floor(Math.random() * 999999); setPlaying(false); newSim(); syncControls(); });
  document.querySelectorAll('[data-event]').forEach((b) => b.addEventListener('click', () => {
    if (!S.sim) return;
    if (ui.predictOn.checked && !S.pending) askPrediction(b.dataset.event);
    else applyEvent(b.dataset.event, null);
  }));
  presetBtns.forEach((b, i) => b.addEventListener('click', () => loadPreset(i)));

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.pc button');
    if (b && e.detail > 0 && !b.classList.contains('handle')) b.blur();
  });
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tg = e.target;
    if (tg.closest('input[type="number"], select, textarea, [role="slider"].handle')) return;
    const key = e.key.toLowerCase();
    if (e.key === ' ' || e.code === 'Space') {
      if (S.mode !== 'process' || tg.closest('button, a, summary, input[type="checkbox"], input[type="radio"]')) return;
      e.preventDefault();
      setPlaying(!S.playing);
    } else if (key === 's' && S.mode === 'process') {
      stepOnce();
    } else if (key === 'r') {
      if (S.mode === 'process') { setPlaying(false); newSim(); } else if (S.mode === 'explore') loadPreset(Math.max(0, S.presetIdx));
    } else if (S.mode === 'explore' && /^[1-5]$/.test(e.key)) {
      loadPreset(Number(e.key) - 1);
    }
  });
  reducedQuery.addEventListener('change', (e) => { reduced = e.matches; });
  new ResizeObserver(() => { S.dirty = true; }).observe(document.querySelector('.pc'));

  /* ---------- Frame loop ---------- */
  let last = performance.now();
  let lastUi = 0;
  let lastLive = 0;
  function frame(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (S.playing && S.sim) {
      S.acc += dt * SPEEDS[S.speedIdx];
      let guard = 0;
      while (S.acc >= 1 && guard++ < 40 && S.playing) { S.acc -= 1; stepOnce(); }
    }
    const settling = drawDist(dt);
    if (S.dirty || settling) {
      if (S.sim && S.mode !== 'explore') { drawSpc(); drawRolling(); }
      S.dirty = false;
    }
    if (now - lastUi > UI_INTERVAL) { renderKpis(); syncHandles(); lastUi = now; }
    if (now - lastLive > LIVE_INTERVAL) { renderLive(); lastLive = now; }
    requestAnimationFrame(frame);
  }

  /* ---------- Boot ---------- */
  renderHeader({ variant: 'sim' });
  renderFooter();
  readColors();
  S.p = PRESETS[0].make(CONTEXTS.generic.center, CONTEXTS.generic.half);
  onLangChange(renderText);
  initI18n();
  const start = new URLSearchParams(location.search).get('mode');
  setMode(['process', 'challenge'].includes(start) ? start : 'explore');
  setPreset(0);
  requestAnimationFrame(frame);
})(window.LSS);
