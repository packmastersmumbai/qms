# QR QMS Project — Chokepoint Pilot, Measurement Rewrite (Plan v3.3)

**Saved:** 2026-05-27
**Status:** Hypothesis pilot — measurement design hardened, architecture unchanged from v3.2
**Supersedes:** [PLAN-V3-QR-QMS-PROJECT.md](PLAN-V3-QR-QMS-PROJECT.md), [PLAN-V3.1-QR-QMS-PROJECT.md](PLAN-V3.1-QR-QMS-PROJECT.md), [PLAN-V3.2-QR-QMS-PROJECT.md](PLAN-V3.2-QR-QMS-PROJECT.md)
**Why this exists:** v3.2 tribunal verdict = STOP 0.547 (soft). The 5 PILLAR/SUPPORT advantages confirmed the scope is right; the 17 issues clustered around measurement design, not architecture. v3.3 fixes the measurement only.

---

## What changed from v3.2

v3.2 had the right shape (200 LoC, 5 days, 4 chokepoints, behavior-hypothesis test). The tribunal flagged the **measurement design** — what we count, how we attribute failures, how long we test for, what counts as "out of scope" vs "pilot failed." v3.3 keeps the entire architecture and rewrites only:

1. **Validation document** — explicit hypothesis + invalidation criteria
2. **Bypass detection** — what counts as a missed scan vs an out-of-scope event
3. **Honest scope of the metric** — willingness vs habit (5 days vs 14 days)
4. **Compliance disaggregation** — per role × per shift, not aggregate
5. **Connectivity confound** — Wi-Fi dropouts measured separately, not bundled into "compliance"

Everything else from v3.2 (4 chokepoints, fixed verbs, 1 sheet, 1 page, 1 server fn, reused auth, no offline queue, no RBAC, no FIFO, no Action QRs) is unchanged.

---

## The Hypothesis (unchanged from v3.2)

> If every lot is scanned at the 4 physical chokepoints it MUST pass through (Gate-In, Gate-Out, 1st-Floor-In, 2nd-Floor-In), then for any lot we can answer "where is it now" in under 2 minutes within 5 working days — without changing how anyone moves material.

---

## Validation document (NEW — addresses v3.2 tribunal devil findings #1, #4, #5)

This is the entire 1-page validation doc that ships with the pilot. Operators don't see it; QMS owner + warehouse-in-charge sign off on it before Day 0.

### Hypothesis
Operators will scan at the 4 chokepoints when scanning is anchored to existing rituals (GRN paperwork, dispatch loading, lift-loading).

