/**
 * Minimal canvas chart helpers shared by simulations (no DOM beyond the canvas).
 * Browser: LSS.chart.
 *
 *   const { ctx, w, h } = LSS.chart.setup(canvas);        // DPR-scaled, cleared
 *   const x = LSS.chart.scale(0, 50, pad.l, w - pad.r);    // x(v), x.invert(px)
 *   LSS.chart.gridY(ctx, y, ticks, pad.l, w - pad.r, color);
 *   LSS.chart.polyline(ctx, pts.map(([a, b]) => [x(a), y(b)]), { color, width, dash });
 */
(function (LSS) {
  'use strict';

  const MAX_DPR = 2;

  function setup(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h, dpr };
  }

  /** Linear scale from domain [d0, d1] to range [r0, r1], with .invert(). */
  function scale(d0, d1, r0, r1) {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    const f = (v) => r0 + (v - d0) * k;
    f.invert = (px) => d0 + (px - r0) / k;
    f.domain = [d0, d1];
    f.range = [r0, r1];
    return f;
  }

  /** "Nice" tick values covering [min, max] with about `count` steps. */
  function niceTicks(min, max, count = 5) {
    if (!(max > min)) return [min];
    const raw = (max - min) / count;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step + 0); // + 0 turns −0 into 0
    return out;
  }

  function line(ctx, x0, y0, x1, y1, { color, width = 1, dash = null } = {}) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  /** Horizontal gridlines at each tick, crisp on whole pixels. */
  function gridY(ctx, y, ticks, x0, x1, color) {
    for (const v of ticks) {
      const py = Math.round(y(v)) + 0.5;
      line(ctx, x0, py, x1, py, { color });
    }
  }

  /** Polyline through pixel points; NaN points break the line. */
  function polyline(ctx, pts, { color, width = 1.5, dash = null } = {}) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    for (const [px, py] of pts) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) { pen = false; continue; }
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
    ctx.restore();
  }

  function dots(ctx, pts, { color, r = 2.5 } = {}) {
    ctx.fillStyle = color;
    for (const [px, py] of pts) {
      if (!Number.isFinite(py)) continue;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Vertical markers (e.g. process events) at data positions xs. */
  function vmarkers(ctx, xs, x, y0, y1, { color, width = 1.5 } = {}) {
    for (const v of xs) {
      const px = x(v);
      if (px < x.range[0] - 1 || px > x.range[1] + 1) continue;
      line(ctx, px, y0, px, y1, { color, width });
    }
  }

  function text(ctx, str, px, py, { color, font, align = 'left', baseline = 'alphabetic', weight = '' } = {}) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${weight ? weight + ' ' : ''}11px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, px, py);
    ctx.restore();
  }

  LSS.chart = { setup, scale, niceTicks, line, gridY, polyline, dots, vmarkers, text };
})(window.LSS = window.LSS || {});
