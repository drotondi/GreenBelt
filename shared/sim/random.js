/**
 * Shared random-number helpers for simulations. Pure logic, no DOM access.
 * Loads as LSS.sim in the browser and via module.exports in node (for tests).
 *
 *   mulberry32(seed)   → seeded uniform generator in [0, 1)
 *   makeSampler(rng)   → sample(mean, cv): gamma-distributed positive value with the
 *                        given mean and coefficient of variation (cv = 0 → mean,
 *                        cv = 1 → exponential); sample.normal(), sample.uniform()
 *   percentile(xs, q)  → nearest-rank percentile
 */
(function (root) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSampler(rng) {
    let spare = null;
    const uniform = () => {
      let u = rng();
      while (u <= 1e-12) u = rng();
      return u;
    };
    const normal = () => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return s;
      }
      const u = uniform();
      const v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    // Marsaglia–Tsang gamma(k, 1)
    const gamma = (k) => {
      if (k < 1) return gamma(k + 1) * Math.pow(uniform(), 1 / k);
      const d = k - 1 / 3;
      const c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x;
        let v;
        do {
          x = normal();
          v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = uniform();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
      }
    };
    /** Positive random time with the given mean and coefficient of variation. */
    function sample(mean, cv) {
      if (!(cv > 0)) return mean;
      const k = 1 / (cv * cv);
      return (gamma(k) * mean) / k;
    }
    sample.normal = normal;   // standard normal draw from the same stream
    sample.uniform = rng;     // uniform [0, 1) from the same stream
    return sample;
  }

  function percentile(values, q) {
    if (!values.length) return NaN;
    const s = values.slice().sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
    return s[i];
  }

  const api = { mulberry32, makeSampler, percentile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.LSS) root.LSS.sim = api;
  else if (root) root.LSS = Object.assign(root.LSS || {}, { sim: api });
})(typeof window !== 'undefined' ? window : globalThis);
