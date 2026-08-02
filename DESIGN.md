<!--
========================================================================
DESIGN AUTHORITY (updated 2026-06-27) — READ FIRST
========================================================================
The SINGLE source of truth for QMS v2 cockpit styling is the Stitch
design-system "Industrial Quality Management System":
  asset  assets/f1c072ac30ee4901b96547757f18a349
  project 10290620691745788406
Build screens VERBATIM to that design-system's design-md. Reconciled
deltas vs the legacy tokens below (Stitch wins on every conflict):
  - primary            #000747   (was #0D1B6E)
  - primary-container  #0d1b6e   (the navy used on top bar / buttons / pipeline-done)
  - secondary / link   #0070f3
  - surfaces           Material tiers: surface-container-lowest #ffffff,
                       -low #f0f3ff, #e7eefe, -high #e2e8f8, -highest #dce2f3
                       on background #f9f9ff
  - fonts              Plus Jakarta Sans (display/headline), Inter (body),
                       Public Sans (labels/interactive), mono for numbers/ids
  - DESKTOP IS SUPPORTED: 12-col grid + left side-nav (NOT 430px-only).
  - Elevation: Level-1 flat cards (1px outline), Level-2 ambient shadow on
    hover/drag/modals. Status = 2–4px color strip on card edge.
  - 48px min touch target (gloved use). Pipeline: navy=done, electric-blue=active.
