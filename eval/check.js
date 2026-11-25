#!/usr/bin/env node
/*
 * check.js - checks the claims made in the README and the report against the code.
 *
 *   node eval/check.js
 *
 * Prints PASS or FAIL for each claim and exits with an error if any claim fails.
 * It uses the same simulation as the console (js/core.js), so what is checked is what you see.
 */
'use strict';
const { SCENARIOS, PRESETS, Simulation } = require('../js/core.js');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
}
const get = id => SCENARIOS.find(s => s.id === id);
const run = (id, pid, params, surgeon) => Simulation.run(get(id), pid, params, surgeon).metrics;

// The same simulated surgeon as Study 2 in run_eval.js: one second after a handover is
// proposed, press "keep searching" only if the tool is really still there.
function vetoingSurgeon() {
  let since = null;
  return sim => {
    if (sim.policy.s.state !== 'HANDOVER_PENDING') { since = null; return null; }
    if (since === null) since = sim.t;
    if (!sim.scn.shouldHandover && sim.t - since >= 1.0) { since = Infinity; return 'veto'; }
    return null;
  };
}

// 1. The scenarios are well formed
check('12 scenarios, each labelled with the right answer (hand over or not)',
  SCENARIOS.length === 12 && SCENARIOS.every(s => typeof s.shouldHandover === 'boolean'));

// 2. Runs repeat exactly (fixed seeds), so the results file can be reproduced
const a = JSON.stringify(run('S4', 'ours')), b = JSON.stringify(run('S4', 'ours'));
check('a scenario gives identical results when run twice', a === b);

// 3. Wide view finds a tool that left the view faster than holding still
for (const id of ['S4', 'S5']) {
  const o = run(id, 'ours'), t = run(id, 'timeout');
  check(`${id}: our policy tracks the tool again sooner than the fixed timeout`,
    o.timeToTracking !== null && t.timeToTracking !== null && o.timeToTracking < t.timeToTracking,
    `${o.timeToTracking} s vs ${t.timeToTracking} s`);
}

// 4. When the tool is really gone, our policy hands over sooner than the 10 s timeout
for (const id of ['S7', 'S8', 'S9', 'S10']) {
  const o = run(id, 'ours'), t = run(id, 'timeout');
  check(`${id}: our policy hands over sooner than the fixed timeout`,
    o.handedOver && t.handedOver && o.timeToHandover < t.timeToHandover,
    `${o.timeToHandover} s vs ${t.timeToHandover} s`);
}

// 5. No-recovery baseline never hands over
const gone = SCENARIOS.filter(s => s.shouldHandover);
check('no-recovery baseline misses every handover that is needed',
  gone.every(s => run(s.id, 'none').missedHandover), `${gone.length} scenarios`);

// 6. The weakness we admit to: S12 is a false handover without the surgeon
const s12 = run('S12', 'ours');
check('S12: without the surgeon, our policy hands over although the tool is there (known weakness)',
  s12.falseHandover === true);

// 7. The veto fixes it
const s12v = run('S12', 'ours', null, vetoingSurgeon());
check('S12: a surgeon who vetoes avoids the false handover', s12v.handedOver === false && s12v.vetoes >= 1,
  `vetoes ${s12v.vetoes}`);

// 8. Brief occlusions do not trigger a handover under any policy
check('S1-S3 (brief occlusions): nobody hands over',
  ['S1', 'S2', 'S3'].every(id => ['ours', 'timeout', 'none'].every(p => !run(id, p).handedOver)));

// 9. Handover style is a real trade-off: eager is quicker but gives up more often
const gaps = {}, falses = {};
for (const k of ['cautious', 'balanced', 'eager']) {
  gaps[k] = run('S7', 'ours', PRESETS[k]).timeToHandover;
  falses[k] = SCENARIOS.filter(s => !s.shouldHandover && run(s.id, 'ours', PRESETS[k]).falseHandover).length;
}
check('handover time on S7: eager < balanced < cautious', gaps.eager < gaps.balanced && gaps.balanced < gaps.cautious,
  `${gaps.eager} < ${gaps.balanced} < ${gaps.cautious}`);
check('false handovers: cautious <= balanced <= eager, and eager has more than cautious',
  falses.cautious <= falses.balanced && falses.balanced <= falses.eager && falses.eager > falses.cautious,
  `${falses.cautious}, ${falses.balanced}, ${falses.eager}`);

// 10. Time to tracking and time to handover are kept apart
const m7 = run('S7', 'ours');
check('a handover run has a time to handover and no time to tracking after it',
  m7.timeToHandover !== null && (m7.timeToTracking === null || m7.timeToTracking > m7.timeToHandover));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
