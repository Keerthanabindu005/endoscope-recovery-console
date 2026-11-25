/*
 * app.js — the surgeon-facing console.
 * Draws the simulated endoscope view, shows what the robot is doing and why,
 * and takes surgeon input (keys, buttons, mouse, optional voice).
 */
(function () {
  'use strict';
  const { SCENARIOS, FREE_PLAY, PRESETS, Simulation, PARAMS, viewRect, mulberry32 } = window.EndoCore;
  const ALL = [FREE_PLAY].concat(SCENARIOS);

  const $ = id => document.getElementById(id);
  const view = $('view'), ctx = view.getContext('2d');
  const tl = $('timeline'), tctx = tl.getContext('2d');
  const W = view.width, H = view.height;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const STATE_COLOR = {
    TRACKING: css('--s-track'), SEARCHING: css('--s-search'), RETREATING: css('--s-wide'),
    HANDOVER_PENDING: css('--s-ask'), SURGEON: css('--s-surgeon')
  };
  const STATE_TEXT = {
    TRACKING: 'Robot following tool',
    SEARCHING: 'Robot holding view, searching',
    RETREATING: 'Robot searching in wide view',
    HANDOVER_PENDING: 'Robot asking to hand over',
    SURGEON: 'You control the camera'
  };

  // ------------------------------------------------------------------ tissue texture (world-space, drawn once)
  const TEX_W = 2000, TEX_H = 1500;
  const tex = document.createElement('canvas'); tex.width = TEX_W; tex.height = TEX_H;
  (function paintTissue() {
    const g = tex.getContext('2d'), rnd = mulberry32(7);
    const base = g.createLinearGradient(0, 0, TEX_W, TEX_H);
    base.addColorStop(0, '#7d2b26'); base.addColorStop(1, '#6a221f');
    g.fillStyle = base; g.fillRect(0, 0, TEX_W, TEX_H);
    for (let i = 0; i < 280; i++) {
      const x = rnd() * TEX_W, y = rnd() * TEX_H, r = 40 + rnd() * 220;
      const hue = rnd() * 18, light = 28 + rnd() * 22;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `hsla(${hue},55%,${light + 12}%,0.55)`);
      grad.addColorStop(1, `hsla(${hue},55%,${light}%,0)`);
      g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(110,18,28,0.55)'; g.lineCap = 'round';
    for (let i = 0; i < 45; i++) {
      g.lineWidth = 1 + rnd() * 2.5; g.beginPath();
      let x = rnd() * TEX_W, y = rnd() * TEX_H, dir = rnd() * Math.PI * 2; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        dir += (rnd() - 0.5) * 1.2;
        const cx = x + Math.cos(dir) * 90, cy = y + Math.sin(dir) * 90;
        dir += (rnd() - 0.5) * 1.2;
        x = cx + Math.cos(dir) * 90; y = cy + Math.sin(dir) * 90;
        g.quadraticCurveTo(cx, cy, x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const x = rnd() * TEX_W, y = rnd() * TEX_H;
      g.fillStyle = 'rgba(255,232,232,0.22)'; g.beginPath(); g.ellipse(x, y, 5 + rnd() * 10, 2 + rnd() * 5, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
  })();
  const toTex = v => v * TEX_W;

  // ------------------------------------------------------------------ app state
  let sim = null, running = false, started = false, acc = 0, lastTs = 0;
  let speed = 1, style = 'balanced';
  let history = [], marks = [], logCount = 0, toastTimer = 0, summaryShown = false;
  let audio = null;

  // ------------------------------------------------------------------ setup controls
  (function fillScenarios() {
    const sel = $('scenarioSel');
    const g1 = document.createElement('optgroup'); g1.label = 'Interactive';
    const o = document.createElement('option'); o.value = FREE_PLAY.id; o.textContent = FREE_PLAY.name; g1.appendChild(o);
    const g2 = document.createElement('optgroup'); g2.label = 'Test scenarios (used in the evaluation)';
    for (const s of SCENARIOS) { const op = document.createElement('option'); op.value = s.id; op.textContent = `${s.id} · ${s.name}`; g2.appendChild(op); }
    sel.append(g1, g2); sel.value = 'FREE';
  })();
  $('scenarioSel').onchange = reset;
  $('policySel').onchange = reset;
  segment('styleSeg', v => { style = v; reset(); });
  segment('speedSeg', v => { speed = +v; });
  $('restartBtn').onclick = reset;
  $('pauseBtn').onclick = togglePause;
  $('endBtn').onclick = () => { if (started) { running = false; updatePause(); showSummary(); } };
  $('startBtn').onclick = start;
  $('csvBtn').onclick = downloadCsv;
  $('sumAgain').onclick = () => { reset(); start(); };
  $('sumClose').onclick = () => $('summaryOverlay').classList.add('hidden');
  document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));
  $('btnHide').onclick = () => freeToggle('hide');
  $('btnWithdraw').onclick = () => freeToggle('withdraw');
  $('btnSmoke').onclick = () => freeToggle('smoke');

  function segment(id, onPick) {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      onPick(b.dataset.v);
    }));
  }

  function start() {
    initAudio(); started = true; running = true; summaryShown = false;
    $('startOverlay').classList.add('hidden'); $('summaryOverlay').classList.add('hidden');
    updatePause();
  }
  function togglePause() { if (!started || sim.done) return; running = !running; updatePause(); }
  function updatePause() {
    $('pauseBtn').innerHTML = (running || !started ? 'Pause' : 'Resume') + ' <kbd>P</kbd>';
    $('pauseBtn').disabled = !started; $('endBtn').disabled = !started;
  }

  function reset() {
    const scn = ALL.find(s => s.id === $('scenarioSel').value);
    const pid = $('policySel').value;
    const params = pid === 'ours' ? PRESETS[style] : {};
    sim = new Simulation(scn, pid, params);
    history = []; marks = []; acc = 0; logCount = 0; running = false; started = false; summaryShown = false;
    $('log').innerHTML = '<li class="log-empty">Decisions will appear here as the robot acts.</li>';
    $('toast').classList.remove('show');
    $('summaryOverlay').classList.add('hidden');
    $('freeTools').classList.toggle('hidden', !scn.free);
    ['btnHide', 'btnWithdraw', 'btnSmoke'].forEach(id => $(id).setAttribute('aria-pressed', 'false'));
    $('styleSeg').classList.toggle('disabled', pid !== 'ours');
    const p = PRESETS[style];
    $('styleNote').textContent = pid === 'ours'
      ? `Zoom out after ${p.retreatAfter} s · search ${p.overviewWait} s · countdown ${p.countdown} s`
      : 'Only used by the proposed policy';
    document.querySelectorAll('#steps li').forEach(li => {
      const unused = pid !== 'ours' && (li.dataset.s === 'RETREATING' || li.dataset.s === 'HANDOVER_PENDING');
      li.classList.toggle('off', unused);
    });

    // start card
    $('startType').textContent = scn.free ? 'Interactive · free play' : `Test scenario ${scn.id} · ${scn.type}`;
    $('startTitle').textContent = scn.free ? 'You are the surgeon' : scn.name;
    $('startDesc').textContent = scn.desc + ` Policy: ${sim.policy.name}.`;
    const tries = scn.free ? [
      'Drag anywhere on the view to move the instrument. The camera follows it.',
      'Flick it quickly out of view, or use Hide, Withdraw or Smoke in the panel on the right.',
      'When the robot asks to hand over, keep searching or take over.',
      'When the robot is lost, click the tool to restart tracking.'
    ] : [
      scn.shouldHandover
        ? 'Expected: the tool does not come back, so the robot should hand the camera to you.'
        : 'Expected: the tool comes back, so the robot should find it without handing over.',
      pid === 'ours'
        ? 'Try pressing Keep searching or Take over when the countdown appears.'
        : 'This baseline has no countdown, but you can still take over at any time.',
      'Switch the policy or handover style and run it again to compare.'
    ];
    $('startTry').innerHTML = tries.map(t => `<li>${t}</li>`).join('');
    $('startBtn').textContent = scn.free ? 'Start free play' : 'Start scenario';
    $('startOverlay').classList.remove('hidden');
    updatePause();
    sim.step();
    render();
  }

  // ------------------------------------------------------------------ surgeon input
  function act(kind) {
    if (!sim || !started) return;
    sim.input(kind);
    document.querySelectorAll(`.actions [data-act="${kind}"]`).forEach(b => { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 250); });
  }
  function freeToggle(what) {
    if (!sim || !sim.scn.free || !started) return;
    if (what === 'hide') sim.freeOcc.hidden = !sim.freeOcc.hidden;
    if (what === 'smoke') sim.freeOcc.smoke = !sim.freeOcc.smoke;
    if (what === 'withdraw') sim.toggleWithdraw();
    $('btnHide').setAttribute('aria-pressed', sim.freeOcc.hidden);
    $('btnSmoke').setAttribute('aria-pressed', sim.freeOcc.smoke);
    $('btnWithdraw').setAttribute('aria-pressed', !sim.freeTool.inBody);
    $('btnWithdraw').innerHTML = (sim.freeTool.inBody ? 'Withdraw' : 'Insert') + ' <kbd>W</kbd>';
  }

  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    // ignore typing in form controls, and browser shortcuts such as Ctrl and minus (browser zoom)
    if (!sim || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { if (tag === 'BUTTON') return; e.preventDefault(); act('veto'); }   // Space on a focused button presses that button
    else if (k === 't') act('takeover');
    else if (k === 'g') act('giveback');
    else if (k === 'r') act('lastview');
    else if (k === 'p') togglePause();
    else if (k === 'h') freeToggle('hide');
    else if (k === 'w') freeToggle('withdraw');
    else if (k === 's') freeToggle('smoke');
    else if (k === 'arrowleft') { e.preventDefault(); sim.nudgeCamera(-0.03, 0, 0); }
    else if (k === 'arrowright') { e.preventDefault(); sim.nudgeCamera(0.03, 0, 0); }
    else if (k === 'arrowup') { e.preventDefault(); sim.nudgeCamera(0, -0.03, 0); }
    else if (k === 'arrowdown') { e.preventDefault(); sim.nudgeCamera(0, 0.03, 0); }
    else if (k === '+' || k === '=') sim.nudgeCamera(0, 0, -0.04);
    else if (k === '-' || k === '_') sim.nudgeCamera(0, 0, 0.04);
  });

  // After a mouse click, drop focus from the button or menu so Space goes back to meaning "keep searching".
  document.addEventListener('click', e => { const b = e.target.closest('button'); if (b && e.detail > 0) b.blur(); });
  document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') e.target.blur(); });

  // Mouse: drag moves the instrument (free play); a click points at the tool when the robot is lost.
  const wrap = $('viewWrap');
  let drag = null;
  view.addEventListener('pointerdown', e => {
    if (!started) return;
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    if (sim.scn.free && drag.moved > 4) {
      const rect = view.getBoundingClientRect(), scale = 1.4 * sim.cam.width / rect.width;   // a little gain so a quick flick can outrun the camera
      sim.moveTool(dx * scale, dy * scale);
      wrap.classList.add('grabbing');
    }
  });
  view.addEventListener('pointerup', e => {
    if (!drag) return;
    const wasClick = drag.moved <= 4; drag = null; wrap.classList.remove('grabbing');
    if (wasClick && sim.policy.s.state !== 'TRACKING') {
      const rect = view.getBoundingClientRect(), r = viewRect(sim.cam);
      const wx = r.x0 + (e.clientX - rect.left) / rect.width * r.w;
      const wy = r.y0 + (e.clientY - rect.top) / rect.height * r.h;
      sim.assist(wx, wy);
      clickRipple = { x: (e.clientX - rect.left) / rect.width * W, y: (e.clientY - rect.top) / rect.height * H, t: 0 };
    }
  });
  let clickRipple = null;

  // ------------------------------------------------------------------ voice (optional, Chrome)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, voiceOn = false;
  if (!SR) { $('btnVoice').disabled = true; $('btnVoice').title = 'Voice commands need Chrome or Edge'; }
  $('btnVoice').onclick = () => {
    if (!SR) return;
    voiceOn = !voiceOn; $('btnVoice').setAttribute('aria-pressed', voiceOn);
    $('voiceLabel').textContent = voiceOn ? 'Listening' : 'Voice';
    if (voiceOn) {
      rec = new SR(); rec.lang = 'en-GB'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = ev => {
        const said = ev.results[ev.results.length - 1][0].transcript.toLowerCase().trim();
        let cmd = null;
        if (/search|keep|continue|wait/.test(said)) cmd = 'veto';
        else if (/take|mine|manual/.test(said)) cmd = 'takeover';
        else if (/back|robot|resume/.test(said)) cmd = 'giveback';
        else if (/view|last/.test(said)) cmd = 'lastview';
        toast(cmd ? `Heard “${said}”` : `Heard “${said}”: not a command`, 'P');
        if (cmd) act(cmd);
      };
      rec.onend = () => { if (voiceOn) try { rec.start(); } catch (e) { /* already started */ } };
      rec.onerror = ev => { if (ev.error === 'not-allowed') { voiceOn = false; $('btnVoice').setAttribute('aria-pressed', false); $('voiceLabel').textContent = 'Voice'; toast('Microphone permission was refused'); } };
      try { rec.start(); } catch (e) { /* ignore */ }
    } else if (rec) { rec.onend = null; rec.stop(); }
  };

  // ------------------------------------------------------------------ audio: short non-speech tones (L04)
  function initAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; } }
  function tone(freq, dur, times) {
    if (!audio) return;
    for (let i = 0; i < (times || 1); i++) {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * (dur + 0.08);
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
  }

  // ------------------------------------------------------------------ main loop
  function frame(ts) {
    const real = Math.min(0.1, (ts - (lastTs || ts)) / 1000); lastTs = ts;
    if (running && sim && !sim.done) {
      acc += real * speed;
      while (acc >= PARAMS.dt && !sim.done) {
        sim.step(); acc -= PARAMS.dt;
        history.push({ t: sim.t, conf: sim.conf, state: sim.policy.s.state });
      }
      if (sim.scn.free && history.length > 3000) history.splice(0, history.length - 3000);
      if (sim.done && !summaryShown) { running = false; updatePause(); showSummary(); }
    }
    if (sim) {
      while (logCount < sim.log.length) onEvent(sim.log[logCount++]);
      render();
    }
    if (toastTimer > 0) { toastTimer -= real; if (toastTimer <= 0) $('toast').classList.remove('show'); }
    if (clickRipple) { clickRipple.t += real; if (clickRipple.t > 0.6) clickRipple = null; }
    requestAnimationFrame(frame);
  }

  function onEvent(e) {
    const list = $('log');
    if (list.firstElementChild && list.firstElementChild.classList.contains('log-empty')) list.innerHTML = '';
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${e.t.toFixed(1)}s</span><span class="who ${e.actor}" title="${e.actor === 'P' ? 'Person (surgeon)' : 'System (robot)'}">${e.actor}</span><span>${e.msg}</span>`;
    list.appendChild(li); list.scrollTop = list.scrollHeight;
    toast(e.msg, e.actor);
    if (e.actor === 'P') marks.push({ t: e.t });
    if (e.from === e.to) return;
    if (e.to === 'HANDOVER_PENDING') tone(660, 0.16, 2);
    else if (e.to === 'SURGEON') tone(440, 0.32, 1);
    else if (e.to === 'TRACKING') tone(880, 0.09, 1);
  }
  function toast(msg, actor) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + (actor || ''); toastTimer = 2.6;
  }

  // ------------------------------------------------------------------ drawing the view
  function render() {
    const cam = sim.cam, r = viewRect(cam), f = sim.lastFrame;
    ctx.drawImage(tex, toTex(r.x0), toTex(r.y0), toTex(r.w), toTex(r.h), 0, 0, W, H);
    const sx = x => (x - r.x0) / r.w * W, sy = y => (y - r.y0) / r.h * H, sc = W / r.w;

    if (f && f.tool.inBody) drawInstrument(sx(f.tool.x), sy(f.tool.y), sx(f.tool.x + 0.55), sy(f.tool.y + 0.45), sc);

    if (f && f.occ === 'flap') {
      const x = sx(f.tool.x), y = sy(f.tool.y);
      const g = ctx.createRadialGradient(x - 0.01 * sc, y - 0.01 * sc, 0, x, y, 0.08 * sc);
      g.addColorStop(0, 'rgba(168,58,50,1)'); g.addColorStop(0.7, 'rgba(140,40,38,0.98)'); g.addColorStop(1, 'rgba(140,40,38,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 0.08 * sc, 0.06 * sc, 0.4, 0, Math.PI * 2); ctx.fill();
    } else if (f && f.occ === 'partial') {
      const x = sx(f.tool.x), y = sy(f.tool.y);
      ctx.fillStyle = 'rgba(150,48,42,0.6)'; ctx.beginPath(); ctx.ellipse(x - 0.01 * sc, y, 0.05 * sc, 0.035 * sc, 0.3, 0, Math.PI * 2); ctx.fill();
    } else if (f && f.occ === 'smoke') {
      const g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.7);
      g.addColorStop(0, 'rgba(225,222,220,0.93)'); g.addColorStop(1, 'rgba(190,186,184,0.86)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // last-seen marker or edge arrow while the robot is not tracking
    const st = sim.policy.s.state;
    if (started && st !== 'TRACKING') drawLastSeen(sx(sim.lastSeen.x), sy(sim.lastSeen.y));

    if (clickRipple) {
      const k = clickRipple.t / 0.6;
      ctx.strokeStyle = `rgba(96,165,250,${1 - k})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(clickRipple.x, clickRipple.y, 8 + k * 30, 0, Math.PI * 2); ctx.stroke();
    }

    // endoscope vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.44, W / 2, H / 2, H * 0.66);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    renderHud();
    renderTimeline();
    $('clock').textContent = sim.t.toFixed(1);
  }

  function drawInstrument(tx, ty, px, py, sc) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.034 * sc;
    ctx.beginPath(); ctx.moveTo(px + 6, py + 8); ctx.lineTo(tx + 6, ty + 8); ctx.stroke();       // shadow
    ctx.strokeStyle = '#3a4048'; ctx.lineWidth = 0.028 * sc;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    const grad = ctx.createLinearGradient(tx - 10, ty - 10, tx + 10, ty + 10);
    grad.addColorStop(0, '#dfe5ec'); grad.addColorStop(1, '#8e98a4');
    ctx.strokeStyle = grad; ctx.lineWidth = 0.018 * sc;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
    const ang = Math.atan2(ty - py, tx - px), j = 0.035 * sc, open = 0.35 + 0.15 * Math.sin(sim.t * 3);
    ctx.strokeStyle = '#e6ebf0'; ctx.lineWidth = 0.008 * sc;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(ang + s * open) * j, ty + Math.sin(ang + s * open) * j); ctx.stroke(); }
  }

  function drawLastSeen(x, y) {
    const pad = 70, inside = x > pad && x < W - pad && y > pad && y < H - pad;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    if (inside) {
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillText('last seen', x, y - 34);
    } else {
      // arrow on the edge of the view, pointing towards where the tool was last seen
      const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
      const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
      const ax = cx + dx * k, ay = cy + dy * k, ang = Math.atan2(dy, dx);
      ctx.translate(ax, ay); ctx.rotate(ang);
      ctx.fillStyle = 'rgba(251,191,36,.95)';
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14); ctx.closePath(); ctx.fill();
      ctx.rotate(-ang);
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillText('last seen', -Math.cos(ang) * 34, -Math.sin(ang) * 34 + 4);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ HUD
  function renderHud() {
    const c = sim.conf, st = sim.policy.s.state, f = sim.lastFrame || {};
    const b = $('badge');
    b.classList.toggle('amber', c >= PARAMS.low && c < PARAMS.high);
    b.classList.toggle('red', c < PARAMS.low);
    $('meterFg').style.strokeDashoffset = (94.2 * (1 - Math.max(0.03, c))).toFixed(1);
    let label, reason;
    if (c >= PARAMS.high) { label = 'Tracking'; reason = `Tool in view · ${Math.round(c * 100)}% sure`; }
    else if (c >= PARAMS.low) { label = 'Uncertain'; reason = `Tool partly visible · ${Math.round(c * 100)}%`; }
    else { label = 'Lost'; reason = f.nearEdge ? 'Tool may have left the view' : 'Tool may be hidden'; }
    $('badgeLabel').textContent = label; $('badgeReason').textContent = reason;

    const chip = $('stateChip'); chip.style.setProperty('--c', STATE_COLOR[st]); $('stateText').textContent = STATE_TEXT[st];
    document.querySelectorAll('#steps li').forEach(li => li.classList.toggle('on', li.dataset.s === st));

    const cd = $('countdown');
    if (st === 'HANDOVER_PENDING') {
      cd.classList.remove('hidden');
      const total = sim.P.countdown, left = Math.max(0, sim.policy.s.countdownLeft);
      $('cdNum').textContent = Math.max(1, Math.ceil(left));
      $('ringFg').style.strokeDashoffset = (175.9 * (1 - left / total)).toFixed(1);
    } else cd.classList.add('hidden');
    $('surgeonBar').classList.toggle('hidden', st !== 'SURGEON');
    $('assistHint').classList.toggle('hidden', !(started && st === 'RETREATING'));

    // which actions make sense right now
    $('btnVeto').disabled = st !== 'HANDOVER_PENDING';
    $('btnTake').disabled = st === 'SURGEON';
    $('btnGive').disabled = st !== 'SURGEON';
    $('btnLast').disabled = !(st === 'RETREATING' || st === 'HANDOVER_PENDING');
    wrap.classList.toggle('grab', sim.scn.free && st === 'TRACKING');
    wrap.classList.toggle('point', st !== 'TRACKING');
  }

  // ------------------------------------------------------------------ timeline: confidence line over a state band
  function renderTimeline() {
    const dpr = window.devicePixelRatio || 1, rect = tl.getBoundingClientRect();
    if (tl.width !== Math.round(rect.width * dpr) || tl.height !== Math.round(rect.height * dpr)) {
      tl.width = Math.round(rect.width * dpr); tl.height = Math.round(rect.height * dpr);
    }
    const w = rect.width, h = rect.height;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, w, h);
    const span = sim.scn.free ? 40 : sim.scn.duration;
    const t0 = sim.scn.free ? Math.max(0, sim.t - span) : 0;
    const left = 34, right = w - 6, top = 6, bandH = 12, axisH = 14;
    const plotB = h - bandH - axisH - 6;
    const X = t => left + (t - t0) / span * (right - left);
    const Y = v => plotB - v * (plotB - top);

    tctx.font = '10px Inter, system-ui, sans-serif'; tctx.fillStyle = '#6f8094'; tctx.textAlign = 'right';
    for (const [v, lab, col] of [[PARAMS.high, 'track', 'rgba(52,211,153,.55)'], [PARAMS.low, 'lost', 'rgba(248,113,113,.55)']]) {
      tctx.strokeStyle = col; tctx.setLineDash([4, 4]); tctx.beginPath(); tctx.moveTo(left, Y(v)); tctx.lineTo(right, Y(v)); tctx.stroke();
      tctx.fillText(lab, left - 4, Y(v) + 3);
    }
    tctx.setLineDash([]);

    // time axis
    const bandY = plotB + 4;
    tctx.textAlign = 'center';
    const step = span > 30 ? 5 : 2;
    for (let t = Math.ceil(t0 / step) * step; t <= t0 + span + 1e-6; t += step) {
      tctx.fillText(`${t}s`, X(t), h - 2);
    }

    const pts = history.filter(p => p.t >= t0);
    // state band
    tctx.fillStyle = 'rgba(255,255,255,.05)'; tctx.fillRect(left, bandY, right - left, bandH);
    // one rectangle per run of the same state (avoids hairline seams)
    for (let i = 1, runStart = 0; i <= pts.length; i++) {
      if (i === pts.length || pts[i].state !== pts[runStart].state) {
        const xa = Math.round(X(pts[runStart].t)), xb = Math.round(X(pts[i - 1].t));
        tctx.fillStyle = STATE_COLOR[pts[runStart].state];
        tctx.fillRect(xa, bandY, Math.max(1, xb - xa + 1), bandH);
        runStart = i;
      }
    }
    // confidence line
    if (pts.length > 1) {
      tctx.strokeStyle = '#e8eef5'; tctx.lineWidth = 1.8; tctx.beginPath();
      pts.forEach((p, i) => i ? tctx.lineTo(X(p.t), Y(p.conf)) : tctx.moveTo(X(p.t), Y(p.conf)));
      tctx.stroke();
    }
    // surgeon inputs
    for (const m of marks) {
      if (m.t < t0) continue;
      tctx.fillStyle = '#fff'; tctx.strokeStyle = '#0a0f15'; tctx.lineWidth = 2;
      tctx.beginPath(); tctx.arc(X(m.t), bandY + bandH / 2, 4.5, 0, Math.PI * 2); tctx.fill(); tctx.stroke();
    }
    // now cursor
    tctx.strokeStyle = 'rgba(45,212,191,.8)'; tctx.lineWidth = 1;
    tctx.beginPath(); tctx.moveTo(X(sim.t), top); tctx.lineTo(X(sim.t), bandY + bandH); tctx.stroke();
  }

  // ------------------------------------------------------------------ run summary
  function showSummary() {
    summaryShown = true;
    const L = sim.log, changes = L.filter(e => e.from !== e.to);
    const losses = changes.filter(e => e.from === 'TRACKING');
    const recTimes = [];
    for (const l of losses) {
      const back = changes.find(e => e.t >= l.t && (e.to === 'SURGEON' || (e.to === 'TRACKING' && e.t > l.t)));
      if (back) recTimes.push(back.t - l.t);
    }
    const robotFound = changes.filter(e => e.to === 'TRACKING' && e.actor === 'S').length;
    const autoHand = changes.filter(e => e.to === 'SURGEON' && e.actor === 'S').length;
    const takeovers = changes.filter(e => e.to === 'SURGEON' && e.actor === 'P').length;
    const vetoes = L.filter(e => /vetoed/.test(e.msg)).length;
    const assists = L.filter(e => /pointed to the tool/.test(e.msg)).length;
    const avg = recTimes.length ? (recTimes.reduce((a, b) => a + b, 0) / recTimes.length).toFixed(1) + ' s' : '–';
    const stats = [
      [losses.length, 'times the tool was lost'],
      [avg, 'average time to recover'],
      [robotFound, 'times the robot found it'],
      [autoHand, 'handovers to you'],
      [`${vetoes} / ${takeovers}`, 'vetoes / take-overs'],
      [assists, 'times you pointed to the tool']
    ];
    $('sumStats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('sumTitle').textContent = sim.scn.free ? `Free play · ${sim.t.toFixed(0)} s` : `${sim.scn.id} · ${sim.scn.name}`;
    let note = `Policy: ${sim.policy.name}${sim.policy.id === 'ours' ? ` (${PRESETS[style].label.toLowerCase()})` : ''}.`;
    if (!sim.scn.free) {
      const handed = changes.some(e => e.to === 'SURGEON');
      const ok = handed === sim.scn.shouldHandover;
      note += sim.scn.shouldHandover
        ? (ok ? ' The tool did not come back and the camera was handed to you: correct.' : ' The tool did not come back, but the camera was never handed to you.')
        : (ok ? ' The tool came back and no handover was needed: correct.' : ' The tool came back, but the camera was handed over anyway.');
    }
    $('sumNote').textContent = note;
    $('summaryOverlay').classList.remove('hidden');
  }

  function downloadCsv() {
    if (!sim) return;
    const rows = [['time_s', 'from', 'to', 'actor', 'confidence', 'message']]
      .concat(sim.log.map(e => [e.t, e.from, e.to, e.actor, e.conf, `"${e.msg}"`]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `log_${sim.scn.id}_${sim.policy.id}.csv`; a.click();
  }

  // read-only hook used by automated browser tests
  window.__console = { get sim() { return sim; } };

  reset();
  requestAnimationFrame(frame);
})();
