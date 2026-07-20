# Category-Driven IQC/IPQC Parameters + Material Technical Specs — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorm) — pending spec review → implementation plan
**Branch:** feat/grn-iqc-redesign

## Problem

IQC inspection parameters are **hardcoded and fixed for every product** — a 12-item list
(`IQC_PARAMS`) duplicated in two files (`IQC.js:6` and `IQC_F.html:503`, which drift) and
welded to fixed `IQC_LOG` columns 11–22. There is no way to vary the inspection checklist
by what is actually being inspected (an HDPE bottle, a label, paper, a carton, bulk resin
all get the same 12 checks). IPQC is better — it resolves params per product via
`CONTROL_FG` × `MASTERS_Parameters` — but keys on product code, not category, and shares
nothing with IQC.

Separately, the **material master holds no technical specs** (dimensions, weight, MFI, wall
thickness…) and **no test-report/COA reference**, so inspection specs shown to the operator
are generic, not the material's actual acceptance values.

## Goals

1. IQC (and IPQC) show inspection parameters **appropriate to the product category**.
2. Parameters are **configurable via masters** (owner-gated CRUD), not code.
3. Each material carries its **own technical specs** (dimensions, values, tolerances) that
   drive the displayed acceptance spec.
4. Material carries a **reference test-report / COA linkage**; actual COA captured per-batch
   at GRN/IQC (existing mechanism).
5. Kill the duplicated hardcoded `IQC_PARAMS`; render IQC params from the server payload.
6. Fully additive — no destructive change to existing sheets; nothing breaks mid-migration.

## Non-Goals

- Changing the AQL sampling engine (separate open item — see `pmqms-aql-engine-selftest-fail`).
- Auto-comparing received COA values against expected (deferred; test-report data is
  doc-linkage + per-batch capture, not structured auto-compare in v1).
- Reworking OQC parameters (out of scope; this is IQC + IPQC).

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| Keying | Parameters resolved by product **inspection category** (not per-product). |
| Category field | **New** `inspectionCategory` column on `MASTERS_Materials` (FG/RM/PM class untouched). |
| Config storage | **New `CATEGORY_PARAMS`** mapping sheet + reuse existing `MASTERS_Parameters` dictionary. |
| IQC value storage | **New `IQC_PARAM_LOG`** (EAV, one row per param per record), mirroring `IPQC_LOG`. Legacy `IQC_LOG` cols 11–22 kept for back-compat reads. |
| Material specs | **New `MATERIAL_SPECS`** (EAV): per-material std/tol/unit per param. |
| Test-report data | Material holds `coaRequired` + `specDocRef` (Drive link); actual COA captured per-batch at GRN/IQC. |
| Seed | Seed `CATEGORY_PARAMS` + `MASTERS_Parameters` with starter sets for 5 categories; `MATERIAL_SPECS` empty (populated per material). |

## Architecture

Follows the proven IPQC pattern (`CONTROL_FG` mapping × `MASTERS_Parameters` dictionary),
generalized to be category-keyed and shared by IQC + IPQC.

```
inspectionCategory  →  CATEGORY_PARAMS    →  WHICH params apply (per category, per flow)
materialCode        →  MATERIAL_SPECS     →  THIS material's spec values (override)
paramCode           →  MASTERS_Parameters →  generic default + label/unit (fallback)
coaRequired / specDocRef on material      →  reference test-report linkage
GRN/IQC Drive upload (existing)           →  received COA / test-report evidence
```

## Data Model

### `MASTERS_Materials` (extend)
`MAT_COL` currently A→L (width 12). Add:
- col M (idx 12): `inspectionCategory` — `HDPE_BOTTLE | LABEL | PAPER | CARTON | BULK` (extensible)
- col N (idx 13): `coaRequired` — `Y | N`
- col O (idx 14): `specDocRef` — Drive URL to reference technical spec / test-report template

`MAT_COL.INSP_CATEGORY=12, COA_REQUIRED=13, SPEC_DOC_REF=14`; `MAT_WIDTH` 12→15.
`getMaterials()` returns the three new fields; `saveMaster`/`_upsertMaterialRow_` preserve them.

