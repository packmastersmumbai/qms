# PM QMS — Claude Code Context

## Stack
Google Apps Script (GAS) web app. No Node runtime in production.
Files pushed via `clasp`. Served at `packmastersmumbai.github.io/qms` (GitHub Pages iframe → GAS iframe).

## Deploy Workflow

### clasp (GAS)
```bash
clasp push                          # push .js/.html to GAS script
clasp deploy --deploymentId AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ --description "<type>: <description>"
```
- Always `clasp push` first, then `clasp deploy` with the deployment ID above
- The deploy command bumps the version number on the live URL — no manual GAS editor step needed
- Auth + script owner: `packmasters.mumbai@gmail.com`
- Script ID: `1gDN0dO6rsiE55Yu9bV9dgVFhtfoMyKmXWCy8B0-bAspjl_7o7hMRgtiQ`
- `.claspignore` excludes: `index.html`, `e2e-*.js`, `node_modules/**`, `package*.json`, `tailwind*`, `.claude/**`, `.playwright-cli/**`

### Cache-bump ritual (REQUIRED on any form/server change)
After `clasp push -f` + `clasp deploy`, bump BOTH version keys or users get stale HTML:
1. `getFormHtml` cache key in `Code.js` — increment the `vNN` suffix (currently `v157`).
2. `HtmlCache.html` — increment the `PFX` `vNN` (currently `v88`).
Skipping either serves cached forms even after a successful deploy.

### `clasp run` does NOT work here (permissions) — permanent workaround
`clasp run <fn>` fails: "Unable to run script function… permission". Do NOT retry it.
To execute any server function: add a `?diag=<name>` branch in `Code.js` `doGet` returning
`ContentService` JSON, then drive it with `node e2e-diag.js <name>` (uses stored auth in
`.playwright/e2e-storageState.json`). This is the established server-fn execution path.

### Playwright on GAS
`waitUntil:'networkidle'` HANGS on GAS (iframe polls forever). Use `domcontentloaded` +
fixed `waitForTimeout` (6-9s) and poll for a known element before asserting; forms load in
the innermost `script.googleusercontent` frame, reached via SPA `navigateTo('X')` (not `?page=`).

## Performance — production issue-plan (SOLVED, keep solved)
Symptom that recurred across sessions: "issue plan slow to show / save / issue."
ROOT CAUSE (do not re-diagnose): the flow re-read entire `STOCK_LEDGER` + `GRN_LOG` +
`IQC_LOG` + `LOCATIONS` ~2× per BOM component per pass (~6N full-sheet scans).
FIX (in place): `ProductionReadCache.js` memoizes those reads per request (module-global =
one `google.script.run` execution). `getFIFOLots` / `getProductionLotsForMaterial` /
`getStockForComponents_` read from it; `writeStockLedger_` calls `prodCacheReset_()` after
each write so post-write reads stay fresh. Actual debit uses live `getStockBalance_` under
lock, so correctness never depended on the cache. If preview feels slow again, check the
cache is still wired (not that these sheets need re-reading) — see [[pmqms-prod-issueplan-perf]].

### GitHub Pages (outer shell)
Repo local clone: `C:\Users\Appex\AppData\Local\Temp\qms-pages\`
```bash
cd "C:\Users\Appex\AppData\Local\Temp\qms-pages"
# Edit index.html iframe src to point to new GAS deploy URL
git add index.html && git commit -m "chore: update GAS deploy URL to @NNN"
git push
```
`index.html` is a full-screen iframe wrapper — owns the `<meta viewport>` tag (GAS outer shell has none).
To update the GAS URL it points to, change the `src=` in the single `<iframe>` element.

## Key URLs
- Live (GitHub Pages): `https://packmastersmumbai.github.io/qms`
- GAS current (@621): `https://script.google.com/macros/s/AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ/exec`
- Rollback (@222): `https://script.google.com/macros/s/AKfycbxKD8M79Bp_7CBGdsYUGhgrRgbF0kaBNG6phmqHereomdHfpsqp1sWttcoedBqvkDPEYQ/exec`

