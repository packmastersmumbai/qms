# PM QMS — Form layout, styling and density guidelines

Authority order: **Stitch design system → DESIGN.md → FormKit.html → this file.**
This file is the *how* for forms specifically. Where it conflicts with DESIGN.md,
DESIGN.md wins.

Written 2026-08-11 after the GRN form was reworked four times for the same
complaints — wide inputs, one field per row, errors nobody could see. Each round
fixed the symptom in a per-form `<style>` block. The cause was structural, and
the rules below name it.

---

## 0. The three defects that caused every repeat

Check these first when a form "looks wrong again". All three were real, all three
were invisible from reading the CSS.

### 0.1 Inline `style=` beats every stylesheet

`addExtraItem()` in `GRN_F.html` built each row with `innerHTML` and a
`style="…width:100%…"` attribute on every control. No CSS layer — not FormKit,
not the form's own block, not `!important` on a class — can override an inline
style. Four rounds of layout work could not reach those rows.

**Rule: never put a `style=` attribute on a form control.** If a class does not
exist for what you need, add the class. There were **155 inline `style=`
attributes across the five write forms** when this was written; every one is a
place where a future layout fix will silently fail.

### 0.2 Source order decides ties, and FormKit loads late

`GRN_F.html` has a `<style>` block in `<head>` at line ~10, and
`<?!= include('FormKit') ?>` at line ~271. `.fk-card` in FormKit and `.fk-card`
in that early block have **equal specificity**, so FormKit wins on source order.
A compact layer written in the early block changed nothing — computed `gap`
stayed `16px`.

**Rule: per-form overrides of any `.fk-*` class go in a `<style>` block placed
AFTER the FormKit include.** Verify by reading the computed value, never by
reading the rule.

### 0.3 The density layer is desktop-gated

FormKit's entire density layer — including `.fk-w-num`, `.fk-w-code`,
`.fk-w-date`, `.fk-w-short`, `.fk-w-mid` — lives inside:

```css
@media (min-width: 900px) and (pointer: fine) { … }
```

A phone or tablet receives **none** of it, so every control falls back to
`max-width:100%` and stretches. Measured on a 390px viewport: three fields at
340px (87% of the screen) each, and a quantity of `7` given the same width as a
supplier name.

**Rule: a width utility used on a form must be available at the width it is
needed.** Restate it for touch in the form's late `<style>` block, or move it out
of the desktop gate in FormKit.

---

## 1. Layout

### 1.1 One logical record per card

Material code, batch, expiry, quantity and storage are **one receipt line** — the
operator reads them as a single fact off the delivery. They belong in one card.

Splitting them cost a border, padding, a section label and a gap (142px measured)
to communicate nothing the grouping did not already carry.

- A card is a **record or a step**, never a field.
- **Never nest cards.** The one exception on these forms is a repeated record
  inside a section (`.xi-card`), which needs an edge to separate instances — and
  it is a flat 1px inset, not a second elevation.
- One switch does not get a card. A bordered, shadowed 54px section for one
  optional toggle is the heaviest container for the lightest control; use a bare
  `.fk-switch-row` (~32px).

### 1.2 Fields FILL the row — they do not pack

Two failure modes, and fixing one causes the other if you are not measuring:

| Symptom | Cause | Fix |
|---|---|---|
| Fields stretch full width | no width cap, or the cap is desktop-gated | grid tracks + per-field caps |
| Half the row is white | fields capped, packed left | `minmax(0, 1fr)` tracks |

Measured at 960px before the grid: the material card used **47% of its width** and
stood 335px tall. After: **98%** and 252px.

- Use `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))`.
  `minmax(0,1fr)` is what makes tracks share the space; `auto` and `max-content`
  pack left and leave the hole.
- **Lift per-field max-widths inside a sized grid.** With tracks doing the work,
  the caps re-introduce the gaps the grid exists to remove.
- Give the longest control more tracks (`span-2`), not the whole row. The longest
  string on a GRN is a material option:
  `[1308119] LOCTITE BONDACE 007 POWDER 16KG`.
- Two columns on a phone ≥360px. One column below that.
- `.fk-grid2` / `.fk-grid3` already exist in FormKit — check before adding a grid
  class.

### 1.3 Collapse what most records never use

Optional blocks measured 508px on a 390px phone — a third of the form — for
fields most receipts never touch. Only supplier, material, batch and quantity
gate Save.

- Wrap optional sections in native `<details>`, **not** a JS show/hide. The
  controls stay in the DOM, so the save path keeps reading them. A JS toggle that
  removes the node breaks the payload.
- **Auto-open a collapsed section that holds content.** An extra item can satisfy
  Save on its own; a hidden filled field is worse than a visible empty one.
- Open by default above 900px, where there is no scroll problem to solve. CSS
  cannot force this — only the `open` attribute does.
