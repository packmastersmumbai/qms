# DESIGN-QMSV2-STITCH.md — Stitch cockpit mockups (QMS v2)

**Source:** Google Stitch, project `PM QMS v2` (`10290620691745788406`), design-system asset `f1c072ac30ee4901b96547757f18a349`. Captured 2026-06-26.
**Status:** 12 mockups (6 screens × mobile+desktop), **re-skinned to the Pack Masters brand**.
**Pairs with:** [PLAN-QMSV2.md](PLAN-QMSV2.md) (logic) · [DESIGN.md](DESIGN.md) (the **authoritative**, GAS-tuned brand system).

> ✅ **RESOLVED.** Stitch initially invented its own "Industrial Blue" theme. It has been **re-skinned to the real Pack Masters brand** ([DESIGN.md](DESIGN.md)): navy `#0D1B6E`, electric-blue `#0070F3`, Plus Jakarta Sans / Inter / JetBrains Mono, 44px targets, 430px phone-first column — all GAS-critical rules pushed into the Stitch design system and applied to all 12 screens. **`DESIGN.md` is the authority for the build; this file is the mockup index + Stitch token mirror.** When building `QMSV2_F.html`, follow `DESIGN.md`. The section below preserves Stitch's *original* tokens for reference only — superseded by the Pack Masters re-skin.

---

## Stitch theme tokens (as generated)

**Name:** Industrial Quality Management System · **Mode:** light · **Seed/primary:** `#1b3a57`

**Colors:** primary `#002440` · primary-container/buttons `#1b3a57` · secondary `#505f76` · error `#ba1a1a` · critical/red `#DC2626` · background `#faf9fc` (spec `#F8FAFC`) · card `#ffffff` · text `#1a1c1e` · secondary text `#43474d` · border `#c3c7ce`.
**Status:** Urgent/Overdue red `#DC2626` · Warning amber · Success emerald.

**Type — Inter throughout:** display-lg 32/700/-0.02em · display-lg-mobile 24/700 · headline-md 20/600 · body-lg 16/400 · body-sm 14/400 · label-caps 12/700/0.05em · interactive-label 16/500.

**Spacing:** base 8px · **touch-target-min 48px** · gutter 16px · margin mobile 16 / desktop 32 · pipeline-gap 4px.

**Shape:** ROUND_FOUR (4px / 0.25rem); pills full-round; **treemap/floor tiles sharp 0px**.

**Elevation:** L0 `#F8FAFC` · L1 white + 1px border · L2 10% shadow · 2–4px status edge strips.

---

## Component specs (Stitch)
- **Buttons:** primary solid `#1B3A57` white 48px · secondary outline slate · critical solid `#DC2626`.
- **Kanban card:** 4px left-border status accent (red/amber/green) + title + `body-sm` timestamp.
- **Pipeline tracker:** 6-stage full-width chevrons; completed=blue, active=bold outline+blue, future=light slate; collapse to icons/numbers on mobile.
- **Multi-select bar:** sticky bottom, large icons+labels for bulk ops.
- **Maps/treemaps:** high-saturation legend; floor-plan heat-zone overlays; tap→L2 tooltip.

---

## Screen inventory (all 12 exist in Stitch)
Home Kanban · Pipeline Detail · Action Picker · Action Form (Move Stock) · Stock Map (treemap+floor plan) · Multi-Select — each **mobile + desktop**. HTML per screen retrievable via `list_screens` → `htmlCode` download URLs.

## Review gaps
- Pipeline rendered as unlabeled "Stage 4/8" bar — should be labeled 6-stage tracker.
- Doc-type tabs missing on mobile home (grouped by status instead).
- Branding shows "PM QMS"/"FactoryOS" variably → standardize.
- Not generated: rack/location view, multi-item putaway checklist (one more pass); Tier-2 rich forms reuse existing app.
