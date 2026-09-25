/**
 * Push vs. Pull — Game mode: 6 rounds of 10 simulated minutes.
 *   predict → (decide → run) × 6 → debrief
 * Push is planned by the player every round (manual releases); pull cards can be
 * set only in rounds 1 and 4. Hidden demand events are derived from the seed (or
 * set by the facilitator) and fire just after a round starts, so the forecast the
 * player sees never includes them.
 */
(function (LSS) {
  'use strict';

  const { t } = LSS.i18n;
  const { icon } = LSS.icons;
  const { mulberry32 } = LSS.sim;

  const ROUNDS = 6;
  const ROUND_MIN = 10;
  const CARD_ROUNDS = [1, 4];
  const EVENT_TYPES = ['spike', 'drop', 'mix'];
  const GAME_PARAMS = {
    demandRate: 1.0, cv: 0.5, mix: 0.6, bias: 0, noise: 0.2, capA: 1.4, capB: 1.3,
    changeover: false, period: ROUND_MIN, safety: 5, cards: [4, 3], holdCost: 1, backorderCost: 5,
    autoRelease: false,
  };

  /** Two hidden events at distinct rounds (2–6), derived only from the seed. */
  function eventsFromSeed(seed) {
    const rng = mulberry32((seed ^ 0x5BD1E995) >>> 0);
    const rounds = [2, 3, 4, 5, 6];
    for (let i = rounds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rounds[i], rounds[j]] = [rounds[j], rounds[i]];
    }
    const plan = new Array(ROUNDS).fill(null);
    rounds.slice(0, 2).forEach((r) => { plan[r - 1] = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)]; });
    return plan;
  }

  const randomSeed = () => 1000 + Math.floor(Math.random() * 9000);

  function mount(app, root) {
    const { fmt, fmtInt, pct, esc } = app;
    const S = {
      seed: randomSeed(),
      events: null,
      hideKpis: false,
      stage: 'predict',
      round: 0,
      predict: { fill: null, inv: null },
      facilitatorOpen: false,
      cards: GAME_PARAMS.cards.slice(),
      releases: [],
    };
    S.events = eventsFromSeed(S.seed);

    function schedule() {
      return S.events.map((type, i) => (type ? { t: i * ROUND_MIN + 0.01, type } : null)).filter(Boolean);
    }

    function start() {
      S.round = 1;
      S.cards = GAME_PARAMS.cards.slice();
      S.releases = [];
      app.newSim(Object.assign({}, GAME_PARAMS, { cards: S.cards.slice(), schedule: schedule() }), S.seed);
      S.stage = 'decide';
      applyKpiVisibility();
      render();
    }

    function restart(newScenario) {
      if (newScenario) { S.seed = randomSeed(); S.events = eventsFromSeed(S.seed); }
      S.stage = 'predict';
      S.predict = { fill: null, inv: null };
      app.newSim(Object.assign({}, GAME_PARAMS, { schedule: [] }), S.seed);
      applyKpiVisibility();
      render();
    }

    function applyKpiVisibility() {
      app.setKpisHidden(S.hideKpis && S.stage !== 'debrief');
    }

    function confirmRound(form) {
      const sim = app.sim;
      const read = (name, min, max) => Math.min(max, Math.max(min, Math.round(Number(form.elements[name].value) || 0)));
      const qty = [read('rel0', 0, 99), read('rel1', 0, 99)];
      sim.lines.push.manualRelease(qty, sim.t);
      S.releases.push(qty);
      if (CARD_ROUNDS.includes(S.round)) {
        S.cards = [read('card0', 1, 20), read('card1', 1, 20)];
        sim.setParams({ cards: S.cards });
      }
      S.stage = 'running';
      render();
      app.runFor(ROUND_MIN, () => {
        if (S.round >= ROUNDS) {
          S.stage = 'debrief';
          applyKpiVisibility();
        } else {
          S.round++;
          S.stage = 'decide';
        }
        render();
      });
    }

    /* ---------- Rendering ---------- */
    const progress = () => `<div class="game-progress" aria-hidden="true">${Array.from({ length: ROUNDS }, (_, i) => {
      const r = i + 1;
      const cls = S.stage === 'debrief' || r < S.round ? 'is-done' : r === S.round && S.stage !== 'predict' ? 'is-current' : '';
      return `<span class="${cls}"></span>`;
    }).join('')}</div>`;

    const head = () => {
      const title = S.stage === 'predict' ? t('pp.game.predictTitle')
        : S.stage === 'debrief' ? t('pp.game.debriefTitle') : t('pp.game.round', { r: fmtInt(S.round), n: fmtInt(ROUNDS) });
      const sp = app.speeds[app.speedIndex];
      return `<div class="game-head">
        <h2 class="game-round">${esc(title)}</h2>
        <div class="field pp-speed">
          <div class="field__head">
            <label class="field__label" for="game-speed">${esc(t('pp.speed'))}</label>
            <output class="field__value" for="game-speed">${esc(`${LSS.i18n.formatNumber(sp, { maximumFractionDigits: 1 })}×`)}</output>
          </div>
          <input type="range" id="game-speed" min="0" max="5" step="1" value="${app.speedIndex}" aria-valuetext="${esc(`${sp}×`)}">
        </div>
      </div>${progress()}`;
    };

    const choice = (name, value, key) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${S.predict[name] === value ? 'checked' : ''} required> ${esc(t(key))}</label>`;

    function predictView() {
      return `<form class="game-body" id="game-form">
        <p>${esc(t('pp.game.predictIntro'))}</p>
        <div class="game-grid">
          <div class="game-box">
            <fieldset class="choice-group"><legend>${esc(t('pp.game.q1'))}</legend>
              <div class="choices">${choice('fill', 'push', 'pp.lane.push')}${choice('fill', 'pull', 'pp.lane.pull')}${choice('fill', 'same', 'pp.game.same')}</div>
            </fieldset>
            <fieldset class="choice-group"><legend>${esc(t('pp.game.q2'))}</legend>
              <div class="choices">${choice('inv', 'push', 'pp.lane.push')}${choice('inv', 'pull', 'pp.lane.pull')}${choice('inv', 'same', 'pp.game.same')}</div>
            </fieldset>
          </div>
          <div class="game-box">
            <h3>${esc(t('pp.game.rulesTitle'))}</h3>
            <ul class="questions">
              <li>${esc(t('pp.game.rule1', { n: fmtInt(ROUNDS), m: fmtInt(ROUND_MIN) }))}</li>
              <li>${esc(t('pp.game.rule2'))}</li>
              <li>${esc(t('pp.game.rule3'))}</li>
              <li>${esc(t('pp.game.rule4'))}</li>
            </ul>
          </div>
        </div>
        <div class="game-actions">
          <button type="submit" class="btn btn--primary">${icon('play', { size: 16 })}<span>${esc(t('pp.game.start'))}</span></button>
          <span class="game-note">${esc(t('pp.game.enter'))}</span>
        </div>
      </form>`;
    }

    function decideView() {
      const sim = app.sim;
      const P = sim.lines.push;
      const Q = sim.lines.pull;
      const f = sim.forecast.map((x) => x * ROUND_MIN);
      const skuName = (s) => `<span class="shape shape--${s === 0 ? 'square' : 'circle'}" aria-hidden="true"></span> ${esc(t(`pp.legend.sku${s + 1}`))}`;
      const pushRows = [0, 1].map((s) => `<tr>
        <th scope="row">${skuName(s)}</th>
        <td>${esc(fmt(f[s]))}</td><td>${esc(fmtInt(P.fgCount(s)))}</td><td>${esc(fmtInt(P.wip(s)))}</td><td>${esc(fmtInt(P.backlog[s]))}</td>
        <td><input class="num-input" type="number" name="rel${s}" min="0" max="99" step="1" value="${Math.max(0, Math.round(f[s]))}" aria-label="${esc(t('pp.game.releaseAria', { sku: t(`pp.legend.sku${s + 1}`) }))}"></td>
      </tr>`).join('');
      const canCards = CARD_ROUNDS.includes(S.round);
      const pullBody = canCards
        ? `<p class="game-note">${esc(t('pp.game.cardsNow'))}</p>
          <table class="game-table"><thead><tr><th scope="col">${esc(t('pp.game.sku'))}</th><th scope="col">${esc(t('pp.game.fg'))}</th><th scope="col">${esc(t('pp.game.cards'))}</th></tr></thead><tbody>
          ${[0, 1].map((s) => `<tr><th scope="row">${skuName(s)}</th><td>${esc(fmtInt(Q.fgCount(s)))}</td>
            <td><input class="num-input" type="number" name="card${s}" min="1" max="20" step="1" value="${S.cards[s]}" aria-label="${esc(t('pp.game.cardsAria', { sku: t(`pp.legend.sku${s + 1}`) }))}"></td></tr>`).join('')}
          </tbody></table>
          <p class="game-note">${esc(t('pp.note.sizingShort'))}</p>`
        : `<p>${esc(t('pp.game.pullAuto', { a: fmtInt(S.cards[0]), b: fmtInt(S.cards[1]) }))}</p>`;
      return `<form class="game-body" id="game-form">
        <div class="game-grid">
          <div class="game-box">
            <h3>${esc(t('pp.game.pushTitle'))}</h3>
            <p class="game-note">${esc(t('pp.game.pushHint', { m: fmtInt(ROUND_MIN) }))}</p>
            <table class="game-table"><thead><tr>
              <th scope="col">${esc(t('pp.game.sku'))}</th><th scope="col">${esc(t('pp.game.forecast', { m: fmtInt(ROUND_MIN) }))}</th>
              <th scope="col">${esc(t('pp.game.fg'))}</th><th scope="col">${esc(t('pp.game.wip'))}</th><th scope="col">${esc(t('pp.game.bo'))}</th><th scope="col">${esc(t('pp.game.release'))}</th>
            </tr></thead><tbody>${pushRows}</tbody></table>
          </div>
          <div class="game-box">
            <h3>${esc(t('pp.game.pullTitle'))}</h3>
            ${pullBody}
          </div>
        </div>
        <div class="game-actions">
          <button type="submit" class="btn btn--primary">${icon('play', { size: 16 })}<span>${esc(t('pp.game.confirm', { r: fmtInt(S.round) }))}</span></button>
          <span class="game-note">${esc(t('pp.game.enter'))}</span>
        </div>
      </form>`;
    }

    function runningView() {
      return `<div class="game-body">
        <p>${esc(t('pp.game.running', { r: fmtInt(S.round) }))}</p>
        <div class="game-actions">
          <button type="button" class="btn" id="game-pause">${icon(app.playing ? 'pause' : 'play', { size: 16 })}<span>${esc(t(app.playing ? 'pp.pause' : 'pp.game.resume'))}</span></button>
        </div>
      </div>`;
    }

    function outcome(kind, m) {
      if (kind === 'fill') {
        const d = m.push.fillRate - m.pull.fillRate;
        return Math.abs(d) <= 0.02 ? 'same' : d > 0 ? 'push' : 'pull';
      }
      const a = m.push.avgInventory;
      const b = m.pull.avgInventory;
      return Math.abs(a - b) <= 0.1 * Math.max(a, b) ? 'same' : a < b ? 'push' : 'pull';
    }
    const answerName = (v) => (v === 'same' ? t('pp.game.same') : t(`pp.lane.${v}`));

    function debriefView() {
      const m = app.sim.metrics();
      const rows = ['fill', 'inv'].map((k) => {
        const res = outcome(k, m);
        const ok = res === S.predict[k];
        return `<tr><th scope="row">${esc(t(k === 'fill' ? 'pp.game.q1' : 'pp.game.q2'))}</th>
          <td>${esc(answerName(S.predict[k]))}</td>
          <td class="result-mark">${ok ? `<span class="better-mark">${icon('check', { size: 14 })}</span>` : ''}${esc(answerName(res))}</td></tr>`;
      }).join('');
      const kpis = app.KPIS.filter((k) => ['cost', 'fill', 'inv', 'bo', 'lt'].includes(k.key)).map((k) => {
        const a = k.get(m.push);
        const b = k.get(m.pull);
        const w = app.winner(k, a, b);
        const mark = `<span class="better-mark">${icon('check', { size: 14 })}</span><span class="sr-only">${esc(t('pp.compare.better'))}</span>`;
        return `<tr><th scope="row">${esc(t(`pp.kpi.${k.key}Long`))}</th><td>${w === 'push' ? mark : ''}${esc(k.fmt(a))}</td><td>${w === 'pull' ? mark : ''}${esc(k.fmt(b))}</td></tr>`;
      }).join('');
      const events = S.events.map((e, i) => (e ? t('pp.game.eventAt', { r: fmtInt(i + 1), e: t(`pp.events.${e}`) }) : null)).filter(Boolean);
      return `<div class="game-body">
        <div class="game-grid">
          <div class="game-box">
            <h3>${esc(t('pp.game.predVsResult'))}</h3>
            <table class="game-table"><thead><tr><th scope="col"></th><th scope="col">${esc(t('pp.game.yourAnswer'))}</th><th scope="col">${esc(t('pp.game.result'))}</th></tr></thead><tbody>${rows}</tbody></table>
          </div>
          <div class="game-box">
            <h3>${esc(t('pp.game.score'))}</h3>
            <table class="game-table"><thead><tr><th scope="col"></th><th scope="col">${esc(t('pp.lane.push'))}</th><th scope="col">${esc(t('pp.lane.pull'))}</th></tr></thead><tbody>${kpis}</tbody></table>
            <p class="game-note">${esc(t('pp.kpi.costNote'))}</p>
          </div>
        </div>
        <div class="game-box" style="margin-top: var(--space-4)">
          <h3>${esc(t('pp.game.chartTitle'))}</h3>
          <canvas class="debrief-chart" id="debrief-chart" role="img" aria-label="${esc(t('pp.game.chartAria'))}"></canvas>
          <ul class="debrief-legend">
            <li><span class="swatch-line" aria-hidden="true"></span>${esc(t('pp.lane.push'))}</li>
            <li><span class="swatch-line swatch-line--pull" aria-hidden="true"></span>${esc(t('pp.lane.pull'))}</li>
            <li><span class="swatch-event" aria-hidden="true"></span>${esc(t('pp.game.eventsLegend'))}${events.length ? `: ${esc(events.join(' · '))}` : ''}</li>
          </ul>
        </div>
        <div class="game-box" style="margin-top: var(--space-4)">
          <h3>${esc(t('pp.game.discuss'))}</h3>
          <ol class="questions"><li>${esc(t('pp.game.dq1'))}</li><li>${esc(t('pp.game.dq2'))}</li><li>${esc(t('pp.game.dq3'))}</li></ol>
        </div>
        <div class="game-actions">
          <button type="button" class="btn btn--primary" id="game-again">${icon('rotateCcw', { size: 16 })}<span>${esc(t('pp.game.again'))}</span></button>
          <button type="button" class="btn" id="game-new">${icon('shuffle', { size: 16 })}<span>${esc(t('pp.game.newScenario'))}</span></button>
        </div>
      </div>`;
    }

    function facilitatorView() {
      const opts = (r) => ['none', ...EVENT_TYPES].map((e) => `<option value="${e}" ${(S.events[r] || 'none') === e ? 'selected' : ''}>${esc(e === 'none' ? t('pp.game.noEvent') : t(`pp.events.${e}`))}</option>`).join('');
      return `<div class="facilitator">
        <button type="button" class="link-btn" id="fac-toggle" aria-expanded="${S.facilitatorOpen}" aria-controls="fac-body">${esc(t('pp.game.facilitator'))}</button>
        <span class="game-note"> · ${esc(t('pp.seed', { seed: String(S.seed) }))}</span>
        <div class="facilitator__body" id="fac-body" ${S.facilitatorOpen ? '' : 'hidden'}>
          <div>
            <div class="field">
              <label class="field__label" for="fac-seed">${esc(t('pp.game.facSeed'))}</label>
              <input class="num-input" type="number" id="fac-seed" min="1" max="999999" step="1" value="${S.seed}" style="width: 120px">
            </div>
            <label class="switch" style="margin-top: var(--space-3)"><span>${esc(t('pp.game.facHide'))}</span><input type="checkbox" role="switch" id="fac-hide" ${S.hideKpis ? 'checked' : ''}></label>
          </div>
          <div>
            <p class="field__label">${esc(t('pp.game.facEvents'))}</p>
            <table class="game-table"><tbody>${Array.from({ length: ROUNDS }, (_, i) => `<tr><th scope="row"><label for="fac-ev-${i}">${esc(t('pp.game.roundShort', { r: fmtInt(i + 1) }))}</label></th><td><select id="fac-ev-${i}">${opts(i)}</select></td></tr>`).join('')}</tbody></table>
          </div>
          <div class="game-actions" style="grid-column: 1 / -1; margin-top: 0">
            <button type="button" class="btn" id="fac-apply">${icon('rotateCcw', { size: 16 })}<span>${esc(t('pp.game.facApply'))}</span></button>
            <span class="game-note">${esc(t('pp.game.facNote'))}</span>
          </div>
        </div>
      </div>`;
    }

    function render() {
      const body = S.stage === 'predict' ? predictView() : S.stage === 'decide' ? decideView() : S.stage === 'running' ? runningView() : debriefView();
      root.innerHTML = head() + body + facilitatorView();
      bind();
      if (S.stage === 'debrief') drawChart();
      const focusEl = root.querySelector('#game-form input, #game-form button[type="submit"]');
      if (focusEl && S.stage === 'decide') focusEl.focus({ preventScroll: true });
    }

    function bind() {
      const form = root.querySelector('#game-form');
      if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (S.stage === 'predict') {
          S.predict.fill = form.elements.fill.value || null;
          S.predict.inv = form.elements.inv.value || null;
          if (!S.predict.fill || !S.predict.inv) return;
          start();
        } else if (S.stage === 'decide') {
          confirmRound(form);
        }
      });
      root.querySelectorAll('input[type="radio"]').forEach((r) => r.addEventListener('change', () => { S.predict[r.name] = r.value; }));
      const speed = root.querySelector('#game-speed');
      speed.style.setProperty('--fill', `${(Number(speed.value) / 5) * 100}%`);
      speed.addEventListener('input', () => {
        app.setSpeed(Number(speed.value));
        const sp = app.speeds[app.speedIndex];
        root.querySelector('output[for="game-speed"]').textContent = `${LSS.i18n.formatNumber(sp, { maximumFractionDigits: 1 })}×`;
        speed.style.setProperty('--fill', `${(Number(speed.value) / 5) * 100}%`);
      });
      const pause = root.querySelector('#game-pause');
      if (pause) pause.addEventListener('click', () => app.setPlaying(!app.playing));
      const again = root.querySelector('#game-again');
      if (again) again.addEventListener('click', () => restart(false));
      const fresh = root.querySelector('#game-new');
      if (fresh) fresh.addEventListener('click', () => restart(true));
      root.querySelector('#fac-toggle').addEventListener('click', () => { S.facilitatorOpen = !S.facilitatorOpen; render(); });
      const seedIn = root.querySelector('#fac-seed');
      seedIn.addEventListener('change', () => {
        const v = Math.max(1, Math.min(999999, Math.round(Number(seedIn.value) || 1)));
        S.seed = v;
        S.events = eventsFromSeed(v);
        render();
      });
      root.querySelector('#fac-hide').addEventListener('change', (e) => { S.hideKpis = e.target.checked; applyKpiVisibility(); });
      for (let i = 0; i < ROUNDS; i++) {
        root.querySelector(`#fac-ev-${i}`).addEventListener('change', (e) => { S.events[i] = e.target.value === 'none' ? null : e.target.value; });
      }
      root.querySelector('#fac-apply').addEventListener('click', () => restart(false));
    }

    function drawChart() {
      const c = root.querySelector('#debrief-chart');
      const C = app.colors();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const series = ['push', 'pull'].map((l) => app.sim.lines[l].periods.slice(0, ROUNDS).map((p) => p.avgInventory));
      const max = Math.ceil((Math.max(1, ...series.flat()) * 1.15) / 4) * 4; // multiple of 4 → round grid labels
      const pad = { l: 34, r: 12, t: 10, b: 22 };
      const X = (i) => pad.l + (i / (ROUNDS - 1)) * (w - pad.l - pad.r);
      const Y = (v) => h - pad.b - (v / max) * (h - pad.t - pad.b);
      ctx.font = `11px ${C.font}`;
      ctx.fillStyle = C.subtle;
      ctx.strokeStyle = C.track;
      ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let k = 0; k <= 4; k++) {
        const v = (max * k) / 4;
        ctx.beginPath(); ctx.moveTo(pad.l, Math.round(Y(v)) + 0.5); ctx.lineTo(w - pad.r, Math.round(Y(v)) + 0.5); ctx.stroke();
        if (k % 2 === 0) ctx.fillText(fmt(v, 0), pad.l - 6, Y(v));
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let i = 0; i < ROUNDS; i++) ctx.fillText(t('pp.game.roundShort', { r: fmtInt(i + 1) }), X(i), h - pad.b + 6);
      ctx.strokeStyle = C.event;
      ctx.lineWidth = 2;
      S.events.forEach((e, i) => { if (e) { ctx.beginPath(); ctx.moveTo(X(i), pad.t); ctx.lineTo(X(i), h - pad.b); ctx.stroke(); } });
      [[series[0], C.navy, 0], [series[1], C.unit, 1]].forEach(([s, col, shape]) => {
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        s.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
        ctx.stroke();
        s.forEach((v, i) => {
          if (shape === 0) ctx.fillRect(X(i) - 3.5, Y(v) - 3.5, 7, 7);
          else { ctx.beginPath(); ctx.arc(X(i), Y(v), 4, 0, Math.PI * 2); ctx.fill(); }
        });
      });
      c.setAttribute('aria-label', t('pp.game.chartAriaValues', {
        push: series[0].map((v) => fmt(v)).join(', '), pull: series[1].map((v) => fmt(v)).join(', '),
      }));
    }

    // Start at the prediction screen with a paused, fresh line.
    app.newSim(Object.assign({}, GAME_PARAMS, { schedule: [] }), S.seed);
    applyKpiVisibility();
    render();

    return {
      render,
      unmount() { root.innerHTML = ''; },
      canToggle: () => S.stage === 'running',
      onPlayingChange() {
        const b = root.querySelector('#game-pause');
        if (b) b.innerHTML = `${icon(app.playing ? 'pause' : 'play', { size: 16 })}<span>${esc(t(app.playing ? 'pp.pause' : 'pp.game.resume'))}</span>`;
      },
      state: S, // exposed for facilitator tooling and tests
    };
  }

  LSS.PushPullGame = { mount, eventsFromSeed, ROUNDS, ROUND_MIN, CARD_ROUNDS };
})(window.LSS);