- Above 720px, lay collapsed sections **side by side**. Stacked, each spent a
  whole row to show a 40px summary.

### 1.4 Density targets

Measured with `e2e-grnheight.js` / `e2e-grnanat.js`.

| Viewport | Target | GRN achieved |
|---|---|---|
| 390×844 phone | ≤ 1.5 screens | 1.32 |
| 768×1024 tablet | ≤ 1 screen | 0.86 |
| 1024 desktop | ≤ 1.3 screens | 1.29 |

Never buy density by shrinking a touch target below **44px**, and never below the
**16px** input font — anything smaller makes iOS Safari zoom on focus, which is
worse than scrolling.

---

## 2. Field anatomy

Every field is `.fk-field` containing, in order:

```html
<div class="fk-field">
  <label class="fk-label" for="x">Label <span class="req">*</span></label>
  <input id="x" class="fk-input fk-w-code">
  <span class="fk-hint">One line of guidance.</span>
  <div class="field-error-msg" id="err-x">What is wrong and what to do</div>
</div>
```

- **A placeholder is not a label.** It disappears the moment the operator types,
  and grey placeholder text fails contrast. `placeholder="Batch No *"` with no
  label was shipping in the extra-item rows.
- A placeholder shows **format**, not name: `B-`, `e.g. INV-2026-001`, `0`.
- **Hint and error occupy the same slot**, both `min-height` 15px, so validating
  a field never shifts the layout below it.
- Width class by content, not by container:
  `fk-w-num` 108px (counts) · `fk-w-date` 158px · `fk-w-code` 186px (batch, codes)
  · `fk-w-short` 260px (invoice) · `fk-w-mid` 420px (names, material options).
- A **unit belongs beside the number**, as a mono `.fk-unit` chip — not in a hint.
  A GRN booked in the wrong unit is a real defect class here: six rows of bulk
  were received in LTR against masters in KG.

---

## 3. Validation and feedback

### 3.1 Show errors when they are useful, not on arrival

- Validate on **blur** — "touched and left". Validating per keystroke flags a
  batch number as wrong while it is still being typed.
- **Clear the error the moment the value is good.** An error that outlives its
  cause is worse than no error.
- Never show errors on an untouched form. Four red messages on arrival trains
  operators to ignore red — and red is the PASS/FAIL signal the whole inspection
  UI depends on.
- On a blocked-save tap: mark **all** offending fields, toast the summary, and
  scroll to the first one.
- Confirm a satisfied required field with a 3px dot on the label. Never a colored
  card border above 1px.

### 3.2 A disabled button fires NO pointer event

Not "the click is swallowed" — **no event is generated at all**, so a
capture-phase listener on an ancestor never sees it either. Verified with a real
mouse click: no toast, no marked fields.

To make a blocked control explain itself:

```css
#stickyFooter #btnSubmit:disabled { pointer-events: none; }
```

The tap then falls through to the footer, which explains what is missing. The
button still cannot be activated. **Consequence:** the event target is now the
footer, never the button — so do not guard on `ev.target === btn`.

### 3.3 Messages appear where they can be read

`#submitHint` lived inside the sticky footer: measured at **y=756 on an 844px
viewport**, i.e. under the footer or behind the on-screen keyboard.

- Toasts anchor **below the header** (`top: calc(56px + 10px)`), never
  `bottom:`.
- `white-space: normal`. `nowrap` clipped exactly the long strings this form
  produces most ("Add a material, a batch number and a quantity…").
- Auto-dismiss ~3.5s. Errors name the problem **and** the recovery.

---

## 4. Before shipping a form change

```bash
node e2e-fast-render.js          # 36 checks, ~9s, must be 36/36 with no page errors
node e2e-grnheight.js            # height + screens-to-scroll per viewport
node e2e-grncrit.js              # per-field width %, label and hint coverage
node e2e-grngrid.js              # % of card width actually used
```

Then, because a form file changed, **bump both cache keys or users get stale HTML**:

1. `getFormHtml` key in `Code.js` (`vNN`)
2. `PFX` in `HtmlCache.html` (`vNN`)

Skipping either serves the old form after a successful deploy.

**Verify by measuring the built result, not by reading the rule.** Every defect in
section 0 read as correct in the source and was wrong in the browser.

---

## 5. Quick audit

- [ ] Zero `style=` attributes on form controls
- [ ] Per-form `.fk-*` overrides sit AFTER `include('FormKit')`
- [ ] Every width utility used is live at the width it is needed
- [ ] Every field: label, control, hint slot, error slot
- [ ] No placeholder used as a label
- [ ] Cards fill ≥90% of their width at ≥768px
- [ ] One logical record per card; no nested cards except repeated records
- [ ] Optional blocks collapsed, auto-opening when filled
- [ ] Touch targets ≥44px; input font 16px
- [ ] Blocked save names the reason, marks the fields, scrolls to the first
- [ ] Both cache keys bumped