### `MASTERS_Parameters` (existing — reused as-is)
`code, name, unit, std_value, tol_min, tol_max, method_type, check_brief, tools, doc_ref, doc_number`.
New params (per seed) appended here where missing.

### `CATEGORY_PARAMS` (NEW — registered in `MastersCrud`)
| col | key | type | note |
|---|---|---|---|
| A | category | text | HDPE_BOTTLE… |
| B | paramCode | text | FK → MASTERS_Parameters.code |
| C | appliesTo | enum | IQC \| IPQC \| BOTH |
| D | enabled | enum Y/N | |
| E | ccp | enum Y/N | critical control point flag |
| F | specOverride | text | overrides dictionary spec text |
| G | tolMinOverride | num | |
| H | tolMaxOverride | num | |
| I | sort | num | display order |

One row per (category, param). Registered in `MASTERS_SCHEMA_` (`MastersCrud.js:9`) → inherits
owner-gated CRUD + audit + FK-warn for free.

### `MATERIAL_SPECS` (NEW — EAV, per-material technical specs)
| col | key | type |
|---|---|---|
| A | materialCode | text (FK → MASTERS_Materials) |
| B | paramCode | text (FK → MASTERS_Parameters) |
| C | stdValue | text/num |
| D | tolMin | num |
| E | tolMax | num |
| F | unit | text |
| G | specText | text (free-form spec, e.g. "neck ø 28mm ±0.2") |
| H | sort | num |

One row per (material, param). Also registered in `MastersCrud`.

### `IQC_PARAM_LOG` (NEW — EAV, per-IQC-record param values)
`iqcDocNo, timestamp, paramCode, paramName, unit, stdValue, actualValue, result (PASS/FAIL/NA), remark`.
One row per param per IQC record. Written by `saveIQC`; `IQC_LOG` cols 11–22 remain for legacy reads.

## Resolver

Single shared function (new, e.g. `InspectionParams.js`):

`getCategoryParams(category, flow)` → for `flow ∈ {IQC, IPQC}`:
1. Read `CATEGORY_PARAMS` where `category` matches, `appliesTo ∈ {flow, BOTH}`, `enabled=Y`.
2. Join `MASTERS_Parameters` on paramCode for label/unit/method/default std/tol.
3. Apply `CATEGORY_PARAMS` overrides (spec/tol) over the dictionary defaults.
4. Sort by `sort`.
Returns `[{paramCode, label, unit, std, tolMin, tolMax, ccp, hint, method, sort}]`.

