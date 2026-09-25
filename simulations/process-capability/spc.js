/**
 * Statistical process control: X̄-R chart constants, control limits and Nelson rules.
 * Pure logic, no DOM access. Browser: LSS.SPC. Node: module.exports.
 */
(function (root) {
  'use strict';

  /**
   * Control chart constants for subgroup sizes n = 2–10.
   * Source: ASTM Manual on Presentation of Data and Control Chart Analysis (MNL 7),
   * as reproduced in D. C. Montgomery, Introduction to Statistical Quality Control,
   * Appendix VI ("Factors for constructing variables control charts").
   *   d2: E[R]/σ · d3: sd[R]/σ · A2 = 3 / (d2·√n) · D3 = max(0, 1 − 3·d3/d2) · D4 = 1 + 3·d3/d2
   */
  const CONSTANTS = {
    2: { d2: 1.128, d3: 0.853, A2: 1.880, D3: 0, D4: 3.267 },
    3: { d2: 1.693, d3: 0.888, A2: 1.023, D3: 0, D4: 2.574 },
    4: { d2: 2.059, d3: 0.880, A2: 0.729, D3: 0, D4: 2.282 },
    5: { d2: 2.326, d3: 0.864, A2: 0.577, D3: 0, D4: 2.114 },
    6: { d2: 2.534, d3: 0.848, A2: 0.483, D3: 0, D4: 2.004 },
    7: { d2: 2.704, d3: 0.833, A2: 0.419, D3: 0.076, D4: 1.924 },
    8: { d2: 2.847, d3: 0.820, A2: 0.373, D3: 0.136, D4: 1.864 },
    9: { d2: 2.970, d3: 0.808, A2: 0.337, D3: 0.184, D4: 1.816 },
    10: { d2: 3.078, d3: 0.797, A2: 0.308, D3: 0.223, D4: 1.777 },
  };

  /** X̄-R limits from a set of subgroups ({ mean, range }), all of size n. */
  function xbarRLimits(subgroups, n) {
    const k = CONSTANTS[n];
    const m = subgroups.length;
    const xbarbar = subgroups.reduce((a, s) => a + s.mean, 0) / m;
    const rbar = subgroups.reduce((a, s) => a + s.range, 0) / m;
    return {
      n, count: m, xbarbar, rbar,
      uclX: xbarbar + k.A2 * rbar, lclX: xbarbar - k.A2 * rbar,
      uclR: k.D4 * rbar, lclR: k.D3 * rbar,
      sigmaWithin: rbar / k.d2,
    };
  }

  /**
   * Nelson rules on a series of points against a center line and the sigma of the
   * plotted statistic (for X̄: (UCL − CL) / 3). Each returned flag marks the point
   * that completes the pattern.
   *   1: one point beyond 3σ
   *   2: nine points in a row on the same side of the center line
   *   3: six points in a row steadily increasing or decreasing
   *   4: fourteen points in a row alternating up and down
   */
  const RULES = [1, 2, 3, 4];
  function nelson(values, cl, sigma, enabled = { 1: true, 2: true, 3: true, 4: true }) {
    const flags = values.map(() => []);
    let side = 0;
    let sideRun = 0;
    let trendDir = 0;
    let trendRun = 1;
    let altRun = 1;
    let lastDiff = 0;
    for (let i = 0; i < values.length; i++) {
      const x = values[i];
      if (enabled[1] && Math.abs(x - cl) > 3 * sigma) flags[i].push(1);

      const s = x > cl ? 1 : x < cl ? -1 : 0;
      if (s !== 0 && s === side) sideRun++;
      else { side = s; sideRun = s === 0 ? 0 : 1; }
      if (enabled[2] && sideRun >= 9) flags[i].push(2);

      if (i > 0) {
        const d = x > values[i - 1] ? 1 : x < values[i - 1] ? -1 : 0;
        if (d !== 0 && d === trendDir) trendRun++;
        else { trendDir = d; trendRun = d === 0 ? 1 : 2; }
        if (enabled[3] && trendRun >= 6) flags[i].push(3);

        if (d !== 0 && lastDiff !== 0 && d === -lastDiff) altRun++;
        else altRun = d === 0 ? 1 : 2;
        if (enabled[4] && altRun >= 14) flags[i].push(4);
        lastDiff = d;
      }
    }
    return flags;
  }

  const api = { CONSTANTS, xbarRLimits, nelson, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.LSS) root.LSS.SPC = api;
})(typeof window !== 'undefined' ? window : globalThis);
