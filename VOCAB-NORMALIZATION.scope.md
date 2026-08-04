# Vocabulary Normalisation — Scope

**Status:** scoped, not built
**Evidence:** `?diag=vocabaudit` (new, read-only), `?diag=mataudit`, live @605
**Date:** 2026-08-04

---

## The question that started this

> "Inspection category in master material is not required as categories already
> defined in the sheet column. Control plan/parameters can use the category
> column instead."

**The data says no — and this is the one item I recommend NOT doing.**

`Category → InspCategory` is not a function. Three Category values map to two
different inspection categories each:

```
FG      → FG(33) , CARTON(5)            the 5 are cartons sold as FG
LABELS  → LABEL(28) , HDPE_BOTTLE(10)   10 are in-mould / bottle labels
TAPE    → LABEL(3) , CARTON(1)
```

Deriving col M from col D gives **19 materials the wrong inspection
parameters** — a carton inspected as generic FG, a bottle label inspected on
paper criteria. In a QA system that is a silent quality escape, not a tidy-up.

The columns are different axes and both earn their place:

| | Purpose | Values |
|---|---|---|
| `Category` (D) | what you **buy / stock** it as | 20 |
| `Inspection Category` (M) | how you **test** it | 10 |

The collapse is real and correct where it exists: `BOTTLES`/`CANS`/`CAPS`/`PLUG`
→ `HDPE_BOTTLE`; `OUTER`/`INNER`/`MONO CARTON`/`CARTONS` → `CARTON`.

**Recommendation:** keep col M. Fix its 2 blanks instead (both rows of the
duplicate `552000-005015` hanger — same root cause already flagged and
deferred).

The redundancy instinct IS right, just aimed one column over — see Item 2.

---

## Item 1 — Normalise BOM component UoM  ✅ SAFE, DO FIRST

### Problem
**143 of 195 BOM rows disagree with `MASTERS_Materials` on the unit.**

```
BOM Comp UoM (col I), 9 spellings:
  No's(74)  PC(59)  KG(30)  MTR(20)  M(6)  Nos(2)  kg(2)  CONS(1)  CON(1)

MASTERS_Materials Unit, 4 values (already normalised):
  NOS(117)  KG(48)  LTR(11)  MTR(5)
```

Sample disagreements: `1706616 BOM="PC" master="NOS"`, `2240375 BOM="M"
master="MTR"`, `1706619 BOM="PC" master="MTR"`.

This is partly self-inflicted: an earlier commit this session normalised
`MASTERS_Materials` to 4 values and left BOM untouched, so the two sheets now
disagree on 73% of rows where they previously agreed on being equally messy.

### Why it matters
Consumption maths multiplies `consum` across this join. Nothing errors — it
computes against a unit label nobody validates, and the issue-plan UI prints
whichever spelling the BOM happens to hold (`Production_F.html:777-785`).

### Blast radius — SMALL
`compUom` is **display-only**. `getBomRows_` (`Production.js:611`) reads it;
`Production.js:686` and `:891` pass it through; `Production_F.html` prints it.
**No logic branches on it** (verified by grep).

### Change
Map to the master's 4 values, same table already used by `_MatDataFix`:
`PC / No's / Nos / PCS → NOS`, `M → MTR`, `kg → KG`, `CON / CONS → NOS`.

Dry-run diag + backup first, per the established pattern.

### Also worth flagging (not fixing here)
BOM FG UoM (col E) holds `CON(79) Bottles(79) Sachet(19) Pouch(12) Can(6)` —
those are **container formats, not units of measure**. "Bottles" is a pack type;
the unit is NOS. Normalising this needs a product decision about whether col E
means "unit" or "pack format", so it is out of scope until that is settled.

---

## Item 2 — Drop BOM col K (`Type`)  ⚠️ NEEDS CODE CHANGE

### Problem
23 values for the concept `MASTERS_Materials.Category` already holds in 20 —
and case-split three ways in places:

```
Tape(20) Bulk(18) LABEL(17) Outer(16) Labels(16) BULK(14) Bottles(12)
Caps(12) STICKER(10) CAN(10) CARTON(10) TAPE(9) THERMALRIBBON(9) Inner(4)
Pouch(3) Mono Carton(3) Liner(2) Sachet(2) label(2) Rubber(2) Can(2)
QR(1) Hanger(1)
```

`LABEL`/`Labels`/`label` are three spellings of one value. `Bulk`/`BULK`,
`Tape`/`TAPE`, `Can`/`CAN` likewise.

