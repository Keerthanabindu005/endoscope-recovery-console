/*
 * core.js — simulation core shared by the browser console and the evaluation script.
 *
 * Contents
 *   1. Parameters      thresholds and timings of the recovery policy
 *   2. Scenarios       scripted instrument paths and occlusions (SIMULATED)
 *   3. Tracker         turns what the camera can see into a confidence score (SIMULATED)
 *   4. Policies        confidence-aware recovery (ours) + two baselines (IMPLEMENTED)
 *   5. Simulation      ties scenario, camera, tracker and policy together
 *
 * World coordinates: x in [0, 1], y in [0, 0.75] (4:3 field).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. Parameters
  // ---------------------------------------------------------------------------
  const PARAMS = {
    dt: 1 / 30,               // simulation step (s), roughly one video frame
    high: 0.6,                // confidence at or above this = tracking
    low: 0.3,                 // confidence below this = lost
    emaAlpha: 0.25,           // smoothing of the raw detection score
    reacquireHold: 0.3,       // s above `high` before tracking resumes (hysteresis)
    retreatAfter: 1.0,        // s lost before retreating to the overview (cf. 1 s bridging in [4])
    overviewWait: 3.0,        // s searching in the overview before proposing handover
    countdown: 3.0,           // s handover countdown during which the surgeon can veto
    timeoutBaseline: 10.0,    // s lost before the fixed-timeout baseline hands over [4]
    narrowWidth: 0.35,        // camera field of view (world units) when following the tool
    overviewWidth: 0.9,       // camera field of view in the safe overview
    overviewCentre: { x: 0.5, y: 0.375 },
    edgeMargin: 0.15          // fraction of view near the edge counted as "near edge"
  };

  // Handover style presets (L04: cautious, balanced or eager, trading misses against false alarms)
  const PRESETS = {
    cautious: { label: 'Cautious', retreatAfter: 1.5, overviewWait: 5.0, countdown: 4.0 },
    balanced: { label: 'Balanced', retreatAfter: 1.0, overviewWait: 3.0, countdown: 3.0 },
    eager:    { label: 'Eager',    retreatAfter: 0.7, overviewWait: 1.5, countdown: 2.0 }
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
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
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ---------------------------------------------------------------------------
  // 2. Scenarios (SIMULATED)
  //    keys: keyframes {t, x, y, inBody}; position is interpolated between them.
  //    occlusions: {t0, t1, kind}  kind = 'flap' (local, full) | 'partial' | 'smoke' (whole view)
  //    shouldHandover: the "right answer" used by the evaluation.
  // ---------------------------------------------------------------------------
  const C = { x: 0.5, y: 0.38 };
  // Free play: the person drags the instrument and causes problems themselves.
  // Not used by the evaluation (not repeatable).
  const FREE_PLAY = {
    id: 'FREE', name: 'Free play (you move the instrument)', type: 'free play', free: true,
    duration: Infinity, shouldHandover: null,
    desc: 'Drag the instrument with the mouse. Flick it out of view, hide it, withdraw it or add smoke, and see how the robot responds.',
    keys: [{ t: 0, x: 0.5, y: 0.38, inBody: true }], occlusions: []
  };

  const SCENARIOS = [
    {
      id: 'S1', name: 'Brief occlusion (0.5 s)', type: 'brief occlusion', duration: 12, shouldHandover: false,
      desc: 'A tissue fold covers the tool tip for half a second.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 4, t1: 4.5, kind: 'flap' }]
    },
    {
      id: 'S2', name: 'Occlusion (1.5 s)', type: 'brief occlusion', duration: 12, shouldHandover: false,
      desc: 'The tool tip is hidden behind tissue for 1.5 seconds.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 4, t1: 5.5, kind: 'flap' }]
    },
    {
      id: 'S3', name: 'Partial occlusion flicker', type: 'brief occlusion', duration: 14, shouldHandover: false,
      desc: 'The tip is partly covered for 5 s, so detection flickers.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 3, t1: 8, kind: 'partial' }]
    },
    {
      id: 'S4', name: 'Tool leaves view (6 s)', type: 'out of view', duration: 16, shouldHandover: false,
      desc: 'The tool moves quickly to the upper left, stays 6 s, then returns.',
      keys: [
        { t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: true },
        { t: 3.15, x: 0.12, y: 0.15, inBody: true }, { t: 9.4, x: 0.12, y: 0.15, inBody: true },
        { t: 10.4, ...C, inBody: true }
      ], occlusions: []
    },
    {
      id: 'S5', name: 'Tool leaves view (4 s, right)', type: 'out of view', duration: 14, shouldHandover: false,
      desc: 'The tool moves to the lower right, stays 4 s, then returns.',
      keys: [
        { t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: true },
        { t: 3.15, x: 0.86, y: 0.62, inBody: true }, { t: 7.3, x: 0.86, y: 0.62, inBody: true },
        { t: 8.3, ...C, inBody: true }
      ], occlusions: []
    },
    {
      id: 'S6', name: 'Instrument exchange (2.5 s)', type: 'out of view', duration: 12, shouldHandover: false,
      desc: 'The tool is withdrawn and a new one inserted 2.5 s later.',
      keys: [
        { t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: false },
        { t: 5.5, x: 0.6, y: 0.45, inBody: true }, { t: 6.5, ...C, inBody: true }
      ], occlusions: []
    },
    {
      id: 'S7', name: 'Tool withdrawn', type: 'sustained loss', duration: 20, shouldHandover: true,
      desc: 'The tool is withdrawn and does not come back.',
      keys: [{ t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: false }], occlusions: []
    },
    {
      id: 'S8', name: 'Withdrawn for 12 s', type: 'sustained loss', duration: 20, shouldHandover: true,
      desc: 'The tool is out for 12 s before a new one is inserted.',
      keys: [
        { t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: false },
        { t: 15, x: 0.6, y: 0.45, inBody: true }, { t: 16, ...C, inBody: true }
      ], occlusions: []
    },
    {
      id: 'S9', name: 'Smoke obscures view', type: 'sustained loss', duration: 20, shouldHandover: true,
      desc: 'Surgical smoke fills the view for 15 s.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 3, t1: 18, kind: 'smoke' }]
    },
    {
      id: 'S10', name: 'Leaves view, then withdrawn', type: 'sustained loss', duration: 20, shouldHandover: true,
      desc: 'The tool moves out of view to the far edge and is then withdrawn.',
      keys: [
        { t: 0, ...C, inBody: true }, { t: 3, ...C, inBody: true },
        { t: 3.15, x: 0.15, y: 0.6, inBody: true }, { t: 4.5, x: 0.15, y: 0.6, inBody: false }
      ], occlusions: []
    },
    {
      id: 'S11', name: 'Occlusion (6 s)', type: 'long occlusion', duration: 16, shouldHandover: false,
      desc: 'Tissue covers the tip for 6 s; it clears while the handover countdown is running.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 4, t1: 10, kind: 'flap' }]
    },
    {
      id: 'S12', name: 'Occlusion (8 s)', type: 'long occlusion', duration: 18, shouldHandover: false,
      desc: 'Tissue covers the tip for 8 s, longer than the policy waits.',
      keys: [{ t: 0, ...C, inBody: true }], occlusions: [{ t0: 4, t1: 12, kind: 'flap' }]
    }
  ];

  function toolAt(scn, t) {
    const k = scn.keys;
    let p;
    if (t <= k[0].t) p = k[0];
    else if (t >= k[k.length - 1].t) p = k[k.length - 1];
    else {
      for (let i = 0; i < k.length - 1; i++) {
        if (t >= k[i].t && t <= k[i + 1].t) {
          const u = (t - k[i].t) / (k[i + 1].t - k[i].t || 1);
          p = { x: lerp(k[i].x, k[i + 1].x, u), y: lerp(k[i].y, k[i + 1].y, u), inBody: k[i].inBody };
          break;
        }
      }
    }
    // small natural hand movement so tracking looks alive
    return {
      x: p.x + 0.012 * Math.sin(t * 1.7),
      y: p.y + 0.010 * Math.sin(t * 2.3 + 1),
      inBody: p.inBody
    };
  }

  function occlusionAt(scn, t) {
    for (const o of scn.occlusions) if (t >= o.t0 && t < o.t1) return o.kind;
    return null;
  }

  // ---------------------------------------------------------------------------
  // 3. Tracker (SIMULATED)
  //    Stands in for a real instrument detector. The score depends on whether the
  //    tip is inside the current camera view and whether it is covered, so the
  //    robot's own camera moves change what it can sense.
  // ---------------------------------------------------------------------------
  function viewRect(cam) {
    const w = cam.width, h = cam.width * 0.75;
    return { x0: cam.x - w / 2, y0: cam.y - h / 2, x1: cam.x + w / 2, y1: cam.y + h / 2, w, h };
  }

  function trackerStep(tool, occ, cam, rng) {
    // always draw three random numbers per step so runs repeat exactly
    const n1 = rng() - 0.5, n2 = rng() - 0.5, n3 = rng() - 0.5;
    const r = viewRect(cam);
    const inView = tool.inBody && tool.x > r.x0 && tool.x < r.x1 && tool.y > r.y0 && tool.y < r.y1;
    let raw;
    if (!inView) raw = 0.02 + 0.04 * (n1 + 0.5);
    else if (occ === 'flap' || occ === 'smoke') raw = 0.1 + 0.1 * n1;
    else if (occ === 'partial') raw = 0.45 + 0.7 * n1;          // flickers across both thresholds
    else raw = 0.86 + 0.16 * n1;
    raw = clamp(raw, 0, 1);
    const detection = raw >= PARAMS.low && inView
      ? { x: tool.x + 0.004 * n2, y: tool.y + 0.004 * n3 }
      : null;
    return { raw, detection, inView };
  }

  // ---------------------------------------------------------------------------
  // 4. Policies (IMPLEMENTED)
  //    Each policy receives {conf, detection, nearEdge} plus surgeon input and
  //    returns its state and a camera target. States:
  //      TRACKING, SEARCHING, RETREATING, HANDOVER_PENDING, SURGEON
  // ---------------------------------------------------------------------------
  function makeConfidencePolicy(P) {
    const s = { state: 'TRACKING', lostFor: 0, goodFor: 0, overviewFor: 0, countdownLeft: 0 };
    return {
      name: 'Confidence-aware recovery', id: 'ours', s,
      forceTrack(emit, msg) { const prev = s.state; s.state = 'TRACKING'; s.lostFor = 0; s.goodFor = 0; s.countdownLeft = 0; emit(prev, 'TRACKING', msg, 'P'); },
      step(obs, input, dt, emit) {
        const good = obs.conf >= P.high, lost = obs.conf < P.low;
        s.goodFor = good ? s.goodFor + dt : 0;
        s.lostFor = lost ? s.lostFor + dt : 0;

        if (input === 'takeover' && s.state !== 'SURGEON') { go('SURGEON', 'Surgeon took control', 'P'); return; }
        if (s.state === 'SURGEON') {
          if (input === 'giveback') go('SEARCHING', 'Surgeon gave control back to the robot', 'P');
          return;
        }
        if (input === 'lastview' && (s.state === 'RETREATING' || s.state === 'HANDOVER_PENDING')) {
          go('SEARCHING', 'Surgeon asked for the last good view', 'P'); s.lostFor = 0; return;
        }

        switch (s.state) {
          case 'TRACKING':
            if (!good) go('SEARCHING', obs.nearEdge ? 'Confidence dropping: tool near edge of view' : 'Confidence dropping: tool may be hidden', 'S');
            break;
          case 'SEARCHING':
            if (s.goodFor >= P.reacquireHold) go('TRACKING', 'Tool reacquired', 'S');
            else if (s.lostFor >= P.retreatAfter) { go('RETREATING', 'Widening view to search', 'S'); s.overviewFor = 0; }
            break;
          case 'RETREATING':
            s.overviewFor += dt;
            if (s.goodFor >= P.reacquireHold) go('TRACKING', 'Tool found in wide view', 'S');
            else if (!lost) s.overviewFor = Math.max(0, s.overviewFor - 2 * dt);   // partial evidence: keep searching longer
            else if (s.overviewFor >= P.overviewWait) { go('HANDOVER_PENDING', 'Tool not found: proposing handover', 'S'); s.countdownLeft = P.countdown; }
            break;
          case 'HANDOVER_PENDING':
            s.countdownLeft -= dt;
            if (s.goodFor >= P.reacquireHold) go('TRACKING', 'Tool found: handover cancelled', 'S');
            else if (input === 'veto') { go('RETREATING', 'Surgeon vetoed handover: keep searching', 'P'); s.overviewFor = 0; }
            else if (s.countdownLeft <= 0) go('SURGEON', 'Control handed to surgeon', 'S');
            break;
        }
        function go(next, msg, actor) { const prev = s.state; s.state = next; emit(prev, next, msg, actor); }
      },
      cameraMode() {
        if (s.state === 'RETREATING' || s.state === 'HANDOVER_PENDING') return 'overview';
        if (s.state === 'TRACKING') return 'follow';
        return 'hold';
      }
    };
  }

  function makeTimeoutPolicy(P) {
    const s = { state: 'TRACKING', lostFor: 0, goodFor: 0, countdownLeft: 0 };
    return {
      name: 'Fixed 10 s timeout (baseline)', id: 'timeout', s,
      forceTrack(emit, msg) { const prev = s.state; s.state = 'TRACKING'; s.lostFor = 0; s.goodFor = 0; s.countdownLeft = 0; emit(prev, 'TRACKING', msg, 'P'); },
      step(obs, input, dt, emit) {
        const good = obs.conf >= P.high, lost = obs.conf < P.low;
        s.goodFor = good ? s.goodFor + dt : 0;
        s.lostFor = lost ? s.lostFor + dt : 0;
        if (input === 'takeover' && s.state !== 'SURGEON') { go('SURGEON', 'Surgeon took control', 'P'); return; }
        if (s.state === 'SURGEON') { if (input === 'giveback') go('SEARCHING', 'Surgeon gave control back to the robot', 'P'); return; }
        if (s.state === 'TRACKING' && !good) go('SEARCHING', 'Tracking lost: holding position', 'S');
        else if (s.state === 'SEARCHING') {
          if (s.goodFor >= P.reacquireHold) go('TRACKING', 'Tool reacquired', 'S');
          else if (s.lostFor >= P.timeoutBaseline) go('SURGEON', 'Timeout: control handed to surgeon', 'S');
        }
        function go(next, msg, actor) { const prev = s.state; s.state = next; emit(prev, next, msg, actor); }
      },
      cameraMode() { return s.state === 'TRACKING' ? 'follow' : 'hold'; }
    };
  }

  function makeNoRecoveryPolicy(P) {
    const s = { state: 'TRACKING', goodFor: 0, countdownLeft: 0 };
    return {
      name: 'No recovery (baseline)', id: 'none', s,
      forceTrack(emit, msg) { const prev = s.state; s.state = 'TRACKING'; s.lostFor = 0; s.goodFor = 0; s.countdownLeft = 0; emit(prev, 'TRACKING', msg, 'P'); },
      step(obs, input, dt, emit) {
        const good = obs.conf >= P.high;
        s.goodFor = good ? s.goodFor + dt : 0;
        if (input === 'takeover' && s.state !== 'SURGEON') { go('SURGEON', 'Surgeon took control', 'P'); return; }
        if (s.state === 'SURGEON') { if (input === 'giveback') go('SEARCHING', 'Surgeon gave control back to the robot', 'P'); return; }
        if (s.state === 'TRACKING' && !good) go('SEARCHING', 'Tracking lost: holding position', 'S');
        else if (s.state === 'SEARCHING' && s.goodFor >= P.reacquireHold) go('TRACKING', 'Tool reacquired', 'S');
        function go(next, msg, actor) { const prev = s.state; s.state = next; emit(prev, next, msg, actor); }
      },
      cameraMode() { return s.state === 'TRACKING' ? 'follow' : 'hold'; }
    };
  }

  const POLICIES = { ours: makeConfidencePolicy, timeout: makeTimeoutPolicy, none: makeNoRecoveryPolicy };

  // ---------------------------------------------------------------------------
  // 5. Simulation
  // ---------------------------------------------------------------------------
  class Simulation {
    constructor(scenario, policyId, params) {
      this.P = Object.assign({}, PARAMS, params || {});
      this.scn = scenario;
      this.policy = POLICIES[policyId](this.P);
      this.seed = scenario.free ? 999 : 1000 + SCENARIOS.indexOf(scenario);
      // free play: the instrument is moved by the person
      this.freeTool = { x: C.x, y: C.y, inBody: true };
      this.freeOcc = { hidden: false, smoke: false };
      this.assistPoint = null;
      this.rng = mulberry32(this.seed);
      this.t = 0;
      this.cam = { x: C.x, y: C.y, width: this.P.narrowWidth };
      this.camTarget = { x: C.x, y: C.y, width: this.P.narrowWidth };
      this.conf = 0.9;
      this.lastSeen = { x: C.x, y: C.y };
      this.goodView = { x: C.x, y: C.y };
      this.log = [];
      this.pendingInput = null;
      this.done = false;
    }

    input(kind) { this.pendingInput = kind; }   // 'veto' | 'takeover' | 'giveback' | 'lastview'

    // Surgeon points at where they see the tool (world coordinates).
    assist(x, y) { this.assistPoint = { x, y }; }

    // Free play: move the instrument by a world-space delta.
    moveTool(dx, dy) {
      if (!this.freeTool.inBody) return;
      this.freeTool.x = clamp(this.freeTool.x + dx, 0.03, 0.97);
      this.freeTool.y = clamp(this.freeTool.y + dy, 0.03, 0.72);
    }
    toggleWithdraw() {
      this.freeTool.inBody = !this.freeTool.inBody;
      if (this.freeTool.inBody) { this.freeTool.x = 0.62; this.freeTool.y = 0.46; }   // re-inserted near the port
    }

    nudgeCamera(dx, dy, dz) {   // manual camera control, only while the surgeon has control
      if (this.policy.s.state !== 'SURGEON') return;
      this.camTarget.x = clamp(this.camTarget.x + dx, 0.1, 0.9);
      this.camTarget.y = clamp(this.camTarget.y + dy, 0.08, 0.67);
      this.camTarget.width = clamp(this.camTarget.width + dz, 0.25, this.P.overviewWidth);
    }

    step() {
      if (this.done) return;
      const P = this.P, dt = P.dt;
      const tool = this.scn.free ? Object.assign({}, this.freeTool) : toolAt(this.scn, this.t);
      const occ = this.scn.free
        ? (this.freeOcc.smoke ? 'smoke' : this.freeOcc.hidden ? 'flap' : null)
        : occlusionAt(this.scn, this.t);
      const tr = trackerStep(tool, occ, this.cam, this.rng);
      this.conf = this.conf + P.emaAlpha * (tr.raw - this.conf);
      if (tr.detection) {
        // how fast the tool was moving when last seen: a fast tool that vanishes probably left the view
        const v = Math.hypot(tr.detection.x - this.lastSeen.x, tr.detection.y - this.lastSeen.y) / dt;
        this.seenSpeed = 0.7 * (this.seenSpeed || 0) + 0.3 * v;
        this.lastSeen = tr.detection;
      }

      const r = viewRect(this.cam);
      const mx = r.w * P.edgeMargin, my = r.h * P.edgeMargin;
      const nearEdge = this.lastSeen.x < r.x0 + mx || this.lastSeen.x > r.x1 - mx ||
                       this.lastSeen.y < r.y0 + my || this.lastSeen.y > r.y1 - my ||
                       (this.seenSpeed || 0) > 0.4;

      const input = this.pendingInput; this.pendingInput = null;
      const prevState = this.policy.s.state;
      const emit = (from, to, msg, actor) => this.log.push({
        t: +this.t.toFixed(2), from, to, msg, actor, conf: +this.conf.toFixed(2)
      });

      // "Help me find it": the surgeon points at the tool and tracking restarts there
      if (this.assistPoint) {
        const a = this.assistPoint; this.assistPoint = null;
        const visible = tr.inView && occ !== 'flap' && occ !== 'smoke';
        const near = Math.hypot(a.x - tool.x, a.y - tool.y) < 0.07;
        if (visible && near) {
          this.conf = Math.max(this.conf, 0.85);
          this.lastSeen = { x: tool.x, y: tool.y };
          this.policy.forceTrack(emit, 'Surgeon pointed to the tool: tracking restarted');
        } else {
          const st = this.policy.s.state;
          emit(st, st, visible ? 'No tool where you pointed: try again' : 'Tool not visible there yet', 'P');
        }
      }
      this.policy.step({ conf: this.conf, detection: tr.detection, nearEdge }, input, dt, emit);
      if (input === 'lastview' && this.policy.s.state === 'SEARCHING') {
        this.camTarget = { x: this.goodView.x, y: this.goodView.y, width: P.narrowWidth };
      }
      if (prevState === 'TRACKING' && this.policy.s.state !== 'TRACKING') {
        this.goodView = { x: this.cam.x, y: this.cam.y };
      }

      // camera targets by mode (the robot holder is SIMULATED as a smooth crop/zoom)
      const mode = this.policy.s.state === 'SURGEON' ? 'manual' : this.policy.cameraMode();
      if (mode === 'follow') this.camTarget = { x: this.lastSeen.x, y: this.lastSeen.y, width: P.narrowWidth };
      else if (mode === 'overview') this.camTarget = { x: P.overviewCentre.x, y: P.overviewCentre.y, width: P.overviewWidth };
      // 'hold' and 'manual' keep the current target; never aim the camera outside the scene
      const hw = this.camTarget.width / 2, hh = this.camTarget.width * 0.375;
      this.camTarget.x = clamp(this.camTarget.x, hw, 1 - hw);
      this.camTarget.y = clamp(this.camTarget.y, hh, 0.75 - hh);
      const kc = 1 - Math.exp(-dt / 0.5), kz = 1 - Math.exp(-dt / 0.5);
      this.cam.x += (this.camTarget.x - this.cam.x) * kc;
      this.cam.y += (this.camTarget.y - this.cam.y) * kc;
      this.cam.width += (this.camTarget.width - this.cam.width) * kz;

      this.lastFrame = { tool, occ, raw: tr.raw, inView: tr.inView, nearEdge };
      this.t += dt;
      if (this.t >= this.scn.duration) this.done = true;
    }

    // Metrics for the evaluation. Loss onset = first time confidence falls below `low`.
    // Run the whole scenario headless. `surgeon` (optional) is called every step
    // and may return an input, so the evaluation can simulate a surgeon.
    static run(scenario, policyId, params, surgeon) {
      const sim = new Simulation(scenario, policyId, params);
      const trace = [];
      while (!sim.done) {
        if (surgeon) { const inp = surgeon(sim); if (inp) sim.input(inp); }
        sim.step();
        trace.push({ t: sim.t, conf: sim.conf, state: sim.policy.s.state });
      }
      return { sim, trace, metrics: Simulation.metrics(sim, trace) };
    }

    static metrics(sim, trace) {
      const P = sim.P;
      const onsetIdx = trace.findIndex(f => f.conf < P.low);
      const res = { scenario: sim.scn.id, policy: sim.policy.id, shouldHandover: sim.scn.shouldHandover };
      const handover = sim.log.find(e => e.to === 'SURGEON' && e.from !== 'SURGEON');
      res.handedOver = !!handover;
      res.handoverAt = handover ? handover.t : null;
      res.falseHandover = res.handedOver && !sim.scn.shouldHandover;
      res.missedHandover = !res.handedOver && sim.scn.shouldHandover;
      res.retreats = sim.log.filter(e => e.to === 'RETREATING' && e.from !== 'HANDOVER_PENDING').length;
      res.vetoes = sim.log.filter(e => /vetoed/.test(e.msg)).length;
      if (onsetIdx < 0) { res.onset = null; res.recoveryTime = 0; res.timeToTracking = null; res.timeToHandover = null; return res; }
      const onset = trace[onsetIdx].t;
      // recovered = tracking the tool again, or the surgeon has control
      // tracking only counts once it has held for 1 s (brief flickers are not a recovery)
      const hold = Math.round(1.0 / P.dt);
      let rec = null;
      for (let i = onsetIdx; i < trace.length && !rec; i++) {
        const f = trace[i];
        if (f.state === 'SURGEON') rec = f;
        else if (f.state === 'TRACKING') {
          const win = trace.slice(i, i + hold);
          if (win.length === hold && win.every(g => g.state === 'TRACKING')) rec = f;
        }
      }
      // The two ways a loss can end, kept separate (recoveryTime above counts either one):
      //   timeToTracking = tracked again for at least 1 s; timeToHandover = the surgeon has control.
      let trk = null;
      for (let i = onsetIdx; i < trace.length && !trk; i++) {
        if (trace[i].state !== 'TRACKING') continue;
        const win = trace.slice(i, i + hold);
        if (win.length === hold && win.every(g => g.state === 'TRACKING')) trk = trace[i];
      }
      res.timeToTracking = trk ? +(trk.t - onset).toFixed(2) : null;
      res.timeToHandover = handover ? +(handover.t - onset).toFixed(2) : null;
      res.onset = +onset.toFixed(2);
      res.recovered = !!rec;
      res.recoveryTime = rec ? +(rec.t - onset).toFixed(2) : +(sim.scn.duration - onset).toFixed(2);
      return res;
    }
  }

  const API = { PARAMS, PRESETS, SCENARIOS, FREE_PLAY, POLICIES, Simulation, toolAt, occlusionAt, viewRect, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.EndoCore = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
