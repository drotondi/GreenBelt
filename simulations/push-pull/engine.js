/**
 * Push vs. Pull — two identical 2-step lines fed by the same demand stream.
 * Pure logic: no DOM access. Browser: LSS.PushPull. Node: module.exports.
 *
 *   Raw material → A → B → Finished goods (FG) → Customer
 *
 * Wrong-mix inventory: time-average of finished goods of one SKU sitting on hand
 * while customers of the other SKU are waiting (backorders). It isolates the push
 * failure mode "excess of the wrong item, stockout of the right one".
 *
 * Time unit: simulated minutes. Rates: units per minute. Two SKUs (0 and 1).
 *
 * Both lines see the identical demand stream and the identical forecast; only the
 * release rule differs:
 *   push — every planning period, release per SKU
 *          forecast × period + safety stock − (FG + WIP) + backorders
 *          (inventory-position MRP rule), or a manual quantity in Game mode.
 *   pull — kanban: each SKU has N cards; consuming a FG unit sends its card back
 *          upstream (travel time cardDelay) and the card authorizes exactly one
 *          unit. WIP + FG + cards in transit per SKU always equals N. Lowering N
 *          never destroys units: surplus cards are retired as they come back.
 *
 * Process times are deterministic (1 / capacity), plus an optional changeover
 * time when a process switches SKU. Demand per SKU arrives with gamma-distributed
 * inter-arrival times (mean from rate × mix, coefficient of variation cv).
 * Forecast per SKU is set at each planning tick from the demand rate in force at
 * that moment × (1 + bias) × (1 + noise·N(0,1)); demand events change real demand
 * immediately but reach the forecast only at the next planning tick.
 */