### Why it is derivable
**Every BOM component code resolves to a material** (`?diag=vocabaudit`:
0 unresolved FG codes, 0 unresolved component codes). So `type` can be looked up
from `MASTERS_Materials.Category` on every row without exception.

This is the user's redundancy argument, and here it is correct.

### Blast radius — SMALL, but it is a code change
`type` is display-only, same as `compUom`: `Production.js:612` reads it, `:686`
and `:891` pass it through, `Production_F.html:782` prints it in one cell.

### Change
1. `getBomRows_` stops reading col K; resolves `type` from the material master
   by `compCode` instead.
2. Leave col K in the sheet initially (stale but harmless) — do not delete data
   in the same change that alters a reader.
3. Once verified, blank col K in a separate, backed-up step.

### Why staged
Deleting the column and changing the reader together means a rollback restores
the reader but not the data. The `MASTERS_Materials` break was exactly this
shape.

---

## Item 3 — Join customers by CODE, not name  ⚠️ HIGHEST RISK, HIGHEST VALUE

### Problem
```
MASTERS_Customers codes:  HENK, APL, NS, DK, MOTO
MASTERS_Customers names:  Henkel Adhesives | ARABIAN PETROLEUM | NICHEM
                          SOLUTIONS | DORF KETAL | CARCARE MOTO
BOM.Client values:        "Dorf Ketal"(116)  "Henkel Adhesives"(79)

matches a customer CODE: 0
matches a customer NAME: 2
matches NEITHER:         0
```

It works **today**, by string equality on a display name — and already only
survives a case difference by luck: the master says `DORF KETAL`, BOM says
`Dorf Ketal`.

### Where it is load-bearing
`Production.js:631`:
```js
if (key && r.client !== key) return;
```
This is `getFGListByClient` — an **exact, case-sensitive** filter. If a client
name is edited in either sheet, the FG dropdown for that client silently returns
**empty**. Not an error; just no products.

`CustomerReturn.js:48` already lowercases before comparing — someone hit this
and patched one site. That is the tell.

### Change
1. Add a `Customer Code` column to BOM alongside `Client`.
2. Backfill by matching the current name (2 distinct values — trivial).
3. `getBomRows_` returns both `clientCode` and `client` (display name).
4. `getFGListByClient` filters on **code**; the UI keeps showing the name.
5. Keep the name column — it is what operators read.

### Why this is the riskiest of the four
It changes BOM's shape (a new column) and a filter used by the production
issue-plan — the flow with a documented performance history and real money
behind it. It needs the full ritual: backup, dry-run, e2e gate before and after.

Three customers (`APL`, `NS`, `MOTO`) have **no BOM rows at all**, so the
backfill only touches two values.

---

## Item 4 — Standing drift audit  ✅ SAFE

`?diag=vocabaudit` already exists (built for this analysis) and reports:
- per-sheet vocabularies for Unit / Category / InspCategory / Type / Client
- BOM ↔ material **UoM disagreement count**
- BOM ↔ customer **join health** (code / name / neither)
- BOM code resolution (unresolved FG + component codes)
- the `Category → InspCategory` ambiguity table

### Change
Add a **VERDICT** line and a threshold, so it fails rather than merely reports —
same shape as `?diag=txnleak`. Then wire it into `e2e-gate.js` as a third check
alongside render + save paths.

Rationale: "remember to keep the vocabularies aligned" is not a control. Item 1
exists precisely because a previous fix normalised one sheet and left its
partner behind, and nothing caught it for a full session.

---

## Recommended order

| # | Item | Risk | Needs code change | Gate before/after |
|---|---|---|---|---|
| 1 | BOM Comp UoM → 4 values | low | no | yes |
| 4 | vocabaudit verdict + gate | low | no (test only) | n/a |
| 2 | Derive `type` from master | med | yes (reader) | yes |
| 3 | Customer code join | high | yes (reader + filter + sheet) | yes |
| — | Drop InspCategory | — | **NOT RECOMMENDED** | — |

Do 1 and 4 together: 4 then locks in 1 and catches the next drift.
2 and 3 each want their own deploy and their own gate run.

---

## Out of scope / still open

- **Duplicate item codes** `552000-005015`, `305025-C06600` — user declined.
  They remain the cause of the 2 blank inspection categories.
- **BOM FG UoM (col E)** — container formats in a unit column; needs a product
  decision first.
- **Six writers with no idempotency key** — OQC, IPQC, Dispatch,
  CustomerReturn, PO, Rework. Unrelated to vocabulary, tracked separately.
