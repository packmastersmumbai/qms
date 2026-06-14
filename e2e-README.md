# PM QMS — E2E Harness

Backend-verified end-to-end tests for the live QMS web app, driven by Playwright through
the GAS double-iframe. Inspired by the TaskFlow DWM harness; adapted for QMS
(`google.script.run` instead of `window.APP`, Google-session auth).

## Files

| File | Role |
|---|---|
| `e2e-lib.js` | Shared helpers: `openApp`, `call` (promise wrapper over `google.script.run`), `nav`, `readSelect`, `makeRunner` |
| `e2e-production.js` | Production lifecycle: form init → FIFO plan → issue → **read-back** (guards the @298 Date-serialization regression). Writes 1 test record per run. |
| `e2e-oqc-dispatch.js` | OQC + Dispatch — non-destructive: form-init data + dropdown population + UI render (no submit, to preserve scarce IPQC sessions / FG lots) |
| `e2e-run-all.js` | Runs every suite, aggregates pass/fail |
| `e2e-auth-capture.js` | One-time interactive Google sign-in → saves `e2e-storageState.json` |

## Setup (when auth expires)

The Google session in `e2e-storageState.json` expires after ~2 weeks. When suites fail
with *"SPA frame (navigateTo) not found — auth state may be expired"*:

```bash
node e2e-auth-capture.js     # Chrome opens; sign in as packmasters.mumbai@gmail.com
```

It lands on the GAS `/exec` URL (Google OAuth renders correctly there, not in the wrapper
iframe), auto-detects the dashboard, and saves the session.

## Run

```bash
node e2e-run-all.js          # all suites
node e2e-production.js        # one suite
```

Exit code 0 = all passed, non-zero = failure.

## Notes

- **Test data:** `e2e-production.js` leaves one `PM/PROD/2026-NNN` issue (Prod Order `E2E-PROD`)
  in the live sheet per run — delete periodically from `PROD_ISSUE_LOG`.
- All `e2e-*.js`, `e2e-storageState.json`, and `.playwright/` are excluded from clasp deploy
  (`.claspignore`) and not pushed to GAS.
- Playwright is resolved from the global `@playwright/cli` install — no local `npm install` needed.
