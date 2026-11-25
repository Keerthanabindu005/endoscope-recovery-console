# EndoTrack: Confidence-Aware Endoscope Camera Recovery

*Simulated surgeon-facing console: search, widen the view, or hand over*

**README prose word count: about 980** (tables included; headings, code blocks and setup commands not counted)

**Submitted version:** release/tag [`a2-submission`](https://github.com/Keerthanabindu005/endoscope-recovery-console/releases/tag/a2-submission); the commit ID is given in the report. Report: *EndoTrack_IIS_Assignment2_Report_Keerthana*.

A simulated surgeon console for a robotic endoscope holder. When tool tracking becomes unreliable, a confidence-aware policy chooses between reacquiring the tool, zooming out, or handing the camera to the surgeon, who can veto, take over or point to the tool. It develops the policy proposed in my Assignment 1 literature review.

## Project status

| Part | Status |
|---|---|
| Recovery policy (follow → search → wide view → ask → hand over, with veto; cautious / balanced / eager styles) and two baselines (fixed 10 s timeout, no recovery) | Implemented |
| Console (confidence meter and reason, state chip, timeline, decision log, run summary, tones, CSV download, full screen) and surgeon controls (veto, take over, give back, last view, point-to-tool, free play) | Implemented |
| Evaluation: `eval/run_eval.js` (3 policies, simulated veto surgeon, handover styles, occlusion sweep) and `eval/check.js` (15 claim checks) | Implemented |
| Voice commands (Web Speech API; Chrome/Edge; tested in Chrome) | Implemented, optional |
| Endoscope view, instrument tracker, robot camera holder | Simulated |
| Foot pedal | Simulated: the keyboard (Space, T, G, R) stands in for it; no pedal code exists |
| Real surgical video tracker, robot integration, learned confidence estimator, surgeon user study | Planned (not started) |

**Limits of the evidence**

- Scenarios S1–S12 are hand-designed. S11 (6 s) and S12 (8 s) sit either side of the 7 s balanced handover point, so false-handover counts show behaviour, not real-world rates.
- The simulated veto surgeon is idealised: a fixed rule that always knows whether the tool is really there.
- Without a veto, the policy makes 1/8 false handovers (S12) against 0/8 for the fixed timeout; the gain is faster recovery elsewhere (Study 1).
- The 0.3 s policy hold, 1 s metric requirement and 0.6 / 0.3 confidence bands are hand-set, not clinically calibrated.
- Not validated for clinical use; whether surgeons understand or trust the display needs a user study.

## Technology stack

- **Frontend:** HTML, CSS and plain JavaScript (no framework, build step or libraries). Runs the simulated tracker, policy and console.
- **Voice:** browser Web Speech API (Chrome/Edge), optional.
- **Evaluation:** Node.js v18+. Runs the policy comparison and claim checks.
- **AI at runtime:** none. The policy is rule-based, so no API keys are used or stored.
- **AI in development:** Claude (free version); see AI assistance.
- **Undecided:** how to replace the simulated tracker and how to calibrate confidence.

## Running or inspecting the work

No installation needed. Open `index.html` in Chrome/Edge (if voice fails on a local file, run `python -m http.server`). Choose **Free play** or a scenario (S1–S12), choose a **Recovery policy**, press **Start**, and press **F** for full screen. **Handover style** changes only the proposed policy and is disabled for baselines.

**Keys:** click the tool = point-to-tool; Space = veto handover; T = take over; G = give back; R = last view; arrows and + / − = pan and zoom when in control; H / W / S = hide, withdraw, smoke (free play); P = pause; voice (Chrome/Edge): "search", "take", "back", "view".

Code: `js/core.js` (scenarios, tracker, policies), `js/app.js` (console), `js/layout.js` (viewport). Fixed seeds make every run reproducible. Results for "Study 1, 1b, 2, 3, 4" named in the report are in `eval/results.md`.

```bash
node eval/run_eval.js   # regenerates eval/results.md, results.csv, sweep.csv, tradeoff.svg
node eval/check.js      # 15 PASS/FAIL checks of this README's claims against the code
```

## Development record

I built the project in one working period and committed it once, so the commit tagged `a2-submission` contains all stages below. They are listed in build order; the evidence for each is in the named files, not in separate commits.

| Stage | What I decided and why | What I checked | Evidence |
|---|---|---|---|
| 1. Scope | Kept the Assignment 1 policy over two alternatives (IT-help assistant, programming hint coach): its literature, baselines and metrics already supported it. | n/a | `js/core.js`, `eval/` |
| 2. Policy and baselines | Built the state-machine policy plus two baselines, so claims are measured rather than asserted. | Decision-log timelines differ as expected. | `js/core.js`, `eval/results.md` |
| 3. Bands and holds | Set bands (≥ 0.6 tracking, < 0.3 lost), a 0.3 s policy hold and a 1 s metric requirement after flicker caused false recoveries. | Re-ran flicker tests with and without the holds. | `js/core.js` |
| 4. Boundary scenarios | Designed 12 scenarios, with S11 and S12 either side of the 7 s handover point and S12 a deliberate false handover. | Timings checked against decision logs. | `js/core.js`, `eval/results.md` |
| 5. Surgeon in the loop | Added free play, point-to-tool, last-seen marker, handover styles, voice and a simulated veto surgeon. | Study 2: false handovers 1/8 → 0/8 (idealised surgeon). | `js/app.js`, `eval/results.md` |
| 6. Metric split and claim checks | Split recovery into time-to-tracking and time-to-handover, added the 1–15 s occlusion sweep and `check.js`. | 15/15 checks pass; `run_eval.js` reproduces `results.md`. | `eval/check.js`, `eval/sweep.csv` |
| 7. Decision not to tune | Left thresholds unchanged after the sweep to avoid circular tuning on S11/S12. | Sweep handover points: balanced 7 s, cautious and timeout 11 s, eager 4 s. | `eval/sweep.csv` |

## AI assistance

**Tool:** Claude (free version). No other AI tool used.

- **Code drafting.** Claude drafted `js/core.js`, `js/app.js` and the evaluation scripts from my specifications. I reviewed all code, set the bands, holds and all 12 scenarios myself, revised mismatches, and checked timings against decision logs for every scenario and policy.
- **Evaluation critique.** I asked which metrics could flatter the policy. Claude noted that one recovery time conflates handover with reacquisition; I split it (Study 1b), added the sweep (Study 4) and checked it with `run_eval.js` and `check.js`.
- **Claim checks.** Claude drafted `eval/check.js` for claims I chose; I removed trivial checks and confirmed 15/15 pass.
- **Report, diagram, README.** Claude helped format the report, architecture diagram, storyboards and README structure. I wrote or edited the content and checked every claim against the code and `eval/results.md`.

**Mine:** concept, policy logic, bands, holds, scenarios, metric split, manual testing and design decisions. **AI-assisted:** code drafts, edge cases, evaluation critique, check scripts, formatting, all reviewed by me. **Reused:** browser Web Speech API only; no third-party libraries.

## Additional files

None. Everything is in this repository.