## File Map
| File | Role |
|---|---|
| `Code.js` | Core GAS: `computePendingCounts_`, `getLandingBundleV3Fast`, `getSpreadsheet` |
| `KpiConfig.js` | KPI definitions + `getLandingBundleV2/V3Fast` |
| `Records.js` | `getRecordsList`, `getRecordsCounts`, `_computeRecordsList_` |
| `Dispatch.js` | FG_DISPATCH_LOTS FIFO logic, `backfillFGDispatchLotsFromOQC` |
| `Landing.html` | Dashboard tiles; counts from `getLandingBundleV3Fast` |
| `Records_F.html` | Records view with tab bar + card list |
| `_Diag.js` | Diagnostic helpers — never pushed to production deploy |

## Sheet Schema Quick Ref
- `FG_DISPATCH_LOTS` col 14 (0-based) = Status (`AVAILABLE|PARTIAL|DISPATCHED|NEEDS_REVIEW|RECALLED`)
- `GATEPASS_LOG` col 15 = STATUS
- `OQC_LOG` col 14 = Release Decision
- Pending counts: `computePendingCounts_(ss)` in `Code.js:363` — single source of truth for all module badges

## GAS-Specific Gotchas
- **`@media (hover:none)` unreliable** — GAS runs inside a double-iframe (GitHub Pages → script.googleusercontent.com). Android browsers may report `hover:hover` even on touch. Use `display:flex` always instead of media-query show/hide.
- **`window.parent.document` blocked** — cross-origin (script.googleusercontent.com ≠ github.io). Viewport injection via parent DOM is impossible.
- **Functions inside IIFEs** — helpers like `gotoForm` must be explicitly exposed via `window.gotoForm = gotoForm` if called from inline HTML `onclick` outside the IIFE.
- **`google.script.run` is async** — no return values; always use `.withSuccessHandler()`.
- **Cache key versioning** — bump suffix (e.g. `v5` → `v6`) when changing bundle shape; old cache silently returns stale structure.
- **`.claspignore`** — e2e Node files (`Trace.js`, `e2e-*.js`) must be listed or `require is not defined` crashes the deploy.

## E2E Testing — two tiers, use the fast one first

```bash
node e2e-fast-render.js     # OFFLINE, ~7s, 36 checks across all 9 write forms
node e2e-gate.js            # LIVE, >10 min — run in BACKGROUND, never inline
node e2e-suite.js IQC GRN   # LIVE, per-form render checks
node e2e-savepaths.js       # LIVE, save-path regression, 9 tested / 0 skipped
```

**`e2e-fast-lib.js` (offline)** — reads form HTML from disk, resolves the GAS
includes locally, mocks `google.script.run`, `setContent`. No deploy, no iframe,
no auth. ~60x faster per check than live. Technique borrowed from
`PackMastersQrAtt`. Tests CLIENT logic only: render, validation gating, save
dispatch, payload shape, idempotency keys.

**It cannot see the server, the sheets, or the real GAS bridge.** A shimmed write
proves the dispatch fires; it does NOT prove the response comes back. GRN's
"save not working" bug passed savepaths while genuinely broken for exactly this
reason. Live gate before shipping anything that touches a write path.

**Fixture precondition** — `e2e-savepaths` silently degrades to fewer tested
forms without seeded data:
```bash
node e2e-diag.js "fixtureseed&confirm=YES"   # before savepaths / gate
node e2e-diag.js fixtures                    # state + 30-row window check
node e2e-diag.js "fixtureclear&confirm=YES"  # archive, frees the GRN again
```
`e2e-gate.js` checks this first and fails rather than reporting a pass on
reduced coverage. Coverage floor is 9 (all write forms).

### Diagnostics index (`node e2e-diag.js <name>`)
Read-only unless noted; writers are dry-run by default, `&confirm=YES` applies.

