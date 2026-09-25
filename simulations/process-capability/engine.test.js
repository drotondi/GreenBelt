/**
 * Unit tests for engine.js and spc.js — no dependencies.
 *   Run with node:  node simulations/process-capability/engine.test.js
 */
'use strict';
const { normalCdf, capability, ProcessSim, challengeStart, optimalPath } = require('./engine.js');
const { CONSTANTS, nelson, xbarRLimits } = require('./spc.js');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rel = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

/* 1. Capability indices, known cases */
{
  const c = capability({ mu: 100, sigma: 20 / 12, lsl: 90, usl: 110 });
  check('Centered, σ = tolerance/12 → Cp = Cpk = 2.00', near(c.cp, 2, 1e-12) && near(c.cpk, 2, 1e-12), `Cp ${c.cp}, Cpk ${c.cpk}`);
  const d = capability({ mu: 110 - 3 * 2, sigma: 2, lsl: 90, usl: 110 });
  check('μ = USL − 3σ → Cpk = 1.00 (Cpu), Cpl larger', near(d.cpk, 1, 1e-12) && near(d.cpu, 1, 1e-12) && d.cpl > 1, `Cpu ${d.cpu}, Cpl ${d.cpl}`);
  const e = capability({ mu: 105, sigma: 1.5, lsl: 90, usl: 110 });
  check('Off-center: Cp 2.22, Cpk 1.11', near(e.cp, 20 / 9, 1e-12) && near(e.cpk, 5 / 4.5, 1e-12));
  const f = capability({ mu: 100, sigma: 2.5, lsl: 90, usl: 0, uslOn: false });
  check('One-sided (LSL only): Cp N/A, Cpk = Cpl = 1.33, no USL PPM', Number.isNaN(f.cp) && near(f.cpk, 10 / 7.5, 1e-12) && f.ppmAbove === 0, `Cpk ${f.cpk}`);
}

/* 2. Normal CDF against published values (Φ to 15 significant digits) */
{
  const cases = [[0, 0.5], [-1, 0.158655253931457], [-2, 0.0227501319481792], [-3, 0.00134989803163009], [-4, 3.16712418331199e-5], [-6, 9.86587645037698e-10], [1.96, 0.97500210485178]];
  const worst = Math.max(...cases.map(([x, p]) => Math.abs(normalCdf(x) - p) / p));
  check('Φ(x) matches published values (relative error < 1e-9)', worst < 1e-9, `worst relative error ${worst.toExponential(2)}`);
  check('Φ(−3) ≈ 0.00135', near(normalCdf(-3), 0.00135, 5e-6), normalCdf(-3).toPrecision(6));
  const c = capability({ mu: 100, sigma: 10 / 3, lsl: 90, usl: 110 });
  check('Centered Cpk = 1.00 → ≈ 2,700 PPM total (1,350 each side)', near(c.ppmTotal, 2699.8, 0.1) && near(c.ppmBelow, c.ppmAbove, 1e-6), `${c.ppmTotal.toFixed(1)} PPM`);
}

/* 3. SPC constants: published table and internal consistency */
{
  const published = { // n: [d2, A2, D3, D4]
    2: [1.128, 1.880, 0, 3.267], 3: [1.693, 1.023, 0, 2.574], 4: [2.059, 0.729, 0, 2.282], 5: [2.326, 0.577, 0, 2.114],
    6: [2.534, 0.483, 0, 2.004], 7: [2.704, 0.419, 0.076, 1.924], 8: [2.847, 0.373, 0.136, 1.864], 9: [2.970, 0.337, 0.184, 1.816], 10: [3.078, 0.308, 0.223, 1.777],
  };
  let ok = true;
  let consistent = true;
  for (let n = 2; n <= 10; n++) {
    const k = CONSTANTS[n];
    const [d2, A2, D3, D4] = published[n];
    if (k.d2 !== d2 || k.A2 !== A2 || k.D3 !== D3 || k.D4 !== D4) ok = false;
    if (!near(k.A2, 3 / (k.d2 * Math.sqrt(n)), 0.002) || !near(k.D4, 1 + 3 * k.d3 / k.d2, 0.003) || !near(k.D3, Math.max(0, 1 - 3 * k.d3 / k.d2), 0.003)) consistent = false;
  }
  check('SPC constants d2, A2, D3, D4 match the standard table for n = 2–10', ok);
  check('SPC constants are internally consistent (A2 = 3/(d2√n), D3/D4 = 1 ∓ 3d3/d2)', consistent);
}

/* 4. R̄/d2 recovers true σ within 5% over 1,000 subgroups (several n) */
for (const n of [2, 5, 10]) {
  const s = new ProcessSim({ mu: 100, sigma: 2, n, seed: 11 + n });
  for (let i = 0; i < 1000; i++) s.step();
  const L = xbarRLimits(s.subgroups, n);
  check(`R̄/d2 recovers σ = 2 within 5% (n = ${n})`, rel(L.sigmaWithin, 2, 0.05), L.sigmaWithin.toFixed(3));
}