(function (root) {
  'use strict';

  const { mulberry32, makeSampler } =
    typeof module !== 'undefined' && module.exports ? require('../../shared/sim/random.js') : root.LSS.sim;

  const SKUS = 2;
  const HISTORY_STEP = 0.5;       // minutes between inventory samples
  const HISTORY_MINUTES = 120;
  const EVENT_MINUTES = 10;       // duration of spike / drop events

  const DEFAULTS = {
    demandRate: 1.0,       // total units/min
    cv: 0.5,               // demand inter-arrival variability
    mix: 0.6,              // share of SKU 1
    bias: 0,               // forecast bias (0.3 = +30%)
    noise: 0.1,            // forecast noise (std. dev. as a fraction)
    capA: 1.4,
    capB: 1.3,
    changeover: false,
    changeoverTime: 0.3,   // minutes, when a process switches SKU
    period: 10,            // planning period (minutes)
    safety: 3,             // push safety stock, in minutes of forecast demand
    cards: [4, 3],         // pull kanban cards per SKU
    cardDelay: 1,          // minutes for a card to travel back upstream
    initialFG: null,       // FG per SKU at t = 0 (defaults to the card counts)
    holdCost: 1,           // illustrative
    backorderCost: 5,      // illustrative
    autoRelease: true,     // false in Game mode: push releases are manual
    schedule: [],          // [{ t, type, value? }] demand events fired automatically
    seed: 20240601,
  };

  /* ---------- One production line ---------- */
  class Line {
    constructor(policy, sim) {
      this.policy = policy;
      this.sim = sim;
      const p = sim.params;
      this.qA = [];
      this.qB = [];
      this.st = [{ unit: null, end: Infinity, last: -1, start: 0 }, { unit: null, end: Infinity, last: -1, start: 0 }];
      this.fg = [[], []];
      this.backlog = [0, 0];
      this.cardsInTransit = [];          // { sku, depart, arrive } in arrival order
      this.cards = p.cards.slice();
      this.retire = [0, 0];              // cards to discard on return (card count lowered)
      this.nextId = 1;
      const init = p.initialFG || p.cards;
      for (let s = 0; s < SKUS; s++) for (let k = 0; k < init[s]; k++) this.fg[s].push(this.makeUnit(s, 0, 0));

      // measurement
      this.lastT = 0;
      this.demand = [0, 0];
      this.servedNow = [0, 0];
      this.backorders = [0, 0];          // cumulative demand not served immediately
      this.invArea = [0, 0];
      this.wipArea = 0;
      this.fgArea = 0;
      this.wrongArea = 0;
      this.ltSum = 0;
      this.ltN = 0;
      this.released = [0, 0];
      this.lastRelease = null;           // { t, qty: [a, b] }
      this.served = [];                  // recent serve times (display)
      this.history = [];                 // [t, inventory]
      this.periods = [];                 // per planning period stats
      this.startPeriod(0);
    }

    makeUnit(sku, t, release) {
      return { id: this.nextId++, sku, release, fgTime: t };
    }

    wip(s) {
      let n = 0;
      for (const u of this.qA) if (u.sku === s) n++;
      for (const u of this.qB) if (u.sku === s) n++;
      for (const x of this.st) if (x.unit && x.unit.sku === s) n++;
      return n;
    }
    fgCount(s) { return this.fg[s].length; }
    inventory(s) { return this.wip(s) + this.fg[s].length; }

    /* ----- release rules ----- */
    release(s, qty, t) {
      for (let k = 0; k < qty; k++) this.qA.push(this.makeUnit(s, NaN, t));
      this.released[s] += qty;
      this.tryStart(0, t);
    }

    planningRelease(t, forecast) {
      const p = this.sim.params;
      const qty = [0, 0];
      for (let s = 0; s < SKUS; s++) {
        const need = forecast[s] * p.period + p.safety * forecast[s] - (this.fg[s].length + this.wip(s)) + this.backlog[s];
        qty[s] = Math.max(0, Math.round(need));
      }
      this.manualRelease(qty, t);
    }

    /** Release a batch sequenced by need date (the k-th unit of a SKU is needed when
     *  its current stock plus k units would run out at the forecast rate), so one SKU
     *  never waits behind the whole batch of the other. */
    manualRelease(qty, t) {
      const f = this.sim.forecast;
      const order = [];
      for (let s = 0; s < SKUS; s++) {
        const have = this.fg[s].length + this.wip(s) - this.backlog[s];
        const r = Math.max(f[s], 1e-6);
        for (let k = 0; k < qty[s]; k++) order.push([(have + k) / r, s]);
      }
      order.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (this.sim.params.changeover) {
        // With changeovers, run each SKU as one campaign, most urgent SKU first.
        const first = order.length ? order[0][1] : 0;
        order.sort((a, b) => (a[1] === first ? 0 : 1) - (b[1] === first ? 0 : 1) || a[0] - b[0]);
      }
      for (const [, s] of order) this.qA.push(this.makeUnit(s, NaN, t));
      for (let s = 0; s < SKUS; s++) this.released[s] += qty[s];
      this.tryStart(0, t);
      this.lastRelease = { t, qty: qty.slice() };
    }

    setCards(cards, t) {
      for (let s = 0; s < SKUS; s++) {
        let diff = cards[s] - this.cards[s];
        this.cards[s] = cards[s];
        if (diff > 0) {
          const cancel = Math.min(diff, this.retire[s]);
          this.retire[s] -= cancel;
          diff -= cancel;
          if (diff > 0) this.release(s, diff, t);  // new cards authorize production at once
        } else if (diff < 0) {
          let remove = -diff;
          // take free cards first: those travelling back, newest first
          for (let i = this.cardsInTransit.length - 1; i >= 0 && remove > 0; i--) {
            if (this.cardsInTransit[i].sku === s) { this.cardsInTransit.splice(i, 1); remove--; }
          }
          this.retire[s] += remove;               // the rest retire when they come back
        }
      }
    }

    /* ----- flow ----- */
    tryStart(i, t) {
      const x = this.st[i];
      const q = i === 0 ? this.qA : this.qB;
      if (x.unit || !q.length) return;
      const u = q.shift();
      const p = this.sim.params;
      const cap = i === 0 ? p.capA : p.capB;
      const setup = p.changeover && x.last >= 0 && x.last !== u.sku ? p.changeoverTime : 0;
      x.unit = u;
      x.start = t;
      x.setup = setup;
      x.end = t + setup + 1 / cap;
      x.last = u.sku;
    }

    finish(i, t) {
      const x = this.st[i];
      const u = x.unit;
      x.unit = null;
      x.end = Infinity;
      if (i === 0) {
        this.qB.push(u);
        this.tryStart(1, t);
      } else {
        u.fgTime = t;
        this.ltSum += t - u.release;
        this.ltN++;
        if (this.backlog[u.sku] > 0) {
          this.backlog[u.sku]--;              // goes straight to a waiting customer
          this.consumed(u.sku, t);
        } else {
          this.fg[u.sku].push(u);
        }
      }
      this.tryStart(i, t);
    }

    consumed(s, t) {
      if (this.policy !== 'pull') return;
      if (this.retire[s] > 0) { this.retire[s]--; return; }
      this.cardsInTransit.push({ sku: s, depart: t, arrive: t + this.sim.params.cardDelay });
    }

    demandArrives(s, t) {
      this.demand[s]++;
      this.periodDemand[s]++;
      if (this.fg[s].length) {
        this.fg[s].shift();
        this.servedNow[s]++;
        this.served.push(t);
        if (this.served.length > 20) this.served.shift();
        this.consumed(s, t);
      } else {
        this.backlog[s]++;
        this.backorders[s]++;
        this.periodBackorders++;
      }
    }

    nextEvent() {
      let t = Math.min(this.st[0].end, this.st[1].end);
      if (this.cardsInTransit.length && this.cardsInTransit[0].arrive < t) t = this.cardsInTransit[0].arrive;
      return t;
    }

    handle(t) {
      if (this.cardsInTransit.length && this.cardsInTransit[0].arrive <= t) {
        const c = this.cardsInTransit.shift();
        this.release(c.sku, 1, t);
        return;
      }
      if (this.st[0].end <= this.st[1].end) this.finish(0, t);
      else this.finish(1, t);
    }

    integrate(to) {
      const dt = to - this.lastT;
      if (dt <= 0) return;
      let wip = 0;
      let fg = 0;
      for (let s = 0; s < SKUS; s++) {
        const w = this.wip(s);
        const f = this.fg[s].length;
        this.invArea[s] += (w + f) * dt;
        wip += w;
        fg += f;
      }
      this.wipArea += wip * dt;
      this.fgArea += fg * dt;
      const wrong = (this.backlog[1] > 0 ? this.fg[0].length : 0) + (this.backlog[0] > 0 ? this.fg[1].length : 0);
      this.wrongArea += wrong * dt;
      this.periodWrongArea += wrong * dt;
      this.periodInvArea += (wip + fg) * dt;
      this.lastT = to;
    }

    /* ----- planning periods (both lines, for wrong-mix and round stats) ----- */
    startPeriod(t) {
      this.periodStart = t;
      this.periodDemand = [0, 0];
      this.periodWrongArea = 0;
      this.periodInvArea = 0;
      this.periodBackorders = 0;
      this.periodDemandTotal0 = this.demand[0] + this.demand[1];
      this.periodServed0 = this.servedNow[0] + this.servedNow[1];
    }

    closePeriod(t) {
      const span = t - this.periodStart;
      if (span <= 0) return;
      const demand = this.demand[0] + this.demand[1] - this.periodDemandTotal0;
      const served = this.servedNow[0] + this.servedNow[1] - this.periodServed0;
      this.periods.push({
        start: this.periodStart, end: t,
        avgInventory: this.periodInvArea / span,
        fillRate: demand ? served / demand : NaN,
        backorders: this.periodBackorders,
        wrongMix: this.periodWrongArea / span,
      });
    }

    sample(t) {
      this.history.push([t, this.inventory(0) + this.inventory(1)]);
      const cut = t - HISTORY_MINUTES;
      while (this.history.length && this.history[0][0] < cut) this.history.shift();
    }

    metrics(t) {
      const p = this.sim.params;
      const demand = this.demand[0] + this.demand[1];
      const served = this.servedNow[0] + this.servedNow[1];
      const bo = this.backorders[0] + this.backorders[1];
      const avgInv = t > 0 ? (this.invArea[0] + this.invArea[1]) / t : NaN;
      return {
        fillRate: demand ? served / demand : NaN,
        demand,
        backordersNow: this.backlog[0] + this.backlog[1],
        backordersTotal: bo,
        avgInventory: avgInv,
        avgInventorySku: [0, 1].map((s) => (t > 0 ? this.invArea[s] / t : NaN)),
        avgWip: t > 0 ? this.wipArea / t : NaN,
        avgFG: t > 0 ? this.fgArea / t : NaN,
        inventoryNow: this.inventory(0) + this.inventory(1),
        leadTime: this.ltN ? this.ltSum / this.ltN : NaN,
        wrongMix: t > 0 ? this.wrongArea / t : NaN,
        // Illustrative cost index per 10 simulated minutes
        cost: t > 0 ? p.holdCost * avgInv + p.backorderCost * (bo / t) * 10 : NaN,
      };
    }
  }

  /* ---------- Simulation: shared demand, two lines ---------- */
  class PushPullSim {
    constructor(params = {}) {
      this.params = Object.assign({}, DEFAULTS, params);
      this.params.cards = (params.cards || DEFAULTS.cards).slice();
      const seed = this.params.seed >>> 0;
      // Independent streams so demand and forecast never depend on line behaviour.
      this.demandSample = [makeSampler(mulberry32(seed ^ 0x9E3779B9)), makeSampler(mulberry32(seed ^ 0x85EBCA6B))];
      this.forecastSample = makeSampler(mulberry32(seed ^ 0xC2B2AE35));
      this.t = 0;
      this.rateFactor = 1;
      this.eventEnd = Infinity;
      this.mixNow = this.params.mix;
      this.events = [];                  // { t, type } for chart markers
      this.demandLog = [];               // [t, sku] (for tests)
      this.keepDemandLog = Boolean(params.keepDemandLog);
      this.lines = { push: new Line('push', this), pull: new Line('pull', this) };
      this.nextDemand = [this.drawInterarrival(0), this.drawInterarrival(1)];
      this.nextPlan = 0;
      this.nextSample = 0;
      this.forecast = [0, 0];
      this.schedule = (this.params.schedule || []).slice().sort((a, b) => a.t - b.t);
      this.planTick();                   // t = 0: forecast (+ push release in auto mode)
    }

    rate(s) {
      const share = s === 0 ? this.mixNow : 1 - this.mixNow;
      return this.params.demandRate * this.rateFactor * share;
    }

    drawInterarrival(s) {
      const r = this.rate(s);
      return this.t + (r > 0 ? this.demandSample[s](1 / r, this.params.cv) : Infinity);
    }

    planTick() {
      const t = this.t;
      const p = this.params;
      if (t > 0) for (const l of Object.values(this.lines)) l.closePeriod(t);
      for (let s = 0; s < SKUS; s++) {
        const noise = p.noise > 0 ? 1 + p.noise * this.forecastSample.normal() : 1;
        this.forecast[s] = Math.max(0, this.rate(s) * (1 + p.bias) * noise);
      }
      for (const l of Object.values(this.lines)) l.startPeriod(t);
      if (p.autoRelease) this.lines.push.planningRelease(t, this.forecast);
      this.nextPlan = t + p.period;
    }

    /** Demand events: 'spike' (+50% for 10 min), 'drop' (−50%), 'mix' (persistent shift), 'baseline'. */
    applyEvent(type, value) {
      const t = this.t;
      if (type === 'spike' || type === 'drop') {
        this.rateFactor = type === 'spike' ? 1.5 : 0.5;
        this.eventEnd = t + EVENT_MINUTES;
      } else if (type === 'mix') {
        this.mixNow = value !== undefined ? value : this.params.mix / 2; // default: SKU 1 share halves (60/40 → 30/70)
      } else if (type === 'baseline') {
        this.rateFactor = 1;
        this.eventEnd = Infinity;
        this.mixNow = this.params.mix;
      }
      this.events.push({ t, type });
      this.redrawDemand();
    }

    redrawDemand() {
      this.nextDemand = [this.drawInterarrival(0), this.drawInterarrival(1)];
    }

    /** Add a demand event to fire at time t (Game mode hidden events). */
    scheduleEvent(ev) {
      this.schedule.push(ev);
      this.schedule.sort((a, b) => a.t - b.t);
    }

    /** Live parameter change (Explore). Metrics keep accumulating since the last reset. */
    setParams(partial) {
      Object.assign(this.params, partial);
      if (partial.cards) {
        this.params.cards = partial.cards.slice();
        this.lines.pull.setCards(this.params.cards, this.t);
      }
      if ('mix' in partial) this.mixNow = partial.mix;
      if ('demandRate' in partial || 'cv' in partial || 'mix' in partial) this.redrawDemand();
    }

    advance(dt) {
      const target = this.t + dt;
      const lines = [this.lines.push, this.lines.pull];
      for (;;) {
        // earliest event across demand, planning, event end and both lines
        const sched = this.schedule.length ? this.schedule[0].t : Infinity;
        let next = Math.min(this.nextDemand[0], this.nextDemand[1], this.nextPlan, this.eventEnd, sched);
        let lineNext = [lines[0].nextEvent(), lines[1].nextEvent()];
        next = Math.min(next, lineNext[0], lineNext[1]);
        if (next > target) break;
        while (this.nextSample <= next) {
          for (const l of lines) { l.integrate(this.nextSample); l.sample(this.nextSample); }
          this.nextSample += HISTORY_STEP;
        }
        for (const l of lines) l.integrate(next);
        this.t = next;
        // Line events first at equal times, then demand, then planning.
        if (lineNext[0] <= next) { lines[0].handle(next); continue; }
        if (lineNext[1] <= next) { lines[1].handle(next); continue; }
        if (sched <= next) {
          const ev = this.schedule.shift();
          this.applyEvent(ev.type, ev.value);
          continue;
        }
        if (this.eventEnd <= next) {
          this.rateFactor = 1;
          this.eventEnd = Infinity;
          this.redrawDemand();
          continue;
        }
        const s = this.nextDemand[0] <= this.nextDemand[1] ? 0 : 1;
        if (this.nextDemand[s] <= next) {
          for (const l of lines) l.demandArrives(s, next);
          if (this.keepDemandLog) this.demandLog.push([next, s]);
          this.nextDemand[s] = this.drawInterarrival(s);
          continue;
        }
        this.planTick();
      }
      while (this.nextSample <= target) {
        for (const l of lines) { l.integrate(this.nextSample); l.sample(this.nextSample); }
        this.nextSample += HISTORY_STEP;
      }
      for (const l of lines) l.integrate(target);
      this.t = target;
    }

    metrics() {
      return { t: this.t, push: this.lines.push.metrics(this.t), pull: this.lines.pull.metrics(this.t), forecast: this.forecast.slice() };
    }
  }

  const api = { PushPullSim, Line, DEFAULTS, SKUS, EVENT_MINUTES, HISTORY_MINUTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.LSS) root.LSS.PushPull = api;
})(typeof window !== 'undefined' ? window : globalThis);