| Diag | Purpose |
|---|---|
| `vocabaudit` | Cross-sheet vocabulary + join health. **Has a VERDICT — can FAIL** |
| `mataudit` | MASTERS_Materials data quality |
| `matdatafix` | Category/Unit/Item-Code normalisation *(writes)* |
| `catsplit` | Split ambiguous Category so InspCategory is derivable *(writes)* |
| `bomvocabfix` | BOM Comp UoM → master vocabulary *(writes)* |
| `bomsheetfix` | BOM col K/col A ← masters *(writes)* |
| `fguomfix` | FG unit → NOS across BOM/PROD_JOBS/PROD_BOOKING_LOG *(writes)* |
| `paramdatafix` | MASTERS_Parameters std/archive *(writes)* |
| `paramspecsheet` / `paramspecapply` | QA fill-in round-trip for 40 measured params |
| `txnleak` | Is a `[txn:]` tag reaching a printed document? **Can FAIL** |
| `iqcidem` | Proves the IQC idempotency guard blocks a retry *(writes + cleans up)* |
| `fixtures` / `fixtureseed` / `fixtureclear` | e2e fixture lifecycle |
| `grnrecent` / `grngap` | Recent GRNs; burnt doc numbers |
| `cleane2egrn` | Remove probe-created GRN rows *(writes)* |
| `backupsheets&sheets=A,B` | Timestamped hidden backup tabs |

### playwright-cli (ad-hoc)
```bash
playwright-cli open https://packmastersmumbai.github.io/qms
playwright-cli screenshot <url> --output out.png
```
- Config: `.playwright/cli.config.json` → `{"headless": true}` (always headless; `--headed` flag ignored when config present)
- Auth state: `.playwright/e2e-storageState.json` — expires; if Google shows sign-in, re-capture via `e2e-auth-capture.js`
- **Cannot** use `--cdp-url` (unsupported flag) or `--profile` while Chrome is running (profile locked)
- **Cannot** share a live Chrome session — Playwright needs its own browser instance

## Open findings (as of @621, 2026-08-04)

**`?diag=vocabaudit` is currently FAILING** — 148 BOM rows were added after the
normalisation work and brought new drift. Run it first; do not assume the sheets
are clean. Needs owner input, not a guess:
- `KETO` (125 rows) matches no customer code or name — is this a new customer?
- `NICHEM SOLUTION` (23 rows) is singular; the master says `NICHEM SOLUTIONS`
- 25 FG + 26 component codes do not resolve to `MASTERS_Materials`
- BOM/master UoM disagreements 13 -> 36 (`No's` is back in col I)
- col K reverted to mixed values (`TAPE`/`TAPE-FLAT`, `LABELS`/`LABELS-FLAT`)
Re-running `bomvocabfix` / `bomsheetfix` fixes the spelling half; the missing
customer and the 51 unresolved codes are data decisions.

**Six of nine writers have NO idempotency key** — OQC, IPQC, Dispatch,
CustomerReturn, PO, Rework. Only GRN, IQC and Gatepass are guarded. Each
unguarded one writes a DUPLICATE record on a retry after a dropped response.
`e2e-savepaths` prints this on every run (`missing txn key:`). **Dispatch is the
most consequential — it moves FG stock.** Pattern is proven three times over
(GRN/IQC/Gatepass): generate a key client-side, stamp it into the log's Remarks,
look it up before writing, strip it on display (`stripTxnTag_`), add a
`?diag=` self-test.

**GAS replies get lost on long calls.** `saveGRN` takes ~12s server-side and
returns successfully, but the success handler often never fires through the
double iframe — the row IS written. GRN now recovers via
`findGRNByTxn(txn)` in its watchdog. **Any other slow writer has the same
exposure** and no such recovery.

**Duplicate item codes** `552000-005015` (two different products — "Hanging
Display White" / "red") and `305025-C06600`. Lookups are first-match-wins, so
one variant is unreachable. Also the cause of the 2 blank inspection categories
and the 2 uncategorised HANGER materials — one root cause, not three. Owner
declined to fix; needs a new item code minted.

**Data gaps blocking features** — `Each W` 100% empty and 179/181 no Per Pallet
(capacity-aware putaway); 181/181 no Reorder Level; 40 measured inspection
params still on the `As per spec` placeholder (`PARAM_SPEC_TODO` is built and
waiting for QA). All data entry, not code.

**13 genuine BOM/master UoM disagreements** remain after normalisation — a
component whose BOM unit really differs from its master unit (e.g. `1706619`
BOM=NOS, master=MTR). These are data, not spelling; `vocabaudit` treats 13 as
the baseline and fails above it.

**22 negative-stock lots** (7,073 units short) — pre-existing, never investigated.
