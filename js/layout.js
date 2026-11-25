/*
 * layout.js - keeps the whole console visible and offers full screen.
 *
 * The stage (view, timeline and buttons) takes all the width the page gives it, so the
 * timeline legend and the button row never wrap. Only the 4:3 view is sized, to fit the
 * height that is left after the header, timeline and buttons are measured.
 * Press F (or the Full screen button) for full screen.
 */
(function () {
  'use strict';
  const layout = document.querySelector('.layout');
  const $ = id => document.getElementById(id);
  let last = 0;

  function fit() {
    const header = document.querySelector('.topbar').offsetHeight;
    const cs = getComputedStyle(layout);
    const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const stage = document.querySelector('.stage');
    const stageW = stage.clientWidth;
    const stacked = window.matchMedia('(max-width: 1100px)').matches;   // one column: the page may scroll
    const below = document.querySelector('.timeline-card').offsetHeight + document.querySelector('.actions').offsetHeight + 12 * 2;
    const availH = window.innerHeight - header - padV - below - 6;
    let vh = stacked ? stageW * 3 / 4 : Math.min(availH, stageW * 3 / 4);
    vh = Math.round(Math.max(240, Math.min(vh, stacked ? 640 : 1000)));
    if (Math.abs(vh - last) < 1) return;
    last = vh;
    layout.style.setProperty('--vh', vh + 'px');
  }
  function fitSettled() { fit(); requestAnimationFrame(fit); setTimeout(fit, 150); setTimeout(fit, 500); }

  function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFull() {
    const el = document.documentElement;
    if (isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { const p = req.call(el); if (p && p.catch) p.catch(() => {}); }
  }
  function labelFull() {
    const b = $('btnFull'); if (!b) return;
    b.innerHTML = (isFull() ? 'Exit full screen' : 'Full screen') + ' <kbd>F</kbd>';
    b.setAttribute('aria-pressed', isFull());
  }

  const btn = $('btnFull');
  if (btn) {
    if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) { btn.disabled = true; btn.title = 'Full screen is not available in this browser'; }
    btn.addEventListener('click', toggleFull);
  }
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (e.ctrlKey || e.metaKey || e.altKey || tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFull(); }
  });
  document.addEventListener('fullscreenchange', () => { labelFull(); fitSettled(); });
  document.addEventListener('webkitfullscreenchange', () => { labelFull(); fitSettled(); });
  window.addEventListener('resize', fitSettled);
  window.addEventListener('load', fitSettled);
  fitSettled(); labelFull();
  window.EndoLayout = { fit: fitSettled, toggleFull };
})();
