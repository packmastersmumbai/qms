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
- GAS current (@236): `https://script.google.com/macros/s/AKfycbxMFpeJOqF5_iARRCo7aHLg0Pw_XlqKdAzmDVck8DUdDfgr1nIIjbvTgrlyc0XtYRuaVQ/exec`
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

## E2E Testing (playwright-cli)
```bash
playwright-cli open https://packmastersmumbai.github.io/qms   # open page
playwright-cli screenshot <url> --output out.png               # capture screenshot
```
- Config: `.playwright/cli.config.json` → `{"headless": true}` (always headless; `--headed` flag ignored when config present)
- Auth state: `.playwright/e2e-storageState.json` — expires; if Google shows sign-in, re-capture via `e2e-auth-capture.js`
- **Cannot** use `--cdp-url` (unsupported flag) or `--profile` while Chrome is running (profile locked)
- **Cannot** share a live Chrome session — Playwright needs its own browser instance
