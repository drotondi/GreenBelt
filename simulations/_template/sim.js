/**
 * Simulation template: shared chrome, i18n, a DPR-scaled canvas, a frame loop,
 * play/reset, one slider, a throttled aria-live region and reduced-motion support.
 * Replace the "random points" demo with your simulation.
 */
(function (LSS) {
  'use strict';

  const { initI18n, onLangChange, t, formatNumber } = LSS.i18n;
  const { renderHeader, renderFooter } = LSS.header;
  const { icon } = LSS.icons;

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const canvas = $('sim-canvas');
  const ctx = canvas.getContext('2d');
  const ui = { play: $('btn-play'), reset: $('btn-reset'), rate: $('in-rate'), outRate: $('out-rate'), count: $('stat-count'), live: $('live-region') };

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();

  const state = { playing: false, rate: Number(ui.rate.value), points: [], acc: 0 };
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color('--sim-ball');
    for (const [x, y] of state.points) {
      ctx.beginPath();
      ctx.arc(x * W, y * H, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.playing) {
      state.acc += dt * state.rate * (reducedMotion.matches ? 4 : 1);
      while (state.acc >= 1) {
        state.points.push([Math.random(), Math.random()]);
        state.acc -= 1;
      }
      draw();
      renderStats();
    }
    requestAnimationFrame(frame);
  }

  function renderStats() { ui.count.textContent = formatNumber(state.points.length); }

  function renderText() {
    ui.play.innerHTML = `${icon(state.playing ? 'pause' : 'play', { size: 16 })}<span>${t(state.playing ? 'tpl.pause' : 'tpl.play')}</span>`;
    ui.reset.innerHTML = `${icon('rotateCcw', { size: 16 })}<span>${t('tpl.reset')}</span>`;
    ui.outRate.textContent = formatNumber(state.rate);
    $('about-icon').innerHTML = icon('chevronDown', { size: 18 });
    renderStats();
  }

  ui.play.addEventListener('click', () => { state.playing = !state.playing; renderText(); });
  ui.reset.addEventListener('click', () => { state.points = []; state.playing = false; renderText(); draw(); });
  ui.rate.addEventListener('input', () => { state.rate = Number(ui.rate.value); renderText(); });

  setInterval(() => { ui.live.textContent = t('tpl.live', { count: formatNumber(state.points.length) }); }, 1000);
  new ResizeObserver(resize).observe(stage);

  renderHeader({ variant: 'sim' });
  renderFooter();
  onLangChange(renderText);
  initI18n();
  requestAnimationFrame(frame);
})(window.LSS);
