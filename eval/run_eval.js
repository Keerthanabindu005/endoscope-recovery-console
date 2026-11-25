#!/usr/bin/env node
/*
 * run_eval.js — evaluation of the recovery policy on the 12 scripted scenarios.
 *
 *   Study 1  Three policies, no surgeon input (ours vs fixed 10 s timeout vs no recovery)
 *   Study 2  Our policy with a simulated surgeon who vetoes a handover when the tool is still there
 *   Study 3  Our policy at three handover styles: cautious, balanced, eager
 *   Study 4  Occlusion-length sweep: how long can the tool be hidden before each policy gives up?
 *
 * Usage:  node eval/run_eval.js
 * Writes: eval/results.md, eval/results.csv, eval/sweep.csv, eval/tradeoff.svg
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { SCENARIOS, PRESETS, Simulation } = require('../js/core.js');

const OUT = __dirname;
const nNo = SCENARIOS.filter(s => !s.shouldHandover).length;
const nYes = SCENARIOS.filter(s => s.shouldHandover).length;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function summarise(rows) {
  return {
    meanRecovery: mean(rows.map(r => r.recoveryTime)),
    meanNo: mean(rows.filter(r => !r.shouldHandover).map(r => r.recoveryTime)),
    meanYes: mean(rows.filter(r => r.shouldHandover).map(r => r.recoveryTime)),
    falseHandovers: rows.filter(r => r.falseHandover).length,
    missedHandovers: rows.filter(r => r.missedHandover).length,
    vetoes: rows.reduce((a, r) => a + (r.vetoes || 0), 0)
  };
}

// Simulated surgeon for Study 2: can see whether the tool is really still in the body.
// Reacts 1 s after a handover is proposed; vetoes only when the tool is still there.
function vetoingSurgeon() {
  let pendingSince = null;
  return sim => {
    const st = sim.policy.s.state;
    if (st !== 'HANDOVER_PENDING') { pendingSince = null; return null; }
    if (pendingSince === null) pendingSince = sim.t;
    const toolStillThere = !sim.scn.shouldHandover;
    if (toolStillThere && sim.t - pendingSince >= 1.0) { pendingSince = Infinity; return 'veto'; }
    return null;
  };
}

// ----------------------------------------------------------------- Study 1
const POLICY_IDS = ['ours', 'timeout', 'none'];
const POLICY_NAMES = { ours: 'Confidence-aware (ours)', timeout: 'Fixed 10 s timeout', none: 'No recovery' };
const study1 = [];
for (const scn of SCENARIOS) for (const pid of POLICY_IDS) study1.push(Simulation.run(scn, pid).metrics);

// ----------------------------------------------------------------- Study 2
const study2 = SCENARIOS.map(scn => Simulation.run(scn, 'ours', null, vetoingSurgeon()).metrics);

// ----------------------------------------------------------------- Study 3
const study3 = {};
for (const [key, p] of Object.entries(PRESETS)) {
  study3[key] = SCENARIOS.map(scn => Simulation.run(scn, 'ours', p).metrics);
}

// ----------------------------------------------------------------- CSV (all runs)
const header = ['study', 'variant', 'scenario', 'shouldHandover', 'onset', 'recoveryTime', 'timeToTracking', 'timeToHandover', 'handedOver', 'handoverAt', 'falseHandover', 'missedHandover', 'retreats', 'vetoes'];
const line = (study, variant, r) => [study, variant].concat(header.slice(2).map(h => r[h] === null || r[h] === undefined ? '' : r[h])).join(',');
const csv = [header.join(',')]
  .concat(study1.map(r => line('1-policies', r.policy, r)))
  .concat(study2.map(r => line('2-surgeon-veto', 'ours+veto', r)))
  .concat(Object.entries(study3).flatMap(([k, rs]) => rs.map(r => line('3-styles', k, r))));
fs.writeFileSync(path.join(OUT, 'results.csv'), csv.join('\n') + '\n');

// ----------------------------------------------------------------- Markdown
const f1 = x => x.toFixed(1);
let md = '# Evaluation results\n\n';
md += `${SCENARIOS.length} scripted scenarios (${nNo} where the tool comes back, ${nYes} where it is really gone). `;
md += 'Fixed random seed per scenario, so every run repeats exactly.\n\n';
md += '**Recovery time** = seconds from losing the tool until it is tracked again for at least 1 s, or the surgeon has control. ';
md += 'Runs that never recover count the remaining scenario time.\n\n';
md += '> These scenarios were designed to test specific situations, including two placed either side of when the policy hands over (S11, S12). ';
md += 'The counts show how each policy behaves in those situations; they are not real-world error rates.\n\n';

md += '## Study 1: three policies, no surgeon input\n\n';
md += '| Policy | Mean recovery (s) | Tool comes back | Tool really gone | False handovers | Missed handovers |\n| --- | --- | --- | --- | --- | --- |\n';
for (const pid of POLICY_IDS) {
  const s = summarise(study1.filter(r => r.policy === pid));
  md += `| ${POLICY_NAMES[pid]} | ${f1(s.meanRecovery)} | ${f1(s.meanNo)} | ${f1(s.meanYes)} | ${s.falseHandovers} / ${nNo} | ${s.missedHandovers} / ${nYes} |\n`;
}
md += '\n**Per scenario** (recovery time in s; H = handed over)\n\n';
md += '| Scenario | Should hand over | ' + POLICY_IDS.map(p => POLICY_NAMES[p]).join(' | ') + ' |\n';
md += '| --- | --- | ' + POLICY_IDS.map(() => '---').join(' | ') + ' |\n';
for (const scn of SCENARIOS) {
  const cells = POLICY_IDS.map(pid => {
    const r = study1.find(x => x.scenario === scn.id && x.policy === pid);
    return `${r.recoveryTime}${r.handedOver ? ' H' : ''}${r.falseHandover ? ' (false)' : ''}${r.missedHandover ? ' (missed)' : ''}`;
  });
  md += `| ${scn.id} ${scn.name} | ${scn.shouldHandover ? 'yes' : 'no'} | ${cells.join(' | ')} |\n`;
}

const s1ours = summarise(study1.filter(r => r.policy === 'ours'));
const s2 = summarise(study2);
md += '\n## Study 2: surgeon veto\n\n';
md += 'A simulated surgeon watches the countdown. One second after a handover is proposed, they press "keep searching" only if the tool is really still there.\n\n';
md += '| Condition | Mean recovery (s) | False handovers | Missed handovers | Vetoes used |\n| --- | --- | --- | --- | --- |\n';
md += `| Ours, no surgeon input | ${f1(s1ours.meanRecovery)} | ${s1ours.falseHandovers} / ${nNo} | ${s1ours.missedHandovers} / ${nYes} | 0 |\n`;
md += `| Ours, surgeon can veto | ${f1(s2.meanRecovery)} | ${s2.falseHandovers} / ${nNo} | ${s2.missedHandovers} / ${nYes} | ${s2.vetoes} |\n`;
const vetoed = study2.filter(r => r.vetoes > 0).map(r => r.scenario);
md += `\nVetoes happened in: ${vetoed.length ? vetoed.join(', ') : 'none'}.\n`;

md += '\n## Study 3: handover style (cautious, balanced, eager)\n\n';
md += '| Style | Retreat after | Search in wide view | Countdown | Mean recovery (s) | Tool really gone (s) | False handovers | Missed handovers |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
const s3 = {};
for (const [k, p] of Object.entries(PRESETS)) {
  s3[k] = summarise(study3[k]);
  md += `| ${p.label} | ${p.retreatAfter} s | ${p.overviewWait} s | ${p.countdown} s | ${f1(s3[k].meanRecovery)} | ${f1(s3[k].meanYes)} | ${s3[k].falseHandovers} / ${nNo} | ${s3[k].missedHandovers} / ${nYes} |\n`;
}
md += '\nEager hands over sooner when the tool is really gone, but gives up on more tools that were only hidden. Cautious is the reverse. See `tradeoff.svg`.\n';

// ---- Study 1b: the two ways a loss ends, kept apart
md += '\n## Study 1b: tracking again versus handing over\n\n';
md += 'Recovery time above counts either ending. Here they are separated: **time to tracking** (tracked again for 1 s) and **time to handover** (surgeon has control), each averaged only over the runs where it happened.\n\n';
md += '| Policy | Runs that tracked again | Mean time to tracking (s) | Runs that handed over | Mean time to handover (s) |\n| --- | --- | --- | --- | --- |\n';
for (const pid of POLICY_IDS) {
  const rs = study1.filter(r => r.policy === pid && r.onset !== null);
  const tr = rs.filter(r => r.timeToTracking !== null), ho = rs.filter(r => r.timeToHandover !== null);
  md += `| ${POLICY_NAMES[pid]} | ${tr.length} / ${rs.length} | ${tr.length ? f1(mean(tr.map(r => r.timeToTracking))) : '-'} | ${ho.length} / ${rs.length} | ${ho.length ? f1(mean(ho.map(r => r.timeToHandover))) : '-'} |\n`;
}
md += '\nEarly handover shortens "recovery" without the tool being found, so read this table together with the false and missed handover counts.\n';

// ---- Study 4: occlusion-length sweep (tool hidden by tissue for 1..15 s, then it clears)
const LENGTHS = []; for (let d = 1; d <= 15; d++) LENGTHS.push(d);
const sweepVariants = [
  { id: 'cautious', label: 'Ours (cautious)', pid: 'ours', params: PRESETS.cautious },
  { id: 'balanced', label: 'Ours (balanced)', pid: 'ours', params: PRESETS.balanced },
  { id: 'eager', label: 'Ours (eager)', pid: 'ours', params: PRESETS.eager },
  { id: 'timeout', label: 'Fixed 10 s timeout', pid: 'timeout', params: null }
];
const sweepRows = [];
function sweepScenario(d) {
  return { id: 'L' + d, name: `Occlusion (${d} s)`, type: 'sweep', duration: d + 16, shouldHandover: false,
    keys: [{ t: 0, x: 0.5, y: 0.38, inBody: true }], occlusions: [{ t0: 4, t1: 4 + d, kind: 'flap' }] };
}
for (const d of LENGTHS) for (const v of sweepVariants) {
  const m = Simulation.run(sweepScenario(d), v.pid, v.params).metrics;
  sweepRows.push({ length: d, variant: v.id, handedOver: m.handedOver, timeToTracking: m.timeToTracking, timeToHandover: m.timeToHandover });
}
fs.writeFileSync(path.join(OUT, 'sweep.csv'), ['occlusionSeconds,variant,handedOver,timeToTracking,timeToHandover']
  .concat(sweepRows.map(r => [r.length, r.variant, r.handedOver, r.timeToTracking ?? '', r.timeToHandover ?? ''].join(','))).join('\n') + '\n');
md += '\n## Study 4: how long can the tool be hidden? (occlusion-length sweep)\n\n';
md += 'Tissue covers the tool for 1 to 15 s and then clears, so the tool is always still there and every handover is a false handover. ';
md += 'Each cell shows what happened: **T x** = tracked again after x s from the start of the loss; **H x** = handed over to the surgeon after x s (false handover).\n\n';
md += '| Hidden for (s) | ' + sweepVariants.map(v => v.label).join(' | ') + ' |\n| --- | ' + sweepVariants.map(() => '---').join(' | ') + ' |\n';
for (const d of LENGTHS) {
  const cells = sweepVariants.map(v => {
    const r = sweepRows.find(x => x.length === d && x.variant === v.id);
    return r.handedOver ? `H ${f1(r.timeToHandover)}` : (r.timeToTracking !== null ? `T ${f1(r.timeToTracking)}` : 'not recovered');
  });
  md += `| ${d} | ${cells.join(' | ')} |\n`;
}
const firstH = id => { const r = sweepRows.filter(x => x.variant === id && x.handedOver).map(x => x.length); return r.length ? Math.min(...r) : null; };
md += '\nShortest hiding time that makes each variant hand over: ' + sweepVariants.map(v => `${v.label} ${firstH(v.id) === null ? 'never (within 15 s)' : firstH(v.id) + ' s'}`).join('; ') + '.\n';
md += 'This sweep uses one occlusion shape and one position, so it shows where each policy gives up, not how often that happens in surgery.\n';

fs.writeFileSync(path.join(OUT, 'results.md'), md);

// ----------------------------------------------------------------- Chart (SVG)
(function chart() {
  const styles = Object.keys(PRESETS);
  const W = 640, H = 340, m = { l: 56, r: 24, t: 70, b: 56 };
  const pw = (W - m.l - m.r) / 2 - 20, ph = H - m.t - m.b;
  const cols = { cautious: '#4ea1ff', balanced: '#2fbf9f', eager: '#f2a33a' };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, Segoe UI, system-ui, sans-serif">`;
  svg += `<rect width="${W}" height="${H}" fill="#ffffff"/>`;
  svg += `<text x="${m.l}" y="24" font-size="15" font-weight="600" fill="#1d2633">Handover style trade-off (${SCENARIOS.length} scripted scenarios)</text>`;
  const panels = [
    { title: 'Time to hand over when tool is gone (s)', val: k => s3[k].meanYes, max: Math.ceil(Math.max(...styles.map(k => s3[k].meanYes)) + 1) },
    { title: `False handovers (of ${nNo})`, val: k => s3[k].falseHandovers, max: Math.max(3, ...styles.map(k => s3[k].falseHandovers)) }
  ];
  panels.forEach((p, i) => {
    const x0 = m.l + i * (pw + 40), bw = pw / styles.length * 0.6;
    svg += `<text x="${x0}" y="${m.t - 10}" font-size="12" fill="#55606e">${p.title}</text>`;
    svg += `<line x1="${x0}" y1="${m.t + ph}" x2="${x0 + pw}" y2="${m.t + ph}" stroke="#c9d1db"/>`;
    for (let g = 0; g <= p.max; g += Math.max(1, Math.round(p.max / 4))) {
      const y = m.t + ph - g / p.max * ph;
      svg += `<line x1="${x0}" y1="${y}" x2="${x0 + pw}" y2="${y}" stroke="#eef1f5"/><text x="${x0 - 6}" y="${y + 4}" font-size="10" text-anchor="end" fill="#8a94a3">${g}</text>`;
    }
    styles.forEach((k, j) => {
      const v = p.val(k), h = v / p.max * ph, cx = x0 + (j + 0.5) * pw / styles.length;
      svg += `<rect x="${cx - bw / 2}" y="${m.t + ph - h}" width="${bw}" height="${h}" rx="3" fill="${cols[k]}"/>`;
      svg += `<text x="${cx}" y="${m.t + ph - h - 5}" font-size="11" text-anchor="middle" fill="#1d2633">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`;
      svg += `<text x="${cx}" y="${m.t + ph + 16}" font-size="11" text-anchor="middle" fill="#55606e">${PRESETS[k].label}</text>`;
    });
  });
  svg += `<text x="${m.l}" y="${H - 12}" font-size="10" fill="#8a94a3">Lower is better in both panels. Scenarios were designed to probe the handover point; counts are not real-world rates.</text>`;
  svg += '</svg>';
  fs.writeFileSync(path.join(OUT, 'tradeoff.svg'), svg);
})();

console.log(md);
