/**
 * Unit tests for engine.js — no dependencies.
 *   Run with node:  node simulations/littles-law/engine.test.js
 */
'use strict';
const { LittleEngine } = require('./engine.js');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const pct = (a, b) => Math.abs(a - b) / b;
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/* 1. Deterministic, no waiting: λ = 1/min (1 min apart), each process 0.5 min.
 *    Hand calculation: LT = 3 × 0.5 = 1.5 min, TH = 1/min, WIP = TH × LT = 1.5.
 *    Window [20, 120] contains exactly 100 exits (20.5 … 119.5). */
{
  const e = new LittleEngine({ lambda: 1, mu: [2, 2, 2], cv: 0, warmup: 20 });
  e.advance(120);
  const m = e.metrics();
  check('Deterministic: lead time = 1.5 min', near(m.leadTime, 1.5, 1e-9), f(m.leadTime));
  check('Deterministic: throughput = 1.0 /min', near(m.throughput, 1, 1e-9), f(m.throughput));
  check('Deterministic: time-average WIP = 1.5', near(m.wipAvg, 1.5, 1e-9), f(m.wipAvg));
  check('Deterministic: utilization 50% each', m.stations.every((s) => near(s.util, 0.5, 1e-9)), m.stations.map((s) => f(s.util)).join(' / '));
  check('Deterministic: P90 lead time = 1.5', near(m.leadTimeP90, 1.5, 1e-9), f(m.leadTimeP90));
}

/* 2. Deterministic with a slower middle process: P2 = 0.8 min, still < 1 min apart.
 *    LT = 0.5 + 0.8 + 0.5 = 1.8, WIP = 1.8, util P2 = 80%, bottleneck = P2. */
{
  const e = new LittleEngine({ lambda: 1, mu: [2, 1.25, 2], cv: 0, warmup: 20 });
  e.advance(120);
  const m = e.metrics();
  check('Deterministic bottleneck: LT = 1.8, WIP = 1.8', near(m.leadTime, 1.8, 1e-9) && near(m.wipAvg, 1.8, 1e-9), `LT ${f(m.leadTime)}, WIP ${f(m.wipAvg)}`);
  check('Deterministic bottleneck: P2 utilization 80% and flagged', near(m.stations[1].util, 0.8, 1e-9) && m.bottleneck === 1, `util ${f(m.stations[1].util)}, bottleneck P${m.bottleneck + 1}`);
}

/* 3. Same seed → same run; different seed → different run. */
{
  const run = (seed) => { const e = new LittleEngine({ lambda: 1.5, mu: [2, 2, 2], cv: 0.6, seed }); e.advance(500); return e.metrics(); };
  const a = run(7), b = run(7), c = run(8);
  check('Seeded: same seed reproduces the run', a.wipAvg === b.wipAvg && a.completedTotal === b.completedTotal);
  check('Seeded: different seed gives a different run', a.wipAvg !== c.wipAvg);
}

/* 4. Stable random line: measured WIP ≈ TH × LT within 5% after warm-up (several seeds). */
for (const [cv, seed] of [[0.3, 1], [0.6, 2], [1.0, 3], [1.0, 4]]) {
  const e = new LittleEngine({ lambda: 1.5, mu: [2, 1.8, 2.2], cv, seed });
  e.advance(3000);
  const m = e.metrics();
  check(`Stable (CV ${cv}, seed ${seed}): WIP ≈ TH × LT within 5%`, m.stable && m.littleDiff < 0.05,
    `WIP ${f(m.wipAvg, 2)} vs ${f(m.throughput, 3)} × ${f(m.leadTime, 2)} = ${f(m.littleProduct, 2)} (${f(m.littleDiff * 100, 2)}%)`);
}

/* 5. Engine validity: CV = 1 is a tandem of M/M/1 queues (Jackson network).
 *    ρ = 0.75 per station → L = ρ/(1−ρ) = 3 each → WIP = 9, LT = WIP/λ = 6 min. */
{
  const e = new LittleEngine({ lambda: 1.5, mu: [2, 2, 2], cv: 1, seed: 11, warmup: 100 });
  e.advance(40000);
  const m = e.metrics();
  check('M/M/1 tandem: WIP ≈ 9 (±10%)', pct(m.wipAvg, 9) < 0.1, f(m.wipAvg, 2));
  check('M/M/1 tandem: lead time ≈ 6 min (±10%)', pct(m.leadTime, 6) < 0.1, f(m.leadTime, 2));
  check('M/M/1 tandem: throughput ≈ λ = 1.5 (±3%)', pct(m.throughput, 1.5) < 0.03, f(m.throughput, 3));
}