Per-screen specs live in qmsv2-mockups/*.design.md (each cites its Stitch screen).
The YAML + prose BELOW is the legacy PackMasters-QMS spec, kept for the
component patterns (Form Field, Toggle Row, Disposition Grid, Submit) — but
where it says "#0D1B6E primary", "430px mobile-only", or "no shadows", the
Stitch authority above overrides it.
========================================================================
-->
---
version: alpha
name: PackMasters-QMS
description: A factory-floor Quality Management System used on Android phones by operators, inspectors, and managers. The surface is white-and-near-black with a single Pack Masters navy anchor (#0D1B6E) and an electric blue link/CTA (#0070F3) inspired by Vercel's developer-platform aesthetic. Type is Inter for body / Plus Jakarta Sans for display / JetBrains Mono for tabular numbers and document IDs. Density is intentionally high — operators scan a dozen pending records per shift on a 6-inch screen. Color is reserved for signal states (pass-green, fail-red, hold-amber); decorative color is forbidden. Touch targets are 48px minimum (gloved operation). Forms are vertical and one-column on phones, two-column above 768px, with no nested cards.

colors:
  primary: "#0D1B6E"
  on-primary: "#FFFFFF"
  primary-hover: "#1A2D9E"
  primary-pressed: "#0A1450"
  primary-soft: "#EEF1FA"

  link: "#0070F3"
  link-hover: "#0761D1"
  link-soft: "#D3E5FF"

  ink: "#0F172A"
  ink-secondary: "#1A1A2E"
  body: "#374151"
  muted: "#6B7280"
  faint: "#94A3B8"

  canvas: "#F5F7FA"
  canvas-soft: "#FAFBFC"
  surface: "#FFFFFF"

  hairline: "#E5E7EB"
  hairline-strong: "#CBD5E1"
  rule: "#EEF1F5"

  pass: "#16A34A"
  pass-soft: "#DCFCE7"
  pass-deep: "#15803D"
  fail: "#DC2626"
  fail-soft: "#FEE2E2"
  fail-deep: "#B91C1C"
  hold: "#D97706"
  hold-soft: "#FEF3C7"
  hold-deep: "#B45309"
  warn: "#F97316"
  warn-soft: "#FFEDD5"
  warn-deep: "#9A3412"
  prog: "#2563EB"
  prog-soft: "#DBEAFE"
  prog-deep: "#1E40AF"

  whatsapp: "#25D366"

typography:
  display-xl:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.4px
  display-lg:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.2px
  display-md:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0px
  section-label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 1.4px
  body-md:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.45
  body-xs:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.4
  input:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.4
  button:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0.2px
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: 12px
    fontWeight: 600
    letterSpacing: -0.2px

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  pill: 999px

spacing:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  xxl: 20px
  xxxl: 28px

components:
  app-shell:
    backgroundColor: "{colors.canvas}"
    padding: "0"

  top-bar:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    height: 48px
    padding: "8px"

  bottom-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    height: 52px

  section-label:
    typography: "{typography.section-label}"
    textColor: "{colors.muted}"

  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px"
    height: 76px

  tile-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.lg}"
    padding: "12px"
    height: 96px

  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px"

  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.input}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: "8px"

  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"

  field-label:
    typography: "{typography.body-sm}"
    textColor: "{colors.muted}"

  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: 48px
    padding: "12px"

  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"

  button-primary-pressed:
    backgroundColor: "{colors.primary-pressed}"
    textColor: "{colors.on-primary}"

  button-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.link}"
    typography: "{typography.button}"

  badge-pass:
    backgroundColor: "{colors.pass-soft}"
    textColor: "{colors.pass-deep}"
    rounded: "{rounded.pill}"
    padding: "4px"

  badge-fail:
    backgroundColor: "{colors.fail-soft}"
    textColor: "{colors.fail-deep}"
    rounded: "{rounded.pill}"
    padding: "4px"

  badge-hold:
    backgroundColor: "{colors.hold-soft}"
    textColor: "{colors.hold-deep}"
    rounded: "{rounded.pill}"
    padding: "4px"

  toggle-pass:
    backgroundColor: "{colors.pass-soft}"
    textColor: "{colors.pass-deep}"
    rounded: "{rounded.md}"
    height: 44px

  toggle-fail:
    backgroundColor: "{colors.fail-soft}"
    textColor: "{colors.fail-deep}"
    rounded: "{rounded.md}"
    height: 44px
---

## Overview

Pack Masters QMS is a phone-first application used on the factory floor in Mumbai. It records every quality event (Goods Receipt, Incoming QC, In-Process QC, Outgoing QC, Production, Dispatch, Non-Conformance, Customer Return) and is read in three contexts:

1. **By operators standing at a workstation** — one hand on a phone, one on a sample. They open a form, tap PASS/FAIL on 8–15 parameters, and submit. Every extra pixel of chrome is a distraction. Forms must fit one column, scroll only when necessary, and submit with a single thumb.
2. **By inspectors auditing pending records** — they open Records, filter by module, and need to scan a dense list of doc-IDs and statuses without ambiguity. Tabular numbers (JetBrains Mono) make this possible.
3. **By the plant manager on a desktop** — opening the same URL, viewing KPIs. The layout is the same 430px column, centered. We do not redesign for desktop; the operator experience is canonical.

> **Which navy, where** (clarified 2026-08-02 — a brand-consistency audit found four
> navies in the tree and it was not obvious which were legitimate):
> `#0D1B6E` is the anchor on the **operator forms** — GRN, IQC, IPQC, OQC, Records,
> Trace, Gatepass. `#000747` is the Stitch `primary` and is scoped to the **QMS v2
> cockpit** (`QMSV2_F`) only; it is correct there and must not spread into the forms.
> `#1e3a5f` is a legacy header navy still on several forms — it is *drift*, not a
> decision, and should converge on `#0D1B6E`. `#0B2A4A` is used for master-sheet
> header fills, not UI.
> **Bundle warning:** `#0D1B6E` and `#0070F3` are NOT in the static `TailwindBundle`.
> They work in real CSS but a `bg-[#0D1B6E]` / `ring-[#0070F3]` utility resolves to
> nothing. This is exactly how the Records and Trace headers shipped transparent.

The brand anchor is **Pack Masters Navy `#0D1B6E`**. It appears on the top bar, the brand logo box, primary buttons, and printed documents (GRN, PO, Gatepass). It is *not* used decoratively elsewhere. The interactive accent for links and informational CTAs is **`#0070F3`** (Vercel-blue) — chosen because operators recognise underlined blue as "tap me" without training.

Color outside these two anchors is **reserved for signal**: green for PASS / accepted / released, red for FAIL / rejected, amber for HOLD / pending disposition, orange for warnings, blue for in-progress. There is no decorative gradient, no glass effect, no shadow art. The page reads like a clipboard, not a marketing site.

## Colors

- **`primary` (#0D1B6E)** — Pack Masters Navy. Top bar, primary buttons, logo box, primary tile background, dashed border on doc-number display. Appears on every screen. This is the brand.
- **`link` (#0070F3)** — Electric blue. Section "View all" links, secondary CTAs, focus rings on non-primary controls. Never a background color except for the soft variant on selected pills.
- **`canvas` (#F5F7FA)** — Page background. Cool gray so that white cards lift visibly.
- **`surface` (#FFFFFF)** — All cards, tiles, inputs, modals.
- **`pass` / `fail` / `hold` / `warn` / `prog`** — Signal colors only. Always paired as `*-soft` background + `*-deep` text, with the base hue as border or left-edge accent. Never used for decoration.
- **`ink` / `body` / `muted` / `faint`** — Four-tier text hierarchy. Body copy uses `ink`; field labels and metadata use `muted`; placeholder and disabled use `faint`.

## Typography

Three families, one role each:

- **Plus Jakarta Sans** — Display only. Page titles, section labels (uppercase + tracked), tile titles. Weights 700 only.
- **Inter** — All body, all input, all button text. Weights 400/500/600/700.
- **JetBrains Mono** — Tabular numerics: document IDs (`PM/GRN/0042`), KPI values, stat counts, timestamps in record lists. Never used for prose.

Mobile base size is **13px** — denser than a marketing site, looser than a Bloomberg terminal. Inputs are forced to **16px** to defeat iOS zoom-on-focus. Section labels are **10px / 1.4px tracking / uppercase** — they read as system chrome, not content.

## Layout

> **Amended 2026-08-02.** The 430px-only rule below described the original
> phone-only app. Desktop is now explicitly supported (see *Responsive Behavior*),
> and the shipped forms use a **960px** page width with a responsive multi-column
> grid above 768px. The mobile column remains canonical — desktop is an
> enhancement of it, not a redesign. Treat 430px as the *minimum* target, not the
> maximum. This section is kept for the density reasoning, which still holds.

The app is a **430px-wide centered column** on phones — the canonical operator
experience. The top bar (48px) and bottom nav (52px) are fixed; content scrolls
between them. Inner content uses **10–12px gutter**, never more.

Density rules:

- Form fields stack vertically on phones. **On desktop (≥768px, `pointer:fine`)
  they may sit two-up**: the density layer caps each control to its content width,
  so a 2-column grid does not reintroduce the horizontal-scroll failure. Below
  768px the single column is still mandatory — side-by-side fields fail on a 360px
  screen and force horizontal scrolling, which gloved operators cannot do reliably.
- Cards have **no internal cards**. A pending record is a row, not a card-in-a-card.
- The landing page uses a **3-column tile grid** for module entry. Tiles are 76px tall — large enough for a thumb, small enough that all modules fit above the fold.
- Lists use a **left-edge color bar** (3px) for status, not a full-card background tint. Tinted backgrounds make a long list look like an alert wall.

## Elevation & Depth

There is one shadow: `shadow-1 = 0 1px 4px rgba(13,27,110,0.08), 0 2px 8px rgba(13,27,110,0.06)`. It lifts cards from the canvas. There is no `shadow-2`, no hover-lift, no z-stack beyond the fixed top bar (z:50), bottom nav (z:50), modal sheets (z:9990), toast (z:9998), and the GAS banner cover (z:max).

## Shapes

- `rounded.sm` (6px) — Inputs, badges, small pills.
- `rounded.md` (8px) — Buttons, toggles, modal close.
- `rounded.lg` (10px) — Cards, tiles, sections.
- `rounded.pill` (999px) — Status badges, shift pill.

No fully sharp corners. No fully circular elements except the loader spinner.

## Components

### Tile (Landing)

Compact entry point to a module. 76px tall, white surface, navy icon, navy title, muted subtitle, optional mono pending-count pill on the right edge. The primary tile (the operator's most-likely next action — typically the active production run) inverts to navy background, white text, 96px tall, and may span 2 columns.

### Form Field

Label (12px muted) → input (40px tall, 16px text, 6px radius, 1.5px hairline border, navy focus border). Hint text 10px muted directly below. Required indicator is a navy dot, not a red asterisk — red is reserved for FAIL.

### Toggle Row (PASS / FAIL / N/A)

Three equal buttons, 44px tall, hairline border by default. Selected state fills with the soft color and switches border + text to the deep color. FAIL adds a 300ms shake animation — the only motion in the form.

### Disposition Grid (Accept / Reject / Hold / Await-MRB)

Four buttons in a 2×2 grid, 52px tall, 10px radius. Selected state matches the toggle pattern (soft fill, deep text).

### Submit Button

Full-width, 48px tall, navy fill, white text, no shadow. Hover lightens to navy-hover, press darkens to navy-pressed. Disabled is muted gray. Below the submit, an optional 44px green WhatsApp button (`#25D366`) for share-on-submit flows.

## Do's and Don'ts

✅ **Do** use mono font for any number a human will compare to another number (counts, IDs, timestamps, KPI values).
✅ **Do** keep the mobile column canonical. Operators view this on phones; the desktop layout (960px, 2-col above 768px) must be recognisably the *same screen* they see when standing next to an operator — same order, same labels, same grammar. Widen the layout, never reorder it.
✅ **Do** reserve color for signal — pass/fail/hold/warn/prog. Decorative color erodes signal value.
✅ **Do** use the left-edge color bar pattern for status in long lists.

❌ **Don't** introduce a third font family. Three is already two too many for some readers; do not add a fourth.
❌ **Don't** use shadows beyond `shadow-1`. No glow, no inner shadow, no glassmorphism.
❌ **Don't** put two form fields side-by-side **below 768px**. One column on phones, always. Above 768px a 2-column grid is permitted (and used) because the desktop density layer caps field widths to their content.
❌ **Don't** use red for anything except FAIL or REJECTED. Required-field indicators, error helper text, and destructive button confirmations all use navy or muted gray, not red.
❌ **Don't** use the amber `#E8A020` color from older mockups — it has been retired. The brand is navy + electric blue only.

## Responsive Behavior

The app is mobile-first. On phones it is a single column; the page width caps at
**960px** on larger screens and centers, with canvas gray either side.

**Desktop is supported.** Above 768px forms use a 2-column grid; above 900px with
`pointer:fine` a density layer drops control height 48px → 36px and caps each field
to its content width, so a mouse user is not scanning 700px-wide inputs. This layer
is gated on `pointer:fine` so it never fires on a touch device, whatever the width.

Touch targets are **48px minimum** — not the 44px Apple HIG figure — because
operators wear cotton gloves during the monsoon. The disposition grid uses 52px.
The desktop density layer is the only place targets shrink below 48px, and only
when a fine pointer is confirmed present.
