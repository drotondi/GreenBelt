/**
 * Unit tests for engine.js — no dependencies.
 *   Run with node:  node simulations/push-pull/engine.test.js
 */
'use strict';
const { PushPullSim } = require('./engine.js');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const f1 = (x) => x.toFixed(1);
const SEEDS = [20240601, 7, 3, 11];

/* 1. Pull never exceeds its cards per SKU; WIP + FG + cards in transit = cards. */
{
  let maxOver = -Infinity;
  const s = new PushPullSim({ seed: 5, cards: [4, 3], cv: 1, demandRate: 1.3 });
  for (let i = 0; i < 4000; i++) {
    s.advance(0.05);
    const L = s.lines.pull;
    for (let k = 0; k < 2; k++) maxOver = Math.max(maxOver, L.wip(k) + L.fgCount(k) - L.cards[k]);
  }
  check('Pull: WIP + FG per SKU never exceeds its cards', maxOver <= 0, `max excess ${maxOver} over 200 min, CV 1`);

  // Changing cards mid-run: lowering cards never destroys units; the surplus only
  // drains (its cards retire on return), so held units never exceed cards + retiring.
  let ok = true;
  let conserved = true;
  let drained = false;
  const c = new PushPullSim({ seed: 5, cards: [4, 3], cv: 1, demandRate: 1.3 });
  for (let i = 0; i < 6000; i++) {
    if (i === 2000) c.setParams({ cards: [2, 6] });
    if (i === 4000) c.setParams({ cards: [7, 1] });
    c.advance(0.05);
    const L = c.lines.pull;
    for (let k = 0; k < 2; k++) {
      const held = L.wip(k) + L.fgCount(k);
      const transit = L.cardsInTransit.filter((x) => x.sku === k).length;
      if (held > L.cards[k] + L.retire[k]) ok = false;
      if (held + transit !== L.cards[k] + L.retire[k]) conserved = false;
    }
    if (i > 4000 && L.retire[1] === 0 && L.wip(1) + L.fgCount(1) <= 1) drained = true;
  }
  check('Pull: after lowering cards, held units never exceed cards + retiring cards', ok);
  check('Pull: WIP + FG + transit = cards + retiring, and the surplus drains to the new cap', conserved && drained);
}

/* 2. Both lines receive the identical demand stream; the stream does not depend on line settings. */
{
  const a = new PushPullSim({ seed: 42, keepDemandLog: true, cards: [4, 3], safety: 2 });
  const b = new PushPullSim({ seed: 42, keepDemandLog: true, cards: [15, 15], safety: 9, capA: 3, capB: 3 });
  a.advance(300);
  b.advance(300);
  const same = JSON.stringify(a.demandLog) === JSON.stringify(b.demandLog);
  const lines = a.lines.push.demand.join() === a.lines.pull.demand.join();
  check('Demand: push and pull lines see the same orders', lines, `push ${a.lines.push.demand} · pull ${a.lines.pull.demand}`);
  check('Demand: stream identical for a seed, independent of line settings', same && a.demandLog.length > 250, `${a.demandLog.length} orders`);
  const c = new PushPullSim({ seed: 43, keepDemandLog: true });
  c.advance(300);
  check('Demand: a different seed gives a different stream', JSON.stringify(c.demandLog) !== JSON.stringify(a.demandLog));
}

/* 3. Zero forecast error and CV = 0 → both lines serve 100% of demand immediately. */
{
  const s = new PushPullSim({ cv: 0, bias: 0, noise: 0 });
  s.advance(300);
  const m = s.metrics();
  check('CV 0 + perfect forecast: push fill rate 100%', m.push.fillRate === 1, pct(m.push.fillRate));
  check('CV 0 + perfect forecast: pull fill rate 100%', m.pull.fillRate === 1, pct(m.pull.fillRate));
}

