# PM QMS — E2E Harness

Two tiers. **Use the fast one while developing; the live gate before shipping.**

## Fast (offline) — ~7s

```bash
node e2e-fast-render.js        # 36 checks, all 9 write forms
```

`e2e-fast-lib.js` reads each form from disk, resolves the GAS `<?!= ... ?>`
includes locally, injects a `google.script.run` mock, and loads via
`page.setContent()`. No deploy, no double iframe, no auth, no network.
~60x faster per check than live. Technique borrowed from `PackMastersQrAtt`.

Viable only because **every scriptlet in all 9 write forms is a static file
include** — none templates server data. Verify that still holds before adding a
form.

**What it does NOT cover:** the server, the sheets, the real GAS bridge. A
shimmed write proves the dispatch fires; it does not prove the response comes
back. GRN's "save not working" bug passed the live save-path test while
genuinely broken for exactly that reason.

## Live — minutes

```bash
node e2e-suite.js                  # render checks, all modules
node e2e-suite.js IQC GRN          # ...or named modules
node e2e-savepaths.js              # save paths, 9 tested / 0 skipped
node e2e-gate.js                   # BOTH + preconditions — run in BACKGROUND
```

`e2e-gate.js` is the blocking pre-deploy gate: fixture precondition, render
suite, save paths, and a coverage floor of 9. It exceeds 10 minutes — background
it, never inline.

### Fixtures are a precondition
`e2e-savepaths` silently degrades to fewer tested forms without seeded data, so
the gate checks first and fails rather than reporting a pass on reduced coverage.

```bash
node e2e-diag.js "fixtureseed&confirm=YES"
node e2e-diag.js fixtures                    # state + 30-row visibility window
node e2e-diag.js "fixtureclear&confirm=YES"
```

Two mechanisms make fixtures vanish, both handled by `_Fixtures.js` and both
worth knowing:
- `getUnInspectedGRNs` offers a GRN only until an `IQC_LOG` row references it —
  a test that really saves consumes its own fixture.
- `getRecentGRNs` returns only the **last 30** GRNs; live receipts push fixtures
  out of the window with no error.

## Running server functions

`clasp run` does not work here (permissions). Add a `?diag=<name>` branch in
`Code.js` `doGet` and drive it:

```bash
node e2e-diag.js <name>
node e2e-diag.js "<name>&confirm=YES"    # writers are dry-run by default
```

See CLAUDE.md for the full diagnostics index.

## Gotchas

- `waitUntil:'networkidle'` HANGS on GAS. Use `domcontentloaded` + a fixed wait,
  then poll for a known element.
- Settle times: most forms 11s, IQC 13s, KPI 20s.
- Forms live in the innermost `script.googleusercontent` frame, reached via SPA
  `navigateTo('X')` — not `?page=`.
- Auth: `.playwright/e2e-storageState.json`. Expires; re-capture with
  `e2e-auth-capture.js` if Google shows a sign-in page.
- **Never trust one green run.** Running twice caught an IPQC driver that could
  only ever pass once (fixed batch vs a "session already exists" server guard).