### Invalidation criteria (any ONE = hypothesis falsified)
1. **Willingness fail:** Per-chokepoint scan compliance < 60% on any 2 consecutive days, after Day 1's on-floor coaching
2. **Topology fail:** Locating accuracy < 50% on any single day (4-chokepoint topology is too coarse)
3. **Connectivity fail:** Wi-Fi-related scan failures > 30% of total attempts on any day (architecture wrong for this warehouse, not the operators' fault)

### Confirmation criteria (ALL THREE must hold)
1. **Compliance** ≥ 80% per chokepoint AND ≥ 70% in the **worst** (role × shift) cell — see disaggregation table below
2. **Locating accuracy** ≥ 80% (20 of 25 walk-to-floor verifications correct)
3. **Time-to-locate** < 2 min per trial, averaged

### Scope of what this test claims
- ✅ Tests **willingness** (will operators scan when prompted in their current workflow?)
- ❌ Does NOT test **habit formation** (will they keep scanning a month later when the novelty wears off?)
- ❌ Does NOT test **system reliability** (Wi-Fi, sticker durability, BYOD-camera variance — these are confounds, not what we're measuring)
- ❌ Does NOT prove **topology sufficiency** (4 chokepoints may catch most flows; bypass detection — below — quantifies what's missed)

If the willingness test passes, v3.4 is a **14-day habit test** with the same code. If habit holds, v3.5 adds the second-tier infra (offline queue, durability fix, RBAC).

---

## Bypass detection (NEW — addresses v3.2 tribunal devil finding #2: survivorship bias)

The biggest measurement gap in v3.2: the pilot measured scans that happened, not flows that should have happened. v3.3 closes it with three external ground-truth sources:

| Chokepoint | Ground truth source | What counts as "should have scanned" |
|---|---|---|
| Gate-In | GRN log (existing) | Every new GRN row created on a pilot day = one expected scan |
| Gate-Out | Dispatch log (existing) | Every dispatch row = one expected scan |
| 1st-Floor-In | IPQC sample request log per floor | First-time-on-floor for each lot on that day = one expected scan |
| 2nd-Floor-In | IPQC sample request log per floor | Same |

**Bypass rate per chokepoint** = (expected scans − actual scans) / expected scans.

- **Bypass < 20%** → chokepoint is enforceable; that part of v3.2 works
- **Bypass 20-50%** → operators are scanning *some* of the time; root-cause the gap (which roles? which shifts? Wi-Fi-correlated?)
- **Bypass > 50%** → chokepoint is unenforceable in current physical layout; consider physical redesign (turnstile, doorway redirect) or remove that chokepoint from scope

Bypass detection runs **automatically nightly** via a Code.js function comparing GRN/Dispatch/IPQC row counts against `SCAN_EVENTS` counts. No new UI; results go in a `PILOT_DAILY` sheet.

---

## Compliance disaggregation (NEW — addresses v3.2 tribunal devil finding #3)

Aggregate ≥80% can hide a failure mode where the morning shift scans diligently and the night shift scans 0%. v3.3 disaggregates:

```
Per chokepoint × per role × per shift:

                    Day shift    Night shift
                    -----------  -----------
Gate-In        |    GRN clerk
               |    Security
Gate-Out       |    Dispatch
1st-Floor-In   |    Floor-1 in-charge
               |    IPQC tech
2nd-Floor-In   |    Floor-2 in-charge
               |    IPQC tech
```

**Confirmation rule:** every populated cell ≥ 70%, every chokepoint average ≥ 80%. The "worst cell" check catches the morning-vs-night failure mode that an aggregate average would mask.

Computed nightly from `SCAN_EVENTS.userId × SCAN_EVENTS.locationId × hour(ts)`.

---

## Connectivity confound (NEW — addresses v3.2 tribunal domain_expert finding #1: SHOWSTOPPER)

The tribunal flagged "patchy Wi-Fi + no offline queue → pilot inconclusive." v3.3 doesn't add an offline queue (that's architecture). It adds **measurement**:

1. **Wi-Fi probe heartbeat** — Scan.html every 60s pings the GAS endpoint and logs latency. Failures appended to `WIFI_LOG` sheet (ts, locationId, latency_ms or "TIMEOUT").
2. **Failed-scan visibility** — when an operator hits "submit" and the request times out, the failure is visible in the UI ("Scan didn't reach server — try again when Wi-Fi returns") AND logged client-side in IndexedDB as a `SCAN_ATTEMPT_FAILED` row with timestamp + payload.
3. **Daily Wi-Fi breakdown** — `PILOT_DAILY` sheet shows: scans attempted, scans successful, scans failed due to Wi-Fi (heartbeat correlated within ±30s), scans missing entirely (bypass).

If Wi-Fi failures are >30% of attempts on any day → connectivity is the confound, not willingness. Pilot is **paused** while connectivity is addressed (move router, add repeater, change carrier). Restart Day 1 fresh when Wi-Fi-failure rate is <10%.

This costs ~30 LoC client-side + 1 Apps Script function. Total v3.3 LoC budget: ~250 (vs v3.2's ~200).

---

## Honest framing — willingness vs habit (NEW — addresses v3.2 tribunal devil finding #6: Hawthorne effect)

v3.2 conflated these. v3.3 separates them explicitly:

| Test | What it answers | Duration | When to run |
|---|---|---|---|
| **v3.3 (this pilot)** | Will operators scan when asked, in their current workflow? | **5 days** | Now |
| **v3.4** (future) | Will they keep scanning after on-floor coaching ends and routine sets in? | **14 days, no coaching after Day 2** | If v3.3 passes |
| **v3.5** (future) | Will the system scale (RBAC, durability, offline) when scope expands? | **30 days, 2+ zones** | If v3.4 passes |

The 5-day pilot is **explicitly a willingness test**, not a habit test. Tribunal Hawthorne concern is correct but **out of scope by design** — we accept that 5 days is too short for habit decay and ship the 14-day v3.4 afterward to test it.

If you're not OK shipping a willingness test first, jump to v3.4 directly — adds 9 calendar days to first signal.

---

## Architecture (unchanged from v3.2 — restated for completeness)

| Thing | What it is |
|---|---|
| **4 Location stickers** | `LOC\|GATE-IN`, `LOC\|GATE-OUT`, `LOC\|FLOOR-1-IN`, `LOC\|FLOOR-2-IN`. Thermal-printed if available; otherwise A4 inkjet inside acrylic holder. |
| **Verbs fixed by location** | Each chokepoint sticker carries one verb (`RECEIVE` / `SHIP` / `UP-1` / `UP-2`). Operator never picks. |
| **1 sheet** | `SCAN_EVENTS`: `ts, userId, locationId, verb, lotId, qty`. 6 cols. |
| **2 telemetry sheets (NEW)** | `WIFI_LOG`: heartbeat probe results. `PILOT_DAILY`: nightly bypass + compliance disaggregation. |
| **1 page** | `Scan.html` — camera + manual entry + last-5-scans + failed-scan banner + Wi-Fi-status indicator. |
| **2 server functions** | `recordScan(locationId, lotId, qty)` (same as v3.2) + `computeDailyPilotStats()` (nightly trigger; writes to `PILOT_DAILY`). |
| **1 derived query** | `whereIsLot(lotId)` (same as v3.2). |
| **Authn** | Reuses PM QMS `getCurrentUser()`. No RBAC. |
| **STOCK_LEDGER** | Untouched. |

Total ~250 LoC (vs v3.2's ~200 — the extra is Wi-Fi heartbeat client + nightly stats function).

---

## What v3.3 still does NOT ship (explicit deferrals)

Carried forward from v3.2 — none of these matter until willingness is proven:
- ❌ Offline-first queue (the confound is **measured** in v3.3, not solved)
- ❌ RBAC (any authenticated QMS user can scan)
- ❌ Hash-chain audit / signed events
- ❌ FIFO enforcement / `grnDate`
- ❌ Action QRs / Product QRs / smart suggestions
- ❌ Bootstrap stocktake (still out of scope)
- ❌ ISO validation doc (pilot is a test, not a system change)

---

## Pre-flight (NOT gates — half a day)

| Item | Owner | Acceptance |
|---|---|---|
| 4 chokepoint stickers printed + mounted | Ops | Photos; all readable from 30 cm |
| Validation doc above signed off | QMS owner + warehouse-in-charge | Initialled hardcopy filed |
| `WIFI_LOG` + `PILOT_DAILY` sheets created | Dev | Schemas confirmed |
| Nightly trigger for `computeDailyPilotStats` installed | Dev | Test fire at 22:00 Day 0 |
| Security/GRN/Dispatch/Floor-1/Floor-2 clerks briefed (30 min each) | Dev | Each does 3 successful scans |
| Warehouse-in-charge briefed on Day-1 morning coaching duty | Dev | Walkthrough rehearsal |

Total briefing: 2.5h. Total sticker cost: ~₹500. Total dev: ~250 LoC.

---

## Timeline

| Day | Activity |
|---|---|
| **Mon Day 0** | Stickers up, code deployed, all clerks briefed, validation doc signed |
| **Tue Day 1 AM** | Warehouse-in-charge stands at Gate-In + Gate-Out 2 hrs, coaches first 10 scans. Spot-check 1st/2nd floor at lunch. |
| **Tue–Sat Day 1-5** | Operators scan. Nightly `computeDailyPilotStats` produces per-role × per-shift × per-chokepoint compliance + bypass rate + Wi-Fi-failure rate. |
| **Each evening Day 2-4** | Warehouse-in-charge reviews PILOT_DAILY sheet. If any invalidation criterion fires → pause + decide. |
| **Sat evening Day 5** | Read all 5 days. Apply confirmation/invalidation criteria. Verdict + write v3.4 plan or v3.3-retrospective. |

---

## Risks (v3.2 risks + new measurement-specific ones)

| Risk | Mitigation |
|---|---|
| Wi-Fi heartbeat itself loads the network and creates the failures we're measuring | Heartbeat is 60s interval, single GET, <1 KB. Negligible vs scan traffic. If concerned, double interval to 120s. |
| Operators see the Wi-Fi-status indicator and game it (e.g., wait for "green" before scanning, which inflates compliance) | The indicator is informational. The metric `bypass detection` (compared against GRN log) catches gaming because no scan-at-all is still a bypass regardless of Wi-Fi state. |
| Nightly stats trigger fails silently | Manual `computeDailyPilotStats` button on admin panel; warehouse-in-charge runs by hand if 22:00 row missing. |
| Per-cell disaggregation has 1 or 2 scans in some cells (statistical noise) | Cells with <5 expected scans across the week → marked "insufficient data," not "failed." |
| Validation doc signs are seen as ceremony, ignored | Doc is 1 page; signoff is part of the pre-flight checklist not a separate process. |

---

## What this resolves from the v3.2 tribunal

| v3.2 finding | Severity | v3.3 fix |
|---|---|---|
| Patchy Wi-Fi + no offline queue → pilot inconclusive | SHOWSTOPPER | Wi-Fi heartbeat + per-day failure rate + auto-pause if >30% (measures the confound) |
| "Reuses existing PM QMS auth" unverified | SHOWSTOPPER | Out of scope — auth IS verified for existing IQC/IPQC/OQC modules; this is a black-box reuse not a new claim. **However:** ship a 1-line manual test on Day 0: log in fresh, call `recordScan` from devtools, confirm auth check rejects unauth call. |
| 4 chokepoints insufficient / survivorship bias | CRITICAL | Bypass detection against GRN/Dispatch/IPQC ground-truth (3 of 4 chokepoints) |
| Aggregate ≥80% masks per-role failures | CRITICAL | Disaggregation table; worst-cell ≥ 70% required |
| 5 days too short for habit | CRITICAL | Explicit "willingness test" framing; v3.4 is the 14-day habit test |
| QR durability / BYOD camera variance | CRITICAL | 5-day window already addresses durability. BYOD variance is captured in scan-failure logs (if some operators consistently fail to scan, we'll see it in disaggregation) |
| Session timeout vs scan cadence | CRITICAL | Manual Day-0 test: 30-min idle session, attempt scan, confirm whether re-login is needed. If yes → either extend session OR document the friction; not a blocker for the pilot. |
| Input validation in `recordScan` unverified | CRITICAL | Server-side regex on `locationId` matches one of 4 known values; reject otherwise + log. This is 4 lines of Apps Script. |
| 2 chokepoints would suffice | CRITICAL (simplicity reframe) | Accepted as v3.3-alt option. Default stays at 4 because bypass detection only works at chokepoints that have a ground-truth source. 2 chokepoints would lose Floor-2-In coverage. |
| No validation doc | CRITICAL | The 1-page doc above |

**Steelman impotence signal:** the tribunal noted no critic was moved by the steelman defenses. v3.3 honors that by **not arguing** with the criticisms — every CRITICAL is either fixed or explicitly scoped-out with reasoning.

---

## What happens after Day 5

| Outcome | Next action |
|---|---|
| All confirmation criteria pass | Write `PLAN-V3.4` — same 4 chokepoints, 14 days, no Day-1 coaching after Day 2 (habit test). |
| Willingness invalidation triggered | Document why operators didn't scan (role? shift? mechanic?). Archive. Pain remains real; QR not the answer. |
| Topology invalidation triggered (locating <50%) | Either add `DOWN-1` / `DOWN-2` chokepoints (v3.4-alt) or admit floor-level granularity insufficient. |
| Connectivity invalidation triggered (>30% Wi-Fi fails) | Pause. Address Wi-Fi (router move, repeater, carrier). Restart Day 1 fresh. **Do not interpret v3.3 results in this state.** |
| Mixed (some chokepoints pass, others fail) | Bypass-detection table tells us which chokepoints are enforceable. Ship those, drop the others, run v3.4 with the reduced set. |

---

## TL;DR

- Same architecture as v3.2 (4 chokepoints, fixed verbs, 1 sheet, 1 page, reused auth)
- **Measurement design rewritten** based on v3.2 tribunal's 17 findings: validation doc, bypass detection, per-cell disaggregation, Wi-Fi confound measurement, willingness-vs-habit honest framing
- 5 days, **3 confirmation criteria + 3 invalidation criteria** (explicit, signed off in advance)
- Bypass detection cross-checks `SCAN_EVENTS` against GRN/Dispatch/IPQC ground truth → catches survivorship bias
- Wi-Fi heartbeat separates connectivity confound from operator-willingness signal
- "Willingness test" is the explicit claim — habit test is v3.4 (separate, planned)
- ~250 LoC, 1 calendar week, 2.5h briefing
- Steelman impotence signal honored: every CRITICAL finding addressed or scoped-out with reasoning

**The phrase to remember:** *measure what you claim, claim only what you measure.* v3.2 was right in shape, wrong in attribution — when something failed we couldn't tell why. v3.3 instruments the answer.
