/**
 * Shared motion helpers. The hub's standard easing is cubic-bezier(.2, 0, .2, 1)
 * (same curve as --ease-standard in tokens.css), exposed as a fast lookup table
 * for canvas animations.
 *   LSS.motion.ease(t)  → eased progress for t in [0, 1]
 */
(function (LSS) {
  'use strict';

  function makeCubicBezier(x1, y1, x2, y2, n = 256) {
    const bx = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    const by = (s) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
    const table = new Float32Array(n + 1);
    let s = 0;
    for (let j = 0; j <= n; j++) {
      const x = j / n;
      while (s < 1 && bx(s) < x) s += 1 / 4096;
      table[j] = by(Math.min(s, 1));
    }
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const f = x * n;
      const i = f | 0;
      return table[i] + (table[i + 1] - table[i]) * (f - i);
    };
  }
  const ease = makeCubicBezier(0.2, 0, 0.2, 1);

  LSS.motion = { makeCubicBezier, ease };
})(window.LSS = window.LSS || {});
