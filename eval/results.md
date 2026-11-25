# Evaluation results

12 scripted scenarios (8 where the tool comes back, 4 where it is really gone). Fixed random seed per scenario, so every run repeats exactly.

**Recovery time** = seconds from losing the tool until it is tracked again for at least 1 s, or the surgeon has control. Runs that never recover count the remaining scenario time.

> These scenarios were designed to test specific situations, including two placed either side of when the policy hands over (S11, S12). The counts show how each policy behaves in those situations; they are not real-world error rates.

## Study 1: three policies, no surgeon input

| Policy | Mean recovery (s) | Tool comes back | Tool really gone | False handovers | Missed handovers |
| --- | --- | --- | --- | --- | --- |
| Confidence-aware (ours) | 4.4 | 3.1 | 7.2 | 1 / 8 | 0 / 4 |
| Fixed 10 s timeout | 6.1 | 4.2 | 10.0 | 0 / 8 | 0 / 4 |
| No recovery | 7.9 | 4.2 | 15.3 | 0 / 8 | 4 / 4 |

**Per scenario** (recovery time in s; H = handed over)

| Scenario | Should hand over | Confidence-aware (ours) | Fixed 10 s timeout | No recovery |
| --- | --- | --- | --- | --- |
| S1 Brief occlusion (0.5 s) | no | 0.73 | 0.73 | 0.73 |
| S2 Occlusion (1.5 s) | no | 1.73 | 1.73 | 1.73 |
| S3 Partial occlusion flicker | no | 2.9 | 2.9 | 2.9 |
| S4 Tool leaves view (6 s) | no | 1.53 | 6.63 | 6.63 |
| S5 Tool leaves view (4 s, right) | no | 1.7 | 4.6 | 4.6 |
| S6 Instrument exchange (2.5 s) | no | 2.73 | 2.73 | 2.73 |
| S7 Tool withdrawn | yes | 7.07 H | 10 H | 16.8 (missed) |
| S8 Withdrawn for 12 s | yes | 7.07 H | 10 H | 12.27 (missed) |
| S9 Smoke obscures view | yes | 7.07 H | 10 H | 15.23 (missed) |
| S10 Leaves view, then withdrawn | yes | 7.47 H | 10 H | 16.77 (missed) |
| S11 Occlusion (6 s) | no | 6.23 | 6.23 | 6.23 |
| S12 Occlusion (8 s) | no | 7.07 H (false) | 8.23 | 8.23 |

## Study 2: surgeon veto

A simulated surgeon watches the countdown. One second after a handover is proposed, they press "keep searching" only if the tool is really still there.

| Condition | Mean recovery (s) | False handovers | Missed handovers | Vetoes used |
| --- | --- | --- | --- | --- |
| Ours, no surgeon input | 4.4 | 1 / 8 | 0 / 4 | 0 |
| Ours, surgeon can veto | 4.5 | 0 / 8 | 0 / 4 | 2 |

Vetoes happened in: S11, S12.

## Study 3: handover style (cautious, balanced, eager)

| Style | Retreat after | Search in wide view | Countdown | Mean recovery (s) | Tool really gone (s) | False handovers | Missed handovers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cautious | 1.5 s | 5 s | 4 s | 5.7 | 10.5 | 0 / 8 | 0 / 4 |
| Balanced | 1 s | 3 s | 3 s | 4.4 | 7.2 | 1 / 8 | 0 / 4 |
| Eager | 0.7 s | 1.5 s | 2 s | 3.1 | 4.5 | 2 / 8 | 0 / 4 |

Eager hands over sooner when the tool is really gone, but gives up on more tools that were only hidden. Cautious is the reverse. See `tradeoff.svg`.

## Study 1b: tracking again versus handing over

Recovery time above counts either ending. Here they are separated: **time to tracking** (tracked again for 1 s) and **time to handover** (surgeon has control), each averaged only over the runs where it happened.

| Policy | Runs that tracked again | Mean time to tracking (s) | Runs that handed over | Mean time to handover (s) |
| --- | --- | --- | --- | --- |
| Confidence-aware (ours) | 7 / 12 | 2.5 | 5 / 12 | 7.1 |
| Fixed 10 s timeout | 8 / 12 | 4.2 | 4 / 12 | 10.0 |
| No recovery | 10 / 12 | 6.1 | 0 / 12 | - |

Early handover shortens "recovery" without the tool being found, so read this table together with the false and missed handover counts.

## Study 4: how long can the tool be hidden? (occlusion-length sweep)

Tissue covers the tool for 1 to 15 s and then clears, so the tool is always still there and every handover is a false handover. Each cell shows what happened: **T x** = tracked again after x s from the start of the loss; **H x** = handed over to the surgeon after x s (false handover).

| Hidden for (s) | Ours (cautious) | Ours (balanced) | Ours (eager) | Fixed 10 s timeout |
| --- | --- | --- | --- | --- |
| 1 | T 1.2 | T 1.2 | T 1.2 | T 1.2 |
| 2 | T 2.2 | T 2.2 | T 2.2 | T 2.2 |
| 3 | T 3.2 | T 3.2 | T 3.2 | T 3.2 |
| 4 | T 4.2 | T 4.2 | H 4.1 | T 4.2 |
| 5 | T 5.2 | T 5.2 | H 4.1 | T 5.2 |
| 6 | T 6.2 | T 6.2 | H 4.1 | T 6.2 |
| 7 | T 7.2 | H 7.0 | H 4.1 | T 7.2 |
| 8 | T 8.2 | H 7.0 | H 4.1 | T 8.2 |
| 9 | T 9.2 | H 7.0 | H 4.1 | T 9.2 |
| 10 | T 10.2 | H 7.0 | H 4.1 | T 10.2 |
| 11 | H 10.5 | H 7.0 | H 4.1 | H 10.0 |
| 12 | H 10.5 | H 7.0 | H 4.1 | H 10.0 |
| 13 | H 10.5 | H 7.0 | H 4.1 | H 10.0 |
| 14 | H 10.5 | H 7.0 | H 4.1 | H 10.0 |
| 15 | H 10.5 | H 7.0 | H 4.1 | H 10.0 |

Shortest hiding time that makes each variant hand over: Ours (cautious) 11 s; Ours (balanced) 7 s; Ours (eager) 4 s; Fixed 10 s timeout 11 s.
This sweep uses one occlusion shape and one position, so it shows where each policy gives up, not how often that happens in surgery.