/* 5. Nelson rules: crafted sequences trigger, clean data does not */
{
  const flagged = (vals, rule) => nelson(vals, 0, 1).some((f) => f.includes(rule));
  const only = (vals, rule) => nelson(vals, 0, 1).map((f) => f.includes(rule));
  const clean = [0.3, -0.4, 0.8, -0.2, 0.5, -0.9, 0.1, -0.3, 0.6, -0.7, 0.2, 0.4, -0.5, 0.9, -0.1, 0.35, -0.6, 0.15, -0.25, 0.45];
  check('Rule 1: a point beyond 3σ is flagged', flagged([0.2, -0.3, 3.4, 0.1], 1) && only([0.2, -0.3, 3.4, 0.1], 1).indexOf(true) === 2);
  check('Rule 2: nine in a row on one side is flagged on the 9th point', only([0.2, 0.5, 0.1, 0.9, 0.3, 0.4, 0.2, 0.6, 0.1, -0.3], 2).indexOf(true) === 8 && !flagged([0.2, 0.5, 0.1, 0.9, 0.3, 0.4, 0.2, 0.6, -0.1], 2));
  check('Rule 3: six in a row increasing (and decreasing) is flagged', only([-1, -0.6, -0.2, 0.1, 0.5, 0.9, 0.2], 3).indexOf(true) === 5 && flagged([1, 0.7, 0.3, 0, -0.4, -0.8], 3) && !flagged([-1, -0.6, -0.2, 0.1, 0.5, 0.4], 3));
  const alt = Array.from({ length: 14 }, (_, i) => (i % 2 ? -0.5 : 0.5));
  check('Rule 4: fourteen alternating points are flagged on the 14th', only(alt, 4).indexOf(true) === 13 && !flagged(alt.slice(0, 13), 4));
  check('Clean sequence: no rule fires', !nelson(clean, 0, 1).some((f) => f.length), JSON.stringify(nelson(clean, 0, 1).filter((f) => f.length)));
  check('Rules can be disabled individually', !nelson([0, 3.5], 0, 1, { 1: false, 2: true, 3: true, 4: true }).some((f) => f.length));
}

/* 6. Process: in control at baseline; +1.5σ shift is detected and Cpk drops */
{
  const s = new ProcessSim({ mu: 100, sigma: 2, n: 5, seed: 3 });
  for (let i = 0; i < 50; i++) s.step();
  const before = s.windowStats();
  const stateBefore = s.state();
  const at = s.subgroups.length;
  s.event('shift');
  for (let i = 0; i < 25; i++) s.step();
  const after = s.windowStats();
  const first = s.firstFlagFrom(at);
  check('Process: frozen limits after 25 baseline subgroups, in control before the event', s.limits && s.limits.count === 25 && stateBefore === 'in', stateBefore);
  check('+1.5σ shift: flagged by the X̄ chart within 25 subgroups', first >= at && s.state() === 'out', `first flag ${first - at + 1} subgroups after the shift`);
  check('+1.5σ shift: Cpk drops by about 0.5 (1.5σ / 3σ)', before.cpk - after.cpk > 0.35 && before.cpk - after.cpk < 0.7, `${before.cpk.toFixed(2)} → ${after.cpk.toFixed(2)}`);
  check('Observed PPM is counted from individuals', Number.isFinite(s.observedPPM()) && s.observedPPM() >= 0);
}

/* 7. Variation increase lowers Cpk and Ppk < Cpk under drift (within vs overall). */
{
  const s = new ProcessSim({ mu: 100, sigma: 2, n: 5, seed: 8 });
  for (let i = 0; i < 40; i++) s.step();
  s.event('drift', 0.15);
  for (let i = 0; i < 25; i++) s.step();
  const w = s.windowStats();
  check('Drift: overall σ exceeds within σ, so Ppk < Cpk', w.sigmaOverall > w.sigmaWithin && w.ppk < w.cpk, `Cpk ${w.cpk.toFixed(2)}, Ppk ${w.ppk.toFixed(2)}`);
}

/* 8. False alarms on a stable process stay moderate with the 10-subgroup state window. */
{
  let out = 0;
  let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const s = new ProcessSim({ seed });
    for (let i = 0; i < 300; i++) { s.step(); if (i >= 50) { n++; if (s.state() === 'out') out++; } }
  }
  check('Stable process: out-of-control (false alarm) time below 25%', out / n < 0.25, `${((out / n) * 100).toFixed(1)}% of subgroups`);
}

/* 9. Reproducibility and challenge */
{
  const run = (seed) => { const s = new ProcessSim({ seed }); for (let i = 0; i < 60; i++) s.step(); return JSON.stringify(s.windowStats()); };
  check('Same seed reproduces the process exactly', run(4) === run(4) && run(4) !== run(5));
  const a = challengeStart(1234);
  const b = challengeStart(1234);
  const c0 = capability(a);
  check('Challenge: same seed → same starting case', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(challengeStart(1235)), JSON.stringify(a));
  check('Challenge: start is off-center with Cpk well below 1.33', Math.abs(a.mu - 100) >= 3 && c0.cpk < 1, `Cpk ${c0.cpk.toFixed(2)}`);
  const opt = optimalPath(a);
  const reached = capability({ mu: opt.mu, sigma: opt.sigma, lsl: 90, usl: 110 });
  check('Challenge: optimal path reaches the threshold and recenters first', reached.cpk >= 1.33 && opt.recenter > 0, `${opt.recenter} recenter + ${opt.reduce} reduce = cost ${opt.cost}`);
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll engine tests passed');
if (typeof process !== 'undefined') process.exitCode = failed ? 1 : 0;