`getInspectionSpec(materialCode, category, paramCode)` — resolves ONE param's spec with precedence:
1. `MATERIAL_SPECS` (this material's value) — most specific
2. `CATEGORY_PARAMS` override
3. `MASTERS_Parameters` default — most generic

The IQC/IPQC form builds its checklist from `getCategoryParams`, then fills each param's
displayed spec via `getInspectionSpec` (material-specific where present).

### Per-parameter operator guidance (ⓘ tooltip)

Every inspection parameter row (IQC **and** IPQC) shows an ⓘ button that reveals a
how-to-inspect guide, assembled from fields **already stored** — no new columns:

| Tooltip line | Source |
|---|---|
| **How** (method) | `MASTERS_Parameters.check_brief` |
| **Tool** | `MASTERS_Parameters.tools` |
| **Accept** | resolved spec (`getInspectionSpec`: material › category › dictionary) |
| **Ref** | `MASTERS_Parameters.doc_ref` (+ CCP badge from `CATEGORY_PARAMS.ccp`) |

`getCategoryParams` returns these in each param object (`hint`/`method`/`tools`/`docRef`/`ccp`
already implied by the resolver join). The form renders one ⓘ per row.

**Interaction:** GAS runs in a touch-capable double-iframe where `@media (hover:none)` is
unreliable (see CLAUDE.md). So the ⓘ is **tap-to-toggle** (click opens a small popover,
click-outside/second-tap closes) rather than hover-only — works on both desktop and mobile.
One popover open at a time; positioned to stay in-viewport. Respects `prefers-reduced-motion`.

## Flow Changes

### IQC (`IQC.js`, `IQC_F.html`)
- `getIQCFormInit` / a new `getIQCParamsForProduct(materialCode)` returns the resolved param
  list (category → params, material specs applied).
- **`IQC_F.html` renders from the server payload** — delete the hardcoded client `IQC_PARAMS`
  (fixes the two-copies-drift bug).
- `saveIQC` writes one `IQC_PARAM_LOG` row per param (value + result). Cols 11–22 left as-is.
- **Fallback:** material with no `inspectionCategory`, or a category with no params → fall back
  to the current 12 hardcoded params so existing products keep working during migration.

### IPQC (`IPQC.js`)
- `getIPQCParams(productCode)` gains a category layer: resolve by the product's
  `inspectionCategory` first, then still allow the existing `CONTROL_FG` per-product override
  on top. Storage (`IPQC_LOG`, already EAV) unchanged.

### Masters (`Masters.js`, `MastersCrud.js`)
- Extend `MAT_COL` + material read/write for the 3 new fields.
- Register `CATEGORY_PARAMS` and `MATERIAL_SPECS` in `MASTERS_SCHEMA_`.

## Seeding

Idempotent seeder (function + `?diag=seedcategoryparams`):
- Ensures `CATEGORY_PARAMS`, `MATERIAL_SPECS`, `IQC_PARAM_LOG` sheets exist.
- Appends missing param definitions to `MASTERS_Parameters`, including `check_brief`
  (method / How), `tools`, and `doc_ref` so the ⓘ operator-guidance tooltip has content
  from day one.
- Seeds `CATEGORY_PARAMS` starter sets:
  - **HDPE_BOTTLE**: weight, dimensions, neck/thread ø, wall thickness, leak test, drop test, colour, clarity
  - **LABEL**: dimensions, print quality, colour match, adhesion, barcode scan, material/GSM
  - **PAPER**: GSM, moisture, dimensions, brightness, tensile
  - **CARTON**: dimensions, GSM/ply, bursting strength, ECT, print, ply-bond
  - **BULK**: net weight, moisture, contamination, MFI/melt index, colour, granule size
- `MATERIAL_SPECS` left empty (populated per material via masters UI).
- Re-runnable = no-op (dedupe by natural key).

## Migration / Rollout

- Additive: 3 material columns + 3 new sheets (`CATEGORY_PARAMS`, `MATERIAL_SPECS`,
  `IQC_PARAM_LOG`). No destructive change to `IQC_LOG`.
- Fallback path keeps un-categorized products working (current 12 params).
- Deploy ritual: clasp push+deploy, bump `getFormHtml` cache key + HtmlCache PFX (form HTML changes).

## Testing

Regression smoke (`?diag=smokecatparams`, per this session's harness pattern):
- Seed a TEST material with `inspectionCategory=HDPE_BOTTLE` + a couple `MATERIAL_SPECS` rows.
- Assert `getCategoryParams('HDPE_BOTTLE','IQC')` returns the seeded param set, sorted.
- Assert `getInspectionSpec` precedence: material spec wins over category over dictionary.
- Assert a real `saveIQC` writes N `IQC_PARAM_LOG` rows matching the resolved params; round-trip readback.
- Assert fallback: a material with no category → 12 legacy params.
- Assert each resolved param carries ⓘ guidance fields (method/tools/docRef) for the tooltip.
- Self-clean (archive TEST rows), notify-suppressed, per existing smoke conventions.

## Risks

- **Row-count / read cost:** EAV sheets grow faster than fixed columns. Mitigate with the
  existing per-request read-cache pattern (`ProductionReadCache.js`) if resolver reads become hot.
- **Form rewrite:** removing the client `IQC_PARAMS` hardcode is the highest-touch change; the
  fallback path de-risks it.
- **Category taxonomy churn:** categories are string values; a rename orphans `CATEGORY_PARAMS`
  rows. Acceptable for v1 (owner edits via CRUD); could add a category master later.

## Open Questions (resolved)

- Keying → category. Category field → new column. Config → CATEGORY_PARAMS + reuse dictionary.
  IQC storage → new EAV log. Material specs → per-material EAV. Test-report → doc linkage + GRN capture.
- IPQC category layer: included now (layered above existing product-code override).
