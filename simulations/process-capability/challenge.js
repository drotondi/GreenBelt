/**
 * Process capability — Challenge mode.
 * Start from a seeded off-center, high-variation process; reach Cpk ≥ threshold while
 * in control at the lowest illustrative cost. After each action the line runs 25
 * subgroups; control limits are then recalculated from those subgroups (new baseline
 * after an intentional change) and the goal is checked.
 */
(function (LSS) {
  'use strict';

  const { t } = LSS.i18n;
  const { icon } = LSS.icons;
  const { mulberry32 } = LSS.sim;
  const { challengeStart, optimalPath, capability, CHALLENGE_DEFAULTS } = LSS.Capability;

  const RUN = 25;
  const randomSeed = () => 1000 + Math.floor(Math.random() * 9000);

  function mount(app, root) {
    const { num, esc } = app;
    const S = {
      seed: randomSeed(),
      threshold: CHALLENGE_DEFAULTS.threshold,
      costs: { ...CHALLENGE_DEFAULTS.costs },
      widenMax: CHALLENGE_DEFAULTS.widenMax,
      acceptProb: CHALLENGE_DEFAULTS.widenAcceptProb,
      stage: 'intro',
      start: null,
      history: [],
      total: 0,
      widenLeft: 0,
      acceptRng: null,
      facilitatorOpen: false,
      goal: false,
    };

    function begin() {
      S.start = challengeStart(S.seed);
      S.history = [];
      S.total = 0;
      S.goal = false;
      S.widenLeft = S.widenMax;
      S.acceptRng = mulberry32(((S.seed >>> 0) ^ 0x1B873593) >>> 0);
      app.threshold = S.threshold;
      app.newProcess({ ...S.start }, S.seed);
      S.stage = 'running';
      render();
      app.runSubgroups(RUN, () => { S.stage = 'play'; render(); });
    }

    function act(kind) {
      const p = app.p;
      let note = '';
      let cost = 0;
      if (kind === 'recenterDown' || kind === 'recenterUp') {
        app.setMu(p.mu + (kind === 'recenterUp' ? 1 : -1) * CHALLENGE_DEFAULTS.recenterStep);
        cost = S.costs.recenter;
      } else if (kind === 'reduce') {
        app.setSigma(Math.round(p.sigma * CHALLENGE_DEFAULTS.reduceFactor * 1000) / 1000);
        cost = S.costs.reduce;
      } else if (kind === 'widen') {
        if (S.widenLeft <= 0) return;
        S.widenLeft--;
        cost = S.costs.widen;
        if (S.acceptRng() < S.acceptProb) {
          app.setSpec(p.lsl - CHALLENGE_DEFAULTS.widenStep, p.usl + CHALLENGE_DEFAULTS.widenStep);
          note = 'accepted';
        } else note = 'rejected';
      }
      S.total += cost;
      const entry = { kind, cost, note, cpk: NaN, state: '' };
      S.history.push(entry);
      S.stage = 'running';
      render();
      app.runSubgroups(RUN, () => {
        app.sim.recalcLimits();
        const m = app.metrics();
        entry.cpk = m.cpk;
        entry.state = m.state;
        if (m.cpk >= S.threshold && m.state === 'in') { S.goal = true; S.stage = 'end'; }
        else S.stage = 'play';
        render();
      });
    }

    /* ---------- Views ---------- */
    const actionLabel = (e) => `${t(`pc.ch.action.${e.kind}`)}${e.note ? ` (${t(`pc.ch.${e.note}`)})` : ''}`;

    function introView() {
      return `<div class="ch-box"><h3>${esc(t('pc.ch.introTitle'))}</h3>
        <p>${esc(t('pc.ch.intro', { thr: num(S.threshold, 2) }))}</p>
        <ul class="questions"><li>${esc(t('pc.ch.rule1', { n: String(RUN) }))}</li><li>${esc(t('pc.ch.rule2'))}</li><li>${esc(t('pc.ch.rule3'))}</li></ul>
        <div class="actions"><button type="button" class="btn btn--primary" id="ch-start">${icon('play', { size: 16 })}<span>${esc(t('pc.ch.start'))}</span></button></div></div>`;
    }

    function actionButton(kind, cost, disabled, extra = '') {
      return `<div class="ch-action"><button type="button" class="btn" data-act="${kind}" ${disabled ? 'disabled' : ''}>${esc(t(`pc.ch.action.${kind}`))}</button>
        <span class="ch-cost">${esc(t('pc.ch.cost', { c: String(cost) }))}${extra}</span></div>`;
    }

    function historyTable() {
      if (!S.history.length) return `<p>${esc(t('pc.ch.noActions'))}</p>`;
      return `<table class="result-table"><thead><tr><th>#</th><th>${esc(t('pc.ch.colAction'))}</th><th>${esc(t('pc.ch.colCost'))}</th><th>${esc(t('pc.ch.colCpk'))}</th></tr></thead><tbody>
        ${S.history.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(actionLabel(e))}</td><td>${esc(String(e.cost))}</td><td>${esc(num(e.cpk, 2))}${e.state === 'out' ? ` · ${esc(t('pc.ch.outShort'))}` : ''}</td></tr>`).join('')}
      </tbody></table>`;
    }

    function playView() {
      const busy = S.stage === 'running';
      const m = app.metrics();
      return `<div class="ch-grid">
        <div class="ch-box">
          <h3>${esc(t('pc.ch.actionsTitle'))}</h3>
          <div class="ch-actions">
            ${actionButton('recenterDown', S.costs.recenter, busy)}
            ${actionButton('recenterUp', S.costs.recenter, busy)}
            ${actionButton('reduce', S.costs.reduce, busy)}
            ${actionButton('widen', S.costs.widen, busy || S.widenLeft <= 0, ` · ${esc(t('pc.ch.usesLeft', { n: String(S.widenLeft) }))}`)}
          </div>
          <p class="pc-note" style="margin-top: var(--space-2)">${esc(busy ? t('pc.ch.running', { n: String(RUN) }) : t('pc.ch.after', { n: String(RUN) }))}</p>
          <div class="actions"><button type="button" class="btn" id="ch-finish" ${busy ? 'disabled' : ''}>${esc(t('pc.ch.finish'))}</button></div>
        </div>
        <div class="ch-box">
          <h3>${esc(t('pc.ch.statusTitle'))}</h3>
          <p>${esc(t('pc.ch.goal', { thr: num(S.threshold, 2) }))}</p>
          <p style="margin-top: var(--space-2)">${esc(t('pc.ch.now', { cpk: num(m.cpk, 2), mu: num(app.p.mu, 1), sd: num(app.p.sigma, 2), lsl: num(app.p.lsl, 0), usl: num(app.p.usl, 0) }))}</p>
          <p class="ch-total" style="margin-top: var(--space-2)">${esc(t('pc.ch.total', { c: String(S.total) }))}</p>
          ${historyTable()}
        </div>
      </div>`;
    }

    function endView() {
      const m = app.metrics();
      const opt = optimalPath(S.start, { threshold: S.threshold, costs: S.costs });
      const optText = opt ? t('pc.ch.optimalText', { k: String(opt.recenter), m: String(opt.reduce), c: String(opt.cost), cpk: num(opt.cpk, 2) }) : t('pc.ch.optimalNone');
      const startCap = capability(S.start);
      return `<div class="ch-grid">
        <div class="ch-box">
          <h3>${esc(t(S.goal ? 'pc.ch.endGoal' : 'pc.ch.endNoGoal'))}</h3>
          <p>${esc(t('pc.ch.final', { cpk: num(m.cpk, 2), start: num(startCap.cpk, 2), state: m.state === 'in' ? t('pc.state.in') : t('pc.state.out') }))}</p>
          <p class="ch-total" style="margin-top: var(--space-2)">${esc(t('pc.ch.total', { c: String(S.total) }))}</p>
          <h3 style="margin-top: var(--space-3)">${esc(t('pc.ch.optimal'))}</h3>
          <p>${esc(optText)}</p>
        </div>
        <div class="ch-box"><h3>${esc(t('pc.ch.historyTitle'))}</h3>${historyTable()}</div>
      </div>
      <div class="ch-box" style="margin-top: var(--space-4)">
        <h3>${esc(t('pc.ch.discuss'))}</h3>
        <ol class="questions"><li>${esc(t('pc.ch.dq1'))}</li><li>${esc(t('pc.ch.dq2'))}</li><li>${esc(t('pc.ch.dq3'))}</li></ol>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--primary" id="ch-again">${icon('rotateCcw', { size: 16 })}<span>${esc(t('pc.ch.again'))}</span></button>
        <button type="button" class="btn" id="ch-new">${icon('shuffle', { size: 16 })}<span>${esc(t('pc.ch.newCase'))}</span></button>
      </div>`;
    }

    function facilitatorView() {
      const inp = (id, v, min, max, step, label) => `<div class="field"><label class="field__label" for="${id}">${esc(t(label))}</label><input class="num-input" type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
      return `<div class="facilitator">
        <button type="button" class="link-btn" id="ch-fac" aria-expanded="${S.facilitatorOpen}" aria-controls="ch-fac-body">${esc(t('pc.ch.facilitator'))}</button>
        <span class="pc-note"> · ${esc(t('pc.seed', { seed: String(S.seed) }))}</span>
        <div class="facilitator__body" id="ch-fac-body" ${S.facilitatorOpen ? '' : 'hidden'}>
          ${inp('ch-seed', S.seed, 1, 999999, 1, 'pc.ch.facSeed')}
          ${inp('ch-thr', S.threshold, 0.5, 3, 0.01, 'pc.ch.facThreshold')}
          ${inp('ch-c-recenter', S.costs.recenter, 0, 100, 1, 'pc.ch.facRecenter')}
          ${inp('ch-c-reduce', S.costs.reduce, 0, 100, 1, 'pc.ch.facReduce')}
          ${inp('ch-c-widen', S.costs.widen, 0, 100, 1, 'pc.ch.facWiden')}
          <div class="actions" style="grid-column: 1 / -1; margin-top: 0">
            <button type="button" class="btn" id="ch-apply">${icon('rotateCcw', { size: 16 })}<span>${esc(t('pc.ch.facApply'))}</span></button>
            <span class="pc-note">${esc(t('pc.ch.facNote'))}</span>
          </div>
        </div>
      </div>`;
    }

    function render() {
      const body = S.stage === 'intro' ? introView() : S.stage === 'end' ? endView() : playView();
      root.innerHTML = `<h2 class="section-title">${esc(t('pc.ch.title'))}</h2><p class="pc-note">${esc(t('pc.ch.subtitle'))}</p>${body}${facilitatorView()}`;
      bind();
    }

    function bind() {
      const on = (id, fn) => { const el = root.querySelector(id); if (el) el.addEventListener('click', fn); };
      on('#ch-start', begin);
      on('#ch-finish', () => { S.stage = 'end'; render(); });
      on('#ch-again', begin);
      on('#ch-new', () => { S.seed = randomSeed(); begin(); });
      root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
      on('#ch-fac', () => { S.facilitatorOpen = !S.facilitatorOpen; render(); });
      on('#ch-apply', () => {
        const v = (id, d) => { const x = Number(root.querySelector(id).value); return Number.isFinite(x) ? x : d; };
        S.seed = Math.max(1, Math.min(999999, Math.round(v('#ch-seed', S.seed))));
        S.threshold = Math.max(0.5, Math.min(3, v('#ch-thr', S.threshold)));
        S.costs = { recenter: v('#ch-c-recenter', S.costs.recenter), reduce: v('#ch-c-reduce', S.costs.reduce), widen: v('#ch-c-widen', S.costs.widen) };
        begin();
      });
    }

    render();
    return {
      render,
      unmount() { root.innerHTML = ''; },
      state: S,
    };
  }

  LSS.CapabilityChallenge = { mount };
})(window.LSS);
