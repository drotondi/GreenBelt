/**
 * Little's Law — discrete-event simulation of a 3-process serial line.
 * Pure logic: no DOM access. Runs in the browser (LSS.LittleEngine) and in node
 * (module.exports) so it can be unit-tested without dependencies.
 *
 *   Arrivals → [backlog] → Q1 → P1 → Q2 → P2 → Q3 → P3 → Done
 *
 * Time unit: simulated minutes. Rates: units per minute.
 * Inter-arrival and process times are gamma-distributed with the given mean and
 * coefficient of variation (CV = 0 → deterministic, CV = 1 → exponential).
 *
 * Release policy:
 *   push — units enter the line as they arrive.
 *   pull — CONWIP: a unit enters only while line WIP < wipCap; others wait in an
 *          external backlog that is NOT counted as line WIP.
 *
 * Measurement: every average (WIP, throughput, lead time, utilization, queues) is
 * measured, never formula-derived, over the window [measureStart + warmup, now].
 * setParams() keeps the units in the line but restarts that window. Lead time only
 * counts units that entered the line after the window opened, so units carried over
 * from a previous regime (e.g. a queue left by an overload) never inflate it; they
 * still count in WIP and throughput while they drain, which the verification chip
 * reports as "converging" until the line settles.
 */
(function (root) {
  'use strict';

  const STATIONS = 3;
  const HISTORY_MINUTES = 200;
  const HISTORY_STEP = 0.25;    // minutes between WIP samples
  const ROLLING_WINDOW = 30;    // minutes for rolling throughput
  const RECENT_DONE = 24;       // completed units kept for display

  /* ---------- Random numbers ---------- */
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
    return function sample(mean, cv) {
      if (!(cv > 0)) return mean;
      const k = 1 / (cv * cv);
      return (gamma(k) * mean) / k;
    };
  }

  /* ---------- Engine ---------- */
  const DEFAULTS = {
    lambda: 1.5,
    mu: [2, 2, 2],
    cv: 0.2,
    policy: 'push',
    wipCap: 10,
    warmup: 20,
    seed: 20240601,
  };

  function percentile(values, q) {
    if (!values.length) return NaN;
    const s = values.slice().sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
    return s[i];
  }

  class LittleEngine {
    constructor(params = {}) {
      this.params = Object.assign({}, DEFAULTS, params);
      this.params.mu = (params.mu || DEFAULTS.mu).slice();
      this.rng = mulberry32(this.params.seed);
      this.sample = makeSampler(this.rng);

      this.t = 0;
      this.nextId = 1;
      this.queues = [[], [], []];
      this.stations = [];
      for (let i = 0; i < STATIONS; i++) this.stations.push({ unit: null, start: 0, end: Infinity });
      this.backlog = [];
      this.wip = 0;
      this.recent = [];           // last completed units (for display)
      this.completedTotal = 0;
      this.exitTimes = [];        // for rolling throughput
      this.history = { wip: [], lt: [] };
      this.nextSample = 0;

      this.nextArrival = 0;       // first unit arrives at t = 0
      this.resetMeasurement();
    }

    /** Restart the measurement window at the current time (warm-up starts again). */
    resetMeasurement() {
      this.measureStart = this.t;
      this.warmupEnd = this.t + this.params.warmup;
      this.lastT = this.t;
      this.wipArea = 0;
      this.backlogArea = 0;
      this.busyArea = [0, 0, 0];
      this.queueArea = [0, 0, 0];
      this.busySince = [0, 0, 0];  // since measureStart (bottleneck detection during warm-up)
      this.leadTimes = [];
      this.completedInWindow = 0;
    }

    /** Change parameters mid-run: units stay in the line, measurement restarts. */
    setParams(partial) {
      const prevPolicy = this.params.policy;
      Object.assign(this.params, partial);
      if (partial.mu) this.params.mu = partial.mu.slice();
      if (partial.lambda !== undefined) {
        // Re-draw the pending arrival with the new rate so the change applies immediately.
        this.nextArrival = this.t + this.sample(1 / this.params.lambda, this.params.cv);
      }
      if (prevPolicy === 'pull' && this.params.policy === 'push') {
        while (this.backlog.length) this.enter(this.backlog.shift());
      }
      this.releaseFromBacklog();
      this.resetMeasurement();
    }

    get stable() {
      if (this.params.policy === 'pull') return true; // closed loop: line WIP is bounded by the cap
      return this.params.lambda < Math.min(...this.params.mu);
    }

    /* ----- event handling ----- */
    enter(unit) {
      unit.enter = this.t;
      this.wip++;
      this.queues[0].push(unit);
      this.tryStart(0);
    }

    releaseFromBacklog() {
      if (this.params.policy !== 'pull') return;
      while (this.backlog.length && this.wip < this.params.wipCap) this.enter(this.backlog.shift());
    }

    tryStart(i) {
      const s = this.stations[i];
      if (s.unit || !this.queues[i].length) return;
      s.unit = this.queues[i].shift();
      s.start = this.t;
      s.end = this.t + this.sample(1 / this.params.mu[i], this.params.cv);
    }

    arrive() {
      const unit = { id: this.nextId++, arrive: this.t, enter: NaN, exit: NaN };
      if (this.params.policy === 'pull' && this.wip >= this.params.wipCap) this.backlog.push(unit);
      else this.enter(unit);
      this.nextArrival = this.t + this.sample(1 / this.params.lambda, this.params.cv);
    }

    finish(i) {
      const s = this.stations[i];
      const unit = s.unit;
      s.unit = null;
      s.end = Infinity;
      if (i < STATIONS - 1) {
        this.queues[i + 1].push(unit);
        this.tryStart(i + 1);
      } else {
        this.complete(unit);
      }
      this.tryStart(i);
    }

    complete(unit) {
      unit.exit = this.t;
      unit.leadTime = unit.exit - unit.enter;
      this.wip--;
      this.completedTotal++;
      this.recent.push(unit);
      if (this.recent.length > RECENT_DONE) this.recent.shift();
      this.exitTimes.push(this.t);
      if (this.t >= this.warmupEnd) this.completedInWindow++;          // throughput: every exit in the window
      if (unit.enter >= this.warmupEnd) this.leadTimes.push(unit.leadTime); // lead time: current-regime units only
      this.history.lt.push([this.t, unit.leadTime]);
      this.releaseFromBacklog();
    }

    /* ----- time integration ----- */
    integrate(to) {
      const from = this.lastT;
      if (to <= from) return;
      const dt = to - from;
      for (let i = 0; i < STATIONS; i++) if (this.stations[i].unit) this.busySince[i] += dt;
      const a = Math.max(from, this.warmupEnd);
      if (to > a) {
        const w = to - a;
        this.wipArea += this.wip * w;
        this.backlogArea += this.backlog.length * w;
        for (let i = 0; i < STATIONS; i++) {
          if (this.stations[i].unit) this.busyArea[i] += w;
          this.queueArea[i] += this.queues[i].length * w;
        }
      }
      this.lastT = to;
    }

    recordHistory(to) {
      while (this.nextSample <= to) {
        this.history.wip.push([this.nextSample, this.wip]);
        this.nextSample += HISTORY_STEP;
      }
    }

    /** Advance the simulated clock by dt minutes, processing every event on the way. */
    advance(dt) {
      const target = this.t + dt;
      for (;;) {
        let next = this.nextArrival;
        let kind = -1; // -1 arrival, 0..2 station finish
        for (let i = 0; i < STATIONS; i++) {
          if (this.stations[i].end < next) {
            next = this.stations[i].end;
            kind = i;
          }
        }
        if (next > target) break;
        this.recordHistory(next);
        this.integrate(next);
        this.t = next;
        if (kind === -1) this.arrive();
        else this.finish(kind);
      }
      this.recordHistory(target);
      this.integrate(target);
      this.t = target;
      this.trim();
    }

    trim() {
      const cut = this.t - HISTORY_MINUTES;
      const h = this.history;
      let n = 0;
      while (n < h.wip.length && h.wip[n][0] < cut) n++;
      if (n) h.wip.splice(0, n);
      n = 0;
      while (n < h.lt.length && h.lt[n][0] < cut) n++;
      if (n) h.lt.splice(0, n);
      const rc = this.t - ROLLING_WINDOW;
      n = 0;
      while (n < this.exitTimes.length && this.exitTimes[n] < rc) n++;
      if (n) this.exitTimes.splice(0, n);
    }

    /* ----- metrics ----- */
    /** Measured metrics. Pass { percentiles: false } to skip the P90 sort on hot paths. */
    metrics({ percentiles = true } = {}) {
      const span = this.t - this.warmupEnd;
      const warm = span > 0;
      const n = this.completedInWindow;
      const nLT = this.leadTimes.length;
      const sumLT = this.leadTimes.reduce((a, b) => a + b, 0);
      const wipAvg = warm ? this.wipArea / span : NaN;
      const th = warm ? n / span : NaN;
      const lt = nLT ? sumLT / nLT : NaN;
      const product = th * lt;
      const sinceStart = this.t - this.measureStart;
      const rollingSpan = Math.min(ROLLING_WINDOW, this.t);

      const stations = this.stations.map((s, i) => ({
        util: warm ? this.busyArea[i] / span : NaN,
        utilSinceStart: sinceStart > 0 ? this.busySince[i] / sinceStart : NaN,
        queue: this.queues[i].length,
        avgQueue: warm ? this.queueArea[i] / span : NaN,
        busy: Boolean(s.unit),
      }));

      // Bottleneck: highest measured utilization; lowest capacity until there is data.
      let bottleneck = 0;
      const score = (i) => {
        const u = warm ? stations[i].util : stations[i].utilSinceStart;
        return Number.isFinite(u) && sinceStart > 1 ? u : 1 / this.params.mu[i];
      };
      for (let i = 1; i < STATIONS; i++) if (score(i) > score(bottleneck) + 1e-9) bottleneck = i;

      return {
        t: this.t,
        warm,
        warmupRemaining: Math.max(0, this.warmupEnd - this.t),
        stable: this.stable,
        wip: this.wip,
        backlog: this.backlog.length,
        avgBacklog: warm ? this.backlogArea / span : NaN,
        wipAvg,
        throughput: th,
        throughputRolling: rollingSpan > 0 ? this.exitTimes.length / rollingSpan : NaN,
        leadTime: lt,
        leadTimeP90: percentiles ? percentile(this.leadTimes, 0.9) : NaN,
        completedInWindow: n,
        leadTimeCount: nLT,
        completedTotal: this.completedTotal,
        littleProduct: product,
        littleDiff: wipAvg > 0 && Number.isFinite(product) ? Math.abs(wipAvg - product) / wipAvg : NaN,
        stations,
        bottleneck,
      };
    }
  }

  const api = { LittleEngine, mulberry32, makeSampler, percentile, DEFAULTS, STATIONS, HISTORY_MINUTES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.LSS) root.LSS.LittleEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
