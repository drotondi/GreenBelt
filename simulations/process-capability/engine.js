/**
 * Process capability — statistics and process simulation. Pure logic, no DOM.
 * Browser: LSS.Capability. Node: module.exports.
 *
 *   Cp  = (USL − LSL) / 6σ                  (two-sided only; N/A otherwise)
 *   Cpu = (USL − μ) / 3σ,  Cpl = (μ − LSL) / 3σ,  Cpk = min(available one-sided indices)
 *   Pp, Ppk: same formulas with the overall sample standard deviation.
 *   From the simulated process, Cp/Cpk use within-subgroup σ = R̄ / d2.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const { mulberry32, makeSampler } = isNode ? require('../../shared/sim/random.js') : root.LSS.sim;
  const SPC = isNode ? require('./spc.js') : root.LSS.SPC;

  /* ---------- Normal CDF ----------
   * Hart (1968) double-precision algorithm as given by G. West, "Better approximations
   * to cumulative normal functions" (Wilmott, 2005). Absolute error ~1e-15 and good
   * relative accuracy in the tails, which matters for PPM at high Cpk. (More precise
   * than Abramowitz–Stegun 7.1.26, whose 1.5e-7 absolute error would swamp Φ(−6).) */
  function normalCdf(x) {
    const z = Math.abs(x);
    let c = 0;
    if (z <= 37) {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let n = 3.52624965998911e-2 * z + 0.700383064443688;
        n = n * z + 6.37396220353165;
        n = n * z + 33.912866078383;
        n = n * z + 112.079291497871;
        n = n * z + 221.213596169931;
        n = n * z + 220.206867912376;
        let d = 8.83883476483184e-2 * z + 1.75566716318264;
        d = d * z + 16.064177579207;
        d = d * z + 86.7807322029461;
        d = d * z + 296.564248779674;
        d = d * z + 637.333633378831;
        d = d * z + 793.826512519948;
        d = d * z + 440.413735824752;
        c = (e * n) / d;
      } else {
        let b = z + 0.65;
        b = z + 4 / b;
        b = z + 3 / b;
        b = z + 2 / b;
        b = z + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }
  /** Upper tail P(Z > x) without cancellation for large x. */
  const upperTail = (x) => normalCdf(-x);

  /* ---------- Capability indices ---------- */
  /**
   * @param {{ mu, sigma, lsl, usl, lslOn = true, uslOn = true }} p
   * @returns indices (NaN when not defined) and expected PPM from the normal model.
   */
  function capability({ mu, sigma, lsl, usl, lslOn = true, uslOn = true }) {
    const both = lslOn && uslOn;
    const cp = both ? (usl - lsl) / (6 * sigma) : NaN;
    const cpu = uslOn ? (usl - mu) / (3 * sigma) : NaN;
    const cpl = lslOn ? (mu - lsl) / (3 * sigma) : NaN;
    const cpk = both ? Math.min(cpu, cpl) : uslOn ? cpu : lslOn ? cpl : NaN;
    const below = lslOn ? normalCdf((lsl - mu) / sigma) * 1e6 : 0;
    const above = uslOn ? upperTail((usl - mu) / sigma) * 1e6 : 0;
    return { cp, cpu, cpl, cpk, ppmBelow: below, ppmAbove: above, ppmTotal: below + above };
  }

  /* ---------- Contexts (label-only, illustrative) ---------- */
  const CONTEXTS = {
    generic: { center: 100, half: 10, decimals: 1 },
    film: { center: 50, half: 2.5, decimals: 2 },
    seal: { center: 30, half: 5, decimals: 1 },
    fill: { center: 500, half: 5, decimals: 1 },
  };

  /* ---------- Process simulation ---------- */
  const WINDOW = 25;                 // subgroups for rolling KPIs (capability window)
  // A signal in the last STATE_WINDOW subgroups marks the process out of control.
  // (With limits estimated from 25 subgroups and rules 1–4, a stable process shows
  // about 19% false-alarm time with 10 vs. about 40% with 25; detection of a 1.5σ
  // shift is equally fast. See engine.test.js.)
  const STATE_WINDOW = 10;
  const MAX_INDIVIDUALS = 200000;

  const PROCESS_DEFAULTS = {
    mu: 100, sigma: 2, lsl: 90, usl: 110, lslOn: true, uslOn: true, target: 100,
    n: 5, baseline: 25, seed: 20240601,
    shiftSize: 1.5,                  // σ units
    driftPerSubgroup: 0.1,           // σ units per subgroup
    varFactor: 1.5,
    outlierProb: 0.12,               // share of subgroups with one outlier
    outlierSize: 4.5,                // σ units
    rules: { 1: true, 2: true, 3: true, 4: true },
  };

  class ProcessSim {
    constructor(params = {}) {
      this.params = Object.assign({}, PROCESS_DEFAULTS, params);
      this.params.rules = Object.assign({}, PROCESS_DEFAULTS.rules, params.rules || {});
      this.sample = makeSampler(mulberry32(this.params.seed >>> 0));
      this.subgroups = [];
      this.individuals = [];
      this.events = [];              // { i, type } — i = index of the first affected subgroup
      this.offset = 0;               // mean shift (absolute units)
      this.drift = 0;                // per-subgroup drift (absolute units), 0 when off
      this.sigmaFactor = 1;
      this.outliers = false;
      this.limits = null;
      this.limitsFrom = 0;           // first subgroup index of the current baseline
      this.flagsX = [];
      this.flagsR = [];
      this.rolling = [];             // [i, cpk] per subgroup
    }

    get n() { return this.params.n; }

    /** Parameter change applied from the next subgroup (no reset, like a real process). */
    setParams(partial) {
      Object.assign(this.params, partial);
      if (partial.rules) this.params.rules = Object.assign({}, this.params.rules, partial.rules);
      if (partial.rules && this.limits) this.reflag();
    }

    trueMean() { return this.params.mu + this.offset; }
    trueSigma() { return this.params.sigma * this.sigmaFactor; }

    event(type, value) {
      const p = this.params;
      const s = p.sigma;
      if (type === 'shift') this.offset += (value !== undefined ? value : p.shiftSize) * s;
      else if (type === 'drift') this.drift = (value !== undefined ? value : p.driftPerSubgroup) * s;
      else if (type === 'variation') this.sigmaFactor *= value !== undefined ? value : p.varFactor;
      else if (type === 'outliers') this.outliers = true;
      else if (type === 'baseline') { this.offset = 0; this.drift = 0; this.sigmaFactor = 1; this.outliers = false; }
      this.events.push({ i: this.subgroups.length, type });
    }

    step() {
      const p = this.params;
      if (this.drift) this.offset += this.drift;
      const mu = this.trueMean();
      const sd = this.trueSigma();
      const values = [];
      for (let k = 0; k < p.n; k++) values.push(mu + sd * this.sample.normal());
      if (this.outliers && this.sample.uniform() < p.outlierProb) {
        const j = Math.floor(this.sample.uniform() * p.n);
        values[j] = mu + (this.sample.uniform() < 0.5 ? -1 : 1) * p.outlierSize * p.sigma;
      }
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (const v of values) { sum += v; if (v < min) min = v; if (v > max) max = v; }
      const sg = { i: this.subgroups.length, values, mean: sum / p.n, range: max - min };
      this.subgroups.push(sg);
      for (const v of values) this.individuals.push(v);
      if (this.individuals.length > MAX_INDIVIDUALS) this.individuals.splice(0, this.individuals.length - MAX_INDIVIDUALS);

      if (!this.limits && this.subgroups.length - this.limitsFrom >= p.baseline) {
        this.limits = SPC.xbarRLimits(this.subgroups.slice(this.limitsFrom, this.limitsFrom + p.baseline), p.n);
        this.reflag();
      } else if (this.limits) {
        this.reflag(true);
      }
      const r = this.windowStats();
      this.rolling.push([sg.i, r ? r.cpk : NaN]);
      return sg;
    }

    /** New baseline: limits from the last `baseline` subgroups (or the next ones, if fewer exist). */
    recalcLimits() {
      const b = this.params.baseline;
      if (this.subgroups.length >= b) {
        this.limitsFrom = this.subgroups.length - b;
        this.limits = SPC.xbarRLimits(this.subgroups.slice(this.limitsFrom), this.params.n);
        this.reflag();
      } else {
        this.limitsFrom = this.subgroups.length;
        this.limits = null;
        this.flagsX = [];
        this.flagsR = [];
      }
    }

    /** Evaluate Nelson rules from the start of the current baseline (limits are frozen). */
    reflag() {
      const L = this.limits;
      if (!L) return;
      const from = this.limitsFrom;
      const sg = this.subgroups.slice(from);
      const sigmaX = (L.uclX - L.xbarbar) / 3;
      const fx = SPC.nelson(sg.map((s) => s.mean), L.xbarbar, sigmaX, this.params.rules);
      const fr = sg.map((s) => (this.params.rules[1] && (s.range > L.uclR || s.range < L.lclR - 1e-12) ? [1] : []));
      this.flagsX = new Array(from).fill(null).concat(fx);
      this.flagsR = new Array(from).fill(null).concat(fr);
    }

    /** State: 'baseline' until limits exist; then 'out' if any rule fired in the last STATE_WINDOW subgroups. */
    state() {
      if (!this.limits) return 'baseline';
      const end = this.subgroups.length;
      for (let i = Math.max(this.limitsFrom, end - STATE_WINDOW); i < end; i++) {
        if ((this.flagsX[i] && this.flagsX[i].length) || (this.flagsR[i] && this.flagsR[i].length)) return 'out';
      }
      return 'in';
    }

    /** Rolling capability over the last WINDOW subgroups (fewer at the start). */
    windowStats(windowSize = WINDOW) {
      const p = this.params;
      const sg = this.subgroups.slice(-windowSize);
      if (sg.length < 2) return null;
      const k = SPC.CONSTANTS[p.n];
      const xbarbar = sg.reduce((a, s) => a + s.mean, 0) / sg.length;
      const rbar = sg.reduce((a, s) => a + s.range, 0) / sg.length;
      const within = rbar / k.d2;
      let m = 0;
      let q = 0;
      let count = 0;
      for (const s of sg) for (const v of s.values) { count++; const d = v - m; m += d / count; q += d * (v - m); }
      const overall = Math.sqrt(q / (count - 1));
      const spec = { lsl: p.lsl, usl: p.usl, lslOn: p.lslOn, uslOn: p.uslOn };
      const w = capability({ mu: xbarbar, sigma: within, ...spec });
      const o = capability({ mu: xbarbar, sigma: overall, ...spec });
      return {
        subgroups: sg.length, mean: xbarbar, sigmaWithin: within, sigmaOverall: overall,
        cp: w.cp, cpk: w.cpk, cpu: w.cpu, cpl: w.cpl, pp: o.cp, ppk: o.cpk, ppmExpected: w.ppmTotal, ppmBelow: w.ppmBelow, ppmAbove: w.ppmAbove,
      };
    }

    /** Observed out-of-spec individuals as PPM over the last `count` individuals (all if omitted). */
    observedPPM(count) {
      const p = this.params;
      const xs = count ? this.individuals.slice(-count) : this.individuals;
      if (!xs.length) return NaN;
      let out = 0;
      for (const v of xs) if ((p.lslOn && v < p.lsl) || (p.uslOn && v > p.usl)) out++;
      return (out / xs.length) * 1e6;
    }

    firstFlagFrom(i) {
      for (let j = i; j < this.subgroups.length; j++) {
        if ((this.flagsX[j] && this.flagsX[j].length) || (this.flagsR[j] && this.flagsR[j].length)) return j;
      }
      return -1;
    }
  }

  /* ---------- Challenge ---------- */
  const CHALLENGE_DEFAULTS = {
    threshold: 1.33,
    costs: { recenter: 1, reduce: 5, widen: 8 },
    recenterStep: 1,        // units per recenter action (generic context)
    reduceFactor: 0.9,
    widenStep: 1,           // each side, units
    widenMax: 2,
    widenAcceptProb: 0.5,
  };

  /** Seeded starting case: off-center and too much variation (Cp ≈ 0.85–1.15, offset 3–6 units). */
  function challengeStart(seed) {
    const rng = mulberry32(((seed >>> 0) ^ 0x27D4EB2F) >>> 0);
    const lsl = 90;
    const usl = 110;
    const sigma = Math.round((2.9 + rng() * 1.0) * 10) / 10;
    const offset = Math.round((3 + rng() * 3) * 2) / 2;
    const mu = 100 + (rng() < 0.5 ? -offset : offset);
    return { mu, sigma, lsl, usl, target: 100, lslOn: true, uslOn: true, seed: seed >>> 0 };
  }

  /**
   * Cheapest sequence of recenter and reduce-variation actions that reaches the threshold
   * (theoretical Cpk). Spec widening is excluded: the customer may reject it.
   */
  function optimalPath(start, opts = {}) {
    const o = Object.assign({}, CHALLENGE_DEFAULTS, opts, { costs: Object.assign({}, CHALLENGE_DEFAULTS.costs, opts.costs || {}) });
    const center = (start.lsl + start.usl) / 2;
    const dist = Math.abs(start.mu - center);
    const dir = start.mu > center ? -1 : 1;
    let best = null;
    for (let m = 0; m <= 30; m++) {
      const sigma = start.sigma * Math.pow(o.reduceFactor, m);
      for (let k = 0; k <= Math.ceil(dist / o.recenterStep) + 1; k++) {
        const mu = start.mu + dir * Math.min(k * o.recenterStep, dist + o.recenterStep);
        const c = capability({ mu, sigma, lsl: start.lsl, usl: start.usl });
        if (c.cpk >= o.threshold - 1e-9) {
          const cost = k * o.costs.recenter + m * o.costs.reduce;
          if (!best || cost < best.cost - 1e-9) best = { recenter: k, reduce: m, cost, cpk: c.cpk, mu, sigma };
          break; // more recentering for this m only costs more
        }
      }
    }
    return best;
  }

  const api = {
    normalCdf, capability, CONTEXTS, ProcessSim, PROCESS_DEFAULTS, WINDOW, STATE_WINDOW,
    CHALLENGE_DEFAULTS, challengeStart, optimalPath,
  };
  if (isNode) module.exports = api;
  if (root && root.LSS) root.LSS.Capability = api;
})(typeof window !== 'undefined' ? window : globalThis);
