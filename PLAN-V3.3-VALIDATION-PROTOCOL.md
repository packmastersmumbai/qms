# QR-V33 Validation Protocol — Chokepoint Pilot

**Saved:** 2026-05-27
**Status:** Pre-flight artifact for PLAN-V3.3
**Source:** Extracted from [PLAN-V3.3-QR-QMS-PROJECT.md](../PLAN-V3.3-QR-QMS-PROJECT.md) §"Validation document"
**Sign before:** Day 0 of pilot

---

## Hypothesis

Operators will scan at the 4 chokepoints (Gate-In, Gate-Out, 1st-Floor-In, 2nd-Floor-In) when scanning is anchored to existing rituals (GRN paperwork, dispatch loading, lift-loading).

---

## Invalidation criteria — ANY ONE = hypothesis falsified

1. **Willingness fail:** Per-chokepoint scan compliance < 60% on any 2 consecutive days, after Day 1's on-floor coaching.
2. **Topology fail:** Locating accuracy < 50% on any single day (4-chokepoint topology is too coarse).
3. **Connectivity fail:** Wi-Fi-related scan failures > 30% of total attempts on any day (architecture wrong for this warehouse, not operators' fault).

---

## Confirmation criteria — ALL THREE must hold

1. **Compliance** ≥ 80% per chokepoint AND ≥ 70% in the worst (role × shift) cell.
2. **Locating accuracy** ≥ 80% (20 of 25 walk-to-floor verifications correct).
3. **Time-to-locate** < 2 min per trial, averaged.

---

## What this test claims

- ✅ Tests **willingness** — will operators scan when prompted in their current workflow?
- ❌ Does NOT test **habit formation** — that is v3.4 (14-day test).
- ❌ Does NOT test **system reliability** — Wi-Fi, sticker durability, BYOD camera variance are confounds, not what we are measuring.
- ❌ Does NOT prove **topology sufficiency** — bypass detection quantifies what 4 chokepoints miss.

---

## Sign-off

By signing below, we confirm we have read the hypothesis, the 3 invalidation criteria, the 3 confirmation criteria, and the scope claims above. We accept that the pilot will be paused or declared failed if any invalidation criterion fires, and that v3.4 (habit test) is a separate, follow-on decision.

| Role | Name | Signature | Date |
|---|---|---|---|
| QMS Owner | ___________________ | ___________________ | _____ / _____ / 2026 |
| Warehouse-in-Charge | ___________________ | ___________________ | _____ / _____ / 2026 |

---

**File location after sign-off:** scan signed copy to `docs/QR-V33-VALIDATION-PROTOCOL-SIGNED.pdf` and archive hardcopy with QMS records.