/* 6. Unstable: λ ≥ bottleneck capacity in push → flagged, WIP keeps growing. */
{
  const e = new LittleEngine({ lambda: 2, mu: [2.5, 1.7, 2.5], cv: 0.3, seed: 5 });
  e.advance(200);
  const w1 = e.wip;
  e.advance(200);
  const w2 = e.wip;
  const m = e.metrics();
  check('Unstable: flagged when λ ≥ min μ (push)', m.stable === false);
  check('Unstable: WIP grows without bound', w2 > w1 + 30, `WIP ${w1} → ${w2}`);
  const eq = new LittleEngine({ lambda: 1.7, mu: [2.5, 1.7, 2.5], cv: 0 });
  check('Unstable: λ = min μ is also flagged', eq.metrics().stable === false);
}

/* 7. Pull (CONWIP): line WIP never exceeds the cap; backlog is outside the line. */
{
  const cap = 6;
  const e = new LittleEngine({ lambda: 2, mu: [2.5, 1.7, 2.5], cv: 0.3, policy: 'pull', wipCap: cap, seed: 9 });
  let maxWip = 0;
  let counted = true;
  for (let i = 0; i < 20000; i++) {
    e.advance(0.05);
    maxWip = Math.max(maxWip, e.wip);
    const inLine = e.queues.reduce((a, q) => a + q.length, 0) + e.stations.filter((s) => s.unit).length;
    if (inLine !== e.wip) counted = false;
  }
  const m = e.metrics();
  check('Pull: WIP never exceeds the cap', maxWip <= cap, `max WIP ${maxWip}, cap ${cap}`);
  check('Pull: WIP counts only units inside the line', counted);
  check('Pull: excess arrivals wait in the backlog', m.backlog > 50, `backlog ${m.backlog}`);
  check('Pull: throughput near bottleneck rate 1.7 (≥ 90%)', m.throughput > 0.9 * 1.7 && m.throughput <= 1.7 + 0.02, f(m.throughput, 3));
  check('Pull: Little holds for the line (within 5%)', m.littleDiff < 0.05, `${f(m.littleDiff * 100, 2)}%`);
  check('Pull: reported stable (line WIP bounded)', m.stable === true);
}

/* 8. Regime change: units carried over from the previous regime do not enter the
 *    new lead-time average (overload builds a queue, then arrivals drop). */
{
  const e = new LittleEngine({ lambda: 2, mu: [2.5, 1.7, 2.5], cv: 0.3, seed: 21 });
  const done = [];
  const complete = e.complete.bind(e);
  e.complete = (u) => { done.push(u); complete(u); };
  e.advance(200);
  const carried = e.wip;
  e.setParams({ lambda: 1.0 });
  const w = e.warmupEnd;
  e.advance(60);
  const m = e.metrics();
  const inWindow = done.filter((u) => u.exit >= w);
  const current = inWindow.filter((u) => u.enter >= w);
  const mean = (a) => a.reduce((s, u) => s + u.leadTime, 0) / a.length;
  check('Regime change: lead time uses only units that entered after the window opened',
    current.length > 0 && m.leadTimeCount === current.length && near(m.leadTime, mean(current), 1e-9),
    `${current.length} current-regime units, LT ${f(m.leadTime, 2)} (mixing all ${inWindow.length} exits would give ${f(mean(inWindow), 2)}; ${carried} units carried over)`);
  check('Regime change: throughput still counts every exit in the window', m.completedInWindow === inWindow.length);
}

/* 9. Changing parameters restarts measurement (new warm-up). */
{
  const e = new LittleEngine({ lambda: 1.5, mu: [2, 2, 2], cv: 0.3 });
  e.advance(100);
  const before = e.metrics().warm;
  e.setParams({ mu: [2, 1.6, 2] });
  const after = e.metrics();
  check('setParams: restarts warm-up and keeps units in the line', before && !after.warm && after.warmupRemaining === 20 && e.wip === after.wip);
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll engine tests passed');
if (typeof process !== 'undefined') process.exitCode = failed ? 1 : 0;