/* 4. Forecast bias +30% → push holds more inventory than pull (several seeds). */
for (const seed of SEEDS) {
  const s = new PushPullSim({ seed, bias: 0.3 });
  s.advance(200);
  const m = s.metrics();
  check(`Bias +30% (seed ${seed}): push avg inventory > pull`, m.push.avgInventory > m.pull.avgInventory,
    `push ${f1(m.push.avgInventory)} vs pull ${f1(m.pull.avgInventory)}`);
}

/* 5. Reproducibility. */
{
  const run = (seed) => { const s = new PushPullSim({ seed }); s.advance(200); return JSON.stringify(s.metrics()); };
  check('Seeded: same seed reproduces the run exactly', run(9) === run(9));
  check('Seeded: different seed changes the run', run(9) !== run(10));
}

/* 6. Card sizing: too few starve, too many behave like push. */
for (const seed of SEEDS.slice(0, 2)) {
  const few = new PushPullSim({ seed, cards: [1, 1] });
  few.advance(120);
  const many = new PushPullSim({ seed, cards: [15, 12] });
  many.advance(120);
  const mf = few.metrics();
  const mm = many.metrics();
  check(`Too few cards (seed ${seed}): pull starves, fill rate < 50%`, mf.pull.fillRate < 0.5, pct(mf.pull.fillRate));
  check(`Too many cards (seed ${seed}): pull inventory ≥ push`, mm.pull.avgInventory >= mm.push.avgInventory,
    `pull ${f1(mm.pull.avgInventory)} vs push ${f1(mm.push.avgInventory)}`);
}

/* 7. Mix shift: push builds the wrong SKU and stocks out on the other; pull follows demand. */
for (const seed of SEEDS.slice(0, 3)) {
  const s = new PushPullSim({ seed, cards: [5, 4], schedule: [{ t: 30.5, type: 'mix' }] });
  s.advance(30.4);
  const bo = [s.lines.push.backorders[1], s.lines.pull.backorders[1]];
  s.advance(10);
  const P = s.lines.push.periods.at(-1);
  const Q = s.lines.pull.periods.at(-1);
  const addPush = s.lines.push.backorders[1] - bo[0];
  const addPull = s.lines.pull.backorders[1] - bo[1];
  check(`Mix shift (seed ${seed}): push holds wrong-mix stock and stocks out on SKU 2, pull does not`,
    P.wrongMix > Q.wrongMix && addPush > addPull,
    `wrong-mix ${P.wrongMix.toFixed(2)} vs ${Q.wrongMix.toFixed(2)}, SKU 2 backorders +${addPush} vs +${addPull}`);
}

/* 8. Scheduled events fire at the given time and spikes end after 10 minutes. */
{
  const s = new PushPullSim({ schedule: [{ t: 12, type: 'spike' }] });
  s.advance(11.9);
  const before = s.rateFactor;
  s.advance(0.2);
  const during = s.rateFactor;
  s.advance(10);
  check('Events: spike starts on schedule (+50%) and ends after 10 min', before === 1 && during === 1.5 && s.rateFactor === 1 && s.events[0].t === 12);
}

/* 9. Changeover time lengthens lead time. */
{
  const a = new PushPullSim({ seed: 2 });
  const b = new PushPullSim({ seed: 2, changeover: true });
  a.advance(200);
  b.advance(200);
  check('Changeover: enabling it increases push lead time', b.metrics().push.leadTime > a.metrics().push.leadTime,
    `${f1(a.metrics().push.leadTime)} → ${f1(b.metrics().push.leadTime)} min`);
}

/* 10. Manual release (Game mode): no automatic MRP releases. */
{
  const s = new PushPullSim({ autoRelease: false });
  s.advance(30);
  const r0 = s.lines.push.released.join();
  s.lines.push.manualRelease([3, 2], s.t);
  check('Game mode: push releases only what the player decides', r0 === '0,0' && s.lines.push.released.join() === '3,2');
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll engine tests passed');
if (typeof process !== 'undefined') process.exitCode = failed ? 1 : 0;
